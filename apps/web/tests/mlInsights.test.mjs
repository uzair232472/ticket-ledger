// Step 6: pure helpers of the AI display layer (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bandRows, createRenderTracker, crowdSeries, evaluationText, experimentalState, fetchInsight, modelLine, reasonText, whatIfPrice,
} from '../src/lib/mlInsights.js';

test('experimental state: only value / hidden / unavailable / none', () => {
  assert.equal(experimentalState(null).kind, 'none');
  assert.equal(experimentalState({ hidden: true, unavailable_reason: 'ORGANIZER_VIEW_RULES_ONLY' }).kind, 'hidden');
  assert.match(experimentalState({ hidden: true }).text, /admins only/);
  assert.equal(experimentalState({ value: { predicted: 3 } }).kind, 'value');
  const partly = experimentalState({ value: { predicted: 0 }, unavailable_reason: 'NO_SHADOW_PREDICTIONS_YET' });
  assert.equal(partly.kind, 'value');
  assert.match(partly.text, /not scored anything/);
  assert.equal(experimentalState({ value: null, unavailable_reason: 'NO_MODEL_REGISTERED' }).kind, 'unavailable');
});

test('reason texts: known codes, prefixed codes and unknown codes', () => {
  assert.match(reasonText('TIMEOUT'), /rules are unaffected/);
  assert.match(reasonText('INPUTS_MISSING: event has no capacity'), /inputs/);
  assert.equal(reasonText('SOMETHING_NEW'), 'Not available.');
  assert.equal(reasonText(null), null);
});

test('model line always says it decides nothing and is not validated', () => {
  for (const exp of [null, {}, { model: 'intent', version: 'v0', source: 'synthetic-v0', status: 'SHADOW' }]) {
    assert.match(modelLine(exp), /Not used for any decision/);
  }
  assert.match(modelLine({ model: 'intent', version: 'v0' }), /not validated/);
});

test('evaluation text: counts against minimums, never a metric', () => {
  const t = evaluationText({ status: 'NOT_ENOUGH_DATA', short_of: [{ measure: 'positives', have: 12, need: 100 }] });
  assert.equal(t, 'Not enough real outcomes to evaluate: 12 of 100 positives.');
  assert.equal(evaluationText({ status: 'NO_OUTCOMES_YET', short_of: [] }), 'No real outcomes logged yet.');
  assert.equal(evaluationText(null), null);
});

test('probability bands keep a fixed order', () => {
  assert.deepEqual(bandRows({ '75_and_over': 2, under_25: 1 }).map((r) => r.value), [1, 0, 0, 2]);
});

test('crowd series: rule always first; model only when shown; actual when known', () => {
  const gate = { slots: [{ minutes: -5, rule: 3, model: 4, actual: null }, { minutes: 0, rule: 5, model: 6, actual: null }, { minutes: 5, rule: 2, model: null, actual: null }] };
  const a = crowdSeries(gate);
  assert.deepEqual(a.labels, ['-5', '0', '+5']);
  assert.deepEqual(a.series.map((s) => s.key), ['rule', 'model']);
  assert.deepEqual(a.series[1].values, [4, 6, 0]);
  assert.deepEqual(crowdSeries(gate, { showModel: false }).series.map((s) => s.key), ['rule']);
  gate.slots[0].actual = 1;
  assert.deepEqual(crowdSeries(gate).series.map((s) => s.key), ['rule', 'actual', 'model']);
  assert.deepEqual(crowdSeries({}).series, []);
});

test('what-if price: only when a price was edited', () => {
  const saved = [{ id: 'a', price: '1000' }, { id: 'b', price: '3000' }];
  assert.equal(whatIfPrice(saved, saved.map((t) => ({ ...t, price: Number(t.price) }))), null);
  assert.equal(whatIfPrice(saved, [{ id: 'a', price: 2000 }, { id: 'b', price: 3000 }]), 2500);
  assert.equal(whatIfPrice(saved, []), null);
});

test('render tracker: counts once after half the row is visible for a second', () => {
  const pending = new Map();
  let id = 0;
  const timers = { setTimeout: (fn, ms) => { pending.set(++id, { fn, ms }); return id; }, clearTimeout: (t) => pending.delete(t) };
  const fire = () => { for (const [k, v] of [...pending]) { pending.delete(k); v.fn(); } };
  let seen = 0;
  const t = createRenderTracker({ onSeen: () => { seen += 1; }, timers });
  t.update(0.3);
  assert.equal(pending.size, 0, 'under half: nothing scheduled');
  t.update(0.6);
  assert.equal([...pending.values()][0].ms, 1000);
  t.update(0.2);
  assert.equal(pending.size, 0, 'scrolled away before a second: cancelled');
  t.update(1);
  fire();
  assert.equal(seen, 1);
  t.update(1);
  fire();
  assert.equal(seen, 1, 'only once per list');
  assert.equal(t.seen, true);
});

test('fetchInsight: null on failure, when switched off, or for anything not decided by rules', async () => {
  const api = (data, fail) => ({ get: async () => { if (fail) throw new Error('down'); return { data: { data } }; } });
  assert.equal(await fetchInsight(api(null, true), '/x'), null);
  assert.equal(await fetchInsight(api({ enabled: false }), '/x'), null);
  assert.equal(await fetchInsight(api({ decision_source: 'model', rules: {} }), '/x'), null);
  assert.deepEqual(await fetchInsight(api({ decision_source: 'rules', rules: { a: 1 } }), '/x'), { decision_source: 'rules', rules: { a: 1 } });
});
