import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 16 - Purchase Intent Analytics & Funnel Page Tests', async (t) => {
  let adminToken = null;
  let customerToken = null;
  let customerUser = null;
  let targetEvent = null;

  // 1. Authenticate Roles
  await t.test('1. Authenticate Super Admin and Customer', async () => {
    const adminRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ticketledger.pk', password: 'Password@123' }),
    });
    const adminData = await adminRes.json();
    assert.equal(adminRes.status, 200);
    adminToken = adminData.data.token;

    const custRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@ticketledger.pk', password: 'Password@123' }),
    });
    const custData = await custRes.json();
    assert.equal(custRes.status, 200);
    customerToken = custData.data.token;
    customerUser = custData.data.user;
  });

  // 2. Fetch an active event
  await t.test('2. Retrieve active event for intent analysis', async () => {
    const res = await fetch(`${BASE_URL}/events`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.events.length > 0);
    targetEvent = data.data.events[0];
  });

  // 3. Generate behavioral events across funnel stages
  await t.test('3. Simulate customer clickstream funnel interactions', async () => {
    // 3a. Event View
    await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'event_view',
        eventId: targetEvent.id,
        metadata: { source: 'organic_search' },
      }),
    });

    // 3b. Seat Selected
    await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'seat_selected',
        eventId: targetEvent.id,
        metadata: { seatId: 'test_seat_1', section: 'VIP' },
      }),
    });

    // 3c. Checkout Started
    await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'checkout_started',
        eventId: targetEvent.id,
        metadata: { cartValue: 5000 },
      }),
    });

    // 3d. Checkout Abandoned (simulating cart drop-off)
    await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'checkout_abandoned',
        eventId: targetEvent.id,
        metadata: { reason: 'payment_hesitation' },
      }),
    });
  });

  // 4. Organizer / Admin inspects Purchase Intent Analytics
  await t.test('4. Fetch Event Intent Analytics, Summary KPIs, and Funnel', async () => {
    const res = await fetch(`${BASE_URL}/analytics/intent/${targetEvent.id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    const a = data.data;
    assert.equal(a.eventId, targetEvent.id);
    assert.equal(a.eventName, targetEvent.name);

    // Verify Summary KPIs
    assert.ok(typeof a.summary.totalWatchers === 'number');
    assert.ok(a.summary.totalWatchers >= 1);
    assert.ok(typeof a.summary.avgIntentScore === 'number');
    assert.ok(a.summary.avgIntentScore >= 0 && a.summary.avgIntentScore <= 100);

    // Verify 5 Funnel Stages: Viewed -> Seat Selected -> Checkout -> Payment -> Ticket Issued
    assert.equal(a.funnel.length, 5);
    assert.equal(a.funnel[0].key, 'viewed');
    assert.equal(a.funnel[1].key, 'seat_selected');
    assert.equal(a.funnel[2].key, 'checkout_started');
    assert.equal(a.funnel[3].key, 'payment_completed');
    assert.equal(a.funnel[4].key, 'ticket_issued');

    assert.ok(a.funnel[0].count >= 1);
    assert.ok(a.funnel[1].count >= 1);
    assert.ok(a.funnel[2].count >= 1);

    // Verify Users Likely to Buy list
    assert.ok(Array.isArray(a.usersLikelyToBuy));
    const customerProspect = a.usersLikelyToBuy.find((u) => u.userId === customerUser.id);
    assert.ok(customerProspect, 'Customer should appear in intent analytics');
    assert.ok(customerProspect.intentScore >= 50);
    assert.ok(customerProspect.recommendedAction);

    // Verify Abandoned Users list
    assert.ok(Array.isArray(a.abandonedUsers));
    const customerAbandoned = a.abandonedUsers.find((u) => u.userId === customerUser.id);
    assert.ok(customerAbandoned, 'Customer should appear in abandoned users list');
    assert.equal(customerAbandoned.abandonmentStage, 'CHECKOUT_STAGE');
    assert.ok(customerAbandoned.recommendedRecoveryAction);
  });

  // 5. Test Access Control: Customer cannot access Organizer Analytics
  await t.test('5. Non-organizer customer blocked from intent analytics with 403', async () => {
    const res = await fetch(`${BASE_URL}/analytics/intent/${targetEvent.id}`, {
      headers: {
        Authorization: `Bearer ${customerToken}`,
      },
    });
    assert.equal(res.status, 403);
  });

  // 6. Organizer sends targeted Reminder to High Intent Attendee
  await t.test('6. Organizer dispatches targeted reminder to high-intent attendee', async () => {
    const res = await fetch(`${BASE_URL}/analytics/intent/${targetEvent.id}/send-reminder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        targetUserId: customerUser.id,
        reminderType: 'EVENT_REMINDER',
        customMessage: 'Limited seats left for PSL match! Complete your reservation now.',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.message.includes('successfully sent'));
    assert.equal(data.notification.userId, customerUser.id);
    assert.equal(data.notification.type, 'EVENT_REMINDER');
  });

  // 7. Verify Customer received the notification
  await t.test('7. Customer inbox receives the organizer intent reminder', async () => {
    const res = await fetch(`${BASE_URL}/notifications?limit=5`, {
      headers: {
        Authorization: `Bearer ${customerToken}`,
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.notifications.length > 0);

    const received = data.data.notifications.find((n) => n.type === 'EVENT_REMINDER');
    assert.ok(received, 'Customer inbox must contain the EVENT_REMINDER');
    assert.match(received.message, /PSL match/i);
  });

  // 8. Organizer dispatches Batch Reminders
  await t.test('8. Organizer dispatches batch reminders to high-intent cohort', async () => {
    const res = await fetch(`${BASE_URL}/analytics/intent/${targetEvent.id}/batch-reminder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        targetAudience: 'HIGH_INTENT',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.dispatchedCount >= 1);
    assert.equal(data.targetAudience, 'HIGH_INTENT');
  });
});
