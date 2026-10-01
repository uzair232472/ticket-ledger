import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, Mail, KeyRound, RefreshCw } from 'lucide-react';
import AuthShell, { Alert, Field, OtpInput, SubmitButton } from '../components/auth/AuthShell';
import { validateEmail, validateOtp, validatePassword } from '../lib/validation';

const RESEND_SECONDS = 60;

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { resetPassword, resendOtp } = useAuth();

  const [email, setEmail] = useState(location.state?.email || new URLSearchParams(location.search).get('email') || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.notice || '');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(location.state?.email ? RESEND_SECONDS : 0);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = {
      email: validateEmail(email),
      code: validateOtp(code),
      password: validatePassword(password),
      confirmPassword: password === confirmPassword ? null : 'Passwords do not match',
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setError('');
    setLoading(true);
    try {
      const data = await resetPassword(email.trim(), code, password);
      navigate('/login', { replace: true, state: { email: email.trim(), notice: data.message } });
    } catch (err) {
      if (err.code === 'ACCOUNT_SUSPENDED') {
        navigate('/suspended');
        return;
      }
      setError(err.message);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (validateEmail(email)) {
      setFieldErrors({ email: validateEmail(email) });
      return;
    }
    setError('');
    setResending(true);
    try {
      const data = await resendOtp(email.trim(), 'RESET_PASSWORD');
      setNotice(data.message);
      setCountdown(RESEND_SECONDS);
    } catch (err) {
      setError(err.message);
      if (err.data?.retryAfter) setCountdown(err.data.retryAfter);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the code from your email and choose a new password."
      footer={
        <Link to="/login" className="text-[#16a34a] hover:underline font-bold">
          ← Back to sign in
        </Link>
      }
    >
      <Alert tone="notice">{!error && notice}</Alert>
      <Alert>{error}</Alert>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field
          label="Email Address"
          icon={Mail}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <div>
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-1.5">
            <KeyRound className="w-3.5 h-3.5 text-slate-400" /> Reset code
          </span>
          <OtpInput value={code} onChange={setCode} disabled={loading} />
          {fieldErrors.code && <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.code}</p>}
        </div>
        <Field label="New Password" icon={Lock} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ chars, letter & number" error={fieldErrors.password} />
        <Field label="Confirm New Password" icon={Lock} type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} error={fieldErrors.confirmPassword} />

        <SubmitButton loading={loading} loadingText="Saving...">
          <span>Set New Password</span>
        </SubmitButton>
      </form>

      <div className="text-center text-xs text-slate-500">
        Need a new code?{' '}
        <button
          type="button"
          onClick={handleResend}
          disabled={countdown > 0 || resending}
          className="font-bold text-[#16a34a] hover:underline disabled:text-slate-400 disabled:no-underline inline-flex items-center gap-1"
        >
          {resending && <RefreshCw className="w-3 h-3 animate-spin" />}
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
        </button>
      </div>
    </AuthShell>
  );
}
