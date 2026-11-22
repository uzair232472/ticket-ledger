/**
 * Checkout scalper-bot SECURITY RULES (Step 6). Fixed thresholds, no model.
 *
 * This is the same rule the ML service's legacy POST /fraud/score applies (apps/ml-service/main.py,
 * execute_fraud_score), now evaluated inside the API so a checkout never waits on, or depends on, the ML
 * service. Before Step 6 the checkout called the ML service and, when it was unreachable, fell back to a
 * DIFFERENT, looser copy (speed < 2.5 s, >= 6 seat attempts): the same bot could be blocked with the service up
 * and let through with it down. Now both cases use these thresholds; test_ml_step6_unit.mjs checks parity with
 * the Python rule on a grid of inputs.
 *
 *   +55  checkout faster than 3.0 s
 *   +25  more than 150 clicks per minute
 *   +20  5 or more rapid seat-lock attempts
 *   base 10, capped at 99.  >= 75 CRITICAL_BOT (checkout blocked), >= 45 SUSPICIOUS, else LOW.
 *
 * Device switches are reported as a signal but do not change the score (as in the Python rule).
 */
export const RULES_NOTICE = 'Rule-based estimate (no trained model).';

const num = (v, fallback) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));
// Python formats with f"{x:.2f}" / f"{x:.1f}" / str(int)
const fmt = (v, digits) => v.toFixed(digits);
const intText = (v) => String(v);

export function evaluateCheckoutBotRules(telemetry = {}) {
  const speed = num(telemetry.checkoutDurationSeconds, 25.0);
  const clicks = num(telemetry.clicksPerMinute, 30.0) || 30.0; // Python: `or 30.0` (0 counts as missing)
  const rapidSeats = num(telemetry.rapidSeatAttempts, 1) || 1; // Python: `or 1`
  const devices = num(telemetry.deviceSwitches, 0);

  const anomalies = [];
  if (speed < 3.0) anomalies.push(`Sub-second / inhuman checkout speed (${fmt(speed, 2)}s)`);
  if (clicks > 150) anomalies.push(`Superhuman click frequency (${fmt(clicks, 1)} clicks/min)`);
  if (rapidSeats >= 5) anomalies.push(`Rapid seat sniping pattern (${intText(rapidSeats)} lock attempts)`);
  if (devices >= 2) anomalies.push(`Suspicious client fingerprint hopping (${intText(devices)} switches)`);

  let base = 10.0;
  if (speed < 3.0) base += 55.0;
  if (clicks > 150) base += 25.0;
  if (rapidSeats >= 5) base += 20.0;
  const fraudScore = Math.min(99.0, base);

  let classification = 'NORMAL';
  let riskLevel = 'LOW';
  let action = 'ALLOW';
  let isBot = false;
  if (fraudScore >= 75.0) {
    classification = 'HIGH_RISK_BOT'; riskLevel = 'CRITICAL_BOT'; action = 'BLOCK_TRANSACTION'; isBot = true;
  } else if (fraudScore >= 45.0) {
    classification = 'SUSPICIOUS'; riskLevel = 'SUSPICIOUS'; action = 'REQUIRE_CAPTCHA_OR_REVIEW';
  }

  return {
    fraud_score: fraudScore,
    classification,
    is_bot: isBot,
    risk_level: riskLevel,
    action_recommended: action,
    anomaly_factors: anomalies,
    confidence: Math.round((fraudScore / 100) * 10000) / 10000,
    prediction_source: 'rules',
    validated: false,
    notice: RULES_NOTICE,
  };
}
