import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeHeader from '../home/HomeHeader';
import SiteFooter from '../home/SiteFooter';
import '../home/home.css';
import '../events/events.css';
import './booking.css';
import './booking-dark.css';

const STEPS = [
  { key: 'seats', label: 'Seats' },
  { key: 'review', label: 'Review' },
  { key: 'payment', label: 'Payment' },
  { key: 'confirmation', label: 'Confirmation' },
];

/** Seats / Review / Payment / Confirmation progress, shown on every page of the booking flow. */
export function BookingSteps({ current }) {
  const at = STEPS.findIndex((s) => s.key === (current === 'checkout' ? 'payment' : current));
  return (
    <ol className="tl-bk-steps" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < at ? 'is-done' : undefined} aria-current={i === at ? 'step' : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * Page frame for the booking flow (seat selection, checkout, payment states, confirmation): the same
 * fixed header, menu and footer as the homepage and Explore Events, on the Explore paper background.
 * `bare`: no header or footer (the full-screen 3D seat page); children keep their place, so nothing remounts.
 * `hero`: a full-width dark banner above the content (seat page); the header then starts in its light-on-dark tone.
 * `dark`: the app's dark theme (Explore / console look) instead of paper, used by Checkout.
 */
export default function BookingShell({ children, hero = null, bare = false, dark = false }) {
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const toCategories = useCallback(() => navigate('/events'), [navigate]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <div className={`tl-home tl-explore tl-book${hero ? ' tl-book--hero' : ''}${bare ? ' tl-book--bare' : ''}${dark ? ' tl-book--dark' : ''}`}>
      {!bare && <HomeHeader pageRef={pageRef} onCategories={toCategories} tone={hero || dark ? 'dark' : 'light'} />}
      <div ref={pageRef}>
        {hero}
        <main className="tl-bk-main">{children}</main>
        {!bare && <SiteFooter />}
      </div>
    </div>
  );
}
