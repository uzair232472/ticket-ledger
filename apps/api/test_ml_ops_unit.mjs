/**
 * Model ops (unit, no database, no ML service): drift maths, the model-ops answer with stand-ins, and the
 * guarantees that matter: no accuracy figure is computed from live rows, drift reads inputs only, and nothing
 * new is reachable from a decision path.
 *
 *   node --test test_ml_ops_unit.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { psi, driftOf, modelOps, __setMonitorDeps, DRIFT } = await import('./src/services/ml/monitor.js');
const { EXPLAINED_MODELS } = await import('./src/services/ml/shadow.js');

const REF = {
  typical: { price: 1, city: 'Lahore' },
  numeric: { price: { edges: [0.5, 1, 1.5], shares: [0.25, 0.25, 0.25, 0.25], missing_share: 0 } },
  categorical: { city: { shares: { Lahore: 0.6, Karachi: 0.4 }, other_share: 0 } },
};

test('psi: 0 for identical shares, grows with the shift', () => {
  assert.equal(psi([0.25, 0.25, 0.25, 0.25], [0.25, 0.25, 0.25, 0.25]), 0);
  const small = psi([0.25, 0.25, 0.25, 0.25], [0.3, 0.25, 0.25, 0.2]);
  const big = psi([0.25, 0.25, 0.25, 0.25], [0.7, 0.1, 0.1, 0.1]);
  assert.ok(small > 0 && small < DRIFT.watch, `small shift ${small}`);
  assert.ok(big > DRIFT.alert, `big shift ${big}`);
});

test('driftOf: same distribution is STABLE; a moved input is DRIFT; unseen categories count as other', () => {
  const same = [];
  for (let i = 0; i < 400; i++) same.push({ price: [0.3, 0.8, 1.2, 2][i % 4], city: i % 5 < 3 ? 'Lahore' : 'Karachi' });
  const a = driftOf(REF, same);
  assert.ok(a.every((f) => f.status === 'STABLE'), JSON.stringify(a));
  const moved = same.map((r) => ({ price: 3, city: 'Quetta' }));
  const b = driftOf(REF, moved);
  assert.deepEqual(b.map((f) => f.status), ['DRIFT', 'DRIFT']);
  assert.equal(b.find((f) => f.feature === 'city').live_most_common, 'a value not seen in training');
  // bins use "edge <= value" (numpy searchsorted side=right): 1.0 falls in the third bin
  const edge = driftOf(REF, Array(200).fill({ price: 1, city: 'Lahore' })).find((f) => f.feature === 'price');
  assert.equal(edge.live_median, 1);
});

const model = { id: 'm1', name: 'fraud', status: 'SHADOW', sha256: 'a'.repeat(64), version: 'v0', source: 'synthetic-v0', evaluationStatus: 'REJECTED', registeredAt: new Date() };
const stubDb = (rows) => ({
  mlModel: { findFirst: async () => model },
  mlPrediction: { findMany: async (q) => { stubDb.last = q; return rows; } },
});

test('modelOps: model card + drift from logged inputs only; never an accuracy figure; decision source rules', async () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({ features: { price: [0.3, 0.8, 1.2, 2][i % 4], city: 'Lahore' } }));
  const db = stubDb(rows);
  const calls = [];
  __setMonitorDeps({
    db,
    now: () => new Date('2026-11-25T00:00:00Z'),
    get: async (p) => {
      calls.push(p);
      if (p.startsWith('/v2/reference/')) return { reference: REF, trained_from: 'x', trained_to: 'y' };
      if (p.startsWith('/v2/model-card/')) return { status: 'REJECTED', registry_sha256: model.sha256, diagnostics: {} };
      throw new Error('unexpected');
    },
  });
  const r = await modelOps('fraud');
  __setMonitorDeps(null);
  assert.equal(r.decision_source, 'rules');
  assert.equal(r.registered.may_serve_decisions, false);
  assert.equal(r.card_matches_registered_model, true);
  assert.equal(r.drift.live_rows, 150);
  assert.ok(['STABLE', 'WATCH', 'DRIFT'].includes(r.drift.status));
  assert.ok(calls.some((c) => c === `/v2/reference/fraud?sha256=${model.sha256}`), 'reference requested for the registered fingerprint');
  // Only the inputs of this model's SHADOW rows are read: no outcome column at all
  assert.deepEqual(stubDb.last.select, { features: true });
  assert.equal(stubDb.last.where.role, 'SHADOW');
  assert.equal(stubDb.last.where.modelId, 'm1');
  const keys = [];
  const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } };
  walk(r.drift);
  assert.ok(!keys.some((k) => /accuracy|precision|recall|auc|error|outcome/i.test(k)), `drift reports no performance figure: ${keys}`);
});

test('modelOps: too few live rows -> NOT_ENOUGH_ROWS; unknown model -> 404', async () => {
  __setMonitorDeps({ db: stubDb([{ features: { price: 1 } }]), get: async (p) => (p.startsWith('/v2/reference/') ? { reference: REF } : { status: 'PASSED' }) });
  const r = await modelOps('fraud');
  assert.equal(r.drift.status, 'NOT_ENOUGH_ROWS');
  await assert.rejects(() => modelOps('nope'), (e) => e.status === 404);
  __setMonitorDeps(null);
});

test('modelOps: ML service down -> the card and drift say unavailable; nothing throws', async () => {
  __setMonitorDeps({ db: stubDb([]), get: async () => { throw Object.assign(new Error('down'), { name: 'TypeError' }); } });
  const r = await modelOps('demand');
  assert.equal(r.card.unavailable_reason, 'ML_SERVICE_UNAVAILABLE');
  assert.equal(r.drift.status, 'UNAVAILABLE');
  __setMonitorDeps(null);
});

test('reasons are logged for the cheap models only', () => {
  assert.deepEqual([...EXPLAINED_MODELS].sort(), ['crowd', 'demand', 'demand_hourly', 'fraud']);
});

test('account links and the graph: read-only, never reachable from checkout, payment, tickets or gates', () => {
  const src = (p) => fs.readFileSync(path.join(here, p), 'utf8');
  const links = src('src/services/ml/accountLinks.js');
  assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw/.test(links), 'accountLinks.js is read-only');
  for (const f of ['src/controllers/bookingController.js', 'src/services/security/checkoutBotRules.js']) {
    assert.ok(!/accountLinks|linkFeatures|accountGraph/.test(src(f)), `${f} must not use account links`);
  }
  const routes = src('src/routes/mlRoutes.js');
  assert.match(routes, /router\.get\('\/account-graph\/:userId', authenticateJWT, requireRole\('SUPER_ADMIN'\)/);
  assert.match(routes, /router\.get\('\/ops\/:name', authenticateJWT, requireRole\('SUPER_ADMIN'\)/);
  assert.match(routes, /router\.get\('\/fraud-review-cases', authenticateJWT, requireRole\('SUPER_ADMIN'\)/);
  // Viewing the graph is recorded as detector exposure (keeps later reviews honest about blindness)
  assert.match(src('src/controllers/mlInsightsController.js'), /recordWatchlistView\(req\.user\.id, graph\.nodes\.map\(\(n\) => n\.id\), prisma, 'account_graph'\)/);
  // Reviewers' queue route stays separate from the cases route, and the queue code never reads reasons
  const review = src('src/services/ml/fraudReview.js');
  const queue = review.slice(review.indexOf('export async function reviewQueue'), review.indexOf('export async function recordReview'));
  assert.ok(!/reasons|mlProbability|shadowPrediction/.test(queue), 'the blind queue never touches model output');
});

const { readinessOf, governanceSnapshot } = await import('./src/services/ml/monitor.js');
const opsOf = (over = {}) => ({
  registered: { status: 'SHADOW', version: 'v0', source: 'synthetic-v0', may_serve_decisions: false },
  card: { status: 'PASSED', reasons: [], diagnostics: { fairness: { watch: [] } } },
  drift: { status: 'STABLE' }, real_data: { status: 'WAITING_FOR_LIVE_DATA' }, ...over,
});

test('readiness: always STAYS_SHADOW; nothing missing is ever shown as met; approval is never available', () => {
  const best = readinessOf(opsOf({ registered: { status: 'SHADOW', version: 'v9', source: 'db-export' }, real_data: { status: 'PASSED', stamp: 'x' } }),
    { with_outcome: 500, positives: 200, negatives: 300, events: 200 }, { positives: 100, negatives: 100 });
  assert.equal(best.verdict, 'STAYS_SHADOW');
  assert.equal(best.may_serve_decisions, false);
  const by = Object.fromEntries(best.items.map((i) => [i.key, i.status]));
  assert.equal(by.admin_approval, 'NOT_AVAILABLE');
  assert.equal(by.live_shadow_check, 'NOT_AVAILABLE');
  assert.equal(best.met, best.total - 2, 'even with every other condition met, two can never be met');

  const now = readinessOf(opsOf(), { with_outcome: 0 }, { positives: 100, negatives: 100 });
  const s = Object.fromEntries(now.items.map((i) => [i.key, i.status]));
  assert.equal(s.trained_on_real_data, 'NOT_MET');
  assert.equal(s.real_data_test, 'PENDING');
  assert.equal(s.live_outcomes, 'PENDING');
  const flagged = readinessOf(opsOf({ card: { status: 'REJECTED', reasons: ['x'], diagnostics: { fairness: { watch: ['city: Quetta'] } } }, drift: { status: 'DRIFT', drifted: ['price'] } }), { with_outcome: 5, positives: 1, negatives: 4 }, { positives: 100 });
  const f = Object.fromEntries(flagged.items.map((i) => [i.key, i]));
  assert.equal(f.offline_test.status, 'NOT_MET');
  assert.equal(f.fairness.status, 'NOT_MET');
  assert.match(f.fairness.detail, /city: Quetta/);
  assert.equal(f.inputs_stable.status, 'NOT_MET');
  assert.equal(f.live_outcomes.status, 'NOT_MET');
  const down = readinessOf(opsOf({ card: { unavailable_reason: 'ML_SERVICE_UNAVAILABLE' }, drift: { status: 'UNAVAILABLE', reason: 'down' } }), { with_outcome: 0 }, {});
  assert.ok(down.items.filter((i) => ['offline_test', 'fairness', 'inputs_stable'].includes(i.key)).every((i) => i.status === 'PENDING'), 'unknown is pending, never met');
});

test('governance report: one entry per monitored model, decision source rules, nothing may serve decisions', async () => {
  __setMonitorDeps({
    db: { mlModel: { findFirst: async () => null }, mlPrediction: { findMany: async () => [] }, $queryRaw: async () => [{ with_outcome: 0, positives: 0, negatives: 0, events: 0 }] },
    get: async () => { throw Object.assign(new Error('nf'), { status: 404 }); },
  });
  const g = await governanceSnapshot();
  __setMonitorDeps(null);
  assert.equal(g.decision_source, 'rules');
  assert.equal(g.may_serve_decisions, false);
  assert.equal(g.models.length, 8);
  assert.ok(g.models.every((m) => m.readiness.verdict === 'STAYS_SHADOW' && m.registered.may_serve_decisions === false));
  assert.ok(g.models.every((m) => m.real_data.status === 'WAITING_FOR_LIVE_DATA'));
  assert.ok(g.principles.some((p) => /no promotion path/i.test(p)));
});
