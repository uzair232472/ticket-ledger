/**
 * Shadow mode, ML client safety, feature builders and the attendance baseline.
 * Uses a fake ML service; reads (never writes) the local database. The shadow log table is replaced by
 * an in-memory stand-in, so this runs before the ml_shadow migration is applied.
 *
 *   node --test test_ml_shadow.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(here, '../ml-service/models/v0/registry.json'), 'utf8'));
const featuresOf = (name) => {
  const m = registry.models.find((x) => x.name === name);
  return [...m.features.categorical, ...m.features.numeric].sort();
};

// ---- fake ML service ------------------------------------------------------------------------
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, token: req.headers['x-ml-token'], body });
    const reply = (obj, delay = 0) => setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); }, delay);
    if (req.url === '/fraud/score') return reply({}, 2000);                                   // hung service
    if (req.url === '/v2/shadow/fraud') return reply({ predictions: [{ probability: 0.91, would_flag: true }] });
    if (req.url === '/v2/shadow/demand') return reply({ predictions: [{ sales_48h: 1 }] }, 2000); // too slow
    res.statusCode = 404;
    return reply({ detail: 'nope' });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.ML_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ML_SERVICE_TOKEN = 'tok-123';
process.env.ML_TIMEOUT_MS = '300';
process.env.ML_SHADOW_TIMEOUT_MS = '300';

const mlService = (await import('./src/services/mlService.js')).default;
const { mlPost } = await import('./src/services/mlService.js');
const { recordShadow, __setShadowDeps } = await import('./src/services/ml/shadow.js');
const { fraudFeatures, demandFeatures, MissingInput, localParts, startOf } = await import('./src/services/ml/features.js');
const { showRate, fixedRule, clearAttendanceCache } = await import('./src/services/ml/attendanceBaseline.js');
const prisma = (await import('./src/config/prisma.js')).default;

// in-memory stand-in for the shadow tables
const store = { rows: [], model: { id: 'm1', name: 'fraud', sha256: 'a'.repeat(64) }, failWrites: false };
const fakeDb = {
  mlModel: { findFirst: async ({ where }) => (store.model && where.name === store.model.name ? store.model : null) },
  mlPrediction: { createMany: async ({ data }) => { if (store.failWrites) throw new Error('db down'); store.rows.push(...data); } },
};
const reset = (model = { id: 'm1', name: 'fraud', sha256: 'a'.repeat(64) }) => {
  store.rows = []; store.model = model; store.failWrites = false;
  __setShadowDeps({ db: fakeDb });
};
const rule = { score: 10, decision: 'LOW', output: { fallback: true } };

test.after(async () => { server.close(); __setShadowDeps(null); await prisma.$disconnect(); });

// ---- ML client --------------------------------------------------------------------------------
test('a hung ML service cannot hold up checkout: rules answer within the timeout', async () => {
  const t0 = Date.now();
  const r = await mlService.checkFraudRisk({ checkoutDurationSeconds: 1.0, clicksPerMinute: 300, rapidSeatAttempts: 8 });
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.equal(r.fallback, true);
  assert.equal(r.risk_level, 'CRITICAL_BOT');                  // the same rule as before
});

test('every ML call carries the service token', async () => {
  await assert.rejects(mlPost('/missing', {}));
  assert.equal(seen.at(-1).token, 'tok-123');
});

// ---- shadow recorder --------------------------------------------------------------------------
test('recordShadow returns at once and logs the rule decision next to the shadow prediction', async () => {
  reset();
  const t0 = performance.now();
  const done = recordShadow({ name: 'fraud', subjectType: 'ORDER', subjectId: 'o1', eventId: 'e1', userId: 'u1', asOf: new Date(), rule, buildFeatures: async () => ({ a: 1 }) });
  assert.ok(performance.now() - t0 < 20, 'must not wait for anything');
  assert.equal(store.rows.length, 0, 'nothing happens on the request path');
  await done;
  const [r, s] = store.rows;
  assert.equal(r.role, 'RULES'); assert.equal(r.decision, 'LOW'); assert.equal(r.score, 10);
  assert.equal(s.role, 'SHADOW'); assert.equal(s.decision, 'WOULD_FLAG'); assert.equal(s.score, 0.91); assert.equal(s.modelId, 'm1');
  assert.deepEqual(s.features, { a: 1 });
  assert.equal(JSON.parse(seen.at(-1).body).sha256, 'a'.repeat(64));
});

test('missing inputs are not invented: the shadow row says skipped', async () => {
  reset();
  await recordShadow({ name: 'fraud', subjectType: 'ORDER', subjectId: 'o2', asOf: new Date(), rule, buildFeatures: async () => { throw new MissingInput('no checkout telemetry'); } });
  assert.equal(store.rows.length, 2);
  assert.match(store.rows[1].output.skipped, /missing input: no checkout telemetry/);
  assert.equal(store.rows[1].score, undefined);
});

test('a slow model is abandoned; the rule decision is still logged', async () => {
  reset({ id: 'm2', name: 'demand', sha256: 'b'.repeat(64) });
  await recordShadow({ name: 'demand', subjectType: 'EVENT_FORECAST', subjectId: 'e1', asOf: new Date(), rule, buildFeatures: async () => ({ x: 1 }) });
  assert.equal(store.rows[0].role, 'RULES');
  assert.equal(store.rows[1].output.error, 'timeout');
});

test('without a registered shadow model only the rule decision is logged', async () => {
  reset(null);
  await recordShadow({ name: 'fraud', subjectType: 'ORDER', subjectId: 'o3', asOf: new Date(), rule, buildFeatures: async () => ({ a: 1 }) });
  assert.deepEqual(store.rows.map((r) => r.role), ['RULES']);
});

test('ML_SHADOW_ENABLED=false stops shadow scoring but keeps the feature snapshot (RULES row)', async () => {
  reset();
  process.env.ML_SHADOW_ENABLED = 'false';
  try {
    await recordShadow({ name: 'fraud', subjectType: 'ORDER', subjectId: 'o4', asOf: new Date(), rule, buildFeatures: async () => ({ a: 1 }) });
  } finally { delete process.env.ML_SHADOW_ENABLED; }
  assert.deepEqual(store.rows.map((r) => r.role), ['RULES']);
  assert.deepEqual(store.rows[0].features, { a: 1 });
});

test('ML_SNAPSHOTS_ENABLED=false with ML_SHADOW_ENABLED=false logs nothing', async () => {
  reset();
  process.env.ML_SHADOW_ENABLED = 'false';
  process.env.ML_SNAPSHOTS_ENABLED = 'false';
  try {
    assert.equal(recordShadow({ name: 'fraud', subjectType: 'ORDER', subjectId: 'o4', asOf: new Date(), rule, buildFeatures: async () => ({}) }), undefined);
  } finally { delete process.env.ML_SHADOW_ENABLED; delete process.env.ML_SNAPSHOTS_ENABLED; }
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.rows.length, 0);
});

test('a builder returning { features, context } stores the raw context with a capture time', async () => {
  reset();
  await recordShadow({ name: 'demand', subjectType: 'EVENT_FORECAST', subjectId: 'e1', asOf: new Date(), rule, buildFeatures: async () => ({ features: { a: 1 }, context: { min_price: 500 } }) });
  const r = store.rows.find((x) => x.role === 'RULES');
  assert.deepEqual(r.features, { a: 1 });
  assert.equal(r.output.context.min_price, 500);
  assert.ok(r.output.context.captured_at);
});

test('a database failure in the shadow log never reaches the caller', async () => {
  reset();
  store.failWrites = true;
  await recordShadow({ name: 'fraud', subjectType: 'ORDER', subjectId: 'o5', asOf: new Date(), rule, buildFeatures: async () => ({ a: 1 }) });
});

// ---- feature builders vs the trained models' inputs ------------------------------------------
const sample = async () => {
  const seat = await prisma.seat.findFirst({ where: { event: { tiers: { some: {} } } }, select: { id: true, eventId: true } });
  const user = await prisma.user.findFirst({ select: { id: true, createdAt: true } });
  return { seat, user };
};
const telemetry = { checkoutDurationSeconds: 31.5, clicksPerMinute: 28, rapidSeatAttempts: 1, timeOnSeatmapSeconds: 22, deviceSwitches: 0 };

test('fraud inputs match the trained model exactly (no training/serving skew)', async () => {
  const { seat, user } = await sample();
  const row = await fraudFeatures({ userId: user.id, eventId: seat.eventId, seatIds: [seat.id], telemetry, paymentMethod: 'JAZZCASH', at: new Date() });
  assert.deepEqual(Object.keys(row).sort(), featuresOf('fraud'));
  for (const [k, v] of Object.entries(row)) {
    assert.ok(typeof v === 'string' || Number.isFinite(v), `${k} = ${v}`);
  }
  assert.equal(row.country, 'PK');
  assert.ok(row.unit_price_rel > 0);
});

test('fraud inputs are "as of" the checkout moment and refuse missing telemetry', async () => {
  const { seat, user } = await sample();
  const at = new Date(user.createdAt.getTime() + 1000);
  const row = await fraudFeatures({ userId: user.id, eventId: seat.eventId, seatIds: [seat.id], telemetry, paymentMethod: 'STRIPE', at });
  assert.equal(row.customer_prior_orders, 0);
  assert.equal(row.orders_last_24h, 0);
  assert.ok(row.account_age_days < 0.001);
  await assert.rejects(fraudFeatures({ userId: user.id, eventId: seat.eventId, seatIds: [seat.id], telemetry: { ...telemetry, clicksPerMinute: undefined }, paymentMethod: 'STRIPE', at }), MissingInput);
  await assert.rejects(fraudFeatures({ userId: user.id, eventId: seat.eventId, seatIds: [seat.id], telemetry: undefined, paymentMethod: 'STRIPE', at }), MissingInput);
});

test('demand inputs match the trained model for every event in the database', async () => {
  const events = await prisma.event.findMany({ where: { tiers: { some: {} } }, select: { id: true } });
  assert.ok(events.length > 0);
  for (const e of events) {
    let row;
    try {
      row = await demandFeatures({ eventId: e.id, at: new Date() });
    } catch (err) {
      assert.ok(err instanceof MissingInput, err.message);
      continue;
    }
    assert.deepEqual(Object.keys(row).sort(), featuresOf('demand'));
    assert.equal(row.organizer_past_sell_through_48h === null, row.organizer_past_events === 0);
    assert.ok(row.start_hour >= 0 && row.start_hour < 24 && row.start_month >= 1 && row.start_month <= 12);
    assert.ok(row.min_price_rel <= row.avg_price_rel + 1e-9 && row.avg_price_rel <= row.max_price_rel + 1e-9);
  }
});

test('local time: an event at 19:30 in Pakistan is 14:30 UTC', () => {
  const start = startOf({ date: new Date('2026-03-14T00:00:00Z'), time: '19:30' });
  assert.equal(start.toISOString(), '2026-03-14T14:30:00.000Z');
  const p = localParts(start);
  assert.equal(p.hour, 19); assert.equal(p.weekday, 'Saturday'); assert.equal(p.month, 3);
});

// ---- attendance baseline ------------------------------------------------------------------------
test('the old fixed attendance rule is preserved exactly as the fallback', () => {
  assert.equal(fixedRule('CRICKET_MATCH', 'Lahore').rate, 94.4);
  assert.equal(fixedRule('MUSIC_FESTIVAL', 'Multan').rate, 86.8);
  assert.equal(fixedRule('KABADDI', 'Karachi').rate, 91.1);
  assert.equal(fixedRule('THEATRE', 'Quetta').rate, 88.5);
});

test('without enough past check-ins the app behaves exactly as before', async () => {
  clearAttendanceCache();
  const r = await showRate({ type: 'CRICKET_MATCH', city: 'Lahore' }, new Date('2000-01-01'));
  assert.equal(r.basis, 'FIXED_RULE');
  assert.equal(r.rate, 94.4);
  assert.equal(r.tickets, 0);
});

test('history is used once enough tickets exist (current database)', async () => {
  clearAttendanceCache();
  const r = await showRate({ type: 'CRICKET_MATCH', city: 'Lahore' });
  if (r.tickets >= 200) assert.ok(['HISTORY_TYPE', 'HISTORY_ALL'].includes(r.basis));
  else assert.equal(r.basis, 'FIXED_RULE');
  assert.ok(r.rate > 0 && r.rate <= 100);
});

// ---- visits, rules, blind sampling, estimator (pure logic) ------------------------------------
const { sessionize, visitId, parseVisitId, intentRule, VISIT_GAP_MS } = await import('./src/services/ml/visits.js');
const { cellOf, uniformFromId } = await import('./src/services/ml/jobs.js');
const { estimate } = await import('./src/services/ml/fraudReview.js');
const { parseSlotSubject, slotSubject, SLOTS } = await import('./src/services/ml/crowd.js');

test('visits: split after 30 minutes of quiet, per event; duplicate rows merge', async () => {
  const t = (min, s = 0) => new Date(Date.UTC(2026, 0, 1, 10, 0, 0) + min * 60_000 + s * 1000);
  const rows = [
    { eventId: 'A', action: 'event_view', createdAt: t(0) }, { eventId: 'A', action: 'event_view', createdAt: t(0, 2) }, // browser + server copy
    { eventId: 'A', action: 'seat_selected', createdAt: t(5) }, { eventId: 'A', action: 'seat_locked', createdAt: t(5, 1) },
    { eventId: 'B', action: 'event_view', createdAt: t(10) },
    { eventId: 'A', action: 'event_view', createdAt: t(5 + 31) },                                                      // new visit
  ];
  const v = sessionize(rows);
  assert.equal(v.length, 3);
  assert.deepEqual(v.map((x) => x.eventId), ['A', 'B', 'A']);
  assert.equal(v[0].rows.length, 4);
  assert.ok(v[2].start - v[0].end > VISIT_GAP_MS);
  const id = visitId('u1', v[0]);
  assert.deepEqual(parseVisitId(id), { userId: 'u1', eventId: 'A', start: v[0].start });
});

test('intent rule matches intentAnalyticsService (40 +15 +20 +25)', () => {
  assert.equal(intentRule({ event_views: 1, seat_selections: 0, checkout_started: 0 }).score, 40);
  assert.equal(intentRule({ event_views: 3, seat_selections: 1, checkout_started: 1 }).score, 99);
  assert.equal(intentRule({ event_views: 3, seat_selections: 1, checkout_started: 0 }).decision, 'HIGH');
});

test('fraud cells and the sampling draw', () => {
  assert.equal(cellOf('SUSPICIOUS', 'WOULD_FLAG'), 'RULE_AND_ML');
  assert.equal(cellOf('SUSPICIOUS', 'WOULD_NOT_FLAG'), 'RULE_ONLY');
  assert.equal(cellOf('LOW', 'WOULD_FLAG'), 'ML_ONLY');
  assert.equal(cellOf('LOW', 'WOULD_NOT_FLAG'), 'NEITHER');
  assert.equal(uniformFromId('order-1'), uniformFromId('order-1'));              // same order, same draw
  const draws = Array.from({ length: 20000 }, (_, i) => uniformFromId(`o${i}`));
  const share = draws.filter((d) => d < 0.02).length / draws.length;
  assert.ok(Math.abs(share - 0.02) < 0.004, `2% rate gave ${share}`);
});

test('sampling-weighted estimates recover the true population values', () => {
  // True population: RULE_AND_ML 100 (90 fraud), RULE_ONLY 200 (60), ML_ONLY 300 (30), NEITHER 10000 (50).
  // All flagged orders reviewed; 2% of NEITHER reviewed at exactly the true 0.5% fraud share.
  const rev = (n, frauds, p) => Array.from({ length: n }, (_, i) => ({ fraud: i < frauds ? 1 : 0, weight: 1 / p }));
  const e = estimate({
    RULE_AND_ML: { population: 100, resolved: rev(100, 90, 1) },
    RULE_ONLY: { population: 200, resolved: rev(200, 60, 1) },
    ML_ONLY: { population: 300, resolved: rev(300, 30, 1) },
    NEITHER: { population: 10000, resolved: rev(200, 1, 0.02) },
  });
  const total = 90 + 60 + 30 + 50;
  assert.ok(Math.abs(e.estimatedTotalFraud - total) < 1e-9);
  assert.ok(Math.abs(e.missedByBoth - 50) < 1e-9);
  assert.ok(Math.abs(e.rules.precision - 150 / 300) < 1e-12);
  assert.ok(Math.abs(e.rules.recall - 150 / total) < 1e-12);
  assert.ok(Math.abs(e.model.precision - 120 / 400) < 1e-12);
  assert.ok(Math.abs(e.model.recall - 120 / total) < 1e-12);
  assert.ok(Math.abs(e.rules.falseFlagRate - 150 / (10600 - total)) < 1e-12);
  assert.ok(Math.abs(e.model.falseFlagRate - 280 / (10600 - total)) < 1e-12);
});

test('estimates are withheld when a populated cell has no resolved review', () => {
  const e = estimate({ RULE_ONLY: { population: 10, resolved: [] }, NEITHER: { population: 100, resolved: [{ fraud: 0, weight: 50 }] } });
  assert.equal(e.rules.precision, null);
  assert.equal(e.estimatedTotalFraud, null);
});

test('crowd slots: -90 .. +55 in 5-minute steps, subject ids round-trip', () => {
  assert.equal(SLOTS.length, 30); assert.equal(SLOTS[0], -90); assert.equal(SLOTS.at(-1), 55);
  assert.deepEqual(parseSlotSubject(slotSubject('g1', -15)), { gateId: 'g1', minutes: -15 });
});
