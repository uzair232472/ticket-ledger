import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  ShieldCheck, 
  User, 
  Wallet, 
  Building2, 
  Scan, 
  Ticket, 
  Key, 
  AlertCircle, 
  CheckCircle2, 
  Lock,
  Layers,
  Sparkles
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function Dashboard() {
  const { user, isAuthenticated, token } = useAuth();
  const [roleTestResult, setRoleTestResult] = useState(null);
  const [testingRole, setTestingRole] = useState(false);

  // Test role permission against backend
  const testRoleEndpoint = async (roleEndpoint) => {
    setTestingRole(true);
    setRoleTestResult(null);

    try {
      const res = await fetch(`${API_URL}/api/auth/role-test/${roleEndpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRoleTestResult({
        endpoint: `/api/auth/role-test/${roleEndpoint}`,
        status: res.status,
        success: res.ok,
        message: data.message,
      });
    } catch (err) {
      setRoleTestResult({
        endpoint: `/api/auth/role-test/${roleEndpoint}`,
        status: 500,
        success: false,
        message: err.message,
      });
    } finally {
      setTestingRole(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      {isAuthenticated ? (
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 p-6 sm:p-8 border border-slate-800 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs uppercase px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {user.role}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                  user.status === 'ACTIVE' 
                    ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' 
                    : user.status === 'FROZEN'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}>
                  Status: {user.status}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
                Welcome back, {user.name}!
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                Logged in as <span className="text-slate-200 font-mono">{user.email}</span>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs flex flex-col justify-between">
              <div>
                <div className="text-slate-400 mb-1 flex items-center gap-1.5 font-medium">
                  <Wallet className="w-3.5 h-3.5 text-emerald-400" /> Linked Web3 Wallet
                </div>
                {user.walletAddress ? (
                  <div className="font-mono text-emerald-400 text-[11px] truncate max-w-[200px]" title={user.walletAddress}>
                    {user.walletAddress}
                  </div>
                ) : (
                  <div className="text-amber-400 text-[11px] flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Not Connected
                  </div>
                )}
              </div>
              <Link
                to="/profile"
                className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold"
              >
                Manage Profile & Wallet →
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/30 p-8 border border-slate-800 text-center shadow-xl">
          <h1 className="text-3xl font-extrabold text-white mb-2">
            TicketLedger Authentication & Role-Based Access
          </h1>
          <p className="text-slate-400 text-sm max-w-2xl mx-auto mb-6">
            Module 2 delivers JWT authentication, OTP-ready login, 4 user roles (Customer, Organizer, Gate Staff, Super Admin), and account lifecycle states.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-600/20"
            >
              Sign In (with Demo Roles)
            </Link>
            <Link
              to="/signup"
              className="px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition border border-slate-700"
            >
              Create Account
            </Link>
          </div>
        </div>
      )}

      {/* Role-Based Portals Overview */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5 text-emerald-400" /> Role-Based Navigation Modules
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Customer Portal */}
          <div className={`p-5 rounded-xl border transition ${
            user?.role === 'CUSTOMER' ? 'bg-slate-900 border-emerald-500/50 shadow-lg' : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 w-fit mb-3">
              <Ticket className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-sm mb-1">Customer Portal</h3>
            <p className="text-xs text-slate-400 mb-4">
              Browse cricket/concerts, select seats, pay, and store NFT tickets with dynamic QR.
            </p>
            <span className="text-[11px] font-medium text-emerald-400">
              {user?.role === 'CUSTOMER' ? '✓ Your Active Role' : 'Role: CUSTOMER'}
            </span>
          </div>

          {/* Organizer Portal */}
          <div className={`p-5 rounded-xl border transition ${
            user?.role === 'ORGANIZER' ? 'bg-slate-900 border-emerald-500/50 shadow-lg' : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="p-2.5 rounded-lg bg-teal-500/10 text-teal-400 w-fit mb-3">
              <Building2 className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-sm mb-1">Organizer Portal</h3>
            <p className="text-xs text-slate-400 mb-4">
              Submit company NTN verification, create matches, and view AI demand forecasts.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-teal-400">
                {user?.role === 'ORGANIZER' ? '✓ Your Active Role' : 'Role: ORGANIZER'}
              </span>
              <Link to="/company" className="text-[11px] text-teal-400 hover:underline font-semibold">
                Manage Company →
              </Link>
            </div>
          </div>

          {/* Gate Staff Portal */}
          <div className={`p-5 rounded-xl border transition ${
            user?.role === 'GATE_STAFF' ? 'bg-slate-900 border-emerald-500/50 shadow-lg' : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400 w-fit mb-3">
              <Scan className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-sm mb-1">Gate Staff Portal</h3>
            <p className="text-xs text-slate-400 mb-4">
              High-speed camera scanner, dual DB & Polygon validation, green/yellow/red screens.
            </p>
            <span className="text-[11px] font-medium text-purple-400">
              {user?.role === 'GATE_STAFF' ? '✓ Your Active Role' : 'Role: GATE_STAFF'}
            </span>
          </div>

          {/* Super Admin Portal */}
          <div className={`p-5 rounded-xl border transition ${
            user?.role === 'SUPER_ADMIN' ? 'bg-slate-900 border-emerald-500/50 shadow-lg' : 'bg-slate-900/60 border-slate-800'
          }`}>
            <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-400 w-fit mb-3">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-sm mb-1">Super Admin Portal</h3>
            <p className="text-xs text-slate-400 mb-4">
              Approve/reject organizers, freeze fraud accounts, review gate scans and ML fraud alerts.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-rose-400">
                {user?.role === 'SUPER_ADMIN' ? '✓ Your Active Role' : 'Role: SUPER_ADMIN'}
              </span>
              <Link to="/admin/companies" className="text-[11px] text-rose-400 hover:underline font-semibold">
                Review Approvals →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Live Role-Guard Authorization Verifier */}
      {isAuthenticated && (
        <div className="p-6 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-base">Live Backend Role Guard Verifier</h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Click these buttons to test the backend <code className="text-emerald-400 font-mono">requireRole()</code> middleware with your current JWT:
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => testRoleEndpoint('admin')}
              disabled={testingRole}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Test Super Admin Route (/role-test/admin)
            </button>
            <button
              onClick={() => testRoleEndpoint('organizer')}
              disabled={testingRole}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Test Organizer Route (/role-test/organizer)
            </button>
            <button
              onClick={() => testRoleEndpoint('staff')}
              disabled={testingRole}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Test Gate Staff Route (/role-test/staff)
            </button>
            <button
              onClick={() => testRoleEndpoint('customer')}
              disabled={testingRole}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Test Customer Route (/role-test/customer)
            </button>
          </div>

          {roleTestResult && (
            <div className={`p-4 rounded-lg border text-xs font-mono ${
              roleTestResult.success 
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300' 
                : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
            }`}>
              <div className="font-bold mb-1 flex items-center gap-1.5">
                {roleTestResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                Response: HTTP {roleTestResult.status} {roleTestResult.success ? 'GRANTED' : 'FORBIDDEN'}
              </div>
              <div>Endpoint: {roleTestResult.endpoint}</div>
              <div>Message: {roleTestResult.message}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
