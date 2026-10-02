import React, { useRef } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import BrandLogo from '../brand/BrandLogo';

/**
 * Two-column card used by every login / signup screen, so they look the same for all roles.
 * On phones only the form column is shown.
 */
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="max-w-4xl mx-auto my-6 sm:my-14">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        <div className="hidden lg:flex lg:col-span-5 relative flex-col justify-between p-8 bg-slate-900 text-white overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=800&q=80"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/80 to-transparent" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
              <span>Official Digital Box Office</span>
            </div>
          </div>

          <div className="relative z-10 space-y-4 my-auto py-6">
            <h2 className="text-2xl font-extrabold tracking-tight leading-snug">
              One account for every <span className="text-[#4ade80]">event & ticket.</span>
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Manage your bookings, view your 15-second dynamic entry QR pass, or access the organizer hub in one click.
            </p>
            <div className="space-y-2 pt-2 text-xs text-slate-200">
              {['Email-verified accounts', 'Verified digital seat tickets & passes', 'Mobile Turnstile Gate Scanner'].map((line) => (
                <div key={line} className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 text-[11px] text-slate-400 font-medium">
            Protected by Polygon Amoy ERC-721 Smart Contracts
          </div>
        </div>

        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center">
          <div className="max-w-md mx-auto w-full space-y-6">
            <div>
              <div className="mb-3">
                <BrandLogo className="text-[22px]" />
              </div>
              <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">{title}</h1>
              {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
            </div>
            {children}
            {footer && <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null;
  const styles = tone === 'error'
    ? 'bg-rose-50 border-rose-200 text-rose-700'
    : 'bg-emerald-50 border-emerald-200 text-emerald-800';
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${styles}`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function Field({ label, hint, icon: Icon, error, ...inputProps }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1.5">
        {label}
        {hint && <span className="font-normal text-slate-400"> {hint}</span>}
      </label>
      <div className="relative">
        {Icon && <Icon className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />}
        <input
          {...inputProps}
          aria-invalid={Boolean(error)}
          className={`w-full bg-slate-50 border rounded-xl ${Icon ? 'pl-10' : 'pl-3.5'} pr-3.5 py-2.5 text-sm sm:text-xs text-slate-800 focus:outline-none focus:bg-white transition disabled:opacity-70 ${
            error ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-[#22c55e]'
          }`}
        />
      </div>
      {error && <p className="text-[11px] text-rose-600 mt-1">{error}</p>}
    </div>
  );
}

export function SubmitButton({ loading, loadingText, children, disabled }) {
  return (
    <button type="submit" disabled={loading || disabled} className="w-full mt-2 btn-eventfrog text-xs py-3">
      {loading ? (
        <>
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>{loadingText}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Six single-digit boxes; supports typing, backspace and pasting the whole code. */
export function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');

  const setDigits = (next) => onChange(next.join('').slice(0, 6));

  const handleChange = (index, raw) => {
    const clean = raw.replace(/\D/g, '');
    if (clean.length > 1) {
      // Pasted or autofilled code
      const next = clean.slice(0, 6).split('');
      setDigits(next);
      refs.current[Math.min(next.length, 5)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 5) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) refs.current[index - 1]?.focus();
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          value={d}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-label={`Digit ${i + 1}`}
          className="w-11 h-12 sm:w-12 sm:h-14 text-center font-mono text-xl font-bold bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
        />
      ))}
    </div>
  );
}
