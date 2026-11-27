import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, User, ScanLine, CalendarDays, RefreshCw, Building2, BadgeCheck } from 'lucide-react';
import AuthShell, { Alert, Field, SubmitButton } from '../components/auth/AuthShell';
import { getHomeRoute } from '../lib/session';
import { validateName, validatePassword, PASSWORD_HINT } from '../lib/validation';

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { getInvite, acceptInvite, rejectInvite, user, logout } = useAuth();
  const [declined, setDeclined] = useState(false);

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

  const isGate = invite?.role === 'GATE_STAFF' || (!invite?.role && invite);
  const heading = isGate ? 'Gate staff invite' : 'Team invite';

  const accept = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await acceptInvite(token);
      navigate(getHomeRoute(data.user), { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.status === 410) setInvite(null);
    } finally {
      setLoading(false);
    }
  };

  const decline = async () => {
    setError('');
    try {
      await rejectInvite(token);
      setDeclined(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (checking) {
    return (
      <AuthShell title={heading} subtitle="Checking your invite link...">
        <RefreshCw className="w-6 h-6 animate-spin text-[#16a34a] mx-auto" />
      </AuthShell>
    );
  }

  if (declined) {
    return (
      <AuthShell title="Invitation declined">
        <p className="text-xs text-slate-600">You declined the invitation. The link no longer works.</p>
        <Link to="/" className="text-xs text-[#16a34a] hover:underline font-bold">Go to TicketLedger →</Link>
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

  const summary = (
    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
      <div className="flex items-center gap-2 font-bold text-slate-900">
        <Building2 className="w-4 h-4 text-[#16a34a]" /> {invite.companyName}
      </div>
      <div className="flex items-center gap-2">
        <BadgeCheck className="w-3.5 h-3.5 text-[#16a34a]" /> {invite.roleLabel || 'Gate Staff'}{invite.invitedBy ? ` · invited by ${invite.invitedBy}` : ''}
      </div>
      {(invite.events || []).map((ev) => (
        <div key={ev.id} className="flex items-center gap-2 text-slate-500">
          {isGate ? <ScanLine className="w-3.5 h-3.5" /> : <CalendarDays className="w-3.5 h-3.5" />}
          {ev.name} · {new Date(ev.date).toLocaleDateString(undefined, { dateStyle: 'medium' })} · {ev.venue}
        </div>
      ))}
    </div>
  );
  const declineButton = (
    <button type="button" onClick={decline} className="w-full text-xs py-2 text-slate-500 hover:text-rose-600 font-bold">
      Decline invitation
    </button>
  );

  // Someone else is signed in on this device: the invitation belongs to another email address
  if (user && user.email !== invite.email) {
    return (
      <AuthShell title={heading} subtitle={`This invite is for ${invite.email}.`}>
        <p className="text-xs text-slate-600">
          You're signed in as <strong>{user.email}</strong>. Sign out, then sign in or create the account with the invited email.
        </p>
        <button type="button" onClick={logout} className="w-full btn-eventfrog text-xs py-3">
          Sign out and continue
        </button>
      </AuthShell>
    );
  }

  // Signed in with the invited email: join with this account
  if (user) {
    return (
      <AuthShell title={`Join ${invite.companyName}`} subtitle="Accept to join with your TicketLedger account. Your tickets and bookings stay as they are.">
        {summary}
        <Alert>{error}</Alert>
        <button type="button" disabled={loading} onClick={accept} className="w-full btn-eventfrog text-xs py-3">
          {loading ? 'Joining…' : 'Accept invitation'}
        </button>
        {declineButton}
      </AuthShell>
    );
  }

  // An account already uses this email: sign in to accept
  if (invite.existingAccount) {
    return (
      <AuthShell title={`Join ${invite.companyName}`} subtitle={`Sign in as ${invite.email} to accept this invitation.`}>
        {summary}
        <Alert>{error}</Alert>
        <Link to="/login" state={{ from: location.pathname }} className="block text-center w-full btn-eventfrog text-xs py-3">
          Sign in to accept
        </Link>
        {declineButton}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={isGate ? 'Join the gate team' : `Join ${invite.companyName}`}
      subtitle={isGate ? `${invite.companyName} invited you to scan tickets.` : `${invite.companyName} invited you as ${invite.roleLabel}.`}
      footer={<>Already set up? <Link to="/login" state={{ from: location.pathname }} className="text-[#16a34a] hover:underline font-bold ml-1">Sign in →</Link></>}
    >
      {summary}

      <Alert>{error}</Alert>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Email Address" icon={Mail} type="email" value={invite.email} disabled readOnly />
        <Field label="Full Name" icon={User} name="name" autoComplete="name" value={form.name} onChange={update} error={fieldErrors.name} />
        <Field label="Password" icon={Lock} type="password" name="password" autoComplete="new-password" value={form.password} onChange={update} placeholder={PASSWORD_HINT} error={fieldErrors.password} />
        <Field label="Confirm Password" icon={Lock} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={update} error={fieldErrors.confirmPassword} />
        <SubmitButton loading={loading} loadingText="Creating account...">
          <span>Accept Invite</span>
        </SubmitButton>
      </form>
      {declineButton}
    </AuthShell>
  );
}
