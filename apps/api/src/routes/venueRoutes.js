import express from 'express';
import multer from 'multer';
import { authenticateJWT, optionalAuth, requireRole } from '../middlewares/auth.js';
import {
  createHold,
  createTier,
  discardDraft,
  getEditor,
  getEventVenue,
  getMyHolds,
  listReusable,
  listTemplates,
  publish,
  releaseHold,
  saveDraft,
  uploadPlanImage,
} from '../controllers/venueController.js';
import { EVENT_IMAGE_SPECS } from '../config/eventMedia.js';

const router = express.Router();
const organizer = [authenticateJWT, requireRole('ORGANIZER', 'SUPER_ADMIN')];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EVENT_IMAGE_SPECS.venuePlan.maxBytes, files: 1 } });
const planUpload = (req, res, next) =>
  upload.single('plan')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `The plan image is larger than ${EVENT_IMAGE_SPECS.venuePlan.maxBytes / (1024 * 1024)} MB.` : err.message;
      return res.status(400).json({ success: false, message });
    }
    return next(err);
  });

router.get('/templates', listTemplates);

// Attendees: published plan + live availability, and holds (existing 10-minute reservations)
router.get('/holds/mine', authenticateJWT, getMyHolds);
router.get('/event/:eventId', optionalAuth, getEventVenue);
router.post('/event/:eventId/holds', authenticateJWT, createHold);
router.post('/event/:eventId/holds/release', authenticateJWT, releaseHold);

// Organizers (owner with an approved company, or Super Admin; checked per event)
router.get('/event/:eventId/editor', ...organizer, getEditor);
router.put('/event/:eventId/draft', ...organizer, saveDraft);
router.delete('/event/:eventId/draft', ...organizer, discardDraft);
router.post('/event/:eventId/publish', ...organizer, publish);
router.post('/event/:eventId/plan-image', ...organizer, planUpload, uploadPlanImage);
router.post('/event/:eventId/tiers', ...organizer, createTier);
router.get('/event/:eventId/reusable', ...organizer, listReusable);

export default router;
