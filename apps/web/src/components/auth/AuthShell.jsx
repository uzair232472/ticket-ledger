import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, IdCard, Forward, RefreshCw, Ticket } from 'lucide-react';
import airUniversityLogo from '../../assets/air-university-logo.png';
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

/** TicketLedger mark (from assets/ticketledger-mark.svg) with the outline drawn in white for the dark panel. */
function TicketLedgerMark({ className }) {
  return (
    <svg className={className} viewBox="131 211 760 604" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="auth-mark-gradient" x1="238.56" y1="512.87" x2="882.95" y2="512.87" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0175fe" />
          <stop offset="1" stopColor="#3d3ffc" />
        </linearGradient>
      </defs>
      <path fill="#ffffff" d="M139.15,521.13v-116.25s-.48-10,9.5-25.09c5.12-7.75,12.3-13.92,20.61-18.06l284.8-142.04c.29-.14.58-.24.9-.3.14-.02.31-.05.5-.08,11.54-1.67,21.8,7.51,21.8,19.17v26.6s-.53,16.38-11.87,30.78c-3.84,4.87-8.94,8.59-14.57,11.19l-216.58,100.11s-11.52,5.25-20.54,18.74c-5.95,8.89-8.83,19.49-8.87,30.19l-.45,110.48c-.01,2.54-2.77,4.11-4.95,2.82l-53.83-31.65c-.18-.1-.34-.22-.5-.36-1.15-1.03-5.96-5.99-5.96-16.25Z" />
      <path fill="url(#auth-mark-gradient)" d="M880.95,559.42l-28.97-77.29c-79.04,21.64-103.71-49.01-103.71-49.01-22.05-74.07,52.79-107.91,52.79-107.91l-30.63-83.9c-.99-2.7-2.29-5.29-3.98-7.61-13.57-18.59-32.59-15.86-38.87-14.32-1.16.28-2.29.69-3.38,1.18l-464.6,209.81c-3.35,1.51-6.45,3.54-9.05,6.13-7.3,7.28-10.18,16.14-11.3,21.45-.48,2.28-.7,4.61-.7,6.95v98.78s203.37-98.65,203.37-98.65l2.02,342.44,423.89-205.82c.32-.15.64-.32.94-.5,16.55-9.7,14.63-30.14,13.36-37.38-.26-1.48-.67-2.93-1.19-4.33ZM549.57,404.85l-11.52-30.38c-2.71-7.2.89-15.24,8.09-17.97,1.61-.6,3.27-.89,4.91-.89,5.62,0,10.95,3.42,13.06,8.99l11.49,30.38c2.74,7.2-.89,15.24-8.09,17.97-7.17,2.74-15.24-.89-17.94-8.09ZM583.77,487.82l-11.49-30.38c-2.74-7.2.89-15.24,8.09-17.97,1.61-.6,3.27-.89,4.91-.89,5.62,0,10.92,3.42,13.03,8.99l11.52,30.38c2.71,7.2-.92,15.24-8.09,17.97-7.2,2.71-15.24-.89-17.97-8.09ZM617.22,569.36l-11.52-30.38c-2.74-7.17.89-15.24,8.09-17.94,1.64-.63,3.3-.92,4.94-.92,5.62,0,10.92,3.45,13,9.02l11.52,30.38c2.74,7.2-.89,15.24-8.09,17.94-7.2,2.74-15.24-.89-17.94-8.09ZM669.12,659.02c-7.2,2.71-15.24-.89-17.97-8.09l-11.52-30.38c-2.71-7.2.92-15.24,8.09-17.97,1.64-.62,3.3-.89,4.94-.89,5.62,0,10.92,3.42,13.03,8.99l11.52,30.38c2.71,7.2-.92,15.24-8.09,17.97Z" />
      <path fill="#ffffff" d="M238.24,691.4v-65.99c0-7.88,2.25-15.67,6.89-22.04,3-4.12,7.23-8.32,13.12-11.45l150.44-79.05v293.45l-154.75-88.9s-13.08-5.61-15.46-21.86c-.2-1.37-.24-2.77-.24-4.15Z" />
    </svg>
  );
}

/** "TicketLedger — in collaboration with — Air University" lock-up on the green panel. */
function CoBrand() {
  return (
    <div className="tl-auth-cobrand" role="img" aria-label="TicketLedger in collaboration with Air University">
      <div className="tl-auth-cobrand-tl">
        <div className="tl-auth-cobrand-word">
          <TicketLedgerMark className="tl-auth-cobrand-mark" />
          <span>Ticket<b>Ledger</b></span>
        </div>
        <p className="tl-auth-cobrand-with">In collaboration with</p>
      </div>
      <span className="tl-auth-cobrand-rule" aria-hidden="true" />
      <img className="tl-auth-cobrand-au" src={airUniversityLogo} alt="" width="360" height="296" />
    </div>
  );
}

/**
 * Sign-in / sign-up layout shared by every auth screen (login, signup, verify, password reset, invites):
 * only the menu button on top, then a two-panel card and a small legal footer. The green panel shows the
 * TicketLedger × Air University lock-up and the ticket illustration; the light panel holds the form.
 * On phones the green panel shrinks to a banner.
 */
export default function AuthShell({ eyebrow = 'Welcome to TicketLedger', title, subtitle, children, footer }) {
  return (
    <div className="tl-home tl-auth">
      <HomeHeader tone="light" minimal />
      <main className="tl-auth-main">
        <div className="tl-auth-wrap">
          <div className="tl-auth-card">
            <section className="tl-auth-promo" aria-label="TicketLedger">
              <p className="tl-auth-eyebrow">Your digital ticket wallet</p>
              <CoBrand />
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
                {eyebrow && <p className="tl-auth-kicker">{eyebrow}</p>}
                <h1 className="tl-auth-title">{title}</h1>
                {subtitle && <p className="tl-auth-sub">{subtitle}</p>}
                <div className="tl-auth-body">{children}</div>
                {footer && <div className="tl-auth-foot">{footer}</div>}
              </div>
            </section>
          </div>
          <footer className="tl-auth-legal">
            <p>© {new Date().getFullYear()} TicketLedger. All rights reserved.</p>
            <nav aria-label="Legal">
              <Link to="/privacy">Privacy</Link>
              <span aria-hidden="true">•</span>
              <Link to="/terms">Terms</Link>
            </nav>
          </footer>
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
