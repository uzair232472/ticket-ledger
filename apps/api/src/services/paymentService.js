import crypto from 'crypto';
import Stripe from 'stripe';

const stripeClient = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('mock')
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

/**
 * Multi-Gateway Payment Service
 * Supports Stripe Sandbox, JazzCash Mock/Sandbox, EasyPaisa Mock/Sandbox, and 1-Click Mock.
 */
class PaymentService {
  /**
   * Initiate payment with selected gateway
   */
  async initiatePayment({ orderId, amount, paymentMethod, customerPhone, customerEmail }) {
    const formattedAmount = Number(amount);

    switch (paymentMethod) {
      case 'STRIPE': {
        if (stripeClient) {
          try {
            const paisaAmount = Math.max(100, Math.round(formattedAmount * 100));
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
            });

            return {
              gateway: 'STRIPE',
              clientSecret: paymentIntent.client_secret,
              paymentIntentId: paymentIntent.id,
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
        const ppTxnRefNo = `JC${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
        return {
          gateway: 'JAZZCASH',
          ppTxnRefNo,
          amount: formattedAmount,
          currency: 'PKR',
          phone: customerPhone || '03001234567',
          otpHint: '123456',
          instructions: `Simulated JazzCash prompt sent to ${customerPhone || '03001234567'}. Enter mock MPIN / OTP 123456 to authorize.`,
        };
      }

      case 'EASYPAISA': {
        const epOrderId = `EP${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
        return {
          gateway: 'EASYPAISA',
          epOrderId,
          amount: formattedAmount,
          currency: 'PKR',
          phone: customerPhone || '03331234567',
          otpHint: '123456',
          instructions: `Simulated EasyPaisa authorization push sent to ${customerPhone || '03331234567'}. Enter mock OTP 123456 to confirm payment.`,
        };
      }

      case 'MOCK':
      default: {
        return {
          gateway: 'MOCK',
          mockTxId: `MOCK_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
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
  async verifyPayment({ paymentMethod, paymentDetails, expectedAmount }) {
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
            return {
              success: true,
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
