/**
 * Step 6 API tests against a database COPY (name must end in "_verify"). The app runs in-process; the ML
 * service is an in-process stand-in that can be switched between up / down / slow / 409, so every fallback is
 * exercised deterministically:
 *   - access: anonymous 401, customers 403, another organization 403, own organization rules-only, SUPER_ADMIN full;
 *   - legacy ML endpoints: SUPER_ADMIN only;
 *   - aggregates only: no customer id, subject id or e-mail in any insight answer; fraud review stays blind;
 *   - flags off: disabled answers;
 *   - the application decides IDENTICALLY with the ML service up, down, slow or refusing (checkout block,
 *     pre-launch estimate), and the insight layer labels each failure;
 *   - recommendation impressions counted on render, once, only for the visitor it was served to;
 *     never-rendered lists left out of the export.
 *
 *   DATABASE_URL=postgresql://.../ticketledger_step6_verify node --test --test-concurrency=1 test_ml_step6_api.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(here, '../ml-service/models/v0/registry.json'), 'utf8'));

// ---------------------------------------------------------------------------------------------
// ML service stand-in (must exist before the app reads ML_SERVICE_URL)
// ---------------------------------------------------------------------------------------------
let mlMode = 'up';
const mlCalls = [];
const fakeMl = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    mlCalls.push({ path: req.url, mode: mlMode });
    if (mlMode === 'down') { req.socket.destroy(); return; }
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const answer = () => {
      if (mlMode === '409') return send(409, { detail: 'fingerprint mismatch' });
      if (req.url === '/v2/health') return send(200, { status: 'ok', models: registry.models.map((m) => ({ name: m.name, sha256: m.sha256, fingerprint_ok: true, may_serve_decisions: false })), may_serve_decisions: false });
      if (req.url.startsWith('/v2/shadow/')) {
        const name = req.url.split('/').pop();
        const rows = JSON.parse(body || '{}').rows || [];
        const p = name === 'demand' ? { sales_48h: 1234, low: 1000, high: 1500 } : name === 'crowd' ? { scans: 7 } : { probability: 0.61, ...(name === 'fraud' ? { would_flag: true } : {}) };
        return send(200, { model: name, role: 'SHADOW', may_serve_decisions: false, predictions: rows.map(() => p) });
      }
      // A legacy scoring call: answer something DIFFERENT from the rules, so any use of it would show
      if (req.url === '/fraud/score') return send(200, { fraud_score: 1, classification: 'NORMAL', is_bot: false, risk_level: 'LOW', action_recommended: 'ALLOW', anomaly_factors: [], confidence: 0.01 });
      if (req.url === '/forecast/demand') return send(200, { projected_48h_sales: 1, projected_revenue_pkr: 1, sellout_probability: 0.001, demand_tier: 'LOW', demand_level: 'LOW', pricing_recommendation: 'stand-in', prediction_source: 'rules' });
      return send(404, { detail: 'not found' });
    };
    if (mlMode === 'slow') setTimeout(answer, 2500); else answer();
  });
});
await new Promise((r) => fakeMl.listen(0, '127.0.0.1', r));
process.env.ML_SERVICE_URL = `http://127.0.0.1:${fakeMl.address().port}`;
process.env.ML_SERVICE_TOKEN = 'step6-token';
process.env.ML_SHADOW_ENABLED = 'true';
delete process.env.ML_INSIGHTS_ENABLED;
delete process.env.ML_INSIGHTS_ORGANIZER;
delete process.env.ML_REC_DISPLAY;

const prisma = (await import('./src/config/prisma.js')).default;
const app = (await import('./src/app.js')).default;
const { signAccessToken } = await import('./src/services/tokenService.js');
const { logPredictions, clearShadowModelCache } = await import('./src/services/ml/shadow.js');
const { recommend } = await import('./src/services/recommendationService.js');
const { buildExport, exportPolicy } = await import('./src/services/ml/export.js');
const { registerModels } = await import('./scripts/ml-register-models.mjs');
const { __setMonitorDeps } = await import('./src/services/ml/monitor.js');

const server = app.listen(0);
const API = `http://127.0.0.1:${server.address().port}/api`;
test.after(async () => { server.close(); fakeMl.close(); await prisma.$disconnect(); });

const tag = randomUUID().slice(0, 8);
const call = async (method, p, { token, body, headers = {} } = {}) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
};

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
await registerModels(registry); // SHADOW rows on this copy (no-op if already registered)
clearShadowModelCache();
const admin = await prisma.user.create({ data: { email: `s6-admin-${tag}@ticketledger.pk`, passwordHash: 'x', name: 'Step Six Admin', role: 'SUPER_ADMIN', status: 'ACTIVE' } });
const customer = await prisma.user.create({ data: { email: `s6-cust-${tag}@example.com`, passwordHash: 'x', name: 'Step Six Customer', role: 'CUSTOMER', status: 'ACTIVE' } });
const companies = await prisma.company.findMany({ where: { status: 'APPROVED', user: { status: 'ACTIVE' }, events: { some: { tiers: { some: {} } } } }, select: { id: true, userId: true }, take: 2 });
assert.equal(companies.length, 2, 'the database copy needs two approved organizations with priced events');
const [orgA, orgB] = companies;
const ownerA = await prisma.user.findUnique({ where: { id: orgA.userId } });
const ownerB = await prisma.user.findUnique({ where: { id: orgB.userId } });
const eventA = await prisma.event.findFirst({ where: { companyId: orgA.id, tiers: { some: {} } }, select: { id: true } });
const tok = { admin: signAccessToken(admin), customer: signAccessToken(customer), a: signAccessToken(ownerA), b: signAccessToken(ownerB) };

// Logged predictions for event A: 3 visits (RULES + SHADOW), customer and subject ids that must never leak
const visitUser = customer.id;
// Real visit-id format (userId|eventId|start ISO); a random millisecond offset keeps them unique per run
const base = Date.UTC(2026, 10, 1, 10) + Math.floor(Math.random() * 1e9);
const subjects = [0, 1, 2].map((i) => `${visitUser}|${eventA.id}|${new Date(base + i * 3600_000).toISOString()}`);
await prisma.mlPrediction.createMany({
  data: subjects.flatMap((s, i) => [
    { modelName: 'intent', role: 'RULES', subjectType: 'VISIT', subjectId: s, eventId: eventA.id, userId: visitUser, asOf: new Date(), score: [40, 60, 85][i], decision: ['LOW', 'MODERATE', 'HIGH'][i], output: {} },
    { modelName: 'intent', role: 'SHADOW', subjectType: 'VISIT', subjectId: s, eventId: eventA.id, userId: visitUser, asOf: new Date(), score: i === 2 ? null : [0.2, 0.8][i], output: i === 2 ? { error: 'timeout' } : { probability: [0.2, 0.8][i] } },
  ]),
});

const leaks = (text) => [visitUser, customer.email, ...subjects].filter((x) => text.includes(x));

// ---------------------------------------------------------------------------------------------
test('access: anonymous 401, customer 403, other organization 403, own organization rules-only, admin full', async () => {
  const p = `/ml/insights/events/${eventA.id}/intent`;
  assert.equal((await call('GET', p)).status, 401);
  assert.equal((await call('GET', p, { token: tok.customer })).status, 403);
  assert.equal((await call('GET', p, { token: tok.b })).status, 403, 'another organization');
  const own = await call('GET', p, { token: tok.a });
  assert.equal(own.status, 200, own.text);
  assert.equal(own.json.data.decision_source, 'rules');
  assert.equal(own.json.data.experimental.hidden, true, 'organizers get the rules part only (ML_INSIGHTS_ORGANIZER off)');
  assert.equal(own.json.data.experimental.value, null);
  assert.equal(own.json.data.rules.visits_scored >= 3, true);
  const full = await call('GET', p, { token: tok.admin });
  assert.equal(full.status, 200);
  const x = full.json.data.experimental;
  assert.equal(x.may_serve_decisions, false);
  assert.equal(x.validated, false);
  assert.equal(x.source, 'synthetic-v0');
  assert.ok(x.value.predicted >= 2 && x.value.errors >= 1, JSON.stringify(x.value));
  assert.equal(full.json.data.evaluation.metrics, null, 'no accuracy figure in the app');
  for (const r of [own, full]) assert.deepEqual(leaks(r.text), [], 'aggregates only: no customer or subject id');
});

test('every per-event insight and admin insight follows the same rules of access', async () => {
  for (const f of ['intent', 'abandonment', 'demand', 'attendance', 'crowd']) {
    const p = `/ml/insights/events/${eventA.id}/${f}`;
    assert.equal((await call('GET', p)).status, 401, f);
    assert.equal((await call('GET', p, { token: tok.b })).status, 403, f);
    const a = await call('GET', p, { token: tok.admin });
    assert.equal(a.status, 200, `${f}: ${a.text}`);
    assert.equal(a.json.data.decision_source, 'rules');
    assert.equal(a.json.data.experimental.may_serve_decisions, false);
    assert.equal(a.json.data.experimental.validated, false);
    assert.deepEqual(leaks(a.text), [], f);
  }
  for (const p of ['/ml/monitor', '/ml/insights/fraud', '/ml/insights/behaviour']) {
    assert.equal((await call('GET', p)).status, 401, p);
    assert.equal((await call('GET', p, { token: tok.a })).status, 403, p);
    assert.equal((await call('GET', p, { token: tok.customer })).status, 403, p);
    const r = await call('GET', p, { token: tok.admin });
    assert.equal(r.status, 200, `${p}: ${r.text}`);
    assert.deepEqual(leaks(r.text), [], p);
  }
  const flags = await call('GET', '/ml/flags');
  assert.deepEqual(flags.json.data, { insights: true, organizerInsights: false, recommendations: false });
});

test('legacy ML scoring endpoints: SUPER_ADMIN only', async () => {
  for (const p of ['/ml/fraud/score', '/ml/fraud-check', '/ml/forecast/demand', '/ml/demand-forecast', '/ml/intent/predict', '/ml/intent-score']) {
    assert.equal((await call('POST', p, { body: {} })).status, 401, p);
    assert.equal((await call('POST', p, { token: tok.customer, body: {} })).status, 403, p);
    assert.equal((await call('POST', p, { token: tok.a, body: {} })).status, 403, p);
  }
  assert.equal((await call('POST', '/ml/fraud/score', { token: tok.admin, body: { checkoutDurationSeconds: 30 } })).status, 200);
});

test('fraud: aggregates only for SUPER_ADMIN; nothing reaches a reviewer', async () => {
  const r = await call('GET', '/ml/insights/fraud', { token: tok.admin });
  assert.equal(r.json.data.experimental.model, 'fraud');
  assert.ok(!/orderId|subjectId|"order_id"/.test(r.text), 'no order is identified');
  const queue = await call('GET', '/ml/fraud-review/queue', { token: tok.admin });
  assert.equal(queue.status, 200);
  assert.ok(!/probability|would_flag|WOULD_FLAG|mlProbability|ruleScore|"cell"|experimental/.test(queue.text), 'the review queue stays blind');
});

test('flags off: the insight and monitor endpoints answer disabled', async () => {
  process.env.ML_INSIGHTS_ENABLED = 'false';
  try {
    for (const p of [`/ml/insights/events/${eventA.id}/intent`, '/ml/monitor', '/ml/insights/fraud']) {
      const r = await call('GET', p, { token: tok.admin });
      assert.equal(r.status, 200);
      assert.equal(r.json.data.enabled, false, p);
      assert.equal(r.json.data.experimental, undefined);
    }
    assert.equal((await call('GET', '/ml/flags')).json.data.insights, false);
  } finally { delete process.env.ML_INSIGHTS_ENABLED; }
  process.env.ML_INSIGHTS_ORGANIZER = 'true';
  try {
    const r = await call('GET', `/ml/insights/events/${eventA.id}/intent`, { token: tok.a });
    assert.notEqual(r.json.data.experimental.hidden, true, 'organizer aggregates when enabled');
    assert.deepEqual(leaks(r.text), [], 'still aggregates only');
  } finally { delete process.env.ML_INSIGHTS_ORGANIZER; }
});

// ---------------------------------------------------------------------------------------------
// The application decides identically whatever the ML service does
// ---------------------------------------------------------------------------------------------
const bookable = await prisma.event.findFirst({
  where: { status: 'PUBLISHED', isHidden: false, cancelledAt: null, terms: null, OR: [{ salesOpenAt: null }, { salesOpenAt: { lte: new Date() } }], AND: [{ OR: [{ salesCloseAt: null }, { salesCloseAt: { gt: new Date() } }] },
    // not started yet (assertOnSale closes sales at the start): the copy's older events have passed by now
    { OR: [{ startsAt: { gt: new Date(Date.now() + 2 * 3600_000) } }, { startsAt: null, date: { gt: new Date(Date.now() + 2 * 86400_000) } }] }] },
  select: { id: true },
});
const strip = (j) => JSON.parse(JSON.stringify(j, (k, v) => (['orderId', 'requestId', 'timestamp', 'generated_at'].includes(k) ? undefined : v)));

test('checkout and pre-launch decisions are identical with the ML service up, down, slow or refusing', { skip: !bookable && 'no bookable event in this copy' }, async () => {
  const bot = { eventId: bookable.id, seatIds: [randomUUID()], paymentMethod: 'MOCK', telemetry: { checkoutDurationSeconds: 0.4, clicksPerMinute: 380, rapidSeatAttempts: 15, deviceSwitches: 3 } };
  const edge = { ...bot, telemetry: { checkoutDurationSeconds: 2.7, clicksPerMinute: 200, rapidSeatAttempts: 1 } }; // blocked by the rule; the old ML-down copy allowed it
  const human = { ...bot, telemetry: { checkoutDurationSeconds: 40, clicksPerMinute: 20, rapidSeatAttempts: 1 } };
  const results = {};
  for (const mode of ['up', 'down', 'slow', '409']) {
    mlMode = mode;
    const before = mlCalls.length;
    const t0 = Date.now();
    results[mode] = {
      bot: await call('POST', '/bookings/initiate', { token: tok.customer, body: bot }),
      edge: await call('POST', '/bookings/initiate', { token: tok.customer, body: edge }),
      human: await call('POST', '/bookings/initiate', { token: tok.customer, body: human }),
      prelaunch: await call('GET', `/events/${eventA.id}/prelaunch-forecast`, { token: tok.a }),
      ms: Date.now() - t0,
      synchronousMlCalls: mlCalls.slice(before).filter((c) => !c.path.startsWith('/v2/shadow/')).length,
    };
  }
  mlMode = 'up';
  for (const mode of ['down', 'slow', '409']) {
    for (const k of ['bot', 'edge', 'human', 'prelaunch']) {
      assert.equal(results[mode][k].status, results.up[k].status, `${k} status with ML ${mode}`);
      assert.deepEqual(strip(results[mode][k].json), strip(results.up[k].json), `${k} body with ML ${mode}`);
    }
  }
  assert.equal(results.up.bot.status, 403);
  assert.equal(results.up.bot.json.blockedByRules, true);
  assert.equal(results.up.edge.status, 403, 'the 2.7 s / 200 cpm attempt is blocked whatever the ML service does');
  assert.notEqual(results.up.human.status, 403, 'a human checkout is never blocked by the rule');
  assert.equal(results.up.prelaunch.status, 200);
  assert.equal(results.up.prelaunch.json.data.prediction_source, 'rules');
  for (const mode of Object.keys(results)) assert.equal(results[mode].synchronousMlCalls, 0, `no synchronous ML call (${mode})`);
  assert.ok(results.slow.ms < 2500, `a slow ML service does not slow these requests (${results.slow.ms} ms)`);
});

test('insights label every ML failure; the rules part is unchanged', async () => {
  const tierPrices = async () => (await prisma.ticketTier.findMany({ where: { eventId: eventA.id }, select: { id: true, price: true }, orderBy: { id: 'asc' } })).map((t) => `${t.id}:${t.price}`);
  const eventState = async () => prisma.event.findUnique({ where: { id: eventA.id }, select: { status: true, updatedAt: true } });
  const [pricesBefore, stateBefore] = [await tierPrices(), await eventState()];
  const answers = {};
  for (const mode of ['up', 'down', 'slow', '409']) {
    mlMode = mode;
    __setMonitorDeps(null); // clear the 30 s health cache
    answers[mode] = {
      demand: await call('GET', `/ml/insights/events/${eventA.id}/demand?price=1500`, { token: tok.admin }),
      monitor: await call('GET', '/ml/monitor', { token: tok.admin }),
    };
  }
  mlMode = 'up';
  const reason = (m) => answers[m].demand.json.data.experimental.value?.what_if?.unavailable_reason ?? null;
  const whatIf = answers.up.demand.json.data.experimental.value?.what_if;
  assert.ok(whatIf, 'the what-if ran (event A has full demand inputs)');
  assert.equal(whatIf.sales_48h, 1234);
  assert.deepEqual(whatIf.inputs_changed, ['price']);
  assert.equal(whatIf.stored, false);
  assert.equal(whatIf.applied, false);
  assert.equal(reason('down'), 'ML_SERVICE_UNAVAILABLE');
  assert.equal(reason('slow'), 'TIMEOUT');
  assert.equal(reason('409'), 'ARTIFACT_MISMATCH');
  for (const m of ['down', 'slow', '409']) {
    assert.deepEqual(answers[m].demand.json.data.rules, answers.up.demand.json.data.rules, `rules part with ML ${m}`);
    const mon = answers[m].monitor.json.data;
    assert.equal(mon.ml_service.reachable, false, m);
    assert.ok(mon.warnings.some((w) => /ML service/.test(w.message)), m);
  }
  assert.equal(answers.up.monitor.json.data.ml_service.reachable, true);
  const models = answers.up.monitor.json.data.models;
  assert.deepEqual(models.map((m) => m.name), ['intent', 'abandonment', 'checkout_abandonment', 'fraud', 'demand', 'demand_hourly', 'attendance', 'crowd']);
  for (const m of models) {
    assert.equal(m.registered.may_serve_decisions, false);
    assert.equal(m.evaluation.metrics, null);
    // The five v0 models are always registered; the others may be (ml-register-models.mjs registers the whole
    // registry). Either way: SHADOW only, or explicitly not registered
    if (['intent', 'abandonment', 'fraud', 'demand', 'crowd'].includes(m.name)) assert.equal(m.registered.status, 'SHADOW', m.name);
    else if (m.registered.status) assert.equal(m.registered.status, 'SHADOW', m.name);
    else assert.equal(m.registered.unavailable_reason, 'NO_MODEL_REGISTERED', m.name);
  }
  // The what-if changed no price and did not publish or otherwise touch the event
  assert.deepEqual(await tierPrices(), pricesBefore);
  assert.deepEqual(await eventState(), stateBefore);
  assert.equal(await prisma.mlPrediction.count({ where: { eventId: eventA.id, subjectType: { contains: 'WHAT' } } }), 0, 'a what-if is never stored');
});

test('pre-launch page visits are logged as demand snapshots (regression: asOf / eventId were inside a comment)', async () => {
  mlMode = 'up';
  await call('GET', `/events/${eventA.id}/prelaunch-forecast`, { token: tok.a });
  let rows = [];
  for (let i = 0; i < 40 && rows.length < 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
    rows = await prisma.mlPrediction.findMany({ where: { modelName: 'demand', subjectType: 'EVENT_FORECAST', eventId: eventA.id, role: 'RULES' }, select: { asOf: true, userId: true } });
  }
  assert.ok(rows.length >= 1, 'the EVENT_FORECAST snapshot is written');
  assert.ok(rows[0].asOf instanceof Date);
});

test('shadow logging with the ML service down: rules rows written, shadow rows record the failure', async () => {
  mlMode = 'down';
  clearShadowModelCache();
  const subject = `${visitUser}|${eventA.id}|${new Date(base + 10 * 3600_000).toISOString()}`;
  const r = await logPredictions('intent', [{ subjectType: 'VISIT', subjectId: subject, eventId: eventA.id, userId: null, asOf: new Date(), rule: { score: 55, decision: 'MODERATE' }, features: { event_type: 'CRICKET_MATCH' }, referenceAt: null }]);
  mlMode = 'up';
  assert.equal(r.rules, 1);
  assert.equal(r.errors, 1);
  const rows = await prisma.mlPrediction.findMany({ where: { subjectId: subject }, select: { role: true, output: true, score: true } });
  assert.equal(rows.find((x) => x.role === 'RULES').score, 55);
  assert.ok(rows.find((x) => x.role === 'SHADOW').output.error);
});

// ---------------------------------------------------------------------------------------------
test('recommendations: impressions counted on render, once, for the same visitor only; unrendered lists left out', async () => {
  const sessionId = `s6-sess-${tag}`;
  const list = await recommend({ userId: customer.id, sessionId, surface: 'home' });
  const served = await prisma.behaviorEvent.findFirst({ where: { action: 'recommendation_impression', metadata: { path: ['listId'], equals: list.listId } } });
  assert.equal(served.metadata.renderTracked, true);
  const p = `/events/recommendations/${list.listId}/rendered`;
  assert.equal((await call('POST', p, { headers: { 'x-session-id': 'someone-else' } })).status, 404, 'another visitor cannot report it');
  const first = await call('POST', p, { token: tok.customer, headers: { 'x-session-id': sessionId } });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.data.recorded, true);
  const again = await call('POST', p, { token: tok.customer, headers: { 'x-session-id': sessionId } });
  assert.equal(again.json.data.alreadyRecorded, true);
  assert.equal(await prisma.behaviorEvent.count({ where: { action: 'recommendation_rendered', metadata: { path: ['listId'], equals: list.listId } } }), 1);
  assert.equal((await call('POST', '/events/recommendations/not-a-uuid/rendered', { token: tok.customer })).status, 400);
  if (list.events.length) {
    const click = await call('POST', `/events/recommendations/${list.listId}/click`, { token: tok.customer, headers: { 'x-session-id': sessionId }, body: { eventId: list.events[0].eventId } });
    assert.equal(click.status, 200, click.text);
  }
  // A second list, never rendered: the export leaves it out with its reason
  await recommend({ userId: customer.id, sessionId, surface: 'event' });
  const { report } = await buildExport({ policy: exportPolicy({}, {}), now: new Date(Date.now() + 1000) });
  const excluded = report.datasetsStep5.recommendation_impressions.excluded;
  assert.ok((excluded['served but never shown on screen'] || 0) >= 1, JSON.stringify(excluded));
  // The monitor counts served and rendered lists per group (its counts are cached 60 s: start fresh)
  __setMonitorDeps(null);
  const mon = (await call('GET', '/ml/monitor', { token: tok.admin })).json.data.recommendations;
  const group = mon[list.variant === 'CONTROL' ? 'control' : 'personalised'];
  assert.ok(group.served_lists >= 2 && group.rendered_lists >= 1, JSON.stringify(mon));
  assert.equal(mon.evaluation.metrics, null);
});
