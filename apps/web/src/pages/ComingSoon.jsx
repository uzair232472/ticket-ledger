import React, { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import HomeHeader from '../components/home/HomeHeader';
import { useAuth } from '../context/AuthContext';
import '../components/home/home.css';
import './notfound.css';

/** The 404 page's looped green ticket, with a clock face inside it and a "COMING SOON" ticket strip across it. */
function Art() {
  return (
    <svg className="tl-404-art" viewBox="0 0 900 400" role="img" aria-label="Coming soon">
      <defs>
        <linearGradient id="cs-green" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6ee7a7" />
          <stop offset="0.55" stopColor="#22c55e" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
        <radialGradient id="cs-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#22c55e" stopOpacity="0.55" />
          <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
        <filter id="cs-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* Glow on the floor */}
      <ellipse cx="450" cy="352" rx="330" ry="26" fill="url(#cs-glow)" />
      <ellipse cx="450" cy="200" rx="150" ry="160" fill="url(#cs-glow)" opacity="0.55" />

      {/* Looped ticket with a clock face inside */}
      <g transform="translate(450 200)" filter="url(#cs-shadow)">
        <circle r="140" fill="none" stroke="url(#cs-green)" strokeWidth="44" />
        <circle r="140" fill="none" stroke="#0b2b19" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="2 12" />
        <circle r="164" fill="none" stroke="#bbf7d0" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="5 9" />
        <circle r="116" fill="none" stroke="#bbf7d0" strokeOpacity="0.3" strokeWidth="2" strokeDasharray="5 9" />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x="-2" y="-104" width="4" height={i % 3 === 0 ? 18 : 10} rx="2" fill="#f3efe2" opacity={i % 3 === 0 ? 0.9 : 0.5} transform={`rotate(${i * 30})`} />
        ))}
        <rect x="-4" y="-62" width="8" height="70" rx="4" fill="#f3efe2" transform="rotate(-50)" />
        <rect x="-3" y="-86" width="6" height="94" rx="3" fill="#4ade80" transform="rotate(35)" />
        <circle r="9" fill="#f3efe2" />
      </g>

      {/* Ticket strip across the clock */}
      <g transform="translate(450 300) rotate(-8)" filter="url(#cs-shadow)">
        <path d="M-210 -34h420a8 8 0 0 1 8 8v14a10 10 0 0 0 0 24v14a8 8 0 0 1-8 8h-420a8 8 0 0 1-8-8v-14a10 10 0 0 0 0-24v-14a8 8 0 0 1 8-8Z" fill="url(#cs-green)" />
        <path d="M-190 -22h300M-190 22h300" stroke="#0b2b19" strokeOpacity="0.35" strokeWidth="1.5" />
        <text x="-178" y="10" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="28" letterSpacing="2" fill="#0b2b19">COMING<tspan fill="#0f3d22" fontWeight="700"> SOON</tspan></text>
        {[-20, -10, 0, 10, 20].map((y) => <circle key={y} cx="124" cy={y} r="3" fill="#0b2b19" />)}
        {Array.from({ length: 14 }, (_, i) => (
          <rect key={i} x={140 + i * 4.5} y="-22" width={i % 3 === 0 ? 3 : 1.5} height="44" fill="#0b2b19" opacity="0.85" />
        ))}
      </g>
    </svg>
  );
}

const HOME_FOR_ROLE = { SUPER_ADMIN: '/admin/dashboard', ORGANIZER: '/organizer/dashboard' };

/**
 * Placeholder shown instead of a feature that is still being built (see COMING_SOON in App.jsx).
 * Same stage, header and actions as the 404 page.
 */
export default function ComingSoon({ feature }) {
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const { user } = useAuth();
  const dashboard = HOME_FOR_ROLE[user?.role];
  return (
    <div className="tl-home tl-404">
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/categories')} tone="dark" />
      <main ref={pageRef} className="tl-404-main">
        <Art />
        <p className="tl-404-eyebrow">{feature ? `${feature} · Coming soon` : 'Coming soon'}</p>
        <h1 className="tl-404-title">This feature is almost ready.</h1>
        <p className="tl-404-text">We’re putting the finishing touches on {feature ? <strong>{feature}</strong> : 'this page'}.<br />Check back soon.</p>
        <div className="tl-404-actions">
          {dashboard
            ? <Link to={dashboard} className="tl-404-btn is-primary">Back to dashboard <ArrowRight className="w-5 h-5" aria-hidden="true" /></Link>
            : <Link to="/events" className="tl-404-btn is-primary">Explore events <ArrowRight className="w-5 h-5" aria-hidden="true" /></Link>}
          <Link to="/" className="tl-404-btn">Back to home</Link>
        </div>
        <button type="button" className="tl-404-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Go back
        </button>
        <footer className="tl-404-foot">
          <p className="tl-404-mark" aria-hidden="true"><span>TICKET<b>LEDGER</b></span></p>
          <p>Something new is on its way.</p>
        </footer>
      </main>
    </div>
  );
}
