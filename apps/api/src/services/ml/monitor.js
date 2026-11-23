/**
 * Step 6: AI monitor (SUPER_ADMIN, read-only). Per model: the registered shadow artifact, how many RULES / SHADOW
 * rows were logged, shadow failures and skips (with reasons), outcome coverage against the approval-gate minimums,
 * the background jobs' last run, the ML service's health, the recommendation experiment's counts and the flags.
 *
 * Counts only: no accuracy or performance figure is computed (see insights.js EVALUATION_NOTE). Nothing here is
 * read by a decision path.
 */
import prisma from '../../config/prisma.js';
import { mlFlags } from '../../config/mlFlags.js';
import { mlGet } from '../mlService.js';
import { MINIMUMS, REC_MIN_IMPRESSIONS, evaluationBlock, modelBlock, outcomeCounts } from './insights.js';
import { jobStatus } from './jobs.js';

export const MONITORED = [
  { name: 'intent', feature: 'A', title: 'Purchase intent', when: 'Each signed-in visit, after it ends (30 minutes idle); the job looks back 48 hours.', min: { positives: MINIMUMS.min_test_positives, negatives: MINIMUMS.min_test_negatives } },
  { name: 'abandonment', feature: 'B', title: 'Abandoned checkout (visits)', when: 'Each finished signed-in visit that reached checkout.', min: { positives: MINIMUMS.min_test_positives, negatives: MINIMUMS.min_test_negatives } },
  { name: 'checkout_abandonment', feature: 'B', title: 'Abandoned checkout (checkout start)', when: 'Each checkout, the moment it starts.', min: { positives: MINIMUMS.min_test_positives, negatives: MINIMUMS.min_test_negatives } },
  { name: 'fraud', feature: 'C', title: 'Fraud', when: 'Each checkout attempt that sends browser telemetry. Nothing logged means no checkout since then.', min: { positives: MINIMUMS.min_test_frauds, negatives: MINIMUMS.min_test_negatives } },
  { name: 'demand', feature: 'F', title: 'Demand (first 48 h)', when: 'When the Demand forecast page is opened (once per event per day) and when sales open.', min: { events: MINIMUMS.min_test_events_demand } },
  { name: 'demand_hourly', feature: 'F', title: 'Demand (hourly, next 24 h)', when: 'Every hour for each event on sale.', min: { events: MINIMUMS.min_test_events_demand_hourly } },
  { name: 'attendance', feature: 'G', title: 'Attendance (no-show)', when: 'Each ticket, 24 hours before its event starts.', min: { positives: MINIMUMS.min_test_positives, negatives: MINIMUMS.min_test_negatives, events: MINIMUMS.min_test_events_attendance } },
  { name: 'crowd', feature: 'H', title: 'Crowd flow', when: 'Each gate of an event from 26 hours before the start, when its gates have a capacity per hour.', min: { events: MINIMUMS.min_test_events_crowd } },
];

export const WARN = { shadowErrorShare: 0.05, jobsStaleMs: 45 * 60_000, firstRunGraceMs: 20 * 60_000 };
const HEALTH_CACHE_MS = 30_000;
// Row counts scan the whole prediction log (~1.4 s at 2,000,000 rows) and the recommendation counts the
// behaviour log: both cached for 60 s per process
export const COUNTS_CACHE_MS = 60_000;
let healthCache = { at: 0, value: null };
let countsCache = {}; // key -> { at, value }
const cached = async (key, fn) => {
  const hit = countsCache[key];
  if (hit && Date.now() - hit.at < COUNTS_CACHE_MS) return hit.value;
  const value = await fn();
  countsCache[key] = { at: Date.now(), value };
  return value;
};
let deps = { db: prisma, get: mlGet, now: () => new Date() };
export const __setMonitorDeps = (d) => { deps = d ? { ...deps, ...d } : { db: prisma, get: mlGet, now: () => new Date() }; healthCache = { at: 0, value: null }; countsCache = {}; };

/** The ML service's own health (cached 30 s). Never throws. */
export async function mlServiceHealth() {
  const now = Date.now();
  if (healthCache.value && now - healthCache.at < HEALTH_CACHE_MS) return healthCache.value;
  let value;
  try {
    const h = await deps.get('/v2/health', { timeoutMs: 1500 });
    value = { reachable: true, ...h };
  } catch (e) {
    value = { reachable: false, reason: e.name === 'TimeoutError' ? 'timeout' : e.status ? `status ${e.status}` : 'unreachable' };
  }
  healthCache = { at: now, value };
  return value;
}

async function rowCounts(db, since) {
  const rows = await db.$queryRaw`
    SELECT "modelName" AS model, role::text AS role,
           count(*)::int AS total,
           count(*) FILTER (WHERE "createdAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC'))::int AS last_24h,
           count(*) FILTER (WHERE role = 'SHADOW' AND score IS NOT NULL AND (output->>'error') IS NULL AND (output->>'skipped') IS NULL)::int AS predicted,
           count(*) FILTER (WHERE role = 'SHADOW' AND (output->>'skipped') IS NOT NULL)::int AS skipped,
           count(*) FILTER (WHERE role = 'SHADOW' AND (output->>'error') IS NOT NULL)::int AS errors,
           count(*) FILTER (WHERE role = 'SHADOW' AND (output->>'error') IS NOT NULL AND "createdAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC'))::int AS errors_24h,
           max("createdAt") AS last_at
    FROM "MlPrediction" GROUP BY 1, 2`;
  const reasons = await db.$queryRaw`
    SELECT "modelName" AS model, coalesce(output->>'error', output->>'skipped') AS reason, count(*)::int AS n
    FROM "MlPrediction" WHERE role = 'SHADOW' AND ((output->>'error') IS NOT NULL OR (output->>'skipped') IS NOT NULL)
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40`;
  return { rows, reasons };
}

async function recommendationCounts(db) {
  const rows = await db.$queryRaw`
    SELECT action, coalesce(metadata->>'variant', 'UNKNOWN') AS variant, count(*)::int AS events
    FROM "BehaviorEvent" WHERE action IN ('recommendation_impression', 'recommendation_rendered', 'recommendation_click')
    GROUP BY 1, 2`;
  // One impression row per served list (written once) and one rendered row per list (de-duplicated when written),
  // so plain counts are list counts: no DISTINCT over the JSON (7 s at 600,000 rows, measured)
  const v = (variant) => {
    const get = (action) => rows.find((r) => r.action === action && r.variant === variant)?.events ?? 0;
    return { served_lists: get('recommendation_impression'), rendered_lists: get('recommendation_rendered'), clicks: get('recommendation_click') };
  };
  const control = v('CONTROL');
  const personalised = v('PERSONALISED');
  const enough = control.rendered_lists >= REC_MIN_IMPRESSIONS && personalised.rendered_lists >= REC_MIN_IMPRESSIONS;
  return {
    feature: 'E', title: 'Recommendations (rules; control vs personalised)',
    control, personalised,
    evaluation: {
      status: control.rendered_lists + personalised.rendered_lists === 0 ? 'NO_DATA' : enough ? 'MINIMUMS_REACHED_EVALUATE_OFFLINE' : 'NOT_ENOUGH_DATA',
      minimum_rendered_lists_per_group: REC_MIN_IMPRESSIONS,
      metrics: null,
      note: 'Counts only. Click-through and purchase uplift are measured offline (recommendation_report) on genuine customers.',
    },
  };
}

export async function monitorSnapshot() {
  const { db } = deps;
  const now = deps.now();
  const since = new Date(now.getTime() - 24 * 3600_000);
  const flags = mlFlags();
  const [models, counts, recs, health, outcomes] = await Promise.all([
    db.mlModel.findMany({ where: { status: { in: ['SHADOW', 'READY', 'ACTIVE'] } }, orderBy: { registeredAt: 'desc' } }),
    cached('rows', () => rowCounts(db, since)),
    cached('recs', () => recommendationCounts(db)),
    mlServiceHealth(),
    Promise.all(MONITORED.map((m) => outcomeCounts(m.name, db))),
  ]);
  const warnings = [];
  const perModel = MONITORED.map((m, i) => {
    const model = models.find((x) => x.name === m.name) || null;
    const rules = counts.rows.find((r) => r.model === m.name && r.role === 'RULES') || null;
    const shadow = counts.rows.find((r) => r.model === m.name && r.role === 'SHADOW') || null;
    const block = modelBlock(m.name, model);
    if (model && model.status !== 'SHADOW') warnings.push({ level: 'error', model: m.name, message: `Model status is ${model.status}: no promotion path exists; it must stay SHADOW.` });
    if (model && model.mayServeDecisions) warnings.push({ level: 'error', model: m.name, message: 'mayServeDecisions is true in the registry row; models must never serve decisions.' });
    const shadow24 = shadow ? shadow.last_24h : 0;
    if (shadow && shadow24 >= 20 && shadow.errors_24h / shadow24 > WARN.shadowErrorShare) {
      warnings.push({ level: 'warning', model: m.name, message: `${Math.round((shadow.errors_24h / shadow24) * 100)}% of shadow calls failed in the last 24 h.` });
    }
    const artifact = health.reachable ? (health.models || []).find((x) => x.name === m.name) : null;
    if (model && artifact && artifact.sha256 && artifact.sha256 !== model.sha256) warnings.push({ level: 'error', model: m.name, message: 'The ML service registry has a different artifact than the registered model (fingerprint mismatch): shadow calls will be refused.' });
    if (model && artifact && artifact.fingerprint_ok === false) warnings.push({ level: 'error', model: m.name, message: `Artifact check failed in the ML service: ${artifact.problem || 'fingerprint'}.` });
    return {
      ...m,
      registered: { ...block, registered_at: model?.registeredAt ?? null },
      // The offline test the model went through before it was registered: model vs the current rule, same data
      offline_result: model?.evaluation && typeof model.evaluation === 'object' && model.evaluation.main_measure ? {
        measure: model.evaluation.main_measure,
        higher_is_better: model.evaluation.higher_is_better !== false,
        model: model.evaluation.model,
        rule: model.evaluation.baseline,
        improvement: model.evaluation.improvement,
        improvement_95ci: model.evaluation.improvement_95ci || null,
        reasons: model.evaluation.reasons || [],
        status: model.evaluationStatus,
      } : null,
      artifact_in_ml_service: artifact,
      rows: {
        rules: rules ? { total: rules.total, last_24h: rules.last_24h, last_at: rules.last_at } : { total: 0, last_24h: 0, last_at: null },
        shadow: shadow ? { total: shadow.total, last_24h: shadow.last_24h, predicted: shadow.predicted, skipped: shadow.skipped, errors: shadow.errors, errors_24h: shadow.errors_24h, last_at: shadow.last_at } : { total: 0, last_24h: 0, predicted: 0, skipped: 0, errors: 0, errors_24h: 0, last_at: null },
        reasons: counts.reasons.filter((r) => r.model === m.name).slice(0, 5).map((r) => ({ reason: String(r.reason).slice(0, 160), count: r.n })),
      },
      evaluation: evaluationBlock(outcomes[i], m.min), // fraud: positives = confirmed frauds (blind reviews)
    };
  });

  // Background jobs (this API process)
  const uptime = now.getTime() - jobStatus.processStartedAt.getTime();
  if (flags.snapshots || flags.shadow) {
    if (!jobStatus.lastFinishedAt && uptime > WARN.firstRunGraceMs) warnings.push({ level: 'warning', message: 'The ML background jobs have not finished a run since this server started.' });
    if (jobStatus.lastFinishedAt && now - jobStatus.lastFinishedAt > WARN.jobsStaleMs) warnings.push({ level: 'warning', message: `The ML background jobs last finished ${Math.round((now - jobStatus.lastFinishedAt) / 60_000)} minutes ago (expected every 15).` });
    if (jobStatus.failedSteps.length) warnings.push({ level: 'warning', message: `Last job run had failing steps: ${jobStatus.failedSteps.join(', ')}.` });
  }
  if (!health.reachable) warnings.push({ level: 'warning', message: `ML service ${health.reason}: the rules keep answering; shadow predictions are logged as errors until it is back.` });

  return {
    decision_source: 'rules',
    generated_at: now.toISOString(),
    flags,
    ml_service: health,
    jobs: {
      process_started_at: jobStatus.processStartedAt, last_started_at: jobStatus.lastStartedAt, last_finished_at: jobStatus.lastFinishedAt,
      runs: jobStatus.runs, failed_steps: jobStatus.failedSteps, interval_minutes: 15, note: 'Per API process.',
    },
    models: perModel,
    recommendations: recs,
    behaviour: { feature: 'D', title: 'Customer behaviour', note: 'Reports only (no model). See the behaviour page.' },
    genuine_use_from: process.env.ML_GENUINE_FROM || null,
    warnings,
  };
}
