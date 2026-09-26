import express from 'express';
import multer from 'multer';
import { 
  createEvent, 
  getEvents, 
  getEventById, 
  getOrganizerEvents, 
  updateEventStatus 
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

export default router;
