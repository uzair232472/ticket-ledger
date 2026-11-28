import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Calendar, Check, Clock, CreditCard, Hash, Info, MapPin, QrCode, RefreshCw, Ticket } from 'lucide-react';
import { getEventVisual } from '../utils/eventMedia';
import api from '../utils/api';
import BookingShell, { BookingSteps } from '../components/booking/BookingShell';
import OrderConfirmedModal from '../components/booking/OrderConfirmedModal';
import { formatPkr } from '../components/venue/venueTheme';
import { formatEventDate, formatEventTime } from '../utils/eventTime';

const POLL_MS = 3000;
const POLL_LIMIT_MS = 3 * 60 * 1000;

// Paid, valid ticket whose NFT issuance is not finished. Payment, entry and NFT are separate facts from the API
// (ticket.states); a pending NFT never makes the ticket invalid.
const isNftPending = (t) => t.states?.entry.valid && ['PENDING', 'FAILED'].includes(t.states?.nft.status);

const seatFacts = (seat) => {
  if (!seat) return [['Seat', '—']];
  if (seat.kind === 'GA_SLOT') return [['Section', seat.section], ['Entry', 'General'], ['No.', seat.seatNumber]];
  if (seat.kind === 'TABLE_SEAT') return [['Section', seat.section], ['Table', seat.row], ['Seat', seat.seatNumber]];
  return [['Section', seat.section], ['Row', seat.row], ['Seat', seat.seatNumber]];
};

/**
 * Order status and confirmation. The order is always re-read from the server: success and issued tickets
 * are shown only for a SUCCESSFUL order; a PENDING order shows a pending state (and is re-checked) and a
 * FAILED one explains that no tickets were issued.
 */
export default function BookingSuccess() {
  // Checkout opens /bookings/:orderId/confirmation; older links use /booking-success/:id
  const params = useParams();
  const orderId = params.orderId || params.id;
  const location = useLocation();
  const [order, setOrder] = useState(location.state?.order?.status === 'SUCCESSFUL' ? location.state.order : null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [popupClosed, setPopupClosed] = useState(false); // the full details stay on the page underneath
  const started = useRef(Date.now());
  const receipt = location.state?.receipt;
  const eventId = order?.eventId || location.state?.eventId;

  const fetchOrder = useCallback(async () => {
    setChecking(true);
    try {
      const { data } = await api.get(`/bookings/${orderId}`);
      setOrder(data.data.order);
      setStatus('ready');
    } catch (e) {
      setError(e.response?.status === 404 ? 'We couldn’t find this order.' : e.response?.data?.message || 'We couldn’t load this order. Check your connection and try again.');
      setStatus((s) => (s === 'ready' ? s : 'error'));
    } finally {
      setChecking(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Pending payments: keep checking for a while, then let the customer check manually
  const pending = order?.status === 'PENDING';
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(() => {
      if (Date.now() - started.current > POLL_LIMIT_MS) {
        setGaveUp(true);
        clearInterval(id);
        return;
      }
      fetchOrder();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pending, fetchOrder]);

  const head = (title, step = 'confirmation') => (
    <header className="tl-bk-head tl-bk-rise">
      <div>
        <p className="tl-bk-kicker">Order {orderId ? `#${orderId.slice(0, 8).toUpperCase()}` : ''}</p>
        <h1 className="tl-bk-title">{title}</h1>
      </div>
      <BookingSteps current={step} />
    </header>
  );

  if (status === 'loading' && !order) {
    return (
      <BookingShell dark>
        {head('Checking your order')}
        <section className="tl-bk-panel tl-co-status is-pending" aria-busy="true">
          <span className="tl-co-status-icon" aria-hidden="true"><Clock className="w-6 h-6" /></span>
          <p role="status">Getting the latest status of your order…</p>
          <div className="tl-co-progress" aria-hidden="true" />
        </section>
      </BookingShell>
    );
  }

  if (status === 'error' && !order) {
    return (
      <BookingShell dark>
        {head('Order unavailable')}
        <section className="tl-bk-panel tl-co-status is-error" role="alert">
          <p>{error}</p>
          <div className="tl-co-actions">
            <button type="button" className="tl-bk-btn" onClick={fetchOrder} disabled={checking}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again</button>
            <Link to="/my-bookings" className="tl-bk-btn tl-bk-btn--ghost">My orders</Link>
          </div>
        </section>
      </BookingShell>
    );
  }

  const { event, tickets = [] } = order;
  const nftPending = tickets.filter(isNftPending).length;
  const time = formatEventTime(event?.time);


  if (order.status === 'PENDING') {
    return (
      <BookingShell dark>
        {head('Payment pending', 'checkout')}
        <section className="tl-bk-panel tl-co-status is-pending" aria-labelledby="pending-title">
          <span className="tl-co-status-icon" aria-hidden="true"><Clock className="w-6 h-6" /></span>
          <h2 id="pending-title" className="tl-co-status-title">Waiting for payment confirmation</h2>
          <p role="status" aria-live="polite">
            We haven’t received confirmation for your {formatPkr(order.totalAmount)} {order.paymentMethod} payment for {event?.name} yet. Your seats stay reserved while it’s pending. Please don’t pay again.
            {gaveUp ? ' This is taking longer than usual — check again in a moment.' : ' This page updates automatically.'}
          </p>
          {!gaveUp && <div className="tl-co-progress" aria-hidden="true" />}
          <div className="tl-co-actions">
            <button type="button" className="tl-bk-btn" onClick={fetchOrder} disabled={checking} aria-busy={checking}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> {checking ? 'Checking…' : 'Check status'}
            </button>
            {eventId && <Link to={`/events/${eventId}/checkout`} className="tl-bk-btn tl-bk-btn--ghost">Back to checkout</Link>}
            <Link to="/my-bookings" className="tl-bk-btn tl-bk-btn--ghost">My orders</Link>
          </div>
          <p className="tl-bk-muted">No tickets are issued until the payment is confirmed.</p>
        </section>
      </BookingShell>
    );
  }

  if (order.status !== 'SUCCESSFUL') {
    return (
      <BookingShell dark>
        {head('Order not completed', 'checkout')}
        <section className="tl-bk-panel tl-co-status is-error" aria-labelledby="failed-title">
          <h2 id="failed-title" className="tl-co-status-title">No tickets were issued</h2>
          <p>
            This order for {event?.name} was cancelled or its reservation expired before payment was confirmed, so the seats were released and nothing was charged for it.
          </p>
          <div className="tl-co-actions">
            {eventId && <Link to={`/events/${eventId}/seats`} className="tl-bk-btn">Choose seats again</Link>}
            <Link to="/events" className="tl-bk-btn tl-bk-btn--ghost">Explore events</Link>
          </div>
        </section>
      </BookingShell>
    );
  }

  const paidAt = new Date(order.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <BookingShell dark>
      {!popupClosed && <OrderConfirmedModal order={order} receipt={receipt} onClose={() => setPopupClosed(true)} />}
      {head('You’re going')}

      <div className="tl-co-grid">
        <div className="tl-bk-rise">
          {/* Event, with the confirmed status */}
          <section className="tl-bk-panel tl-bs-event" aria-labelledby="ok-title">
            {event && <img className="tl-bs-event-img" src={getEventVisual(event).imageUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />}
            <div className="tl-bs-event-body">
              <span className="tl-bs-chip"><Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" /> Booking confirmed</span>
              <h2 id="ok-title" className="tl-bs-event-name">{event?.name}</h2>
              {event?.date && <p className="tl-bs-meta"><Calendar className="w-4 h-4" aria-hidden="true" /> {formatEventDate(event.date)}{time && ` · ${time}`}</p>}
              {event?.venue && <p className="tl-bs-meta"><MapPin className="w-4 h-4" aria-hidden="true" /> {event.venue}{event.city ? `, ${event.city}` : ''}</p>}
              <p className="tl-bs-lead">Payment confirmed and {tickets.length} ticket{tickets.length === 1 ? '' : 's'} issued to your account. Show the rotating QR code from your ticket wallet at the gate.</p>
            </div>
          </section>

          {/* Issued tickets */}
          <section className="tl-bk-panel" aria-labelledby="tickets-title">
            <h2 id="tickets-title" className="tl-bk-h2">Issued tickets <small>{tickets.length}</small></h2>
            <ul className="tl-bs-tickets">
              {tickets.map((t, i) => (
                <li key={t.id} className="tl-bs-ticket" style={{ '--tc': t.seat?.tier?.color || '#22e06b' }}>
                  <div className="tl-bs-ticket-head">
                    <span className="tl-bs-ticket-tier"><Ticket className="w-4 h-4" aria-hidden="true" /> {t.seat?.tier?.name || 'Ticket'}</span>
                    <b>{formatPkr(t.price)}</b>
                  </div>
                  <dl className="tl-bs-ticket-facts">
                    {seatFacts(t.seat).map(([k, v]) => (
                      <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>
                    ))}
                  </dl>
                  <div className="tl-bs-ticket-foot">
                    <span>Ticket {i + 1} of {tickets.length}</span>
                    {t.states ? (
                      <span className="tl-bs-ticket-states">
                        <i className={t.states.entry.valid ? 'is-ok' : ''}>{t.states.entry.label}</i>
                        <i className={t.states.nft.status === 'VERIFIED' ? 'is-ok' : isNftPending(t) ? 'is-wait' : ''}>{t.states.nft.label}{t.states.nft.status === 'VERIFIED' && t.tokenId != null ? ` #${t.tokenId}` : ''}</i>
                      </span>
                    ) : <span className="tl-bs-ticket-states"><i>{t.status}</i></span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Receipt and next steps */}
        <aside className="tl-co-aside tl-bk-rise" aria-labelledby="receipt-title">
          <section className="tl-bk-panel">
            <h2 id="receipt-title" className="tl-bk-h2">Receipt</h2>
            <div className="tl-bs-total">
              <span>Total paid</span>
              <strong>{formatPkr(order.totalAmount)}</strong>
              <span className="tl-bs-paid"><Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" /> Paid</span>
            </div>
            <dl className="tl-bs-receipt">
              <div><dt><Ticket className="w-4 h-4" aria-hidden="true" /> Tickets</dt><dd>{tickets.length}</dd></div>
              <div><dt><CreditCard className="w-4 h-4" aria-hidden="true" /> Payment</dt><dd>{order.paymentMethod}</dd></div>
              <div><dt><Hash className="w-4 h-4" aria-hidden="true" /> Transaction</dt><dd className="tl-co-mono">{order.paymentTxId || receipt?.transactionId || '—'}</dd></div>
              <div><dt><Clock className="w-4 h-4" aria-hidden="true" /> Ordered</dt><dd>{paidAt}</dd></div>
            </dl>
            {nftPending > 0 && (
              <p className="tl-bs-note" role="status">
                <Info className="w-4 h-4" aria-hidden="true" />
                <span>NFT issuance pending for {nftPending} ticket{nftPending === 1 ? '' : 's'}. Your payment and tickets are confirmed and the QR pass works at the gate; we retry automatically and notify you when it’s done.</span>
              </p>
            )}
            <div className="tl-bs-actions">
              <Link to="/wallet" className="tl-bk-btn tl-bk-btn--block tl-bk-btn--lg"><QrCode className="w-5 h-5" aria-hidden="true" /> Open ticket wallet</Link>
              <Link to="/my-bookings" className="tl-bk-btn tl-bk-btn--ghost tl-bk-btn--block">My orders <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
              <Link to="/events" className="tl-bs-back"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to events</Link>
            </div>
            <p className="tl-bs-foot"><Info className="w-4 h-4" aria-hidden="true" /> Show your ticket QR code at the entrance.</p>
          </section>
        </aside>
      </div>
    </BookingShell>
  );
}
