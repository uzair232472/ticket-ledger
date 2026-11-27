/**
 * Payment evidence for ML training: only a payment the SERVER verified with the provider counts, and only in
 * live mode. Simulated gateways and MOCK never produce evidence. No database or network needed.
 *
 *   node --test test_payment_evidence.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.STRIPE_SECRET_KEY = 'sk_mock_for_tests'; // no Stripe client: the network is never used
process.env.NODE_ENV = 'development'; // the MOCK test checkout is a development feature
const { evidenceOf } = await import('./src/services/paymentEvidence.js');
const paymentService = (await import('./src/services/paymentService.js')).default;

test('MOCK (development test checkout) succeeds but is never evidence; JazzCash / EasyPaisa are disabled', async () => {
  const mock = await paymentService.verifyPayment({ paymentMethod: 'MOCK', paymentDetails: { paymentTxId: 'x' }, expectedAmount: 100, orderId: 'o' });
  assert.equal(mock.success, true, 'MOCK works in development');
  assert.equal(evidenceOf('MOCK', mock), null, 'MOCK is not evidence');
  for (const paymentMethod of ['JAZZCASH', 'EASYPAISA']) {
    const v = await paymentService.verifyPayment({ paymentMethod, paymentDetails: { otpCode: '123456', paymentTxId: 'x' }, expectedAmount: 100, orderId: 'o' });
    assert.equal(v.success, false, `${paymentMethod} is not integrated: it can never confirm a payment`);
    assert.equal(evidenceOf(paymentMethod, v), null);
  }
});

test('Stripe without a server-side PaymentIntent check is not a payment at all (fail-closed)', async () => {
  const v = await paymentService.verifyPayment({ paymentMethod: 'STRIPE', paymentDetails: { paymentTxId: 'pi_123' }, expectedAmount: 100, orderId: 'o' });
  assert.equal(v.success, false, 'no usable Stripe key: never a simulated success');
  assert.equal(evidenceOf('STRIPE', v), null);
});

test('a provider-confirmed payment records the provider\'s own live/test mode', () => {
  const live = evidenceOf('STRIPE', { success: true, real: true, transactionId: 'pi_live', livemode: true, verifiedVia: 'stripe.paymentIntents.retrieve' });
  assert.deepEqual([live.livemode, live.transactionId], [true, 'pi_live']);
  assert.equal(evidenceOf('STRIPE', { success: true, real: true, transactionId: 'pi_t', livemode: false }).livemode, false);
  assert.equal(evidenceOf('STRIPE', { success: true, real: true, transactionId: 'pi_t' }), null, 'mode unknown -> no evidence');
  assert.equal(evidenceOf('STRIPE', { success: false, real: true, livemode: true }), null);
});
