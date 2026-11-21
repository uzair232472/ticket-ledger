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
import { once } from 'node:events';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import prisma from '../src/config/prisma.js';
import { COLUMNS, COLUMNS_STEP5, buildExport, exportPolicy } from '../src/services/ml/export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (cols, rows) => `${[cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')}\n`;
const line = (cols, r) => `${cols.map((c) => cell(r[c])).join(',')}
`;

/**
 * Streams each dataset to its CSV file while the export runs (rows are never all in memory) and hashes the
 * bytes as they are written. Same bytes as toCsv(cols, rows) of the whole dataset.
 */
export class CsvFileSink {
  constructor(dir) { this.dir = dir; this.files = {}; }
  open(name, cols) {
    const stream = fs.createWriteStream(path.join(this.dir, `${name}.csv`));
    const hash = createHash('sha256');
    this.files[name] = { stream, hash, cols, rows: 0, tsFrom: null, tsTo: null };
    this.put(name, `${cols.join(',')}
`);
  }
  put(name, text) {
    const f = this.files[name];
    f.hash.update(text);
    return f.stream.write(text);
  }
  async write(name, row) {
    const f = this.files[name];
    f.rows += 1;
    const ts = row.ts || row.first_seen;
    if (ts) { if (!f.tsFrom || ts < f.tsFrom) f.tsFrom = ts; if (!f.tsTo || ts > f.tsTo) f.tsTo = ts; }
    if (!this.put(name, line(f.cols, row))) await once(f.stream, 'drain');
  }
  async close() {
    const out = {};
    for (const [name, f] of Object.entries(this.files)) {
      await new Promise((resolve, reject) => f.stream.end((e) => (e ? reject(e) : resolve())));
      out[name] = { file: `${name}.csv`, rows: f.rows, columns: f.cols, ts_from: f.tsFrom, ts_to: f.tsTo, sha256: f.hash.digest('hex') };
    }
    return out;
  }
}

function markdown(report, manifest) {
  const L = [`# ML training export ${report.exportedAt}`, '', `Source \`db-export\`. Orders with server-verified LIVE payment evidence: ${report.payments.liveVerifiedOrders}${report.payments.firstLiveVerifiedPayment ? ` (first ${report.payments.firstLiveVerifiedPayment})` : ' (**none**: no purchase-based labels)'}. Every row comes from a prediction-time snapshot.`, '',
    '| Dataset | Rows kept | Duplicates dropped | Left out |', '|---|---|---|---|'];
  const all = { ...report.datasets, ...report.datasetsStep5 };
  for (const [k, d] of Object.entries(all)) {
    const out = Object.values(d.excluded).reduce((a, b) => a + b, 0);
    L.push(`| ${k} | ${d.kept} | ${d.duplicatesDropped} | ${out} |`);
  }
  L.push('', '## Data-source classes', 'Every row kept is GENUINE_CUSTOMER (a real customer account, a real organizer, verified outcomes). Left out:', '',
    ...Object.entries(report.excludedBySourceClass).map(([c, n]) => `- ${c}: ${n}`),
    '', 'SYNTHETIC (`data/`, `dev/legacy-synthetic/`) and PUBLIC (`data/public/`) datasets are never part of an export.');
  L.push('', '## Why rows were left out');
  for (const [k, d] of Object.entries(all)) {
    const ex = Object.entries(d.excluded).sort((a, b) => b[1] - a[1]);
    L.push(`- **${k}**: ${ex.length ? ex.map(([r, n]) => `${r} (${n})`).join('; ') : 'nothing'}`);
  }
  L.push('', '## Labels');
  for (const [k, d] of Object.entries(report.datasets)) L.push(`- **${k}**: ${JSON.stringify(d.labels)}${d.problems.length ? ` - PROBLEMS: ${d.problems.join('; ')}` : ''}`);
  const f = report.fraudLabels;
  L.push('', '## Fraud labels (blind reviews only)', `Resolved blind reviews: ${f.resolved}. Unresolved: ${f.unresolved}. Exposed-only (reviewer had seen detector output): ${f.exposedOnly}. Selected but unreviewed: ${f.unreviewed}. Not selected: ${f.sampledNotSelected}. Not yet sampled: ${f.notSampled}.`,
    `Blocked checkouts (no order, so no outcome can be verified): ${f.blockedCheckouts} ${JSON.stringify(f.blockedByRuleDecision)}.`,
    '', '## Interventions inside label windows', `Intent rows whose 7-day window contained a cart-recovery reminder: ${report.interventions.intentRowsWithReminderInWindow} (kept; the label includes the effect of current reminders). Abandonment rows with a reminder inside the visit: ${report.interventions.abandonmentRowsWithReminderInWindow} (should be 0: reminders are sent at least 1 h after a checkout lapses).`,
    '', '## Checkout outcomes (abandonment = hold expired, no failed payment, nothing bought within 24 h)', JSON.stringify(report.checkoutOutcomes),
    '', '## Attendance data quality (finished real events)', JSON.stringify(report.attendanceQuality),
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

  // One consistent database snapshot; rows streamed to the CSV files as they are produced
  const sink = new CsvFileSink(out);
  const { events, report } = await buildExport({ policy, now, sink });
  const written = await sink.close();
  const files = {};
  let first = now.toISOString();
  for (const name of Object.keys(COLUMNS)) {
    const f = written[name];
    if (f.ts_from && f.ts_from < first) first = f.ts_from;
    files[name] = { file: f.file, rows: f.rows, columns: f.columns, labels: report.datasets[name].labels, ts_from: f.ts_from, ts_to: f.ts_to, sha256: f.sha256 };
  }
  for (const name of Object.keys(COLUMNS_STEP5)) files[name] = written[name];
  fs.writeFileSync(path.join(out, 'events.csv'), toCsv(['event_id', 'sales_open', 'event_start'], events));
  const manifest = {
    source: 'db-export', exporter_version: '1.0.0', exported_at: now.toISOString(), history: { from: first, to: now.toISOString() },
    countries: [report.country], currencies: { PK: 'PKR' }, timezones: { PK: 'Asia/Karachi' }, scale: 1.0,
    files, deployed_models: report.deployedModels, policy: report.policy, payments: report.payments,
    feature_sources: ['snapshot'], contains_test_data: false, source_class: 'GENUINE_CUSTOMER',
    excluded_by_source_class: report.excludedBySourceClass,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(out, 'export_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'export_report.md'), markdown(report, manifest));
  const problems = Object.entries({ ...report.datasets, ...report.datasetsStep5 }).filter(([, d]) => d.problems.length);
  for (const [k, d] of Object.entries({ ...report.datasets, ...report.datasetsStep5 })) console.log(`${k.padEnd(27)} ${String(d.kept).padStart(7)} rows`);
  console.log(`\nWritten to ${out}`);
  if (problems.length) { console.error(`Row problems in: ${problems.map(([k]) => k).join(', ')} (see export_report.md)`); process.exitCode = 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
