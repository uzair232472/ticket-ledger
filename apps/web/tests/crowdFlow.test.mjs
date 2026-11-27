// Crowd-flow chart data (lib/crowdFlow.js): per-slot values, capacity per 5 minutes, gaps for missing data,
// actual scans only where recorded, the AI only when the viewer may see it, stable gate colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableSources, busiestSlot, chartSeries, gatesOf, GATE_COLORS, ruleNote } from '../src/lib/crowdFlow.js';

const slot = (minutes, o = {}) => ({ minutes, rule: null, model: null, model_low: null, model_high: null, model_p_over: null, actual: null, ...o });
const data = (over = {}) => ({
  rules: { gates: [
    { gate_id: 'b', gate: 'Gate B', capacity_per_hour: 120, slots: [slot(-10, { rule: 8, model: 9, model_low: 5, model_high: 13, model_p_over: 0.2 }), slot(-5, { rule: 12, model: 14, model_p_over: 0.7, actual: 11 }), slot(0, { rule: 6 })] },
    { gate_id: 'a', gate: 'Gate A', capacity_per_hour: null, slots: [slot(-10, { rule: 3 }), slot(-5, { rule: 4 }), slot(0, { rule: 2 })] },
  ] },
  experimental: { hidden: false }, ...over,
});

test('gates in name order with fixed colours; capacity per 5 minutes = per hour / 12; no capacity = null', () => {
  const g = gatesOf(data());
  assert.deepEqual(g.map((x) => x.name), ['Gate A', 'Gate B']);
  assert.deepEqual(g.map((x) => x.color), GATE_COLORS.slice(0, 2));
  assert.equal(g[1].capacityPerSlot, 10);
  assert.equal(g[0].capacityPerSlot, null);
});

test('all gates: one line per gate for the source, capacity dashed only where set; missing values are null, never 0', () => {
  const r = chartSeries(data(), { source: 'actual' });
  assert.equal(r.source, 'actual');
  const b = r.series.find((s) => s.key === 'b:actual');
  assert.deepEqual(b.values, [null, 11, null], 'actual scans only where recorded');
  assert.deepEqual(r.series.find((s) => s.key === 'a:actual').values, [null, null, null]);
  assert.deepEqual(r.series.filter((s) => s.kind === 'capacity').map((s) => s.key), ['b:capacity']);
  assert.deepEqual(r.series.find((s) => s.key === 'b:capacity').values, [10, 10, 10]);
  assert.ok(r.series.every((s) => !s.values.includes(0)), 'no invented zeros');
});

test('one gate: rule, AI with its range and overload chance, actual, capacity', () => {
  const r = chartSeries(data(), { gateId: 'b' });
  assert.deepEqual(r.series.map((s) => s.key), ['rule', 'model', 'actual', 'capacity']);
  const ai = r.series.find((s) => s.key === 'model');
  assert.deepEqual(ai.band, [[5, null, null], [13, null, null]]);
  assert.deepEqual(r.pOver, [0.2, 0.7, null]);
  assert.deepEqual(r.series.find((s) => s.key === 'rule').values, [8, 12, 6], 'per slot, not cumulative');
});

test('the AI is left out when the viewer may not see it; nothing recorded = source not offered', () => {
  const hidden = data({ experimental: { hidden: true } });
  assert.equal(availableSources(hidden).model, false);
  assert.deepEqual(chartSeries(hidden, { gateId: 'b' }).series.map((s) => s.key), ['rule', 'actual', 'capacity']);
  assert.equal(chartSeries(hidden, { gateId: 'b' }).pOver, null);
  const none = data();
  none.rules.gates[0].slots[1].actual = null;
  assert.equal(availableSources(none).actual, false);
  assert.equal(chartSeries(none, { source: 'actual' }).source, 'rule', 'falls back to the rule when nothing was scanned');
});

test('default selection: the busiest slot over all gates', () => {
  assert.equal(busiestSlot(data()), -5);
  assert.equal(busiestSlot({ rules: { gates: [] } }), null);
});

test('rule note: always explains the equal loads; says where the timing comes from', () => {
  assert.match(ruleNote({ rules: { curve_basis: 'default' } }), /same load.*no past gate scans yet/s);
  assert.match(ruleNote({ rules: { curve_basis: 't:CRICKET_MATCH' } }), /learned from past cricket match events/);
  assert.match(ruleNote({ rules: { curve_basis: 'all' } }), /past events of all types/);
  assert.match(ruleNote({ rules: {} }), /^The rule shares people out by gate capacity/);
});
