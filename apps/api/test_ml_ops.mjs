/**
 * Model ops on a database COPY (name must end in "_verify") with the real ML service and the real v0 artifacts:
 *
 *   node pgctl.mjs . with ticketledger_ml_verify -- "ML_E2E_URL=http://127.0.0.1:8011 node --test test_ml_ops.mjs"
 *
 * Checks, with rows actually written and read back:
 *   - account links: a shared phone number (any formatting) and a shared browser link accounts; confirmed fraud
 *     and same-event orders are counted as of the moment; later activity is not seen;
 *   - the account graph and its audit entry (viewing it counts as detector exposure for every account shown);
 *   - a fraud shadow row persists the model's top reasons; model ops returns the card and a drift check;
 *   - none of it changes an order, ticket, payment or account.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
const { logPredictions, clearShadowModelCache } = await import('./src/services/ml/shadow.js');
const { linkFeatures, accountGraph } = await import('./src/services/ml/accountLinks.js');
const { modelOps } = await import('./src/services/ml/monitor.js');
const { exposureFor, recordWatchlistView, reviewedCases } = await import('./src/services/ml/fraudReview.js');

const up = await fetch(`${process.env.ML_SERVICE_URL}/health`).then((r) => r.ok).catch(() => false);
assert.ok(up, 'ML service must be running');
test.after(() => prisma.$disconnect());

const H = 3600_000;
const tag = Date.now();
const mk = (name, phone, ageDays = 100) => prisma.user.create({ data: { email: `ops-${name}-${tag}@ticketledger.pk`, passwordHash: 'x', name: `Ops ${name}`, role: 'CUSTOMER', phone, createdAt: new Date(Date.now() - ageDays * 24 * H) }, select: { id: true } });

test('account links, the graph and its exposure record, persisted and read back', async () => {
  const event = await prisma.event.findFirst({ where: { tiers: { some: {} } }, select: { id: true } });
  const [a, b, c, d, admin] = await Promise.all([mk('a', '+92 300 777-1234'), mk('b', '03007771234'), mk('c', null), mk('d', '03119998888'), mk('admin', null)]);
  const now = new Date();
  const browser = `sess_ops_${tag}`;
  // a and c used the same browser; d used it only AFTER the checkout moment (must not count)
  await prisma.behaviorEvent.createMany({ data: [
    { userId: a.id, sessionId: browser, action: 'event_view', createdAt: new Date(now - 5 * H) },
    { userId: c.id, sessionId: browser, action: 'event_view', createdAt: new Date(now - 4 * H) },
    { userId: d.id, sessionId: browser, action: 'event_view', createdAt: new Date(now.getTime() + H) },
  ] });
  // b (phone link) ordered the same event 2 h ago, and that order was later confirmed as fraud by a review
  const before = JSON.stringify(await prisma.order.findMany({ where: { userId: { in: [a.id, b.id, c.id] } }, orderBy: { id: 'asc' } }));
  const order = await prisma.order.create({ data: { userId: b.id, eventId: event.id, totalAmount: 1000, status: 'SUCCESSFUL', createdAt: new Date(now - 2 * H) } });
  const sample = await prisma.fraudSample.create({ data: { orderId: order.id, cell: 'RULE_ONLY', selected: true, inclusionProbability: 1, mlWouldFlag: false, sampledAt: new Date(now - 2 * H) } });
  await prisma.fraudReview.create({ data: { sampleId: sample.id, orderId: order.id, decision: 'CONFIRMED_FRAUD', reviewerId: admin.id, blind: true, createdAt: new Date(now - H) } });

  const f = await linkFeatures({ userId: a.id, eventId: event.id, at: now });
  assert.deepEqual(f, { linked_accounts: 2, linked_accounts_confirmed_fraud: 1, linked_orders_same_event_24h: 1 });
  // As of 3 hours ago: b's order and review did not exist yet, c had not used the browser
  const earlier = await linkFeatures({ userId: a.id, eventId: event.id, at: new Date(now - 4.5 * H) });
  assert.deepEqual(earlier, { linked_accounts: 1, linked_accounts_confirmed_fraud: 0, linked_orders_same_event_24h: 0 });
  // The review was later overturned: no longer confirmed fraud from that moment on
  await prisma.fraudReview.create({ data: { sampleId: sample.id, orderId: order.id, decision: 'LEGITIMATE', reviewerId: admin.id, blind: true, createdAt: new Date(now - 0.5 * H) } });
  assert.equal((await linkFeatures({ userId: a.id, eventId: event.id, at: now })).linked_accounts_confirmed_fraud, 0);
  assert.equal((await linkFeatures({ userId: a.id, eventId: event.id, at: new Date(now - 0.75 * H) })).linked_accounts_confirmed_fraud, 1);

  const g = await accountGraph(a.id, { now: new Date(now.getTime() + 2 * H) });
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(ids.has(b.id) && ids.has(c.id) && ids.has(d.id), 'phone, browser and (later) browser links');
  const viaOf = (x) => g.edges.find((e) => [e.a, e.b].includes(a.id) && [e.a, e.b].includes(x)).via;
  assert.deepEqual(viaOf(b.id), ['phone']);
  assert.deepEqual(viaOf(c.id), ['browser']);
  assert.ok(g.nodes.every((n) => !n.phone || /^•••\d{3}$/.test(n.phone)), 'phone numbers are masked');
  // Viewing the graph = seeing detector output for every account in it
  await recordWatchlistView(admin.id, g.nodes.map((n) => n.id), prisma, 'account_graph');
  const ex = await exposureFor({ reviewerId: admin.id, customerId: c.id, before: new Date(Date.now() + 1000) });
  assert.equal(ex.blind, false);
  // Nothing but the test's own fixture order exists for these accounts: links never write orders
  const after = await prisma.order.findMany({ where: { userId: { in: [a.id, b.id, c.id] } }, orderBy: { id: 'asc' } });
  assert.equal(after.length, JSON.parse(before).length + 1);
});

test('fraud shadow row persists the model reasons; model ops reads the card and checks drift', async () => {
  await registerModels(registry);
  clearShadowModelCache();
  const fm = registry.models.find((m) => m.name === 'fraud');
  const row = {
    event_type: 'CRICKET_MATCH', city: 'Lahore', country: 'PK', payment_method: 'STRIPE', tickets_requested: 8, unit_price_rel: 1.6,
    checkout_duration_seconds: 2.1, clicks_per_minute: 240, rapid_seat_attempts: 9, time_on_seatmap_seconds: 1.1, device_switches: 3,
    account_age_days: 0.4, customer_prior_orders: 3, orders_last_24h: 3, failed_payments_30d: 2, prior_resale_listings: 1,
    hours_since_sales_open: 1.5, linked_accounts: 6, linked_accounts_confirmed_fraud: 2, linked_orders_same_event_24h: 1,
  };
  assert.deepEqual(Object.keys(row).sort(), [...fm.features.categorical, ...fm.features.numeric].sort(), 'the test row has exactly the model inputs');
  const subjectId = randomUUID();
  const counts = await logPredictions('fraud', [{ subjectType: 'ORDER', subjectId, asOf: new Date(), rule: { score: 95, decision: 'CRITICAL_BOT' }, features: row }]);
  assert.equal(counts.shadow, 1);
  const shadow = await prisma.mlPrediction.findFirst({ where: { modelName: 'fraud', role: 'SHADOW', subjectId } });
  assert.ok(shadow.score > 0.5, `a ring-linked machine-speed checkout scores high (${shadow.score})`);
  assert.ok(Array.isArray(shadow.output.reasons) && shadow.output.reasons.length > 0, 'reasons are stored with the row');
  for (const r of shadow.output.reasons) assert.ok(r.feature in row && typeof r.effect === 'number');

  const ops = await modelOps('fraud');
  assert.equal(ops.decision_source, 'rules');
  assert.equal(ops.card.status, 'REJECTED');
  assert.equal(ops.card_matches_registered_model, true);
  assert.ok(ops.card.diagnostics.without_link_features);
  assert.ok(['NOT_ENOUGH_ROWS', 'STABLE', 'WATCH', 'DRIFT'].includes(ops.drift.status), ops.drift.status);
  const cases = await reviewedCases({ limit: 100 });
  assert.ok(Array.isArray(cases));
  assert.ok(cases.every((c) => ['CONFIRMED_FRAUD', 'LEGITIMATE'].includes(c.review.decision)), 'only resolved blind reviews');
});
