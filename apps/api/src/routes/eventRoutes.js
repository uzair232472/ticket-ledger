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
  publishEventWithPricing,
  getEventForEdit,
  updateEvent
} from '../controllers/eventController.js';
import { EVENT_IMAGE_SPECS, LARGEST_IMAGE_BYTES } from '../config/eventMedia.js';
import {
  joinEventWaitlist,
  getEventWaitlistStatus,
} from '../controllers/ticketTransferController.js';
import { authenticateJWT, requireRole, optionalAuth } from '../middlewares/auth.js';
import { requireApprovedOrganizer } from '../controllers/companyController.js';

import { getSubmissionStatus, submitEventForReview } from '../controllers/eventReviewController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // Per-placement size, type and dimension checks run in eventMediaService from the file bytes
  limits: { fileSize: LARGEST_IMAGE_BYTES },
});

const EVENT_MEDIA_FIELDS = [
  { name: 'banner', maxCount: 1 },
  { name: 'cardImage', maxCount: 1 },
  { name: 'galleryWide', maxCount: 1 },
  { name: 'galleryImages', maxCount: EVENT_IMAGE_SPECS.gallery.maxCount },
];

// Multer errors (oversized file, too many files, unknown field) become 400s with a readable message
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: `An image is larger than ${LARGEST_IMAGE_BYTES / (1024 * 1024)} MB.`,
  LIMIT_FILE_COUNT: 'Too many images in one upload.',
  LIMIT_UNEXPECTED_FILE: `Too many images, or an unknown image field. Scrolling Gallery Images allows up to ${EVENT_IMAGE_SPECS.gallery.maxCount}.`,
};
const eventMediaUpload = (req, res, next) =>
  upload.fields(EVENT_MEDIA_FIELDS)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: MULTER_MESSAGES[err.code] || err.message });
    }
    return next(err);
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
  eventMediaUpload,
  createEvent
);

// Edit event details and media (owning organizer or Super Admin; checked in the controller)
router.get(
  '/:id/manage',
  authenticateJWT,
  requireRole('ORGANIZER', 'SUPER_ADMIN'),
  getEventForEdit
);

router.put(
  '/:id',
  authenticateJWT,
  requireRole('ORGANIZER', 'SUPER_ADMIN'),
  eventMediaUpload,
  updateEvent
);

router.get(
  '/organizer/my-events',
  authenticateJWT,
  requireRole('ORGANIZER', 'SUPER_ADMIN'),
  getOrganizerEvents
);

// Review & submit: readiness check, and sending the event to admins for approval
router.get('/:id/submission', authenticateJWT, requireRole('ORGANIZER', 'SUPER_ADMIN'), getSubmissionStatus);
router.post('/:id/submit', authenticateJWT, requireRole('ORGANIZER', 'SUPER_ADMIN'), submitEventForReview);

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
