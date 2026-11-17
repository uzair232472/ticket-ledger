/*
 * Organization permissions on the client. Only decides what to show: the API enforces every rule itself.
 * user.organization comes from /auth/me: { role, memberStatus, permissions, eventScoped, ... } or null.
 */
export const isSuperAdmin = (user) => user?.role === 'SUPER_ADMIN';

/** An ACTIVE organization membership, or null. */
export const activeOrg = (user) => (user?.organization?.memberStatus === 'ACTIVE' ? user.organization : null);

/** Whether the user may use `permission` (any of a list) in their organization. Super Admins may. */
export function can(user, permission) {
  if (isSuperAdmin(user)) return true;
  const org = activeOrg(user);
  if (!org) return false;
  return [permission].flat().some((p) => org.permissions.includes(p));
}

/** Whether the user may use every permission listed. */
export const canAll = (user, permissions) => isSuperAdmin(user) || [permissions].flat().every((p) => can(user, p));

export const ROLE_LABELS = {
  OWNER: 'Owner',
  ADMIN: 'Organization Admin',
  EVENT_MANAGER: 'Event Manager',
  FINANCE_MANAGER: 'Finance Manager',
  STAFF: 'Staff',
  GATE_STAFF: 'Gate Staff',
};

// Any of these opens the Organization page (profile, documents, payouts, branches); each tab checks its own
export const ORG_PAGE_PERMISSIONS = ['event.view', 'staff.view', 'finance.view', 'org.settings', 'org.documents'];
