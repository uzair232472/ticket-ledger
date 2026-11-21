/**
 * Stripe (the current payment provider). FAIL-CLOSED: a payment is successful only when the SERVER retrieved
 * the PaymentIntent from Stripe and every check passed. Missing or placeholder credentials, network errors,
 * timeouts, unexpected responses, any status other than "succeeded", another order's or another amount's
 * payment, a different currency and a live/test mode mismatch are all "not paid". Nothing the browser sends
 * (transaction ids, client secrets, "paid" flags) is trusted.
 */
import Stripe from 'stripe';
import { PaymentError, stripeConfig } from './config.js';

export const CURRENCY = 'pkr';
// Stripe amounts are in paisa, with Stripe's minimum charge
export const stripeAmount = (pkr) => Math.max(100, Math.round(Number(pkr) * 100));
const TIMEOUT_MS = Number(process.env.STRIPE_TIMEOUT_MS || 10_000);
const PI_ID = /^pi_[A-Za-z0-9]+$/;

let cached = { key: null, client: null };
let testClient = null;

/** The Stripe client for the configured key, or null when card payments are unavailable. */
function client(env = process.env) {
  if (testClient) return testClient;
  const cfg = stripeConfig(env);
  if (!cfg.usable) return null;
  if (cached.key !== env.STRIPE_SECRET_KEY) {
    cached = { key: env.STRIPE_SECRET_KEY, client: new Stripe(env.STRIPE_SECRET_KEY, { timeout: TIMEOUT_MS, maxNetworkRetries: 1 }) };
  }
  return cached.client;
}

/** Tests only: a fake Stripe client (no network). Refused outside a test run. */
export function setStripeClientForTesting(fake) {
  if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) throw new Error('setStripeClientForTesting is only for tests');
  testClient = fake;
}

const fail = (code, message, extra = {}) => ({ success: false, code, message, ...extra });
const UNAVAILABLE = 'Card payments are not available right now. You have not been charged.';

export const stripeProvider = {
  id: 'STRIPE',
  available: () => Boolean(client()),

  async initiate({ orderId, amount, paymentRef = null }) {
    const stripe = client();
    if (!stripe) throw new PaymentError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', UNAVAILABLE);
    const cfg = stripeConfig();
    const paisa = stripeAmount(amount);
    const params = (pi) => ({
      gateway: 'STRIPE', clientSecret: pi.client_secret, paymentIntentId: pi.id, paymentRef: pi.id,
      alreadyPaid: pi.status === 'succeeded', currency: 'PKR', amount: Number(amount), publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      ...(cfg.mode === 'test' ? { instructions: 'Stripe test mode: use test card 4242 4242 4242 4242, any future expiry and CVC.' } : {}),
    });
    try {
      // The order's existing PaymentIntent, while it can still be paid (or already was): one payment per order
      if (paymentRef && PI_ID.test(paymentRef)) {
        const existing = await stripe.paymentIntents.retrieve(paymentRef).catch(() => null);
        if (existing && existing.status !== 'canceled' && existing.amount === paisa && existing.metadata?.orderId === orderId) return params(existing);
      }
      const pi = await stripe.paymentIntents.create({
        amount: paisa,
        currency: CURRENCY,
        automatic_payment_methods: { enabled: true },
        // Only the order id: no customer e-mail or phone is sent to the provider
        metadata: { orderId },
        description: `TicketLedger order ${orderId}`,
      }, paymentRef ? undefined : { idempotencyKey: `ticketledger_order_${orderId}_${paisa}` });
      if (!pi?.id || !PI_ID.test(pi.id) || !pi.client_secret) throw new Error('unexpected response');
      return params(pi);
    } catch (e) {
      console.error('[STRIPE INITIATE ERROR]', e.message);
      throw new PaymentError(502, 'PAYMENT_PROVIDER_ERROR', 'The card processor could not start this payment. You have not been charged. Please try again.');
    }
  },

  /**
   * paymentDetails.paymentIntentId: the PaymentIntent to check (the caller passes the order's own stored one
   * when it has it). Returns { success: true, real: true, transactionId, livemode, ... } or a failure.
   */
  async verify({ paymentDetails, expectedAmount, orderId }) {
    const stripe = client();
    if (!stripe) return fail('PAYMENT_PROVIDER_UNAVAILABLE', UNAVAILABLE);
    const id = paymentDetails?.paymentIntentId;
    if (typeof id !== 'string' || !PI_ID.test(id)) return fail('PAYMENT_NOT_FOUND', 'No card payment was found for this order. Please complete the card payment.');
    if (expectedAmount == null || !orderId) return fail('PAYMENT_CHECK_INCOMPLETE', 'The payment could not be checked.');
    let intent;
    try {
      intent = await stripe.paymentIntents.retrieve(id);
    } catch (e) {
      console.error('[STRIPE RETRIEVE ERROR]', e.type || e.name, e.message);
      return fail('PAYMENT_PROVIDER_ERROR', 'We could not confirm your payment with the card processor. If you were charged, it will be confirmed or refunded automatically. Please try again in a moment.', { retryable: true });
    }
    if (!intent || intent.object !== 'payment_intent' || intent.id !== id) return fail('PAYMENT_INVALID_RESPONSE', 'The card processor gave an unexpected answer. Please try again.', { retryable: true });
    if (intent.status !== 'succeeded') {
      const processing = intent.status === 'processing' || intent.status === 'requires_capture';
      return fail(processing ? 'PAYMENT_PROCESSING' : 'PAYMENT_NOT_COMPLETED', `Stripe payment status is '${intent.status}'. Please complete checkout.`, { retryable: processing });
    }
    if (intent.metadata?.orderId !== orderId) return fail('PAYMENT_OTHER_ORDER', 'This payment belongs to a different booking.');
    const paisa = stripeAmount(expectedAmount);
    if (intent.amount !== paisa || (typeof intent.amount_received === 'number' && intent.amount_received !== paisa)) {
      return fail('PAYMENT_AMOUNT_MISMATCH', 'The amount paid does not match this booking.');
    }
    if (String(intent.currency || '').toLowerCase() !== CURRENCY) return fail('PAYMENT_CURRENCY_MISMATCH', 'The payment currency does not match this booking.');
    const live = stripeConfig().mode === 'live';
    if (Boolean(intent.livemode) !== live) return fail('PAYMENT_MODE_MISMATCH', 'This payment was made in the wrong Stripe mode.');
    return {
      success: true, real: true, gateway: 'STRIPE', transactionId: intent.id, fee: 0,
      paidAt: typeof intent.created === 'number' ? new Date(intent.created * 1000) : new Date(),
      // Provider's own statement: live or test mode (recorded as payment evidence; paymentEvidence.js)
      livemode: Boolean(intent.livemode),
      verifiedVia: 'stripe.paymentIntents.retrieve',
    };
  },

  async status({ paymentRef }) {
    const stripe = client();
    if (!stripe || !PI_ID.test(paymentRef || '')) return 'unknown';
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentRef);
      if (intent.status === 'succeeded') return 'succeeded';
      if (intent.status === 'processing' || intent.status === 'requires_capture') return 'processing';
      return 'open';
    } catch (err) {
      console.error('[STRIPE STATUS ERROR]', err.message);
      return 'unknown';
    }
  },

  /** A real PaymentIntent id means real money, whether or not Stripe is reachable right now. */
  isRealPayment: ({ paymentTxId }) => PI_ID.test(paymentTxId || ''),

  async refund({ paymentTxId, amount, reference }) {
    if (!PI_ID.test(paymentTxId || '')) {
      // Orders paid through the old simulated card fallback (made-up ch_ ids): no money ever moved
      return { success: true, providerRef: `none_${reference || Date.now()}`, noMoneyMoved: true };
    }
    const stripe = client();
    // Real money and no working client: never pretend; the refund job retries it
    if (!stripe) return { success: false, message: 'Card refunds are unavailable right now (Stripe is not configured); will retry.' };
    try {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentTxId, amount: Math.round(Number(amount) * 100), metadata: { reference: reference || '' } },
        { idempotencyKey: reference ? `refund_${reference}` : undefined },
      );
      if (refund.status === 'failed' || refund.status === 'canceled') return { success: false, providerRef: refund.id, message: `Stripe refund ${refund.status}.` };
      return { success: true, providerRef: refund.id, pending: refund.status === 'pending' };
    } catch (err) {
      console.error('[STRIPE REFUND ERROR]', err.message);
      return { success: false, message: `Stripe refund failed: ${err.message}` };
    }
  },
};
