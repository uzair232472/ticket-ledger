import prisma from '../config/prisma.js';

/**
 * Profile completeness. Organizers and gate staff need every profile field, including a profile picture,
 * before they can ask TicketLedger for an approval (organization, event, launch, prebooked dates).
 * Customers' profiles are optional; the app only suggests completing them.
 */
export const PROFILE_FIELDS = [
  { key: 'avatarUrl', label: 'Profile picture', ok: (u) => Boolean(u.avatarUrl) },
  { key: 'salutation', label: 'Salutation', ok: (u) => Boolean(u.salutation?.trim()) },
  { key: 'name', label: 'First and last name', ok: (u) => (u.name || '').trim().split(/\s+/).filter(Boolean).length >= 2 },
  { key: 'phone', label: 'Phone number', ok: (u) => (u.phone || '').replace(/\D/g, '').length >= 10 },
  { key: 'city', label: 'City', ok: (u) => Boolean(u.city?.trim()) },
];

// Roles whose profile must be complete before an approval request
export const STRICT_ROLES = new Set(['ORGANIZER', 'GATE_STAFF']);

export const profileStatus = (user) => {
  const missing = PROFILE_FIELDS.filter((f) => !f.ok(user || {}));
  return {
    complete: missing.length === 0,
    required: STRICT_ROLES.has(user?.role),
    missing: missing.map((f) => ({ key: f.key, label: f.label })),
  };
};

const PROFILE_SELECT = { id: true, role: true, name: true, phone: true, city: true, salutation: true, avatarUrl: true };
export const loadProfileStatus = async (userId) => profileStatus(await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT }));

/**
 * Route guard for approval requests: organizers and gate staff with an incomplete profile get 403
 * PROFILE_INCOMPLETE and the list of what is missing. Customers and platform admins pass.
 */
export const requireCompleteProfile = async (req, res, next) => {
  try {
    if (!req.user || !STRICT_ROLES.has(req.user.role)) return next();
    const status = await loadProfileStatus(req.user.id);
    if (status.complete) return next();
    return res.status(403).json({
      success: false,
      code: 'PROFILE_INCOMPLETE',
      message: `Complete your profile before requesting approval. Missing: ${status.missing.map((m) => m.label.toLowerCase()).join(', ')}.`,
      missing: status.missing,
    });
  } catch (err) {
    return next(err);
  }
};
