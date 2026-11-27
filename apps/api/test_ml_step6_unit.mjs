/**
 * Step 6 unit tests (no database writes, no server):
 *   - the checkout security rules and the pre-launch demand rule, now evaluated in the API, give exactly the
 *     ML service's rule answers (parity with apps/ml-service/main.py on a grid of inputs), so the app behaves the
 *     same whether or not the ML service is up;
 *   - decision paths (checkout, payments, refunds, tickets, gates, pricing, accounts) never import the insight,
 *     monitor or shadow modules; checkout makes no ML call;
 *   - every experimental block says may_serve_decisions:false and validated:false; organizers never get it
 *     unless enabled; no accuracy figure is ever computed in the app;
 *   - flag defaults (production: everything off); the legacy-endpoint rate limit;
 *   - the approval-gate minimums match ml/gates.py.
 *
 *   node --test test_ml_step6_unit.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));
const mlDir = path.join(here, '../ml-service');
const python = [path.join(mlDir, '.venv/Scripts/python.exe'), path.join(mlDir, '.venv/bin/python')].find((p) => fs.existsSync(p));

const { evaluateCheckoutBotRules } = await import('./src/services/security/checkoutBotRules.js');
const { ruleDemandForecast, prelaunchRuleInputs, prelaunchEstimate, tiersWithPrices, publishSuggestion, priceNote } = await import('./src/services/demandRules.js');
const { fraudPayload } = await import('./src/services/mlService.js');
const { mlFlags, publicMlFlags } = await import('./src/config/mlFlags.js');
const { MINIMUMS, evaluationBlock, modelBlock, envelope, shadowRowStats, probabilityBands, demandWhatIf, demandLive } = await import('./src/services/ml/insights.js');
const { forViewer } = await import('./src/controllers/mlInsightsController.js');
const { makeMlLegacyRateLimiter } = await import('./src/middlewares/rateLimit.js');
const prisma = (await import('./src/config/prisma.js')).default;
test.after(() => prisma.$disconnect());

/** Runs `code` in the ML service's Python with `input` as JSON on stdin; returns the parsed stdout JSON. */
function py(code, input) {
  const r = spawnSync(python, ['-c', code], {
    cwd: mlDir, input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ML_ENV: 'production', ML_ALLOW_SYNTHETIC: '', ML_SERVICE_TOKEN: 'x', LOKY_MAX_CPU_COUNT: '2' },
  });
  if (r.status !== 0) throw new Error(r.stderr.slice(-2000));
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// ---------------------------------------------------------------------------------------------
test('checkout security rules: identical to the ML service rule on every input of the grid', { skip: !python && 'ML service venv not found' }, () => {
  const grid = [];
  for (const checkoutDurationSeconds of [undefined, 0, 0.42, 2.0, 2.49, 2.5, 2.99, 3.0, 3.01, 25, 38.5])
    for (const clicksPerMinute of [undefined, 0, 24, 150, 150.1, 340])
      for (const rapidSeatAttempts of [undefined, 0, 1, 4, 5, 6, 14])
        for (const deviceSwitches of [undefined, 0, 1, 2, 3]) grid.push({ checkoutDurationSeconds, clicksPerMinute, rapidSeatAttempts, deviceSwitches });
  const payloads = grid.map((t) => fraudPayload(Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined))));
  const pyOut = py(`
import sys, json
import main
rows = json.load(sys.stdin)
print(json.dumps([main.execute_fraud_score(main.FraudScoreRequest(**r)).model_dump() for r in rows]))`, payloads);
  assert.equal(pyOut.length, grid.length);
  let blocks = 0;
  grid.forEach((t, i) => {
    const js = evaluateCheckoutBotRules(Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)));
    const p = pyOut[i];
    for (const k of ['fraud_score', 'classification', 'is_bot', 'risk_level', 'action_recommended', 'confidence', 'prediction_source', 'validated', 'notice']) {
      assert.deepEqual(js[k], p[k], `${k} for ${JSON.stringify(t)}: js ${js[k]} vs python ${p[k]}`);
    }
    assert.deepEqual(js.anomaly_factors, p.anomaly_factors, JSON.stringify(t));
    if (js.risk_level === 'CRITICAL_BOT') blocks += 1;
  });
  assert.ok(blocks > 100 && blocks < grid.length, 'the grid covers both blocked and allowed checkouts');
});

test('checkout rules: the inputs where the old ML-down fallback disagreed are now decided like the ML service', () => {
  // Before Step 6 the fallback used < 2.5 s and >= 6 seat attempts; the service uses < 3.0 s and >= 5.
  assert.equal(evaluateCheckoutBotRules({ checkoutDurationSeconds: 2.7, clicksPerMinute: 200 }).risk_level, 'CRITICAL_BOT');
  assert.equal(evaluateCheckoutBotRules({ checkoutDurationSeconds: 2.7, rapidSeatAttempts: 5 }).risk_level, 'CRITICAL_BOT');
  assert.equal(evaluateCheckoutBotRules({ checkoutDurationSeconds: 38, clicksPerMinute: 24, rapidSeatAttempts: 1 }).risk_level, 'LOW');
  assert.equal(evaluateCheckoutBotRules({}).risk_level, 'LOW', 'no telemetry: human defaults');
});

test('pre-launch demand rule: identical numbers to the ML service rule branch', { skip: !python && 'ML service venv not found' }, () => {
  const grid = [];
  for (const venueCapacity of [1, 7, 100, 9999, 15000, 25000, 27000, 33333])
    for (const marketingTier of ['LOW', 'MEDIUM', 'HIGH'])
      for (const avgTicketPrice of [500, 2500, 3500.5]) grid.push({ city: 'Lahore', venueCapacity, marketingTier, avgTicketPrice });
  const payloads = grid.map((g) => ({ event_type: 'CRICKET_MATCH', city: g.city, marketing_tier: g.marketingTier, venue_capacity: g.venueCapacity, avg_ticket_price: g.avgTicketPrice, ticket_prices: g.avgTicketPrice, is_weekend: 1 }));
  const pyOut = py(`
import sys, json
import main
rows = json.load(sys.stdin)
print(json.dumps([main.execute_demand_forecast(main.DemandForecastRequest(**r)).model_dump() for r in rows]))`, payloads);
  grid.forEach((g, i) => {
    const js = ruleDemandForecast(g);
    const p = pyOut[i];
    assert.equal(p.prediction_source, 'rules', 'python answered from its rule branch');
    for (const k of ['projected_48h_sales', 'projected_revenue_pkr', 'sellout_probability', 'demand_tier', 'demand_level', 'validated']) {
      assert.deepEqual(js[k], p[k], `${k} for ${JSON.stringify(g)}`);
    }
    assert.match(js.notice, /no trained model/);
  });
});

test('pre-launch rule inputs are the page\'s previous inline computation', () => {
  const ev = { type: 'CRICKET_MATCH', city: 'Karachi', date: '2026-12-05', tiers: [{ price: '1000', totalQuantity: 400 }, { price: '3000', totalQuantity: 600 }] };
  const { capacity, avgPrice, params } = prelaunchRuleInputs(ev);
  assert.equal(capacity, 15000, 'floor of 15,000 seats, as before');
  assert.equal(avgPrice, 2000);
  assert.equal(params.marketingTier, 'HIGH');
  assert.equal(params.isWeekend, 1); // 2026-12-05 is a Saturday
  const sim = prelaunchRuleInputs(ev, { simulatedPrice: '2500', simulatedCapacity: '20000', simulatedMarketingTier: 'LOW' });
  assert.deepEqual([sim.capacity, sim.avgPrice, sim.params.marketingTier], [20000, 2500, 'LOW']);
});

test('pre-launch page rule v2: real capacity, event-dependent demand level, weighted revenue, listed factors', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const tiers = [{ id: 's', price: 3000, totalQuantity: 19 }, { id: 'g', price: 6000, totalQuantity: 19 }, { id: 'p', price: 12000, totalQuantity: 19 }];
  const ev = { type: 'MUSIC_CONCERT', city: 'Lahore', date: '2026-12-25', time: '19:00', status: 'DRAFT', tiers };
  const r = prelaunchEstimate(ev, { now });
  assert.equal(r.capacity, 57, 'no 15,000 floor: the real ticket count');
  assert.ok(r.projected_48h_sales <= 57);
  assert.equal(r.avg_price, 7000);
  // revenue = each tier sells the same share of its own quantity
  const each = Math.floor(19 * r.sellout_probability);
  assert.equal(r.projected_revenue_pkr, each * 3000 + each * 6000 + each * 12000);
  assert.deepEqual(r.factors.map((f) => f.key), ['category', 'price', 'day', 'lead']);
  assert.equal(r.prediction_source, 'rules');

  // The demand level follows the event: cheap weekend cricket vs. very expensive weekday conference
  const cheap = prelaunchEstimate({ type: 'CRICKET_MATCH', date: '2026-12-26', time: '14:00', tiers: [{ id: 'a', price: 1500, totalQuantity: 1000 }] }, { now });
  const dear = prelaunchEstimate({ type: 'CONFERENCE', date: '2026-12-23', time: '10:00', tiers: [{ id: 'a', price: 20000, totalQuantity: 1000 }] }, { now });
  assert.equal(cheap.demand_level, 'VERY_HIGH');
  assert.equal(dear.demand_level, 'LOW');
  assert.ok(cheap.projected_48h_sales > dear.projected_48h_sales);

  // A higher price never raises the estimate
  const up = prelaunchEstimate(ev, { now, tiers: tiersWithPrices(tiers, { prices: { s: 9000, g: 15000, p: 25000 } }) });
  assert.ok(up.sellout_probability <= r.sellout_probability);
  assert.equal(tiers[0].price, 3000, 'what-if prices never change the stored tiers');
  // capacityLimit caps the tiers' total
  assert.equal(prelaunchEstimate({ ...ev, capacityLimit: 40 }, { now }).capacity, 40);
});

test('pre-launch page: live events are not told when to publish; price notes use the weighted price', () => {
  const live = publishSuggestion({ type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: '2026-12-25', publishAt: new Date('2026-11-01T10:00:00Z') });
  assert.equal(live.already_published, true);
  assert.equal(live.time, 'Already on sale');
  const soon = publishSuggestion({ type: 'MUSIC_CONCERT', status: 'DRAFT', date: '2026-11-05' }, { now: new Date('2026-11-01T00:00:00Z') });
  assert.equal(soon.time, 'As soon as possible');
  assert.equal(priceNote({ avgPrice: 7000, benchmark: 4000, share: 0.4 }).level, 'HIGH_PRICE_WARNING');
  assert.equal(priceNote({ avgPrice: 4000, benchmark: 4000, share: 0.4 }).level, 'OPTIMAL_PRICE');
});

// ---------------------------------------------------------------------------------------------
const src = (p) => fs.readFileSync(path.join(here, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(here, dir), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
const AI_MODULES = /ml\/insights|ml\/monitor|ml\/shadow|mlInsightsController|mlFlags|\/v2\/shadow|mlPrediction|mlModel/;

test('decision paths never import the insight, monitor or shadow-log modules', () => {
  const decision = /(payment|payout|refund|checkin|gate|ticket|mint|resale|transfer|gift|scan|booking|pricing|discount|recovery|checkout|seat|venue|account|user|auth|order|invoice)/i;
  const files = walk('src/services').concat(walk('src/controllers'), walk('src/middlewares'))
    .filter((f) => decision.test(path.basename(f)) && !/[\\/]ml[\\/]/.test(f));
  assert.ok(files.length >= 25, files.join(', '));
  for (const f of files) {
    const s = src(f);
    // bookingController logs the fraud shadow row (recordShadow) after the rule decided; it imports nothing else
    const allowed = path.basename(f) === 'bookingController.js' ? s.replace(/import \{[^}]*\} from '\.\.\/services\/ml\/shadow\.js';/, '') : s;
    assert.ok(!AI_MODULES.test(allowed), `${f} must not use AI insight / model output`);
  }
});

test('checkout makes no ML service call; the block reads the rule result only', () => {
  const b = src('src/controllers/bookingController.js');
  assert.ok(!/mlService|mlPost|fetch\(/.test(b));
  assert.match(b, /const fraudEvaluation = evaluateCheckoutBotRules\(validated\.telemetry\);/);
  assert.match(b, /if \(fraudEvaluation\.risk_level === 'CRITICAL_BOT'\)/);
  assert.match(b, /blockedByRules: true/);
  assert.doesNotMatch(b, /blocked by TicketLedger AI/);
  const e = src('src/controllers/eventController.js');
  assert.ok(!/mlService|mlPost/.test(e), 'the pre-launch page makes no ML call');
  assert.doesNotMatch(e, /Gradient Boosting|Historical sports telemetry|squarely with historical/);
});

test('the only writers/readers of the model tables are the ML modules and the read-only insight layer', () => {
  const readers = walk('src').filter((f) => /mlPrediction\.|mlModel\.|"MlPrediction"|"MlModel"/.test(src(f))).map((f) => f.split(path.sep).join('/')).sort();
  assert.deepEqual(readers, ['src/services/ml/export.js', 'src/services/ml/fraudReview.js', 'src/services/ml/insights.js', 'src/services/ml/jobs.js', 'src/services/ml/monitor.js', 'src/services/ml/shadow.js']);
  for (const f of ['src/services/ml/insights.js', 'src/services/ml/monitor.js']) {
    const s = src(f);
    assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(s), `${f} is read-only`);
    assert.ok(!/\$executeRaw/.test(s), `${f} is read-only`);
  }
});

test('insight answers: decision_source rules; experimental never serves decisions, never validated', () => {
  const rogue = { name: 'intent', status: 'ACTIVE', mayServeDecisions: true, version: 'v9', source: 'db-export', sha256: 'a'.repeat(64), evaluationStatus: 'PASSED' };
  const b = modelBlock('intent', rogue);
  assert.equal(b.may_serve_decisions, false, 'even a misconfigured registry row cannot make it serve decisions');
  assert.equal(b.validated, false);
  const none = modelBlock('attendance', null);
  assert.equal(none.unavailable_reason, 'NO_MODEL_REGISTERED');
  const synth = modelBlock('demand', { ...rogue, source: 'synthetic-v0', status: 'SHADOW' });
  assert.match(synth.offline_note, /synthetic data only/);
  const env = envelope('intent', { rules: {}, experimental: b, evaluation: evaluationBlock({ with_outcome: 0 }, { positives: 100 }) });
  assert.equal(env.decision_source, 'rules');
});

test('evaluation: counts against minimums only, never a computed metric', () => {
  const need = { positives: 100, negatives: 100 };
  assert.equal(evaluationBlock({ with_outcome: 0, positives: 0, negatives: 0 }, need).status, 'NO_OUTCOMES_YET');
  const few = evaluationBlock({ with_outcome: 30, positives: 10, negatives: 20 }, need);
  assert.equal(few.status, 'NOT_ENOUGH_DATA');
  assert.deepEqual(few.short_of.map((s) => s.measure), ['positives', 'negatives']);
  const many = evaluationBlock({ with_outcome: 500, positives: 200, negatives: 300 }, need);
  assert.equal(many.status, 'MINIMUMS_REACHED_EVALUATE_OFFLINE');
  for (const e of [few, many]) assert.equal(e.metrics, null);
  const ins = src('src/services/ml/insights.js') + src('src/services/ml/monitor.js');
  assert.doesNotMatch(ins, /\b(auc|precision|recall|accuracy|mape|rmse|brier|f1)\s*[:=]/i, 'no accuracy or performance figure is computed in the app');
});

test('shadow row stats and probability bands', () => {
  const s = shadowRowStats([{ score: 0.2, output: {} }, { score: null, output: { error: 'timeout' } }, { score: null, output: { skipped: 'missing input: x' } }, { score: 0.9, output: {} }]);
  assert.deepEqual([s.rows, s.predicted, s.errors, s.skipped], [4, 2, 1, 1]);
  assert.deepEqual(probabilityBands([0, 0.24, 0.25, 0.5, 0.75, 1]), { under_25: 2, '25_to_50': 1, '50_to_75': 1, '75_and_over': 2 });
});

test('organizers get the rules part only unless ML_INSIGHTS_ORGANIZER is on; never a hidden value', () => {
  const answer = { feature: 'demand', decision_source: 'rules', rules: { projected_48h_sales: 10 }, experimental: { model: 'demand', status: 'SHADOW', value: { sales_48h: 99 }, may_serve_decisions: false, validated: false } };
  const org = forViewer(answer, { role: 'ORGANIZER' }, { organizerInsights: false });
  assert.equal(org.experimental.value, null);
  assert.equal(org.experimental.hidden, true);
  assert.deepEqual(org.rules, answer.rules);
  assert.equal(forViewer(answer, { role: 'SUPER_ADMIN' }, { organizerInsights: false }).experimental.value.sales_48h, 99);
  assert.equal(forViewer(answer, { role: 'ORGANIZER' }, { organizerInsights: true }).experimental.value.sales_48h, 99);
});

test('flags: production defaults are all off; recommendations off everywhere by default', () => {
  assert.deepEqual(mlFlags({ NODE_ENV: 'production' }), { insights: false, organizerInsights: false, recommendations: false, shadow: true, snapshots: true });
  assert.deepEqual(mlFlags({ NODE_ENV: 'development' }).recommendations, false);
  assert.equal(mlFlags({ NODE_ENV: 'development' }).insights, true);
  assert.equal(mlFlags({ ML_REC_DISPLAY: 'true' }).recommendations, true);
  assert.equal(mlFlags({ NODE_ENV: 'production', ML_INSIGHTS_ENABLED: '1' }).insights, true);
  assert.deepEqual(publicMlFlags({ NODE_ENV: 'development', ML_INSIGHTS_ORGANIZER: 'true' }), { insights: true, organizerInsights: true, recommendations: false });
  assert.deepEqual(Object.values(publicMlFlags({})).map((v) => typeof v), ['boolean', 'boolean', 'boolean'], 'only booleans reach the browser');
});

test('legacy ML endpoints: the per-admin rate limit answers 429 past the limit', async () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
  app.post('/x', makeMlLegacyRateLimiter({ limit: 2, skip: () => false }), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/x`;
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await fetch(url, { method: 'POST' })).status);
  server.close();
  assert.deepEqual(codes, [200, 200, 429]);
});

test('demand what-if: one call with a short timeout, never stored or applied; failures are labelled', async () => {
  const calls = [];
  const model = { name: 'demand', sha256: 'b'.repeat(64) };
  // demandSnapshot needs the database: a missing event gives a labelled INPUTS_MISSING, not an exception
  const missing = await demandWhatIf({ id: '00000000-0000-0000-0000-000000000000' }, model, { price: 100 }, async () => { calls.push(1); });
  assert.match(missing.unavailable_reason, /^INPUTS_MISSING/);
  assert.equal(calls.length, 0);
  const ins = src('src/services/ml/insights.js');
  assert.match(ins, /const WHAT_IF_TIMEOUT_MS = Number\(process\.env\.ML_WHAT_IF_TIMEOUT_MS\) \|\| 1500;/);
  const live = await demandLive({ id: '00000000-0000-0000-0000-000000000000' }, model, null, async () => { calls.push(1); });
  assert.match(live.unavailable_reason, /^INPUTS_MISSING/);
  assert.equal(live.current, null);
  assert.equal(calls.length, 0);
  assert.match(ins, /stored: false, applied: false/);
});

test('approval-gate minimums match apps/ml-service/ml/gates.py', () => {
  const g = fs.readFileSync(path.join(mlDir, 'ml/gates.py'), 'utf8');
  for (const [k, v] of Object.entries(MINIMUMS)) {
    const m = g.match(new RegExp(`"${k}":\\s*(\\d+)`));
    assert.ok(m, `${k} missing from gates.py`);
    assert.equal(Number(m[1]), v, k);
  }
  const rec = fs.readFileSync(path.join(mlDir, 'ml/insights.py'), 'utf8').match(/REC_MIN = \{"impressions": (\d+)/);
  assert.equal(Number(rec[1]), 1000);
});
