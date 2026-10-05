import React, { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import HomeHeader from '../components/home/HomeHeader';
import '../components/home/home.css';
import './notfound.css';

/** "4 0 4" with the zero drawn as a looped green ticket, a ticket strip across it and a torn stub. */
function Art() {
  return (
    <svg className="tl-404-art" viewBox="0 0 900 400" role="img" aria-label="404">
      <defs>
        <linearGradient id="nf-num" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3efe2" />
          <stop offset="1" stopColor="#cfc9b8" />
        </linearGradient>
        <linearGradient id="nf-green" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6ee7a7" />
          <stop offset="0.55" stopColor="#22c55e" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
        <radialGradient id="nf-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#22c55e" stopOpacity="0.55" />
          <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
        <filter id="nf-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* Glow on the floor */}
      <ellipse cx="450" cy="352" rx="330" ry="26" fill="url(#nf-glow)" />
      <ellipse cx="450" cy="200" rx="150" ry="160" fill="url(#nf-glow)" opacity="0.55" />

      {/* The two fours */}
      <g fill="url(#nf-num)" filter="url(#nf-shadow)" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="330" letterSpacing="-10">
        <text x="70" y="340">4</text>
        <text x="610" y="340">4</text>
      </g>

      {/* The zero: a looped ticket (outer band with notched edges) */}
      <g transform="translate(450 205) rotate(-8)" filter="url(#nf-shadow)">
        <ellipse rx="112" ry="150" fill="none" stroke="url(#nf-green)" strokeWidth="46" />
        <ellipse rx="112" ry="150" fill="none" stroke="#0b2b19" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="2 12" />
        <ellipse rx="135" ry="173" fill="none" stroke="#bbf7d0" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="5 9" />
        <ellipse rx="89" ry="127" fill="none" stroke="#bbf7d0" strokeOpacity="0.3" strokeWidth="2" strokeDasharray="5 9" />
      </g>

      {/* Ticket strip across the zero */}
      <g transform="translate(450 225) rotate(-20)" filter="url(#nf-shadow)">
        <path d="M-150 -34h300a8 8 0 0 1 8 8v14a10 10 0 0 0 0 24v14a8 8 0 0 1-8 8h-300a8 8 0 0 1-8-8v-14a10 10 0 0 0 0-24v-14a8 8 0 0 1 8-8Z" fill="url(#nf-green)" />
        <path d="M-132 -22h196M-132 22h196" stroke="#0b2b19" strokeOpacity="0.35" strokeWidth="1.5" />
        <text x="-118" y="9" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="25" letterSpacing="0.5" fill="#0b2b19">TICKET<tspan fill="#0f3d22" fontWeight="700">LEDGER</tspan></text>
        {[-20, -10, 0, 10, 20].map((y) => <circle key={y} cx="76" cy={y} r="3" fill="#0b2b19" />)}
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={92 + i * 4.5} y="-22" width={i % 3 === 0 ? 3 : 1.5} height="44" fill="#0b2b19" opacity="0.85" />
        ))}
      </g>

      {/* Torn stub flying off */}
      <g transform="translate(800 190) rotate(24)" filter="url(#nf-shadow)">
        <path d="M0 0h70v14a7 7 0 0 0 0 14v24H0V28a7 7 0 0 0 0-14Z" fill="url(#nf-green)" />
        <path d="M0 0l6 6-6 6 6 6-6 6 6 6-6 6 6 6-6 6 6 6-6 4" fill="none" stroke="#0b2b19" strokeOpacity="0.4" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/**
 * 404: any address the app doesn't know. The regular site header (logo, cart, notifications, profile,
 * menu) stays in its usual place.
 */
export default function NotFound() {
  const navigate = useNavigate();
  const pageRef = useRef(null);
  return (
    <div className="tl-home tl-404">
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/categories')} tone="dark" />
      <main ref={pageRef} className="tl-404-main">
        <Art />
        <p className="tl-404-eyebrow">Page not found</p>
        <h1 className="tl-404-title">This ticket leads nowhere.</h1>
        <p className="tl-404-text">The page you’re looking for may have moved<br />or the link may be incorrect.</p>
        <div className="tl-404-actions">
          <Link to="/events" className="tl-404-btn is-primary">Explore events <ArrowRight className="w-5 h-5" aria-hidden="true" /></Link>
          <Link to="/" className="tl-404-btn">Back to home</Link>
        </div>
        <button type="button" className="tl-404-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Go back
        </button>
        <footer className="tl-404-foot">
          <p className="tl-404-mark" aria-hidden="true"><span>TICKET<b>LEDGER</b></span></p>
          <p>Your next experience is still out there.</p>
        </footer>
      </main>
    </div>
  );
}
