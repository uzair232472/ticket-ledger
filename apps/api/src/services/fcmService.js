import crypto from 'crypto';

// In-memory registry of FCM device tokens per user
const userDeviceTokens = new Map();

/**
 * Register an FCM device token for an attendee/organizer
 */
export const registerDeviceToken = (userId, fcmToken) => {
  if (!userId || !fcmToken) return;
  if (!userDeviceTokens.has(userId)) {
    userDeviceTokens.set(userId, new Set());
  }
  userDeviceTokens.get(userId).add(fcmToken);
  return { success: true, totalTokens: userDeviceTokens.get(userId).size };
};

/**
 * Get all registered tokens for a user
 */
export const getUserDeviceTokens = (userId) => {
  if (!userDeviceTokens.has(userId)) return [];
  return Array.from(userDeviceTokens.get(userId));
};

/**
 * Firebase Cloud Messaging push dispatch abstraction
 */
export const sendFCMPushNotification = async ({ userId, token, title, body, data = {} }) => {
  const targetToken = token || (userId ? getUserDeviceTokens(userId)[0] : null) || 'fcm_mock_device_token_' + Math.random().toString(36).substring(7);
  
  // Construct standard FCM v1 payload
  const fcmPayload = {
    message: {
      token: targetToken,
      notification: {
        title,
        body,
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(typeof v === 'object' ? JSON.stringify(v) : v)])
        ),
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channel_id: 'ticketledger_high_priority',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    },
  };

  // Mock / Abstraction delivery receipt
  const messageId = `projects/ticketledger-fyp/messages/fcm_${crypto.randomUUID().slice(0, 16)}`;

  return {
    success: true,
    messageId,
    tokenUsed: targetToken,
    fcmPayload,
    status: 'DELIVERED',
    timestamp: new Date().toISOString(),
  };
};

export default {
  registerDeviceToken,
  getUserDeviceTokens,
  sendFCMPushNotification,
};
