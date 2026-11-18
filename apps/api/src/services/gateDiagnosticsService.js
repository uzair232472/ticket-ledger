import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { deviceAuthStatus } from '../config/gateDeviceAuth.js';
import { GateError, eventStats } from './checkinService.js';
import { userRoom } from './socketAccess.js';

/*
 * Scanner diagnostics and operational recovery for supervisors (gate.supervise).
 *
 * Health is computed from what each scanner reports every 30 s (heartbeat: pending, failed, stuck and conflict
 * counts, oldest pending scan, last scan, app version, storage persistence, clock skew, last sync error) and from
 * what the server saw (last request, last upload, upload log in GateSyncBatch, rejected credentials, open
 * conflicts). Supervisor actions reach a connected scanner through its user's socket room; the scanner then acts
 * itself (sync, retry, report its pending scans). Nothing here changes a ticket or deletes a scan.
 */

export const STALE_MS = 2 * 60 * 1000; // no heartbeat for 2 minutes: not seen
const LOST_MS = 10 * 60 * 1000; // not seen for 10 minutes while holding scans: critical
const PACK_STALE_MS = 30 * 60 * 1000;
const SKEW_MS = 5 * 60 * 1000;
const RECENT_MS = 15 * 60 * 1000;

const ago = (d, now) => (d ? now - new Date(d).getTime() : Infinity);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * { connection: ONLINE | OFFLINE | NOT_SEEN | REVOKED, health: HEALTHY | ATTENTION | CRITICAL | REVOKED,
 *   syncHealth: OK | BEHIND | FAILING, reasons: [{ code, severity, message }] }
 */
export function deviceHealth(d, { now = Date.now(), openConflicts = 0, authMode = 'enforce', atEvent = true } = {}) {
  const seen = ago(d.lastSeenAt, now);
  const connection = d.status === 'REVOKED' ? 'REVOKED' : seen > STALE_MS ? 'NOT_SEEN' : d.online === false ? 'OFFLINE' : 'ONLINE';
  const reasons = [];
  const add = (code, severity, message) => reasons.push({ code, severity, message });
  if (d.status === 'REVOKED') {
    if (d.pendingScans) add('REVOKED_WITH_SCANS', 'critical', `Revoked while holding ${plural(d.pendingScans, 'scan')} not handed in`);
    return { connection, health: 'REVOKED', syncHealth: d.pendingScans ? 'BEHIND' : 'OK', reasons };
  }
  if (d.stuckScans) add('STUCK_SCANS', 'critical', `${plural(d.stuckScans, 'scan')} stuck (waiting over 15 minutes or retried 5+ times)`);
  if (d.pendingScans && seen > LOST_MS) add('OFFLINE_WITH_SCANS', 'critical', `Not seen for ${Math.round(seen / 60000)} min with ${plural(d.pendingScans, 'scan')} not uploaded`);
  if (d.failedScans) add('FAILED_SCANS', 'attention', `${plural(d.failedScans, 'scan')} failed to upload`);
  if (openConflicts || d.deviceConflicts) add('CONFLICTS', 'attention', `${plural(Math.max(openConflicts, d.deviceConflicts || 0), 'conflict')} waiting for a supervisor`);
  if (d.lastSyncError && ago(d.lastSyncErrorAt, now) < RECENT_MS) add('SYNC_ERROR', 'attention', `Last upload problem: ${d.lastSyncError}`);
  if (d.authFailures && ago(d.lastAuthFailureAt, now) < RECENT_MS) add('AUTH_FAILURES', 'attention', 'Rejected device credentials in the last 15 minutes');
  if (!d.tokenHash && authMode !== 'off') add('NOT_ENROLLED', authMode === 'enforce' ? 'critical' : 'attention', 'Not enrolled: open the scanner on it while online');
  if (atEvent && seen <= STALE_MS && ago(d.packAt, now) > PACK_STALE_MS) add('OLD_TICKET_LIST', 'attention', 'Offline ticket list older than 30 minutes');
  if (d.storagePersisted === false) add('STORAGE_NOT_PERSISTENT', 'attention', 'The browser may clear its offline scans when space runs low');
  if (d.clockSkewMs != null && Math.abs(d.clockSkewMs) > SKEW_MS) add('CLOCK_SKEW', 'attention', `Device clock is ${Math.round(Math.abs(d.clockSkewMs) / 60000)} min ${d.clockSkewMs > 0 ? 'ahead' : 'behind'}`);
  const health = reasons.some((r) => r.severity === 'critical') ? 'CRITICAL' : reasons.length ? 'ATTENTION' : 'HEALTHY';
  const syncHealth = d.stuckScans || d.failedScans || reasons.some((r) => r.code === 'SYNC_ERROR') ? 'FAILING' : d.pendingScans ? 'BEHIND' : 'OK';
  return { connection, health, syncHealth, reasons };
}

/** Open conflicts per device (GateDevice.id) for the event. */
export async function openConflictsByDevice(eventId) {
  const open = await prisma.scanConflict.findMany({ where: { eventId, status: 'OPEN' }, select: { id: true } });
  if (!open.length) return {};
  const rows = await prisma.checkIn.findMany({ where: { conflictId: { in: open.map((c) => c.id) }, deviceRecordId: { not: null } }, select: { conflictId: true, deviceRecordId: true } });
  const sets = {};
  for (const r of rows) (sets[r.deviceRecordId] ||= new Set()).add(r.conflictId);
  return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size]));
}

// ── Upload log ─────────────────────────────────────────────────────────────────────────────────────────

/** Records one upload request; a failed or partly failed one also becomes the device's last sync error. */
export async function recordBatch({ device, eventId, userId, kind, received, results = [], durationMs, error = null, quarantined = 0, lastAckedSeq = null }) {
  const count = (status) => results.filter((r) => r.status === status).length;
  const data = { companyId: device.companyId, eventId, deviceId: device.id, userId, kind, received, accepted: count('ACCEPTED'), alreadyProcessed: count('ALREADY_PROCESSED'), rejected: count('REJECTED'), retry: count('RETRY'), conflicts: results.filter((r) => r.conflict && r.status === 'ACCEPTED').length, quarantined, lastAckedSeq, durationMs, error: error ? String(error).slice(0, 300) : null };
  const problem = error || (data.retry ? `${plural(data.retry, 'scan')} could not be processed (will be sent again)` : data.rejected ? `${plural(data.rejected, 'scan')} could not be read (kept for review)` : null);
  await prisma.$transaction([
    prisma.gateSyncBatch.create({ data }),
    // A clean upload clears the last error; a problem becomes it
    prisma.gateDevice.update({ where: { id: device.id }, data: problem ? { lastSyncError: problem.slice(0, 300), lastSyncErrorAt: new Date() } : { lastSyncError: null } }),
  ]);
}

// ── Supervisor views ───────────────────────────────────────────────────────────────────────────────────

/** Devices of the event's organization with health (used by the Devices tab and the dashboard). */
export async function devicesWithHealth(event) {
  const [devices, conflicts] = await Promise.all([
    prisma.gateDevice.findMany({ where: { companyId: event.companyId }, orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }] }),
    openConflictsByDevice(event.id),
  ]);
  const mode = deviceAuthStatus().mode;
  const now = Date.now();
  return devices.map((d) => ({ device: d, openConflicts: conflicts[d.id] || 0, ...deviceHealth(d, { now, openConflicts: conflicts[d.id] || 0, authMode: mode, atEvent: d.lastEventId === event.id }) }));
}

/** Gate operations dashboard: devices, uploads, conflicts, evidence, attendance and gate capacity. */
export async function operationsSummary(event) {
  const [rows, live, quarantined, failedLastHour] = await Promise.all([
    devicesWithHealth(event),
    eventStats(event.id),
    prisma.quarantinedScan.count({ where: { eventId: event.id, status: 'PENDING_REVIEW' } }),
    prisma.gateSyncBatch.count({ where: { eventId: event.id, createdAt: { gte: new Date(Date.now() - 3600000) }, OR: [{ error: { not: null } }, { retry: { gt: 0 } }, { rejected: { gt: 0 } }] } }),
  ]);
  const active = rows.filter((r) => r.device.status === 'ACTIVE');
  const here = active.filter((r) => r.device.lastEventId === event.id);
  const sum = (k) => here.reduce((n, r) => n + (r.device[k] || 0), 0);
  const gates = live.gates || [];
  const capacity = gates.reduce((n, g) => n + (g.capacityPerHour || 0), 0);
  const rate = gates.reduce((n, g) => n + (g.ratePerHour || 0), 0);
  return {
    generatedAt: new Date(),
    devices: {
      registered: active.length,
      atThisEvent: here.length,
      online: here.filter((r) => r.connection === 'ONLINE').length,
      offline: here.filter((r) => r.connection === 'OFFLINE').length,
      notSeen: here.filter((r) => r.connection === 'NOT_SEEN').length,
      revoked: rows.length - active.length,
      needingAttention: rows.filter((r) => ['ATTENTION', 'CRITICAL'].includes(r.health) || (r.health === 'REVOKED' && r.reasons.length)).length,
      critical: rows.filter((r) => r.health === 'CRITICAL' || (r.health === 'REVOKED' && r.reasons.length)).length,
      notEnrolled: active.filter((r) => !r.device.tokenHash).length,
    },
    scans: { pending: sum('pendingScans'), failed: sum('failedScans'), stuck: sum('stuckScans'), failedUploadsLastHour: failedLastHour, quarantinedAwaitingReview: quarantined },
    conflicts: { open: live.openConflicts },
    attendance: { sold: live.sold, entered: live.entered, inside: live.inside, remaining: live.remaining },
    capacity: { perHour: capacity || null, currentRatePerHour: rate, loadPct: capacity ? Math.round((rate / capacity) * 100) : null, overloadedGates: gates.filter((g) => g.overloaded).map((g) => g.gate) },
    attention: rows.filter((r) => r.reasons.length).map((r) => ({ id: r.device.id, name: r.device.name, health: r.health, reasons: r.reasons })).slice(0, 50),
    auth: deviceAuthStatus(),
  };
}

const safeDevice = (d) => {
  const { tokenHash, deviceKey, pendingManifest, ...rest } = d;
  return { ...rest, enrolled: Boolean(tokenHash), deviceKeyEnd: deviceKey.slice(-6) };
};

/** One device: details, health, upload history, recent errors, its unprocessed scans (if reported), activity. */
export async function deviceDetails(event, deviceId) {
  const d = await prisma.gateDevice.findFirst({ where: { id: deviceId, companyId: event.companyId } });
  if (!d) throw new GateError(404, 'Device not found.');
  const conflicts = (await openConflictsByDevice(event.id))[d.id] || 0;
  const [batches, errors, quarantined, scans, users, actions] = await Promise.all([
    prisma.gateSyncBatch.findMany({ where: { deviceId: d.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.gateSyncBatch.findMany({ where: { deviceId: d.id, OR: [{ error: { not: null } }, { retry: { gt: 0 } }, { rejected: { gt: 0 } }] }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.quarantinedScan.count({ where: { deviceId: d.id } }),
    prisma.checkIn.groupBy({ by: ['result'], where: { eventId: event.id, deviceRecordId: d.id }, _count: { _all: true } }),
    prisma.user.findMany({ where: { id: { in: [d.lastUserId, d.registeredById, d.enrolledById, d.revokedById].filter(Boolean) } }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({ where: { targetType: 'GateDevice', targetId: d.id }, orderBy: { createdAt: 'desc' }, take: 30, include: { user: { select: { name: true } } } }),
  ]);
  const name = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return {
    device: { ...safeDevice(d), lastUser: name[d.lastUserId] || null, registeredBy: name[d.registeredById] || null, enrolledBy: name[d.enrolledById] || null, revokedBy: name[d.revokedById] || null },
    ...deviceHealth(d, { openConflicts: conflicts, authMode: deviceAuthStatus().mode, atEvent: d.lastEventId === event.id }),
    openConflicts: conflicts,
    quarantined,
    activity: Object.fromEntries(['GREEN', 'YELLOW', 'RED'].map((r) => [r, scans.find((x) => x.result === r)?._count._all || 0])),
    pendingScans: d.pendingManifest ? { reportedAt: d.manifestAt, scans: d.pendingManifest } : null,
    syncHistory: batches,
    recentErrors: errors,
    actions: actions.map((a) => ({ at: a.createdAt, action: a.action, by: a.user?.name || null, details: a.details })),
  };
}

// ── Supervisor actions (delivered to the scanner) ──────────────────────────────────────────────────────

export const DEVICE_ACTIONS = { PING: 'Test connection', SYNC: 'Upload now', RETRY_FAILED: 'Retry failed uploads', SEND_PENDING: 'Show its pending scans' };

/** Asks a connected scanner to act. Returns { delivered } (false: the scanner isn't connected right now). */
export async function requestDeviceAction(req, event, deviceId, action) {
  const d = await prisma.gateDevice.findFirst({ where: { id: deviceId, companyId: event.companyId } });
  if (!d) throw new GateError(404, 'Device not found.');
  if (d.status === 'REVOKED') throw new GateError(409, 'This device is revoked. Restore it first, or review the scans it handed in (Quarantine).', 'DEVICE_REVOKED');
  const io = getIO();
  const sockets = io && d.lastUserId ? await io.in(userRoom(d.lastUserId)).fetchSockets() : [];
  if (sockets.length) io.to(userRoom(d.lastUserId)).emit('gate:device-action', { deviceKey: d.deviceKey, action, eventId: event.id, requestedBy: req.user.name, at: new Date().toISOString() });
  await prisma.auditLog.create({ data: { userId: req.user.id, companyId: event.companyId, actorRole: req.org?.role || req.user.role, action: 'GATE_DEVICE_ACTION_REQUESTED', targetType: 'GateDevice', targetId: d.id, ipAddress: req.ip || null, details: { eventId: event.id, action, delivered: sockets.length > 0, name: d.name } } });
  return { delivered: sockets.length > 0, action, label: DEVICE_ACTIONS[action] };
}

/** The scanner's list of its unprocessed scans (bounded), kept for supervisors. */
export async function saveManifest(device, scans) {
  const clean = scans.slice(0, 200).map((s) => ({
    scanId: String(s.scanId || '').slice(0, 80), seq: Number.isInteger(s.seq) ? s.seq : null, state: String(s.state || '').slice(0, 20), direction: s.direction === 'EXIT' ? 'EXIT' : 'ENTRY',
    gate: s.gate ? String(s.gate).slice(0, 60) : null, deviceScannedAt: s.deviceScannedAt ? String(s.deviceScannedAt).slice(0, 40) : null, localResult: ['GREEN', 'YELLOW', 'RED'].includes(s.localResult) ? s.localResult : null,
    attempts: Number.isInteger(s.attempts) ? s.attempts : 0, lastError: s.lastError ? String(s.lastError).slice(0, 200) : null,
  }));
  await prisma.gateDevice.update({ where: { id: device.id }, data: { pendingManifest: clean, manifestAt: new Date() } });
  return clean.length;
}

// ── Quarantine review ──────────────────────────────────────────────────────────────────────────────────

export async function listQuarantine(eventId, { status } = {}) {
  const rows = await prisma.quarantinedScan.findMany({ where: { eventId, ...(status ? { status } : {}) }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 500 });
  const ids = [...new Set(rows.flatMap((r) => [r.submittedById, r.reviewedById]).filter(Boolean))];
  const devIds = [...new Set(rows.map((r) => r.deviceId).filter(Boolean))];
  const [users, devices] = await Promise.all([
    ids.length ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [],
    devIds.length ? prisma.gateDevice.findMany({ where: { id: { in: devIds } }, select: { id: true, name: true } }) : [],
  ]);
  const who = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const dev = Object.fromEntries(devices.map((d) => [d.id, d.name]));
  return rows.map((r) => ({ ...r, deviceKey: r.deviceKey.slice(-6), device: r.deviceId ? dev[r.deviceId] || null : null, submittedBy: who[r.submittedById] || null, reviewedBy: r.reviewedById ? who[r.reviewedById] || null : null }));
}

/** Marks quarantined scans reviewed with a note (audited). They never become admissions. */
export async function reviewQuarantine(req, event, ids, note) {
  const { count } = await prisma.quarantinedScan.updateMany({ where: { id: { in: ids }, eventId: event.id, status: 'PENDING_REVIEW' }, data: { status: 'REVIEWED', reviewedById: req.user.id, reviewedAt: new Date(), reviewNote: note } });
  if (!count) throw new GateError(409, 'These scans were already reviewed (or are not part of this event).', 'ALREADY_REVIEWED');
  await prisma.auditLog.create({ data: { userId: req.user.id, companyId: event.companyId, actorRole: req.org?.role || req.user.role, action: 'GATE_QUARANTINE_REVIEWED', targetType: 'Event', targetId: event.id, ipAddress: req.ip || null, details: { eventId: event.id, ids, reviewed: count, note, admitted: 0 } } });
  return { reviewed: count };
}

// ── Reports ────────────────────────────────────────────────────────────────────────────────────────────

const RECOVERY_ACTIONS = ['GATE_SYNC_SUSPICIOUS', 'GATE_DEVICE_REVOKED', 'GATE_DEVICE_RESTORED', 'GATE_DEVICE_ENROLLMENT_RESET', 'GATE_DEVICE_ENROLLED', 'GATE_DEVICE_TOKEN_ROTATED', 'GATE_DEVICE_AUTH_FAILED', 'GATE_DEVICE_ACTION_REQUESTED', 'GATE_SCANS_QUARANTINED', 'GATE_QUARANTINE_REVIEWED', 'GATE_CONFLICT_DETECTED', 'GATE_CONFLICT_SCAN_ADDED', 'GATE_CONFLICT_RESOLVED', 'GATE_CHECKIN_REVERSED', 'GATE_EXCEPTION_APPROVED', 'GATE_EXCEPTION_DENIED'];

const csvCell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (head, rows) => [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');

export const REPORTS = ['device-sync', 'device-activity', 'failed-scans', 'recovery-history'];

/** { rows, csv } for one report. */
export async function buildReport(event, kind) {
  if (kind === 'device-sync') {
    const rows = await devicesWithHealth(event);
    const since = new Date(Date.now() - 24 * 3600000);
    const batches = await prisma.gateSyncBatch.groupBy({ by: ['deviceId'], where: { eventId: event.id, createdAt: { gte: since } }, _count: { _all: true }, _sum: { received: true, accepted: true, alreadyProcessed: true, rejected: true, retry: true, conflicts: true } });
    const by = Object.fromEntries(batches.map((b) => [b.deviceId, b]));
    const data = rows.map(({ device: d, health, connection, syncHealth, openConflicts, reasons }) => ({
      device: d.name, status: d.status, enrolled: Boolean(d.tokenHash), health, connection, syncHealth, lastSeenAt: d.lastSeenAt, lastSyncAt: d.lastSyncAt, lastScanAt: d.lastScanAt,
      pending: d.pendingScans, failed: d.failedScans, stuck: d.stuckScans, openConflicts, lastAckedSeq: d.lastSeqAcked, appVersion: d.appVersion,
      uploads24h: by[d.id]?._count._all || 0, received24h: by[d.id]?._sum.received || 0, accepted24h: by[d.id]?._sum.accepted || 0, repeats24h: by[d.id]?._sum.alreadyProcessed || 0, rejected24h: by[d.id]?._sum.rejected || 0, retry24h: by[d.id]?._sum.retry || 0,
      lastSyncError: d.lastSyncError, issues: reasons.map((r) => r.message).join(' | '), deviceId: d.id,
    }));
    return { rows: data, csv: toCsv(Object.keys(data[0] || { device: 1 }), data.map((r) => Object.values(r))) };
  }
  if (kind === 'device-activity') {
    const [groups, devices] = await Promise.all([
      prisma.checkIn.groupBy({ by: ['deviceRecordId', 'result', 'offline'], where: { eventId: event.id }, _count: { _all: true }, _min: { scannedAt: true }, _max: { scannedAt: true } }),
      prisma.gateDevice.findMany({ where: { companyId: event.companyId }, select: { id: true, name: true } }),
    ]);
    const names = Object.fromEntries(devices.map((d) => [d.id, d.name]));
    const acc = {};
    for (const g of groups) {
      const k = g.deviceRecordId || 'unknown';
      const a = (acc[k] ||= { device: g.deviceRecordId ? names[g.deviceRecordId] || g.deviceRecordId : 'Not recorded (older scans)', scans: 0, admitted: 0, alreadyUsed: 0, turnedAway: 0, offline: 0, first: null, last: null });
      a.scans += g._count._all;
      if (g.result === 'GREEN') a.admitted += g._count._all;
      else if (g.result === 'YELLOW') a.alreadyUsed += g._count._all;
      else a.turnedAway += g._count._all;
      if (g.offline) a.offline += g._count._all;
      if (!a.first || g._min.scannedAt < a.first) a.first = g._min.scannedAt;
      if (!a.last || g._max.scannedAt > a.last) a.last = g._max.scannedAt;
    }
    const conflicts = await openConflictsByDevice(event.id);
    const data = Object.entries(acc).map(([k, a]) => ({ ...a, openConflicts: conflicts[k] || 0, deviceId: k === 'unknown' ? null : k })).sort((x, y) => y.scans - x.scans);
    return { rows: data, csv: toCsv(['Device', 'Scans', 'Admitted / let out', 'Already used', 'Turned away', 'Offline scans', 'First scan', 'Last scan', 'Open conflicts', 'Device id'], data.map((r) => Object.values(r))) };
  }
  if (kind === 'failed-scans') {
    const [q, devices] = await Promise.all([
      listQuarantine(event.id),
      prisma.gateDevice.findMany({ where: { companyId: event.companyId, OR: [{ failedScans: { gt: 0 } }, { stuckScans: { gt: 0 } }] }, select: { name: true, failedScans: true, stuckScans: true, lastSyncError: true, lastSyncErrorAt: true, pendingManifest: true } }),
    ]);
    const data = [
      ...q.map((r) => ({ source: 'Server quarantine', device: r.device || `…${r.deviceKey}`, scanId: r.clientScanId, seq: r.deviceSeq, reason: r.reason, detail: r.detail, status: r.status, at: r.createdAt, reviewNote: r.reviewNote })),
      ...devices.flatMap((d) => (Array.isArray(d.pendingManifest) ? d.pendingManifest.filter((s) => s.state === 'FAILED' || s.attempts >= 5) : []).map((s) => ({ source: 'Held on device', device: d.name, scanId: s.scanId, seq: s.seq, reason: s.state, detail: s.lastError, status: 'ON_DEVICE', at: s.deviceScannedAt, reviewNote: null }))),
      ...devices.filter((d) => !Array.isArray(d.pendingManifest)).map((d) => ({ source: 'Device report', device: d.name, scanId: null, seq: null, reason: `${d.failedScans} failed, ${d.stuckScans} stuck`, detail: d.lastSyncError, status: 'ON_DEVICE', at: d.lastSyncErrorAt, reviewNote: null })),
    ];
    return { rows: data, csv: toCsv(['Source', 'Device', 'Scan id', 'Seq', 'Reason', 'Detail', 'Status', 'At', 'Review note'], data.map((r) => Object.values(r))) };
  }
  if (kind === 'recovery-history') {
    const logs = await prisma.auditLog.findMany({
      where: { companyId: event.companyId, action: { in: RECOVERY_ACTIONS }, OR: [{ details: { path: ['eventId'], equals: event.id } }, { targetType: 'GateDevice' }] },
      orderBy: { createdAt: 'desc' }, take: 5000, include: { user: { select: { name: true } } },
    });
    const data = logs.map((l) => ({ at: l.createdAt, action: l.action, by: l.user?.name || null, targetType: l.targetType, targetId: l.targetId, reason: l.details?.reason || l.details?.note || null, details: l.details }));
    return { rows: data, csv: toCsv(['At', 'Action', 'By', 'Target', 'Target id', 'Reason', 'Details'], data.map((r) => Object.values(r))) };
  }
  throw new GateError(404, 'Unknown report.');
}

// ── Suspicious upload activity and housekeeping ────────────────────────────────────────────────────────

const SUSPICIOUS_EVERY_MS = 5 * 60 * 1000;
const SUSPICIOUS_THRESHOLD = { rejected: 10, regressions: 5 };

/**
 * Flags an upload that looks wrong: tampered records, unsigned records from a device that has a signing key, many
 * unreadable scans, or new scans numbered below what the device already had acknowledged (storage replaced or
 * edited). Audited as GATE_SYNC_SUSPICIOUS at most every 5 minutes per device, and sent to the event's supervisors.
 */
export async function flagSuspicious(req, device, eventId, { tampered = 0, unsigned = 0, rejected = 0, regressions = 0 }) {
  const signs = [];
  if (tampered) signs.push(`${plural(tampered, 'scan')} changed after they were made (signature mismatch)`);
  if (unsigned) signs.push(`${plural(unsigned, 'unsigned scan')} from a device that signs its scans`);
  if (rejected >= SUSPICIOUS_THRESHOLD.rejected) signs.push(`${plural(rejected, 'unreadable scan')}`);
  if (regressions >= SUSPICIOUS_THRESHOLD.regressions) signs.push(`${plural(regressions, 'new scan')} numbered below the device's acknowledged sequence`);
  if (!signs.length) return null;
  console.warn(`[gate] suspicious upload device=${device.id} user=${req.user.id} ip=${req.ip}: ${signs.join('; ')}`);
  const recent = await prisma.auditLog.findFirst({ where: { action: 'GATE_SYNC_SUSPICIOUS', targetId: device.id, createdAt: { gte: new Date(Date.now() - SUSPICIOUS_EVERY_MS) } }, select: { id: true } });
  if (recent) return { signs, logged: false };
  await prisma.auditLog.create({ data: { userId: req.user.id, companyId: device.companyId, actorRole: req.org?.role || req.user.role, action: 'GATE_SYNC_SUSPICIOUS', targetType: 'GateDevice', targetId: device.id, ipAddress: req.ip || null, userAgent: req.headers?.['user-agent']?.slice(0, 300) || null, details: { eventId, signs, tampered, unsigned, rejected, regressions, name: device.name } } });
  getIO()?.to(`event_${eventId}_supervisors`).emit('gate:suspicious', { eventId, deviceId: device.id, name: device.name, signs });
  return { signs, logged: true };
}

export const SYNC_LOG_RETENTION_DAYS = 90;
/** Upload log rows older than the retention period are removed (daily job; scans themselves are never touched). */
export async function pruneSyncBatches(days = SYNC_LOG_RETENTION_DAYS) {
  const { count } = await prisma.gateSyncBatch.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400000) } } });
  return count;
}
