import React from 'react';

// Tilted ticket outline shared by the header icons (same notched ticket as the menu button)
const TICKET = 'M10 15H54a4 4 0 0 1 4 4V26a6 6 0 0 0 0 12V45a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V38a6 6 0 0 0 0-12V19a4 4 0 0 1 4-4Z';

const Frame = ({ children, className }) => (
  <svg className={className} viewBox="-1 -3 66 66" aria-hidden="true" focusable="false">
    <g transform="rotate(-12 32 32)">
      <path d={TICKET} fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinejoin="round" />
      {children}
    </g>
  </svg>
);

/** Ticket with a bell, plus little ring marks over its corners. */
export function TicketBellIcon({ className }) {
  return (
    <Frame className={className}>
      <path d="M32 21.5c-4.6 0-7.2 3.4-7.2 7.9v5.1l-2.6 3.3h19.6l-2.6-3.3v-5.1c0-4.5-2.6-7.9-7.2-7.9Z" fill="currentColor" />
      <path d="M29.2 40.2a2.8 2.8 0 0 0 5.6 0Z" fill="currentColor" />
      <path d="M9 9.5c2.4-2.4 5.3-3.7 8.5-4M55 9.5c-2.4-2.4-5.3-3.7-8.5-4" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    </Frame>
  );
}

/** Ticket with a person (account). */
export function TicketUserIcon({ className }) {
  return (
    <Frame className={className}>
      <circle cx="32" cy="26.5" r="5.6" fill="currentColor" />
      <path d="M21 42.5c0-6.3 4.9-9.6 11-9.6s11 3.3 11 9.6Z" fill="currentColor" />
    </Frame>
  );
}
