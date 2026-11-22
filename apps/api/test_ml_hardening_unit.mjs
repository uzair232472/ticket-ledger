/**
 * Stage 4 hardening checks that need no database writes:
 *   - the demand average price stays within the tier prices (identical, unusual and mixed tiers);
 *   - no model can decide: only the rules decide checkout blocks; payments, tickets and gate admission
 *     never read model output or the shadow log.
 *
 *   node --test test_ml_hardening_unit.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { avgTierPrice } = await import('./src/services/ml/features.js');
const { refuseSyntheticInProduction } = await import('./src/services/mlService.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const tiers = (...p) => p.map((price) => ({ price }));

test('average price: identical tiers (rounding can no longer exceed the maximum)', () => {
  assert.equal(avgTierPrice(tiers(7777, 7777, 7777)), 7777);
  assert.equal(avgTierPrice(tiers(1005)), 1005);
  assert.equal(avgTierPrice(tiers(995, 995)), 995);
  assert.equal(avgTierPrice(tiers(1000, 1000)), 1000);
});

test('average price: unusual prices (tiny, fractional, huge, Decimal strings)', () => {
  assert.equal(avgTierPrice(tiers(1)), 1);
  assert.equal(avgTierPrice(tiers(1, 2)), 1, 'mean 1.5 rounds to 0 (tens), then is held at the cheapest tier');
  assert.equal(avgTierPrice(tiers('999.99', '1000.01')), 1000);
  assert.equal(avgTierPrice(tiers(0.5, 0.5)), 0.5);
  assert.equal(avgTierPrice(tiers(2_500_000, 7_499_995)), 5_000_000);
});

test('average price: mixed tiers keep the training rounding and min <= avg <= max', () => {
  assert.equal(avgTierPrice(tiers(1000, 3000)), 2000);
  assert.equal(avgTierPrice(tiers(1000, 1500, 4000)), 2170);
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let i = 0; i < 2000; i++) {
    const p = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => Math.round(rand() * 20000 * 100) / 100);
    const a = avgTierPrice(tiers(...p));
    assert.ok(a >= Math.min(...p) && a <= Math.max(...p), `${p} -> ${a}`);
  }
});

// ---------------------------------------------------------------------------------------------
const src = (p) => fs.readFileSync(path.join(here, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(here, dir), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));

test('payments, tickets, refunds and gate admission never read model output or the shadow log', () => {
  const guarded = walk('src/services').filter((f) => /(payment|payout|refund|checkin|gate|ticket|mint|resale|transfer|gift|scan)/i.test(path.basename(f)))
    .concat(walk('src/controllers').filter((f) => /(checkin|gate|ticket|resale|transfer|refund|payment)/i.test(path.basename(f))));
  assert.ok(guarded.length >= 8, guarded.join(', '));
  for (const f of guarded) {
    const s = src(f);
    assert.ok(!/mlPrediction|mlModel|\/v2\/shadow|services\/ml\/shadow|from '\.\/ml\/shadow|mlService/.test(s), `${f} must not use model output`);
  }
});

test('the shadow log and model registry are only written/read by the ML modules (never by a decision path)', () => {
  const readers = walk('src').filter((f) => /mlPrediction\.|mlModel\.|"MlPrediction"|"MlModel"/.test(src(f))).map((f) => f.split(path.sep).join('/')).sort();
  // Step 6 adds the read-only insight layer (insights.js, monitor.js; test_ml_step6_unit.mjs checks they never write)
  assert.deepEqual(readers, ['src/services/ml/export.js', 'src/services/ml/fraudReview.js', 'src/services/ml/insights.js', 'src/services/ml/jobs.js', 'src/services/ml/monitor.js', 'src/services/ml/shadow.js']);
  // The only consumer of a shadow decision is the blind-review SAMPLING (which orders humans review)
  assert.ok(!/WOULD_FLAG/.test(src('src/controllers/bookingController.js')));
});

test('checkout blocks only on the rules result; the model shadow call cannot change it', () => {
  const b = src('src/controllers/bookingController.js');
  // The block decision reads the rules evaluation; recordShadow returns nothing the decision could use
  assert.match(b, /if \(fraudEvaluation\.risk_level === 'CRITICAL_BOT'\)/);
  // Step 6: the rules are evaluated in the API; checkout makes no ML service call at all
  assert.match(b, /const fraudEvaluation = evaluateCheckoutBotRules\(validated\.telemetry\);/);
  assert.ok(!/mlService|mlPost/.test(b), 'checkout never calls the ML service');
  assert.ok(!/await recordShadow|=\s*recordShadow|fraudShadow\([^)]*\)\s*\./.test(b));
  const m = src('../ml-service/main.py');
  const fraud = m.slice(m.indexOf('def execute_fraud_score'), m.indexOf('def execute_demand_forecast'));
  assert.ok(!/predict_proba|fraud_pkg\[/.test(fraud), 'the /fraud/score decision never uses a trained model');
});

test('in production the API never uses a synthetic (or unlabelled) model answer', () => {
  const prod = { NODE_ENV: 'production' };
  assert.throws(() => refuseSyntheticInProduction({ prediction_source: 'synthetic-demo-model' }, prod), /only rule-based/);
  assert.throws(() => refuseSyntheticInProduction({ projected_48h_sales: 5 }, prod), /unknown source/);
  assert.deepEqual(refuseSyntheticInProduction({ prediction_source: 'rules', x: 1 }, prod), { prediction_source: 'rules', x: 1 });
  assert.equal(refuseSyntheticInProduction({ prediction_source: 'synthetic-demo-model' }, { NODE_ENV: 'development' }).prediction_source, 'synthetic-demo-model', 'development demos allowed (labelled)');
});
