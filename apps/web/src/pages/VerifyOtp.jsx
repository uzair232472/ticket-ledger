import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CheckCircle2, RefreshCw, Clock } from 'lucide-react';
import AuthShell, { Alert, OtpInput, SubmitButton } from '../components/auth/AuthShell';
import { getHomeRoute } from '../lib/session';
import { validateOtp } from '../lib/validation';

const formatClock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export default function VerifyOtp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyOtp, resendOtp, getPendingSignup } = useAuth();

  const fallbackEmail = location.state?.email || new URLSearchParams(location.search).get('email') || sessionStorage.getItem('tl_pending_email') || '';

  const [email, setEmail] = useState(fallbackEmail);
  // OTP timing comes from the server so a refresh or revisit never restarts it.
  // clockOffset corrects for a difference between the browser clock and the server clock.
  const [timing, setTiming] = useState(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [loadingTiming, setLoadingTiming] = useState(true);

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.notice || '');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // Used only when there is no pending-signup session to read the cooldown from
  const [fallbackRetryAt, setFallbackRetryAt] = useState(0);

  const loadTiming = useCallback(async () => {
    try {
      const { data } = await getPendingSignup();
      setEmail(data.email);
      sessionStorage.setItem('tl_pending_email', data.email);
      setClockOffset(Date.parse(data.serverTime) - Date.now());
      setTiming({
        otpExpiresAt: data.otpExpiresAt ? Date.parse(data.otpExpiresAt) : null,
        resendAvailableAt: Date.parse(data.resendAvailableAt),
      });
    } catch {
      // No pending-signup session in this browser: verification by email + code still works
      setTiming(null);
    } finally {
      setLoadingTiming(false);
    }
  }, [getPendingSignup]);

  // Load once on mount; getPendingSignup is recreated on every AuthProvider render
  useEffect(() => {
    loadTiming();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const serverNow = now + clockOffset;
  const expiresInMs = timing?.otpExpiresAt ? timing.otpExpiresAt - serverNow : null;
  const expired = expiresInMs !== null && expiresInMs <= 0;
  const resendInMs = timing ? timing.resendAvailableAt - serverNow : fallbackRetryAt - now;
  const resendSeconds = Math.max(0, Math.ceil(resendInMs / 1000));

  const handleVerify = async (e) => {
    e.preventDefault();
    const invalid = validateOtp(code);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const data = await verifyOtp(email, code);
      sessionStorage.removeItem('tl_pending_email');
      navigate(getHomeRoute(data.user), { replace: true });
    } catch (err) {
      if (err.code === 'ACCOUNT_SUSPENDED') {
        navigate('/suspended');
        return;
      }
      setError(err.message);
      setCode('');
      // A locked code is reported as expired by the server
      if (timing) loadTiming();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setNotice('');
    setResending(true);
    try {
      await resendOtp(email, 'VERIFY_EMAIL');
      setNotice(`A new code was sent to ${email}. Older codes no longer work.`);
      setCode('');
      if (!timing) setFallbackRetryAt(Date.now() + 60 * 1000);
    } catch (err) {
      setError(err.message);
      if (!timing && err.data?.retryAfter) setFallbackRetryAt(Date.now() + err.data.retryAfter * 1000);
    } finally {
      // Countdowns only move when the server says a new code exists
      if (timing) await loadTiming();
      setResending(false);
    }
  };

  if (!email && !loadingTiming) {
    return (
      <AuthShell title="Verify your email" subtitle="We couldn't tell which email to verify.">
        <p className="text-xs text-slate-600">
          Sign in with your email and password and we'll send you a fresh code, or create a new account.
        </p>
        <div className="flex gap-3 text-xs font-bold">
          <Link to="/login" className="text-[#16a34a] hover:underline">Sign in </Link>
          <Link to="/signup" className="text-[#16a34a] hover:underline">Create account </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Verify your email"
      subtitle={<>Enter the 6-digit code sent to <strong className="text-slate-800">{email}</strong>.</>}
      footer={
        <>
          Wrong email?{' '}
          {/* The signup form restores the details from the server-side pending signup */}
          <Link to="/signup" className="text-[#16a34a] hover:underline font-bold ml-1">
            Change email
          </Link>
        </>
      }
    >
      <Alert tone="notice">{!error && notice}</Alert>
      <Alert>{error}</Alert>

      {expiresInMs !== null && (
        <div
          role="timer"
          aria-live="off"
          className={`flex items-center justify-center gap-1.5 text-xs font-semibold ${expired ? 'text-rose-600' : 'text-slate-600'}`}
        >
          <Clock className="w-3.5 h-3.5" />
          {expired ? 'Code expired' : <span>Code expires in <span className="font-mono">{formatClock(expiresInMs)}</span></span>}
        </div>
      )}

      <form onSubmit={handleVerify} className="space-y-5">
        <OtpInput value={code} onChange={setCode} disabled={loading || expired} />
        <SubmitButton loading={loading} loadingText="Verifying..." disabled={code.length !== 6 || expired}>
          <CheckCircle2 className="w-4 h-4" />
          <span>Verify Email</span>
        </SubmitButton>
      </form>

      <div className="text-center text-xs text-slate-500">
        {expired ? 'Request a new code to continue. ' : "Didn't get it? "}
        <button
          type="button"
          onClick={handleResend}
          disabled={resendSeconds > 0 || resending || loadingTiming}
          className="font-bold text-[#16a34a] hover:underline disabled:text-slate-400 disabled:no-underline inline-flex items-center gap-1"
        >
          {resending && <RefreshCw className="w-3 h-3 animate-spin" />}
          {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend code'}
        </button>
      </div>
    </AuthShell>
  );
}
