import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert } from 'lucide-react';

/**
 * Route guard. The API enforces the same rules; this only keeps users out of screens they can't use.
 * - allowedRoles: roles that may open the route
 * - requireApprovedCompany: organizers whose company is not APPROVED are sent to the company status screen
 */
export default function ProtectedRoute({ children, allowedRoles, requireApprovedCompany = false }) {
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

  if (allowedRoles && !allowedRoles.includes(user.role)) {
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
          Required roles: {allowedRoles.join(', ')}
        </p>
      </div>
    );
  }

  if (requireApprovedCompany && user.role === 'ORGANIZER' && user.companyStatus !== 'APPROVED') {
    return <Navigate to="/company" replace />;
  }

  return children;
}
