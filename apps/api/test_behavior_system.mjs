import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 13 - Behavior Tracking & User Behavioral Profile Tests', async (t) => {
  let customerToken = null;
  let customerUser = null;
  let adminToken = null;
  const guestSessionId = `test_guest_session_${Date.now()}`;

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

  // 2. Authenticate Super Admin
  await t.test('2. Authenticate Super Admin', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@ticketledger.pk',
        password: 'Password@123',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.token);
    adminToken = data.data.token;
  });

  // 3. Track Guest Events (Unauthenticated visitor before login)
  await t.test('3. Track unauthenticated guest events (event_view, category_view, seat_selected)', async () => {
    // 3a. Guest category view
    const catRes = await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': guestSessionId,
      },
      body: JSON.stringify({
        action: 'category_view',
        metadata: { category: 'CRICKET_MATCH', city: 'Lahore' },
      }),
    });
    const catData = await catRes.json();
    assert.equal(catRes.status, 200);
    assert.equal(catData.success, true);
    assert.equal(catData.data.userId, null);
    assert.equal(catData.data.sessionId, guestSessionId);

    // 3b. Guest event view
    const evRes = await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': guestSessionId,
      },
      body: JSON.stringify({
        action: 'event_view',
        metadata: { eventName: 'PSL 2026 Final' },
      }),
    });
    const evData = await evRes.json();
    assert.equal(evRes.status, 200);
    assert.equal(evData.data.userId, null);

    // 3c. Guest seat selected
    const seatRes = await fetch(`${BASE_URL}/behavior/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': guestSessionId,
      },
      body: JSON.stringify({
        action: 'seat_selected',
        metadata: { section: 'VIP-A', row: 4, seatNumber: 12 },
      }),
    });
    const seatData = await seatRes.json();
    assert.equal(seatRes.status, 200);
    assert.equal(seatData.data.userId, null);
  });

  // 4. Guest Session Conversion & Attribution
  await t.test('4. Attach guest session behavior to authenticated customer after login', async () => {
    const res = await fetch(`${BASE_URL}/behavior/attach-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ sessionId: guestSessionId }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.count >= 3);
  });

  // 5. Track all remaining actions for the authenticated customer
  await t.test('5. Track full lifecycle of actions (seat_locked, checkout_started, abandoned, payment, ticket, resale, gate, wallet, login)', async () => {
    const actionsToTest = [
      { action: 'seat_locked', metadata: { price: 3500 } },
      { action: 'checkout_started', metadata: { totalAmount: 7000, seats: 2 } },
      { action: 'checkout_abandoned', metadata: { reason: 'timer_expired' } },
      { action: 'payment_completed', metadata: { gateway: 'JAZZCASH', amount: 7000 } },
      { action: 'payment_failed', metadata: { gateway: 'EASYPAISA', reason: 'insufficient_funds' } },
      { action: 'ticket_purchased', metadata: { ticketCount: 2 } },
      { action: 'ticket_transferred', metadata: { recipient: 'friend@ticketledger.pk' } },
      { action: 'resale_viewed', metadata: { city: 'Lahore' } },
      { action: 'resale_attempted', metadata: { resalePrice: 3800, ceiling: 3850 } },
      { action: 'gate_checked_in', metadata: { gate: 'Turnstile A-2' } },
      { action: 'wallet_connected', metadata: { walletAddress: '0x1234567890123456789012345678901234567890' } },
      { action: 'login', metadata: { method: 'PASSWORD' } },
    ];

    for (const item of actionsToTest) {
      const res = await fetch(`${BASE_URL}/behavior/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.data.action, item.action);
      assert.equal(data.data.userId, customerUser.id);
    }
  });

  // 6. User Behavioral Profile Generation & Timeline
  await t.test('6. Generate User Behavioral Profile with action counts, timeline, and ML scores', async () => {
    const res = await fetch(`${BASE_URL}/behavior/profile`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    const profile = data.data;
    assert.ok(profile.user);
    assert.equal(profile.user.id, customerUser.id);

    // Verify tracked action counters
    assert.ok(profile.stats.eventsViewed >= 1);
    assert.ok(profile.stats.categoriesViewed >= 1);
    assert.ok(profile.stats.seatsSelected >= 1);
    assert.ok(profile.stats.seatsLocked >= 1);
    assert.ok(profile.stats.checkoutsStarted >= 1);
    assert.ok(profile.stats.abandonedCheckouts >= 1);
    assert.ok(profile.stats.paymentsCompleted >= 1);
    assert.ok(profile.stats.paymentsFailed >= 1);
    assert.ok(profile.stats.ticketsPurchased >= 1);
    assert.ok(profile.stats.transfersSent >= 1);
    assert.ok(profile.stats.resalesViewed >= 1);
    assert.ok(profile.stats.resalesAttempted >= 1);
    assert.ok(profile.stats.gateCheckIns >= 1);
    assert.ok(profile.stats.walletConnected >= 1);
    assert.ok(profile.stats.logins >= 1);

    // Verify ML scores
    assert.ok(profile.scores.purchaseIntent);
    assert.equal(typeof profile.scores.purchaseIntent.score, 'number');
    assert.ok(profile.scores.purchaseIntent.score >= 0 && profile.scores.purchaseIntent.score <= 100);

    assert.ok(profile.scores.fraudRisk);
    assert.equal(typeof profile.scores.fraudRisk.score, 'number');
    assert.ok(profile.scores.fraudRisk.score >= 0 && profile.scores.fraudRisk.score <= 100);

    // Verify chronological action timeline
    assert.ok(Array.isArray(profile.timeline));
    assert.ok(profile.timeline.length >= 15);
    assert.ok(profile.timeline[0].action);
    assert.ok(profile.timeline[0].createdAt);
  });

  // 7. Super Admin User Inspection
  await t.test('7. Super Admin inspects customer behavioral profile by User ID', async () => {
    const res = await fetch(`${BASE_URL}/behavior/user/${customerUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.user.id, customerUser.id);
    assert.ok(data.data.timeline.length >= 15);
  });
});
