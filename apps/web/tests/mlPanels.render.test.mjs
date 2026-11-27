// Step 6: offline renders (react-dom/server) of the AI panels in every state: values, organizer (hidden),
// unavailable (ML down / no model), flags off (no data). Bundled with esbuild; no browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ml-render-'));
const entry = path.join(out, 'entry.jsx');
fs.writeFileSync(entry, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as P from ${JSON.stringify(path.join(here, '../src/components/ml/InsightPanels.jsx'))};
exports.P = P;
exports.render = (name, props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(P[name], props)));
`);
await build({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'bundle.cjs'),
  jsx: 'automatic', loader: { '.css': 'empty', '.js': 'jsx' }, define: { 'import.meta.env': '{}' }, logLevel: 'error',
  nodePaths: [path.join(here, '../node_modules'), path.join(here, '../../../node_modules')],
});
// Minimal browser globals for modules that touch them when loaded (the session layer patches fetch); nothing
// here makes a request: every panel below gets its data directly
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { render, P } = createRequire(import.meta.url)(path.join(out, 'bundle.cjs'));
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const exp = (value, extra = {}) => ({ model: 'intent', status: 'SHADOW', may_serve_decisions: false, validated: false, version: 'v0', source: 'synthetic-v0', sha256_12: 'abc', offline_note: 'Trained and checked offline on synthetic data only (PASSED). Not validated on real outcomes.', value, unavailable_reason: null, ...extra });
const evaluation = { status: 'NOT_ENOUGH_DATA', short_of: [{ measure: 'positives', have: 3, need: 100 }], metrics: null };
const intent = (experimental) => ({ decision_source: 'rules', rules: { visits_scored: 3, by_level: { HIGH: 1, MODERATE: 1, LOW: 1 }, mean_rule_score: 61.7, rule: '40 + 15 (3+ views)' }, experimental, evaluation });

test('intent panel: rule figures first; experimental block labelled and muted', () => {
  const html = render('IntentInsightPanel', { data: intent(exp({ rows: 3, predicted: 2, skipped: 0, errors: 1, mean_probability: 0.5, probability_bands: { under_25: 1, '50_to_75': 1 }, same_direction_as_rule: { visits: 2, share: 0.5 } })) });
  assert.ok(html.indexOf('Rules decide') < html.indexOf('Experimental'), 'rules first');
  assert.match(html, /not used for any decision/i);
  assert.match(html, /not validated/i);
  assert.match(html, /<details class="tl-ml-x"/, 'collapsed by default');
  assert.match(html, /Not enough real outcomes to evaluate: 3 of 100 positives/);
  assert.doesNotMatch(html, /accuracy:|precision:|AUC/i);
});

test('organizer view: experimental values hidden, rules still shown', () => {
  const html = render('IntentInsightPanel', { data: intent({ model: 'intent', status: 'SHADOW', value: null, hidden: true, may_serve_decisions: false, validated: false, unavailable_reason: 'ORGANIZER_VIEW_RULES_ONLY' }) });
  assert.match(html, /Visits scored/);
  assert.match(html, /shown to platform admins only/);
  assert.doesNotMatch(html, /Average probability/);
});

test('ML unavailable / no model: the reason is shown, the rule figures are unchanged', () => {
  const down = render('IntentInsightPanel', { data: intent(exp(null, { unavailable_reason: 'NO_SHADOW_PREDICTIONS_YET' })) });
  assert.match(down, /not scored anything/);
  const att = render('AttendanceInsightPanel', { data: { decision_source: 'rules', rules: { live_tickets: 10, expected_attendance: 8, checked_in_so_far: 0, show_rate_percent: 80, basis: 'FIXED_RULE', factors: [] }, experimental: exp(null, { model: 'attendance', status: null, unavailable_reason: 'NO_MODEL_REGISTERED' }), evaluation } });
  assert.match(att, /Expected to attend/);
  assert.match(att, /No experimental model exists/);
  assert.match(att, /Gate admission never uses this estimate/);
});

test('flags off or failed call (no data): panels render nothing', () => {
  for (const name of ['IntentInsightPanel', 'AbandonmentInsightPanel', 'DemandInsightPanel', 'AttendanceInsightPanel', 'CrowdInsightPanel']) {
    assert.equal(render(name, {}), '', name);
  }
});

test('demand what-if: says it is not saved and not applied; failures labelled', () => {
  const base = { decision_source: 'rules', rules: { projected_48h_sales: 100, latest_hourly_pace: null }, evaluation };
  const ok = render('DemandInsightPanel', { data: { ...base, experimental: exp({ latest_logged: null, logged: {}, what_if: { sales_48h: 1234, low: 1000, high: 1500, stored: false, applied: false } }, { model: 'demand' }) } });
  assert.match(ok, /not saved, not applied/);
  assert.match(ok, /1,234/);
  assert.match(ok, /never changes prices or publishes/);
  const timeout = render('DemandInsightPanel', { data: { ...base, experimental: exp({ latest_logged: null, logged: {}, what_if: { unavailable_reason: 'TIMEOUT' } }, { model: 'demand' }) } });
  assert.match(timeout, /did not answer in time/);
});

test('demand live reading: model number next to the rule, and what moves it', () => {
  const html = render('DemandInsightPanel', { data: { decision_source: 'rules', rules: { projected_48h_sales: 19, latest_hourly_pace: null }, evaluation, experimental: exp({ latest_logged: null, logged: {}, current: { sales_48h: 14.7, low: 5.8, high: 23.6, stored: false, applied: false }, sensitivity: [{ key: 'price_up', label: 'Prices 20% higher', sales_48h: 13.7, change: -1 }], what_if: null }, { model: 'demand' }) } });
  assert.match(html, /live call, not saved, not applied/);
  assert.match(html, /14\.7/);
  assert.match(html, /Rule estimate/);
  assert.match(html, /Prices 20% higher/);
  assert.match(html, /-1 tickets/);
});

test('crowd panel: missing gate capacity explained; never suggests admission changes', () => {
  const html = render('CrowdInsightPanel', { data: { decision_source: 'rules', rules: { readiness: { ready: false, reason: 'GATE_CAPACITY_MISSING', missingCapacity: ['Gate A'] }, gates: [] }, experimental: exp(null, { model: 'crowd', unavailable_reason: 'NO_SHADOW_PREDICTIONS_YET' }), evaluation } });
  assert.match(html, /set a capacity per hour on Gate A/);
  assert.match(html, /never use these numbers/);
});

test('an error inside a panel is contained by InsightBoundary (renders nothing, page unaffected)', () => {
  // Server rendering does not run error boundaries, so the boundary's two steps are checked directly
  assert.deepEqual(P.InsightBoundary.getDerivedStateFromError(new Error('bad answer')), { failed: true });
  const b = new P.InsightBoundary({ children: 'panel' });
  assert.equal(b.render(), 'panel');
  b.state = { failed: true };
  assert.equal(b.render(), null);
  // A malformed answer really does throw inside a panel (which the boundary then hides)
  assert.throws(() => render('IntentInsightPanel', { data: { decision_source: 'rules', experimental: null } }));
});
