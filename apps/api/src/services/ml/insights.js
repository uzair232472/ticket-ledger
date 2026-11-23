/**
 * Step 6: READ-ONLY AI insights for staff screens. Rules decide everything; nothing here is read by checkout,
 * payments, refunds, tickets, gates, pricing or accounts (test_ml_step6_unit.mjs checks the imports).
 *
 * Every answer has the same shape (`envelope`):
 *   decision_source  always 'rules'
 *   rules            what the app uses (or the rule's logged values)
 *   experimental     the registered shadow model's view, aggregated: status, may_serve_decisions:false,
 *                    validated:false, source, version, fingerprint; or `unavailable_reason`
 *   evaluation       logged outcome COUNTS against the approval-gate minimums (apps/ml-service/ml/gates.py).
 *                    No accuracy or performance figure is computed here: rows include internal / test activity,
 *                    and the only evaluation is the offline one on genuine exports (ml.evaluate / auto_retrain.py).
 *
 * Aggregates only: no answer contains an individual customer's score, prediction or identity.
 * Model values come from rows already logged by the shadow jobs; the only live model call is the demand
 * reading (a few rows in one call, never stored, never applied).
 */
import prisma from '../../config/prisma.js';
import { mlPost } from '../mlService.js';
import { prelaunchEstimate, tiersWithPrices } from '../demandRules.js';
import { demandSnapshot, LIVE_TICKET, MissingInput, endOf, startOf } from './features.js';
import { showRate } from './attendanceBaseline.js';
import { SLOTS, crowdReadiness, crowdRows, parseSlotSubject } from './crowd.js';
import { SOLD } from './visits.js';

// Minimum test-period sizes from apps/ml-service/ml/gates.py (parity checked in test_ml_step6_unit.mjs)
export const MINIMUMS = {
  min_test_positives: 100,
  min_test_negatives: 100,
  min_test_frauds: 50,
  min_test_events_demand: 100,
  min_test_events_attendance: 30,
  min_test_events_crowd: 30,
  min_test_events_demand_hourly: 30,
};
// Display threshold for recommendation counts (apps/ml-service/ml/insights.py REC_MIN)
export const REC_MIN_IMPRESSIONS = 1000;

const WHAT_IF_TIMEOUT_MS = Number(process.env.ML_WHAT_IF_TIMEOUT_MS) || 1500;
const EVALUATION_NOTE = 'Counts of logged outcomes only. They include internal and test activity. Accuracy is never computed in the app: models are evaluated offline on genuine-customer exports once the minimums are met.';

export function envelope(feature, { rules, experimental, evaluation, notes = [] }) {
  return { feature, decision_source: 'rules', rules, experimental, evaluation, notes, generated_at: new Date().toISOString() };
}

/** The current SHADOW model of a name (the only status the shadow jobs use). */
export async function shadowModelOf(name, db = prisma) {
  return db.mlModel.findFirst({ where: { name, status: 'SHADOW' }, orderBy: { registeredAt: 'desc' } });
}

/** The experimental block's fixed part. `may_serve_decisions` and `validated` are always false. */
export function modelBlock(name, model) {
  return {
    model: name,
    status: model?.status ?? null,
    may_serve_decisions: false,
    validated: false,
    version: model?.version ?? null,
    source: model?.source ?? null,
    sha256_12: model?.sha256 ? model.sha256.slice(0, 12) : null,
    offline_evaluation: model?.evaluationStatus ?? null,
    offline_note: model
      ? (String(model.source).startsWith('synthetic')
        ? `Trained and checked offline on synthetic data only (${model.evaluationStatus}). Not validated on real outcomes.`
        : `Offline evaluation: ${model.evaluationStatus}. Shadow only.`)
      : null,
    value: null,
    unavailable_reason: model ? null : 'NO_MODEL_REGISTERED',
  };
}

/** Status of a set of SHADOW rows: predictions made, skipped (missing inputs) and failed calls, with reasons. */
export function shadowRowStats(rows) {
  const out = { rows: rows.length, predicted: 0, skipped: 0, errors: 0, reasons: {} };
  for (const r of rows) {
    if (r.output?.error) { out.errors += 1; out.reasons[r.output.error] = (out.reasons[r.output.error] || 0) + 1; } else if (r.output?.skipped) { out.skipped += 1; out.reasons[r.output.skipped] = (out.reasons[r.output.skipped] || 0) + 1; } else if (r.score !== null && r.score !== undefined) out.predicted += 1;
  }
  out.reasons = Object.entries(out.reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason: String(reason).slice(0, 160), count }));
  return out;
}

const PROB_BANDS = [['under_25', 0, 0.25], ['25_to_50', 0.25, 0.5], ['50_to_75', 0.5, 0.75], ['75_and_over', 0.75, 1.0001]];
export function probabilityBands(values) {
  const bands = Object.fromEntries(PROB_BANDS.map(([k]) => [k, 0]));
  for (const v of values) { const b = PROB_BANDS.find(([, lo, hi]) => v >= lo && v < hi); if (b) bands[b[0]] += 1; }
  return bands;
}
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);

/** Outcome counts vs the minimums. status: NO_OUTCOMES_YET | NOT_ENOUGH_DATA | MINIMUMS_REACHED_EVALUATE_OFFLINE. */
export function evaluationBlock(counts, required) {
  const total = counts.with_outcome ?? 0;
  const short = Object.entries(required).filter(([k, need]) => (counts[k] ?? 0) < need).map(([k, need]) => ({ measure: k, have: counts[k] ?? 0, need }));
  return {
    status: total === 0 ? 'NO_OUTCOMES_YET' : short.length ? 'NOT_ENOUGH_DATA' : 'MINIMUMS_REACHED_EVALUATE_OFFLINE',
    logged_outcomes: counts,
    minimums: required,
    short_of: short,
    metrics: null, // never computed in the app (see EVALUATION_NOTE)
    note: EVALUATION_NOTE,
  };
}

/**
 * Model-wide logged outcomes (the minimums apply to a model's whole test period, not to one event):
 * rows with a label, positives (label 1), negatives (label 0) and events with any outcome. For count models
 * (demand, crowd) only `with_outcome` and `events` are meaningful.
 */
// Outcomes change only when the 15-minute job attaches them, so model-wide counts are cached for 5 minutes per
// process: measured at 2,000,000 prediction rows the count takes ~0.8 s per model (docs/ml-step6-integration.md).
export const OUTCOME_CACHE_MS = 5 * 60_000;
const outcomeCache = new Map(); // modelName -> { at, value }
export const clearInsightCaches = () => outcomeCache.clear();

export async function outcomeCounts(modelName, db = prisma) {
  const hit = outcomeCache.get(modelName);
  if (db === prisma && hit && Date.now() - hit.at < OUTCOME_CACHE_MS) return hit.value;
  const value = await countOutcomes(modelName, db);
  if (db === prisma) outcomeCache.set(modelName, { at: Date.now(), value });
  return value;
}

async function countOutcomes(modelName, db) {
  const [r] = await db.$queryRaw`
    SELECT count(*) FILTER (WHERE "outcomeLabel" IS NOT NULL)::int AS with_outcome,
           count(*) FILTER (WHERE "outcomeLabel" = 1)::int AS positives,
           count(*) FILTER (WHERE "outcomeLabel" = 0)::int AS negatives,
           count(DISTINCT "eventId")::int AS events
    FROM "MlPrediction" WHERE "modelName" = ${modelName} AND role = 'RULES' AND "outcomeAt" IS NOT NULL`; // index (modelName, outcomeAt)
  return { with_outcome: r?.with_outcome ?? 0, positives: r?.positives ?? 0, negatives: r?.negatives ?? 0, events: r?.events ?? 0 };
}
const BINARY_MIN = { positives: MINIMUMS.min_test_positives, negatives: MINIMUMS.min_test_negatives };

async function pairs(db, modelName, where) {
  const sel = { subjectId: true, score: true, decision: true, output: true, outcomeLabel: true, outcomeAt: true, asOf: true, createdAt: true };
  const [rules, shadow] = await Promise.all([
    db.mlPrediction.findMany({ where: { modelName, role: 'RULES', ...where }, select: sel }),
    db.mlPrediction.findMany({ where: { modelName, role: 'SHADOW', ...where }, select: sel }),
  ]);
  return { rules, shadow };
}

// ---------------------------------------------------------------------------------------------
// A. Purchase intent (per event, aggregates)
// ---------------------------------------------------------------------------------------------
export async function intentInsight(eventId, db = prisma) {
  const { rules, shadow } = await pairs(db, 'intent', { subjectType: 'VISIT', eventId });
  const byDecision = { HIGH: 0, MODERATE: 0, LOW: 0 };
  for (const r of rules) if (r.decision in byDecision) byDecision[r.decision] += 1;
  const model = await shadowModelOf('intent', db);
  const experimental = modelBlock('intent', model);
  if (model) {
    const stats = shadowRowStats(shadow);
    const probs = shadow.filter((s) => s.score !== null && !s.output?.error && !s.output?.skipped).map((s) => s.score);
    // Descriptive only: how often the model's 50% line and the rule's HIGH level point the same way
    const ruleHigh = new Map(rules.map((r) => [r.subjectId, r.decision === 'HIGH']));
    const paired = shadow.filter((s) => ruleHigh.has(s.subjectId) && s.score !== null && !s.output?.error);
    experimental.value = {
      ...stats,
      mean_probability: mean(probs),
      probability_bands: probabilityBands(probs),
      same_direction_as_rule: paired.length ? { visits: paired.length, share: Math.round((paired.filter((s) => (s.score >= 0.5) === ruleHigh.get(s.subjectId)).length / paired.length) * 1000) / 1000 } : null,
    };
    if (!shadow.length) experimental.unavailable_reason = 'NO_SHADOW_PREDICTIONS_YET';
  }
  return envelope('intent', {
    rules: { visits_scored: rules.length, by_level: byDecision, mean_rule_score: mean(rules.map((r) => r.score).filter((x) => x !== null)), rule: '40 + 15 (3+ views) + 20 (seat chosen) + 25 (checkout started), 10 to 99' },
    experimental,
    evaluation: evaluationBlock(await outcomeCounts('intent', db), BINARY_MIN),
    notes: ['Visits are scored by the background job after they end (every 15 minutes). The intent page and reminders use the rule only.'],
  });
}

// ---------------------------------------------------------------------------------------------
// B. Abandoned checkout (per event, aggregates)
// ---------------------------------------------------------------------------------------------
export async function abandonmentInsight(eventId, db = prisma) {
  const { rules, shadow } = await pairs(db, 'abandonment', { subjectType: 'VISIT', eventId });
  const checkouts = await db.mlPrediction.findMany({ where: { modelName: 'checkout_abandonment', role: 'RULES', subjectType: 'ORDER', eventId }, select: { outcomeLabel: true, outcomeAt: true } });
  const model = await shadowModelOf('abandonment', db);
  const experimental = modelBlock('abandonment', model);
  if (model) {
    const probs = shadow.filter((s) => s.score !== null && !s.output?.error && !s.output?.skipped).map((s) => s.score);
    experimental.value = { ...shadowRowStats(shadow), mean_probability: mean(probs), probability_bands: probabilityBands(probs) };
    if (!shadow.length) experimental.unavailable_reason = 'NO_SHADOW_PREDICTIONS_YET';
  }
  return envelope('abandonment', {
    rules: {
      checkout_visits_scored: rules.length,
      mean_rule_score: mean(rules.map((r) => r.score).filter((x) => x !== null)),
      checkout_snapshots: checkouts.length,
      checkout_outcomes: { abandoned: checkouts.filter((c) => c.outcomeLabel === 1).length, completed: checkouts.filter((c) => c.outcomeLabel === 0).length, not_labelled: checkouts.filter((c) => c.outcomeAt && c.outcomeLabel === null).length },
      rule: '100 minus the visit intent rule score. Reminders and recovery codes are sent only by the organizer or the existing recovery rules.',
    },
    experimental,
    evaluation: evaluationBlock(await outcomeCounts('abandonment', db), BINARY_MIN),
    notes: ['The checkout-start abandonment model (agreed label) has no model yet: rules and outcomes are logged only.'],
  });
}

// ---------------------------------------------------------------------------------------------
// C. Fraud (platform-wide aggregates, SUPER_ADMIN only; never shown to reviewers)
// ---------------------------------------------------------------------------------------------
export async function fraudInsight(db = prisma) {
  const [ruleGroups, shadowGroups, cells, reviews, blocks, counts] = await Promise.all([
    db.mlPrediction.groupBy({ by: ['subjectType', 'decision'], where: { modelName: 'fraud', role: 'RULES' }, _count: { _all: true } }),
    db.mlPrediction.findMany({ where: { modelName: 'fraud', role: 'SHADOW' }, select: { score: true, decision: true, output: true } }),
    db.fraudSample.groupBy({ by: ['cell', 'selected'], _count: { _all: true } }),
    db.fraudReview.groupBy({ by: ['decision', 'blind'], _count: { _all: true } }),
    db.auditLog.count({ where: { action: 'CHECKOUT_BLOCKED_SCALPER_BOT' } }),
    outcomeCounts('fraud', db),
  ]);
  const rules = { by_decision: {}, checkout_blocks: blocks, rule: 'Checkout security rules (speed, click rate, seat-lock attempts); CRITICAL_BOT blocks the checkout' };
  for (const g of ruleGroups) {
    const k = `${g.subjectType}:${g.decision ?? 'NONE'}`;
    rules.by_decision[k] = g._count._all;
  }
  const model = await shadowModelOf('fraud', db);
  const experimental = modelBlock('fraud', model);
  if (model) {
    experimental.value = {
      ...shadowRowStats(shadowGroups),
      would_flag: shadowGroups.filter((s) => s.decision === 'WOULD_FLAG').length,
      would_not_flag: shadowGroups.filter((s) => s.decision === 'WOULD_NOT_FLAG').length,
      kept_in_shadow_because: model.shadowDecision ?? null,
    };
  }
  return envelope('fraud', {
    rules,
    experimental,
    evaluation: evaluationBlock(
      { with_outcome: counts.with_outcome, frauds: counts.positives, negatives: counts.negatives },
      { frauds: MINIMUMS.min_test_frauds, negatives: MINIMUMS.min_test_negatives },
    ),
    notes: [
      'Blind review sampling (counts only): ' + JSON.stringify(cells.map((c) => ({ cell: c.cell, selected: c.selected, orders: c._count._all }))),
      'Reviews by decision: ' + JSON.stringify(reviews.map((r) => ({ decision: r.decision, blind: r.blind, reviews: r._count._all }))),
      'Reviewers never see this page, any score or which detector picked an order.',
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// D. Customer behaviour (platform-wide description; no model, no individual scores)
// ---------------------------------------------------------------------------------------------
export async function behaviourInsight(db = prisma, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [customers, buyers, actions, categories] = await Promise.all([
    db.user.count({ where: { role: 'CUSTOMER' } }),
    db.$queryRaw`
      SELECT n, count(*)::int AS customers FROM (
        SELECT o."userId", count(*)::int AS n FROM "Order" o JOIN "User" u ON u.id = o."userId"
        WHERE u.role = 'CUSTOMER' AND o.status::text = ANY(${SOLD}) GROUP BY o."userId") t
      GROUP BY n ORDER BY n`,
    db.behaviorEvent.groupBy({ by: ['action'], where: { createdAt: { gte: since, lt: now } }, _count: { _all: true }, orderBy: { _count: { action: 'desc' } }, take: 12 }),
    db.$queryRaw`
      SELECT e.type::text AS category, count(*)::int AS views FROM "BehaviorEvent" b JOIN "Event" e ON e.id = b."eventId"
      WHERE b.action = 'event_view' AND b."createdAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
  ]);
  const buyerCount = buyers.reduce((a, r) => a + r.customers, 0);
  const returning = buyers.filter((r) => r.n >= 2).reduce((a, r) => a + r.customers, 0);
  const orders = buyers.reduce((a, r) => a + r.n * r.customers, 0);
  return envelope('behaviour', {
    rules: {
      customers,
      buyers: buyerCount,
      first_time_buyers: buyerCount - returning,
      returning_buyers: returning,
      orders_per_buyer: buyerCount ? Math.round((orders / buyerCount) * 100) / 100 : null,
      activity_last_30_days: actions.map((a) => ({ action: a.action, events: a._count._all })),
      categories_viewed_last_30_days: categories,
    },
    experimental: { ...modelBlock('behaviour', null), unavailable_reason: 'NO_MODEL_FOR_FEATURE' },
    evaluation: { status: 'DESCRIPTIVE_ONLY', metrics: null, note: 'A description of logged activity (all accounts, including internal and test). Genuine-customer reports come from the offline export (behaviour_report).' },
    notes: [`Genuine use start: ${process.env.ML_GENUINE_FROM || 'not set (no genuine customers yet)'}.`],
  });
}

// ---------------------------------------------------------------------------------------------
// F. Demand (per event; optional what-if that is never stored or applied)
// ---------------------------------------------------------------------------------------------
async function eventForDemand(db, eventId) {
  return db.event.findUnique({ where: { id: eventId }, include: { tiers: { orderBy: { price: 'asc' } } } });
}

export async function demandInsight(eventId, { whatIf = null, db = prisma, post = mlPost } = {}) {
  const event = await eventForDemand(db, eventId);
  if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
  const rule = prelaunchEstimate(event, { tiers: whatIf?.price ? tiersWithPrices(event.tiers, { scalePrice: whatIf.price }) : event.tiers });
  const [logged, hourly] = await Promise.all([
    db.mlPrediction.findMany({ where: { modelName: 'demand', eventId, subjectType: { in: ['EVENT_FORECAST', 'EVENT_AT_SALES_OPEN'] } }, select: { role: true, subjectType: true, score: true, output: true, asOf: true, outcomeLabel: true, outcomeAt: true }, orderBy: { asOf: 'desc' } }),
    db.mlPrediction.findFirst({ where: { modelName: 'demand_hourly', role: 'RULES', eventId }, select: { score: true, asOf: true }, orderBy: { asOf: 'desc' } }),
  ]);
  const model = await shadowModelOf('demand', db);
  const experimental = modelBlock('demand', model);
  if (model) {
    const latest = logged.find((r) => r.role === 'SHADOW');
    const latestOk = latest && !latest.output?.error && !latest.output?.skipped
      ? { sales_48h: latest.output.sales_48h, low: latest.output.low, high: latest.output.high, as_of: latest.asOf, moment: latest.subjectType }
      : null;
    // A live reading of the model for the saved prices (never stored, never applied), with what moves it.
    // Shown even when no logged prediction exists yet (first visit, or the day's logged call failed).
    const live = await demandLive(event, model, whatIf, post);
    experimental.value = {
      latest_logged: latestOk,
      logged: shadowRowStats(logged.filter((r) => r.role === 'SHADOW')),
      current: live.current,
      sensitivity: live.sensitivity,
      what_if: live.what_if,
    };
    if (!latestOk && !live.current) {
      experimental.unavailable_reason = live.unavailable_reason
        || (!latest ? 'NO_SHADOW_PREDICTIONS_YET' : latest.output?.error ? 'SHADOW_CALL_FAILED' : 'INPUTS_MISSING');
    }
  }
  return envelope('demand', {
    rules: {
      projected_48h_sales: rule.projected_48h_sales, sellout_probability: rule.sellout_probability, demand_tier: rule.demand_tier,
      capacity: rule.capacity, notice: rule.notice, what_if: Boolean(whatIf),
      latest_hourly_pace: hourly ? { sold_last_24h: hourly.score, as_of: hourly.asOf } : null,
    },
    experimental,
    evaluation: evaluationBlock(await outcomeCounts('demand', db), { events: MINIMUMS.min_test_events_demand }),
    notes: ['The model is called live on request only: its answers here are not saved, and they never change prices or publish the event.'],
  });
}

const PRICE_COLS = ['min_price_rel', 'avg_price_rel', 'max_price_rel'];
const scalePrices = (f, k) => { const g = { ...f }; for (const c of PRICE_COLS) g[c] = Math.round(f[c] * k * 10000) / 10000; return g; };

/**
 * One live shadow call (several rows in one request): the model at the saved inputs, the same with prices
 * -20% / +20% and on the other kind of day (what moves its number), and the organizer's what-if when given.
 * Nothing is stored or applied.
 */
export async function demandLive(event, model, whatIf, post = mlPost) {
  let snap;
  try {
    snap = await demandSnapshot({ eventId: event.id, at: new Date() });
  } catch (e) {
    const reason = e instanceof MissingInput ? `INPUTS_MISSING: ${e.message}` : 'INPUTS_ERROR';
    return { current: null, sensitivity: null, what_if: whatIf ? { unavailable_reason: reason } : null, unavailable_reason: reason };
  }
  const f = snap.features;
  const weekend = ['Friday', 'Saturday', 'Sunday'].includes(f.day_of_week);
  const rows = [
    { key: 'current', f },
    { key: 'price_down', f: scalePrices(f, 0.8), label: 'Prices 20% lower' },
    { key: 'price_up', f: scalePrices(f, 1.2), label: 'Prices 20% higher' },
    { key: 'day', f: { ...f, day_of_week: weekend ? 'Wednesday' : 'Saturday' }, label: weekend ? 'On a weekday (Wednesday)' : 'On a weekend (Saturday)' },
  ];
  let changed = [];
  if (whatIf) {
    let w = f;
    if (whatIf.price > 0 && snap.context.avg_price > 0) { w = scalePrices(w, whatIf.price / snap.context.avg_price); changed.push('price'); }
    if (whatIf.capacity > 0) { w = { ...w, venue_capacity: Math.trunc(whatIf.capacity) }; changed.push('capacity'); }
    rows.push({ key: 'what_if', f: w });
  }
  try {
    const r = await post(`/v2/shadow/${model.name}`, { sha256: model.sha256, rows: rows.map((x) => x.f) }, { timeoutMs: WHAT_IF_TIMEOUT_MS });
    const preds = r.predictions || [];
    if (r.may_serve_decisions !== false || preds.length !== rows.length) {
      return { current: null, sensitivity: null, what_if: whatIf ? { unavailable_reason: 'UNEXPECTED_RESPONSE' } : null, unavailable_reason: 'UNEXPECTED_RESPONSE' };
    }
    const at = (key) => preds[rows.findIndex((x) => x.key === key)];
    const cur = at('current');
    const current = { sales_48h: cur.sales_48h, low: cur.low, high: cur.high, capacity: f.venue_capacity, stored: false, applied: false };
    const sensitivity = rows.filter((x) => x.label).map((x) => {
      const p = at(x.key);
      return { key: x.key, label: x.label, sales_48h: p.sales_48h, change: Math.round((p.sales_48h - cur.sales_48h) * 10) / 10 };
    });
    const wp = whatIf ? at('what_if') : null;
    return {
      current, sensitivity,
      what_if: wp ? { sales_48h: wp.sales_48h, low: wp.low, high: wp.high, inputs_changed: changed, stored: false, applied: false } : null,
    };
  } catch (e) {
    const reason = e.name === 'TimeoutError' ? 'TIMEOUT' : e.status === 409 ? 'ARTIFACT_MISMATCH' : 'ML_SERVICE_UNAVAILABLE';
    return { current: null, sensitivity: null, what_if: whatIf ? { unavailable_reason: reason } : null, unavailable_reason: reason };
  }
}

/** One live shadow call with the organizer's what-if price / capacity. Never stored, never applied. */
export async function demandWhatIf(event, model, whatIf, post = mlPost) {
  let snap;
  try {
    snap = await demandSnapshot({ eventId: event.id, at: new Date() });
  } catch (e) {
    return { unavailable_reason: e instanceof MissingInput ? `INPUTS_MISSING: ${e.message}` : 'INPUTS_ERROR' };
  }
  const f = { ...snap.features };
  const changed = [];
  if (whatIf.price > 0 && snap.context.avg_price > 0) {
    const k = whatIf.price / snap.context.avg_price;
    for (const c of PRICE_COLS) f[c] = Math.round(f[c] * k * 10000) / 10000;
    changed.push('price');
  }
  if (whatIf.capacity > 0) { f.venue_capacity = Math.trunc(whatIf.capacity); changed.push('capacity'); }
  try {
    const r = await post(`/v2/shadow/${model.name}`, { sha256: model.sha256, rows: [f] }, { timeoutMs: WHAT_IF_TIMEOUT_MS });
    const p = r.predictions?.[0];
    if (r.may_serve_decisions !== false || !p) return { unavailable_reason: 'UNEXPECTED_RESPONSE' };
    return { sales_48h: p.sales_48h, low: p.low, high: p.high, inputs_changed: changed, stored: false, applied: false };
  } catch (e) {
    return { unavailable_reason: e.name === 'TimeoutError' ? 'TIMEOUT' : e.status === 409 ? 'ARTIFACT_MISMATCH' : 'ML_SERVICE_UNAVAILABLE' };
  }
}

// ---------------------------------------------------------------------------------------------
// G. Attendance (per event)
// ---------------------------------------------------------------------------------------------
export async function attendanceInsight(eventId, { db = prisma, now = new Date() } = {}) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, type: true, city: true, date: true, time: true, startsAt: true, endsAt: true } });
  if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
  const [live, checkedIn, rows] = await Promise.all([
    db.ticket.count({ where: { eventId, status: { in: LIVE_TICKET } } }),
    db.ticket.count({ where: { eventId, checkedInAt: { not: null } } }),
    db.mlPrediction.findMany({ where: { modelName: 'attendance', role: 'RULES', eventId }, select: { score: true, asOf: true, outcomeLabel: true, outcomeAt: true } }),
  ]);
  const rate = await showRate(event, now);
  const ended = endOf(event) <= now;
  const snapshot = rows.length ? {
    as_of: rows[0].asOf, tickets: rows.length, expected_attendance: Math.round(rows.reduce((a, r) => a + (r.score ?? 0), 0)),
    actual_attended: rows.some((r) => r.outcomeAt) ? rows.filter((r) => r.outcomeLabel === 1).length : null,
  } : null;
  const model = await shadowModelOf('attendance', db);
  const experimental = modelBlock('attendance', model);
  return envelope('attendance', {
    rules: {
      live_tickets: live, checked_in_so_far: checkedIn, show_rate_percent: rate.rate, basis: rate.basis, factors: rate.factors,
      expected_attendance: Math.round((live * rate.rate) / 100), event_ended: ended, snapshot_24h_before: snapshot,
    },
    experimental,
    evaluation: evaluationBlock(await outcomeCounts('attendance', db), { ...BINARY_MIN, events: MINIMUMS.min_test_events_attendance }),
    notes: ['Gate admission never uses this estimate.'],
  });
}

// ---------------------------------------------------------------------------------------------
// H. Crowd flow (per event, per gate x 5-minute slot)
// ---------------------------------------------------------------------------------------------
export async function crowdInsight(eventId, { db = prisma, now = new Date() } = {}) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, date: true, time: true, startsAt: true, gates: { select: { id: true, name: true, active: true, capacityPerHour: true } } } });
  if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
  const readiness = crowdReadiness(event.gates);
  const { rules: ruleRows, shadow } = await pairs(db, 'crowd', { subjectType: 'GATE_SLOT', eventId });
  const gateName = new Map(event.gates.map((g) => [g.id, g.name]));
  const series = new Map(); // gateId -> minutes -> {rule, model, actual}
  const cell = (gateId, minutes) => {
    if (!series.has(gateId)) series.set(gateId, new Map(SLOTS.map((m) => [m, { minutes: m, rule: null, model: null, actual: null }])));
    return series.get(gateId).get(minutes);
  };
  for (const r of ruleRows) {
    const { gateId, minutes } = parseSlotSubject(r.subjectId);
    const c = cell(gateId, minutes);
    if (!c) continue;
    c.rule = r.score === null ? null : Math.round(r.score * 10) / 10;
    if (r.outcomeAt) c.actual = r.outcomeLabel;
  }
  let liveRule = false;
  if (!ruleRows.length && readiness.ready && startOf(event) > now) {
    // Not logged yet (the job logs 30 min - 26 h before the start): show the rule baseline computed now
    try {
      for (const r of await crowdRows({ eventId, at: now })) cell(r.gateId, r.minutes).rule = Math.round(r.baseline * 10) / 10;
      liveRule = true;
    } catch (e) {
      if (!(e instanceof MissingInput)) throw e;
    }
  }
  const model = await shadowModelOf('crowd', db);
  const experimental = modelBlock('crowd', model);
  if (model) {
    for (const s of shadow) {
      if (s.output?.error || s.output?.skipped || s.score === null) continue;
      const { gateId, minutes } = parseSlotSubject(s.subjectId);
      const c = cell(gateId, minutes);
      if (c) c.model = Math.round(s.score * 10) / 10;
    }
    experimental.value = shadowRowStats(shadow);
    if (!shadow.length) experimental.unavailable_reason = 'NO_SHADOW_PREDICTIONS_YET';
  }
  const gates = [...series.entries()].map(([gateId, m]) => ({ gate_id: gateId, gate: gateName.get(gateId) || 'Gate', slots: [...m.values()] }));
  return envelope('crowd', {
    rules: { readiness, logged_at: ruleRows[0]?.asOf ?? null, computed_now: liveRule, gates, slot_minutes: 5, rule: 'tickets sold x show rate x arrival curve x gate capacity share' },
    experimental,
    evaluation: evaluationBlock(await outcomeCounts('crowd', db), { events: MINIMUMS.min_test_events_crowd }),
    notes: ['The gate scanner, admission and staffing never use these numbers.'],
  });
}
