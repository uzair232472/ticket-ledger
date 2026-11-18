import { z } from 'zod';
import prisma from '../config/prisma.js';
import { getScopedEventIds } from '../services/accessService.js';
import { scan, syncOffline, eventPack, eventStats, GateError } from '../services/checkinService.js';
import * as gates from '../services/gateService.js';
import { authenticateDevice, enrollDevice } from '../services/deviceAuthService.js';
import { deviceAuthStatus } from '../config/gateDeviceAuth.js';
import { quarantine, submitEvidence } from '../services/scanQuarantineService.js';
import * as conflictsSvc from '../services/scanConflictService.js';
import * as diag from '../services/gateDiagnosticsService.js';
import { checkScanSignature } from '../services/scanSignature.js';

const canScan = async (user, eventId, permission = 'gate.scan') => {
  const scope = await getScopedEventIds(user, permission);
  return scope === null || scope.includes(eventId);
};

const fail = (res, err, fallback) => {
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0]?.message || 'Invalid request' });
  if (err instanceof GateError) return res.status(err.status).json({ success: false, code: err.code, message: err.message, ...(err.extra || {}) });
  console.error(fallback, err);
  return res.status(500).json({ success: false, message: fallback });
};
const handle = (fallback, fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return fail(res, err, fallback);
  }
};
const notAssigned = (res) => res.status(403).json({ success: false, message: 'You are not assigned to this event.' });

/** GET /api/checkin/events: the events this account scans for (assigned events for gate staff). */
export const myEvents = handle('Could not load your events', async (req, res) => {
  const scope = await getScopedEventIds(req.user);
  const events = await prisma.event.findMany({
    where: { ...(scope === null ? {} : { id: { in: scope } }), status: { in: ['PUBLISHED', 'PAUSED', 'COMPLETED'] } },
    select: { id: true, companyId: true, name: true, date: true, time: true, venue: true, city: true, status: true, cardImageUrl: true, bannerUrl: true },
    orderBy: { date: 'asc' },
  });
  res.json({ success: true, data: { events } });
});

const enrollSchema = z.object({
  eventId: z.string().min(3).max(60),
  deviceId: z.string().trim().min(4).max(80),
  // Public half of the scanner's non-extractable signing key (scanSignature.js); never a private part
  signingKey: z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().max(64), y: z.string().max(64) }).strict().optional(),
});

/**
 * POST /api/checkin/devices/enroll: issue this scanner device its token (assigned staff of the event). The token is
 * returned once; only its hash is kept. Re-enrolling an enrolled device needs its current token (X-Device-Token).
 */
export const enroll = handle('Could not enroll this device', async (req, res) => {
  const body = enrollSchema.parse(req.body || {});
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  const out = await enrollDevice(req, body.eventId, body.deviceId, { signingKey: body.signingKey });
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ success: true, data: { ...out, auth: deviceAuthStatus() } });
});

/** GET /api/checkin/events/:id/pack: offline pack (assigned staff only, from an active device). */
export const pack = handle('Could not build the offline pack', async (req, res) => {
  if (!(await canScan(req.user, req.params.id))) return notAssigned(res);
  await authenticateDevice(req, req.params.id, req.query.deviceId, { packAt: new Date() });
  const data = await eventPack(req.params.id, { staffId: req.user.id });
  if (!data.event) return res.status(404).json({ success: false, message: 'Event not found' });
  data.supervisor = await gates.isSupervisor(req, req.params.id);
  res.json({ success: true, data });
});

const scanSchema = z.object({
  code: z.string().trim().min(4, 'Scan a QR code or type the ticket code').max(400),
  eventId: z.string().min(3).max(60),
  gate: z.string().trim().max(60).optional(),
  gateId: z.string().max(60).optional(),
  direction: z.enum(['ENTRY', 'EXIT']).default('ENTRY'),
  deviceId: z.string().trim().max(80).optional(),
  // The scanner's id for this scan: a repeated request returns the first result
  clientScanId: z.string().trim().min(8).max(80).optional(),
});

/** POST /api/checkin/scan: validate one QR / manual code and admit it (entry) or record the exit. */
export const scanTicket = handle('Could not check this ticket', async (req, res) => {
  const body = scanSchema.parse(req.body);
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  await authenticateDevice(req, body.eventId, body.deviceId, { gate: body.gate });
  const supervisor = await gates.isSupervisor(req, body.eventId);
  const data = await scan({ ...body, staffId: req.user.id, supervisor, deviceRecordId: req.gateDevice?.id || null });
  res.json({ success: true, data });
});

// Each scan is validated on its own: an unreadable one is quarantined and answered REJECTED, the rest is processed
const syncScanSchema = z.object({
  clientId: z.string().max(80).optional(),
  code: z.string().trim().min(4).max(400),
  gate: z.string().trim().max(60).optional(),
  gateId: z.string().max(60).optional(),
  direction: z.enum(['ENTRY', 'EXIT']).optional(),
  scannedAt: z.string().max(40),
  localResult: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
  localReason: z.string().max(200).optional(),
  // Evidence from the scanner's scan store
  seq: z.number().int().min(1).optional(),
  ticketId: z.string().max(64).optional(),
  deviceScannedAt: z.string().max(40).optional(),
  sig: z.string().max(200).optional(), // the device's signature of the record (scanSignature.js)
});
const syncSchema = z.object({
  eventId: z.string().min(3).max(60),
  deviceId: z.string().trim().max(80).optional(),
  pending: z.number().int().min(0).optional(),
  scans: z.array(z.unknown()).min(1).max(500),
});

/**
 * POST /api/checkin/sync: upload scans queued while offline. Every scan gets its own acknowledgement (see
 * checkinService.syncOffline; REJECTED for unreadable scans, which are quarantined). lastAckedSeq: the highest
 * device sequence number now acknowledged.
 */
export const syncScans = handle('Could not sync offline scans', async (req, res) => {
  const body = syncSchema.parse(req.body);
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  const device = await authenticateDevice(req, body.eventId, body.deviceId, { synced: true, pendingScans: Math.max(0, (body.pending ?? body.scans.length) - body.scans.length) });
  const started = Date.now();
  try {
  const valid = [];
  const rejected = [];
  const tampered = [];
  let unsigned = 0;
  for (const raw of body.scans) {
    const parsed = syncScanSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ raw, detail: parsed.error.errors.map((e) => `${e.path.join('.') || 'scan'}: ${e.message}`).join('; ') });
      continue;
    }
    // A device with a signing key: the record must still match what the device signed when the scan was made
    const sig = device.signingKey ? checkScanSignature(device.signingKey, body.eventId, raw) : 'unsigned';
    if (sig === 'invalid') {
      tampered.push({ raw, detail: 'Signature does not match the device key: the record was changed after it was made' });
      continue;
    }
    if (sig === 'unsigned' && device.signingKey) unsigned += 1;
    valid.push({ ...parsed.data, deviceSigned: sig === 'valid' });
  }
  const base = { companyId: device.companyId, eventId: body.eventId, deviceKey: device.deviceKey, deviceId: device.id, submittedById: req.user.id };
  if (rejected.length) await quarantine({ ...base, reason: 'INVALID', scans: rejected });
  if (tampered.length) await quarantine({ ...base, reason: 'TAMPERED', scans: tampered });
  const supervisor = await gates.isSupervisor(req, body.eventId);
  const processed = valid.length ? await syncOffline({ scans: valid, eventId: body.eventId, staffId: req.user.id, deviceId: body.deviceId, deviceRecordId: device.id, supervisor }) : [];
  const rejectedResult = (reason) => ({ raw, detail }) => ({ clientId: typeof raw?.clientId === 'string' ? raw.clientId : null, seq: Number.isInteger(raw?.seq) ? raw.seq : null, status: 'REJECTED', result: null, reason: reason(detail), conflict: false });
  const results = [
    ...processed,
    ...rejected.map(rejectedResult((detail) => `This scan could not be read and was kept for review (${detail})`)),
    ...tampered.map(rejectedResult(() => 'This scan record was changed after it was made on the device (signature mismatch). It was kept for review and did not admit anyone.')),
  ];
  const acked = results.filter((r) => ['ACCEPTED', 'ALREADY_PROCESSED'].includes(r.status) && Number.isInteger(r.seq)).map((r) => r.seq);
  const lastAckedSeq = acked.length ? Math.max(...acked) : null;
  if (lastAckedSeq) await prisma.gateDevice.updateMany({ where: { id: device.id, OR: [{ lastSeqAcked: null }, { lastSeqAcked: { lt: lastAckedSeq } }] }, data: { lastSeqAcked: lastAckedSeq } });
  await diag.recordBatch({ device, eventId: body.eventId, userId: req.user.id, kind: 'SYNC', received: body.scans.length, results, durationMs: Date.now() - started, quarantined: rejected.length + tampered.length, lastAckedSeq });
  // New scans numbered at or below what this device had already had acknowledged: reinstalled storage or edits
  const regressions = device.lastSeqAcked ? results.filter((r) => r.status === 'ACCEPTED' && Number.isInteger(r.seq) && r.seq <= device.lastSeqAcked).length : 0;
  await diag.flagSuspicious(req, device, body.eventId, { tampered: tampered.length, unsigned, rejected: rejected.length, regressions });
  const count = (status) => results.filter((r) => r.status === status).length;
  res.json({ success: true, data: { results, conflicts: results.filter((r) => r.conflict).length, accepted: count('ACCEPTED'), alreadyProcessed: count('ALREADY_PROCESSED'), rejected: count('REJECTED'), retry: count('RETRY'), lastAckedSeq } });
  } catch (err) {
    // The failed request is part of the device's sync history (and becomes its last sync error)
    await diag.recordBatch({ device, eventId: body.eventId, userId: req.user.id, kind: 'SYNC', received: body.scans.length, durationMs: Date.now() - started, error: err.message || 'Server error' }).catch(() => {});
    throw err;
  }
});

const evidenceSchema = z.object({
  eventId: z.string().min(3).max(60),
  deviceId: z.string().trim().min(4).max(80),
  scans: z.array(z.unknown()).min(1).max(500),
});

/**
 * POST /api/checkin/evidence: a revoked device (or staff who lost the event) hands in the scans it still holds.
 * They are quarantined for supervisor review and never processed as admissions.
 */
export const evidence = handle('Could not hand in the scans', async (req, res) => {
  const body = evidenceSchema.parse(req.body || {});
  const started = Date.now();
  const out = await submitEvidence(req, body);
  if (out.device) await diag.recordBatch({ device: out.device, eventId: body.eventId, userId: req.user.id, kind: 'EVIDENCE', received: body.scans.length, durationMs: Date.now() - started, quarantined: out.stored }).catch(() => {});
  delete out.device;
  res.status(201).json({ success: true, message: 'Scans kept for supervisor review. They did not admit anyone.', data: out });
});

const heartbeatSchema = z.object({
  eventId: z.string().min(3).max(60),
  deviceId: z.string().trim().min(4).max(80),
  gate: z.string().trim().max(60).optional(),
  pending: z.number().int().min(0).max(100000).default(0),
  online: z.boolean().default(true),
  packAt: z.string().max(40).optional(),
  // Diagnostics from the scanner's scan store
  appVersion: z.string().trim().max(40).optional(),
  failed: z.number().int().min(0).max(100000).optional(),
  conflicts: z.number().int().min(0).max(100000).optional(),
  stuck: z.number().int().min(0).max(100000).optional(),
  oldestPendingAt: z.string().max(40).nullable().optional(),
  lastScanAt: z.string().max(40).nullable().optional(),
  persisted: z.boolean().optional(),
  clientTime: z.string().max(40).optional(),
  lastSyncError: z.string().max(300).nullable().optional(),
});

const dateOrNull = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null);
/** What the heartbeat reports about the device's own state (undefined fields are left as they are). */
function heartbeatDiagnostics(b) {
  const out = {};
  if (b.appVersion) out.appVersion = b.appVersion;
  if (b.failed !== undefined) out.failedScans = b.failed;
  if (b.conflicts !== undefined) out.deviceConflicts = b.conflicts;
  if (b.stuck !== undefined) out.stuckScans = b.stuck;
  if (b.oldestPendingAt !== undefined) out.oldestPendingAt = dateOrNull(b.oldestPendingAt);
  if (b.lastScanAt !== undefined) out.lastScanAt = dateOrNull(b.lastScanAt);
  if (b.persisted !== undefined) out.storagePersisted = b.persisted;
  const client = dateOrNull(b.clientTime);
  if (client) out.clockSkewMs = Math.max(-2e9, Math.min(2e9, client.getTime() - Date.now()));
  if (b.lastSyncError) Object.assign(out, { lastSyncError: b.lastSyncError, lastSyncErrorAt: new Date() });
  return out;
}

/** POST /api/checkin/heartbeat: the scanner reports its sync status every 30 s (supervisors see it). */
export const heartbeat = handle('Could not record the device status', async (req, res) => {
  const body = heartbeatSchema.parse(req.body);
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  const packAt = body.packAt && !Number.isNaN(new Date(body.packAt).getTime()) ? new Date(body.packAt) : undefined;
  const d = await authenticateDevice(req, body.eventId, body.deviceId, { gate: body.gate, pendingScans: body.pending, online: body.online, packAt, diagnostics: heartbeatDiagnostics(body) });
  res.json({ success: true, data: { device: { id: d.id, name: d.name, status: d.status, enrolled: Boolean(d.tokenHash) }, auth: { ...deviceAuthStatus(), via: req.gateDeviceAuth } } });
});

const exceptionSchema = z.object({
  eventId: z.string().min(3).max(60),
  code: z.string().trim().max(400).optional(),
  gate: z.string().trim().max(60).optional(),
  gateId: z.string().max(60).optional(),
  scanResult: z.string().trim().max(300),
  reason: z.string().trim().min(5, 'Say why this guest should be let in').max(500),
  deviceId: z.string().trim().max(80).optional(),
});

/** POST /api/checkin/exceptions: ask a supervisor to admit someone the scanner turned away. */
export const requestException = handle('Could not send the request', async (req, res) => {
  const body = exceptionSchema.parse(req.body);
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  // The device id is optional here (a request alone admits no one), but a device that sends one is checked
  if (body.deviceId) await authenticateDevice(req, body.eventId, body.deviceId);
  const ex = await gates.requestException(req, body);
  res.status(201).json({ success: true, message: 'Sent to the supervisor. Ask the guest to wait to one side.', data: { exception: ex } });
});

/** GET /api/checkin/events/:id/stats: entered vs. sold, per gate (own events / assigned / Super Admin). */
export const stats = handle('Could not load entry stats', async (req, res) => {
  if (!(await canScan(req.user, req.params.id, 'gate.stats'))) return res.status(403).json({ success: false, message: 'You can only view your own events.' });
  res.json({ success: true, data: await eventStats(req.params.id) });
});

/** GET /api/checkin/events/:id/recent: the latest scans at an event (scanner history). */
export const recent = handle('Could not load recent scans', async (req, res) => {
  if (!(await canScan(req.user, req.params.id, 'gate.stats'))) return notAssigned(res);
  const rows = await prisma.checkIn.findMany({
    where: { eventId: req.params.id },
    orderBy: { scannedAt: 'desc' },
    take: Math.min(50, Number(req.query.limit) || 20),
    include: { ticket: { select: { seat: { select: { section: true, row: true, seatNumber: true, tier: { select: { name: true } } } }, user: { select: { name: true } } } }, staff: { select: { name: true } } },
  });
  res.json({
    success: true,
    data: {
      scans: rows.map((r) => ({
        id: r.id,
        result: r.result,
        reason: r.reason,
        gate: r.gate,
        direction: r.direction,
        reentry: r.reentry,
        offline: r.offline,
        conflict: r.conflict,
        reversed: Boolean(r.reversedAt),
        scannedAt: r.scannedAt,
        staff: r.staff?.name,
        holder: r.ticket?.user?.name?.split(/\s+/)[0] || null,
        type: r.ticket?.seat?.tier?.name || null,
      })),
    },
  });
});

// ── Supervisors (gate.supervise) ───────────────────────────────────────────────────────────────────────

const sup = (fallback, fn) => handle(fallback, async (req, res) => fn(req, res, await gates.supervisedEvent(req, req.params.id)));
const gateBody = z.object({
  name: z.string().trim().min(1, 'Name the gate').max(60),
  type: z.enum(['ENTRY', 'EXIT', 'ENTRY_EXIT']).default('ENTRY_EXIT'),
  allowedTierIds: z.array(z.string().max(64)).max(50).default([]),
  capacityPerHour: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

export const overview = sup('Could not load gate management', async (req, res, event) => {
  const [g, scanners, live] = await Promise.all([gates.listGates(event.id), gates.eventScanners(event), eventStats(event.id)]);
  res.json({ success: true, data: { event, ...g, scanners, live } });
});
export const createGate = sup('Could not add the gate', async (req, res, event) => res.status(201).json({ success: true, message: 'Gate added.', data: { gate: await gates.createGate(req, event, gateBody.parse(req.body || {})) } }));
export const updateGate = sup('Could not update the gate', async (req, res, event) => res.json({ success: true, message: 'Gate updated.', data: { gate: await gates.updateGate(req, event, req.params.gateId, gateBody.partial().parse(req.body || {})) } }));
export const deleteGate = sup('Could not remove the gate', async (req, res, event) => {
  const out = await gates.deleteGate(req, event, req.params.gateId);
  res.json({ success: true, message: out.deleted ? 'Gate removed.' : 'This gate has scans, so it was closed instead (its history stays in the reports).', data: out });
});
export const setPolicy = sup('Could not change the re-entry policy', async (req, res, event) => {
  const body = z.object({ reentryPolicy: z.enum(['NONE', 'UNLIMITED', 'LIMITED']), maxReentries: z.coerce.number().int().min(1).max(50).nullable().optional() }).parse(req.body || {});
  res.json({ success: true, message: 'Re-entry policy saved.', data: await gates.setPolicy(req, event, body) });
});
export const setStaffGates = sup('Could not change gate assignments', async (req, res, event) => {
  const { gateIds } = z.object({ gateIds: z.array(z.string().max(64)).max(50) }).parse(req.body || {});
  res.json({ success: true, message: gateIds.length ? 'Gates assigned.' : 'This person can now use every gate.', data: await gates.setStaffGates(req, event, req.params.staffId, gateIds) });
});
export const devices = sup('Could not load devices', async (req, res, event) => res.json({ success: true, data: { devices: await gates.listDevices(event), auth: deviceAuthStatus() } }));
export const updateDevice = sup('Could not update the device', async (req, res, event) => {
  const body = z.object({ name: z.string().trim().min(1).max(60).optional(), status: z.enum(['ACTIVE', 'REVOKED']).optional(), reason: z.string().trim().max(300).optional(), resetEnrollment: z.boolean().optional() }).parse(req.body || {});
  const d = await gates.updateDevice(req, event, req.params.deviceId, body);
  const message = body.status === 'REVOKED' ? 'Device revoked. Its credential was deleted: it can no longer scan, upload or download ticket lists.' : body.status === 'ACTIVE' ? 'Device restored. It enrolls again on its next connection.' : body.resetEnrollment ? 'Enrollment reset. The device enrolls again on its next connection.' : 'Device renamed.';
  res.json({ success: true, message, data: { device: d } });
});
export const exceptions = sup('Could not load exception requests', async (req, res, event) => {
  const status = z.enum(['PENDING', 'APPROVED', 'DENIED', 'CANCELLED']).optional().parse(req.query.status || undefined);
  res.json({ success: true, data: { exceptions: await gates.listExceptions(event.id, { status }) } });
});
export const decideException = sup('Could not record the decision', async (req, res, event) => {
  const body = z.object({ approve: z.boolean(), note: z.string().trim().min(3, 'Add a note for the audit log').max(500) }).parse(req.body || {});
  const ex = await gates.decideException(req, event, req.params.exceptionId, body);
  res.json({ success: true, message: body.approve ? 'Approved: the guest is checked in.' : 'Denied.', data: { exception: ex } });
});
export const checkIns = sup('Could not load check-ins', async (req, res, event) => {
  const q = z.object({ gateId: z.string().max(64).optional(), result: z.enum(['GREEN', 'YELLOW', 'RED']).optional(), direction: z.enum(['ENTRY', 'EXIT']).optional(), staffId: z.string().max(64).optional(), q: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
  res.json({ success: true, data: await gates.listCheckIns(event.id, q) });
});
export const reverse = sup('Could not reverse the check-in', async (req, res, event) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Say why the check-in is reversed').max(500) }).parse(req.body || {});
  const out = await gates.reverseCheckIn(req, event, req.params.checkInId, reason);
  res.json({ success: true, message: out.ticketValidAgain ? 'Check-in reversed. The ticket is valid for entry again.' : 'Re-entry reversed. The guest is marked outside.', data: out });
});
export const report = sup('Could not build the report', async (req, res, event) => {
  const data = await gates.attendanceReport(event.id);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gate-attendance-${event.id.slice(0, 8)}.csv"`);
    return res.send(gates.reportCsv(data));
  }
  res.json({ success: true, data });
});

// ── Conflicts (offline scans that disagree with the server; see scanConflictService for the rules) ────────

const CONFLICT_TYPES = ['DUPLICATE_ADMISSION', 'TICKET_INVALIDATED', 'ORDERING', 'REENTRY_LIMIT', 'RULE_MISMATCH'];
const RESOLUTIONS = ['CONFIRMED_SINGLE_ENTRY', 'CONFIRMED_MULTIPLE_ENTRY', 'ADMISSION_ACCEPTED', 'ADMISSION_REJECTED', 'DEVICE_ERROR', 'DISMISSED'];

/** GET /api/checkin/manage/events/:id/conflicts (?status=OPEN|RESOLVED, ?type=, ?format=csv). */
export const conflicts = sup('Could not load conflicts', async (req, res, event) => {
  const q = z.object({ status: z.enum(['OPEN', 'RESOLVED']).optional(), type: z.enum(CONFLICT_TYPES).optional(), format: z.enum(['json', 'csv']).optional() }).parse(req.query);
  const data = await conflictsSvc.listConflicts(event.id, q);
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gate-conflicts-${q.status || 'all'}-${event.id.slice(0, 8)}.csv"`);
    return res.send(conflictsSvc.conflictsCsv(data.conflicts));
  }
  res.json({ success: true, data: { ...data, resolutions: conflictsSvc.RESOLUTIONS_BY_TYPE } });
});

export const conflict = sup('Could not load the conflict', async (req, res, event) => res.json({ success: true, data: { conflict: await conflictsSvc.getConflict(event.id, req.params.conflictId) } }));

/** POST /api/checkin/manage/events/:id/conflicts/:conflictId/resolve { resolution, reason }: audited; changes no ticket. */
export const resolveConflict = sup('Could not resolve the conflict', async (req, res, event) => {
  const body = z.object({ resolution: z.enum(RESOLUTIONS), reason: z.string().trim().min(10, 'Explain the decision (at least 10 characters); it is kept in the audit log').max(1000) }).parse(req.body || {});
  const out = await conflictsSvc.resolveConflict(req, event, req.params.conflictId, body);
  res.json({ success: true, message: 'Conflict resolved. The decision is in the audit history; no ticket was changed.', data: { conflict: out } });
});

// ── Diagnostics and recovery (gateDiagnosticsService) ─────────────────────────────────────────────────

/** GET /api/checkin/ping?eventId&deviceId: the scanner's "Test connection" (device-authenticated, read-only). */
export const ping = handle('Connection test failed', async (req, res) => {
  const q = z.object({ eventId: z.string().min(3).max(60), deviceId: z.string().trim().min(4).max(80) }).parse(req.query);
  if (!(await canScan(req.user, q.eventId))) return notAssigned(res);
  const d = await authenticateDevice(req, q.eventId, q.deviceId);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: { serverTime: new Date().toISOString(), device: { id: d.id, name: d.name, status: d.status, enrolled: Boolean(d.tokenHash), lastSeqAcked: d.lastSeqAcked }, auth: { ...deviceAuthStatus(), via: req.gateDeviceAuth } } });
});

/** POST /api/checkin/devices/manifest: the scanner sends the list of its unprocessed scans (a supervisor asked). */
export const manifest = handle('Could not send the pending scans', async (req, res) => {
  const body = z.object({ eventId: z.string().min(3).max(60), deviceId: z.string().trim().min(4).max(80), scans: z.array(z.record(z.unknown())).max(200) }).parse(req.body || {});
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  const d = await authenticateDevice(req, body.eventId, body.deviceId);
  res.json({ success: true, data: { stored: await diag.saveManifest(d, body.scans) } });
});

export const operations = sup('Could not load gate operations', async (req, res, event) => res.json({ success: true, data: await diag.operationsSummary(event) }));
export const deviceDetails = sup('Could not load the device', async (req, res, event) => res.json({ success: true, data: await diag.deviceDetails(event, req.params.deviceId) }));

/** POST …/devices/:deviceId/actions { action }: PING | SYNC | RETRY_FAILED | SEND_PENDING, delivered to the scanner. */
export const deviceAction = sup('Could not reach the device', async (req, res, event) => {
  const { action } = z.object({ action: z.enum(Object.keys(diag.DEVICE_ACTIONS)) }).parse(req.body || {});
  const out = await diag.requestDeviceAction(req, event, req.params.deviceId, action);
  res.json({ success: true, message: out.delivered ? `Sent to the device: ${out.label}. Its status updates within a few seconds.` : 'The device is not connected right now. It will upload by itself when it reconnects.', data: out });
});

export const quarantineList = sup('Could not load quarantined scans', async (req, res, event) => {
  const q = z.object({ status: z.enum(['PENDING_REVIEW', 'REVIEWED']).optional() }).parse(req.query);
  res.json({ success: true, data: { scans: await diag.listQuarantine(event.id, q) } });
});
export const quarantineReview = sup('Could not record the review', async (req, res, event) => {
  const body = z.object({ ids: z.array(z.string().max(64)).min(1).max(500), note: z.string().trim().min(10, 'Explain the review (at least 10 characters)').max(1000) }).parse(req.body || {});
  res.json({ success: true, message: 'Marked as reviewed. These scans stay on record and did not admit anyone.', data: await diag.reviewQuarantine(req, event, body.ids, body.note) });
});

/** GET …/reports/:kind (?format=csv): device-sync, device-activity, failed-scans, recovery-history. */
export const opsReport = sup('Could not build the report', async (req, res, event) => {
  const kind = z.enum(diag.REPORTS).parse(req.params.kind);
  const out = await diag.buildReport(event, kind);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gate-${kind}-${event.id.slice(0, 8)}.csv"`);
    return res.send(out.csv);
  }
  res.json({ success: true, data: { kind, rows: out.rows } });
});
