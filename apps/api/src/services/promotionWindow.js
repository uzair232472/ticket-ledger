/*
 * Promotion time windows. Each promotion (`priority` = top of listings, `hero` = home page hero) runs
 * from {kind}StartsAt to {kind}EndsAt, set by an admin on approval; the organizer suggests a length in
 * {kind}Days. A promotion shows while now is inside its window, whatever the request status says, so a
 * renewal request (status REQUESTED) leaves the running window in place until the admin decides.
 * Promotions approved before windows existed have no end and stay on until stopped.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PROMOTION_DAYS = 7;
export const MAX_PROMOTION_DAYS = 90;

export function isPromotionActive(event, kind, now = new Date()) {
  const starts = event[`${kind}StartsAt`];
  const ends = event[`${kind}EndsAt`];
  if (ends) return (!starts || new Date(starts) <= now) && new Date(ends) > now;
  return event[`${kind}Status`] === 'APPROVED';
}

/** Prisma filter for events whose `kind` promotion is showing now. */
export const activePromotionWhere = (kind, now = new Date()) => ({
  OR: [
    { [`${kind}StartsAt`]: { lte: now }, [`${kind}EndsAt`]: { gt: now } },
    { [`${kind}Status`]: 'APPROVED', [`${kind}EndsAt`]: null },
  ],
});

/** When the running promotion started: the latest start is listed first. */
export const promotionStartedAt = (event, kind) =>
  new Date(event[`${kind}StartsAt`] || event.promotionReviewedAt || event.createdAt || 0).getTime();
