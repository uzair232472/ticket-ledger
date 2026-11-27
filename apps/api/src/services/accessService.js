import { memberContext, scopedEventIds } from './orgAccess.js';

/**
 * Event IDs a user may operate on with `permission` (gate scanning by default). null = no restriction
 * (Super Admin), [] = none. Comes from the user's ACTIVE organization membership: event-scoped roles (Gate Staff,
 * Staff, Event Managers) get their assigned events, other roles every event of their organization.
 */
export const getScopedEventIds = (user, permission = 'gate.scan') => scopedEventIds(user, permission);

/**
 * The organization a user is an ACTIVE member of and holds `permission` in (or null). Organization scope is
 * always taken from the membership, never from a companyId sent by the client.
 */
export const getMemberCompanyId = async (user, permission) => {
  const ctx = await memberContext(user);
  if (!ctx || (permission && !ctx.permissions.has(permission))) return null;
  return ctx.companyId;
};
