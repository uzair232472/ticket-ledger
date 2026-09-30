import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';
const ML_URL = 'http://localhost:8000';

test('MODULE 15 - FastAPI ML Service & Node.js Score Persistence Tests', async (t) => {
  let adminToken = null;
  let customerToken = null;
  let savedFraudPredictionId = null;
  let savedIntentPredictionId = null;
  let savedDemandPredictionId = null;

  // 1. Authenticate Roles
  await t.test('1. Authenticate Customer and Super Admin', async () => {
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
  });

  // 2. Direct FastAPI ML Service Endpoint Validation
  await t.test('2. FastAPI ML Service - Direct Endpoints Health Check', async () => {
    const res = await fetch(`${ML_URL}/health`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'healthy');
    assert.equal(data.models_loaded.fraud_model, true);
    assert.equal(data.models_loaded.demand_model, true);
    assert.equal(data.models_loaded.intent_model, true);
  });

  await t.test('3. FastAPI ML Service - Direct POST /intent/predict returns real score', async () => {
    const res = await fetch(`${ML_URL}/intent/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_views: 6,
        seat_selection: 2,
        checkout_started: 1,
        checkout_abandoned: 0,
        ticket_price: 3500.0,
        city: 'Lahore',
        event_type: 'CRICKET_MATCH',
        previous_purchases: 2,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(typeof data.purchase_intent_score === 'number');
    assert.ok(data.purchase_intent_score >= 0 && data.purchase_intent_score <= 100);
    assert.equal(data.intent_level, 'HIGH_INTENT');
    assert.ok(data.suggested_action);
  });

  await t.test('4. FastAPI ML Service - Direct POST /fraud/score returns real score', async () => {
    const res = await fetch(`${ML_URL}/fraud/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_age_days: 0.3,
        ticket_count: 8,
        total_amount: 28000.0,
        failed_payments: 2,
        device_change_count: 3,
        ip_city_mismatch: 1,
        purchase_speed_seconds: 0.65,
        resale_attempts: 0,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(typeof data.fraud_score === 'number');
    assert.ok(data.fraud_score > 75.0);
    assert.equal(data.classification, 'HIGH_RISK_BOT');
    assert.equal(data.is_bot, true);
    assert.equal(data.risk_level, 'CRITICAL_BOT');
    assert.equal(data.action_recommended, 'BLOCK_TRANSACTION');
    assert.ok(data.anomaly_factors.length >= 1);
  });

  await t.test('5. FastAPI ML Service - Direct POST /forecast/demand returns real forecast', async () => {
    const res = await fetch(`${ML_URL}/forecast/demand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'CRICKET_MATCH',
        city: 'Lahore',
        venue_capacity: 27000,
        ticket_prices: 3500.0,
        day_of_week: 'Saturday',
        publish_hour: 18,
        popularity_score: 92.0,
        marketing_score: 90.0,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.projected_48h_sales > 15000);
    assert.ok(data.projected_revenue_pkr > 50000000);
    assert.ok(data.sellout_probability > 0.70);
    assert.equal(data.demand_tier, 'VERY_HIGH');
    assert.ok(data.pricing_recommendation);
  });

  await t.test('6. FastAPI ML Service - Direct POST /train/fraud hot-retrains model', async () => {
    const res = await fetch(`${ML_URL}/train/fraud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.model_name, 'fraud_detection');
    assert.ok(data.duration_seconds > 0);
    assert.ok(data.metrics.test_accuracy >= 0.95);
  });

  // 3. Node.js Express Backend Integration & Score Persistence in Database
  await t.test('7. Node.js Express calls FastAPI /fraud/score and saves score to DB', async () => {
    const res = await fetch(`${BASE_URL}/ml/fraud/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        checkoutDurationSeconds: 42.0,
        clicksPerMinute: 22.0,
        rapidSeatAttempts: 1,
        ticketsRequested: 2,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.fraud_score < 40.0);
    assert.equal(data.data.is_bot, false);
    assert.ok(data.data.saved_prediction_id, 'Must return saved_prediction_id');
    savedFraudPredictionId = data.data.saved_prediction_id;
  });

  await t.test('8. Node.js Express calls FastAPI /intent/predict and saves score to DB', async () => {
    const res = await fetch(`${BASE_URL}/ml/intent/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        eventViewsCount: 5,
        seatMapInteracted: 1,
        checkoutStarted: 1,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.purchase_intent_score > 50.0);
    assert.equal(data.data.intent_level, 'HIGH_INTENT');
    assert.ok(data.data.saved_prediction_id, 'Must return saved_prediction_id');
    savedIntentPredictionId = data.data.saved_prediction_id;
  });

  await t.test('9. Node.js Express calls FastAPI /forecast/demand and saves score to DB', async () => {
    const res = await fetch(`${BASE_URL}/ml/forecast/demand`, {
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
    assert.ok(data.data.saved_prediction_id, 'Must return saved_prediction_id');
    savedDemandPredictionId = data.data.saved_prediction_id;
  });

  await t.test('10. Super Admin triggers model retraining via Node.js Express', async () => {
    const res = await fetch(`${BASE_URL}/ml/train/fraud`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.model_name, 'fraud_detection');
    assert.ok(data.data.duration_seconds > 0);
  });

  await t.test('11. Query Persisted ML Predictions from DB via Express GET /api/ml/predictions', async () => {
    const res = await fetch(`${BASE_URL}/ml/predictions?limit=10`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.predictions.length >= 3);

    const foundFraud = data.data.predictions.find((p) => p.id === savedFraudPredictionId);
    const foundIntent = data.data.predictions.find((p) => p.id === savedIntentPredictionId);
    const foundDemand = data.data.predictions.find((p) => p.id === savedDemandPredictionId);

    assert.ok(foundFraud, 'Persisted fraud score must exist in DB');
    assert.ok(foundIntent, 'Persisted intent score must exist in DB');
    assert.ok(foundDemand, 'Persisted demand forecast must exist in DB');

    assert.equal(foundFraud.action, 'AI_BOT_EVALUATION');
    assert.equal(foundIntent.action, 'AI_INTENT_EVALUATION');
    assert.equal(foundDemand.action, 'AI_DEMAND_FORECAST');
  });
});
