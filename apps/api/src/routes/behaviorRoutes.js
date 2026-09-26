import { Router } from 'express';
import { requireAuth, requireRole, optionalAuth } from '../middlewares/auth.js';
import {
  recordClientEvent,
  getMyBehaviorProfile,
  getUserBehaviorProfileById,
  linkSessionToUser,
} from '../controllers/behaviorController.js';

const router = Router();

// 1. Client telemetry track (supports both guest sessions and logged-in users)
router.post('/track', optionalAuth, recordClientEvent);

// 2. Attach guest session to user after login
router.post('/attach-session', requireAuth, linkSessionToUser);

// 3. Current user behavioral profile & analytics
router.get('/profile', requireAuth, getMyBehaviorProfile);

// 4. Admin / Organizer inspection of any user's profile
router.get('/user/:userId', requireAuth, requireRole('SUPER_ADMIN', 'ORGANIZER'), getUserBehaviorProfileById);

export default router;
