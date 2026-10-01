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
