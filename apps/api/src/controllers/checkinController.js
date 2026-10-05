import { z } from 'zod';
import prisma from '../config/prisma.js';
import { getScopedEventIds } from '../services/accessService.js';
import { scan, syncOffline, eventPack, eventStats } from '../services/checkinService.js';

const canScan = async (user, eventId) => {
  const scope = await getScopedEventIds(user);
  return scope === null || scope.includes(eventId);
};

const fail = (res, err, fallback) => {
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0]?.message || 'Invalid request' });
  console.error(fallback, err);
  return res.status(500).json({ success: false, message: fallback });
};

/** GET /api/checkin/events: the events this account scans for (assigned events for gate staff). */
export const myEvents = async (req, res) => {
  try {
    const scope = await getScopedEventIds(req.user);
    const events = await prisma.event.findMany({
      where: { ...(scope === null ? {} : { id: { in: scope } }), status: { in: ['PUBLISHED', 'PAUSED', 'COMPLETED'] } },
      select: { id: true, name: true, date: true, time: true, venue: true, city: true, status: true, cardImageUrl: true, bannerUrl: true },
      orderBy: { date: 'asc' },
    });
    res.json({ success: true, data: { events } });
  } catch (err) {
    fail(res, err, 'Could not load your events');
  }
};

/** GET /api/checkin/events/:id/pack: offline pack (assigned staff only). */
export const pack = async (req, res) => {
  try {
    if (!(await canScan(req.user, req.params.id))) return res.status(403).json({ success: false, message: 'You are not assigned to this event.' });
    const data = await eventPack(req.params.id);
    if (!data.event) return res.status(404).json({ success: false, message: 'Event not found' });
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'Could not build the offline pack');
  }
};

const scanSchema = z.object({
  code: z.string().trim().min(4, 'Scan a QR code or type the ticket code').max(400),
  eventId: z.string().min(3).max(60),
  gate: z.string().trim().max(60).optional(),
  deviceId: z.string().trim().max(80).optional(),
});

/** POST /api/checkin/scan: validate one QR / manual code and admit it. */
export const scanTicket = async (req, res) => {
  try {
    const body = scanSchema.parse(req.body);
    if (!(await canScan(req.user, body.eventId))) return res.status(403).json({ success: false, message: 'You are not assigned to this event.' });
    const data = await scan({ ...body, staffId: req.user.id });
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'Could not check this ticket');
  }
};

const syncSchema = z.object({
  eventId: z.string().min(3).max(60),
  deviceId: z.string().trim().max(80).optional(),
  scans: z
    .array(
      z.object({
        clientId: z.string().max(80).optional(),
        code: z.string().trim().min(4).max(400),
        gate: z.string().trim().max(60).optional(),
        scannedAt: z.string().max(40),
        localResult: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
        localReason: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** POST /api/checkin/sync: upload scans queued while offline. */
export const syncScans = async (req, res) => {
  try {
    const body = syncSchema.parse(req.body);
    if (!(await canScan(req.user, body.eventId))) return res.status(403).json({ success: false, message: 'You are not assigned to this event.' });
    const results = await syncOffline({ ...body, staffId: req.user.id });
    res.json({ success: true, data: { results, conflicts: results.filter((r) => r.conflict).length } });
  } catch (err) {
    fail(res, err, 'Could not sync offline scans');
  }
};

/** GET /api/checkin/events/:id/stats: entered vs. sold, per gate (own events / assigned / Super Admin). */
export const stats = async (req, res) => {
  try {
    if (!(await canScan(req.user, req.params.id))) return res.status(403).json({ success: false, message: 'You can only view your own events.' });
    res.json({ success: true, data: await eventStats(req.params.id) });
  } catch (err) {
    fail(res, err, 'Could not load entry stats');
  }
};

/** GET /api/checkin/events/:id/recent: the latest scans at an event (scanner history). */
export const recent = async (req, res) => {
  try {
    if (!(await canScan(req.user, req.params.id))) return res.status(403).json({ success: false, message: 'You are not assigned to this event.' });
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
          offline: r.offline,
          conflict: r.conflict,
          scannedAt: r.scannedAt,
          staff: r.staff?.name,
          holder: r.ticket?.user?.name?.split(/\s+/)[0] || null,
          type: r.ticket?.seat?.tier?.name || null,
        })),
      },
    });
  } catch (err) {
    fail(res, err, 'Could not load recent scans');
  }
};
