import prisma from '../config/prisma.js';
import {
  createDynamicQRPayload,
  generateQRDataUrl,
  ROTATION_WINDOW_SECONDS,
} from '../services/qrTicketService.js';
import { getScopedEventIds } from '../services/accessService.js';
import { requestContext } from '../services/orgAccess.js';

/**
 * 1. POST /api/gate/scan: retired. It admitted tickets without device authentication, gate permissions or the
 * re-entry policy. Scanners use POST /api/checkin/scan (online) and POST /api/checkin/sync (offline queue).
 */
export const scanTicket = async (req, res) => {
  console.warn(`[gate] retired POST /api/gate/scan called by user ${req.user?.id} from ${req.ip}`);
  return res.status(410).json({
    success: false,
    code: 'GATE_SCAN_RETIRED',
    message: 'This scanning endpoint was retired. Use POST /api/checkin/scan from the TicketLedger gate scanner.',
  });
};

/**
 * 2. Get Real-Time Rotating Dynamic QR Code for a ticket (Anti-Screenshot)
 */
export const getDynamicRotatingQR = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: true,
        seat: { include: { tier: true } },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // The holder, a Super Admin, or a member who scans this event (assigned, same organization)
    if (ticket.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      const scope = await getScopedEventIds(req.user, 'gate.scan');
      if (!scope.includes(ticket.eventId)) return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const payload = createDynamicQRPayload(ticket);
    const qrCodeDataUrl = await generateQRDataUrl(payload);

    return res.status(200).json({
      success: true,
      data: {
        ticketId: ticket.id,
        status: ticket.status,
        payload,
        qrCodeDataUrl,
        expiresAt: payload.expiresAt,
        windowSeconds: ROTATION_WINDOW_SECONDS,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Fetch Recent Scans for Gate Staff
 */
export const getRecentScans = async (req, res) => {
  try {
    const staffId = req.user.id;
    const { limit = 20, eventId } = req.query;

    const whereClause = {};
    // Scanner-only members (Gate Staff) see their own scans
    const ctx = req.user.role === 'SUPER_ADMIN' ? null : await requestContext(req);
    if (ctx?.role === 'GATE_STAFF' || (req.user.role === 'GATE_STAFF' && !ctx)) {
      whereClause.staffId = staffId;
    }
    // Organizers see scans for their own events only; Super Admins see everything
    const scopedIds = await getScopedEventIds(req.user, 'gate.stats');
    if (eventId && scopedIds && !scopedIds.includes(eventId)) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this event.' });
    }
    if (eventId) {
      whereClause.ticket = { eventId };
    } else if (scopedIds) {
      whereClause.ticket = { eventId: { in: scopedIds } };
    }

    const scans = await prisma.gateScan.findMany({
      where: whereClause,
      include: {
        ticket: {
          include: {
            event: { select: { id: true, name: true, venue: true, city: true } },
            seat: { include: { tier: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        },
        staff: { select: { id: true, name: true, email: true } },
      },
      orderBy: { scanTime: 'desc' },
      take: parseInt(limit, 10),
    });

    return res.status(200).json({
      success: true,
      data: {
        total: scans.length,
        scans,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Event Gate Check-In Statistics
 */
export const getEventGateStats = async (req, res) => {
  try {
    const { eventId } = req.params;

    const scopedIds = await getScopedEventIds(req.user, 'gate.stats');
    if (scopedIds && !scopedIds.includes(eventId)) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this event.' });
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        tickets: true,
      },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const totalTickets = event.tickets.length;
    const scannedCount = event.tickets.filter((t) => t.status === 'SCANNED').length;
    const activeCount = event.tickets.filter((t) => t.status === 'ACTIVE').length;

    // Scan attempts count
    const allScans = await prisma.gateScan.findMany({
      where: { ticket: { eventId } },
    });

    // Reversed admissions stay in the log but are not attendance
    const validFirstScans = allScans.filter((s) => s.result === 'VALID_FIRST_SCAN' && !s.reversedAt).length;
    const alreadyScannedAttempts = allScans.filter((s) => s.result === 'ALREADY_SCANNED').length;
    const invalidScans = allScans.filter((s) => s.result === 'INVALID_SCAN').length;

    return res.status(200).json({
      success: true,
      data: {
        eventId,
        eventName: event.name,
        totalTickets,
        admittedAttendees: scannedCount,
        pendingAttendees: activeCount,
        attendanceRate: totalTickets > 0 ? `${Math.round((scannedCount / totalTickets) * 100)}%` : '0%',
        audit: {
          totalScanAttempts: allScans.length,
          validEntries: validFirstScans,
          doubleEntryAttemptsBlocked: alreadyScannedAttempts,
          counterfeitOrExpiredRejected: invalidScans,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
