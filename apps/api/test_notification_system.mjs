import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 12 - Notification System Multi-Channel Tests', async (t) => {
  let customerToken = null;
  let customerUser = null;
  let testNotificationId = null;

  // 1. Authenticate Customer
  await t.test('1. Authenticate Customer', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer@ticketledger.pk',
        password: 'Password@123',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.token);
    customerToken = data.data.token;
    customerUser = data.data.user;
  });

  // 2. Register FCM Device Token for Push Notifications
  await t.test('2. Register Firebase Cloud Messaging (FCM) device token', async () => {
    const mockFCMToken = `fcm_device_${Date.now()}_a1b2c3d4e5f6`;
    const res = await fetch(`${BASE_URL}/notifications/fcm-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ fcmToken: mockFCMToken }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.match(data.message, /FCM device token registered/i);
    assert.ok(data.data.totalTokens >= 1);
  });

  // 3. Multi-Channel Dispatch: Booking Confirmation
  await t.test('3. Dispatch BOOKING_CONFIRMATION across In-App, Nodemailer Email, FCM & Socket.io', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'BOOKING_CONFIRMATION',
        title: '🎟️ Booking Confirmed: PSL 2026 Final',
        message: 'Your order #ORD-9821 has been placed successfully. 2 VIP seats are reserved for 10 minutes.',
        data: {
          orderId: 'ORD-9821',
          event: 'PSL 2026 Final: Lahore Qalandars vs Karachi Kings',
          seats: 'Section VIP-A, Row 4 #12, #13',
          totalAmount: 'PKR 7,000',
        },
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.notification.type, 'BOOKING_CONFIRMATION');
    assert.equal(data.data.channels.inApp.success, true);
    assert.equal(data.data.channels.email.success, true);
    assert.ok(data.data.channels.email.messageId);
    assert.equal(data.data.channels.fcm.success, true);
    assert.ok(data.data.channels.fcm.messageId);

    testNotificationId = data.data.notification.id;
  });

  // 4. Multi-Channel Dispatch: Payment Confirmation
  await t.test('4. Dispatch PAYMENT_CONFIRMATION alert with transaction receipt', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'PAYMENT_CONFIRMATION',
        title: '💳 Payment Received (JazzCash)',
        message: 'Your payment of PKR 7,000 via JazzCash has settled successfully.',
        data: {
          gateway: 'JazzCash',
          txRef: 'JC-88291039',
          amount: 'PKR 7,000',
        },
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.notification.type, 'PAYMENT_CONFIRMATION');
    assert.equal(data.data.channels.inApp.success, true);
    assert.equal(data.data.channels.email.success, true);
  });

  // 5. Multi-Channel Dispatch: Ticket Issued
  await t.test('5. Dispatch TICKET_ISSUED with on-chain NFT badge and wallet link', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'TICKET_ISSUED',
        title: '✨ Polygon Amoy NFT Gate Pass Ready!',
        message: 'Your cryptographically signed turnstile pass is ready in your digital wallet.',
        data: {
          tokenId: 1042,
          network: 'Polygon Amoy (Chain ID 80002)',
          contract: '0x3264...E782',
        },
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.notification.type, 'TICKET_ISSUED');
  });

  // 6. Multi-Channel Dispatch: Event Reminder
  await t.test('6. Dispatch EVENT_REMINDER notification', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'EVENT_REMINDER',
        title: '⏰ Event Reminder: Gates Open in 2 Hours',
        message: 'Lahore Qalandars vs Karachi Kings starts at 7:00 PM at Gaddafi Stadium.',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.notification.type, 'EVENT_REMINDER');
  });

  // 7. Multi-Channel Dispatch: Ticket Transferred
  await t.test('7. Dispatch TICKET_TRANSFERRED notification', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'TICKET_TRANSFERRED',
        title: '🔄 Ticket Transferred Successfully',
        message: 'Your ticket has been transferred. Your previous gate pass QR code is now revoked.',
        data: {
          recipient: 'friend@ticketledger.pk',
          qrStatus: 'REVOKED_ON_CHAIN',
        },
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.notification.type, 'TICKET_TRANSFERRED');
  });

  // 8. Multi-Channel Dispatch: Resale Available
  await t.test('8. Dispatch RESALE_AVAILABLE notification to waitlist users', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'RESALE_AVAILABLE',
        title: '🎟️ Resale Ticket Listed (110% Anti-Scalping Cap)',
        message: 'A verified seat in VIP Enclosure just opened up for Atif Aslam Live at Rs. 4,200.',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.notification.type, 'RESALE_AVAILABLE');
  });

  // 9. Multi-Channel Dispatch: Organizer Approval & Rejection
  await t.test('9. Dispatch ORGANIZER_APPROVAL and ORGANIZER_REJECTION governance alerts', async () => {
    const approvalRes = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'ORGANIZER_APPROVAL',
        title: '✓ Company Verification Approved',
        message: 'Congratulations! Your organizer credentials have been approved by Super Admin.',
      }),
    });
    const approvalData = await approvalRes.json();
    assert.equal(approvalRes.status, 200);
    assert.equal(approvalData.data.notification.type, 'ORGANIZER_APPROVAL');

    const rejectionRes = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'ORGANIZER_REJECTION',
        title: '❌ Verification Requires Additional Documents',
        message: 'NTN document was blurry. Please upload a clear scan.',
      }),
    });
    const rejectionData = await rejectionRes.json();
    assert.equal(rejectionRes.status, 200);
    assert.equal(rejectionData.data.notification.type, 'ORGANIZER_REJECTION');
  });

  // 10. Multi-Channel Dispatch: Fraud Alert
  await t.test('10. Dispatch FRAUD_ALERT security warning', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'FRAUD_ALERT',
        title: '⚠️ Security Alert: Scalper Bot Pattern Detected',
        message: 'Our AI defense detected rapid checkout attempts from multiple device fingerprints.',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.notification.type, 'FRAUD_ALERT');
  });

  // 11. Multi-Channel Dispatch: Abandoned Checkout Reminder
  await t.test('11. Dispatch ABANDONED_CHECKOUT_REMINDER recovery alert', async () => {
    const res = await fetch(`${BASE_URL}/notifications/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        type: 'ABANDONED_CHECKOUT_REMINDER',
        title: '⏳ Still Thinking? Your Selected Seats are Waiting!',
        message: 'Complete your booking before your seats are released back to the general public.',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.notification.type, 'ABANDONED_CHECKOUT_REMINDER');
  });

  // 12. In-App Notifications Feed & Unread Count
  await t.test('12. Customer retrieves in-app notifications feed with unread count', async () => {
    const res = await fetch(`${BASE_URL}/notifications?limit=20`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.total >= 9);
    assert.ok(data.data.unreadCount >= 1);
    assert.ok(data.data.notifications.length >= 9);
  });

  // 13. Mark Single Notification as Read
  await t.test('13. Mark single notification as read', async () => {
    const res = await fetch(`${BASE_URL}/notifications/${testNotificationId}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.notification.isRead, true);
  });

  // 14. Mark All Notifications as Read
  await t.test('14. Mark all notifications as read', async () => {
    const res = await fetch(`${BASE_URL}/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    // Verify unread count is 0
    const checkRes = await fetch(`${BASE_URL}/notifications?limit=5`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const checkData = await checkRes.json();
    assert.equal(checkData.data.unreadCount, 0);
  });

  // 15. Delete Notification
  await t.test('15. Delete notification from user feed', async () => {
    const res = await fetch(`${BASE_URL}/notifications/${testNotificationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
  });
});
