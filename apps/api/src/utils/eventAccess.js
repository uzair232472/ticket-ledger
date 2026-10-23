import prisma from '../config/prisma.js';

/**
 * The owning organizer's company or a Super Admin may manage an event (same rule as status/pricing).
 * Changing attendee-facing content additionally needs the organizer's company to still be APPROVED.
 */
export async function canManageEvent(user, event, { requireApproved = false } = {}) {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const company = await prisma.company.findUnique({ where: { userId: user.id } });
  if (!company || company.id !== event.companyId) return false;
  return !requireApproved || company.status === 'APPROVED';
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
