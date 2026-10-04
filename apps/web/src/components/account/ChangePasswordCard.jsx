import React, { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound } from 'lucide-react';
import api from '../../utils/api';
import { useDialog } from '../ui/DialogProvider';

const RULES = [
  { test: (v) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v) => /[A-Za-z]/.test(v), label: 'A letter' },
  { test: (v) => /\d/.test(v), label: 'A number' },
];

/** Password field with a show / hide toggle. */
function PasswordInput({ id, label, value, onChange, autoComplete }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold text-slate-800">{label}</label>
      <div className="flex items-center gap-2 px-3 rounded-xl border border-slate-200 bg-white focus-within:border-[#16a34a] focus-within:ring-2 focus-within:ring-emerald-100">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="flex-1 min-w-0 py-2.5 text-sm bg-transparent outline-none"
        />
        <button type="button" onClick={() => setShown((s) => !s)} className="text-slate-500 hover:text-slate-800 p-1" aria-label={shown ? 'Hide password' : 'Show password'}>
          {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Change password while signed in (customers and organizers): current password, new password (the
 * signup rules), confirmation. Other devices are signed out; a confirmation email is sent.
 */
export default function ChangePasswordCard() {
  const dialog = useDialog();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rulesOk = RULES.every((r) => r.test(next));
  const matches = next && next === again;
  const ready = current && rulesOk && matches && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.put('/users/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setAgain('');
      await dialog.alert({ tone: 'success', title: 'Password changed', message: `${res.data.message}\nWe’ve also sent a confirmation to your email.` });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-5">
      <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
        <span className="w-8 h-8 rounded-xl bg-emerald-50 text-[#16a34a] flex items-center justify-center">
          <KeyRound className="w-4 h-4" />
        </span>
        <div>
          <h3 className="font-extrabold text-[#212b36] text-base">Change password</h3>
          <p className="text-xs text-slate-500">Other devices are signed out after the change.</p>
        </div>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <PasswordInput id="pw-current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        </div>
        <PasswordInput id="pw-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordInput id="pw-again" label="Confirm new password" value={again} onChange={setAgain} autoComplete="new-password" />
        <ul className="sm:col-span-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]" aria-label="Password rules">
          {RULES.map((r) => (
            <li key={r.label} className={`inline-flex items-center gap-1 ${next && r.test(next) ? 'text-emerald-700' : 'text-slate-500'}`}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" /> {r.label}
            </li>
          ))}
          <li className={`inline-flex items-center gap-1 ${matches ? 'text-emerald-700' : 'text-slate-500'}`}>
            <Check className="w-3.5 h-3.5" aria-hidden="true" /> Both new passwords match
          </li>
        </ul>
        {error && <p role="alert" className="sm:col-span-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
        <div className="sm:col-span-2">
          <button type="submit" disabled={!ready} className="px-5 py-2.5 rounded-full bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-bold transition shadow-sm disabled:opacity-50 inline-flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </div>
  );
}
