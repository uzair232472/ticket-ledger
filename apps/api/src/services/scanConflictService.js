import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { GateError } from './checkinService.js';
import { supervisorRoom } from './socketAccess.js';

/*
 * Offline scan conflicts: an offline device admitted (or let out) a ticket, and when the scan reached the server
 * the server's ticket state disagreed.
 *
 * Business rules
 *  1. The server's ticket state is authoritative for attendance. A conflicting offline scan never changes the
 *     ticket: attendance is counted once, presence is not moved, a refunded ticket stays refunded.
 *  2. Device clocks are evidence only. The scan already applied on the server stays the recorded check-in; no
 *     "earliest wins".
 *  3. Every scan is kept (CheckIn rows linked by conflictId), including the earlier admission it conflicts with.
 *  4. A conflict is never resolved automatically. Supervisors (gate.supervise) choose a resolution allowed for the
 *     conflict type and must give a reason. Resolving records a decision and changes no ticket. Corrections use
 *     the existing audited tools (reverse a check-in, approve an exception).
 *  5. While a conflict of a type is open for a ticket, further disagreeing scans of that type join it.
 *
 * Classification (device verdict GREEN, server verdict not GREEN):
 *   ENTRY, ticket already used                         → DUPLICATE_ADMISSION
 *   ENTRY, re-entry not allowed / limit reached         → REENTRY_LIMIT
 *   ticket cancelled, transferred, old QR, unpaid, event cancelled → TICKET_INVALIDATED
 *   EXIT, ticket not inside or never entered            → ORDERING
 *   anything else (wrong gate, unknown ticket, …)       → RULE_MISMATCH
 */

export const RESOLUTIONS_BY_TYPE = {
  DUPLICATE_ADMISSION: ['CONFIRMED_SINGLE_ENTRY', 'CONFIRMED_MULTIPLE_ENTRY', 'DEVICE_ERROR', 'DISMISSED'],
  TICKET_INVALIDATED: ['ADMISSION_ACCEPTED', 'ADMISSION_REJECTED', 'DEVICE_ERROR', 'DISMISSED'],
  REENTRY_LIMIT: ['ADMISSION_ACCEPTED', 'ADMISSION_REJECTED', 'DEVICE_ERROR', 'DISMISSED'],
  RULE_MISMATCH: ['ADMISSION_ACCEPTED', 'ADMISSION_REJECTED', 'DEVICE_ERROR', 'DISMISSED'],
  ORDERING: ['DEVICE_ERROR', 'DISMISSED'],
};

const INVALID_CODES = ['CANCELLED', 'TRANSFERRED', 'OLD_QR', 'UNPAID', 'EVENT_CANCELLED'];

/** The conflict type for an offline scan the device decided GREEN and the server did not, else null. */
export function classifyConflict({ direction, localResult, verdict }) {
  if (localResult !== 'GREEN' || verdict.result === 'GREEN') return null;
  if (INVALID_CODES.includes(verdict.code)) return 'TICKET_INVALIDATED';
  if (direction === 'EXIT') return ['ALREADY_OUTSIDE', 'NOT_ENTERED'].includes(verdict.code) ? 'ORDERING' : 'RULE_MISMATCH';
  if (verdict.code === 'ALREADY_USED') return 'DUPLICATE_ADMISSION';
  if (['REENTRY_LIMIT', 'NO_REENTRY'].includes(verdict.code)) return 'REENTRY_LIMIT';
  return 'RULE_MISMATCH';
}

const LABEL = {
  DUPLICATE_ADMISSION: 'Admitted offline, but the ticket had already entered',
  TICKET_INVALIDATED: 'Admitted offline, but the ticket is not valid',
  ORDERING: 'Exit recorded offline, but the ticket was not inside',
  REENTRY_LIMIT: 'Re-admitted offline beyond the re-entry policy',
  RULE_MISMATCH: 'Admitted offline against a gate rule',
};
export const conflictReason = (type, verdict) => (type === 'DUPLICATE_ADMISSION' ? `Duplicate admission while offline (${verdict.reason.toLowerCase()})` : `${LABEL[type]} (${verdict.reason})`);

const ticketState = (t) => t && { status: t.status, checkedInAt: t.checkedInAt, gate: t.gate, isInside: t.isInside, entryCount: t.entryCount, lastExitAt: t.lastExitAt, qrVersion: t.qrVersion };

/**
 * Inside the scan's transaction: opens a conflict (or adds the scan to the open one of the same type for the
 * ticket), links the scan and the earlier admission it disagrees with, and audits it. Returns { conflict, created }.
 */
export async function recordConflict(tx, { type, checkIn, verdict, direction, localResult, localReason, eventId, staffId }) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { companyId: true } });
  const ticketId = checkIn.ticketId;
  const ticket = ticketId ? await tx.ticket.findUnique({ where: { id: ticketId } }) : null;
  const prior = ticketId ? await tx.checkIn.findFirst({ where: { ticketId, result: 'GREEN', reversedAt: null, id: { not: checkIn.id } }, orderBy: { scannedAt: 'desc' } }) : null;
  let conflict = ticketId ? await tx.scanConflict.findFirst({ where: { eventId, ticketId, type, status: 'OPEN' } }) : null;
  const created = !conflict;
  if (!conflict) {
    conflict = await tx.scanConflict.create({
      data: {
        eventId,
        companyId: event.companyId,
        ticketId,
        type,
        summary: `${LABEL[type]}: ${verdict.reason}`.slice(0, 300),
        detectedById: staffId,
        evidence: {
          ticketAtDetection: ticketState(ticket),
          server: { result: verdict.result, code: verdict.code || null, reason: verdict.reason },
          device: { result: localResult, reason: localReason || null, direction },
          priorAdmission: prior && { checkInId: prior.id, direction: prior.direction, at: prior.scannedAt, gate: prior.gate, offline: prior.offline, deviceRecordId: prior.deviceRecordId, staffId: prior.staffId },
          rules: 'Server ticket state is authoritative; this scan did not change the ticket. Resolve with a reason.',
        },
      },
    });
  }
  await tx.checkIn.update({ where: { id: checkIn.id }, data: { conflictId: conflict.id } });
  if (prior && !prior.conflictId) await tx.checkIn.update({ where: { id: prior.id }, data: { conflictId: conflict.id } });
  await tx.auditLog.create({
    data: { userId: staffId, companyId: event.companyId, action: created ? 'GATE_CONFLICT_DETECTED' : 'GATE_CONFLICT_SCAN_ADDED', targetType: 'ScanConflict', targetId: conflict.id, details: { eventId, ticketId, type, checkInId: checkIn.id, deviceRecordId: checkIn.deviceRecordId, deviceSeq: checkIn.deviceSeq, deviceScannedAt: checkIn.deviceScannedAt, server: verdict.reason, priorCheckInId: prior?.id || null } },
  });
  return { conflict, created };
}

export function announceConflicts(eventId, conflicts) {
  if (!conflicts.length) return;
  getIO()?.to(supervisorRoom(eventId)).emit('gate:conflict', { eventId, count: conflicts.length, ids: conflicts.map((c) => c.id) });
}

// ── Supervisors ──────────────────────────────────────────────────────────────────────────────────────

async function decorate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [scans, history, tickets] = await Promise.all([
    prisma.checkIn.findMany({ where: { conflictId: { in: ids } }, orderBy: [{ scannedAt: 'asc' }], include: { staff: { select: { name: true } } } }),
    prisma.auditLog.findMany({ where: { targetType: 'ScanConflict', targetId: { in: ids } }, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } }),
    prisma.ticket.findMany({ where: { id: { in: rows.map((r) => r.ticketId).filter(Boolean) } }, select: { id: true, manualCode: true, status: true, isInside: true, entryCount: true, checkedInAt: true, gate: true, user: { select: { name: true } }, seat: { select: { tier: { select: { name: true } } } } } }),
  ]);
  const deviceIds = [...new Set(scans.map((s) => s.deviceRecordId).filter(Boolean))];
  const userIds = [...new Set(rows.flatMap((r) => [r.detectedById, r.resolvedById]).filter(Boolean))];
  const [devices, users] = await Promise.all([
    deviceIds.length ? prisma.gateDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, status: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const dev = Object.fromEntries(devices.map((d) => [d.id, d]));
  const who = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const tk = Object.fromEntries(tickets.map((t) => [t.id, t]));
  return rows.map((r) => ({
    ...r,
    detectedBy: who[r.detectedById] || null,
    resolvedBy: r.resolvedById ? who[r.resolvedById] || null : null,
    allowedResolutions: RESOLUTIONS_BY_TYPE[r.type],
    ticket: r.ticketId && tk[r.ticketId] ? { id: r.ticketId, code: tk[r.ticketId].manualCode, holder: tk[r.ticketId].user?.name || null, type: tk[r.ticketId].seat?.tier?.name || null, status: tk[r.ticketId].status, isInside: tk[r.ticketId].isInside, entryCount: tk[r.ticketId].entryCount, checkedInAt: tk[r.ticketId].checkedInAt, gate: tk[r.ticketId].gate } : null,
    scans: scans.filter((s) => s.conflictId === r.id).map((s) => ({
      checkInId: s.id, direction: s.direction, result: s.result, reason: s.reason, offline: s.offline, flagged: s.conflict, gate: s.gate,
      staff: s.staff?.name || null, device: s.deviceRecordId ? dev[s.deviceRecordId] || { id: s.deviceRecordId } : null, deviceSeq: s.deviceSeq,
      deviceScannedAt: s.deviceScannedAt, recordedAt: s.scannedAt, receivedAt: s.createdAt, localResult: s.localResult, localReason: s.localReason, reversedAt: s.reversedAt,
    })),
    history: history.filter((h) => h.targetId === r.id).map((h) => ({ at: h.createdAt, action: h.action, by: h.user?.name || null, details: h.details })),
  }));
}

export async function listConflicts(eventId, { status, type } = {}) {
  const rows = await prisma.scanConflict.findMany({ where: { eventId, ...(status ? { status } : {}), ...(type ? { type } : {}) }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 500 });
  const counts = await prisma.scanConflict.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } });
  return { conflicts: await decorate(rows), open: counts.find((c) => c.status === 'OPEN')?._count._all || 0, resolved: counts.find((c) => c.status === 'RESOLVED')?._count._all || 0 };
}

export async function getConflict(eventId, conflictId) {
  const row = await prisma.scanConflict.findFirst({ where: { id: conflictId, eventId } });
  if (!row) throw new GateError(404, 'Conflict not found.');
  return (await decorate([row]))[0];
}

/** Records a supervisor's decision (rule 4): allowed resolution, a reason, once; the ticket is not changed. */
export async function resolveConflict(req, event, conflictId, { resolution, reason }) {
  const row = await prisma.scanConflict.findFirst({ where: { id: conflictId, eventId: event.id } });
  if (!row) throw new GateError(404, 'Conflict not found.');
  if (row.status !== 'OPEN') throw new GateError(409, 'This conflict was already resolved.', 'ALREADY_RESOLVED');
  if (!RESOLUTIONS_BY_TYPE[row.type].includes(resolution)) throw new GateError(400, `This kind of conflict can be resolved as: ${RESOLUTIONS_BY_TYPE[row.type].join(', ')}.`, 'RESOLUTION_NOT_ALLOWED');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.scanConflict.updateMany({ where: { id: row.id, status: 'OPEN' }, data: { status: 'RESOLVED', resolution, resolutionReason: reason, resolvedById: req.user.id, resolvedAt: now } });
    if (!count) throw new GateError(409, 'Another supervisor resolved this conflict at the same moment.', 'ALREADY_RESOLVED');
    const scans = await tx.checkIn.findMany({ where: { conflictId: row.id }, select: { id: true } });
    await tx.auditLog.create({
      data: { userId: req.user.id, companyId: event.companyId, actorRole: req.org?.role || req.user.role, action: 'GATE_CONFLICT_RESOLVED', targetType: 'ScanConflict', targetId: row.id, ipAddress: req.ip || null, userAgent: req.headers?.['user-agent']?.slice(0, 300) || null, details: { eventId: event.id, ticketId: row.ticketId, type: row.type, resolution, reason, checkInIds: scans.map((s) => s.id), ticketChanged: false } },
    });
  });
  getIO()?.to(supervisorRoom(event.id)).emit('gate:conflict-resolved', { eventId: event.id, id: row.id, resolution });
  return getConflict(event.id, row.id);
}

const csvCell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function conflictsCsv(conflicts) {
  const head = ['Conflict', 'Status', 'Type', 'Detected', 'Ticket', 'Holder', 'Ticket status now', 'Scans', 'Devices', 'Gates', 'Summary', 'Resolution', 'Resolved by', 'Resolved at', 'Reason'];
  const lines = conflicts.map((c) => [
    c.id, c.status, c.type, c.createdAt, c.ticket?.code, c.ticket?.holder, c.ticket?.status, c.scans.length,
    [...new Set(c.scans.map((s) => s.device?.name).filter(Boolean))].join(' | '), [...new Set(c.scans.map((s) => s.gate).filter(Boolean))].join(' | '),
    c.summary, c.resolution, c.resolvedBy, c.resolvedAt, c.resolutionReason,
  ].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n');
}
