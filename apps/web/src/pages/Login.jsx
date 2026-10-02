import React, { useState } from 'react';
import {
  useNavigate,
  Link,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Lock,
  Mail,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import AuthShell, {
  Alert,
  Field,
  SubmitButton,
} from '../components/auth/AuthShell';

const DEMO_ACCOUNTS = [
  { label: 'Customer', email: 'customer@ticketledger.pk' },
  { label: 'Organizer', email: 'organizer@ticketledger.pk' },
  { label: 'Gate Staff (Turnstile)', email: 'staff@ticketledger.pk' },
  { label: 'Super Admin', email: 'admin@ticketledger.pk' },
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, user, loading: authLoading } = useAuth();

  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [showExaminerPreset, setShowExaminerPreset] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Support both a string path and a React Router location object.
  const from = location.state?.from;
  const requestedPath =
    typeof from === 'string'
      ? from
      : from && typeof from.pathname === 'string'
        ? `${from.pathname}${from.search || ''}${from.hash || ''}`
        : null;

  // Allow internal paths only and avoid redirecting back to login.
  const safeFrom =
    requestedPath &&
      requestedPath.startsWith('/') &&
      !requestedPath.startsWith('//') &&
      !requestedPath.includes('\\') &&
      !/[\u0000-\u0020]/.test(requestedPath) &&
      !/^\/login\/?(?:[?#]|$)/i.test(requestedPath)
      ? requestedPath
      : null;

  const redirectTo = safeFrom || '/';

  if (!authLoading && user) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err.needsVerification) {
        const pendingEmail = err.data?.email || email.trim();

        sessionStorage.setItem('tl_pending_email', pendingEmail);

        navigate('/verify', {
          state: {
            email: pendingEmail,
            notice: err.message,
            from: redirectTo,
          },
        });
        return;
      }

      if (err.code === 'ACCOUNT_SUSPENDED') {
        navigate('/suspended');
        return;
      }

      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Sign In to TicketLedger"
      subtitle="Customers, organizers, gate staff and admins all sign in here"
      footer={
        <>
          Don't have an account yet?{' '}
          <Link
            to="/signup"
            className="text-[#16a34a] hover:underline font-bold ml-1"
          >
            Create account
          </Link>
        </>
      }
    >
      <Alert tone="notice">{location.state?.notice}</Alert>
      <Alert>{error}</Alert>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field
          label="Email Address"
          icon={Mail}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@gmail.com"
        />

        <div>
          <Field
            label="Password"
            icon={Lock}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          <div className="text-right mt-1.5">
            <Link
              to="/forgot-password"
              state={{ email }}
              className="text-[11px] font-semibold text-[#16a34a] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <SubmitButton
          loading={loading}
          loadingText="Signing in..."
          disabled={authLoading || !email.trim() || !password}
        >
          <span>Sign In</span>
        </SubmitButton>
      </form>

      {/* Demo accounts for the project examiners */}
      <div className="pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={() => setShowExaminerPreset((previous) => !previous)}
          aria-expanded={showExaminerPreset}
          className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-600 transition"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Sparkles className="w-3 h-3 text-[#22c55e]" />
            <span>FYP Examiner Demo Logins</span>
          </span>

          {showExaminerPreset ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>

        {showExaminerPreset && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => {
                  setEmail(acc.email);
                  setPassword('Password@123');
                  setError('');
                }}
                className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left transition"
              >
                <div className="font-bold text-slate-800">
                  {acc.label}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {acc.email}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AuthShell>
  );
}