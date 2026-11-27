import { Router } from 'express';
import { requireAuth, orgGuard } from '../middlewares/auth.js';
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
router.post('/scan', ...orgGuard('gate.scan'), scanTicket);
router.get('/recent-scans', ...orgGuard('gate.stats'), getRecentScans);
router.get('/stats/:eventId', ...orgGuard('gate.stats'), getEventGateStats);

export default router;
