import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import emailService from './emailService.js';
import fcmService from './fcmService.js';

export const NOTIFICATION_TYPES = {
  BOOKING_CONFIRMATION: 'BOOKING_CONFIRMATION',
  PAYMENT_CONFIRMATION: 'PAYMENT_CONFIRMATION',
  TICKET_ISSUED: 'TICKET_ISSUED',
  EVENT_REMINDER: 'EVENT_REMINDER',
  TICKET_TRANSFERRED: 'TICKET_TRANSFERRED',
  RESALE_AVAILABLE: 'RESALE_AVAILABLE',
  ORGANIZER_APPROVAL: 'ORGANIZER_APPROVAL',
  ORGANIZER_REJECTION: 'ORGANIZER_REJECTION',
  FRAUD_ALERT: 'FRAUD_ALERT',
  ABANDONED_CHECKOUT_REMINDER: 'ABANDONED_CHECKOUT_REMINDER',
};

/**
 * Dispatch multi-channel notification (In-App + Socket.io + Email + FCM Push)
 */
export const dispatchNotification = async ({
  userId,
  type,
  title,
  message,
  data = {},
  sendEmail = true,
  sendPush = true,
}) => {
  if (!userId) {
    throw new Error('User ID is required to dispatch notification');
  }

  // 1. Fetch user to verify notification preferences and get email
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailNotifications: true,
      pushNotifications: true,
    },
  });

  if (!user) {
    throw new Error(`User with ID ${userId} not found`);
  }

  // 2. In-App Notification (Prisma DB Write)
  const inAppRecord = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      isRead: false,
    },
  });

  const responseSummary = {
    notification: inAppRecord,
    channels: {
      inApp: { success: true, id: inAppRecord.id },
      socket: { success: false },
      email: { success: false },
      fcm: { success: false },
    },
  };

  // 3. Socket.io Real-Time Alert
  try {
    const io = getIO();
    if (io) {
      // Emit to targeted user room
      io.to(`user_${userId}`).emit('notification', inAppRecord);
      // Emit to global user-specific event channel
      io.emit(`notification_${userId}`, inAppRecord);
      responseSummary.channels.socket = { success: true, event: 'notification' };
    }
  } catch (socketErr) {
    console.warn('[NotificationService] Socket.io emission skipped/failed:', socketErr.message);
  }

  // 4. Nodemailer Email Dispatch
  if (sendEmail && user.emailNotifications && user.email) {
    try {
      const emailResult = await emailService.sendEmailNotification({
        to: user.email,
        subject: `[TicketLedger] ${title}`,
        type,
        title,
        message,
        data,
      });
      responseSummary.channels.email = {
        success: true,
        messageId: emailResult.messageId,
        recipient: user.email,
      };
    } catch (emailErr) {
      console.warn('[NotificationService] Email delivery failed:', emailErr.message);
      responseSummary.channels.email = { success: false, error: emailErr.message };
    }
  }

  // 5. Firebase Cloud Messaging (FCM) Push Abstraction
  if (sendPush && user.pushNotifications) {
    try {
      const fcmResult = await fcmService.sendFCMPushNotification({
        userId,
        title,
        body: message,
        data: {
          ...data,
          notificationId: inAppRecord.id,
          type,
        },
      });
      responseSummary.channels.fcm = {
        success: true,
        messageId: fcmResult.messageId,
        status: fcmResult.status,
      };
    } catch (fcmErr) {
      console.warn('[NotificationService] FCM push failed:', fcmErr.message);
      responseSummary.channels.fcm = { success: false, error: fcmErr.message };
    }
  }

  return responseSummary;
};

export default {
  NOTIFICATION_TYPES,
  dispatchNotification,
};
