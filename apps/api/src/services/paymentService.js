import crypto from 'crypto';

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
        // Stripe verification: accept valid mock client secret or transaction ID
        const txId = paymentDetails.paymentTxId || `ch_${crypto.randomBytes(12).toString('hex')}`;
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
}

export default new PaymentService();
