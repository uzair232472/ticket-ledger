/*
 * Admin permissions. Every Super Admin has an admin role (null = OWNER, so admins created before roles existed
 * keep full access) plus optional extra permissions. Routes check one permission with requireAdmin(); the
 * console hides what an admin can't use.
 */

export const ADMIN_PERMISSIONS = {
  'admin.view': 'Dashboards, transactions and logs (read only)',
  'admin.users': 'Change user accounts (suspend, ban, reactivate)',
  'admin.approvals': 'Approve organizers, events, promotions and schedule changes',
  'admin.finance': 'Payouts, refunds, payout-detail checks and the finance overview',
  'admin.support': 'Work the support desk',
  'admin.fraud': 'Fraud watchlist and account investigations',
  'admin.orgs': "Open organizations' teams and settings",
  'admin.notify': 'Send platform-wide notifications',
  'admin.export': 'Export data',
  'admin.config': 'Change system settings',
  'admin.admins': 'Manage admins and their permissions',
};
export const ALL_ADMIN = Object.keys(ADMIN_PERMISSIONS);

export const ADMIN_ROLES = {
  OWNER: { label: 'Owner', permissions: ALL_ADMIN },
  FINANCE: { label: 'Finance', permissions: ['admin.view', 'admin.finance', 'admin.export'] },
  SUPPORT: { label: 'Support', permissions: ['admin.view', 'admin.support', 'admin.users', 'admin.orgs'] },
  MODERATOR: { label: 'Moderator', permissions: ['admin.view', 'admin.approvals', 'admin.fraud', 'admin.users', 'admin.orgs'] },
  ANALYST: { label: 'Analyst', permissions: ['admin.view', 'admin.export'] },
};

/** The admin permissions of a user (empty for anyone who isn't a Super Admin). */
export function adminPermissionsOf(user) {
  if (user?.role !== 'SUPER_ADMIN') return new Set();
  const role = ADMIN_ROLES[user.adminRole || 'OWNER'] || ADMIN_ROLES.OWNER;
  return new Set([...role.permissions, ...(user.adminPermissions || []).filter((p) => ADMIN_PERMISSIONS[p])]);
}
export const hasAdmin = (user, permission) => adminPermissionsOf(user).has(permission);

/** Route guard: a Super Admin holding `permission` (after authenticateJWT). */
export const requireAdmin = (permission) => (req, res, next) => {
  if (req.user?.role !== 'SUPER_ADMIN') return res.status(403).json({ success: false, message: 'Admins only.' });
  if (!hasAdmin(req.user, permission)) return res.status(403).json({ success: false, code: 'MISSING_ADMIN_PERMISSION', missing: [permission], message: `Your admin role doesn't include this (${permission}).` });
  return next();
};
