/**
 * Step 6 switches for the AI display layer. Read from the environment on every call (no runtime admin switch).
 *
 *   ML_INSIGHTS_ENABLED    the read-only insight and monitor endpoints (default: on in development, OFF in production)
 *   ML_INSIGHTS_ORGANIZER  organizers also see the experimental (shadow) aggregates (default OFF everywhere)
 *   ML_REC_DISPLAY         the customer-facing recommendation rows (default OFF everywhere)
 *
 * None of these changes a decision: rules decide checkout, payments, refunds, tickets, gates, pricing and accounts
 * whatever the values. ML_SHADOW_ENABLED / ML_SNAPSHOTS_ENABLED (services/ml/shadow.js) control the logging.
 */
const bool = (v, fallback) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export function mlFlags(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    insights: bool(env.ML_INSIGHTS_ENABLED, !production),
    organizerInsights: bool(env.ML_INSIGHTS_ORGANIZER, false),
    recommendations: bool(env.ML_REC_DISPLAY, false),
    shadow: env.ML_SHADOW_ENABLED !== 'false',
    snapshots: env.ML_SNAPSHOTS_ENABLED !== 'false',
  };
}

/** The part safe to send to any browser: booleans only. */
export const publicMlFlags = (env = process.env) => {
  const f = mlFlags(env);
  return { insights: f.insights, organizerInsights: f.insights && f.organizerInsights, recommendations: f.recommendations };
};
