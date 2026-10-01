import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, User, ScanLine, CalendarDays, RefreshCw } from 'lucide-react';
import AuthShell, { Alert, Field, SubmitButton } from '../components/auth/AuthShell';
import { getHomeRoute } from '../lib/session';
import { validateName, validatePassword } from '../lib/validation';

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { getInvite, acceptInvite, user, logout } = useAuth();

  const [invite, setInvite] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState({ name: '', password: '', confirmPassword: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getInvite(token)
      .then((data) => setInvite(data.data))
      .catch((err) => setLookupError(err.message))
      .finally(() => setChecking(false));
  }, [token]);

  const update = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setFieldErrors((prev) => ({ ...prev, [e.target.name]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = {
      name: validateName(form.name),
      password: validatePassword(form.password),
      confirmPassword: form.password === form.confirmPassword ? null : 'Passwords do not match',
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setError('');
    setLoading(true);
    try {
      const data = await acceptInvite(token, form.name.trim(), form.password);
      navigate(getHomeRoute(data.user), { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.status === 410) setInvite(null);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <AuthShell title="Gate staff invite" subtitle="Checking your invite link...">
        <RefreshCw className="w-6 h-6 animate-spin text-[#16a34a] mx-auto" />
      </AuthShell>
    );
  }

  if (!invite) {
    return (
      <AuthShell title="Invite unavailable">
        <Alert>{error || lookupError || 'This invite link is no longer valid. Ask the organizer to send a new one.'}</Alert>
        <Link to="/login" className="text-xs text-[#16a34a] hover:underline font-bold">Go to sign in →</Link>
      </AuthShell>
    );
  }

  // Someone else is signed in on this device: the invite would create a separate account
  if (user && user.email !== invite.email) {
    return (
      <AuthShell title="Gate staff invite" subtitle={`This invite is for ${invite.email}.`}>
        <p className="text-xs text-slate-600">
          You're signed in as <strong>{user.email}</strong>. Sign out to accept the invite with the invited email.
        </p>
        <button type="button" onClick={logout} className="w-full btn-eventfrog text-xs py-3">
          Sign out and continue
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Join the gate team"
      subtitle={`${invite.companyName} invited you to scan tickets.`}
      footer={<>Already set up? <Link to="/login" className="text-[#16a34a] hover:underline font-bold ml-1">Sign in →</Link></>}
    >
      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <ScanLine className="w-4 h-4 text-[#16a34a]" /> {invite.eventName}
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <CalendarDays className="w-3.5 h-3.5" />
          {new Date(invite.eventDate).toLocaleDateString(undefined, { dateStyle: 'medium' })} · {invite.venue}
        </div>
      </div>

      <Alert>{error}</Alert>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Email Address" icon={Mail} type="email" value={invite.email} disabled readOnly />
        <Field label="Full Name" icon={User} name="name" autoComplete="name" value={form.name} onChange={update} error={fieldErrors.name} />
        <Field label="Password" icon={Lock} type="password" name="password" autoComplete="new-password" value={form.password} onChange={update} placeholder="8+ chars, letter & number" error={fieldErrors.password} />
        <Field label="Confirm Password" icon={Lock} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={update} error={fieldErrors.confirmPassword} />
        <SubmitButton loading={loading} loadingText="Creating account...">
          <span>Accept Invite</span>
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
