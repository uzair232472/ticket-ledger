import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeHeader from '../home/HomeHeader';
import SiteFooter from '../home/SiteFooter';
import '../home/home.css';
import '../events/events.css';
import './booking.css';

const STEPS = [
  { key: 'seats', label: 'Seats' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'confirmation', label: 'Confirmation' },
];

/** Seats / Checkout / Confirmation progress, shown on every page of the booking flow. */
export function BookingSteps({ current }) {
  const at = STEPS.findIndex((s) => s.key === current);
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
 */
export default function BookingShell({ children }) {
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const toCategories = useCallback(() => navigate('/events'), [navigate]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <div className="tl-home tl-explore tl-book">
      <HomeHeader pageRef={pageRef} onCategories={toCategories} tone="light" />
      <div ref={pageRef}>
        <main className="tl-bk-main">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
