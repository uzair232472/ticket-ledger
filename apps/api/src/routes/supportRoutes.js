import express from 'express';
import multer from 'multer';
import { authenticateJWT } from '../middlewares/auth.js';
import * as c from '../controllers/supportController.js';

// Helpdesk. Signed-in customers open and follow their tickets; support agents (and Super Admins) work the queue.
const router = express.Router();
// Files open through signed, expiring links (they work in <img> and downloads without a token)
router.get('/attachments/:id', c.download);
router.use(authenticateJWT);

// Screenshots and documents: images or PDF, 5 MB each, 5 per message
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
const m = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => (TYPES.has(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error(`"${file.originalname}" is not an image or PDF.`), { status: 400 }))),
});
const attachments = (req, res, next) => m.array('attachments', 5)(req, res, (err) => {
  if (!err) return next();
  let message = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') message = 'Each attachment must be 5 MB or smaller.';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') message = 'Attach at most 5 files.';
  return res.status(400).json({ success: false, message });
});

router.get('/meta', c.meta);
router.get('/tickets', c.mine);
// Organizations: requests about their events (support.respond)
router.get('/org/tickets', c.orgTickets);
router.post('/tickets', attachments, c.create);

// Agents (checked in the service)
router.get('/desk/tickets', c.queue);
router.get('/desk/agents', c.agents);
router.post('/desk/agents', c.setAgent);
router.patch('/desk/tickets/:reference', c.update);
router.post('/desk/tickets/:reference/escalate', c.escalate);
router.post('/desk/tickets/:reference/deescalate', c.deescalate);

router.get('/tickets/:reference', c.getOne);
router.post('/tickets/:reference/replies', attachments, c.reply);
router.post('/tickets/:reference/close', c.closeOwn);

export default router;
