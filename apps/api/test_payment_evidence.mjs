/**
 * Payment evidence for ML training: only a payment the SERVER verified with the provider counts, and only in
 * live mode. Simulated gateways and MOCK never produce evidence. No database or network needed.
 *
 *   node --test test_payment_evidence.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.STRIPE_SECRET_KEY = 'sk_mock_for_tests'; // no Stripe client: the network is never used
const { evidenceOf } = await import('./src/services/paymentEvidence.js');
const paymentService = (await import('./src/services/paymentService.js')).default;

test('simulated gateways and MOCK never give evidence, whatever the order row says', async () => {
  for (const paymentMethod of ['JAZZCASH', 'EASYPAISA', 'MOCK']) {
    const v = await paymentService.verifyPayment({ paymentMethod, paymentDetails: { otpCode: '123456', paymentTxId: 'x' }, expectedAmount: 100, orderId: 'o' });
    assert.equal(v.success, true, `${paymentMethod} simulation succeeds`);
    assert.equal(evidenceOf(paymentMethod, v), null, `${paymentMethod} is not evidence`);
  }
});

test('Stripe without a server-side PaymentIntent check is not evidence', async () => {
  const v = await paymentService.verifyPayment({ paymentMethod: 'STRIPE', paymentDetails: { paymentTxId: 'pi_123' }, expectedAmount: 100, orderId: 'o' });
  assert.equal(v.success, true);
  assert.equal(evidenceOf('STRIPE', v), null, 'fallback path: no provider confirmation');
});

test('a provider-confirmed payment records the provider\'s own live/test mode', () => {
  const live = evidenceOf('STRIPE', { success: true, real: true, transactionId: 'pi_live', livemode: true, verifiedVia: 'stripe.paymentIntents.retrieve' });
  assert.deepEqual([live.livemode, live.transactionId], [true, 'pi_live']);
  assert.equal(evidenceOf('STRIPE', { success: true, real: true, transactionId: 'pi_t', livemode: false }).livemode, false);
  assert.equal(evidenceOf('STRIPE', { success: true, real: true, transactionId: 'pi_t' }), null, 'mode unknown -> no evidence');
  assert.equal(evidenceOf('STRIPE', { success: false, real: true, livemode: true }), null);
});
