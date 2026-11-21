/**
 * Persistence verification on a database COPY (name must end in "_verify") with the ml_shadow migration
 * applied and the real ML service running with the real v0 artifacts:
 *
 *   node pgctl.mjs . with ticketledger_ml_verify -- "ML_SERVICE_URL=... node --test test_ml_persistence.mjs"
 *
 * Checks that predictions, inputs, rule decisions, samples, reviews, review history and outcomes are
 * actually written - and that reviewing never changes orders, tickets, payments or accounts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
process.env.ML_SERVICE_URL = process.env.ML_E2E_URL || 'http://127.0.0.1:8011';
process.env.ML_SERVICE_TOKEN = process.env.ML_E2E_TOKEN || 'e2e-token';
process.env.ML_SHADOW_TIMEOUT_MS = '10000';

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(here, '../ml-service/models/v0/registry.json'), 'utf8'));
const prisma = (await import('./src/config/prisma.js')).default;
const { registerModels } = await import('./scripts/ml-register-models.mjs');
const { recordShadow, clearShadowModelCache } = await import('./src/services/ml/shadow.js');
const { fraudFeatures, demandFeatures, startOf } = await import('./src/services/ml/features.js');
const jobs = await import('./src/services/ml/jobs.js');
const review = await import('./src/services/ml/fraudReview.js');

const up = await fetch(`${process.env.ML_SERVICE_URL}/health`).then((r) => r.ok).catch(() => false);
assert.ok(up, 'ML service must be running for the persistence test');
test.after(() => prisma.$disconnect());
const FAR = new Date('2030-01-01T00:00:00Z');
const count = (where) => prisma.mlPrediction.count({ where });
const human = { checkoutDurationSeconds: 42, clicksPerMinute: 25, rapidSeatAttempts: 1, timeOnSeatmapSeconds: 30, deviceSwitches: 0 };
const bot = { checkoutDurationSeconds: 3.2, clicksPerMinute: 120, rapidSeatAttempts: 5, timeOnSeatmapSeconds: 1.2, deviceSwitches: 3 };

test('1. models register as SHADOW only; re-registering changes nothing; nothing can serve decisions', async () => {
  const first = await registerModels(registry);
  assert.equal(first.filter((r) => r.action === 'registered').length, registry.models.length);
  const again = await registerModels(registry);
  assert.ok(again.every((r) => r.action === 'unchanged'));
  assert.equal(await prisma.mlModel.count({ where: { status: { not: 'SHADOW' } } }), 0);
  assert.equal(await prisma.mlModel.count({ where: { mayServeDecisions: true } }), 0);
  const fraud = await prisma.mlModel.findFirst({ where: { name: 'fraud' } });
  assert.equal(fraud.evaluationStatus, 'REJECTED');
  assert.ok(fraud.shadowDecision?.decision.startsWith('Option 1'));
  clearShadowModelCache();
});

test('2. fraud: every order gets a RULES and a SHADOW row with the exact inputs; no duplicates', async () => {
  const orders = await prisma.order.findMany({ select: { id: true, userId: true, eventId: true, createdAt: true, tickets: { select: { seatId: true } } } });
  let i = 0;
  for (const o of orders) {
    const suspicious = i % 4 === 0;
    const telemetry = i % 3 === 0 ? bot : human;
    i += 1;
    await recordShadow({
      name: 'fraud', subjectType: 'ORDER', subjectId: o.id, eventId: o.eventId, userId: o.userId, asOf: o.createdAt,
      rule: { score: suspicious ? 55 : 10, decision: suspicious ? 'SUSPICIOUS' : 'LOW', output: { fallback: true } },
      buildFeatures: () => fraudFeatures({ userId: o.userId, eventId: o.eventId, seatIds: o.tickets.map((t) => t.seatId), telemetry, paymentMethod: 'JAZZCASH', at: o.createdAt }),
    });
  }
  const withSeats = orders.filter((o) => o.tickets.length).length;
  assert.equal(await count({ modelName: 'fraud', role: 'RULES' }), orders.length);
  assert.equal(await count({ modelName: 'fraud', role: 'SHADOW', score: { not: null } }), withSeats);
  const s = await prisma.mlPrediction.findFirst({ where: { modelName: 'fraud', role: 'SHADOW', score: { not: null } } });
  const want = registry.models.find((m) => m.name === 'fraud').features;
  assert.deepEqual(Object.keys(s.features).sort(), [...want.categorical, ...want.numeric].sort());
  assert.ok(['WOULD_FLAG', 'WOULD_NOT_FLAG'].includes(s.decision));
  assert.ok(s.modelId);
  // same order again: the database keeps one row per role
  const o = orders[0];
  await recordShadow({ name: 'fraud', subjectType: 'ORDER', subjectId: o.id, asOf: o.createdAt, rule: { score: 1 }, buildFeatures: async () => ({}) });
  assert.equal(await count({ modelName: 'fraud', subjectId: o.id }), 2);
});

test('3. demand: forecasts are logged with inputs and a shadow range', async () => {
  const events = await prisma.event.findMany({ where: { tiers: { some: {} } }, select: { id: true } });
  for (const e of events) {
    const asOf = new Date();
    await recordShadow({
      name: 'demand', subjectType: 'EVENT_FORECAST', subjectId: `${e.id}|${asOf.toISOString().slice(0, 10)}`, eventId: e.id, asOf,
      rule: { score: 7800, decision: 'HIGH' }, buildFeatures: () => demandFeatures({ eventId: e.id, at: asOf }),
    });
  }
  const rows = await prisma.mlPrediction.findMany({ where: { modelName: 'demand', role: 'SHADOW', score: { not: null } } });
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(r.output.low <= r.output.sales_48h && r.output.sales_48h <= r.output.high);
});

test('4. visits: intent for every finished signed-in visit, abandonment for visits that reached checkout', async () => {
  const last = await prisma.behaviorEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const now = new Date(last.createdAt.getTime() + 2 * 3600_000);
  const r = await jobs.scoreVisits({ now, lookbackHours: 24 * 365 });
  assert.ok(r.intent.rules > 0, JSON.stringify(r));
  assert.equal(r.intent.shadow + r.intent.skipped + r.intent.errors, r.intent.rules);
  assert.equal(r.intent.errors, 0);
  const intentRows = await count({ modelName: 'intent', role: 'SHADOW', score: { not: null } });
  const abandonRows = await count({ modelName: 'abandonment', role: 'SHADOW', score: { not: null } });
  assert.ok(intentRows > 0 && abandonRows > 0, `intent ${intentRows}, abandonment ${abandonRows}`);
  const a = await prisma.mlPrediction.findFirst({ where: { modelName: 'abandonment', role: 'SHADOW', score: { not: null } } });
  assert.equal('checkout_started' in a.features, false);
  const again = await jobs.scoreVisits({ now, lookbackHours: 24 * 365 });
  assert.equal(again.intent.rules, 0, 'a re-run scores nothing twice');
  console.log('   visits:', JSON.stringify({ visits: r.visits, skipped: r.skipped, intent: r.intent, abandonment: r.abandonment }));
});

test('5. crowd: skipped while a gate has no capacity; scored per gate and slot once capacities exist', async () => {
  const gate = await prisma.eventGate.findFirst({ where: { active: true }, select: { eventId: true } });
  const event = await prisma.event.findUnique({ where: { id: gate.eventId }, select: { id: true, date: true, time: true, startsAt: true, status: true } });
  await prisma.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED', cancelledAt: null } }); // copy only
  const now = new Date(startOf(event).getTime() - 6 * 3600_000);
  const before = await jobs.scoreCrowd({ now });
  assert.ok(Object.keys(before.skipped).some((k) => k.includes('no capacity')), JSON.stringify(before));
  await prisma.eventGate.updateMany({ where: { eventId: event.id, capacityPerHour: null }, data: { capacityPerHour: 900 } }); // copy only
  const r = await jobs.scoreCrowd({ now });
  const gates = await prisma.eventGate.count({ where: { eventId: event.id, active: true } });
  assert.equal(r.crowd.rules, gates * 30);
  assert.equal(r.crowd.shadow, gates * 30);
  assert.equal((await jobs.scoreCrowd({ now })).crowd.rules, 0, 'once per event');
  globalThis.crowdEvent = event;
});

test('6. blind sampling: every scored order lands in one cell; selection follows the stated rates', async () => {
  process.env.ML_REVIEW_RATE_RANDOM = '0.5';
  const r = await jobs.sampleFraudOrders({ now: FAR, settleMs: 0 });
  delete process.env.ML_REVIEW_RATE_RANDOM;
  const scored = await count({ modelName: 'fraud', role: 'SHADOW', score: { not: null } });
  assert.equal(r.sampled, scored);
  const samples = await prisma.fraudSample.findMany();
  for (const s of samples) {
    const p = s.cell === 'NEITHER' ? 0.5 : 1;
    assert.equal(s.inclusionProbability, p);
    assert.equal(s.selected, jobs.uniformFromId(s.orderId) < p);
    assert.ok(s.rulePredictionId && s.shadowPredictionId);
  }
  assert.equal((await jobs.sampleFraudOrders({ now: FAR, settleMs: 0 })).sampled, 0, 'each order sampled once');
  console.log('   cells:', JSON.stringify(Object.fromEntries(['RULE_AND_ML', 'RULE_ONLY', 'ML_ONLY', 'NEITHER'].map((c) => [c, samples.filter((s) => s.cell === c).length]))));
});

test('7. the queue hides the detector and every score', async () => {
  const { items } = await review.reviewQueue({ limit: 100 });
  assert.ok(items.length > 0);
  const text = JSON.stringify(items).toLowerCase();
  for (const word of ['cell', 'rule', 'probability', 'score', 'would_flag', 'wouldflag', 'ml_only', 'neither', 'suspicious', 'inclusion']) {
    assert.equal(text.includes(word), false, `queue leaks "${word}"`);
  }
});

test('8. reviews persist with history and identity, and change nothing else', async () => {
  const { items } = await review.reviewQueue({ limit: 100 });
  // A reviewer who has never seen detector output for these customers (the copied history's admin may have:
  // their reviews would be recorded as not blind and never close an item - see test_ml_review_blindness.mjs)
  const reviewer = await prisma.user.create({ data: { email: `blind-reviewer-${Date.now()}@ticketledger.pk`, passwordHash: 'x', name: 'Blind reviewer', role: 'SUPER_ADMIN' }, select: { id: true } });
  const snapshot = async () => JSON.stringify(await Promise.all([
    prisma.order.findMany({ orderBy: { id: 'asc' } }),
    prisma.ticket.findMany({ orderBy: { id: 'asc' } }),
    prisma.user.findMany({ where: { id: { not: reviewer.id } }, orderBy: { id: 'asc' }, select: { id: true, status: true, role: true, updatedAt: true } }),
    prisma.investigation.count(), prisma.adminAction.count(), prisma.checkIn.count(),
  ]));
  const before = await snapshot();
  const decisions = ['CONFIRMED_FRAUD', 'LEGITIMATE', 'UNRESOLVED'];
  for (const [i, it] of items.entries()) {
    await review.recordReview({ sampleId: it.sampleId, decision: decisions[i % 3], note: 'persistence test', reviewerId: reviewer.id });
  }
  // a second opinion on the first item: history keeps both, the latest counts
  await review.recordReview({ sampleId: items[0].sampleId, decision: 'LEGITIMATE', note: 'second look', reviewerId: reviewer.id });
  assert.equal(await snapshot(), before, 'reviewing must not change orders, tickets, accounts, investigations, admin actions or check-ins');
  const h = await review.reviewHistory(items[0].sampleId);
  assert.deepEqual(h.reviews.map((r) => r.decision), ['CONFIRMED_FRAUD', 'LEGITIMATE']);
  assert.ok(h.reviews.every((r) => r.reviewerId === reviewer.id));
  assert.equal(await prisma.fraudReview.count({ where: { reviewerId: reviewer.id, blind: { not: true } } }), 0, 'an unexposed reviewer is recorded as blind');
  assert.equal(await prisma.auditLog.count({ where: { action: 'FRAUD_REVIEW_RECORDED' } }), items.length + 1);
  const open = await review.reviewQueue({ limit: 100 });
  assert.equal(open.items.length, items.filter((_, i) => i % 3 === 2 && i !== 0).length, 'only UNRESOLVED items stay open');
});

test('9. outcomes are attached to both rows of each prediction', async () => {
  const r = await jobs.attachOutcomes({ now: FAR });
  assert.ok(r.intent > 0 && r.abandonment > 0 && r.demand > 0 && r.fraud > 0 && r.crowd > 0, JSON.stringify(r));
  for (const m of ['intent', 'abandonment', 'demand', 'crowd']) {
    assert.equal(await count({ modelName: m, outcomeAt: null }), 0, `${m}: every matured prediction labelled`);
  }
  // the RULES row and the SHADOW row of a subject always carry the same outcome
  const mismatched = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "MlPrediction" r JOIN "MlPrediction" s
      ON s."modelName" = r."modelName" AND s."subjectType" = r."subjectType" AND s."subjectId" = r."subjectId" AND s."role" = 'SHADOW'
    WHERE r."role" = 'RULES' AND (r."outcomeLabel" IS DISTINCT FROM s."outcomeLabel" OR (r."outcomeAt" IS NULL) <> (s."outcomeAt" IS NULL))`;
  assert.equal(mismatched[0].n, 0);
  // fraud labels come only from reviews; UNRESOLVED leaves the label empty
  // ... and only from the latest BLIND review (none -> no label)
  const reviewed = await prisma.fraudSample.findMany({ where: { reviews: { some: {} } }, select: { orderId: true, reviews: { where: { blind: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  for (const s of reviewed) {
    const p = await prisma.mlPrediction.findFirst({ where: { modelName: 'fraud', role: 'RULES', subjectId: s.orderId } });
    const want = s.reviews.length ? { CONFIRMED_FRAUD: 1, LEGITIMATE: 0, UNRESOLVED: null }[s.reviews[0].decision] : null;
    assert.equal(p.outcomeLabel, want);
  }
  assert.equal((await jobs.attachOutcomes({ now: FAR })).fraud, 0, 're-running changes nothing');
});

test('10. sampling-weighted metrics are computed from what was stored', async () => {
  const m = await review.reviewMetrics();
  const prog = m.reviewProgress;
  const total = Object.values(prog).reduce((a, c) => a + c.population, 0);
  assert.equal(total, await prisma.fraudSample.count());
  assert.equal(m.sufficient, false, 'a handful of reviews is never reported as sufficient');
  console.log('   metrics:', JSON.stringify({ progress: prog, rules: m.rules, model: m.model, note: m.note }));
});

test('11. a full job run is idempotent', async () => {
  const before = await prisma.mlPrediction.count();
  const last = await prisma.behaviorEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  await jobs.scoreVisits({ now: new Date(last.createdAt.getTime() + 2 * 3600_000), lookbackHours: 24 * 365 });
  await jobs.runMlJobs({ now: new Date(startOf(globalThis.crowdEvent).getTime() - 6 * 3600_000) });
  assert.equal(await prisma.mlPrediction.count(), before);
});
