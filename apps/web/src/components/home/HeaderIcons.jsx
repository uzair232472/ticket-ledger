import React from 'react';

/**
 * Modern, sleek Cart / Shopping Bag icon.
 * Clean stroke geometry for high-end professional appearance.
 */
export function TicketCartIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

/**
 * Modern, sleek Bell icon for notifications.
 */
export function TicketBellIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/**
 * Modern, sleek User Account icon.
 */
export function TicketUserIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Menu button: a ticket outline with three menu lines, drawn with thin strokes (scales with the button).
 */
export function MenuTicketIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 96 48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M8 3h80a5 5 0 0 1 5 5v9.5a6.5 6.5 0 0 0 0 13V40a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-9.5a6.5 6.5 0 0 0 0-13V8a5 5 0 0 1 5-5Z" strokeWidth="2.2" />
      <path d="M33 16.5h30M33 24h30M33 31.5h30" strokeWidth="3" />
    </svg>
  );
}
