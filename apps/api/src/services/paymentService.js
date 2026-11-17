import crypto from 'crypto';
import Stripe from 'stripe';

const stripeClient = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('mock')
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

/**
 * Multi-Gateway Payment Service
 * Supports Stripe Sandbox, JazzCash Mock/Sandbox, EasyPaisa Mock/Sandbox, and 1-Click Mock.
 */
// Stripe amounts are in paisa, with Stripe's minimum charge
const stripeAmount = (pkr) => Math.max(100, Math.round(Number(pkr) * 100));

class PaymentService {
  /**
   * Initiate payment with selected gateway
   */
  /**
   * One payment per order: `paymentRef` is the handle an earlier call returned for this order (Stripe
   * PaymentIntent id, JazzCash / EasyPaisa reference, mock id). When it is given, the same payment is returned
   * again instead of a new one, so a customer who retries checkout can never be charged twice for one order.
   * The returned params carry `paymentRef` for the caller to store on the order.
   */
  async initiatePayment({ orderId, amount, paymentMethod, customerPhone, customerEmail, paymentRef = null }) {
    const formattedAmount = Number(amount);

    switch (paymentMethod) {
      case 'STRIPE': {
        if (stripeClient) {
          try {
            const paisaAmount = stripeAmount(formattedAmount);
            // The order's existing PaymentIntent, while it can still be paid (or already was)
            if (paymentRef?.startsWith('pi_')) {
              const existing = await stripeClient.paymentIntents.retrieve(paymentRef).catch(() => null);
              if (existing && existing.status !== 'canceled' && existing.amount === paisaAmount) {
                return {
                  gateway: 'STRIPE',
                  clientSecret: existing.client_secret,
                  paymentIntentId: existing.id,
                  paymentRef: existing.id,
                  alreadyPaid: existing.status === 'succeeded',
                  currency: 'PKR',
                  amount: formattedAmount,
                  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
                  instructions: 'Use simulated test card 4242 4242 4242 4242 with any future expiry and CVV 123.',
                };
              }
            }
            const paymentIntent = await stripeClient.paymentIntents.create({
              amount: paisaAmount,
              currency: 'pkr',
              automatic_payment_methods: { enabled: true },
              metadata: {
                orderId,
                customerEmail: customerEmail || '',
                customerPhone: customerPhone || '',
              },
              description: `TicketLedger Booking #${orderId}`,
            }, paymentRef ? undefined : { idempotencyKey: `ticketledger_order_${orderId}_${paisaAmount}` });

            return {
              gateway: 'STRIPE',
              clientSecret: paymentIntent.client_secret,
              paymentIntentId: paymentIntent.id,
              paymentRef: paymentIntent.id,
              alreadyPaid: paymentIntent.status === 'succeeded',
              currency: 'PKR',
              amount: formattedAmount,
              publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
              instructions: 'Use simulated test card 4242 4242 4242 4242 with any future expiry and CVV 123.',
            };
          } catch (stripeErr) {
            console.error('[STRIPE INITIATE ERROR]', stripeErr.message);
          }
        }

        const clientSecret = `pi_${orderId.replace(/-/g, '').substring(0, 16)}_secret_${crypto.randomBytes(12).toString('hex')}`;
        return {
          gateway: 'STRIPE',
          clientSecret,
          currency: 'PKR',
          amount: formattedAmount,
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_mock_ticketledger_stripe',
          instructions: 'Use simulated test card 4242 4242 4242 4242 with any future expiry and CVV 123.',
        };
      }

      case 'JAZZCASH': {
        const ppTxnRefNo = paymentRef?.startsWith('JC') ? paymentRef : `JC${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
        return {
          gateway: 'JAZZCASH',
          ppTxnRefNo,
          paymentRef: ppTxnRefNo,
          amount: formattedAmount,
          currency: 'PKR',
          phone: customerPhone || '03001234567',
          otpHint: '123456',
          instructions: `Simulated JazzCash prompt sent to ${customerPhone || '03001234567'}. Enter mock MPIN / OTP 123456 to authorize.`,
        };
      }

      case 'EASYPAISA': {
        const epOrderId = paymentRef?.startsWith('EP') ? paymentRef : `EP${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
        return {
          gateway: 'EASYPAISA',
          epOrderId,
          paymentRef: epOrderId,
          amount: formattedAmount,
          currency: 'PKR',
          phone: customerPhone || '03331234567',
          otpHint: '123456',
          instructions: `Simulated EasyPaisa authorization push sent to ${customerPhone || '03331234567'}. Enter mock OTP 123456 to confirm payment.`,
        };
      }

      case 'MOCK':
      default: {
        const mockTxId = paymentRef?.startsWith('MOCK_') ? paymentRef : `MOCK_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        return {
          gateway: 'MOCK',
          mockTxId,
          paymentRef: mockTxId,
          amount: formattedAmount,
          currency: 'PKR',
          instructions: 'Instant 1-click test checkout mode.',
        };
      }
    }
  }

  /**
   * Verify and finalize payment across gateways
   */
  async verifyPayment({ paymentMethod, paymentDetails, expectedAmount, orderId = null }) {
    switch (paymentMethod) {
      case 'STRIPE': {
        const { paymentIntentId, paymentTxId } = paymentDetails || {};
        const targetId = paymentIntentId || (paymentTxId?.startsWith('pi_') ? paymentTxId : null);

        if (stripeClient && targetId && !targetId.includes('mock') && !targetId.includes('_secret_')) {
          try {
            const intent = await stripeClient.paymentIntents.retrieve(targetId);
            if (intent.status !== 'succeeded') {
              return {
                success: false,
                message: `Stripe payment status is '${intent.status}'. Please complete checkout.`,
              };
            }
            // A payment belongs to one order: another order's PaymentIntent, or one for a different amount, is refused
            if (orderId && intent.metadata?.orderId && intent.metadata.orderId !== orderId) {
              return { success: false, code: 'PAYMENT_OTHER_ORDER', message: 'This payment belongs to a different booking.' };
            }
            if (expectedAmount != null && intent.amount !== stripeAmount(expectedAmount)) {
              return { success: false, code: 'PAYMENT_AMOUNT_MISMATCH', message: 'The amount paid does not match this booking.' };
            }
            return {
              success: true,
              real: true,
              gateway: 'STRIPE',
              transactionId: intent.id,
              fee: 0,
              paidAt: new Date(intent.created * 1000),
            };
          } catch (err) {
            console.error('[STRIPE RETRIEVE ERROR]', err.message);
            if (!paymentTxId) {
              return { success: false, message: `Stripe verification failed: ${err.message}` };
            }
          }
        }

        const txId = paymentTxId || targetId || `ch_${crypto.randomBytes(12).toString('hex')}`;
        return {
          success: true,
          gateway: 'STRIPE',
          transactionId: txId,
          fee: 0,
          paidAt: new Date(),
        };
      }

      case 'JAZZCASH': {
        const { otpCode, ppTxnRefNo } = paymentDetails;
        // In sandbox/mock, allow default '123456' or any 6-digit number
        if (otpCode && otpCode !== '123456' && otpCode.length !== 6) {
          return {
            success: false,
            message: 'Invalid JazzCash MPIN / OTP. (Use demo OTP: 123456)',
          };
        }
        return {
          success: true,
          gateway: 'JAZZCASH',
          transactionId: ppTxnRefNo || `JC_TX_${Date.now()}`,
          responseCode: '000',
          paidAt: new Date(),
        };
      }

      case 'EASYPAISA': {
        const { otpCode, epOrderId } = paymentDetails;
        // In sandbox/mock, allow default '123456' or any 6-digit number
        if (otpCode && otpCode !== '123456' && otpCode.length !== 6) {
          return {
            success: false,
            message: 'Invalid EasyPaisa Authorization Code. (Use demo OTP: 123456)',
          };
        }
        return {
          success: true,
          gateway: 'EASYPAISA',
          transactionId: epOrderId || `EP_TX_${Date.now()}`,
          responseCode: '0000',
          paidAt: new Date(),
        };
      }

      case 'MOCK':
      default: {
        return {
          success: true,
          gateway: 'MOCK',
          transactionId: paymentDetails.paymentTxId || `MOCK_TX_${Date.now()}`,
          paidAt: new Date(),
        };
      }
    }
  }

  /**
   * Where an order's payment stands at the gateway, without changing anything: 'succeeded', 'processing'
   * (the customer is paying right now), 'open' (not paid) or 'unknown' (sandbox gateways, which have no
   * payment until the customer confirms).
   */
  async paymentStatus({ paymentMethod, paymentRef }) {
    if (paymentMethod === 'STRIPE' && stripeClient && paymentRef?.startsWith('pi_')) {
      try {
        const intent = await stripeClient.paymentIntents.retrieve(paymentRef);
        if (intent.status === 'succeeded') return 'succeeded';
        if (intent.status === 'processing' || intent.status === 'requires_capture') return 'processing';
        return 'open';
      } catch (err) {
        console.error('[STRIPE STATUS ERROR]', err.message);
        return 'unknown';
      }
    }
    return 'unknown';
  }

  /** Gateway payments that really moved money (not the sandbox simulations): only these need a refund back. */
  isRealPayment({ paymentMethod, paymentTxId }) {
    return paymentMethod === 'STRIPE' && Boolean(stripeClient) && Boolean(paymentTxId?.startsWith('pi_')) && !paymentTxId.includes('_secret_') && !paymentTxId.includes('mock');
  }

  /**
   * Send money back for one ticket. Stripe payments made with a real PaymentIntent are refunded through
   * Stripe (partially, for one ticket of a bigger order); the sandbox gateways (JazzCash, EasyPaisa, mock
   * and resale purchases, which have no gateway payment) simulate the reversal with a reference.
   * Returns { success, providerRef, pending?, message? }.
   */
  async refund({ paymentMethod, paymentTxId, amount, reference }) {
    const formattedAmount = Number(amount);
    if (!(formattedAmount > 0)) return { success: false, message: 'Nothing to refund.' };
    const ref = (prefix) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    if (paymentMethod === 'STRIPE' && stripeClient && paymentTxId?.startsWith('pi_') && !paymentTxId.includes('_secret_') && !paymentTxId.includes('mock')) {
      try {
        const refund = await stripeClient.refunds.create(
          { payment_intent: paymentTxId, amount: Math.round(formattedAmount * 100), metadata: { reference: reference || '' } },
          { idempotencyKey: reference ? `refund_${reference}` : undefined },
        );
        if (refund.status === 'failed' || refund.status === 'canceled') {
          return { success: false, providerRef: refund.id, message: `Stripe refund ${refund.status}.` };
        }
        // "pending" refunds complete on Stripe's side; the money is on its way either way
        return { success: true, providerRef: refund.id, pending: refund.status === 'pending' };
      } catch (err) {
        console.error('[STRIPE REFUND ERROR]', err.message);
        return { success: false, message: `Stripe refund failed: ${err.message}` };
      }
    }

    switch (paymentMethod) {
      case 'STRIPE':
        return { success: true, providerRef: ref('re_sim_') };
      case 'JAZZCASH':
        return { success: true, providerRef: ref('JCR'), responseCode: '000' };
      case 'EASYPAISA':
        return { success: true, providerRef: ref('EPR'), responseCode: '0000' };
      default:
        return { success: true, providerRef: ref('MOCK_RF_') };
    }
  }
}

export default new PaymentService();
