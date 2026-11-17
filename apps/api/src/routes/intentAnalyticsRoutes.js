import { Router } from 'express';
import { orgGuard } from '../middlewares/auth.js';
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
const viewGuard = orgGuard('attendee.view');
const contactGuard = orgGuard(['attendee.view', 'attendee.contact']);

// Module 16: Event Intent Analytics, Funnel, Watchers, and High-Intent Users
router.get('/intent/:eventId', viewGuard, getEventIntentAnalytics);
router.post('/intent/:eventId/send-reminder', contactGuard, sendAttendeeReminder);
router.post('/intent/:eventId/batch-reminder', contactGuard, sendBatchAttendeeReminders);

// Module 18: Abandoned Intent Dashboard
router.get('/abandoned', viewGuard, getAbandonedDashboard);
router.post('/abandoned/send-reminder', contactGuard, sendAbandonedReminder);
router.post('/abandoned/batch-reminders', contactGuard, sendBatchAbandonedReminders);

export default router;

