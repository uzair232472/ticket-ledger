import express from 'express';
import { getEventExtras } from '../controllers/eventExtrasController.js';
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
  updateEvent,
  deleteEvent,
  checkEventSchedule,
  getCategories,
  createCategory,
  setInitialTiers,
} from '../controllers/eventController.js';
import { EVENT_IMAGE_SPECS, HERO_VIDEO_SPECS, LARGEST_IMAGE_BYTES } from '../config/eventMedia.js';
import { requestPromotion, withdrawPromotion, getHeroPromotions } from '../controllers/promotionController.js';
import {
  getLifecycle,
  cancelEventHandler,
  postponeEventHandler,
  rescheduleEventHandler,
  withdrawRescheduleHandler,
  getRefundOptions,
  requestRefundHandler,
} from '../controllers/lifecycleController.js';
import {
  joinEventWaitlist,
  getEventWaitlistStatus,
} from '../controllers/ticketTransferController.js';
import { authenticateJWT, optionalAuth, loadOrgContext, orgGuard } from '../middlewares/auth.js';
import { getRecommendations, postRecommendationClick, postRecommendationRendered } from '../controllers/recommendationController.js';
import { recBeaconRateLimiter } from '../middlewares/rateLimit.js';
import { requireApprovedOrganizer } from '../controllers/companyController.js';

import { getSubmissionStatus, submitEventForReview, replyToReview, withdrawFromReview } from '../controllers/eventReviewController.js';

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

// Hero promo videos (promotion requests): their own size limit, checked again per placement
const promoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: HERO_VIDEO_SPECS.desktop.maxBytes, files: 2 } });
const promoVideoUpload = (req, res, next) =>
  promoUpload.fields([{ name: 'heroVideo', maxCount: 1 }, { name: 'heroVideoMobile', maxCount: 1 }])(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `A video is larger than ${HERO_VIDEO_SPECS.desktop.maxBytes / (1024 * 1024)} MB.` : MULTER_MESSAGES[err.code] || err.message;
      return res.status(400).json({ success: false, message });
    }
    return next(err);
  });

// Event categories: the fixed list plus organizer-added ones (adding needs an approved organizer company)
router.get('/categories', getCategories);
router.post('/categories', authenticateJWT, loadOrgContext, requireApprovedOrganizer, createCategory);

// Live venue / schedule check for the organizer's create and edit form (before /:id so it isn't an event id)
router.get('/schedule-check', ...orgGuard('event.view'), checkEventSchedule);

// Public discovery endpoints with optional authentication to attribute user views
router.get('/', optionalAuth, getEvents);
// Recommendation experiment (rules + control group; logged for Step 5 data collection, not shown in the app yet)
router.get('/recommendations', optionalAuth, getRecommendations);
router.post('/recommendations/:listId/click', optionalAuth, recBeaconRateLimiter, postRecommendationClick);
router.post('/recommendations/:listId/rendered', optionalAuth, recBeaconRateLimiter, postRecommendationRendered);
// Events approved for the home page hero (before /:id so it isn't an event id)
router.get('/promoted-hero', getHeroPromotions);
router.get('/:id', optionalAuth, getEventById);

// Waitlist endpoints
router.post('/:eventId/waitlist', authenticateJWT, joinEventWaitlist);
router.get('/:eventId/waitlist', authenticateJWT, getEventWaitlistStatus);

// Organizer protected endpoints
router.post(
  '/',
  authenticateJWT,
  loadOrgContext,
  requireApprovedOrganizer,
  eventMediaUpload,
  createEvent
);

// Edit event details and media (owning organizer or Super Admin; checked in the controller)
router.get(
  '/:id/manage',
  ...orgGuard('event.view'),
  getEventForEdit
);

router.put(
  '/:id',
  ...orgGuard('event.edit'),
  eventMediaUpload,
  updateEvent
);

// First ticket tiers of an event created without any (a reserved prebooked date)
router.post('/:id/tiers', ...orgGuard('event.edit'), setInitialTiers);

router.get(
  '/organizer/my-events',
  ...orgGuard('event.view'),
  getOrganizerEvents
);

// Review & submit: readiness check, and sending the event to admins for approval
router.get('/:id/submission', ...orgGuard('event.view'), getSubmissionStatus);
router.post('/:id/submit', ...orgGuard('event.submit'), submitEventForReview);
// Answer an admin's question (and optionally accept the date they suggested)
router.post('/:id/review-reply', ...orgGuard('event.submit', { allowPlatformAdmin: false }), replyToReview);
// Take it back from review to change it (editing is locked while an admin reviews it)
router.post('/:id/review-withdraw', ...orgGuard('event.submit', { allowPlatformAdmin: false }), withdrawFromReview);

// Promotion requests: top of listings and the home page hero (owning organizer or Super Admin)
router.post('/:id/promotion', ...orgGuard('event.promote'), promoVideoUpload, requestPromotion);
router.delete('/:id/promotion/:kind', ...orgGuard('event.promote'), withdrawPromotion);

// Cancel, postpone or move an event with ticket holders (owning organizer or Super Admin)
const manageGuard = orgGuard('event.lifecycle');
router.get('/:id/lifecycle', manageGuard, getLifecycle);
// Cancelling refunds every ticket holder: it also needs finance.refunds
router.post('/:id/cancel', orgGuard(['event.lifecycle', 'finance.refunds']), cancelEventHandler);
router.post('/:id/postpone', manageGuard, postponeEventHandler);
router.post('/:id/reschedule', manageGuard, rescheduleEventHandler);
router.delete('/:id/reschedule', manageGuard, withdrawRescheduleHandler);

// Ticket holders: refund choices after a reschedule or postponement
router.get('/:id/refund-options', authenticateJWT, getRefundOptions);
router.post('/:id/refund-request', authenticateJWT, requestRefundHandler);

// Delete an event (owning organizer or Super Admin; refused while tickets are sold or being paid for)
router.delete('/:id', ...orgGuard('event.delete'), deleteEvent);

router.patch(
  '/:id/status',
  ...orgGuard('event.lifecycle'),
  updateEventStatus
);

// Module 17: Pre-Launch Demand Forecast & Pricing Adjustments
router.get(
  '/:id/prelaunch-forecast',
  ...orgGuard('event.pricing'),
  getPreLaunchDemandForecast
);

router.put(
  '/:id/pricing',
  ...orgGuard('event.pricing'),
  updateEventPricing
);

router.post(
  '/:id/publish',
  ...orgGuard('event.pricing'),
  publishEventWithPricing
);

// Public extras of an event page: announcements, other dates of its series, sales window, policies
router.get('/:id/extras', getEventExtras);

export default router;
