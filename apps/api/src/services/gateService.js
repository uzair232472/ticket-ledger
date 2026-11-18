import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { canAccessEvent } from './orgAccess.js';
import { GateError, broadcast, evaluate, eventStats, resolveGate } from './checkinService.js';
import { supervisorRoom } from './socketAccess.js';
import { deviceHealth, openConflictsByDevice } from './gateDiagnosticsService.js';
import { deviceAuthStatus } from '../config/gateDeviceAuth.js';

/*
 * Gate management for supervisors (permission gate.supervise): gates and their types, ticket-type limits and
 * capacity; the event's re-entry policy; which staff work which gates; scanner devices (registration, sync
 * status, revocation); exception requests from the gate (approve / deny); reversing a check-in; and per-gate
 * attendance reports. Every decision is written to the organization's activity history (AuditLog).
 */

const audit = (db, { req, companyId, action, targetType, targetId, details }) => db.auditLog.create({
  data: { userId: req.user.id, companyId, actorRole: req.org?.role || req.user.role, action, targetType, targetId, ipAddress: req.ip || null, userAgent: req.headers?.['user-agent']?.slice(0, 300) || null, details: details || {} },
});

/** The event, if the user supervises its gates (Super Admin, or a member with gate.supervise covering it). */
export async function supervisedEvent(req, eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, companyId: true, reentryPolicy: true, maxReentries: true, status: true } });
  if (!event) throw new GateError(404, 'Event not found.');
  if (!(await canAccessEvent(req.user, event, { permission: 'gate.supervise', req }))) throw new GateError(403, "You don't supervise this event's gates (gate.supervise).", 'NOT_SUPERVISOR');
  return event;
}

export const isSupervisor = async (req, eventId) => {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, companyId: true } });
  return Boolean(event) && canAccessEvent(req.user, event, { permission: 'gate.supervise', req });
};

// ── Gates and policy ───────────────────────────────────────────────────────────────────────────────────

export async function listGates(eventId) {
  const [gates, tiers, assignments] = await Promise.all([
    prisma.eventGate.findMany({ where: { eventId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.ticketTier.findMany({ where: { eventId }, select: { id: true, name: true }, orderBy: { price: 'desc' } }),
    prisma.gateAssignment.findMany({ where: { eventId } }),
  ]);
  const staffIds = [...new Set(assignments.map((a) => a.staffId))];
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, email: true } }) : [];
  const byId = Object.fromEntries(staff.map((s) => [s.id, s]));
  return {
    tiers,
    gates: gates.map((g) => ({
      ...g,
      allowedTiers: tiers.filter((t) => g.allowedTierIds.includes(t.id)),
      staff: assignments.filter((a) => a.gateId === g.id).map((a) => byId[a.staffId]).filter(Boolean),
    })),
  };
}

const GATE_FIELDS = ['name', 'type', 'allowedTierIds', 'capacityPerHour', 'active', 'sortOrder'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

async function checkTiers(eventId, ids = []) {
  if (!ids.length) return [];
  const found = await prisma.ticketTier.count({ where: { eventId, id: { in: ids } } });
  if (found !== new Set(ids).size) throw new GateError(400, 'One or more ticket types are not part of this event.');
  return [...new Set(ids)];
}

export async function createGate(req, event, input) {
  const data = pick(input, GATE_FIELDS);
  data.allowedTierIds = await checkTiers(event.id, data.allowedTierIds);
  try {
    return await prisma.$transaction(async (tx) => {
      const g = await tx.eventGate.create({ data: { ...data, eventId: event.id } });
      await audit(tx, { req, companyId: event.companyId, action: 'GATE_CREATED', targetType: 'EventGate', targetId: g.id, details: { eventId: event.id, eventName: event.name, after: data } });
      return g;
    });
  } catch (e) {
    if (e.code === 'P2002') throw new GateError(409, 'This event already has a gate with that name.');
    throw e;
  }
}

export async function updateGate(req, event, gateId, input) {
  const g = await prisma.eventGate.findFirst({ where: { id: gateId, eventId: event.id } });
  if (!g) throw new GateError(404, 'Gate not found.');
  const data = pick(input, GATE_FIELDS);
  if (data.allowedTierIds) data.allowedTierIds = await checkTiers(event.id, data.allowedTierIds);
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.eventGate.update({ where: { id: gateId }, data });
      await audit(tx, { req, companyId: event.companyId, action: 'GATE_UPDATED', targetType: 'EventGate', targetId: gateId, details: { eventId: event.id, before: pick(g, Object.keys(data)), after: data } });
      return u;
    });
    // A renamed gate keeps its history: past check-ins stored the name, so the totals follow it
    if (data.name && data.name !== g.name) {
      await prisma.$transaction([
        prisma.checkIn.updateMany({ where: { gateId }, data: { gate: data.name } }),
        prisma.ticket.updateMany({ where: { eventId: event.id, gate: g.name }, data: { gate: data.name } }),
      ]);
    }
    return updated;
  } catch (e) {
    if (e.code === 'P2002') throw new GateError(409, 'This event already has a gate with that name.');
    throw e;
  }
}

/** A gate that was used is closed instead of deleted (its check-ins stay in the reports). */
export async function deleteGate(req, event, gateId) {
  const g = await prisma.eventGate.findFirst({ where: { id: gateId, eventId: event.id } });
  if (!g) throw new GateError(404, 'Gate not found.');
  const used = await prisma.checkIn.count({ where: { gateId } });
  if (used) {
    await updateGate(req, event, gateId, { active: false });
    return { deleted: false, closed: true };
  }
  await prisma.$transaction(async (tx) => {
    await tx.eventGate.delete({ where: { id: gateId } });
    await audit(tx, { req, companyId: event.companyId, action: 'GATE_DELETED', targetType: 'EventGate', targetId: gateId, details: { eventId: event.id, name: g.name } });
  });
  return { deleted: true };
}

export async function setPolicy(req, event, { reentryPolicy, maxReentries }) {
  if (reentryPolicy === 'LIMITED' && !(maxReentries >= 1)) throw new GateError(400, 'Set how many re-entries are allowed (at least 1).');
  const data = { reentryPolicy, maxReentries: reentryPolicy === 'LIMITED' ? maxReentries : null };
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data });
    await audit(tx, { req, companyId: event.companyId, action: 'GATE_REENTRY_POLICY_CHANGED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, before: { reentryPolicy: event.reentryPolicy, maxReentries: event.maxReentries }, after: data } });
  });
  return data;
}

// ── Gate staff ─────────────────────────────────────────────────────────────────────────────────────────

/** People who can scan at this event: active members with gate.scan (event-scoped ones only when assigned). */
export async function eventScanners(event) {
  const { effectivePermissions, EVENT_SCOPED_ROLES } = await import('./orgAccess.js');
  const members = await prisma.organizationMember.findMany({ where: { companyId: event.companyId, status: 'ACTIVE' }, include: { user: { select: { id: true, name: true, email: true } } } });
  const assigned = new Set((await prisma.staffEventAssignment.findMany({ where: { eventId: event.id }, select: { staffId: true } })).map((a) => a.staffId));
  const gateRows = await prisma.gateAssignment.findMany({ where: { eventId: event.id } });
  return members
    .filter((m) => effectivePermissions(m.role, m.grantedPermissions, m.revokedPermissions).includes('gate.scan'))
    .filter((m) => !EVENT_SCOPED_ROLES.includes(m.role) || assigned.has(m.userId))
    .map((m) => ({ id: m.userId, name: m.user.name, email: m.user.email, role: m.role, gateIds: gateRows.filter((g) => g.staffId === m.userId).map((g) => g.gateId) }));
}

/** Replace the gates one staff member is limited to (empty list: every gate). */
export async function setStaffGates(req, event, staffId, gateIds) {
  const scanners = await eventScanners(event);
  const person = scanners.find((s) => s.id === staffId);
  if (!person) throw new GateError(404, 'This person does not scan at this event. Assign them to the event first (Team → Gate staff).');
  const gates = await prisma.eventGate.findMany({ where: { eventId: event.id, id: { in: gateIds } }, select: { id: true, name: true } });
  if (gates.length !== new Set(gateIds).size) throw new GateError(400, 'One or more gates are not part of this event.');
  await prisma.$transaction(async (tx) => {
    await tx.gateAssignment.deleteMany({ where: { eventId: event.id, staffId } });
    if (gates.length) await tx.gateAssignment.createMany({ data: gates.map((g) => ({ gateId: g.id, staffId, eventId: event.id, assignedById: req.user.id })) });
    await audit(tx, { req, companyId: event.companyId, action: 'GATE_STAFF_ASSIGNED', targetType: 'User', targetId: staffId, details: { eventId: event.id, eventName: event.name, staffEmail: person.email, before: person.gateIds, after: gates.map((g) => g.name) } });
  });
  getIO()?.to(`user_${staffId}`).emit('gate:assignments-changed', { eventId: event.id });
  return { staffId, gateIds: gates.map((g) => g.id) };
}

// ── Devices ────────────────────────────────────────────────────────────────────────────────────────────

const STALE_MS = 2 * 60 * 1000;

// Device identity, enrollment and per-request authentication live in deviceAuthService.js

export async function listDevices(event) {
  const devices = await prisma.gateDevice.findMany({ where: { companyId: event.companyId }, orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }] });
  const userIds = [...new Set(devices.flatMap((d) => [d.lastUserId, d.registeredById, d.revokedById]).filter(Boolean))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const name = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const now = Date.now();
  const conflicts = await openConflictsByDevice(event.id);
  const authMode = deviceAuthStatus().mode;
  return devices.map((d) => {
    const seen = d.lastSeenAt ? now - d.lastSeenAt.getTime() : Infinity;
    // in sync · waiting to upload · not seen recently · offline · revoked
    let sync = 'IN_SYNC';
    if (d.status === 'REVOKED') sync = 'REVOKED';
    else if (seen > STALE_MS) sync = d.pendingScans ? 'OFFLINE_WITH_SCANS' : 'NOT_SEEN';
    else if (!d.online) sync = 'OFFLINE';
    else if (d.pendingScans) sync = 'UPLOADING';
    return {
      id: d.id,
      name: d.name,
      status: d.status,
      sync,
      atThisEvent: d.lastEventId === event.id,
      lastGate: d.lastGate,
      lastSeenAt: d.lastSeenAt,
      lastSyncAt: d.lastSyncAt,
      packAt: d.packAt,
      pendingScans: d.pendingScans,
      lastUser: d.lastUserId ? name[d.lastUserId] || null : null,
      registeredBy: name[d.registeredById] || null,
      createdAt: d.createdAt,
      revokedAt: d.revokedAt,
      revokedBy: d.revokedById ? name[d.revokedById] || null : null,
      revokeReason: d.revokeReason,
      // Enrollment (device token): enrolled devices authenticate with their token; legacy ones only with their id
      enrolled: Boolean(d.tokenHash),
      tokenIssuedAt: d.tokenIssuedAt,
      enrolledBy: d.enrolledById ? name[d.enrolledById] || null : null,
      legacyRequests: d.legacyRequests,
      lastLegacyAt: d.lastLegacyAt,
      authFailures: d.authFailures,
      lastAuthFailureAt: d.lastAuthFailureAt,
      // Diagnostics (scanner heartbeat + server upload log)
      ...deviceHealth(d, { now, openConflicts: conflicts[d.id] || 0, authMode, atEvent: d.lastEventId === event.id }),
      openConflicts: conflicts[d.id] || 0,
      failedScans: d.failedScans,
      stuckScans: d.stuckScans,
      oldestPendingAt: d.oldestPendingAt,
      lastScanAt: d.lastScanAt,
      appVersion: d.appVersion,
      storagePersisted: d.storagePersisted,
      clockSkewMs: d.clockSkewMs,
      lastSyncError: d.lastSyncError,
      lastSyncErrorAt: d.lastSyncErrorAt,
      lastSeqAcked: d.lastSeqAcked,
    };
  });
}

/** The raw device row is never sent to the browser (it holds the token hash). */
const deviceView = (d) => d && { id: d.id, name: d.name, status: d.status, enrolled: Boolean(d.tokenHash), revokedAt: d.revokedAt, revokeReason: d.revokeReason, tokenIssuedAt: d.tokenIssuedAt };

/**
 * Rename, revoke / restore, or reset the enrollment of a device. Revoking and resetting both delete the device's
 * token hash, so its credential stops working at once; a restored or reset device enrolls again on its next request.
 */
export async function updateDevice(req, event, deviceId, { name, status, reason, resetEnrollment }) {
  const d = await prisma.gateDevice.findFirst({ where: { id: deviceId, companyId: event.companyId } });
  if (!d) throw new GateError(404, 'Device not found.');
  if (status === 'REVOKED' && !reason) throw new GateError(400, 'Say why the device is revoked (lost, stolen, staff left…).');
  if (resetEnrollment && !reason) throw new GateError(400, 'Say why the enrollment is reset (e.g. browser data was cleared).');
  const data = {};
  if (name) data.name = name;
  if (status && status !== d.status) Object.assign(data, status === 'REVOKED' ? { status, revokedAt: new Date(), revokedById: req.user.id, revokeReason: reason, tokenHash: null } : { status, revokedAt: null, revokedById: null, revokeReason: null });
  if (resetEnrollment && d.tokenHash) data.tokenHash = null;
  if (!Object.keys(data).length) return deviceView(d);
  const action = data.status === 'REVOKED' ? 'GATE_DEVICE_REVOKED' : data.status === 'ACTIVE' ? 'GATE_DEVICE_RESTORED' : 'tokenHash' in data ? 'GATE_DEVICE_ENROLLMENT_RESET' : 'GATE_DEVICE_RENAMED';
  const u = await prisma.$transaction(async (tx) => {
    const row = await tx.gateDevice.update({ where: { id: deviceId }, data });
    await audit(tx, { req, companyId: event.companyId, action, targetType: 'GateDevice', targetId: deviceId, details: { name: row.name, reason: reason || null, pendingScans: d.pendingScans, wasEnrolled: Boolean(d.tokenHash), credentialInvalidated: 'tokenHash' in data && Boolean(d.tokenHash) } });
    return row;
  });
  // The device stops at its next request; this tells it at once if it is connected
  if (d.lastUserId && action === 'GATE_DEVICE_REVOKED') getIO()?.to(`user_${d.lastUserId}`).emit('gate:device-revoked', { deviceKey: d.deviceKey });
  if (d.lastUserId && action === 'GATE_DEVICE_ENROLLMENT_RESET') getIO()?.to(`user_${d.lastUserId}`).emit('gate:device-reset', { deviceKey: d.deviceKey });
  return deviceView(u);
}

// ── Exceptions ─────────────────────────────────────────────────────────────────────────────────────────

/** A gate worker asks a supervisor to let someone in that the scanner turned away. */
export async function requestException(req, { eventId, code, gateId, gate, scanResult, reason, deviceId }) {
  const ticket = code ? await evaluate(code, eventId).then((v) => v.ticket || null).catch(() => null) : null;
  const ex = await prisma.gateException.create({
    data: { eventId, ticketId: ticket?.id || null, code: code?.slice(0, 400) || null, gateId: gateId || null, gate: gate || null, scanResult: String(scanResult || '').slice(0, 300), reason, requestedById: req.user.id, deviceId: deviceId || null },
  });
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { companyId: true, name: true } });
  await prisma.auditLog.create({ data: { userId: req.user.id, companyId: event.companyId, action: 'GATE_EXCEPTION_REQUESTED', targetType: 'GateException', targetId: ex.id, details: { eventId, gate, scanResult, reason, ticketId: ticket?.id || null } } });
  // Supervisors only (socketAccess.js puts gate.supervise members in this room)
  getIO()?.to(supervisorRoom(eventId)).emit('gate:exception', { id: ex.id, eventId, gate, reason });
  return ex;
}

export async function listExceptions(eventId, { status } = {}) {
  const rows = await prisma.gateException.findMany({ where: { eventId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
  const ids = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const tickets = await prisma.ticket.findMany({ where: { id: { in: rows.map((r) => r.ticketId).filter(Boolean) } }, select: { id: true, manualCode: true, status: true, user: { select: { name: true } }, seat: { select: { tier: { select: { name: true } } } } } });
  const tById = Object.fromEntries(tickets.map((t) => [t.id, t]));
  return rows.map((r) => ({
    ...r,
    requestedBy: name[r.requestedById] || null,
    decidedBy: r.decidedById ? name[r.decidedById] || null : null,
    ticket: r.ticketId && tById[r.ticketId] ? { id: r.ticketId, code: tById[r.ticketId].manualCode, holder: tById[r.ticketId].user?.name, type: tById[r.ticketId].seat?.tier?.name, status: tById[r.ticketId].status } : null,
  }));
}

/**
 * Approve (admits the ticket as an exception: entry recorded, CheckIn GREEN linked to the exception) or deny.
 * A ticket that doesn't exist, is cancelled or belongs to another event can't be admitted, even by exception.
 */
export async function decideException(req, event, exceptionId, { approve, note }) {
  const ex = await prisma.gateException.findFirst({ where: { id: exceptionId, eventId: event.id } });
  if (!ex) throw new GateError(404, 'Exception request not found.');
  if (ex.status !== 'PENDING') throw new GateError(409, `This request was already ${ex.status.toLowerCase()}.`);
  if (!note) throw new GateError(400, 'Add a note explaining the decision (it is kept in the audit log).');
  let t = null;
  if (approve) {
    if (!ex.ticketId) throw new GateError(409, 'No ticket was found for this request, so it cannot be admitted. Deny it, or sell the guest a ticket.');
    t = await prisma.ticket.findUnique({ where: { id: ex.ticketId }, include: { order: { select: { status: true } } } });
    if (!t || t.eventId !== event.id || t.order?.status !== 'SUCCESSFUL' || ['CANCELLED', 'TRANSFERRED', 'RESOLD'].includes(t.status)) throw new GateError(409, 'This ticket is not valid for this event (unpaid, cancelled or moved), so it cannot be admitted by exception.');
  }
  // The decision, the admission and its log in one transaction. Both updates are conditional: a second supervisor
  // deciding at the same moment, or a scan changing the ticket meanwhile, makes this one stop with nothing written.
  const updated = await prisma.$transaction(async (tx) => {
    let checkInId = null;
    if (approve) {
      const now = new Date();
      const first = t.status === 'ACTIVE';
      const { count } = await tx.ticket.updateMany({
        where: first ? { id: t.id, status: 'ACTIVE' } : { id: t.id, status: t.status, entryCount: t.entryCount },
        data: first ? { status: 'SCANNED', checkedInAt: now, checkedInById: ex.requestedById, gate: ex.gate, isInside: true, entryCount: 1 } : { isInside: true, entryCount: { increment: 1 } },
      });
      if (!count) throw new GateError(409, 'The ticket changed while you were deciding (it was just scanned). Look at it again before approving.', 'TICKET_CHANGED');
      const row = await tx.checkIn.create({
        data: { ticketId: t.id, eventId: event.id, staffId: ex.requestedById, deviceId: ex.deviceId, gate: ex.gate, gateId: ex.gateId, direction: 'ENTRY', reentry: !first, result: 'GREEN', reason: `Admitted by exception (${req.user.name}): ${note}`, exceptionId: ex.id },
      });
      checkInId = row.id;
    }
    const decided = await tx.gateException.updateMany({ where: { id: ex.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'DENIED', decidedById: req.user.id, decisionNote: note, decidedAt: new Date(), checkInId } });
    if (!decided.count) throw new GateError(409, 'Another supervisor decided this request at the same moment.', 'ALREADY_DECIDED');
    await audit(tx, { req, companyId: event.companyId, action: approve ? 'GATE_EXCEPTION_APPROVED' : 'GATE_EXCEPTION_DENIED', targetType: 'GateException', targetId: ex.id, details: { eventId: event.id, ticketId: ex.ticketId, gate: ex.gate, scanResult: ex.scanResult, reason: ex.reason, note, checkInId } });
    return tx.gateException.findUnique({ where: { id: ex.id } });
  });
  getIO()?.to(`user_${ex.requestedById}`).emit('gate:exception-decided', { id: ex.id, status: updated.status, note });
  if (approve) await broadcast(event.id, null);
  return updated;
}

// ── Reversal ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Undo an admission made by mistake (wrong person let in, test scan). The ticket is valid again: a first entry
 * goes back to never-entered, a re-entry back to outside. Only the ticket's latest admission can be reversed.
 */
export async function reverseCheckIn(req, event, checkInId, reason) {
  const c = await prisma.checkIn.findFirst({ where: { id: checkInId, eventId: event.id } });
  if (!c) throw new GateError(404, 'Check-in not found.');
  if (c.result !== 'GREEN' || c.direction !== 'ENTRY' || !c.ticketId) throw new GateError(409, 'Only an admission (a green entry scan) can be reversed.');
  if (c.reversedAt) throw new GateError(409, 'This check-in was already reversed.');
  const later = await prisma.checkIn.findFirst({ where: { ticketId: c.ticketId, result: 'GREEN', reversedAt: null, scannedAt: { gt: c.scannedAt }, id: { not: c.id } }, select: { id: true } });
  if (later) throw new GateError(409, 'The ticket was scanned again after this. Reverse the latest scan first.');
  const t = await prisma.ticket.findUnique({ where: { id: c.ticketId } });
  if (!t || t.status !== 'SCANNED') throw new GateError(409, 'This ticket is not checked in any more.');
  const firstEntry = !c.reentry && t.entryCount <= 1;
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: t.id },
      data: firstEntry ? { status: 'ACTIVE', checkedInAt: null, checkedInById: null, gate: null, isInside: false, entryCount: 0, lastExitAt: null } : { isInside: false, entryCount: { decrement: 1 } },
    });
    await tx.checkIn.update({ where: { id: c.id }, data: { reversedAt: new Date(), reversedById: req.user.id, reversalReason: reason } });
    // The GateScan mirror is kept and marked reversed (it leaves the turnout counts, not the history). Rows from
    // before check-in ids were linked are matched as the old code did: the ticket's first-entry rows.
    const mark = { reversedAt: new Date(), reversedById: req.user.id, reversalReason: reason };
    const linked = await tx.gateScan.updateMany({ where: { checkInId: c.id, reversedAt: null }, data: mark });
    if (!linked.count && firstEntry) await tx.gateScan.updateMany({ where: { ticketId: t.id, checkInId: null, result: 'VALID_FIRST_SCAN', reversedAt: null }, data: mark });
    await audit(tx, { req, companyId: event.companyId, action: 'GATE_CHECKIN_REVERSED', targetType: 'CheckIn', targetId: c.id, details: { eventId: event.id, ticketId: t.id, gate: c.gate, scannedAt: c.scannedAt, reason, firstEntry } });
  });
  getIO()?.to(`user_${t.userId}`).emit('ticket:checkin-reversed', { ticketId: t.id });
  await broadcast(event.id, null);
  return { reversed: true, ticketValidAgain: firstEntry };
}

/** Check-ins of an event for supervisors (filters: gate, result, staff, search by ticket code). */
export async function listCheckIns(eventId, { gateId, result, direction, staffId, q, page = 1, limit = 50 } = {}) {
  const where = { eventId, ...(gateId ? { gateId } : {}), ...(result ? { result } : {}), ...(direction ? { direction } : {}), ...(staffId ? { staffId } : {}) };
  if (q) where.ticket = { OR: [{ manualCode: { contains: q.toUpperCase() } }, { user: { name: { contains: q, mode: 'insensitive' } } }] };
  const take = Math.min(200, Math.max(1, Number(limit) || 50));
  const [rows, total] = await Promise.all([
    prisma.checkIn.findMany({ where, orderBy: { scannedAt: 'desc' }, skip: (Math.max(1, Number(page)) - 1) * take, take, include: { staff: { select: { name: true } }, ticket: { select: { id: true, manualCode: true, user: { select: { name: true } }, seat: { select: { tier: { select: { name: true } } } } } } } }),
    prisma.checkIn.count({ where }),
  ]);
  return {
    total,
    page: Number(page),
    limit: take,
    items: rows.map((r) => ({ id: r.id, scannedAt: r.scannedAt, result: r.result, reason: r.reason, direction: r.direction, reentry: r.reentry, gate: r.gate, gateId: r.gateId, offline: r.offline, conflict: r.conflict, deviceId: r.deviceId, staff: r.staff?.name, exceptionId: r.exceptionId, reversedAt: r.reversedAt, reversalReason: r.reversalReason, ticket: r.ticket ? { id: r.ticket.id, code: r.ticket.manualCode, holder: r.ticket.user?.name, type: r.ticket.seat?.tier?.name } : null })),
  };
}

// ── Reports ────────────────────────────────────────────────────────────────────────────────────────────

/** Per-gate attendance: entries, re-entries, exits, turned away, duplicates, exceptions, reversals, peak 15 min. */
export async function attendanceReport(eventId) {
  const [rows, gates, live] = await Promise.all([
    prisma.checkIn.findMany({ where: { eventId }, select: { gate: true, gateId: true, result: true, direction: true, reentry: true, reversedAt: true, exceptionId: true, scannedAt: true, staffId: true, offline: true, conflict: true } }),
    prisma.eventGate.findMany({ where: { eventId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    eventStats(eventId),
  ]);
  const staffIds = [...new Set(rows.map((r) => r.staffId))];
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [];
  const staffName = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const keyOf = (r) => r.gateId || `name:${r.gate || 'Unassigned gate'}`;
  const buckets = new Map();
  for (const g of gates) buckets.set(g.id, { gateId: g.id, gate: g.name, type: g.type, active: g.active, capacityPerHour: g.capacityPerHour });
  const blank = () => ({ entries: 0, reentries: 0, exits: 0, turnedAway: 0, duplicates: 0, exceptions: 0, reversed: 0, offline: 0, conflicts: 0, first: null, last: null, windows: {}, staff: {} });
  for (const r of rows) {
    const k = keyOf(r);
    if (!buckets.has(k)) buckets.set(k, { gateId: r.gateId, gate: r.gate || 'Unassigned gate' });
    const b = buckets.get(k);
    b.stats = b.stats || blank();
    const s = b.stats;
    if (r.offline) s.offline++;
    if (r.conflict) s.conflicts++;
    if (r.reversedAt) {
      s.reversed++;
      continue;
    }
    if (r.result === 'GREEN') {
      if (r.direction === 'EXIT') s.exits++;
      else {
        if (r.reentry) s.reentries++;
        else s.entries++;
        if (r.exceptionId) s.exceptions++;
        const w = Math.floor(r.scannedAt.getTime() / 900000) * 900000;
        s.windows[w] = (s.windows[w] || 0) + 1;
        s.staff[r.staffId] = (s.staff[r.staffId] || 0) + 1;
      }
    } else if (r.result === 'YELLOW') s.duplicates++;
    else s.turnedAway++;
    if (!s.first || r.scannedAt < s.first) s.first = r.scannedAt;
    if (!s.last || r.scannedAt > s.last) s.last = r.scannedAt;
  }
  const out = [...buckets.values()].map((b) => {
    const s = b.stats || blank();
    const peak = Object.entries(s.windows).sort((a, c) => c[1] - a[1])[0];
    const { windows, staff: perStaff, ...rest } = s;
    return {
      gateId: b.gateId,
      gate: b.gate,
      type: b.type || null,
      active: b.active ?? null,
      capacityPerHour: b.capacityPerHour ?? null,
      ...rest,
      peak15: peak ? { at: new Date(Number(peak[0])), entries: peak[1], ratePerHour: peak[1] * 4 } : null,
      staff: Object.entries(perStaff).map(([id, n]) => ({ name: staffName[id] || 'Staff', admitted: n })).sort((a, c) => c.admitted - a.admitted),
    };
  });
  const sum = (k) => out.reduce((n, g) => n + (g[k] || 0), 0);
  return {
    eventId,
    generatedAt: new Date(),
    totals: { sold: live.sold, entered: live.entered, inside: live.inside, entries: sum('entries'), reentries: sum('reentries'), exits: sum('exits'), turnedAway: sum('turnedAway'), duplicates: sum('duplicates'), exceptions: sum('exceptions'), reversed: sum('reversed') },
    gates: out,
  };
}

const csvCell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function reportCsv(report) {
  const head = ['Gate', 'Type', 'Entries', 'Re-entries', 'Exits', 'Turned away', 'Duplicates', 'Exceptions', 'Reversed', 'Offline scans', 'Conflicts', 'First scan', 'Last scan', 'Peak 15 min (entries)', 'Peak at', 'Capacity / hour'];
  const lines = report.gates.map((g) => [g.gate, g.type, g.entries, g.reentries, g.exits, g.turnedAway, g.duplicates, g.exceptions, g.reversed, g.offline, g.conflicts, g.first, g.last, g.peak15?.entries ?? '', g.peak15?.at ?? '', g.capacityPerHour ?? ''].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n');
}

export { resolveGate };
