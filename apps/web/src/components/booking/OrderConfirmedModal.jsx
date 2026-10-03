import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bell, Calendar, Check, Info, MapPin, X } from 'lucide-react';
import markUrl from '../../assets/ticketledger-mark.svg';
import { formatPkr } from '../venue/venueTheme';
import { getEventVisual } from '../../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';
import './confirm.css';

const seatLabel = (s) => {
  if (!s) return null;
  if (s.kind === 'GA_SLOT') return 'General';
  if (s.kind === 'TABLE_SEAT') return `${s.row} · ${s.seatNumber}`;
  return `${s.row}${s.seatNumber}`;
};
const unique = (list) => [...new Set(list.filter(Boolean))];

/**
 * "You're going!" pop-up shown over the page once an order is SUCCESSFUL: brand mark, a ticket-shaped
 * summary (event, sections, seats, order number, total paid) and links to the wallet and events.
 */
export default function OrderConfirmedModal({ order, receipt, onClose }) {
  const closeRef = useRef(null);
  const { event, tickets = [] } = order;

  const facts = useMemo(() => {
    const seats = tickets.map((t) => t.seat);
    const sections = unique(seats.map((s) => s?.tier?.name || s?.section));
    const generalOnly = seats.length > 0 && seats.every((s) => s?.kind === 'GA_SLOT');
    return {
      section: sections.join(', ') || '—',
      seats: generalOnly ? 'General admission' : unique(seats.map(seatLabel)).join(', ') || '—',
    };
  }, [tickets]);

  // Focus the dialog, lock page scroll, Escape closes
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const time = formatEventTime(event?.time);
  const image = event ? getEventVisual(event).imageUrl : null;
  const orderNo = `#${order.id.slice(0, 8).toUpperCase()}`;

  return createPortal(
    <div className="tl-ok-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tl-ok" role="dialog" aria-modal="true" aria-labelledby="tl-ok-title" aria-describedby="tl-ok-sub">
        <button ref={closeRef} type="button" className="tl-ok-close" onClick={onClose} aria-label="Close">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="tl-ok-mark" aria-hidden="true">
          <img src={markUrl} alt="" />
          <span className="tl-ok-mark-check"><Check className="w-3.5 h-3.5" strokeWidth={3} /></span>
        </div>
        <h2 id="tl-ok-title" className="tl-ok-title">You’re going!</h2>
        <p id="tl-ok-sub" className="tl-ok-sub">Your booking is confirmed. Your tickets are ready.</p>

        <div className="tl-ok-ticket">
          <div className="tl-ok-event">
            {image && <img className="tl-ok-thumb" src={image} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />}
            <div>
              <p className="tl-ok-name">{event?.name}</p>
              {event?.date && (
                <p className="tl-ok-meta"><Calendar className="w-4 h-4" aria-hidden="true" /> {formatEventDate(event.date)}{time && ` · ${time}`}</p>
              )}
              {event?.venue && (
                <p className="tl-ok-meta"><MapPin className="w-4 h-4" aria-hidden="true" /> {event.venue}{event.city ? `, ${event.city}` : ''}</p>
              )}
            </div>
          </div>

          <div className="tl-ok-tear" aria-hidden="true" />

          <dl className="tl-ok-facts">
            <div><dt>Section</dt><dd>{facts.section}</dd></div>
            <div><dt>Tickets</dt><dd>{tickets.length}</dd></div>
            <div><dt>Seats</dt><dd>{facts.seats}</dd></div>
            <div><dt>Order ID</dt><dd className="tl-ok-mono">{orderNo}</dd></div>
          </dl>

          <div className="tl-ok-total">
            <span>Total paid</span>
            <strong>{formatPkr(order.totalAmount ?? receipt?.amountPaid)}</strong>
            <span className="tl-ok-paid"><Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" /> Paid</span>
          </div>
        </div>

        <p className="tl-ok-note"><Bell className="w-4 h-4" aria-hidden="true" /> A confirmation was added to your notifications.</p>

        <Link to="/wallet" className="tl-ok-primary">
          <span className="tl-ok-primary-icon" aria-hidden="true" /> View my tickets
        </Link>
        <Link to="/events" className="tl-ok-secondary">Back to events</Link>

        <p className="tl-ok-foot"><Info className="w-4 h-4" aria-hidden="true" /> Show your ticket QR code at the entrance.</p>
      </div>
    </div>,
    document.body
  );
}
