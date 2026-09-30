import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 18 - Abandoned Intent Dashboard Integration Test Suite', async (t) => {
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
    assert.equal(adminRes.status, 200, 'Admin login should succeed');
    adminToken = adminData.data.token;

    const custRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@ticketledger.pk', password: 'Password@123' }),
    });
    const custData = await custRes.json();
    assert.equal(custRes.status, 200, 'Customer login should succeed');
    customerToken = custData.data.token;
    customerUser = custData.data.user;
  });

  // 2. Retrieve an active event
  await t.test('2. Retrieve active event for abandonment simulation', async () => {
    const res = await fetch(`${BASE_URL}/events`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.events.length > 0, 'Should find at least 1 event');
    targetEvent = data.data.events[0];
  });

  // 3. Verify Access Control (Customer must be denied access)
  await t.test('3. Enforce RBAC: Regular customer cannot access abandoned dashboard', async () => {
    const res = await fetch(`${BASE_URL}/analytics/abandoned`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.equal(res.status, 403, 'Customer should receive 403 Forbidden');
  });

  // 4. Simulate customer clickstream journey ending in checkout abandonment
  await t.test('4. Simulate complete customer journey: view -> seat -> checkout -> abandon', async () => {
    // 4a. View Event
    const viewRes = await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'event_view',
        eventId: targetEvent.id,
        metadata: { source: 'organic_search', referrer: 'google.com.pk' },
      }),
    });
    assert.equal(viewRes.status, 200);

    // 4b. Select Seat
    const seatRes = await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'seat_selected',
        eventId: targetEvent.id,
        metadata: { seatId: 'seat_mod18_abandon_1', section: 'Pavilion' },
      }),
    });
    assert.equal(seatRes.status, 200);

    // 4c. Start Checkout
    const checkoutRes = await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'checkout_started',
        eventId: targetEvent.id,
        metadata: { cartValue: 7500, tierName: 'VIP Enclosure' },
      }),
    });
    assert.equal(checkoutRes.status, 200);

    // 4d. Abandon Checkout (with friction reason)
    const abandonRes = await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        action: 'checkout_abandoned',
        eventId: targetEvent.id,
        metadata: { reason: 'payment_hesitation', cartValue: 7500 },
      }),
    });
    assert.equal(abandonRes.status, 200);
  });

  // 5. Fetch Abandoned Intent Dashboard as Super Admin
  await t.test('5. Fetch Abandoned Intent Dashboard with all required fields', async () => {
    const res = await fetch(`${BASE_URL}/analytics/abandoned?eventId=${targetEvent.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.data.summary, 'Summary KPI object should be present');
    assert.ok(json.data.summary.totalAbandonedUsers >= 1, 'Should register at least 1 abandoned user');
    assert.ok(json.data.summary.recoverableRevenuePkr > 0, 'Recoverable revenue in PKR should be calculated');
    assert.ok(json.data.summary.avgIntentScore > 0, 'Average intent score should be calculated');
    assert.ok(json.data.summary.topReason, 'Top reason should be identified');

    // Find our customer
    const abandonedProspect = json.data.abandonedUsers.find(
      (u) => u.user.id === customerUser.id && u.event.id === targetEvent.id
    );

    assert.ok(abandonedProspect, 'Customer who abandoned should appear in the abandoned list');
    // Validate all required user fields
    assert.equal(abandonedProspect.user.name, customerUser.name);
    assert.equal(abandonedProspect.user.email, customerUser.email);
    assert.equal(abandonedProspect.user.isRegistered, true);

    // Validate event details
    assert.equal(abandonedProspect.event.id, targetEvent.id);
    assert.equal(abandonedProspect.event.name, targetEvent.name);

    // Validate last action
    assert.equal(abandonedProspect.lastAction, 'checkout_abandoned');
    assert.ok(abandonedProspect.lastActionTime);

    // Validate intent score
    assert.ok(abandonedProspect.intentScore >= 15 && abandonedProspect.intentScore <= 100);
    assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(abandonedProspect.intentLevel));

    // Validate likely reason & recommendation
    assert.ok(abandonedProspect.likelyReason);
    assert.ok(abandonedProspect.reasonDetail);
    assert.ok(abandonedProspect.recommendedAction);

    // Validate funnel indicators
    assert.equal(abandonedProspect.hasViewed, true);
    assert.equal(abandonedProspect.hasSelectedSeat, true);
    assert.equal(abandonedProspect.hasStartedCheckout, true);
    assert.equal(abandonedProspect.hasAbandonedCheckout, true);
  });

  // 6. Test Filtering by Reason and Score
  await t.test('6. Filter abandoned prospects by reason and minScore', async () => {
    // Filter with minScore=50
    const filterRes = await fetch(`${BASE_URL}/analytics/abandoned?eventId=${targetEvent.id}&minScore=50`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const filterJson = await filterRes.json();
    assert.equal(filterRes.status, 200);
    assert.equal(filterJson.success, true);
    for (const item of filterJson.data.abandonedUsers) {
      assert.ok(item.intentScore >= 50, `Score ${item.intentScore} should be >= 50`);
    }

    // Filter with non-existent reason should return 0 or empty for that reason
    const emptyReasonRes = await fetch(`${BASE_URL}/analytics/abandoned?eventId=${targetEvent.id}&reason=NON_EXISTENT_REASON`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const emptyJson = await emptyReasonRes.json();
    assert.equal(emptyReasonRes.status, 200);
    assert.equal(emptyJson.data.abandonedUsers.length, 0);
  });

  // 7. Dispatch targeted recovery reminder
  await t.test('7. Send recovery reminder to specific abandoned customer', async () => {
    const reminderRes = await fetch(`${BASE_URL}/analytics/abandoned/send-reminder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        targetUserId: customerUser.id,
        eventId: targetEvent.id,
        discountCode: 'RECOVER10',
        customMessage: `Dear ${customerUser.name}, your seats for ${targetEvent.name} are waiting! Complete your order now with 10% off using code RECOVER10.`,
      }),
    });
    const reminderJson = await reminderRes.json();

    assert.equal(reminderRes.status, 200);
    assert.equal(reminderJson.success, true);
    assert.ok(reminderJson.notification.id);

    // Verify in-app notification delivered to customer
    const notifRes = await fetch(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const notifJson = await notifRes.json();
    assert.equal(notifRes.status, 200);
    const recoveryNotif = notifJson.data.notifications.find(
      (n) => n.id === reminderJson.notification.id
    );
    assert.ok(recoveryNotif, 'Dispatched notification should be received in customer notification inbox');
    assert.ok(recoveryNotif.message.includes('RECOVER10'));
  });

  // 8. Batch Dispatch Recovery Reminders
  await t.test('8. Batch dispatch recovery reminders for all eligible abandoned prospects', async () => {
    const batchRes = await fetch(`${BASE_URL}/analytics/abandoned/batch-reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        eventId: targetEvent.id,
        discountCode: 'BATCH15',
      }),
    });
    const batchJson = await batchRes.json();

    assert.equal(batchRes.status, 200);
    assert.equal(batchJson.success, true);
    assert.ok(batchJson.dispatchedCount >= 1, 'Should dispatch at least 1 reminder');
    assert.ok(batchJson.totalEligible >= 1, 'Should count total eligible prospects');
  });
});
