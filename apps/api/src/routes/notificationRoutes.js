import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  registerFCMToken,
  sendTestNotification,
  previewEmailHTML,
} from '../controllers/notificationController.js';

const router = Router();

// Public route to view generated Nodemailer HTML email in browser
router.get('/preview-email', previewEmailHTML);

// All other notification routes require authentication
router.use(requireAuth);

router.get('/', getMyNotifications);
router.patch('/read-all', markAllNotificationsAsRead);
router.patch('/:id/read', markNotificationAsRead);
router.delete('/:id', deleteNotification);
router.post('/fcm-token', registerFCMToken);
router.post('/test', sendTestNotification);

export default router;
