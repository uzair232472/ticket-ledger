import { canAccessEvent } from '../services/orgAccess.js';

/**
 * Super Admins, or active members of the event's organization holding `permission` (event.edit unless
 * stated) who, for event-scoped roles, are assigned to the event. `requireApproved` also needs the
 * organization to still be APPROVED (changes attendees can see).
 */
export function canManageEvent(user, event, { requireApproved = false, permission = 'event.edit', req = null } = {}) {
  return canAccessEvent(user, event, { requireApproved, permission, req });
}

/**
 * Waiting for an admin's decision (a first review, or a prebooked date's final approval). The organizer can't
 * change the event meanwhile, so the admin approves exactly what they reviewed. Editing opens again when the
 * admin asks for changes, decides, or the organizer withdraws the request.
 */
export function underAdminReview(event) {
  return (event.status === 'PENDING_APPROVAL' && event.reviewRequest !== 'CHANGES_REQUESTED') || event.launchStatus === 'PENDING';
}
export const REVIEW_LOCK_MESSAGE =
  'This event is waiting for a TicketLedger admin, so it can’t be changed right now. Withdraw it from review on the Review page to make changes, then send it again.';
/** Organizers are locked out during review; Super Admins aren't. */
export const reviewLocked = (user, event) => user?.role !== 'SUPER_ADMIN' && underAdminReview(event);
