import { z } from 'zod';
import prisma from '../config/prisma.js';
import { getScopedEventIds } from '../services/accessService.js';
import { scan, syncOffline, eventPack, eventStats, GateError } from '../services/checkinService.js';
import * as gates from '../services/gateService.js';

const canScan = async (user, eventId, permission = 'gate.scan') => {
  const scope = await getScopedEventIds(user, permission);
  return scope === null || scope.includes(eventId);
};

const fail = (res, err, fallback) => {
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0]?.message || 'Invalid request' });
  if (err instanceof GateError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
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
    select: { id: true, name: true, date: true, time: true, venue: true, city: true, status: true, cardImageUrl: true, bannerUrl: true },
    orderBy: { date: 'asc' },
  });
  res.json({ success: true, data: { events } });
});

/** GET /api/checkin/events/:id/pack: offline pack (assigned staff only, from an active device). */
export const pack = handle('Could not build the offline pack', async (req, res) => {
  if (!(await canScan(req.user, req.params.id))) return notAssigned(res);
  await gates.touchDevice(req, req.params.id, String(req.query.deviceId || '').slice(0, 80), { packAt: new Date() });
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
});

/** POST /api/checkin/scan: validate one QR / manual code and admit it (entry) or record the exit. */
export const scanTicket = handle('Could not check this ticket', async (req, res) => {
  const body = scanSchema.parse(req.body);
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  await gates.touchDevice(req, body.eventId, body.deviceId, { gate: body.gate });
  const supervisor = await gates.isSupervisor(req, body.eventId);
  const data = await scan({ ...body, staffId: req.user.id, supervisor });
  res.json({ success: true, data });
});

const syncSchema = z.object({
  eventId: z.string().min(3).max(60),
  deviceId: z.string().trim().max(80).optional(),
  pending: z.number().int().min(0).optional(),
  scans: z
    .array(
      z.object({
        clientId: z.string().max(80).optional(),
        code: z.string().trim().min(4).max(400),
        gate: z.string().trim().max(60).optional(),
        gateId: z.string().max(60).optional(),
        direction: z.enum(['ENTRY', 'EXIT']).optional(),
        scannedAt: z.string().max(40),
        localResult: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
        localReason: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** POST /api/checkin/sync: upload scans queued while offline. */
export const syncScans = handle('Could not sync offline scans', async (req, res) => {
  const body = syncSchema.parse(req.body);
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  await gates.touchDevice(req, body.eventId, body.deviceId, { synced: true, pendingScans: Math.max(0, (body.pending ?? body.scans.length) - body.scans.length) });
  const results = await syncOffline({ ...body, staffId: req.user.id });
  res.json({ success: true, data: { results, conflicts: results.filter((r) => r.conflict).length } });
});

const heartbeatSchema = z.object({
  eventId: z.string().min(3).max(60),
  deviceId: z.string().trim().min(4).max(80),
  gate: z.string().trim().max(60).optional(),
  pending: z.number().int().min(0).max(100000).default(0),
  online: z.boolean().default(true),
  packAt: z.string().max(40).optional(),
});

/** POST /api/checkin/heartbeat: the scanner reports its sync status every 30 s (supervisors see it). */
export const heartbeat = handle('Could not record the device status', async (req, res) => {
  const body = heartbeatSchema.parse(req.body);
  if (!(await canScan(req.user, body.eventId))) return notAssigned(res);
  const packAt = body.packAt && !Number.isNaN(new Date(body.packAt).getTime()) ? new Date(body.packAt) : undefined;
  const d = await gates.touchDevice(req, body.eventId, body.deviceId, { gate: body.gate, pendingScans: body.pending, online: body.online, packAt });
  res.json({ success: true, data: { device: d && { id: d.id, name: d.name, status: d.status } } });
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
  await gates.touchDevice(req, body.eventId, body.deviceId);
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
export const devices = sup('Could not load devices', async (req, res, event) => res.json({ success: true, data: { devices: await gates.listDevices(event) } }));
export const updateDevice = sup('Could not update the device', async (req, res, event) => {
  const body = z.object({ name: z.string().trim().min(1).max(60).optional(), status: z.enum(['ACTIVE', 'REVOKED']).optional(), reason: z.string().trim().max(300).optional() }).parse(req.body || {});
  const d = await gates.updateDevice(req, event, req.params.deviceId, body);
  res.json({ success: true, message: body.status === 'REVOKED' ? 'Device revoked. It can no longer scan or download ticket lists.' : body.status === 'ACTIVE' ? 'Device restored.' : 'Device renamed.', data: { device: d } });
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
