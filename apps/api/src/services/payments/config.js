/**
 * Payment configuration and policy: one place that decides which payment methods may take money.
 * Never returns or logs a secret value.
 *
 *   STRIPE     the current provider. Available only with a real-looking key whose mode matches STRIPE_MODE.
 *              Missing or placeholder credentials mean "card payments unavailable", never a simulated success.
 *   MOCK       development test checkout (no money). Refused in production, in live mode, or when
 *              PAYMENT_TEST_CHECKOUT=off. Never payment evidence.
 *   JAZZCASH, EASYPAISA   future integrations: always unavailable until a real, server-verified integration
 *              exists (see providers/unavailableProvider.js for how to add one).
 */

export const METHODS = ['STRIPE', 'JAZZCASH', 'EASYPAISA', 'MOCK'];
const PLACEHOLDER = /mock|placeholder|dummy|example|your|change|xxx|replace/i;

/** What kind of Stripe secret key this is: live | test | placeholder | unknown | none. */
export function stripeKeyKind(key) {
  if (!key) return 'none';
  const m = /^(sk|rk)_(live|test)_([A-Za-z0-9]+)$/.exec(key);
  if (!m) return PLACEHOLDER.test(key) ? 'placeholder' : 'unknown';
  if (PLACEHOLDER.test(m[3]) || m[3].length < 20) return 'placeholder';
  return m[2];
}

/** Stripe mode and configuration problems, without revealing any secret. */
export function stripeConfig(env = process.env) {
  const key = env.STRIPE_SECRET_KEY || '';
  const kind = stripeKeyKind(key);
  // Mode from the key prefix (also for placeholders), to catch a live/test mix-up whatever the key's quality
  const keyMode = /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : key ? 'unknown' : 'none';
  const mode = env.STRIPE_MODE === 'live' ? 'live' : 'test';
  const problems = [];
  if (env.STRIPE_MODE && !['test', 'live'].includes(env.STRIPE_MODE)) problems.push('STRIPE_MODE must be test or live');
  if (keyMode !== 'none' && keyMode !== 'unknown' && keyMode !== mode) problems.push(`STRIPE_MODE is ${mode} but the secret key is a ${keyMode} key`);
  if (!env.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET is not set (webhooks are refused)');
  else if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET)) problems.push('STRIPE_WEBHOOK_SECRET does not look like a webhook signing secret');
  // Usable = the server can really ask Stripe: a real-looking key of the configured mode
  const usable = (kind === 'live' || kind === 'test') && kind === mode && !problems.some((p) => p.startsWith('STRIPE_MODE'));
  return { mode, keyMode, keyKind: kind, usable, webhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET), problems };
}

/** Development test checkout (MOCK): never in production or live mode. */
export function testCheckoutAllowed(env = process.env) {
  return env.NODE_ENV !== 'production' && env.STRIPE_MODE !== 'live' && env.PAYMENT_TEST_CHECKOUT !== 'off';
}

/** Whether real payments are required (no test or simulated path may complete a purchase). */
export const realPaymentsRequired = (env = process.env) => !testCheckoutAllowed(env);

const NOT_INTEGRATED = 'Not available yet: this payment method has not been integrated.';

/** { method: { available, reason } } for every method, for the checkout pages and the server's own checks. */
export function methodAvailability(env = process.env) {
  const s = stripeConfig(env);
  const test = testCheckoutAllowed(env);
  return {
    STRIPE: s.usable ? { available: true, mode: s.mode } : { available: false, reason: 'Card payments are not available right now.' },
    JAZZCASH: { available: false, reason: NOT_INTEGRATED },
    EASYPAISA: { available: false, reason: NOT_INTEGRATED },
    MOCK: test ? { available: true, test: true } : { available: false, reason: 'Test payments are disabled.' },
  };
}

/**
 * Startup check (server.js). Fatal problems stop the server: a live/test mix-up, or live mode without
 * everything live mode needs. A missing or placeholder key is not fatal: card payments are then unavailable.
 */
export function paymentStartupProblems(env = process.env) {
  const s = stripeConfig(env);
  const fatal = s.problems.filter((p) => p.startsWith('STRIPE_MODE'));
  if (s.mode === 'live') {
    if (env.NODE_ENV !== 'production') fatal.push('STRIPE_MODE=live requires NODE_ENV=production.');
    if (s.keyKind !== 'live') fatal.push('STRIPE_MODE=live requires a real live secret key (sk_live_ or rk_live_).');
    if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || '')) fatal.push('STRIPE_MODE=live requires STRIPE_WEBHOOK_SECRET (whsec_...).');
    if (!/^pk_live_/.test(env.STRIPE_PUBLISHABLE_KEY || '')) fatal.push('STRIPE_MODE=live requires a live publishable key (pk_live_...).');
  }
  const warnings = [];
  if (!s.usable) warnings.push(`Card payments are unavailable (Stripe key: ${s.keyKind}).`);
  if (!testCheckoutAllowed(env)) warnings.push('Test checkout is disabled.');
  return { fatal, warnings };
}

export class PaymentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
