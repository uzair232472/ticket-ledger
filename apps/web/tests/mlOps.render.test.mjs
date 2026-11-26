// Offline renders (react-dom/server) of the model-ops additions: the demand panel's range band and reasons, the
// model-card charts and the account graph's opening state. Bundled with esbuild; no browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ml-ops-'));
const entry = path.join(out, 'entry.jsx');
const src = (p) => JSON.stringify(path.join(here, '../src', p));
fs.writeFileSync(entry, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import * as P from ${src('components/ml/InsightPanels.jsx')};
import * as C from ${src('components/ml/charts.jsx')};
import AccountGraph from ${src('components/ml/AccountGraph.jsx')};
const all = { ...P, ...C, AccountGraph };
exports.render = (name, props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(all[name], props)));
`);
await build({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'bundle.cjs'),
  jsx: 'automatic', loader: { '.css': 'empty', '.js': 'jsx', '.svg': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}' }, logLevel: 'error',
  nodePaths: [path.join(here, '../node_modules'), path.join(here, '../../../node_modules')],
});
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { render } = createRequire(import.meta.url)(path.join(out, 'bundle.cjs'));
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const demand = {
  decision_source: 'rules',
  rules: { projected_48h_sales: 400, sellout_probability: 0.2, demand_tier: 'MEDIUM', capacity: 1000 },
  experimental: {
    model: 'demand', status: 'SHADOW', may_serve_decisions: false, validated: false, version: 'v0', source: 'synthetic-v0', unavailable_reason: null,
    value: {
      current: { sales_48h: 520, low: 380, high: 660, capacity: 1000, range_offline_coverage: 0.81, stored: false, applied: false,
        reasons: [{ feature: 'organizer_past_sell_through_48h', label: "organizer's past 48-hour sell-through", value: 0.71, typical: 0.42, effect: 64.2, direction: 'up' },
          { feature: 'avg_price_rel', label: 'average price vs typical', value: 1.4, typical: 1, effect: -22.5, direction: 'down' }] },
      sensitivity: [], logged: { rows: 0 },
    },
  },
  evaluation: { status: 'NO_OUTCOMES_YET', short_of: [], metrics: null },
};

test('demand panel: 80% range band with its offline coverage, and the reasons with direction and units', () => {
  const html = render('DemandInsightPanel', { data: demand });
  assert.match(html, /tl-ml-range-band/);
  assert.match(html, /80% range 380 to 660 of 1,000 seats; forecast 520; rule 400/);
  assert.match(html, /held the real 48-hour sales 81% of the time/);
  assert.match(html, /organizer&#x27;s past 48-hour sell-through/);
  assert.match(html, /\+64\.2 tickets/);
  assert.match(html, /-22\.5 tickets/);
  assert.match(html, /do not add up to the forecast/);
});

test('demand panel without reasons or coverage (older model): no reason list, no coverage sentence', () => {
  const d = structuredClone(demand);
  delete d.experimental.value.current.reasons;
  d.experimental.value.current.range_offline_coverage = null;
  const html = render('DemandInsightPanel', { data: d });
  assert.doesNotMatch(html, /Why the model says this/);
  assert.doesNotMatch(html, /of the time/);
  assert.match(html, /tl-ml-range-band/);
});

test('charts: lines carry direct end labels; calibration has the diagonal; bars keep labels and values as text', () => {
  const line = render('LineChart', { labels: ['a', 'b', 'c'], series: [{ key: 'model', name: 'AI model', color: '#257de0', values: [0.8, 0.82, null] }, { key: 'rule', name: 'Current rule', color: '#f47230', values: [0.7, 0.71, 0.72] }], format: (v) => `${Math.round(v * 100)}%`, ariaLabel: 'x' });
  assert.match(line, />AI model</);
  assert.match(line, />Current rule</);
  assert.equal((line.match(/<circle/g) || []).length, 5, 'a missing value is a gap, not a zero');
  const cal = render('CalibrationChart', { bins: [{ predicted: 0.1, actual: 0.12, rows: 10 }, { predicted: 0.5, actual: 0.45, rows: 10 }] });
  assert.match(cal, /perfect/);
  const bars = render('BarList', { items: [{ label: 'clicks per minute', value: 0.12 }, { label: 'city', value: 0 }], format: (v) => v.toFixed(2) });
  assert.match(bars, /clicks per minute.*0\.12/);
  assert.match(render('LineChart', { labels: [], series: [{ key: 'm', name: 'm', color: '#000', values: [] }] }), /No values to plot/);
});

test('account graph: nothing is loaded until asked, and the exposure warning is shown first', () => {
  const html = render('AccountGraph', { userId: '00000000-0000-0000-0000-000000000000' });
  assert.match(html, /Show linked accounts/);
  assert.match(html, /will not count as blind/);
  assert.doesNotMatch(html, /<svg[^>]*aria-label="Graph of linked accounts"/);
});
