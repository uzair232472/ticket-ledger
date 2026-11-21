/**
 * Payment methods that are planned but NOT integrated (JazzCash, EasyPaisa). They can never start or confirm
 * a payment, so no order can be marked paid through them. Orders recorded with them before (simulated
 * development checkouts) moved no money, so a refund of such an order completes without a provider call.
 *
 * To integrate a provider later, replace its entry in providers.js with a module implementing the same
 * interface as stripeProvider.js:
 *   available()                              -> boolean (real credentials configured, mode consistent)
 *   initiate({ orderId, amount, paymentRef }) -> payment params for the browser (throws PaymentError)
 *   verify({ paymentDetails, expectedAmount, orderId }) -> { success, real, transactionId, livemode, ... }
 *       success only after the SERVER confirmed the payment with the provider (status inquiry API or a
 *       signature-verified callback), for this order and amount; every error is a failure
 *   status({ paymentRef }), isRealPayment({ paymentTxId }), refund({ paymentTxId, amount, reference })
 * and record its provider callbacks as payment evidence like stripeWebhookService.js.
 */
import { PaymentError } from './config.js';

export function unavailableProvider(id, label) {
  const message = `${label} is not available yet.`;
  return {
    id,
    available: () => false,
    async initiate() { throw new PaymentError(400, 'PAYMENT_METHOD_UNAVAILABLE', message); },
    async verify() { return { success: false, code: 'PAYMENT_METHOD_UNAVAILABLE', message }; },
    status: async () => 'unknown',
    isRealPayment: () => false,
    refund: async ({ reference }) => ({ success: true, providerRef: `none_${reference || Date.now()}`, noMoneyMoved: true }),
  };
}
