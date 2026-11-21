#!/usr/bin/env node
/**
 * Exports the five ML training datasets from this API's database (read-only: changes nothing).
 *
 *   node scripts/ml-export-datasets.mjs [--out DIR] [--as-of ISO]
 *
 * Output (default ../ml-service/exports/<UTC timestamp>/, git-ignored): the five CSVs, events.csv, manifest.json
 * (source "db-export", hashes, label counts, the models the app currently runs), export_report.json/.md.
 * Then:  python scripts/validate_datasets.py --data DIR   and   python scripts/auto_retrain.py --data DIR
 *
 * Rows only come from prediction-time snapshots, and a purchase only counts with server-side LIVE payment
 * evidence (services/paymentEvidence.js) - never from settings or order rows. A development database with
 * test keys therefore exports no purchase-based labels. Test domains, internal domains and excluded ids:
 * ML_EXPORT_TEST_DOMAINS, ML_EXPORT_INTERNAL_DOMAINS, ML_EXPORT_EXCLUDE_USERS, ML_EXPORT_EXCLUDE_EVENTS.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import prisma from '../src/config/prisma.js';
import { COLUMNS, buildExport, exportPolicy } from '../src/services/ml/export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (cols, rows) => `${[cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')}\n`;
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function markdown(report, manifest) {
  const L = [`# ML training export ${report.exportedAt}`, '', `Source \`db-export\`. Orders with server-verified LIVE payment evidence: ${report.payments.liveVerifiedOrders}${report.payments.firstLiveVerifiedPayment ? ` (first ${report.payments.firstLiveVerifiedPayment})` : ' (**none**: no purchase-based labels)'}. Every row comes from a prediction-time snapshot.`, '',
    '| Dataset | Rows kept | Duplicates dropped | Left out |', '|---|---|---|---|'];
  for (const [k, d] of Object.entries(report.datasets)) {
    const out = Object.values(d.excluded).reduce((a, b) => a + b, 0);
    L.push(`| ${k} | ${d.kept} | ${d.duplicatesDropped} | ${out} |`);
  }
  L.push('', '## Why rows were left out');
  for (const [k, d] of Object.entries(report.datasets)) {
    const ex = Object.entries(d.excluded).sort((a, b) => b[1] - a[1]);
    L.push(`- **${k}**: ${ex.length ? ex.map(([r, n]) => `${r} (${n})`).join('; ') : 'nothing'}`);
  }
  L.push('', '## Labels');
  for (const [k, d] of Object.entries(report.datasets)) L.push(`- **${k}**: ${JSON.stringify(d.labels)}${d.problems.length ? ` - PROBLEMS: ${d.problems.join('; ')}` : ''}`);
  const f = report.fraudLabels;
  L.push('', '## Fraud labels (blind reviews only)', `Resolved blind reviews: ${f.resolved}. Unresolved: ${f.unresolved}. Exposed-only (reviewer had seen detector output): ${f.exposedOnly}. Selected but unreviewed: ${f.unreviewed}. Not selected: ${f.sampledNotSelected}. Not yet sampled: ${f.notSampled}.`,
    `Blocked checkouts (no order, so no outcome can be verified): ${f.blockedCheckouts} ${JSON.stringify(f.blockedByRuleDecision)}.`,
    '', '## Interventions inside label windows', `Intent rows whose 7-day window contained a cart-recovery reminder: ${report.interventions.intentRowsWithReminderInWindow} (kept; the label includes the effect of current reminders). Abandonment rows with a reminder inside the visit: ${report.interventions.abandonmentRowsWithReminderInWindow} (should be 0: reminders are sent at least 1 h after a checkout lapses).`,
    '', '## Crowd readiness', `Events with crowd snapshots: ${report.crowdReadiness.snapshotted}; finished real events without one: ${JSON.stringify(report.crowdReadiness.finishedWithoutSnapshot)}.`,
    '', '## Models the app runs now (compared against by the retraining)', ...Object.entries(manifest.deployed_models).map(([n, m]) => `- ${n}: \`${m.sha256.slice(0, 12)}\` (${m.source})`), '');
  return L.join('\n');
}

async function main() {
  const now = arg('--as-of') ? new Date(arg('--as-of')) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('--as-of is not a date');
  if (arg('--live-payments') !== undefined) throw new Error('--live-payments was removed: only server-side live payment evidence counts.');
  const policy = exportPolicy();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const out = path.resolve(arg('--out') || path.join(here, '../../ml-service/exports', stamp));
  fs.mkdirSync(out, { recursive: true });

  const { datasets, events, report } = await buildExport({ policy, now });
  const files = {};
  let first = now.toISOString();
  for (const [name, rows] of Object.entries(datasets)) {
    const file = path.join(out, `${name}.csv`);
    fs.writeFileSync(file, toCsv(COLUMNS[name], rows));
    const ts = rows.map((r) => r.ts).sort();
    if (ts.length && ts[0] < first) first = ts[0];
    files[name] = { file: `${name}.csv`, rows: rows.length, columns: COLUMNS[name], labels: report.datasets[name].labels, ts_from: ts[0] ?? null, ts_to: ts.at(-1) ?? null, sha256: sha256(file) };
  }
  fs.writeFileSync(path.join(out, 'events.csv'), toCsv(['event_id', 'sales_open', 'event_start'], events));
  const manifest = {
    source: 'db-export', exporter_version: '1.0.0', exported_at: now.toISOString(), history: { from: first, to: now.toISOString() },
    countries: [report.country], currencies: { PK: 'PKR' }, timezones: { PK: 'Asia/Karachi' }, scale: 1.0,
    files, deployed_models: report.deployedModels, policy: report.policy, payments: report.payments,
    feature_sources: ['snapshot'], contains_test_data: false,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(out, 'export_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'export_report.md'), markdown(report, manifest));
  const problems = Object.entries(report.datasets).filter(([, d]) => d.problems.length);
  for (const [k, d] of Object.entries(report.datasets)) console.log(`${k.padEnd(20)} ${String(d.kept).padStart(7)} rows`);
  console.log(`\nWritten to ${out}`);
  if (problems.length) { console.error(`Row problems in: ${problems.map(([k]) => k).join(', ')} (see export_report.md)`); process.exitCode = 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
