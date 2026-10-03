import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Calendar, Check, Clock, MapPin, QrCode, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import BookingShell, { BookingSteps } from '../components/booking/BookingShell';
import OrderConfirmedModal from '../components/booking/OrderConfirmedModal';
import { formatPkr } from '../components/venue/venueTheme';
import { formatEventDate, formatEventTime } from '../utils/eventTime';

const POLL_MS = 3000;
const POLL_LIMIT_MS = 3 * 60 * 1000;

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
      <BookingShell>
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
      <BookingShell>
        {head('Order unavailable')}
        <section className="tl-bk-panel tl-co-status is-error" role="alert">
          <span className="tl-co-status-icon" aria-hidden="true"><AlertTriangle className="w-6 h-6" /></span>
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
  const time = formatEventTime(event?.time);
  const eventMeta = event && (
    <p className="tl-bk-meta">
      <span><MapPin className="w-4 h-4" aria-hidden="true" /> {event.venue}, {event.city}</span>
      {event.date && <span><Calendar className="w-4 h-4" aria-hidden="true" /> {formatEventDate(event.date)}{time && ` · ${time}`}</span>}
    </p>
  );

  if (order.status === 'PENDING') {
    return (
      <BookingShell>
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
      <BookingShell>
        {head('Order not completed', 'checkout')}
        <section className="tl-bk-panel tl-co-status is-error" aria-labelledby="failed-title">
          <span className="tl-co-status-icon" aria-hidden="true"><AlertTriangle className="w-6 h-6" /></span>
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

  return (
    <BookingShell>
      {!popupClosed && <OrderConfirmedModal order={order} receipt={receipt} onClose={() => setPopupClosed(true)} />}
      {head('You’re going')}

      <section className="tl-bk-panel tl-co-status is-ok tl-bk-rise" aria-labelledby="ok-title">
        <span className="tl-co-status-icon" aria-hidden="true"><Check className="w-6 h-6" /></span>
        <h2 id="ok-title" className="tl-co-status-title">{event?.name}</h2>
        {eventMeta}
        <p>Payment confirmed and {tickets.length} ticket{tickets.length === 1 ? '' : 's'} issued to your account. Show the rotating QR code from your ticket wallet at the gate.</p>
        <div className="tl-co-actions">
          <Link to="/wallet" className="tl-bk-btn"><QrCode className="w-4 h-4" aria-hidden="true" /> Open ticket wallet</Link>
          <Link to="/my-bookings" className="tl-bk-btn tl-bk-btn--ghost">My orders <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
        </div>
      </section>

      <section className="tl-bk-panel tl-bk-rise" aria-labelledby="tickets-title">
        <h2 id="tickets-title" className="tl-bk-h2">Issued tickets <small>{tickets.length}</small></h2>
        <ul className="tl-co-tickets">
          {tickets.map((t, i) => (
            <li key={t.id} className="tl-co-ticket">
              <p className="tl-vb-group-name">{t.seat?.tier?.name || 'Ticket'} <span>{formatPkr(t.price)}</span></p>
              <dl className="tl-co-ticket-facts">
                {seatFacts(t.seat).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
              <p className="tl-co-ticket-foot">
                <span>Ticket {i + 1} of {tickets.length}</span>
                <span>{t.tokenId != null ? `NFT #${t.tokenId}` : t.status}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="tl-bk-panel tl-bk-rise" aria-labelledby="receipt-title">
        <h2 id="receipt-title" className="tl-bk-h2">Receipt</h2>
        <dl className="tl-co-meta">
          <div><dt>Total paid</dt><dd>{formatPkr(order.totalAmount)}</dd></div>
          <div><dt>Payment</dt><dd>{order.paymentMethod}</dd></div>
          <div><dt>Transaction</dt><dd className="tl-co-mono">{order.paymentTxId || receipt?.transactionId || '—'}</dd></div>
          <div><dt>Ordered</dt><dd>{new Date(order.createdAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
        </dl>
      </section>
    </BookingShell>
  );
}
