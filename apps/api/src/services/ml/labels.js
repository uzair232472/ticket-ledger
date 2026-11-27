/**
 * Outcome definitions shared by the training exporter and the live outcome job (one definition each).
 *
 * Abandoned checkout (agreed definition): a started checkout that ended unpaid because its seat HOLD
 * EXPIRED, with no failed payment attempt, and no purchase of that event by the customer within the outcome
 * window after the checkout started.
 *   1     hold expired, no payment attempt failed, nothing bought in the window
 *   0     this checkout was paid, or the customer bought the event in another checkout within the window
 *   null  not an abandonment question: cancelled by the customer, superseded by a new checkout, event
 *         cancelled, a payment attempt failed, still open / window not over, or no recorded end reason
 */
export const ABANDON_OUTCOME_WINDOW_MS = 24 * 3600_000;

/**
 * order: { status, createdAt, paid: boolean (this checkout paid) }, endReason: CHECKOUT_ENDED reason or null,
 * paymentFailed: boolean, boughtInWindow: boolean (another paid order of the event within the window),
 * now: Date. Returns { label, reason }.
 */
export function checkoutAbandonmentLabel({ order, endReason, paymentFailed, boughtInWindow, now }) {
  if (order.paid) return { label: 0, reason: 'paid' };
  if (order.createdAt.getTime() + ABANDON_OUTCOME_WINDOW_MS > now.getTime()) return { label: null, reason: 'outcome window not over' };
  if (paymentFailed) return { label: null, reason: 'payment attempt failed (not abandonment)' };
  if (!endReason) return { label: null, reason: order.status === 'PENDING' ? 'checkout still open' : 'no recorded end reason' };
  if (endReason !== 'HOLD_EXPIRED') return { label: null, reason: `ended: ${endReason.toLowerCase().replace('_', ' ')} (not abandonment)` };
  return boughtInWindow ? { label: 0, reason: 'bought in another checkout within the window' } : { label: 1, reason: 'hold expired, nothing bought' };
}

/** Post-publication demand: tickets sold in the 24 hours after the snapshot. */
export const DEMAND_HOURLY_HORIZON_MS = 24 * 3600_000;
/** Recommendation attribution: a purchase of a recommended event within this window after the impression. */
export const REC_ATTRIBUTION_MS = 7 * 24 * 3600_000;
/** Clicks count within this window after the impression. */
export const REC_CLICK_WINDOW_MS = 24 * 3600_000;
/** A check-in this long after the start counts as late (reported separately). */
export const LATE_CHECKIN_MS = 60 * 60_000;
