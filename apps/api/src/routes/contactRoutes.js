import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.js';
import { contactRateLimiter } from '../middlewares/rateLimit.js';
import { sendContactMessage } from '../controllers/contactController.js';

const router = Router();
router.post('/', contactRateLimiter, optionalAuth, sendContactMessage);
export default router;
