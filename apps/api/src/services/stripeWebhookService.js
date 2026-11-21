/**
 * Stripe webhooks: server-side payment outcomes as EVIDENCE (never a change to orders, payments or tickets;
 * orders are still confirmed by the existing server-side PaymentIntent check in bookingController).
 *
 *   - Signature verified on the RAW body with STRIPE_WEBHOOK_SECRET (stripe.webhooks.constructEvent).
 *   - Test and live are separate configurations: STRIPE_MODE = test | live (default test) must match the
 *     secret key's prefix, and every event's livemode must match STRIPE_MODE (else refused and audited).
 *   - Idempotent: one AuditLog row per Stripe event id (STRIPE_EVENT); a re-delivery changes nothing.
 *   - Linked to the order by PaymentIntent id (order.paymentRef / paymentTxId), else metadata.orderId; the
 *     amount must match the order total.
 * Outcomes recorded (AuditLog, targetType Order):
 *   payment_intent.succeeded       -> PAYMENT_SERVER_VERIFIED (paymentEvidence.js; livemode from Stripe)
 *   payment_intent.payment_failed  -> PAYMENT_FAILED_VERIFIED
 *   charge.refunded                -> PAYMENT_REFUND_VERIFIED
 *   charge.dispute.*               -> PAYMENT_DISPUTE (kept apart from fraud labels by the exporter)
 */
import Stripe from 'stripe';
import prisma from '../config/prisma.js';
import { recordPaymentEvidence } from './paymentEvidence.js';

export const STRIPE_EVENT = 'STRIPE_EVENT';
const stripeAmount = (pkr) => Math.max(100, Math.round(Number(pkr) * 100)); // as paymentService.js

/** Mode and configuration problems, without revealing any secret. */
export function stripeConfig(env = process.env) {
  const key = env.STRIPE_SECRET_KEY || '';
  const keyMode = /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : key ? 'unknown' : 'none';
  const mode = env.STRIPE_MODE === 'live' ? 'live' : 'test';
  const problems = [];
  if (env.STRIPE_MODE && !['test', 'live'].includes(env.STRIPE_MODE)) problems.push('STRIPE_MODE must be test or live');
  if (keyMode !== 'none' && keyMode !== mode) problems.push(`STRIPE_MODE is ${mode} but the secret key is a ${keyMode} key`);
  if (!env.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET is not set (webhooks are refused)');
  else if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET)) problems.push('STRIPE_WEBHOOK_SECRET does not look like a webhook signing secret');
  return { mode, keyMode, webhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET), problems };
}

const verifier = new Stripe('sk_test_signature_verification_only'); // used only for constructEvent (no API calls)

async function orderFor(db, { paymentIntentId, metadataOrderId }) {
  if (paymentIntentId) {
    const o = await db.order.findFirst({ where: { OR: [{ paymentRef: paymentIntentId }, { paymentTxId: paymentIntentId }] }, select: { id: true, userId: true, eventId: true, totalAmount: true, checkoutGroupId: true } });
    if (o) return [o];
    const group = await db.checkoutGroup.findFirst({ where: { OR: [{ paymentRef: paymentIntentId }, { paymentTxId: paymentIntentId }] }, select: { orders: { select: { id: true, userId: true, eventId: true, totalAmount: true, checkoutGroupId: true } }, totalAmount: true } });
    if (group) return group.orders.map((x) => ({ ...x, groupTotal: group.totalAmount }));
  }
  if (metadataOrderId) {
    const o = await db.order.findUnique({ where: { id: metadataOrderId }, select: { id: true, userId: true, eventId: true, totalAmount: true, checkoutGroupId: true } });
    if (o) return [o];
  }
  return [];
}

/**
 * Handles one webhook delivery. rawBody: Buffer; signature: the Stripe-Signature header.
 * Returns { status, body } for the HTTP response.
 */
export async function handleStripeWebhook({ rawBody, signature, env = process.env, db = prisma }) {
  const cfg = stripeConfig(env);
  if (!env.STRIPE_WEBHOOK_SECRET) return { status: 503, body: { received: false, error: 'webhook not configured' } };
  let event;
  try {
    event = verifier.webhooks.constructEvent(rawBody, signature || '', env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return { status: 400, body: { received: false, error: 'invalid signature' } };
  }
  const expectLive = cfg.mode === 'live';
  if (Boolean(event.livemode) !== expectLive) {
    await db.auditLog.create({ data: { action: 'STRIPE_WEBHOOK_MODE_MISMATCH', targetType: 'StripeEvent', targetId: event.id, details: { type: event.type, livemode: Boolean(event.livemode), configuredMode: cfg.mode } } }).catch(() => {});
    return { status: 400, body: { received: false, error: `event mode does not match STRIPE_MODE=${cfg.mode}` } };
  }
  if (await db.auditLog.findFirst({ where: { action: STRIPE_EVENT, targetType: 'StripeEvent', targetId: event.id }, select: { id: true } })) {
    return { status: 200, body: { received: true, duplicate: true } };
  }
  const obj = event.data?.object || {};
  const paymentIntentId = obj.object === 'payment_intent' ? obj.id : (obj.payment_intent || null);
  const orders = await orderFor(db, { paymentIntentId, metadataOrderId: obj.metadata?.orderId });
  const outcome = { type: event.type, livemode: Boolean(event.livemode), paymentIntentId, orders: orders.map((o) => o.id), linked: orders.length > 0 };
  const audit = (action, details) => (orders.length
    ? db.auditLog.createMany({ data: orders.map((o) => ({ userId: o.userId, action, targetType: 'Order', targetId: o.id, details: { stripeEventId: event.id, livemode: Boolean(event.livemode), ...details } })) })
    : null);

  if (event.type === 'payment_intent.succeeded') {
    const expected = orders.length ? stripeAmount(orders[0].groupTotal ?? orders.reduce((n, o) => n + Number(o.totalAmount), 0)) : null;
    if (orders.length && obj.amount === expected && obj.status === 'succeeded') {
      for (const o of orders) {
        await recordPaymentEvidence({ orderIds: [o.id], userId: o.userId, paymentMethod: 'STRIPE', verification: { success: true, real: true, transactionId: obj.id, livemode: Boolean(event.livemode), verifiedVia: 'stripe.webhook', paidAt: obj.created ? new Date(obj.created * 1000) : null } }, db);
      }
      outcome.recorded = 'PAYMENT_SERVER_VERIFIED';
    } else {
      outcome.recorded = null;
      outcome.reason = orders.length ? 'amount or status does not match the order' : 'no matching order';
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    await audit('PAYMENT_FAILED_VERIFIED', { code: obj.last_payment_error?.code || null });
    outcome.recorded = orders.length ? 'PAYMENT_FAILED_VERIFIED' : null;
  } else if (event.type === 'charge.refunded') {
    await audit('PAYMENT_REFUND_VERIFIED', { amountRefunded: obj.amount_refunded ?? null, fullyRefunded: Boolean(obj.refunded) });
    outcome.recorded = orders.length ? 'PAYMENT_REFUND_VERIFIED' : null;
  } else if (event.type.startsWith('charge.dispute.')) {
    await audit('PAYMENT_DISPUTE', { disputeStatus: obj.status || null, reason: obj.reason || null, event: event.type });
    outcome.recorded = orders.length ? 'PAYMENT_DISPUTE' : null;
  } else {
    outcome.recorded = null;
    outcome.reason = 'event type not used';
  }
  await db.auditLog.create({ data: { action: STRIPE_EVENT, targetType: 'StripeEvent', targetId: event.id, details: outcome } });
  return { status: 200, body: { received: true, recorded: outcome.recorded } };
}
