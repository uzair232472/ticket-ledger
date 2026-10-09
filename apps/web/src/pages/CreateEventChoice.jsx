import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarPlus, CalendarRange } from 'lucide-react';
import { StudioHead } from '../components/dash/Studio';

const OPTIONS = [
  {
    to: '/organizer/create-event',
    icon: CalendarPlus,
    title: 'Register an event',
    text: 'Set up one event with tickets, prices and a seating plan, then send it to TicketLedger for approval to go on sale.',
    cta: 'Register an event',
  },
  {
    to: '/organizer/prebook',
    icon: CalendarRange,
    title: 'Prebook an event',
    text: 'Reserve one or more future dates and venue slots in one form. Each date is reserved once an admin approves it; add tickets and show it publicly whenever you’re ready.',
    cta: 'Prebook dates',
  },
];

/** /organizer/events/new: the two ways to start, side by side. */
export default function CreateEventChoice() {
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 16px 64px' }}>
      <StudioHead
        crumbs={['Organizer', 'Create event']}
        title="Create event"
        intro="Choose how you want to start."
        controls={<Link to="/organizer/dashboard" className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> Back to dashboard</Link>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 18, marginTop: 24 }}>
        {OPTIONS.map(({ to, icon: Icon, title, text, cta }) => (
          <Link key={to} to={to} className="tl-wz-card" style={{ display: 'flex', flexDirection: 'column', gap: 12, textDecoration: 'none', color: 'inherit' }}>
            <Icon className="w-8 h-8" style={{ color: 'var(--st-green)' }} aria-hidden="true" />
            <h2>{title}</h2>
            <p style={{ color: 'var(--st-muted)', fontSize: 15, lineHeight: 1.55, flex: 1 }}>{text}</p>
            <span className="tl-wz-btn tl-wz-btn--green" style={{ alignSelf: 'flex-start' }}>
              {cta} <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
