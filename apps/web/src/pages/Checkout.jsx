import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calendar, Clock, Lock, MapPin, RefreshCw, Trash2, X } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useDialog } from '../components/ui/DialogProvider';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import BookingShell, { BookingSteps } from '../components/booking/BookingShell';
import OrderConfirmedModal from '../components/booking/OrderConfirmedModal';
import { formatClock, groupByTier, lineTitle, summaryLines } from '../components/venue/BookingSummary';
import { formatPkr } from '../components/venue/venueTheme';
import { getEventVisual } from '../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../utils/eventTime';

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  'pk_test_51UNHhM4Ve73zHzr5tqCqRRooaoF8dNMnKcv6aQyRV2d8tbZhf4QvO2q6w65A1YCr1lhVkcd1OOY0wZRwfDedBiUy00w2gURSW4'
);

// The payment options the API already supports (bookingController / paymentService)
const METHODS = [
  { value: 'MOCK', label: 'Instant test payment', note: 'Sandbox · confirms immediately' },
  { value: 'JAZZCASH', label: 'JazzCash', note: 'Mobile wallet · MPIN / OTP' },
  { value: 'EASYPAISA', label: 'EasyPaisa', note: 'Mobile wallet · OTP' },
  { value: 'STRIPE', label: 'Card (Stripe Sandbox)', note: 'Visa / Mastercard test payment' },
];
const WALLETS = new Set(['JAZZCASH', 'EASYPAISA']);
const digits = (v) => v.replace(/\D/g, '');
// "+92 300 1234567" and "0300-1234567" → "03001234567"
const normalizePhone = (v) => {
  const d = digits(v);
  return d.length === 12 && d.startsWith('92') ? `0${d.slice(2)}` : d;
};

/** Seats this customer holds, straight from the server (prices are the server's tier prices). */
async function loadReservation(eventId) {
  const { data } = await api.get(`/venues/event/${eventId}`);
  const d = data.data;
  if (d.layout) return { event: d.event, mine: d.mine || [], serverTime: d.serverTime, legacy: false };
  // Events still on the older seat grid
  const legacy = (await api.get(`/seats/event/${eventId}`)).data.data;
  return {
    event: legacy.event || d.event,
    mine: legacy.seats
      .filter((s) => s.isLockedByMe)
      .map((s) => ({ id: s.id, key: s.id, sectionId: s.section, section: s.section, row: s.row, seatNumber: s.seatNumber, kind: 'SEAT', lockedUntil: s.lockedUntil, tier: s.tier })),
    serverTime: new Date().toISOString(),
    legacy: true,
  };
}

function paymentDetailsFor(method, params, form) {
  if (method === 'JAZZCASH') return { otpCode: form.otp, ppTxnRefNo: params.ppTxnRefNo };
  if (method === 'EASYPAISA') return { otpCode: form.otp, epOrderId: params.epOrderId };
  if (method === 'STRIPE') return { clientSecret: params.clientSecret, paymentIntentId: params.paymentIntentId, paymentTxId: params.paymentIntentId || `ch_${Date.now()}` };
  return { paymentTxId: params.mockTxId };
}

function validate(method, form) {
  const errors = {};
  const phone = normalizePhone(form.phone);
  if (WALLETS.has(method) || form.phone.trim()) {
    if (!/^03\d{9}$/.test(phone)) errors.phone = 'Enter a Pakistani mobile number like 03001234567.';
  }
  if (WALLETS.has(method) && !/^\d{6}$/.test(form.otp)) errors.otp = 'Enter the 6-digit code.';
  if (method === 'STRIPE') {
    if (!form.cardName.trim()) errors.cardName = 'Enter the name on the card.';
  }
  return errors;
}

function Field({ id, label, error, hint, wide, ...input }) {
  return (
    <label className={`tl-co-field${wide ? ' tl-co-field--wide' : ''}`} htmlFor={id}>
      <span className="tl-bk-label">{label}</span>
      <input id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...input} />
      {error ? <span id={`${id}-err`} className="tl-co-field-error">{error}</span> : hint ? <span id={`${id}-hint`} className="tl-bk-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * Checkout: review the event, the reserved tickets (from the server), attendee details, payment method,
 * fees and total, with the reservation countdown. "Confirm order" runs the existing booking flow:
 * POST /bookings/initiate (server prices the order) → POST /bookings/confirm (payment verification,
 * seats sold, tickets issued). The confirmation page only reports success once the server says so.
 */
function CheckoutContent() {
  const stripe = useStripe();
  const elements = useElements();
  const [stripeFocused, setStripeFocused] = useState(false);
  const mountTime = useRef(Date.now());
  const clickCount = useRef(0);

  useEffect(() => {
    const handleGlobalClick = () => { clickCount.current++; };
    window.addEventListener('click', handleGlobalClick);
    window.simulateBot = () => {
      window.__simulateBot = true;
      console.log('🤖 [TicketLedger Security] Bot attack telemetry triggered.');
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    };
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      delete window.simulateBot;
      delete window.__simulateBot;
    };
  }, []);

  const { id: paramId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const dialog = useDialog();
  const [removing, setRemoving] = useState(null); // line id being removed, or 'all'
  const eventId = paramId || location.state?.eventId || new URLSearchParams(location.search).get('event');

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState('');
  const [snap, setSnap] = useState(null);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);

  const [method, setMethod] = useState('MOCK');
  const [form, setForm] = useState({
    phone: user?.phone || '',
    otp: '',
    cardName: user?.name || '',
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/28',
    cardCvc: '123',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [phase, setPhase] = useState('idle'); // idle | reserving | paying
  const [problem, setProblem] = useState(null); // { tone, kind, text }
  const [serverTotal, setServerTotal] = useState(null);
  const [confirmed, setConfirmed] = useState(null); // { order, receipt } once the payment is confirmed
  const inFlight = useRef(false);
  const orderRef = useRef(null); // { id, method, keys, total, params }
  const formRef = useRef(null);
  const problemRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!eventId) return null;
    try {
      const d = await loadReservation(eventId);
      offset.current = new Date(d.serverTime).getTime() - Date.now();
      setSnap(d);
      setStatus('ready');
      return d;
    } catch (e) {
      setLoadError(e.response?.data?.message || 'We couldn’t load your reservation.');
      setStatus('error');
      return null;
    }
  }, [eventId]);

  useEffect(() => {
    if (isAuthenticated) refresh();
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    if (user) setForm((f) => ({ ...f, phone: f.phone || user.phone || '', cardName: f.cardName || user.name || '' }));
  }, [user]);

  const mine = useMemo(() => snap?.mine || [], [snap]);
  const lines = useMemo(() => summaryLines(mine), [mine]);
  const groups = useMemo(() => groupByTier(lines), [lines]);
  const subtotal = lines.reduce((n, l) => n + l.total, 0);
  const total = serverTotal ?? subtotal;
  const keys = useMemo(() => mine.map((m) => m.id).sort().join(','), [mine]);

  // Reservation countdown from the server's own expiry times
  const earliest = useMemo(() => {
    const t = mine.map((m) => new Date(m.lockedUntil).getTime()).filter(Number.isFinite);
    return t.length ? Math.min(...t) : null;
  }, [mine]);
  useEffect(() => {
    if (!earliest) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [earliest]);
  const secondsLeft = earliest ? Math.max(0, Math.round((earliest - (now + offset.current)) / 1000)) : null;
  const expired = secondsLeft === 0;

  // A new selection or method invalidates the server's quote
  useEffect(() => setServerTotal(null), [keys, method]);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  if (!authLoading && !isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname, notice: 'Log in to complete your order. Your seats stay reserved until the timer ends.' }} />;
  }

  // Remove tickets from the order: the seats go back on sale (an unpaid checkout for them is retired)
  const release = async (lineKeys, id) => {
    if (removing || phase !== 'idle') return;
    setRemoving(id);
    setProblem(null);
    try {
      if (snap?.legacy) {
        for (const seatId of lineKeys) await api.post('/seats/unlock', { seatId });
      } else {
        await api.post(`/venues/event/${eventId}/holds/release`, { keys: lineKeys });
      }
      orderRef.current = null; // the next Confirm order prices a fresh order
      window.dispatchEvent(new Event('tl:holds-changed'));
      await refresh();
    } catch (err) {
      setProblem({ tone: 'error', kind: 'remove', text: err.response?.data?.message || 'We couldn’t remove that ticket. Please try again.' });
    } finally {
      setRemoving(null);
    }
  };
  const trackedCheckoutRef = useRef(false);
  useEffect(() => {
    if (eventId && mine.length > 0 && isAuthenticated && !trackedCheckoutRef.current) {
      trackedCheckoutRef.current = true;
      api.post('/behavior/track', {
        action: 'checkout_started',
        eventId,
        metadata: { seatCount: mine.length, cartValue: total },
      }).catch(() => {});
    }
  }, [eventId, mine.length, isAuthenticated, total]);

  const removeLine = (l) => release(l.keys, l.id);
  const discardAll = async () => {
    const ok = await dialog.confirm({
      tone: 'error',
      title: 'Discard all tickets?',
      message: `Your ${mine.length} reserved ticket${mine.length === 1 ? '' : 's'} will be released for other fans. You can choose seats again any time.`,
      confirmLabel: 'Discard tickets',
      cancelLabel: 'Keep them',
    });
    if (ok) {
      api.post('/behavior/track', {
        action: 'checkout_abandoned',
        eventId,
        metadata: { seatCount: mine.length, cartValue: total, reason: 'user_discarded_tickets' },
      }).catch(() => {});
      release(lines.flatMap((l) => l.keys), 'all');
    }
  };

  const setField = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (fieldErrors[k]) setFieldErrors((fe) => ({ ...fe, [k]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (inFlight.current || phase !== 'idle') return; // no double submissions
    if (expired) return setProblem({ tone: 'error', kind: 'expired', text: 'Your reservation has expired, so these seats were released.' });
    const errors = validate(method, form);
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      formRef.current?.querySelector(`#co-${first}`)?.focus();
      return;
    }

    inFlight.current = true;
    setProblem(null);
    let stage = 'initiate';
    try {
      let order = orderRef.current;
      if (!order || order.method !== method || order.keys !== keys) {
        setPhase('reserving');
        const durationSec = Math.max(0.1, (Date.now() - mountTime.current) / 1000);
        const clicksPerMin = Math.round((clickCount.current / Math.max(1, durationSec)) * 60) || 28;
        const isBotAttack = new URLSearchParams(window.location.search).has('bot') || window.__simulateBot === true;

        const telemetry = isBotAttack
          ? {
              checkoutDurationSeconds: 0.4,
              clicksPerMinute: 240,
              rapidSeatAttempts: 6,
              deviceSwitches: 2,
            }
          : {
              checkoutDurationSeconds: Number(durationSec.toFixed(1)),
              clicksPerMinute: Math.min(180, clicksPerMin),
              rapidSeatAttempts: 1,
              deviceSwitches: 0,
            };

        const { data } = await api.post('/bookings/initiate', {
          eventId,
          seatIds: mine.map((m) => m.id),
          paymentMethod: method,
          customerPhone: normalizePhone(form.phone) || undefined,
          telemetry,
        });
        const d = data.data;
        order = { id: d.orderId, method, keys, total: Number(d.totalAmount), params: d.paymentParams };
        orderRef.current = order;
        // The server prices the order; if that differs from what was shown, stop and let the customer review
        if(Math.abs(order.total - subtotal) > 0.009) {
          setServerTotal(order.total);
          setProblem({ tone: 'warn', kind: 'price', text: `The total was recalculated by the server: ${formatPkr(order.total)} (shown before: ${formatPkr(subtotal)}). Review the order and press Confirm order again to pay.` });
          return;
        }
      }

      stage = 'confirm';
      setPhase('paying');

      let paymentDetails = paymentDetailsFor(method, order.params, form);

      // Handle real Stripe Sandbox checkout if clientSecret is issued
      if (method === 'STRIPE' && stripe && elements) {
        const cardElement = elements.getElement(CardElement);
        if (cardElement && order.params?.clientSecret && !order.params.clientSecret.includes('mock')) {
          const stripeRes = await stripe.confirmCardPayment(order.params.clientSecret, {
            payment_method: {
              card: cardElement,
              billing_details: {
                name: form.cardName || user?.name || 'Customer',
                email: user?.email,
                phone: normalizePhone(form.phone) || undefined,
              },
            },
          });

          if (stripeRes.error) {
            setProblem({
              tone: 'error',
              kind: 'payment',
              text: stripeRes.error.message || 'Stripe card authorization failed. Please check the details and try again.',
            });
            inFlight.current = false;
            setPhase('idle');
            return;
          }

          paymentDetails = {
            paymentIntentId: stripeRes.paymentIntent.id,
            paymentTxId: stripeRes.paymentIntent.id,
            cardLast4: stripeRes.paymentIntent.payment_method?.card?.last4 || '4242',
          };
        }
      }

      let res;
      try {
        res = await api.post('/bookings/confirm', { orderId: order.id, paymentDetails }, { timeout: 45000 });
      } catch (err) {
        // No answer from the server: the payment's outcome is unknown, so show the order's live status
        if (!err.response) {
          navigate(`/bookings/${order.id}/confirmation`, { replace: true, state: { eventId, pending: true } });
          return;
        }
        throw err;
      }
      const d = res.data.data;
      if (d.order?.status === 'SUCCESSFUL') {
        // Confirmed: show the "You're going" pop-up over this page; the held seats are now sold
        setConfirmed({ order: d.order, receipt: d.paymentReceipt });
        window.dispatchEvent(new Event('tl:holds-changed'));
      } else {
        navigate(`/bookings/${order.id}/confirmation`, { replace: true, state: { eventId, order: d.order, receipt: d.paymentReceipt } });
      }
    } catch (err) {
      const code = err.response?.status;
      const msg = err.response?.data?.message || 'Something went wrong. Please try again.';
      if (!err.response) {
        setProblem({ tone: 'error', kind: 'network', text: 'We couldn’t reach TicketLedger. Check your connection and try again — nothing has been charged.' });
      } else if (stage === 'initiate') {
        if (err.response?.data?.blockedByAI) {
          const anomalies = err.response?.data?.data?.anomalyFactors?.join(' • ') || '';
          setProblem({ tone: 'error', kind: 'blocked', text: `🚨 ${msg} ${anomalies ? `(Signals: ${anomalies})` : ''}` });
        }
        else if (code === 409) {
          setProblem({ tone: 'error', kind: 'reservation', text: msg });
          await refresh();
        } else setProblem({ tone: 'error', kind: 'validation', text: msg });
      } else if (code === 409 || /cancelled or expired/i.test(msg)) {
        orderRef.current = null;
        setProblem({ tone: 'error', kind: 'expired', text: msg });
        await refresh();
      } else {
        // Payment declined: the order stays open, so trying again re-uses it
        setProblem({ tone: 'error', kind: 'payment', text: `Payment wasn’t completed: ${msg} Your seats are still reserved — check the details and try again, or choose another payment method.` });
      }
    } finally {
      inFlight.current = false;
      setPhase('idle');
    }
  };

  // ---------- Render ----------
  const event = snap?.event;
  const time = formatEventTime(event?.time);
  const busy = phase !== 'idle';
  const urgent = secondsLeft != null && secondsLeft < 60;
  const seatsHref = `/events/${eventId}/seats`;

  const header = (
    <>
      <Link to={eventId ? seatsHref : '/events'} className="tl-bk-back">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {eventId ? 'Back to seats' : 'Explore events'}
      </Link>
      <header className="tl-bk-head tl-bk-rise">
        <div>
          <p className="tl-bk-kicker">Review &amp; pay</p>
          <h1 className="tl-bk-title">Checkout</h1>
        </div>
        <BookingSteps current="checkout" />
      </header>
    </>
  );

  if (!eventId || status === 'error' || (status === 'ready' && mine.length === 0)) {
    return (
      <BookingShell>
        {header}
        <section className="tl-bk-panel tl-co-status" aria-labelledby="co-empty">
          <span className="tl-co-status-icon" aria-hidden="true"><AlertTriangle className="w-6 h-6" /></span>
          <h2 id="co-empty" className="tl-co-status-title">{status === 'error' ? 'Checkout unavailable' : 'No reserved tickets'}</h2>
          <p>{status === 'error' ? loadError : 'Your reservation may have expired, or no seats have been selected yet. Choose seats to start a new order.'}</p>
          <div className="tl-co-actions">
            {eventId && <Link to={seatsHref} className="tl-bk-btn">Choose seats</Link>}
            {status === 'error' && <button type="button" className="tl-bk-btn tl-bk-btn--ghost" onClick={refresh}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again</button>}
            <Link to="/events" className="tl-bk-btn tl-bk-btn--ghost">Explore events</Link>
          </div>
        </section>
      </BookingShell>
    );
  }

  if (status === 'loading' || authLoading) {
    return (
      <BookingShell>
        {header}
        <div className="tl-co-grid" aria-busy="true">
          <div className="tl-vb-skeleton" style={{ height: 520 }} />
          <div className="tl-vb-skeleton" style={{ height: 360 }} />
        </div>
        <p className="tl-sr" role="status">Loading your reservation…</p>
      </BookingShell>
    );
  }

  return (
    <BookingShell>
      {header}
      <form ref={formRef} onSubmit={submit} noValidate className="tl-co-grid">
        <div className="tl-bk-rise">
          {/* Event */}
          <section className="tl-bk-panel" aria-labelledby="co-event">
            <h2 id="co-event" className="tl-bk-h2">Event</h2>
            <div className="tl-co-event">
              <img src={getEventVisual(event).imageUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              <div>
                <p className="tl-co-event-name">{event?.name}</p>
                <div className="tl-co-event-meta">
                  <span><MapPin className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> {event?.venue}, {event?.city}</span>
                  {event?.date && <span><Calendar className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> {formatEventDate(event.date)}{time && ` · ${time}`}</span>}
                </div>
              </div>
            </div>
          </section>

          {/* Tickets */}
          <section className="tl-bk-panel" aria-labelledby="co-tickets">
            <h2 id="co-tickets" className="tl-bk-h2">
              Your tickets <small>{mine.length} ticket{mine.length === 1 ? '' : 's'}</small>
            </h2>
            <div className="tl-co-lines">
              {groups.map((g) => (
                <div key={g.key} className="tl-co-group">
                  <p className="tl-vb-group-name">{g.name} <span>{g.qty} × {formatPkr(g.unit)}</span></p>
                  {g.lines.map((l) => (
                    <p key={l.id} className={`tl-co-line${removing === l.id || removing === 'all' ? ' is-removing' : ''}`}>
                      <span><b>{lineTitle(l)}</b>{l.qty > 1 && <span className="tl-co-qty"> · {l.qty} × {formatPkr(l.unit)}</span>}</span>
                      <span className="tl-co-line-end">
                        {formatPkr(l.total)}
                        <button
                          type="button"
                          className="tl-co-remove"
                          onClick={() => removeLine(l)}
                          disabled={Boolean(removing) || busy}
                          aria-label={`Remove ${lineTitle(l)}${l.qty > 1 ? ` (${l.qty} tickets)` : ''}`}
                          title="Remove"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
            <div className="tl-co-ticket-actions">
              <Link to={seatsHref} className="tl-bk-link">Change seats</Link>
              <button type="button" className="tl-co-discard" onClick={discardAll} disabled={Boolean(removing) || busy}>
                <Trash2 className="w-4 h-4" aria-hidden="true" /> {removing === 'all' ? 'Discarding…' : 'Discard all'}
              </button>
            </div>
          </section>

          {/* Attendee */}
          <fieldset className="tl-bk-panel" disabled={busy} aria-labelledby="co-attendee">
            <h2 id="co-attendee" className="tl-bk-h2">Attendee details</h2>
            <div className="tl-co-fields">
              <Field id="co-name" label="Name" value={user?.name || ''} readOnly />
              <Field id="co-email" label="Email" value={user?.email || ''} readOnly hint="Tickets and the receipt are sent here." />
              <Field
                id="co-phone"
                label={WALLETS.has(method) ? 'Mobile wallet number' : 'Mobile number (optional)'}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="03001234567"
                value={form.phone}
                onChange={setField('phone')}
                error={fieldErrors.phone}
                wide
              />
            </div>
            <p className="tl-bk-muted" style={{ marginTop: 12 }}>All tickets in this order are issued to your TicketLedger account{user?.name ? ` (${user.name})` : ''}.</p>
          </fieldset>

          {/* Payment */}
          <fieldset className="tl-bk-panel" disabled={busy}>
            <legend className="tl-sr">Payment method</legend>
            <h2 className="tl-bk-h2" aria-hidden="true">Payment</h2>
            <div className="tl-co-methods" role="radiogroup" aria-label="Payment method">
              {METHODS.map((m) => (
                <label key={m.value} className="tl-co-method">
                  <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => { setMethod(m.value); setFieldErrors({}); setProblem(null); }} />
                  <span className="tl-co-radio" aria-hidden="true" />
                  <span><strong>{m.label}</strong><small>{m.note}</small></span>
                </label>
              ))}
            </div>
            {WALLETS.has(method) && (
              <div className="tl-co-gateway">
                <p className="tl-bk-muted">{method === 'JAZZCASH' ? 'JazzCash' : 'EasyPaisa'} sends an authorisation request to the number above. Sandbox code: 123456.</p>
                <Field id="co-otp" label={method === 'JAZZCASH' ? 'MPIN / SMS code' : 'Authorisation code'} type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tl-co-mono" value={form.otp} onChange={setField('otp')} error={fieldErrors.otp} />
              </div>
            )}
            {method === 'STRIPE' && (
              <div className="tl-co-gateway">
                <Field
                  id="co-cardName"
                  label="Name on card"
                  autoComplete="cc-name"
                  value={form.cardName}
                  onChange={setField('cardName')}
                  error={fieldErrors.cardName}
                  wide
                />
                <label className="tl-co-field tl-co-field--wide" htmlFor="co-stripe-card">
                  <span className="tl-bk-label">Card details (Stripe Sandbox)</span>
                  <div className={`tl-stripe-element-wrapper${stripeFocused ? ' is-focused' : ''}`}>
                    <CardElement
                      id="co-stripe-card"
                      onFocus={() => setStripeFocused(true)}
                      onBlur={() => setStripeFocused(false)}
                      options={{
                        hidePostalCode: true,
                        style: {
                          base: {
                            fontSize: '15px',
                            color: '#0f172a',
                            fontFamily: 'Inter, system-ui, sans-serif',
                            '::placeholder': { color: '#94a3b8' },
                          },
                          invalid: { color: '#ef4444' },
                        },
                      }}
                    />
                  </div>
                  <span className="tl-stripe-badge">
                    ⚡ Sandbox Card: <strong>4242 4242 4242 4242</strong> · Any future MM/YY · CVC 123
                  </span>
                </label>
              </div>
            )}
            {method === 'MOCK' && <p className="tl-co-gateway tl-bk-muted">Sandbox payment for testing: the order is confirmed immediately without charging anything.</p>}
          </fieldset>
        </div>

        {/* Order summary */}
        <aside className="tl-co-aside tl-bk-rise" aria-labelledby="co-summary">
          <section className="tl-bk-panel">
            <h2 id="co-summary" className="tl-bk-h2">Order summary</h2>
            <div className={`tl-co-reserve${expired ? ' is-expired' : urgent ? ' is-urgent' : ''}`} role="timer" aria-live={urgent || expired ? 'polite' : 'off'}>
              <span><Clock className="w-4 h-4 inline -mt-0.5" aria-hidden="true" /> {expired ? 'Reservation expired' : 'Seats reserved for'}</span>
              {!expired && <strong className="tl-co-mono">{formatClock(secondsLeft)}</strong>}
            </div>
            <dl className="tl-co-sum">
              <div><dt>Tickets ({mine.length})</dt><dd>{formatPkr(subtotal)}</dd></div>
              <div><dt>Service fee</dt><dd>{formatPkr(0)}</dd></div>
              <div><dt>NFT minting &amp; network gas</dt><dd>Included</dd></div>
              {serverTotal != null && serverTotal !== subtotal && <div><dt>Price adjustment (server)</dt><dd>{formatPkr(serverTotal - subtotal)}</dd></div>}
            </dl>
            <p className="tl-co-total"><span>Total</span><strong>{formatPkr(total)}</strong></p>

            {problem && (
              <div
                ref={problemRef}
                tabIndex={-1}
                className={`tl-bk-notice is-${problem.tone}`}
                role="alert"
                style={problem.kind === 'blocked' ? {
                  background: '#fef2f2',
                  border: '1.5px solid #ef4444',
                  color: '#991b1b',
                  padding: '14px',
                  borderRadius: '8px',
                  fontWeight: 500,
                  fontSize: '13px',
                  lineHeight: '1.5',
                } : {}}
              >
                {problem.text}
                {(problem.kind === 'expired' || problem.kind === 'reservation') && (
                  <div><Link to={seatsHref} className="tl-bk-link">Choose seats again</Link></div>
                )}
              </div>
            )}
            {expired && !problem && (
              <div className="tl-bk-notice is-error" role="alert">
                Your reservation ended and the seats were released. <div><Link to={seatsHref} className="tl-bk-link">Choose seats again</Link></div>
              </div>
            )}

            <div className="tl-co-confirm">
              <button type="submit" className="tl-bk-btn tl-bk-btn--block tl-bk-btn--lg" disabled={busy || expired} aria-busy={busy}>
                {busy ? (
                  <>
                    <span>{phase === 'reserving' ? 'Creating your order…' : 'Confirming payment…'}</span>
                    <span className="tl-bk-spin" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <span>Confirm order</span>
                    <span><Lock className="w-4 h-4 inline -mt-0.5" aria-hidden="true" /> {formatPkr(total)}</span>
                  </>
                )}
              </button>
              <p className="tl-sr" role="status" aria-live="polite">{busy ? (phase === 'reserving' ? 'Creating your order' : 'Confirming payment. Please keep this page open.') : ''}</p>
              <p className="tl-co-fine">
                Pressing Confirm order pays {formatPkr(total)} with {METHODS.find((m) => m.value === method)?.label}. Tickets are issued only after the payment is confirmed. Resale is capped at 110% of face value.
              </p>
            </div>
          </section>
        </aside>
      </form>
      {confirmed && (
        <OrderConfirmedModal order={confirmed.order} receipt={confirmed.receipt} onClose={() => navigate(`/events/${eventId}`, { replace: true })} />
      )}
    </BookingShell>
  );
}

export default function Checkout() {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutContent />
    </Elements>
  );
}
