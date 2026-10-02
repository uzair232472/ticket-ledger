import React, { useId } from 'react';
import { MARK_VIEWBOX, MARK_GRADIENT, MARK_BACK, MARK_TICKET, MARK_BASE } from './markPaths';
import './brand.css';

/**
 * TicketLedger logo: the ticket mark inline (so its navy parts can follow the surrounding tone) plus the
 * "Ticket Ledger" name as live text. `variant="mark"` renders the icon alone.
 * Colours come from CSS custom properties on any ancestor:
 *   --brand-navy  the dark parts of the mark (default #051a3d; set to #fff over dark scenes)
 *   --brand-text  the name (defaults to --brand-navy)
 */
export default function BrandLogo({ variant = 'full', tagline = false, className = '', label = 'TicketLedger' }) {
  const gradientId = `tl-mark-${useId().replace(/:/g, '')}`;
  return (
    <span className={`tl-brand tl-brand--${variant} ${className}`} role="img" aria-label={label}>
      <svg className="tl-brand-mark" viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1={MARK_GRADIENT.x1} y1={MARK_GRADIENT.y1} x2={MARK_GRADIENT.x2} y2={MARK_GRADIENT.y2} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={MARK_GRADIENT.from} />
            <stop offset="1" stopColor={MARK_GRADIENT.to} />
          </linearGradient>
        </defs>
        <path className="tl-brand-navy" d={MARK_BACK} />
        <path fill={`url(#${gradientId})`} d={MARK_TICKET} />
        <path className="tl-brand-navy" d={MARK_BASE} />
      </svg>
      {variant === 'full' && (
        <span className="tl-brand-text" aria-hidden="true">
          <span className="tl-brand-name" data-logo-text>Ticket Ledger</span>
          {tagline && <span className="tl-brand-tagline">Secure Tickets. Smarter Events</span>}
        </span>
      )}
    </span>
  );
}
