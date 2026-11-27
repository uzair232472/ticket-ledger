/**
 * Payment service: one entry point for every payment method, dispatched to its provider
 * (services/payments/providers.js). FAIL-CLOSED: a payment is successful only when its provider confirmed it on
 * the server. Stripe is the current provider; JazzCash and EasyPaisa are future integrations and are disabled;
 * MOCK is the development test checkout, refused in production and live mode (services/payments/config.js).
 */
import { methodAvailability, PaymentError } from './payments/config.js';
import { providerFor } from './payments/providers.js';

class PaymentService {
  /** { STRIPE: { available, reason? }, ... } */
  availability() {
    return methodAvailability();
  }

  /** Throws PaymentError(400 PAYMENT_METHOD_UNAVAILABLE) when the method cannot take a payment now. */
  assertAvailable(paymentMethod) {
    const a = methodAvailability()[paymentMethod];
    if (!a) throw new PaymentError(400, 'PAYMENT_METHOD_UNAVAILABLE', 'Unknown payment method.');
    if (!a.available) throw new PaymentError(paymentMethod === 'STRIPE' ? 503 : 400, paymentMethod === 'STRIPE' ? 'PAYMENT_PROVIDER_UNAVAILABLE' : 'PAYMENT_METHOD_UNAVAILABLE', a.reason);
  }

  /**
   * Starts (or resumes) the order's payment. One payment per order: `paymentRef` is the handle an earlier call
   * returned for this order, and the same payment is returned again instead of a new one, so a customer who
   * retries checkout can never be charged twice. Throws PaymentError when the method or provider is unavailable.
   */
  async initiatePayment({ orderId, amount, paymentMethod, paymentRef = null }) {
    this.assertAvailable(paymentMethod);
    return providerFor(paymentMethod).initiate({ orderId, amount, paymentRef });
  }

  /** { success: true, ... } only when the provider confirmed this payment for this order and amount. */
  async verifyPayment({ paymentMethod, paymentDetails, expectedAmount, orderId = null }) {
    try {
      const v = await providerFor(paymentMethod).verify({ paymentDetails: paymentDetails || {}, expectedAmount, orderId });
      return v && v.success === true ? v : { success: false, ...(v || {}), message: v?.message || 'Payment could not be confirmed.' };
    } catch (e) {
      console.error('[PAYMENT VERIFY ERROR]', e.message);
      return { success: false, code: 'PAYMENT_VERIFY_ERROR', message: 'Payment could not be confirmed. Please try again.', retryable: true };
    }
  }

  /** 'succeeded' | 'processing' | 'open' | 'unknown', without changing anything. */
  async paymentStatus({ paymentMethod, paymentRef }) {
    return providerFor(paymentMethod).status({ paymentRef });
  }

  /** Payments that really moved money: only these need money sent back. */
  isRealPayment({ paymentMethod, paymentTxId }) {
    return providerFor(paymentMethod).isRealPayment({ paymentTxId });
  }

  /** Sends money back for one ticket (or reports that none moved). Returns { success, providerRef, pending?, message? }. */
  async refund({ paymentMethod, paymentTxId, amount, reference }) {
    if (!(Number(amount) > 0)) return { success: false, message: 'Nothing to refund.' };
    return providerFor(paymentMethod).refund({ paymentTxId, amount, reference });
  }
}

export { PaymentError };
export default new PaymentService();
