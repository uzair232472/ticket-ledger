import { Router } from 'express';
import { requireAuth, optionalAuth, orgGuard, requireRole } from '../middlewares/auth.js';
import {
  recordClientEvent,
  getMyBehaviorProfile,
  getUserBehaviorProfileById,
  linkSessionToUser,
  getBehaviourReport,
  getCustomerTimeline,
} from '../controllers/behaviorController.js';

const router = Router();

// 1. Client telemetry track (supports both guest sessions and logged-in users)
router.post('/track', optionalAuth, recordClientEvent);

// 2. Attach guest session to user after login
router.post('/attach-session', requireAuth, linkSessionToUser);

// 3. Current user behavioral profile & analytics
router.get('/profile', requireAuth, getMyBehaviorProfile);

// 4. Admin / Organizer inspection of any user's profile
router.get('/user/:userId', ...orgGuard('attendee.view'), getUserBehaviorProfileById);

// 5. Super admin behaviour report (by event and by customer) and one customer's timeline
router.get('/report', requireAuth, requireRole('SUPER_ADMIN'), getBehaviourReport);
router.get('/report/customers/:userId', requireAuth, requireRole('SUPER_ADMIN'), getCustomerTimeline);

export default router;
