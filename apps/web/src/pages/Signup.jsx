import React, { useEffect, useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, User, Phone, ArrowRight, Ticket, Building2, RefreshCw } from 'lucide-react';
import AuthShell, { Alert, Field, SubmitButton } from '../components/auth/AuthShell';
import { getHomeRoute } from '../lib/session';
import { validateName, validateEmail, validatePhone, validatePassword } from '../lib/validation';

const ACCOUNT_TYPES = [
  { id: 'customer', label: 'Customer', description: 'Buy and manage tickets', icon: Ticket },
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
      .catch(() => {})
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
      phone: validatePhone(form.phone),
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
      title={editingPending ? 'Check your details' : 'Create your account'}
      subtitle={
        editingPending
          ? "Fix anything that's wrong. If you change your email we'll send a new code to the new address."
          : "We'll email you a 6-digit code to verify your address"
      }
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="text-[#16a34a] hover:underline font-bold ml-1">
            Sign in here →
          </Link>
        </>
      }
    >
      <Alert>{error}</Alert>

      {restoring ? (
        <div className="flex justify-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-[#16a34a]" />
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="block text-xs font-bold text-slate-700 mb-1.5">Account type</legend>
          <div className="grid grid-cols-2 gap-2">
            {ACCOUNT_TYPES.map(({ id, label, description, icon: Icon }) => {
              const selected = form.accountType === id;
              return (
                <label
                  key={id}
                  className={`cursor-pointer p-3 rounded-xl border text-left transition ${selected ? 'border-[#22c55e] bg-emerald-50 ring-1 ring-[#22c55e]' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                >
                  <input
                    type="radio"
                    name="accountType"
                    value={id}
                    checked={selected}
                    onChange={update}
                    className="sr-only"
                  />
                  <Icon className={`w-4 h-4 mb-1 ${selected ? 'text-[#16a34a]' : 'text-slate-400'}`} />
                  <div className="text-xs font-bold text-slate-800">{label}</div>
                  <div className="text-[10px] text-slate-500">{description}</div>
                </label>
              );
            })}
          </div>

        </fieldset>

        <Field label="Full Name" icon={User} name="name" autoComplete="name" value={form.name} onChange={update} placeholder="Tariq Mehmood" error={fieldErrors.name} />
        <Field label="Email Address" icon={Mail} type="email" name="email" autoComplete="email" value={form.email} onChange={update} placeholder="name@gmail.com" error={fieldErrors.email} />
        <Field label="Mobile Number" hint="(optional)" icon={Phone} type="tel" name="phone" autoComplete="tel" value={form.phone} onChange={update} placeholder="+92 300 1234567" error={fieldErrors.phone} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Password" hint={editingPending ? '(leave blank to keep)' : undefined} icon={Lock} type="password" name="password" autoComplete="new-password" value={form.password} onChange={update} placeholder="8+ chars, letter & number" error={fieldErrors.password} />
          <Field label="Confirm Password" icon={Lock} type="password" name="confirmPassword" autoComplete="new-password" value={form.confirmPassword} onChange={update} placeholder="Repeat password" error={fieldErrors.confirmPassword} />
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 accent-[#16a34a]"
          />
          <span>I agree to the TicketLedger Terms of Service and Privacy Policy.</span>
        </label>

        <SubmitButton loading={loading} loadingText={editingPending ? 'Saving...' : 'Creating account...'}>
          <span>{editingPending ? 'Save and Continue' : 'Create Account'}</span>
          <ArrowRight className="w-4 h-4" />
        </SubmitButton>
      </form>
      )}
    </AuthShell>
  );
}
