/**
 * Payment security (R0): Stripe verification is FAIL-CLOSED and done on the server; JazzCash / EasyPaisa are
 * disabled; the MOCK test checkout is refused in production and live mode. A fake Stripe client stands in for
 * the network (no database, no network).
 *
 *   node --test test_payment_security.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const VALID_TEST_KEY = `sk_test_${'a1B2c3D4e5'.repeat(3)}`;
const VALID_LIVE_KEY = `sk_live_${'a1B2c3D4e5'.repeat(3)}`;
const ENV_KEYS = ['NODE_ENV', 'STRIPE_MODE', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY', 'PAYMENT_TEST_CHECKOUT'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const setEnv = (vars) => { for (const k of ENV_KEYS) { if (k in vars) { if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } } };
test.after(() => setEnv(saved));

setEnv({ NODE_ENV: 'development', STRIPE_MODE: 'test', STRIPE_SECRET_KEY: VALID_TEST_KEY, PAYMENT_TEST_CHECKOUT: undefined });
const { default: paymentService, PaymentError } = await import('./src/services/paymentService.js');
const cfg = await import('./src/services/payments/config.js');
const { setStripeClientForTesting, stripeAmount } = await import('./src/services/payments/stripeProvider.js');
const { evidenceOf } = await import('./src/services/paymentEvidence.js');

const ORDER = 'order-1';
const AMOUNT = 2500;
const intent = (over = {}) => ({ object: 'payment_intent', id: 'pi_ok123', status: 'succeeded', amount: stripeAmount(AMOUNT), amount_received: stripeAmount(AMOUNT), currency: 'pkr', livemode: false, created: 1_800_000_000, metadata: { orderId: ORDER }, client_secret: 'pi_ok123_secret_x', ...over });
/** A fake Stripe client: retrieve answers with `answer` (a value, or a function that throws). */
function fake(answer, extra = {}) {
  const calls = [];
  return {
    calls,
    paymentIntents: {
      retrieve: async (id) => { calls.push(['retrieve', id]); return typeof answer === 'function' ? answer(id) : answer; },
      create: async (p, o) => { calls.push(['create', p, o]); return extra.create ? extra.create(p) : intent({ status: 'requires_payment_method', metadata: p.metadata }); },
    },
    refunds: { create: async (p) => { calls.push(['refund', p]); return { id: 're_1', status: 'succeeded' }; } },
  };
}
const verify = (details, over = {}) => paymentService.verifyPayment({ paymentMethod: 'STRIPE', paymentDetails: details, expectedAmount: AMOUNT, orderId: ORDER, ...over });

test('key classification: placeholder and malformed keys are never usable', () => {
  assert.equal(cfg.stripeKeyKind(''), 'none');
  assert.equal(cfg.stripeKeyKind('sk_test_mock_ticketledger'), 'placeholder');
  assert.equal(cfg.stripeKeyKind('sk_test_1'), 'placeholder', 'too short to be a real key');
  assert.equal(cfg.stripeKeyKind('sk_test_your_key_here_xxxxxxxxxxxxxxxx'), 'placeholder');
  assert.equal(cfg.stripeKeyKind('hello'), 'unknown');
  assert.equal(cfg.stripeKeyKind(VALID_TEST_KEY), 'test');
  assert.equal(cfg.stripeKeyKind(VALID_LIVE_KEY), 'live');
  assert.equal(cfg.stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_mock_x' }).usable, false);
  assert.equal(cfg.stripeConfig({ STRIPE_SECRET_KEY: VALID_LIVE_KEY }).usable, false, 'live key in test mode');
  assert.equal(cfg.stripeConfig({ STRIPE_SECRET_KEY: VALID_TEST_KEY }).usable, true);
});

test('missing or placeholder credentials: no payment can start or succeed, whatever the browser sends', async () => {
  setStripeClientForTesting(null);
  for (const key of [undefined, 'sk_test_mock_ticketledger_stripe', 'sk_test_1']) {
    setEnv({ STRIPE_SECRET_KEY: key });
    assert.equal(paymentService.availability().STRIPE.available, false, String(key));
    await assert.rejects(paymentService.initiatePayment({ orderId: ORDER, amount: AMOUNT, paymentMethod: 'STRIPE' }), (e) => e instanceof PaymentError && e.code === 'PAYMENT_PROVIDER_UNAVAILABLE');
    for (const details of [{ paymentIntentId: 'pi_ok123' }, { paymentTxId: 'ch_123' }, { paymentTxId: 'pi_123', paid: true }, {}]) {
      const v = await verify(details);
      assert.equal(v.success, false, `${key} ${JSON.stringify(details)}`);
      assert.equal(v.code, 'PAYMENT_PROVIDER_UNAVAILABLE');
    }
  }
  setEnv({ STRIPE_SECRET_KEY: VALID_TEST_KEY });
});

test('provider failures, timeouts and invalid responses are never a successful payment', async () => {
  const errors = [
    () => { throw Object.assign(new Error('Request timed out'), { type: 'StripeConnectionError' }); },
    () => { throw Object.assign(new Error('An error occurred with our connection to Stripe'), { type: 'StripeConnectionError' }); },
    () => { throw Object.assign(new Error('No such payment_intent'), { type: 'StripeInvalidRequestError', statusCode: 404 }); },
    () => { throw Object.assign(new Error('rate limited'), { type: 'StripeRateLimitError', statusCode: 429 }); },
    () => { throw Object.assign(new Error('api error'), { type: 'StripeAPIError', statusCode: 500 }); },
  ];
  for (const e of errors) {
    setStripeClientForTesting(fake(e));
    const v = await verify({ paymentIntentId: 'pi_ok123' });
    assert.equal(v.success, false);
    assert.equal(v.code, 'PAYMENT_PROVIDER_ERROR');
    assert.equal(v.retryable, true);
  }
  for (const bad of [null, undefined, {}, 'ok', { ...intent(), object: 'charge' }, intent({ id: 'pi_other' })]) {
    setStripeClientForTesting(fake(bad));
    const v = await verify({ paymentIntentId: 'pi_ok123' });
    assert.equal(v.success, false, JSON.stringify(bad));
    assert.equal(v.code, 'PAYMENT_INVALID_RESPONSE');
  }
});

test('every check must pass: status, order, amount, currency, mode', async () => {
  const cases = [
    [intent({ status: 'requires_payment_method' }), 'PAYMENT_NOT_COMPLETED'],
    [intent({ status: 'processing' }), 'PAYMENT_PROCESSING'],
    [intent({ status: 'requires_capture' }), 'PAYMENT_PROCESSING'],
    [intent({ status: 'canceled' }), 'PAYMENT_NOT_COMPLETED'],
    [intent({ metadata: {} }), 'PAYMENT_OTHER_ORDER'],
    [intent({ metadata: { orderId: 'order-2' } }), 'PAYMENT_OTHER_ORDER'],
    [intent({ amount: stripeAmount(AMOUNT) - 100 }), 'PAYMENT_AMOUNT_MISMATCH'],
    [intent({ amount_received: 100 }), 'PAYMENT_AMOUNT_MISMATCH'],
    [intent({ currency: 'usd' }), 'PAYMENT_CURRENCY_MISMATCH'],
    [intent({ livemode: true }), 'PAYMENT_MODE_MISMATCH'],
  ];
  for (const [answer, code] of cases) {
    setStripeClientForTesting(fake(answer));
    const v = await verify({ paymentIntentId: 'pi_ok123' });
    assert.equal(v.success, false, code);
    assert.equal(v.code, code);
  }
  setStripeClientForTesting(fake(intent()));
  assert.equal((await verify({ paymentIntentId: 'pi_ok123' }, { expectedAmount: null })).success, false, 'no expected amount');
  assert.equal((await verify({ paymentIntentId: 'pi_ok123' }, { orderId: null })).success, false, 'no order');
});

test('browser-supplied ids and flags are not trusted', async () => {
  const client = fake(intent());
  setStripeClientForTesting(client);
  for (const details of [{ paymentTxId: 'pi_ok123' }, { paymentTxId: 'ch_1790000000' }, { clientSecret: 'pi_ok123_secret_x' }, { paymentIntentId: 'pi_ok123_secret_x' }, { paymentIntentId: 'ch_123' }, { paid: true, success: true }]) {
    const v = await verify(details);
    assert.equal(v.success, false, JSON.stringify(details));
    assert.equal(v.code, 'PAYMENT_NOT_FOUND');
  }
  assert.equal(client.calls.length, 0, 'nothing that is not a PaymentIntent id is even looked up');
});

test('a payment confirmed by Stripe for this order and amount succeeds, as evidence with its mode', async () => {
  setStripeClientForTesting(fake(intent()));
  const v = await verify({ paymentIntentId: 'pi_ok123' });
  assert.equal(v.success, true);
  assert.equal(v.real, true);
  assert.equal(v.transactionId, 'pi_ok123');
  assert.equal(v.livemode, false);
  assert.equal(evidenceOf('STRIPE', v).livemode, false, 'test mode: evidence, but never a genuine purchase');
  // Live mode accepts only live payments
  setEnv({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: VALID_LIVE_KEY });
  setStripeClientForTesting(fake(intent({ livemode: true })));
  assert.equal((await verify({ paymentIntentId: 'pi_ok123' })).livemode, true);
  setStripeClientForTesting(fake(intent({ livemode: false })));
  assert.equal((await verify({ paymentIntentId: 'pi_ok123' })).code, 'PAYMENT_MODE_MISMATCH');
  setEnv({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY: VALID_TEST_KEY });
});

test('starting a payment: only the order id goes to Stripe; provider errors never give a fake payment', async () => {
  const client = fake(null);
  setStripeClientForTesting(client);
  const p = await paymentService.initiatePayment({ orderId: ORDER, amount: AMOUNT, paymentMethod: 'STRIPE', customerEmail: 'a@b.pk', customerPhone: '0300' });
  const create = client.calls.find((c) => c[0] === 'create');
  assert.deepEqual(create[1].metadata, { orderId: ORDER });
  assert.equal(create[1].currency, 'pkr');
  assert.equal(create[1].amount, stripeAmount(AMOUNT));
  assert.equal(p.paymentIntentId, 'pi_ok123');
  setStripeClientForTesting(fake(null, { create: () => { throw new Error('connection reset'); } }));
  await assert.rejects(paymentService.initiatePayment({ orderId: ORDER, amount: AMOUNT, paymentMethod: 'STRIPE' }), (e) => e.code === 'PAYMENT_PROVIDER_ERROR');
  setStripeClientForTesting(fake(null, { create: () => ({ id: 'not_a_pi' }) }));
  await assert.rejects(paymentService.initiatePayment({ orderId: ORDER, amount: AMOUNT, paymentMethod: 'STRIPE' }), (e) => e.code === 'PAYMENT_PROVIDER_ERROR');
});

test('JazzCash and EasyPaisa are disabled: they can neither start nor confirm a payment', async () => {
  for (const m of ['JAZZCASH', 'EASYPAISA', 'BITCOIN', undefined]) {
    assert.equal(paymentService.availability()[m]?.available ?? false, false);
    await assert.rejects(paymentService.initiatePayment({ orderId: ORDER, amount: AMOUNT, paymentMethod: m }), (e) => e instanceof PaymentError && e.code === 'PAYMENT_METHOD_UNAVAILABLE');
    const v = await paymentService.verifyPayment({ paymentMethod: m, paymentDetails: { otpCode: '123456', ppTxnRefNo: 'JC1', epOrderId: 'EP1', paymentTxId: 'x' }, expectedAmount: AMOUNT, orderId: ORDER });
    assert.equal(v.success, false, String(m));
    assert.equal(paymentService.isRealPayment({ paymentMethod: m, paymentTxId: 'JC_TX_1' }), false);
  }
});

test('MOCK test checkout: development only; refused in production, live mode, or when switched off', async () => {
  const ok = () => paymentService.verifyPayment({ paymentMethod: 'MOCK', paymentDetails: { paymentTxId: 'MOCK_1' }, expectedAmount: AMOUNT, orderId: ORDER });
  setEnv({ NODE_ENV: 'development', STRIPE_MODE: 'test', PAYMENT_TEST_CHECKOUT: undefined });
  assert.equal((await ok()).success, true);
  assert.equal(evidenceOf('MOCK', await ok()), null, 'never evidence');
  for (const env of [{ NODE_ENV: 'production' }, { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: VALID_LIVE_KEY }, { PAYMENT_TEST_CHECKOUT: 'off' }]) {
    setEnv(env);
    assert.equal(paymentService.availability().MOCK.available, false, JSON.stringify(env));
    await assert.rejects(paymentService.initiatePayment({ orderId: ORDER, amount: AMOUNT, paymentMethod: 'MOCK' }), (e) => e.code === 'PAYMENT_METHOD_UNAVAILABLE');
    assert.equal((await ok()).success, false, `confirm refused too: ${JSON.stringify(env)}`);
    setEnv({ NODE_ENV: 'development', STRIPE_MODE: 'test', STRIPE_SECRET_KEY: VALID_TEST_KEY, PAYMENT_TEST_CHECKOUT: undefined });
  }
});

test('refunds: real card payments are never "refunded" without Stripe; simulated orders moved no money', async () => {
  setStripeClientForTesting(null);
  setEnv({ STRIPE_SECRET_KEY: 'sk_test_mock_x' });
  assert.equal(paymentService.isRealPayment({ paymentMethod: 'STRIPE', paymentTxId: 'pi_real1' }), true, 'a PaymentIntent is real money even when Stripe is unreachable');
  const r = await paymentService.refund({ paymentMethod: 'STRIPE', paymentTxId: 'pi_real1', amount: 100, reference: 'r1' });
  assert.equal(r.success, false, 'retried later, never pretended');
  const sim = await paymentService.refund({ paymentMethod: 'STRIPE', paymentTxId: 'ch_1790000000', amount: 100, reference: 'r2' });
  assert.deepEqual([sim.success, sim.noMoneyMoved], [true, true]);
  setEnv({ STRIPE_SECRET_KEY: VALID_TEST_KEY });
  const client = fake(null);
  setStripeClientForTesting(client);
  assert.equal((await paymentService.refund({ paymentMethod: 'STRIPE', paymentTxId: 'pi_real1', amount: 100, reference: 'r3' })).providerRef, 're_1');
  assert.equal(client.calls.find((c) => c[0] === 'refund')[1].payment_intent, 'pi_real1');
});

test('startup refuses inconsistent or incomplete live configuration', () => {
  const p = (env) => cfg.paymentStartupProblems(env).fatal.join(' | ');
  assert.equal(p({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_mock_x' }), '', 'placeholder key: card payments unavailable, not fatal');
  assert.match(p({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY: VALID_LIVE_KEY }), /test but the secret key is a live key/);
  assert.match(p({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: VALID_TEST_KEY }), /live but the secret key is a test key/);
  assert.match(p({ STRIPE_MODE: 'live', NODE_ENV: 'development', STRIPE_SECRET_KEY: VALID_LIVE_KEY, STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }), /requires NODE_ENV=production/);
  assert.match(p({ STRIPE_MODE: 'live', NODE_ENV: 'production', STRIPE_SECRET_KEY: VALID_LIVE_KEY, STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }), /STRIPE_WEBHOOK_SECRET/);
  assert.match(p({ STRIPE_MODE: 'live', NODE_ENV: 'production', STRIPE_SECRET_KEY: VALID_LIVE_KEY, STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' }), /live publishable key/);
  assert.match(p({ STRIPE_MODE: 'live', NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_mock', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }), /real live secret key/);
  assert.equal(p({ STRIPE_MODE: 'live', NODE_ENV: 'production', STRIPE_SECRET_KEY: VALID_LIVE_KEY, STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x' }), '');
});
