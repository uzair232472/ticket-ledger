import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import {
  scanTicket,
  getDynamicRotatingQR,
  getRecentScans,
  getEventGateStats,
} from '../controllers/gateController.js';

const router = Router();

// Dynamic rotating QR for attendee wallet (any authenticated attendee can fetch their rotating code)
router.get('/dynamic-qr/:ticketId', requireAuth, getDynamicRotatingQR);

// Gate Staff & Admin turnstile endpoints
router.post('/scan', requireAuth, requireRole(['GATE_STAFF', 'SUPER_ADMIN', 'ORGANIZER']), scanTicket);
router.get('/recent-scans', requireAuth, requireRole(['GATE_STAFF', 'SUPER_ADMIN', 'ORGANIZER']), getRecentScans);
router.get('/stats/:eventId', requireAuth, requireRole(['GATE_STAFF', 'SUPER_ADMIN', 'ORGANIZER']), getEventGateStats);

export default router;
