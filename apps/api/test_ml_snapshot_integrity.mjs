/**
 * Prediction-snapshot integrity, against a database COPY (name must end in "_verify") with migration
 * 20261122120000_ml_input_changes applied:
 *   - changes made right AFTER a prediction is stored never alter it, and it stays exact;
 *   - changes between the prediction moment and the capture (price, capacity, gates, event details) mark
 *     the snapshot not exact, naming what changed; ticket sales (availableQuantity) do not;
 *   - the behaviour profile shows no fraud score instead of a fixed fallback.
 *
 *   DATABASE_URL=postgresql://.../ticketledger_export_verify node --test test_ml_snapshot_integrity.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
process.env.ML_SHADOW_ENABLED = 'false';
const prisma = (await import('./src/config/prisma.js')).default;
const { demandSnapshot } = await import('./src/services/ml/features.js');
const { logPredictions, recordShadow } = await import('./src/services/ml/shadow.js');
const { getUserBehavioralProfile } = await import('./src/services/behaviorService.js');
test.after(() => prisma.$disconnect());

const tag = randomUUID().slice(0, 8);
let company;
let n = 0;
async function freshEvent() {
  if (!company) {
    const org = await prisma.user.create({ data: { email: `org-${tag}@fx${tag}.pk`, passwordHash: 'x', name: 'Org', role: 'ORGANIZER' } });
    company = await prisma.company.create({ data: { userId: org.id, companyName: `Fx ${tag}`, ownerName: 'Org', phone: '0300', email: org.email, city: 'Lahore', ntnCnic: '1', documentUrl: 'x', status: 'APPROVED' } });
  }
  const start = new Date(Date.now() + 20 * 86_400_000);
  const e = await prisma.event.create({
    data: {
      companyId: company.id, name: `I${++n}-${tag}`, description: 'fixture', type: 'CRICKET_MATCH', status: 'PUBLISHED', city: 'Lahore', venue: 'Ground',
      date: start, time: '19:00', startsAt: start, salesOpenAt: new Date(Date.now() - 86_400_000),
      tiers: { create: [{ name: 'General', price: 1000, totalQuantity: 100, availableQuantity: 100 }, { name: 'VIP', price: 3000, totalQuantity: 20, availableQuantity: 20 }] },
      gates: { create: [{ name: 'G1', capacityPerHour: 600 }] },
    },
    include: { tiers: true, gates: true },
  });
  await new Promise((r) => setTimeout(r, 20));
  return e;
}
const stored = (subjectId) => prisma.mlPrediction.findFirst({ where: { modelName: 'demand', role: 'RULES', subjectId } });

/** Prediction moment = now; then `change` happens; then the inputs are read and logged (the delayed-capture case). */
async function predictAfter(change) {
  const e = await freshEvent();
  // The event's creation is long before the prediction (in a real timeline)
  await prisma.mlInputChange.updateMany({ where: { eventId: e.id }, data: { changedAt: new Date(Date.now() - 3600_000) } });
  const asOf = new Date();
  await change(e);
  const { features, context } = await demandSnapshot({ eventId: e.id, at: asOf });
  const subjectId = `${e.id}|t`;
  await logPredictions('demand', [{ subjectType: 'EVENT_FORECAST', subjectId, eventId: e.id, asOf, rule: { score: 1 }, features, context }]);
  return (await stored(subjectId)).output.context;
}

test('changes right after a prediction is stored never alter it, and it stays exact', async () => {
  const e = await freshEvent();
  await prisma.mlInputChange.updateMany({ where: { eventId: e.id }, data: { changedAt: new Date(Date.now() - 3600_000) } });
  const asOf = new Date();
  await recordShadow({ name: 'demand', subjectType: 'EVENT_FORECAST', subjectId: `${e.id}|now`, eventId: e.id, asOf, rule: { score: 1 }, buildFeatures: () => demandSnapshot({ eventId: e.id, at: asOf }) });
  const before = await stored(`${e.id}|now`);
  // Immediately after: price, capacity, gate and event details change
  await prisma.ticketTier.update({ where: { id: e.tiers[0].id }, data: { price: 5000, totalQuantity: 999 } });
  await prisma.eventGate.update({ where: { id: e.gates[0].id }, data: { capacityPerHour: 50 } });
  await prisma.event.update({ where: { id: e.id }, data: { startsAt: new Date(e.startsAt.getTime() + 7200_000), city: 'Karachi', capacityLimit: 10 } });
  const after = await stored(`${e.id}|now`);
  assert.deepEqual(after.features, before.features);
  assert.deepEqual(after.output, before.output);
  assert.equal(after.output.context.exact, true);
  assert.equal(after.output.context.min_price, 1000);
  assert.equal(after.features.venue_capacity, 120);
  assert.equal(after.features.city, 'Lahore');
  assert.ok(await prisma.mlInputChange.count({ where: { eventId: e.id, changedAt: { gt: asOf } } }) >= 3, 'the triggers logged the changes');
});

const CASES = [
  ['tier price', (e) => prisma.ticketTier.update({ where: { id: e.tiers[0].id }, data: { price: 1500 } }), 'TicketTier'],
  ['tier quantity (capacity)', (e) => prisma.ticketTier.update({ where: { id: e.tiers[1].id }, data: { totalQuantity: 40 } }), 'TicketTier'],
  ['tier added', (e) => prisma.ticketTier.create({ data: { eventId: e.id, name: 'Box', price: 9000, totalQuantity: 5, availableQuantity: 5 } }), 'TicketTier'],
  ['event capacity limit', (e) => prisma.event.update({ where: { id: e.id }, data: { capacityLimit: 80 } }), 'Event'],
  ['event start time', (e) => prisma.event.update({ where: { id: e.id }, data: { startsAt: new Date(e.startsAt.getTime() + 3600_000) } }), 'Event'],
  ['event city', (e) => prisma.event.update({ where: { id: e.id }, data: { city: 'Karachi' } }), 'Event'],
  ['sales-open time', (e) => prisma.event.update({ where: { id: e.id }, data: { salesOpenAt: new Date() } }), 'Event'],
  ['gate capacity', (e) => prisma.eventGate.update({ where: { id: e.gates[0].id }, data: { capacityPerHour: 900 } }), 'EventGate'],
  ['gate removed', (e) => prisma.eventGate.delete({ where: { id: e.gates[0].id } }), 'EventGate'],
];
for (const [name, change, source] of CASES) {
  test(`a change between the prediction moment and the capture marks the snapshot not exact: ${name}`, async () => {
    const c = await predictAfter(change);
    assert.equal(c.exact, false);
    assert.ok(c.integrity.sources.includes(source), JSON.stringify(c.integrity));
    assert.match(c.integrity.reason, /inputs changed after the prediction moment/);
  });
}

test('ticket sales and unrelated edits are not input changes', async () => {
  const c = await predictAfter(async (e) => {
    await prisma.ticketTier.update({ where: { id: e.tiers[0].id }, data: { availableQuantity: 90 } });
    await prisma.event.update({ where: { id: e.id }, data: { description: 'new text', bannerUrl: 'x.png' } });
  });
  assert.equal(c.exact, true, JSON.stringify(c.integrity));
});

test('the behaviour profile shows no fraud score instead of a fixed fallback', async () => {
  const u = await prisma.user.findFirst({ where: { role: 'CUSTOMER' }, select: { id: true } });
  const p = await getUserBehavioralProfile(u.id);
  assert.equal(p.scores.fraudRisk.available, false);
  assert.equal(p.scores.fraudRisk.score, null);
  assert.equal(p.scores.fraudRisk.level, 'UNAVAILABLE');
  assert.equal(p.summary.riskLevel, 'UNAVAILABLE');
});
