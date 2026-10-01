import prisma from '../config/prisma.js';

/**
 * Event IDs a user may operate on (gate scanning, gate stats, staff management).
 * Returns null for Super Admins (no restriction).
 *   ORGANIZER  -> events of the company they own
 *   GATE_STAFF -> events they are assigned to
 *   others     -> none
 */
export const getScopedEventIds = async (user) => {
  if (user.role === 'SUPER_ADMIN') return null;

  if (user.role === 'ORGANIZER') {
    const company = await prisma.company.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!company) return [];
    const events = await prisma.event.findMany({ where: { companyId: company.id }, select: { id: true } });
    return events.map((e) => e.id);
  }

  if (user.role === 'GATE_STAFF') {
    const assignments = await prisma.staffEventAssignment.findMany({
      where: { staffId: user.id },
      select: { eventId: true },
    });
    return assignments.map((a) => a.eventId);
  }

  return [];
};

/**
 * The company an organizer owns (or null). Organizer ownership is always checked against this,
 * never against a companyId sent by the client.
 */
export const getOwnedCompanyId = async (userId) => {
  const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
  return company?.id || null;
};
