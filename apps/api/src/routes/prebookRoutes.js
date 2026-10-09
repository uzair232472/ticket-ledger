import express from 'express';
import multer from 'multer';
import { LARGEST_IMAGE_BYTES } from '../config/eventMedia.js';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
import { requireApprovedOrganizer } from '../controllers/companyController.js';
import {
  checkAvailability,
  createDraft,
  deleteDraft,
  getDraft,
  listDrafts,
  saveDraft,
  setVisibility,
  submitDraft,
  uploadImage,
} from '../controllers/prebookController.js';

const router = express.Router();

// Prebooking belongs to an approved organizer company
router.use(authenticateJWT, requireRole('ORGANIZER'), requireApprovedOrganizer);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LARGEST_IMAGE_BYTES } });
const singleImage = (req, res, next) =>
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? `The image is larger than ${LARGEST_IMAGE_BYTES / (1024 * 1024)} MB.` : err.message;
    return res.status(400).json({ success: false, message });
  });

router.get('/drafts', listDrafts);
router.post('/drafts', createDraft);
router.get('/drafts/:id', getDraft);
router.put('/drafts/:id', saveDraft);
router.delete('/drafts/:id', deleteDraft);
router.post('/drafts/:id/submit', submitDraft);
router.post('/check', checkAvailability);
router.post('/images', singleImage, uploadImage);
router.patch('/events/:eventId/visibility', setVisibility);

export default router;
