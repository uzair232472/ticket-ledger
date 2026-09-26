import prisma from '../config/prisma.js';
import notificationService, { NOTIFICATION_TYPES } from '../services/notificationService.js';
import fcmService from '../services/fcmService.js';

/**
 * 1. Retrieve all notifications for the authenticated user
 */
export const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 30, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.notification.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        total,
        unreadCount,
        page: Number(page),
        notifications,
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Mark a single notification as read
 */
export const markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (notification.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: { notification: updated },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Mark all notifications as read
 */
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    const updated = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return res.status(200).json({
      success: true,
      message: `Marked ${updated.count} notifications as read`,
      data: { count: updated.count },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Delete a notification
 */
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    if (notification.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await prisma.notification.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Notification deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Register FCM Device Token for Push Notifications
 */
export const registerFCMToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.id;

    if (!fcmToken) {
      return res.status(400).json({ success: false, message: 'fcmToken is required' });
    }

    const regResult = fcmService.registerDeviceToken(userId, fcmToken);

    await prisma.user.update({
      where: { id: userId },
      data: { pushNotifications: true },
    });

    return res.status(200).json({
      success: true,
      message: 'FCM device token registered successfully for push notifications',
      data: regResult,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Send Test / Simulated Multi-Channel Notification
 */
export const sendTestNotification = async (req, res) => {
  try {
    const { type, title, message, data, targetUserId, sendEmail = true, sendPush = true } = req.body;
    const userId = targetUserId || req.user.id;

    const validTypes = Object.values(NOTIFICATION_TYPES);
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid notification type '${type}'. Allowed types: ${validTypes.join(', ')}`,
      });
    }

    const result = await notificationService.dispatchNotification({
      userId,
      type: type || NOTIFICATION_TYPES.BOOKING_CONFIRMATION,
      title: title || '🎟️ Notification Dispatch Test',
      message: message || 'This is a test notification across in-app, Nodemailer email, FCM push, and Socket.io.',
      data: data || { testField: 'Verified multi-channel delivery' },
      sendEmail: Boolean(sendEmail),
      sendPush: Boolean(sendPush),
    });

    return res.status(200).json({
      success: true,
      message: 'Multi-channel notification dispatched successfully!',
      data: result,
    });
  } catch (error) {
    console.error('Error dispatching test notification:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Live Preview Nodemailer HTML Email in Browser
 */
export const previewEmailHTML = async (req, res) => {
  try {
    const { type = 'BOOKING_CONFIRMATION' } = req.query;
    const { default: emailService } = await import('../services/emailService.js');
    
    const html = emailService.generateEmailHTML({
      type,
      title: '🎟️ Booking Confirmed: PSL 2026 Final (Lahore Qalandars vs Karachi Kings)',
      message: 'Your payment was successful and your digital ticket has been minted onto Polygon Amoy blockchain.',
      data: {
        orderId: 'ORD-9821',
        event: 'PSL 2026 Final (Gaddafi Stadium, Lahore)',
        seats: 'VIP Enclosure Row 4, Seat #12, #13',
        amount: 'PKR 7,000 (Via JazzCash)',
        nftTokenId: '#1042',
        blockchainStatus: 'Minted on Polygon Amoy (Chain 80002)',
      },
    });

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (error) {
    return res.status(500).send(`Failed to generate email preview: ${error.message}`);
  }
};
