import express from 'express';
import multer from 'multer';
import { 
  createEvent, 
  getEvents, 
  getEventById, 
  getOrganizerEvents, 
  updateEventStatus,
  getPreLaunchDemandForecast,
  updateEventPricing,
  publishEventWithPricing
} from '../controllers/eventController.js';
import {
  joinEventWaitlist,
  getEventWaitlistStatus,
} from '../controllers/ticketTransferController.js';
import { authenticateJWT, requireRole, optionalAuth } from '../middlewares/auth.js';
import { requireApprovedOrganizer } from '../controllers/companyController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB banner limit
});

// Public discovery endpoints with optional authentication to attribute user views
router.get('/', optionalAuth, getEvents);
router.get('/:id', optionalAuth, getEventById);

// Waitlist endpoints
router.post('/:eventId/waitlist', authenticateJWT, joinEventWaitlist);
router.get('/:eventId/waitlist', authenticateJWT, getEventWaitlistStatus);

// Organizer protected endpoints
router.post(
  '/',
  authenticateJWT,
  requireRole('ORGANIZER', 'SUPER_ADMIN'),
  requireApprovedOrganizer,
  upload.single('banner'),
  createEvent
);

router.get(
  '/organizer/my-events',
  authenticateJWT,
  requireRole('ORGANIZER', 'SUPER_ADMIN'),
  getOrganizerEvents
);

router.patch(
  '/:id/status',
  authenticateJWT,
  updateEventStatus
);

// Module 17: Pre-Launch Demand Forecast & Pricing Adjustments
router.get(
  '/:id/prelaunch-forecast',
  authenticateJWT,
  requireRole(['ORGANIZER', 'SUPER_ADMIN']),
  getPreLaunchDemandForecast
);

router.put(
  '/:id/pricing',
  authenticateJWT,
  requireRole(['ORGANIZER', 'SUPER_ADMIN']),
  updateEventPricing
);

router.post(
  '/:id/publish',
  authenticateJWT,
  requireRole(['ORGANIZER', 'SUPER_ADMIN']),
  publishEventWithPricing
);

export default router;
