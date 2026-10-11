import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';
import './createEventChoice.css';

/** Barcode on the ticket stub (decorative). */
function Barcode() {
  const bars = [3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 2, 1, 3];
  let x = 0;
  const rects = bars.map((w, i) => {
    const rect = <rect key={i} x={x} y="0" width={w} height="40" />;
    x += w + (i % 3 === 0 ? 2 : 1.5);
    return rect;
  });
  return (
    <svg className="tl-cc-barcode" viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" aria-hidden="true">
      {rects}
    </svg>
  );
}

/** A stack of live-event tickets (decorative). */
function TicketsArt() {
  return (
    <svg className="tl-cc-art tl-cc-art--tickets" viewBox="0 0 300 230" aria-hidden="true">
      <defs>
        <linearGradient id="ccTicket" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4ade80" />
          <stop offset="0.55" stopColor="#16a34a" />
          <stop offset="1" stopColor="#0f3a23" />
        </linearGradient>
        <linearGradient id="ccTicketBack" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#86efac" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
        <radialGradient id="ccGlow" cx="0.45" cy="0.3" r="0.6">
          <stop offset="0" stopColor="#dcfce7" stopOpacity="0.9" />
          <stop offset="1" stopColor="#dcfce7" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(150 118) rotate(-16)">
        <rect x="-118" y="-58" width="236" height="120" rx="12" fill="url(#ccTicketBack)" opacity="0.45" transform="translate(34 30)" />
        <rect x="-118" y="-58" width="236" height="120" rx="12" fill="url(#ccTicketBack)" opacity="0.7" transform="translate(18 15)" />
        <rect x="-118" y="-58" width="236" height="120" rx="12" fill="url(#ccTicket)" />
        <rect x="-118" y="-58" width="236" height="120" rx="12" fill="url(#ccGlow)" />
        {/* crowd silhouette */}
        <path d="M-118 46 q12 -22 22 -8 q8 -26 18 -4 q10 -20 20 -2 q8 -24 18 -6 q10 -18 20 0 q10 -26 20 -4 q8 -16 18 2 q10 -22 20 -2 q6 -12 10 -4 V62 H-118 Z" fill="#0b1a10" opacity="0.55" />
        {/* perforation and stub */}
        <line x1="66" y1="-52" x2="66" y2="56" stroke="#dcfce7" strokeWidth="2" strokeDasharray="4 5" opacity="0.8" />
        <g fill="#0b1a10" opacity="0.75">
          {[0, 5, 8, 14, 18, 23, 27, 32, 37, 41].map((y) => (
            <rect key={y} x="80" y={-36 + y * 1.7} width="28" height={y % 2 ? 2 : 4} />
          ))}
        </g>
        <text x="-98" y="-18" fill="#0b1a10" fontSize="30" fontWeight="900" fontStyle="italic" letterSpacing="-1">LIVE</text>
        <text x="-98" y="12" fill="#0b1a10" fontSize="30" fontWeight="900" fontStyle="italic" letterSpacing="-1">EVENT</text>
        <text x="-98" y="30" fill="#0b1a10" fontSize="8" fontWeight="700" letterSpacing="1.5" opacity="0.8">MUSIC · PEOPLE · EXPERIENCES</text>
      </g>
    </svg>
  );
}

/** Calendar pages for future dates (decorative). */
function CalendarArt() {
  const page = (x, y, rot, month, day, solid) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x="-62" y="-58" width="124" height="116" rx="10" fill={solid ? '#ffffff' : '#f3fbf4'} stroke="#bfe3c8" strokeWidth="1.5" />
      {solid && <rect x="-62" y="-58" width="124" height="10" rx="5" fill="#d3ead7" />}
      <text x="-44" y="-26" fontSize="13" fontWeight="800" fontStyle="italic" letterSpacing="2" fill={solid ? '#0b1a10' : '#16a34a'}>{month}</text>
      <text
        x="-46"
        y="42"
        fontSize="70"
        fontWeight="900"
        fontStyle="italic"
        letterSpacing="-3"
        fill={solid ? '#0f3a23' : 'none'}
        stroke={solid ? 'none' : '#22c55e'}
        strokeWidth={solid ? 0 : 2}
      >
        {day}
      </text>
    </g>
  );
  return (
    <svg className="tl-cc-art tl-cc-art--calendar" viewBox="0 0 300 230" aria-hidden="true">
      <g stroke="#cfe8d5" strokeWidth="1">
        {[40, 80, 120, 160, 200].map((v) => <line key={`h${v}`} x1="0" y1={v} x2="300" y2={v} />)}
        {[60, 120, 180, 240].map((v) => <line key={`v${v}`} x1={v} y1="0" x2={v} y2="230" />)}
      </g>
      {page(232, 160, -14, 'MAY', '26', false)}
      {page(196, 118, -10, 'APR', '25', false)}
      {page(140, 76, -6, 'APR', '24', true)}
    </svg>
  );
}

const OPTIONS = [
  {
    to: '/organizer/create-event',
    kicker: '01 / Go live',
    title: ['Register', 'an event'],
    text: 'Build your event, set ticket prices and submit for approval.',
    steps: ['Details', 'Tickets', 'Seating'],
    cta: 'Create your event',
    tone: 'live',
    Art: TicketsArt,
  },
  {
    to: '/organizer/prebook',
    kicker: '02 / Plan ahead',
    title: ['Prebook', 'an event'],
    text: 'Request future dates and venue slots. Add tickets when you’re ready.',
    steps: ['One date', 'Multiple dates', 'Flexible setup'],
    cta: 'Reserve your dates',
    tone: 'plan',
    Art: CalendarArt,
  },
];

/** /organizer/events/new: the two ways to start, as two tickets side by side. */
export default function CreateEventChoice() {
  return (
    <div className="tl-cc-page">
      <header className="tl-cc-head">
        <div className="tl-cc-head-row">
          <p className="tl-sh-crumbs">
            <span>Organizer studio</span>
            <span>Create</span>
          </p>
          <Link to="/organizer/dashboard" className="tl-cc-back">
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </div>
        <h1 className="tl-sh-title tl-cc-title">
          Make it <span>happen.</span>
        </h1>
        <p className="tl-cc-intro">Launch your next experience. Or save the date.</p>
      </header>

      <div className="tl-cc-grid">
        {OPTIONS.map(({ to, kicker, title, text, steps, cta, tone, Art }) => (
          <Link key={to} to={to} className={`tl-cc-ticket tl-cc-ticket--${tone}`}>
            <div className="tl-cc-body">
              <Art />
              <p className="tl-cc-kicker">{kicker}</p>
              <h2 className="tl-cc-name">
                {title[0]}
                <br />
                {title[1]}
              </h2>
              <p className="tl-cc-text">{text}</p>
              <p className="tl-cc-steps">
                {steps.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </p>
            </div>
            <div className="tl-cc-stub">
              <Barcode />
              <span className="tl-cc-cta">{cta}</span>
              <span className="tl-cc-go" aria-hidden="true">
                <ArrowRight className="w-5 h-5" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <p className="tl-cc-note">
        <Info className="w-4 h-4" aria-hidden="true" /> All events and reservations are subject to admin approval.
      </p>
    </div>
  );
}
