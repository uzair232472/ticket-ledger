import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';
const ML_URL = 'http://localhost:8000';

test('MODULE 12 - AI Anti-Scalping, Bot Detection & Behavioral Analytics Tests', async (t) => {
  let adminToken = null;
  let customerToken = null;
  let customerUser = null;
  let activeEvent = null;
  let availableSeat = null;

  // 1. Authenticate Super Admin
  await t.test('1. Authenticate Super Admin', async () => {
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
    assert.equal(data.data.user.role, 'SUPER_ADMIN');
    adminToken = data.data.token;
  });

  // 2. Authenticate Customer
  await t.test('2. Authenticate Customer', async () => {
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
    customerToken = data.data.token;
    customerUser = data.data.user;
  });

  // 3. Verify Python FastAPI ML Service Health & Models Loaded
  await t.test('3. Verify Python FastAPI ML Service Health & 3 Loaded Models', async () => {
    const res = await fetch(`${ML_URL}/health`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'healthy');
    assert.equal(data.models_loaded.fraud_model, true);
    assert.equal(data.models_loaded.demand_model, true);
    assert.equal(data.models_loaded.intent_model, true);
  });

  // 4. Test Normal Human Telemetry Check (Low Risk, Allowed)
  await t.test('4. Evaluate Normal Human Session: Low fraud score (< 20) and Allowed', async () => {
    const res = await fetch(`${BASE_URL}/ml/fraud-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        checkoutDurationSeconds: 38.5,
        clicksPerMinute: 24.0,
        rapidSeatAttempts: 1,
        timeOnSeatmapSeconds: 25.0,
        deviceSwitches: 0,
        ticketsRequested: 2,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.is_bot, false);
    assert.equal(data.data.risk_level, 'LOW');
    assert.ok(data.data.fraud_score < 40);
  });

  // 5. Test Scalper Bot Telemetry Check (Sub-second speed, 300+ clicks/min -> CRITICAL_BOT)
  await t.test('5. Evaluate Automated Scalper Bot: High fraud score (> 80), CRITICAL_BOT flagged', async () => {
    const res = await fetch(`${BASE_URL}/ml/fraud-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        checkoutDurationSeconds: 0.65,
        clicksPerMinute: 340.0,
        rapidSeatAttempts: 14,
        timeOnSeatmapSeconds: 0.4,
        deviceSwitches: 3,
        ticketsRequested: 8,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.is_bot, true);
    assert.equal(data.data.risk_level, 'CRITICAL_BOT');
    assert.equal(data.data.action_recommended, 'BLOCK_TRANSACTION');
    assert.ok(data.data.anomaly_factors.length >= 3);
  });

  // 6. Test Pre-Launch AI Demand Forecast
  await t.test('6. Pre-Launch AI Demand Forecast predicts sales & sellout ratio', async () => {
    const res = await fetch(`${BASE_URL}/ml/demand-forecast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        eventType: 'CRICKET_MATCH',
        city: 'Lahore',
        marketingTier: 'HIGH',
        venueCapacity: 27000,
        avgTicketPrice: 3500,
        isWeekend: 1,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.projected_48h_sales > 15000);
    assert.ok(data.data.sellout_probability > 0.70);
    assert.equal(data.data.demand_tier, 'VERY_HIGH');
    assert.ok(data.data.pricing_recommendation);
  });

  // 7. Test Purchase Intent & Cart Abandonment Scoring
  await t.test('7. Purchase Intent Engine scores engaged attendee session', async () => {
    const res = await fetch(`${BASE_URL}/ml/intent-score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionDurationSeconds: 240,
        eventViewsCount: 4,
        seatMapInteracted: 1,
        checkoutStarted: 1,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.intent_score > 60);
    assert.equal(data.data.intent_level, 'HIGH_INTENT');
  });

  // 8. Automated Bot Checkout Blocking: Bot transaction is blocked at checkout
  await t.test('8. Automated AI Bot Defense blocks sub-second checkout attempt with 403', async () => {
    // 1. Find an event and lock a seat
    const eventsRes = await fetch(`${BASE_URL}/events`);
    const eventsData = await eventsRes.json();
    activeEvent = eventsData.data.events[0];

    const seatsRes = await fetch(`${BASE_URL}/seats/event/${activeEvent.id}`);
    const seatsData = await seatsRes.json();
    availableSeat = seatsData.data.seats.find((s) => s.status === 'AVAILABLE');

    // Lock seat
    await fetch(`${BASE_URL}/seats/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ seatId: availableSeat.id }),
    });

    // Attempt checkout with bot speed
    const botCheckoutRes = await fetch(`${BASE_URL}/bookings/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        eventId: activeEvent.id,
        seatIds: [availableSeat.id],
        paymentMethod: 'MOCK',
        telemetry: {
          checkoutDurationSeconds: 0.42, // SUPERHUMAN BOT SPEED!
          clicksPerMinute: 380,
          rapidSeatAttempts: 15,
          timeOnSeatmapSeconds: 0.3,
          deviceSwitches: 3,
        },
      }),
    });
    const botData = await botCheckoutRes.json();

    assert.equal(botCheckoutRes.status, 403);
    assert.equal(botData.blockedByAI, true);
    assert.equal(botData.data.riskLevel, 'CRITICAL_BOT');
    assert.match(botData.message, /Anti-Scalping Security Alert/i);
  });

  // 9. Super Admin Fraud & Bot Watchlist Feed
  await t.test('9. Super Admin retrieves real-time Fraud & Bot Watchlist', async () => {
    const res = await fetch(`${BASE_URL}/ml/fraud-watchlist`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.watchlist.length >= 1);
    assert.ok(data.data.stats.criticalBots >= 1);

    const flaggedBot = data.data.watchlist.find((w) => w.riskLevel === 'CRITICAL_BOT');
    assert.ok(flaggedBot, 'A critical bot session must be present on the watchlist');
    assert.ok(flaggedBot.anomalyFactors.length >= 1);
  });

  // 10. Super Admin 1-Click Action to Freeze Fraudulent User Account
  await t.test('10. Super Admin freezes fraudulent account with 1-click and then unfreezes', async () => {
    // Freeze
    const freezeRes = await fetch(`${BASE_URL}/ml/freeze-user/${customerUser.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reason: 'Repeated high-frequency scalper bot attempts' }),
    });
    const freezeData = await freezeRes.json();
    assert.equal(freezeRes.status, 200);
    assert.equal(freezeData.data.user.status, 'FROZEN');

    // Confirm frozen account cannot make authenticated calls
    const blockedRes = await fetch(`${BASE_URL}/tickets/wallet`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.equal(blockedRes.status, 403);

    // Unfreeze
    const unfreezeRes = await fetch(`${BASE_URL}/ml/unfreeze-user/${customerUser.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const unfreezeData = await unfreezeRes.json();
    assert.equal(unfreezeRes.status, 200);
    assert.equal(unfreezeData.data.user.status, 'ACTIVE');
  });
});
