import React, { useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, IdCard, Forward, RefreshCw, Ticket } from 'lucide-react';
import HomeHeader from '../home/HomeHeader';
import '../home/home.css';
import './auth.css';

/** The ticket illustration on the green panel: a paper ticket in front of a glowing glass one. */
function TicketArt() {
  return (
    <svg className="tl-auth-art" viewBox="0 0 520 380" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="auth-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4ade80" stopOpacity="0.55" />
          <stop offset="1" stopColor="#16a34a" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="auth-paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f3e8" />
          <stop offset="1" stopColor="#e6dfcd" />
        </linearGradient>
        <filter id="auth-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="auth-shadow" x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>
      {/* Green wire looping around the tickets */}
      <path d="M40 200c-30-60 60-90 130-70M430 250c60 30 40 90-30 95-40 3-60-20-70-45" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      {/* Glass ticket behind */}
      <g transform="translate(250 40) rotate(-16)">
        <rect x="0" y="0" width="220" height="130" rx="14" fill="#22c55e" opacity="0.35" filter="url(#auth-glow)" />
        <path d="M14 0h192a14 14 0 0 1 14 14v40a12 12 0 0 0 0 24v38a14 14 0 0 1-14 14H14A14 14 0 0 1 0 116V78a12 12 0 0 0 0-24V14A14 14 0 0 1 14 0Z" fill="url(#auth-glass)" stroke="#86efac" strokeOpacity="0.7" strokeWidth="1.5" />
        <path d="M156 10v110" stroke="#bbf7d0" strokeOpacity="0.6" strokeWidth="2" strokeDasharray="6 7" />
      </g>
      {/* Paper ticket in front */}
      <g transform="translate(70 150) rotate(-14)" filter="url(#auth-shadow)">
        <path d="M18 0h300a18 18 0 0 1 18 18v52a16 16 0 0 0 0 32v54a18 18 0 0 1-18 18H18A18 18 0 0 1 0 156v-54a16 16 0 0 0 0-32V18A18 18 0 0 1 18 0Z" fill="url(#auth-paper)" />
        <path d="M250 12v150" stroke="#2f3a33" strokeWidth="2" strokeDasharray="7 8" opacity="0.55" />
        <text x="34" y="64" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="30" letterSpacing="-1" fill="#0b1a10">Ticket<tspan fill="#15803d">Ledger</tspan></text>
        {Array.from({ length: 16 }, (_, i) => (
          <rect key={i} x={36 + i * 7 + (i % 3)} y="96" width={i % 3 === 0 ? 4 : 2} height="44" fill="#1f2a23" />
        ))}
        <g transform="translate(290 128)">
          <circle r="24" fill="#16a34a" stroke="#0f5a2c" strokeWidth="2" />
          <path d="M-10 0l7 7 13-14" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      {/* Chain at the end of the wire */}
      <g fill="none" stroke="#22c55e" strokeWidth="3">
        <rect x="412" y="318" width="22" height="22" rx="5" />
        <rect x="446" y="318" width="22" height="22" rx="5" />
        <rect x="480" y="318" width="22" height="22" rx="5" />
        <path d="M434 329h12M468 329h12" />
      </g>
    </svg>
  );
}

/**
 * Sign-in / sign-up layout shared by every auth screen (login, signup, verify, password reset, invites):
 * only the menu button on top, then a two-panel card. The green panel shows the TicketLedger promise and
 * the ticket illustration; the light panel holds the form. On phones the green panel shrinks to a banner.
 */
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="tl-home tl-auth">
      <HomeHeader tone="light" minimal />
      <main className="tl-auth-main">
        <div className="tl-auth-card">
          <section className="tl-auth-promo" aria-label="TicketLedger">
            <p className="tl-auth-eyebrow">The digital ticket wallet</p>
            <h2 className="tl-auth-headline">
              Every ticket.<br />Truly <em>yours.</em>
            </h2>
            <p className="tl-auth-lead">Book, keep and transfer<br />your verified tickets.</p>
            <TicketArt />
            <ul className="tl-auth-steps">
              <li><Ticket className="w-5 h-5" aria-hidden="true" /> Book</li>
              <li aria-hidden="true" className="tl-auth-dot" />
              <li><IdCard className="w-5 h-5" aria-hidden="true" /> Own</li>
              <li aria-hidden="true" className="tl-auth-dot" />
              <li><Forward className="w-5 h-5" aria-hidden="true" /> Transfer</li>
            </ul>
          </section>

          <section className="tl-auth-form">
            <div className="tl-auth-form-inner">
              <p className="tl-auth-logo" aria-hidden="true">Ticket<span>Ledger</span></p>
              <h1 className="tl-auth-title">{title}</h1>
              {subtitle && <p className="tl-auth-sub">{subtitle}</p>}
              <div className="tl-auth-body">{children}</div>
              {footer && <div className="tl-auth-foot">{footer}</div>}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null;
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`tl-auth-alert is-${tone === 'error' ? 'error' : 'ok'}`}>
      <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** Labelled input with a leading icon; password fields get a show / hide toggle. */
export function Field({ label, hint, icon: Icon, error, type = 'text', id, ...inputProps }) {
  const [shown, setShown] = useState(false);
  const autoId = useRef(`auth-${Math.random().toString(36).slice(2, 8)}`).current;
  const inputId = id || autoId;
  const isPassword = type === 'password';
  return (
    <div className="tl-auth-field">
      <label htmlFor={inputId}>
        {label}
        {hint && <span> {hint}</span>}
      </label>
      <div className={`tl-auth-input${error ? ' has-error' : ''}`}>
        {Icon && <Icon className="w-5 h-5" aria-hidden="true" />}
        <input id={inputId} type={isPassword && shown ? 'text' : type} aria-invalid={Boolean(error)} {...inputProps} />
        {isPassword && (
          <button type="button" className="tl-auth-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}>
            {shown ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        )}
      </div>
      {error && <p className="tl-auth-error">{error}</p>}
    </div>
  );
}

export function SubmitButton({ loading, loadingText, children, disabled }) {
  return (
    <button type="submit" disabled={loading || disabled} className="tl-auth-submit">
      {loading ? (
        <>
          <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>{loadingText}</span>
        </>
      ) : (
        <>
          {children}
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </>
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
    <div className="tl-auth-otp-row" role="group" aria-label="6-digit code">
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
          className="tl-auth-otp"
        />
      ))}
    </div>
  );
}
