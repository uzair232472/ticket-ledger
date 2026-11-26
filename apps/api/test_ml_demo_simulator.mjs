/**
 * Demo simulator, end to end, on a database COPY (name must end in "_verify") with the real ML service and the real
 * registered v0 models:
 *
 *   node pgctl.mjs . with ticketledger_demo_verify -- node --test test_ml_demo_simulator.mjs
 *
 * Runs scripts/ml-demo-simulate.mjs, then checks every page the demo is for has real rows behind it (fraud shadow
 * rows with reasons, review sample and blind reviews, the ring's account graph, visits, crowd rows with an overload
 * chance, drift with enough rows), that nothing it wrote can reach a training export, then --reset and checks that
 * every trace is gone and the seats are free again.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
process.env.ML_SERVICE_URL = process.env.ML_E2E_URL || 'http://127.0.0.1:8011';
process.env.ML_SERVICE_TOKEN = process.env.ML_E2E_TOKEN || 'e2e-token';
const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(here, '../ml-service/models/v0/registry.json'), 'utf8'));
const prisma = (await import('./src/config/prisma.js')).default;
const { registerModels } = await import('./scripts/ml-register-models.mjs');
const { accountGraph } = await import('./src/services/ml/accountLinks.js');
const { modelOps, governanceSnapshot } = await import('./src/services/ml/monitor.js');
const { crowdInsight } = await import('./src/services/ml/insights.js');
const { dataPolicy, accountExclusion } = await import('./src/services/ml/dataPolicy.js');
test.after(() => prisma.$disconnect());

const sim = (...args) => {
  const r = spawnSync(process.execPath, [path.join(here, 'scripts/ml-demo-simulate.mjs'), ...args], { env: { ...process.env, ML_SHADOW_TIMEOUT_MS: '20000' }, encoding: 'utf8' });
  if (r.status !== 0) console.error(r.stdout, r.stderr);
  return r;
};
const demoUsers = () => prisma.user.findMany({ where: { email: { endsWith: '@demo.test' } }, select: { id: true, email: true, role: true, name: true } });

test('the simulator fills every AI page with demo data that can never reach a training export, and --reset removes it all', async () => {
  await registerModels(registry);
  const seatsBefore = await prisma.seat.count({ where: { status: 'SOLD' } });
  const gatesBefore = await prisma.eventGate.count();
  const r = sim('--customers', '100', '--ring', '6', '--setup-gates', '--with-tickets', '2000');
  assert.equal(r.status, 0, r.stderr);
  const eventId = r.stdout.match(/Event: .* \(([0-9a-f-]{36})\)/)[1];
  // A second run on top of the first is refused (it would mix old and new data)
  const again = sim('--setup-gates');
  assert.equal(again.status, 2);
  assert.match(again.stderr, /earlier run is still here.*--reset/s);

  const users = await demoUsers();
  assert.ok(users.length >= 109, `${users.length} demo accounts`);
  const policy = dataPolicy({});
  assert.ok(users.every((u) => accountExclusion(u, policy) !== null), 'every demo account is excluded from training exports');

  // Fraud: shadow rows with reasons, enough for the drift check; the sample and blind reviews exist
  const ids = users.map((u) => u.id);
  const shadow = await prisma.mlPrediction.findMany({ where: { modelName: 'fraud', role: 'SHADOW', userId: { in: ids } }, select: { output: true, score: true, features: true } });
  assert.ok(shadow.length >= 100, `${shadow.length} fraud shadow rows`);
  assert.ok(shadow.filter((s) => Array.isArray(s.output?.reasons)).length >= shadow.length * 0.9, 'reasons logged');
  assert.ok(shadow.some((s) => s.features.linked_accounts >= 2), 'ring members see their links');
  const ops = await modelOps('fraud');
  assert.ok(['STABLE', 'WATCH', 'DRIFT'].includes(ops.drift.status), `drift is computed (${ops.drift.status}, ${ops.drift.live_rows} rows)`);
  const reviews = await prisma.fraudReview.count({ where: { note: 'demo simulator' } });
  assert.ok(reviews > 0, 'blind reviews recorded');
  const ringOrders = await prisma.order.findMany({ where: { user: { name: { startsWith: 'Demo ring' } } }, select: { id: true } });
  const confirmed = await prisma.fraudReview.count({ where: { orderId: { in: ringOrders.map((o) => o.id) }, decision: 'CONFIRMED_FRAUD' } });
  assert.ok(confirmed > 0, 'ring orders confirmed as fraud by blind review');

  // The ring is one connected group in the account graph (phones and the shared browser)
  const ring = users.filter((u) => u.name.startsWith('Demo ring'));
  const g = await accountGraph(ring[0].id);
  assert.ok(ring.every((u) => g.nodes.some((n) => n.id === u.id)), 'every ring account is in the graph');
  assert.ok(g.edges.some((e) => e.via.includes('browser')) && g.edges.some((e) => e.via.includes('phone')));

  // Visits scored; crowd rows with the model's overload chance for the 3D view
  assert.ok(await prisma.mlPrediction.count({ where: { modelName: 'intent', role: 'RULES', userId: { in: ids } } }) > 0, 'visits scored');
  const crowd = await crowdInsight(eventId);
  assert.equal(crowd.rules.gates.length, 3);
  const slots = crowd.rules.gates.flatMap((gt) => gt.slots);
  assert.ok(slots.some((s) => s.rule > 0) && slots.some((s) => s.model_p_over > 0.5), 'the smallest gate is likely to overload');
  // The past demo events taught the rule an arrival curve: it rises to a peak and falls (no longer flat)
  assert.match(crowd.rules.curve_basis, /^t:/, `curve learned from past events of the same type (${crowd.rules.curve_basis})`);
  const ruleA = crowd.rules.gates[0].slots.map((s) => s.rule);
  assert.ok(Math.max(...ruleA) > 5 * Math.min(...ruleA.filter((v) => v > 0)), 'the rule now varies over time');
  const cap = crowd.rules.gates[0].capacity_per_hour / 12;
  assert.ok(Math.max(...ruleA) / cap > 1 && Math.max(...ruleA) / cap < 1.3, 'gates sized so the peak is just over capacity');
  assert.equal(await prisma.event.count({ where: { name: { startsWith: 'Demo history event' }, isHidden: true } }), 5, 'five hidden past demo events');

  const gov = await governanceSnapshot();
  assert.ok(gov.models.every((m) => m.readiness.verdict === 'STAYS_SHADOW'));

  // --reset: every trace gone, seats free again, real gates untouched
  const rr = sim('--reset');
  assert.equal(rr.status, 0, rr.stderr);
  assert.equal((await demoUsers()).length, 0);
  assert.equal(await prisma.mlPrediction.count({ where: { userId: { in: ids } } }), 0);
  assert.equal(await prisma.mlPrediction.count({ where: { modelName: 'crowd', eventId } }), 0);
  assert.equal(await prisma.fraudReview.count({ where: { note: 'demo simulator' } }), 0);
  assert.equal(await prisma.order.count({ where: { userId: { in: ids } } }), 0);
  assert.equal(await prisma.seat.count({ where: { status: 'SOLD' } }), seatsBefore);
  assert.equal(await prisma.eventGate.count(), gatesBefore);
  assert.equal(await prisma.event.count({ where: { name: { startsWith: 'Demo history event' } } }), 0, 'past demo events removed');
  assert.equal(await prisma.checkIn.count({ where: { reason: 'demo history' } }), 0, 'their gate scans removed');
});

test('the simulator refuses production and asks before writing to a non-verify database', () => {
  const r = spawnSync(process.execPath, [path.join(here, 'scripts/ml-demo-simulate.mjs')], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /never runs in production/);
  const u = new URL(process.env.DATABASE_URL); u.pathname = '/ticketledger_db';
  const r2 = spawnSync(process.execPath, [path.join(here, 'scripts/ml-demo-simulate.mjs')], { env: { ...process.env, DATABASE_URL: u.toString() }, encoding: 'utf8' });
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /--yes/);
});
