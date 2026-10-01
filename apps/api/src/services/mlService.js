import dotenv from 'dotenv';
dotenv.config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

/**
 * 1. AI Anti-Scalping & Bot Detection Evaluator (Module 15: POST /fraud/score)
 */
export const checkFraudRisk = async (telemetry = {}) => {
  const {
    checkoutDurationSeconds = 25.0,
    clicksPerMinute = 30.0,
    rapidSeatAttempts = 1,
    timeOnSeatmapSeconds = 18.0,
    deviceSwitches = 0,
    ticketsRequested = 1,
    accountAgeDays,
    totalAmount,
    failedPayments,
    ipCityMismatch,
    resaleAttempts,
  } = telemetry;

  const payload = {
    checkout_duration_seconds: Number(checkoutDurationSeconds),
    clicks_per_minute: Number(clicksPerMinute),
    rapid_seat_attempts: Number(rapidSeatAttempts),
    time_on_seatmap_seconds: Number(timeOnSeatmapSeconds),
    device_switches: Number(deviceSwitches),
    tickets_requested: Number(ticketsRequested),
    purchase_speed_seconds: Number(checkoutDurationSeconds),
    ticket_count: Number(ticketsRequested),
    ...(accountAgeDays !== undefined && { account_age_days: Number(accountAgeDays) }),
    ...(totalAmount !== undefined && { total_amount: Number(totalAmount) }),
    ...(failedPayments !== undefined && { failed_payments: Number(failedPayments) }),
    ...(ipCityMismatch !== undefined && { ip_city_mismatch: Number(ipCityMismatch) }),
    ...(resaleAttempts !== undefined && { resale_attempts: Number(resaleAttempts) }),
  };

  try {
    // Try primary Module 15 endpoint: POST /fraud/score
    let res = await fetch(`${ML_SERVICE_URL}/fraud/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok && res.status === 404) {
      // Fallback alias
      res = await fetch(`${ML_SERVICE_URL}/predict/fraud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (res.ok) {
      return await res.json();
    }
    throw new Error(`ML service returned status ${res.status}`);
  } catch (error) {
    console.warn(`[ML Service] Warning: Python ML service unreachable at ${ML_SERVICE_URL}. Using defensive heuristic fallback.`);

    const isBotSpeed = Number(checkoutDurationSeconds) < 2.5;
    const isHighClick = Number(clicksPerMinute) > 150;
    const isSniping = Number(rapidSeatAttempts) >= 6;

    let score = 10.0;
    const anomalies = [];
    if (isBotSpeed) {
      score += 55.0;
      anomalies.push(`Sub-second checkout speed (${checkoutDurationSeconds}s)`);
    }
    if (isHighClick) {
      score += 25.0;
      anomalies.push(`Inhuman click rate (${clicksPerMinute} cpm)`);
    }
    if (isSniping) {
      score += 20.0;
      anomalies.push(`Rapid seat lock sniping (${rapidSeatAttempts} attempts)`);
    }

    const isBot = score >= 65.0;
    return {
      fraud_score: Math.min(score, 100.0),
      classification: score >= 75.0 ? 'HIGH_RISK_BOT' : score >= 45.0 ? 'SUSPICIOUS' : 'NORMAL',
      is_bot: isBot,
      risk_level: score >= 75.0 ? 'CRITICAL_BOT' : score >= 45.0 ? 'SUSPICIOUS' : 'LOW',
      action_recommended: score >= 75.0 ? 'BLOCK_TRANSACTION' : score >= 45.0 ? 'REQUIRE_CAPTCHA' : 'ALLOW',
      anomaly_factors: anomalies,
      confidence: 0.85,
      fallback: true,
    };
  }
};

/**
 * 2. Pre-Launch AI Demand Forecasting (Module 15: POST /forecast/demand)
 */
// The demand and intent models were trained on the original six categories; newer ones use the closest
const ML_EVENT_TYPE = {
  HOCKEY_MATCH: 'FOOTBALL_MATCH',
  QAWWALI: 'MUSIC_CONCERT',
  THEATRE: 'MUSIC_CONCERT',
  CONFERENCE: 'MUSIC_CONCERT',
  GENERAL_ADMISSION: 'MUSIC_FESTIVAL',
};
const mlEventType = (type) => ML_EVENT_TYPE[type] || type;

export const forecastEventDemand = async (eventParams = {}) => {
  const {
    eventType = 'CRICKET_MATCH',
    city = 'Lahore',
    marketingTier = 'MEDIUM',
    venueCapacity = 25000,
    avgTicketPrice = 2500.0,
    ticketPrices,
    isWeekend = 1,
    dayOfWeek,
    publishHour = 18,
    popularityScore,
    marketingScore,
  } = eventParams;

  const payload = {
    event_type: mlEventType(eventType),
    city,
    marketing_tier: marketingTier,
    venue_capacity: Number(venueCapacity),
    avg_ticket_price: Number(avgTicketPrice),
    ticket_prices: Number(ticketPrices || avgTicketPrice),
    is_weekend: Number(isWeekend),
    ...(dayOfWeek && { day_of_week: dayOfWeek }),
    ...(publishHour !== undefined && { publish_hour: Number(publishHour) }),
    ...(popularityScore !== undefined && { popularity_score: Number(popularityScore) }),
    ...(marketingScore !== undefined && { marketing_score: Number(marketingScore) }),
  };

  try {
    // Try primary Module 15 endpoint: POST /forecast/demand
    let res = await fetch(`${ML_SERVICE_URL}/forecast/demand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(`${ML_SERVICE_URL}/predict/demand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (res.ok) {
      return await res.json();
    }
    throw new Error(`ML service returned status ${res.status}`);
  } catch (error) {
    console.warn(`[ML Service] Warning: Python ML service unreachable for demand forecast. Using baseline ratio.`);
    const projectedSales = Math.floor(venueCapacity * 0.78);
    return {
      projected_48h_sales: projectedSales,
      projected_revenue_pkr: projectedSales * avgTicketPrice,
      sellout_probability: 0.78,
      demand_tier: 'HIGH',
      demand_level: 'HIGH',
      pricing_recommendation: `Estimated 78% uptake in ${city}. Optimize tier distribution for peak revenue.`,
      fallback: true,
    };
  }
};

/**
 * 3. Purchase Intent & Abandoned Cart Scoring (Module 15: POST /intent/predict)
 */
export const scorePurchaseIntent = async (sessionParams = {}) => {
  const {
    sessionDurationSeconds = 180.0,
    eventViewsCount = 3,
    eventViews,
    seatMapInteracted = 1,
    seatSelection,
    checkoutStarted = 1,
    checkoutAbandoned = 0,
    ticketPrice = 3000.0,
    city = 'Lahore',
    eventType = 'CRICKET_MATCH',
    previousPurchases = 1,
  } = sessionParams;

  const payload = {
    session_duration_seconds: Number(sessionDurationSeconds),
    event_views_count: Number(eventViewsCount),
    event_views: Number(eventViews || eventViewsCount),
    seat_map_interacted: Number(seatMapInteracted),
    seat_selection: Number(seatSelection || seatMapInteracted),
    checkout_started: Number(checkoutStarted),
    checkout_abandoned: Number(checkoutAbandoned),
    ticket_price: Number(ticketPrice),
    city,
    event_type: mlEventType(eventType),
    previous_purchases: Number(previousPurchases),
  };

  try {
    // Try primary Module 15 endpoint: POST /intent/predict
    let res = await fetch(`${ML_SERVICE_URL}/intent/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(`${ML_SERVICE_URL}/predict/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (res.ok) {
      return await res.json();
    }
    throw new Error(`ML service returned status ${res.status}`);
  } catch (error) {
    return {
      purchase_intent_score: checkoutStarted ? 85.0 : 45.0,
      intent_score: checkoutStarted ? 85.0 : 45.0,
      intent_level: checkoutStarted ? 'HIGH_INTENT' : 'MODERATE',
      suggested_action: checkoutStarted ? 'DISPATCH_SMS_REMINDER' : 'MONITOR_SESSION',
      fallback: true,
    };
  }
};

/**
 * 4. Trigger Model Retraining (Module 15: POST /train/:modelType)
 * modelType can be 'intent', 'fraud', or 'demand'
 */
export const triggerModelTraining = async (modelType = 'fraud') => {
  const validTypes = ['intent', 'fraud', 'demand'];
  if (!validTypes.includes(modelType.toLowerCase())) {
    throw new Error(`Invalid model type '${modelType}'. Must be one of: ${validTypes.join(', ')}`);
  }

  const res = await fetch(`${ML_SERVICE_URL}/train/${modelType.toLowerCase()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (res.ok) {
    return await res.json();
  }
  const errData = await res.json().catch(() => ({}));
  throw new Error(errData.detail || `ML training failed with HTTP ${res.status}`);
};

export default {
  checkFraudRisk,
  forecastEventDemand,
  scorePurchaseIntent,
  triggerModelTraining,
};
