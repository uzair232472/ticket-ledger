import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert } from 'lucide-react';
import { activeOrg, can } from '../lib/permissions';

/**
 * Route guard. The API enforces the same rules; this only keeps users out of screens they can't use.
 * - allowedRoles: roles that may open the route
 * - permission: organization permission(s); members of any account type who hold one may open the route
 * - requireApprovedCompany: organizers whose company is not APPROVED are sent to the company status screen
 */
export default function ProtectedRoute({ children, allowedRoles, permission, requireApprovedCompany = false }) {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Organizer screens are opened by organization permission (members of any account type). An organizer account
  // with no organization yet passes, so requireApprovedCompany can send it to company registration.
  const roleListed = Boolean(allowedRoles?.includes(user.role));
  const byRole = permission
    ? user.role === 'SUPER_ADMIN' ? roleListed : roleListed && user.role === 'ORGANIZER' && !activeOrg(user)
    : roleListed;
  const byPermission = Boolean(permission) && user.role !== 'SUPER_ADMIN' && can(user, permission);
  if ((allowedRoles || permission) && !byRole && !byPermission) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-slate-900 border border-rose-900/50 rounded-xl text-center">
        <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 mx-auto flex items-center justify-center mb-4">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Access Denied (403 Forbidden)</h2>
        <p className="text-sm text-slate-400 mb-6">
          Your account role (<span className="text-emerald-400 font-mono font-semibold">{user.role}</span>) does not have permission to view this section.
        </p>
        <p className="text-xs text-slate-500">
          {permission ? `Ask an organization admin for: ${[permission].flat().join(' or ')}` : `Required roles: ${(allowedRoles || []).join(', ')}`}
        </p>
      </div>
    );
  }

  if (requireApprovedCompany && user.role !== 'SUPER_ADMIN' && user.companyStatus !== 'APPROVED') {
    // Organizers register or follow their company; members of a company that isn't approved wait for it
    if (user.role === 'ORGANIZER' && !activeOrg(user)) return <Navigate to="/company" replace />;
    if (user.role === 'ORGANIZER' && activeOrg(user)?.role === 'OWNER') return <Navigate to="/company" replace />;
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-slate-200 rounded-xl text-center text-sm text-slate-600">
        {user.companyName || 'Your organization'} isn’t approved by TicketLedger yet, so this screen isn’t available.
      </div>
    );
  }

  return children;
}
