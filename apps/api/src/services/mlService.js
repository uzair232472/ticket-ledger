import dotenv from 'dotenv';
dotenv.config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

/**
 * 1. AI Anti-Scalping & Bot Detection Evaluator
 */
export const checkFraudRisk = async (telemetry = {}) => {
  const {
    checkoutDurationSeconds = 25.0,
    clicksPerMinute = 30.0,
    rapidSeatAttempts = 1,
    timeOnSeatmapSeconds = 18.0,
    deviceSwitches = 0,
    ticketsRequested = 1,
  } = telemetry;

  try {
    const res = await fetch(`${ML_SERVICE_URL}/predict/fraud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkout_duration_seconds: Number(checkoutDurationSeconds),
        clicks_per_minute: Number(clicksPerMinute),
        rapid_seat_attempts: Number(rapidSeatAttempts),
        time_on_seatmap_seconds: Number(timeOnSeatmapSeconds),
        device_switches: Number(deviceSwitches),
        tickets_requested: Number(ticketsRequested),
      }),
    });

    if (res.ok) {
      return await res.json();
    }
    throw new Error(`ML service returned status ${res.status}`);
  } catch (error) {
    console.warn(`[ML Service] Warning: Python ML service unreachable at ${ML_SERVICE_URL}. Using defensive heuristic fallback.`);
    
    // Defensive heuristic fallback
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
 * 2. Pre-Launch AI Demand Forecasting
 */
export const forecastEventDemand = async (eventParams = {}) => {
  const {
    eventType = 'CRICKET_MATCH',
    city = 'Lahore',
    marketingTier = 'MEDIUM',
    venueCapacity = 25000,
    avgTicketPrice = 2500.0,
    isWeekend = 1,
  } = eventParams;

  try {
    const res = await fetch(`${ML_SERVICE_URL}/predict/demand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventType,
        city,
        marketing_tier: marketingTier,
        venue_capacity: Number(venueCapacity),
        avg_ticket_price: Number(avgTicketPrice),
        is_weekend: Number(isWeekend),
      }),
    });

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
      pricing_recommendation: `Estimated 78% uptake in ${city}. Optimize tier distribution for peak revenue.`,
      fallback: true,
    };
  }
};

/**
 * 3. Purchase Intent & Abandoned Cart Scoring
 */
export const scorePurchaseIntent = async (sessionParams = {}) => {
  const {
    sessionDurationSeconds = 180.0,
    eventViewsCount = 3,
    seatMapInteracted = 1,
    checkoutStarted = 1,
  } = sessionParams;

  try {
    const res = await fetch(`${ML_SERVICE_URL}/predict/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_duration_seconds: Number(sessionDurationSeconds),
        event_views_count: Number(eventViewsCount),
        seat_map_interacted: Number(seatMapInteracted),
        checkout_started: Number(checkoutStarted),
      }),
    });

    if (res.ok) {
      return await res.json();
    }
    throw new Error(`ML service returned status ${res.status}`);
  } catch (error) {
    return {
      intent_score: checkoutStarted ? 85.0 : 45.0,
      intent_level: checkoutStarted ? 'HIGH_INTENT' : 'MODERATE',
      suggested_action: checkoutStarted ? 'DISPATCH_SMS_REMINDER' : 'MONITOR_SESSION',
      fallback: true,
    };
  }
};

export default {
  checkFraudRisk,
  forecastEventDemand,
  scorePurchaseIntent,
};
