#!/usr/bin/env node
/**
 * Gate operations preflight and post-release monitor (read-only: changes nothing).
 *
 *   node scripts/gate-preflight.mjs              checks, then GO / CHECK / STOP (exit 1 on STOP)
 *   node scripts/gate-preflight.mjs --json       the same as JSON
 *   node scripts/gate-preflight.mjs --monitor    every 60 s: uploads, problems, conflicts and suspicious
 *                                                activity of the last 5 minutes (Ctrl+C to stop)
 *
 * See docs/gate-operations-rollout.md → Phase 7 (deployment checklist).
 */
import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { deviceAuthStatus } from '../src/config/gateDeviceAuth.js';
import { crowdReadiness } from '../src/services/ml/crowd.js';
import { startOf } from '../src/services/ml/features.js';

const GATE_MIGRATIONS = ['20261118120000_gate_device_tokens', '20261118140000_gate_sync_idempotency', '20261118160000_gate_scan_conflicts', '20261118180000_gate_diagnostics', '20261118200000_gate_security'];
const args = new Set(process.argv.slice(2));
const DAY = 86400000;

async function checks() {
  const out = [];
  const add = (level, check, detail) => out.push({ level, check, detail });

  const applied = await prisma.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"');
  for (const name of GATE_MIGRATIONS) {
    const m = applied.find((r) => r.migration_name === name);
    if (!m || !m.finished_at || m.rolled_back_at) add('STOP', `Migration ${name}`, m ? 'not finished or rolled back' : 'not applied: run npx prisma migrate deploy');
    else add('OK', `Migration ${name}`, `applied ${m.finished_at.toISOString()}`);
  }

  const auth = deviceAuthStatus();
  const daysLeft = Math.ceil((Date.parse(auth.deadline) - Date.now()) / DAY);
  if (auth.mode === 'off') add('CHECK', 'Device credentials', 'GATE_DEVICE_AUTH=off (emergency rollback): tokens are ignored');
  else if (auth.mode === 'warn') add(daysLeft <= 7 ? 'CHECK' : 'OK', 'Device credentials', `warn (migration) until ${auth.deadline} (${daysLeft} days): enrol every scanner before then`);
  else add('OK', 'Device credentials', auth.configured === 'enforce' ? 'enforce' : `enforce (configured ${auth.configured}; the deadline has passed)`);

  const since7 = new Date(Date.now() - 7 * DAY);
  const [active, legacyRecent, unenrolled, revokedHolding] = await Promise.all([
    prisma.gateDevice.count({ where: { status: 'ACTIVE' } }),
    prisma.gateDevice.count({ where: { status: 'ACTIVE', tokenHash: null, lastLegacyAt: { gte: since7 } } }),
    prisma.gateDevice.count({ where: { status: 'ACTIVE', tokenHash: null, lastSeenAt: { gte: since7 } } }),
    prisma.gateDevice.count({ where: { status: 'REVOKED', pendingScans: { gt: 0 } } }),
  ]);
  if (unenrolled && auth.mode === 'enforce') add('STOP', 'Scanner enrollment', `${unenrolled} active scanner(s) seen this week are not enrolled and are refused under enforce`);
  else if (unenrolled) add('CHECK', 'Scanner enrollment', `${unenrolled} of ${active} active scanner(s) seen this week not enrolled (${legacyRecent} used the legacy path)`);
  else add('OK', 'Scanner enrollment', `${active} active scanner(s), all enrolled or unused this week`);
  if (revokedHolding) add('CHECK', 'Revoked devices', `${revokedHolding} revoked device(s) last reported scans not handed in`);

  const [openConflicts, toReview, stuck, failedDevices] = await Promise.all([
    prisma.scanConflict.count({ where: { status: 'OPEN' } }),
    prisma.quarantinedScan.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.gateDevice.count({ where: { status: 'ACTIVE', stuckScans: { gt: 0 } } }),
    prisma.gateDevice.count({ where: { status: 'ACTIVE', failedScans: { gt: 0 } } }),
  ]);
  add(openConflicts ? 'CHECK' : 'OK', 'Open conflicts', `${openConflicts} waiting for a supervisor`);
  add(toReview ? 'CHECK' : 'OK', 'Evidence to review', `${toReview} quarantined scan(s)`);
  add(stuck ? 'CHECK' : 'OK', 'Stuck scans', `${stuck} device(s) report stuck scans`);
  add(failedDevices ? 'CHECK' : 'OK', 'Failed uploads', `${failedDevices} device(s) hold failed scans`);

  const hour = new Date(Date.now() - 3600000);
  const [batches, problems, suspicious] = await Promise.all([
    prisma.gateSyncBatch.count({ where: { createdAt: { gte: hour } } }),
    prisma.gateSyncBatch.count({ where: { createdAt: { gte: hour }, OR: [{ error: { not: null } }, { retry: { gt: 0 } }] } }),
    prisma.auditLog.count({ where: { action: 'GATE_SYNC_SUSPICIOUS', createdAt: { gte: new Date(Date.now() - DAY) } } }),
  ]);
  const rate = batches ? Math.round((problems / batches) * 100) : 0;
  add(rate >= 10 ? 'STOP' : rate > 2 ? 'CHECK' : 'OK', 'Upload errors (last hour)', `${problems} of ${batches} upload(s) failed or had server retries (${rate}%)`);
  add(suspicious ? 'CHECK' : 'OK', 'Suspicious uploads (24 h)', `${suspicious} flagged (tampered, unsigned, unreadable or out-of-sequence scans)`);

  // Crowd-flow forecasts: upcoming events (next 14 days) whose gates can't be forecast
  const upcoming = (await prisma.event.findMany({
    where: { status: 'PUBLISHED', cancelledAt: null },
    select: { id: true, name: true, date: true, time: true, startsAt: true, gates: { select: { name: true, active: true, capacityPerHour: true } } },
  })).filter((e) => { const s = startOf(e).getTime(); return s > Date.now() && s <= Date.now() + 14 * DAY; });
  const notReady = upcoming.map((e) => ({ e, r: crowdReadiness(e.gates) })).filter((x) => !x.r.ready);
  add(notReady.length ? 'CHECK' : 'OK', 'Gate capacity (crowd forecasts)', notReady.length
    ? `${notReady.length} of ${upcoming.length} upcoming event(s) can't be forecast: ${notReady.slice(0, 5).map(({ e, r }) => `${e.name} (${r.reason === 'NO_ACTIVE_GATES' ? 'no active gates' : `no capacity per hour: ${r.missingCapacity.join(', ')}`})`).join('; ')}`
    : `${upcoming.length} upcoming event(s), every active gate has a capacity per hour`);

  const verdict = out.some((c) => c.level === 'STOP') ? 'STOP' : out.some((c) => c.level === 'CHECK') ? 'CHECK' : 'GO';
  return { verdict, at: new Date().toISOString(), checks: out };
}

async function monitorOnce() {
  const since = new Date(Date.now() - 5 * 60000);
  const [agg, failed, conflicts, suspicious, online] = await Promise.all([
    prisma.gateSyncBatch.aggregate({ where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { received: true, accepted: true, rejected: true, retry: true, conflicts: true } }),
    prisma.gateSyncBatch.count({ where: { createdAt: { gte: since }, error: { not: null } } }),
    prisma.scanConflict.count({ where: { createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: 'GATE_SYNC_SUSPICIOUS', createdAt: { gte: since } } }),
    prisma.gateDevice.count({ where: { status: 'ACTIVE', lastSeenAt: { gte: new Date(Date.now() - 120000) } } }),
  ]);
  const s = agg._sum;
  const warn = failed || s.retry || suspicious;
  console.log(`${new Date().toISOString()}  ${warn ? 'WARN' : 'ok  '}  devices online ${online} · uploads ${agg._count._all} (${s.received || 0} scans: ${s.accepted || 0} new, ${s.rejected || 0} rejected, ${s.retry || 0} retry) · failed requests ${failed} · new conflicts ${conflicts} · suspicious ${suspicious}`);
}

try {
  if (args.has('--monitor')) {
    console.log('Gate upload monitor (last 5 minutes, every 60 s). Ctrl+C to stop.');
    await monitorOnce();
    setInterval(() => monitorOnce().catch((e) => console.error('monitor failed:', e.message)), 60000);
  } else {
    const r = await checks();
    if (args.has('--json')) console.log(JSON.stringify(r, null, 2));
    else {
      for (const c of r.checks) console.log(`${c.level.padEnd(5)}  ${c.check.padEnd(46)}  ${c.detail}`);
      console.log(`\nVerdict: ${r.verdict}${r.verdict === 'STOP' ? ' (fix the STOP items before releasing)' : r.verdict === 'CHECK' ? ' (review the CHECK items)' : ''}`);
    }
    await prisma.$disconnect();
    process.exit(r.verdict === 'STOP' ? 1 : 0);
  }
} catch (e) {
  console.error('Preflight failed:', e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(2);
}
