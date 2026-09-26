import prisma from '../config/prisma.js';
import {
  createDynamicQRPayload,
  generateQRDataUrl,
  processGateScan,
  verifyOfflineHMAC,
  ROTATION_WINDOW_SECONDS,
} from '../services/qrTicketService.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

/**
 * 1. Process Gate Turnstile Scan (Dynamic QR Verification & Double-Entry Block)
 */
export const scanTicket = async (req, res) => {
  try {
    const { payload, gateNumber, offlineMode } = req.body;
    const staffId = req.user.id;

    if (!payload) {
      return res.status(400).json({
        success: false,
        result: 'INVALID_SCAN',
        message: 'Missing ticket QR payload',
      });
    }

    const result = await processGateScan({
      payload,
      staffId,
      gateNumber: gateNumber || 'Gate 1 - Turnstile A',
      offlineMode: Boolean(offlineMode),
    });

    if (result.valid && result.result === 'VALID_FIRST_SCAN') {
      behaviorService.trackBehavior({
        req,
        userId: result.ticket?.attendee?.id || result.ticket?.userId || null,
        action: BEHAVIOR_ACTIONS.GATE_CHECKED_IN,
        eventId: result.ticket?.event?.id || null,
        metadata: {
          ticketId: result.ticket?.id,
          gateNumber: gateNumber || 'Gate 1',
          staffId,
        },
      });
    }

    const statusCode = result.valid ? 200 : 400;
    return res.status(statusCode).json({
      success: result.valid,
      ...result,
    });
  } catch (error) {
    console.error('Error during gate scan:', error);
    return res.status(500).json({
      success: false,
      result: 'SERVER_ERROR',
      message: error.message,
    });
  }
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

    if (ticket.userId !== userId && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'GATE_STAFF') {
      return res.status(403).json({ success: false, message: 'Access denied' });
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
    if (req.user.role === 'GATE_STAFF') {
      whereClause.staffId = staffId;
    }
    if (eventId) {
      whereClause.ticket = { eventId };
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

    const validFirstScans = allScans.filter((s) => s.result === 'VALID_FIRST_SCAN').length;
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
