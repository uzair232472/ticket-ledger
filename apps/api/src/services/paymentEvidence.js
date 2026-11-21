/**
 * Server-side payment evidence. When the SERVER confirms a payment with the provider itself (Stripe:
 * paymentIntents.retrieve returned a succeeded intent for this order and amount), it records what the
 * provider said, including whether the payment was made in live mode. Nothing else is evidence: a
 * successful order row, a payment method name, a transaction id or an operator's statement are not.
 *
 * Only orders with evidence { livemode: true } count as real purchases for ML training
 * (services/ml/export.js). Today:
 *   - STRIPE: evidence is recorded; livemode comes from the provider (a test key gives livemode false);
 *   - JAZZCASH / EASYPAISA: simulated in paymentService.js (no provider call), so never evidence;
 *   - MOCK: never.
 * One AuditLog row per order (action PAYMENT_SERVER_VERIFIED); it never changes the order or payment.
 */
import prisma from '../config/prisma.js';

export const EVIDENCE_ACTION = 'PAYMENT_SERVER_VERIFIED';

/** Evidence details from a verifyPayment() result, or null when the server did not verify with the provider. */
export function evidenceOf(paymentMethod, verification) {
  if (!verification?.success || verification.real !== true || typeof verification.livemode !== 'boolean') return null;
  return {
    gateway: paymentMethod, transactionId: verification.transactionId, livemode: verification.livemode,
    verifiedVia: verification.verifiedVia || 'provider', paidAt: verification.paidAt ?? null,
  };
}

/** Records evidence for the given orders (best effort: never blocks or fails a payment). */
export async function recordPaymentEvidence({ orderIds, userId, paymentMethod, verification }, db = prisma) {
  const details = evidenceOf(paymentMethod, verification);
  if (!details || !orderIds?.length) return 0;
  try {
    const existing = new Set((await db.auditLog.findMany({
      where: { action: EVIDENCE_ACTION, targetType: 'Order', targetId: { in: orderIds } }, select: { targetId: true },
    })).map((r) => r.targetId));
    const rows = orderIds.filter((id) => !existing.has(id))
      .map((id) => ({ userId, action: EVIDENCE_ACTION, targetType: 'Order', targetId: id, details }));
    // skipDuplicates + the unique index (one evidence row per order): the checkout and the webhook may race
    if (rows.length) await db.auditLog.createMany({ data: rows, skipDuplicates: true });
    return rows.length;
  } catch (e) {
    console.warn('[payment evidence] not recorded:', e.message);
    return 0;
  }
}

/**
 * Orders with live, server-verified evidence created before `now`: Map orderId -> { at, transactionId }.
 * The evidence's transaction id must still be the order's own (paymentTxId). Read in pages (earliest first; the
 * earliest evidence of an order is the one kept), so it scales with the number of paid orders.
 */
export async function liveEvidence(db = prisma, now = new Date(), pageSize = 5000) {
  const out = new Map();
  let cursor = null;
  for (;;) {
    const rows = await db.auditLog.findMany({
      where: { action: EVIDENCE_ACTION, targetType: 'Order', createdAt: { lt: now } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: pageSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, targetId: true, createdAt: true, details: true },
    });
    const live = rows.filter((r) => r.details?.livemode === true);
    const orders = new Map((await db.order.findMany({ where: { id: { in: [...new Set(live.map((r) => r.targetId))] } }, select: { id: true, paymentTxId: true } }))
      .map((o) => [o.id, o]));
    for (const r of live) {
      const o = orders.get(r.targetId);
      if (o && o.paymentTxId && o.paymentTxId === r.details.transactionId && !out.has(r.targetId)) out.set(r.targetId, { at: r.createdAt, transactionId: r.details.transactionId });
    }
    if (rows.length < pageSize) return out;
    cursor = rows.at(-1).id;
  }
}
