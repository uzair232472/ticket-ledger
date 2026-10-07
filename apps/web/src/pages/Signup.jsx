import React, { useEffect, useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, User, Phone, Users, Building2, RefreshCw } from 'lucide-react';
import AuthShell, { Alert, Field, SubmitButton } from '../components/auth/AuthShell';
import { getHomeRoute } from '../lib/session';
import { validateName, validateEmail, validatePhone, validatePassword } from '../lib/validation';

const ACCOUNT_TYPES = [
  { id: 'customer', label: 'Customer', description: 'Buy and manage tickets', icon: Users },
  { id: 'organizer', label: 'Event Organizer', description: 'Host and sell events', icon: Building2 },
];

export default function Signup() {
  const navigate = useNavigate();
  const { signup, getPendingSignup, updatePendingSignup, user, loading: authLoading } = useAuth();

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    accountType: 'customer',
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Editing the unverified signup from this browser (e.g. after "Change email" on the code screen)
  const [editingPending, setEditingPending] = useState(false);
  const [restoring, setRestoring] = useState(true);

  // Restore name, email, phone and account type from the server-side pending signup. The password is never
  // stored anywhere; in edit mode it can be left blank to keep the one already chosen.
  useEffect(() => {
    let active = true;
    getPendingSignup()
      .then(({ data }) => {
        if (!active) return;
        setForm((prev) => ({ ...prev, name: data.name, email: data.email, phone: data.phone, accountType: data.accountType }));
        setEditingPending(true);
        setAcceptedTerms(true);
      })
      .catch(() => { })
      .finally(() => active && setRestoring(false));
    return () => {
      active = false;
    };
  }, []);

  if (!authLoading && user) return <Navigate to={getHomeRoute(user)} replace />;

  const update = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: null }));
  };

  const validate = () => {
    const errors = {
      name: validateName(form.name),
      email: validateEmail(form.email),
      phone: form.phone.trim() ? validatePhone(form.phone) : 'Enter your mobile number',
      password: editingPending && !form.password ? null : validatePassword(form.password),
      confirmPassword: form.password === form.confirmPassword ? null : 'Passwords do not match',
    };
    setFieldErrors(errors);
    return !Object.values(errors).some(Boolean);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    if (!acceptedTerms) {
      setError('Please accept the Terms of Service to continue.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        accountType: form.accountType,
      };
      const data = editingPending ? await updatePendingSignup(payload) : await signup(payload);
      const email = data.data?.email || form.email.trim().toLowerCase();
      sessionStorage.setItem('tl_pending_email', email);
      navigate('/verify', { state: { email, notice: data.message } });
    } catch (err) {
      if (err.code === 'NO_PENDING_SIGNUP') {
        // The pending signup expired or was verified elsewhere; continue as a fresh signup
        setEditingPending(false);
      }
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Join TicketLedger"
      title={editingPending ? 'Check your details' : 'Create your account'}
      subtitle={
        editingPending
          ? "Fix anything that's wrong. If you change your email we'll send a new code to the new address."
          : "We'll email you a 6-digit code to verify your address."
      }
      footer={
        <>
          Already registered?{' '}
          <Link to="/login">Sign in</Link>
        </>
      }
    >
      <Alert>{error}</Alert>

      {restoring ? (
        <div className="flex justify-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-[#16a34a]" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <fieldset className="tl-auth-types">
            <legend>Account type</legend>
            <div className="tl-auth-types-grid">
              {ACCOUNT_TYPES.map(({ id, label, description, icon: Icon }) => {
                const selected = form.accountType === id;
                return (
                  <label key={id} className={`tl-auth-type${selected ? ' is-selected' : ''}`}>
                    <input type="radio" name="accountType" value={id} checked={selected} onChange={update} className="sr-only" />
                    <Icon className="w-6 h-6" aria-hidden="true" />
                    <span className="tl-auth-type-text">
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <span className="tl-auth-radio" aria-hidden="true" />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Field label="Full name" icon={User} name="name" autoComplete="name" value={form.name} onChange={update} placeholder="Tariq Mehmood" error={fieldErrors.name} />
          <Field label="Email address" icon={Mail} type="email" name="email" autoComplete="email" value={form.email} onChange={update} placeholder="name@gmail.com" error={fieldErrors.email} />
          <Field label="Mobile number" icon={Phone} type="tel" name="phone" autoComplete="tel" inputMode="tel" required value={form.phone} onChange={update} placeholder="+92 300 1234567" error={fieldErrors.phone} />
          <div className="tl-auth-pair">
            <Field label="Password" hint={editingPending ? '(leave blank to keep)' : undefined} icon={Lock} type="password" name="password" autoComplete="new-password" value={form.password} onChange={update} placeholder="8+ chars, letter & number" error={fieldErrors.password} />
            <Field label="Confirm password" icon={Lock} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={update} placeholder="Repeat password" error={fieldErrors.confirmPassword} />
          </div>

          <label className="tl-auth-check">
            <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
            <span>
              I agree to the{' '}
              <Link to="/terms" target="_blank" rel="noopener">Terms of Service</Link>
              {' '}and{' '}
              <Link to="/privacy" target="_blank" rel="noopener">Privacy Policy</Link>.
            </span>
          </label>

          <SubmitButton loading={loading} loadingText={editingPending ? 'Saving...' : 'Creating account...'}>
            <span>{editingPending ? 'Save and continue' : 'Create account'}</span>
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
