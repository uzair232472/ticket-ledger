/**
 * Shadow mode. Rules make every decision. This module only LOGS:
 *   - a RULES row: what the app decided or showed (score + decision), and
 *   - a SHADOW row: what the registered shadow model would have said, with the exact inputs used.
 * outcomes.js later attaches the real outcome to both rows.
 *
 * Guarantees:
 *   - recordShadow() returns immediately; the work runs on a later tick and never throws into the caller;
 *   - nothing here is read by any decision path (checkout, payment, tickets, gates);
 *   - missing inputs are not invented: the SHADOW row is written as skipped, with the reason;
 *   - one row per (model, role, subject) is enforced by the database, so re-runs add nothing;
 *   - every RULES row stores the exact inputs (`features`) and, in output.context, the raw values a training
 *     row needs (prices, capacity, start time) as they were at that moment: training never reconstructs them;
 *   - ML_SHADOW_ENABLED=false stops the shadow model calls only; the snapshots keep being logged
 *     (ML_SNAPSHOTS_ENABLED=false stops those too).
 */
import prisma from '../../config/prisma.js';
import { mlPost } from '../mlService.js';
import { checkSnapshots } from './snapshotIntegrity.js';
import { referenceInputs } from './features.js';

const SHADOW_TIMEOUT_MS = Number(process.env.ML_SHADOW_TIMEOUT_MS) || 2000; // off the request path
const MODEL_CACHE_MS = 60_000;
const BATCH = 500; // rows per ML call (the service accepts up to 1000)
const modelCache = new Map(); // name -> { at, model }

// Swappable for tests only (database and ML service stand-ins; hooks to inject concurrent changes)
let deps = { db: prisma, post: mlPost, hooks: {} };
export const __setShadowDeps = (d) => { deps = d ? { ...deps, ...d } : { db: prisma, post: mlPost, hooks: {} }; modelCache.clear(); };

export const shadowEnabled = () => process.env.ML_SHADOW_ENABLED !== 'false';
export const snapshotsEnabled = () => process.env.ML_SNAPSHOTS_ENABLED !== 'false';

/** A feature builder may return the inputs, or { features, context } with the raw values for training. */
export const splitSnapshot = (built) => (built && typeof built === 'object' && 'features' in built && 'context' in built
  ? { features: built.features, context: built.context } : { features: built, context: null });

async function shadowModel(name) {
  const hit = modelCache.get(name);
  if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.model;
  const model = await deps.db.mlModel.findFirst({ where: { name, status: 'SHADOW' }, orderBy: { registeredAt: 'desc' } });
  modelCache.set(name, { at: Date.now(), model });
  return model;
}

export const clearShadowModelCache = () => modelCache.clear();

/** Main value of a shadow prediction, for the `score` column. */
const scoreOf = (p) => p.probability ?? p.sales_48h ?? p.sales_next_24h ?? p.scans ?? null;

/**
 * Logs RULES (+ SHADOW when a shadow model is registered) rows for many subjects, with one ML call per
 * batch. Each item: { subjectType, subjectId, eventId?, userId?, asOf, rule: {score, decision, output},
 * features?: object, context?: object, windowStart?: Date, referenceAt?: Date|null, skipped?: string }.
 * Returns { rules, shadow, skipped, errors } counts.
 *
 * Order (snapshotIntegrity.js explains why it is safe under concurrency): every input is read first (by the
 * caller); then ONE repeatable-read transaction checks each snapshot's integrity and writes the rows.
 * output.context.exact is true only if neither the event's inputs (since `windowStart`, default asOf) nor
 * the typical-price events (since `referenceAt`, default asOf; null = no price-relative inputs) changed.
 * Training uses exact snapshots only.
 */
export async function logPredictions(name, items) {
  const counts = { rules: 0, shadow: 0, skipped: 0, errors: 0 };
  if (!items.length) return counts;
  const model = shadowEnabled() ? await shadowModel(name) : null;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const withInputs = chunk.filter((it) => it.features);
    let preds = null;
    let callError = null;
    if (model && withInputs.length) {
      try {
        const r = await deps.post(`/v2/shadow/${name}`, { sha256: model.sha256, rows: withInputs.map((it) => it.features) }, { timeoutMs: SHADOW_TIMEOUT_MS });
        preds = r.predictions;
      } catch (e) {
        callError = e.name === 'TimeoutError' ? 'timeout' : e.message;
      }
    }
    const rowsFor = (integrity) => {
      const rows = [];
      const c = { rules: 0, shadow: 0, skipped: 0, errors: 0 };
      let k = 0;
      for (const it of chunk) {
        const base = {
          modelName: name, subjectType: it.subjectType, subjectId: String(it.subjectId), eventId: it.eventId ?? null,
          userId: it.userId ?? null, asOf: it.asOf, features: it.features ?? undefined,
        };
        const check = integrity.get(it);
        const context = check ? { ...(it.context || {}), captured_at: it.context?.captured_at ?? check.checked_at, exact: check.exact, integrity: check } : it.context;
        const ruleOutput = context ? { ...(it.rule?.output || {}), context } : it.rule?.output;
        rows.push({ ...base, role: 'RULES', score: it.rule?.score ?? null, decision: it.rule?.decision ?? null, output: ruleOutput ?? undefined });
        c.rules += 1;
        if (!model) continue;
        const shadow = { ...base, role: 'SHADOW', modelId: model.id };
        if (!it.features) {
          rows.push({ ...shadow, output: { skipped: it.skipped || 'no inputs' } });
          c.skipped += 1;
        } else if (preds) {
          const p = preds[k++];
          rows.push({ ...shadow, score: scoreOf(p), output: p, decision: typeof p.would_flag === 'boolean' ? (p.would_flag ? 'WOULD_FLAG' : 'WOULD_NOT_FLAG') : null });
          c.shadow += 1;
        } else {
          rows.push({ ...shadow, output: { error: callError || 'no prediction' } });
          c.errors += 1;
        }
      }
      return { rows, c };
    };
    // Every input was read above (by the caller). Now the integrity check and the write happen in ONE
    // repeatable-read transaction: both see the same committed state, and nothing is written unchecked.
    const write = async (db) => {
      await deps.hooks.beforeCheck?.();
      const checks = await checkSnapshots(db, withInputs.map((it) => ({
        eventId: it.eventId,
        windowStart: it.windowStart || it.asOf,
        // The moment the typical price refers to: given by the caller, else stated by the builder, else asOf
        referenceAt: it.referenceAt !== undefined ? it.referenceAt : it.context?.reference_at ? new Date(it.context.reference_at) : it.asOf,
      })), { reference: referenceInputs });
      await deps.hooks.afterCheck?.();
      const { rows, c } = rowsFor(new Map(checks.map((r, j) => [withInputs[j], r])));
      await db.mlPrediction.createMany({ data: rows, skipDuplicates: true });
      return c;
    };
    const c = typeof deps.db.$transaction === 'function'
      ? await deps.db.$transaction(write, { isolationLevel: 'RepeatableRead', timeout: 60_000, maxWait: 10_000 })
      : await write(deps.db);
    for (const key of Object.keys(counts)) counts[key] += c[key];
  }
  return counts;
}

/**
 * Request-path entry point: returns at once, builds the inputs and logs on a later tick.
 * @returns {Promise<void>|undefined} resolves when logged (for tests); callers must not await it
 */
export function recordShadow({ name, subjectType, subjectId, eventId = null, userId = null, asOf, rule, buildFeatures }) {
  if (!shadowEnabled() && !snapshotsEnabled()) return undefined;
  return new Promise((resolve) => {
    setImmediate(async () => {
      try {
        let features = null;
        let context = null;
        let skipped = null;
        try {
          ({ features, context } = splitSnapshot(await buildFeatures()));
          if (context) context = { ...context, captured_at: new Date().toISOString() };
        } catch (e) {
          skipped = e.code === 'MISSING_INPUT' ? `missing input: ${e.message}` : `feature error: ${e.message}`;
        }
        await logPredictions(name, [{ subjectType, subjectId, eventId, userId, asOf, rule, features, context, skipped }]);
      } catch (e) {
        console.warn(`[ML shadow] ${name} prediction not recorded: ${e.message}`);
      }
      resolve();
    });
  });
}
