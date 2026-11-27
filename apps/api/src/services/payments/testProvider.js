/**
 * MOCK: the development test checkout. No money moves and it is never payment evidence. Refused in
 * production, in Stripe live mode, or with PAYMENT_TEST_CHECKOUT=off (config.testCheckoutAllowed): checked
 * when a payment starts AND again when it is confirmed, so an order created while it was allowed cannot be
 * confirmed after it was switched off.
 */
import crypto from 'crypto';
import { PaymentError, testCheckoutAllowed } from './config.js';

const OFF = 'Test payments are disabled.';

export const testProvider = {
  id: 'MOCK',
  available: () => testCheckoutAllowed(),
  async initiate({ amount, paymentRef = null }) {
    if (!testCheckoutAllowed()) throw new PaymentError(400, 'PAYMENT_METHOD_UNAVAILABLE', OFF);
    const mockTxId = paymentRef?.startsWith('MOCK_') ? paymentRef : `MOCK_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    return { gateway: 'MOCK', mockTxId, paymentRef: mockTxId, amount: Number(amount), currency: 'PKR', test: true, instructions: 'Test checkout: no money is charged.' };
  },
  async verify({ paymentDetails }) {
    if (!testCheckoutAllowed()) return { success: false, code: 'PAYMENT_METHOD_UNAVAILABLE', message: OFF };
    return { success: true, gateway: 'MOCK', test: true, transactionId: paymentDetails?.paymentTxId || `MOCK_TX_${Date.now()}`, paidAt: new Date() };
  },
  status: async () => 'unknown',
  isRealPayment: () => false,
  // No money moved: nothing to send back
  refund: async ({ reference }) => ({ success: true, providerRef: `MOCK_RF_${reference || Date.now()}`, noMoneyMoved: true }),
};
