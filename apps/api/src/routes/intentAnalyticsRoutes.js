import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
import {
  getEventIntentAnalytics,
  sendAttendeeReminder,
  sendBatchAttendeeReminders,
  getAbandonedDashboard,
  sendAbandonedReminder,
  sendBatchAbandonedReminders,
} from '../controllers/intentAnalyticsController.js';

const router = Router();

// Protected: Requires ORGANIZER or SUPER_ADMIN role
const organizerGuard = [authenticateJWT, requireRole(['ORGANIZER', 'SUPER_ADMIN'])];

// Module 16: Event Intent Analytics, Funnel, Watchers, and High-Intent Users
router.get('/intent/:eventId', organizerGuard, getEventIntentAnalytics);
router.post('/intent/:eventId/send-reminder', organizerGuard, sendAttendeeReminder);
router.post('/intent/:eventId/batch-reminder', organizerGuard, sendBatchAttendeeReminders);

// Module 18: Abandoned Intent Dashboard
router.get('/abandoned', organizerGuard, getAbandonedDashboard);
router.post('/abandoned/send-reminder', organizerGuard, sendAbandonedReminder);
router.post('/abandoned/batch-reminders', organizerGuard, sendBatchAbandonedReminders);

export default router;

