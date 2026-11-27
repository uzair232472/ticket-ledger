/**
 * Why a checkout ended without payment. Every path that moves an order from PENDING to FAILED records one
 * AuditLog row (action CHECKOUT_ENDED, targetType Order) with the reason, in the SAME transaction as the
 * status change, so the reason exists exactly when the order ended:
 *
 *   HOLD_EXPIRED        the seat hold ran out with no payment (the only reason that can mean "abandoned")
 *   CUSTOMER_CANCELLED  the customer cancelled the checkout themselves
 *   SUPERSEDED          the customer started a new checkout for the same seats (the visit continues)
 *   EVENT_CANCELLED     the event was cancelled while the checkout was open
 *
 * An abandoned-checkout label (ML) is only HOLD_EXPIRED with no payment attempt and no verified purchase of
 * the event in the outcome window. Cancelled, superseded, event-cancelled and payment-failed checkouts are
 * never labelled abandoned (services/ml/export.js).
 */
export const CHECKOUT_ENDED = 'CHECKOUT_ENDED';
export const END_REASONS = ['HOLD_EXPIRED', 'CUSTOMER_CANCELLED', 'SUPERSEDED', 'EVENT_CANCELLED'];

/** Behaviour actions that mean "the customer left checkout" for dashboards (reasons kept apart for ML). */
export const LEFT_CHECKOUT_ACTIONS = ['checkout_abandoned', 'checkout_cancelled', 'seat_hold_released', 'checkout_expired'];

/** orders: [{ id, userId, eventId }]; db: the transaction that changed their status. */
export async function recordCheckoutEnd(db, orders, reason, extra = {}) {
  if (!END_REASONS.includes(reason)) throw new Error(`unknown checkout end reason ${reason}`);
  const rows = orders.filter((o) => o?.id && o.userId).map((o) => ({
    userId: o.userId, action: CHECKOUT_ENDED, targetType: 'Order', targetId: o.id,
    details: { reason, eventId: o.eventId ?? null, ...extra },
  }));
  if (rows.length) await db.auditLog.createMany({ data: rows });
  return rows.length;
}
