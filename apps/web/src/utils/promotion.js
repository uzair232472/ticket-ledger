// Promotion time windows, same rules as the API (apps/api/src/services/promotionWindow.js): a promotion
// shows while now is inside its window; promotions approved before windows existed have no end.

export const PROMOTION_DAY_CHOICES = [3, 7, 14, 30];
export const DEFAULT_PROMOTION_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** kind: 'priority' (top of listings) or 'hero' (home page hero). */
export function isPromotionActive(event, kind, now = Date.now()) {
  const starts = event?.[`${kind}StartsAt`];
  const ends = event?.[`${kind}EndsAt`];
  if (ends) return (!starts || new Date(starts).getTime() <= now) && new Date(ends).getTime() > now;
  return event?.[`${kind}Status`] === 'APPROVED';
}

/** Scheduled to start later. */
export const isPromotionUpcoming = (event, kind, now = Date.now()) =>
  Boolean(event?.[`${kind}StartsAt`] && event?.[`${kind}EndsAt`]) && new Date(event[`${kind}StartsAt`]).getTime() > now;

export const formatPromoDay = (d) =>
  new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });

/** "3 days left", "Ends today". */
export function promoTimeLeft(endsAt, now = Date.now()) {
  const days = Math.ceil((new Date(endsAt).getTime() - now) / DAY_MS);
  if (days <= 1) return 'Ends within a day';
  return `${days} days left`;
}

/** yyyy-mm-dd in Pakistan time, for <input type="date">. */
export const toDateInput = (d) => new Date(new Date(d).getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
/** A picked day → that day's start (from) or end (until) in Pakistan time. */
export const fromDateInput = (value, endOfDay = false) => new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}+05:00`);
