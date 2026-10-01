import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calendar, Clock, Lock, MapPin, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import BookingShell, { BookingSteps } from '../components/booking/BookingShell';
import { formatClock, groupByTier, lineTitle, summaryLines } from '../components/venue/BookingSummary';
import { formatPkr } from '../components/venue/venueTheme';
import { getEventVisual } from '../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../utils/eventTime';

// The payment options the API already supports (bookingController / paymentService)
const METHODS = [
  { value: 'MOCK', label: 'Instant test payment', note: 'Sandbox · confirms immediately' },
  { value: 'JAZZCASH', label: 'JazzCash', note: 'Mobile wallet · MPIN / OTP' },
  { value: 'EASYPAISA', label: 'EasyPaisa', note: 'Mobile wallet · OTP' },
  { value: 'STRIPE', label: 'Card', note: 'Visa / Mastercard via Stripe' },
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
  if (d.layout) return { event: d.event, mine: d.mine || [], serverTime: d.serverTime };
  // Events still on the older seat grid
  const legacy = (await api.get(`/seats/event/${eventId}`)).data.data;
  return {
    event: legacy.event || d.event,
    mine: legacy.seats
      .filter((s) => s.isLockedByMe)
      .map((s) => ({ id: s.id, key: s.id, sectionId: s.section, section: s.section, row: s.row, seatNumber: s.seatNumber, kind: 'SEAT', lockedUntil: s.lockedUntil, tier: s.tier })),
    serverTime: new Date().toISOString(),
  };
}

function paymentDetailsFor(method, params, form) {
  if (method === 'JAZZCASH') return { otpCode: form.otp, ppTxnRefNo: params.ppTxnRefNo };
  if (method === 'EASYPAISA') return { otpCode: form.otp, epOrderId: params.epOrderId };
  if (method === 'STRIPE') return { clientSecret: params.clientSecret, paymentTxId: `ch_${Date.now()}`, cardLast4: digits(form.cardNumber).slice(-4) };
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
    if (!/^\d{15,16}$/.test(digits(form.cardNumber))) errors.cardNumber = 'Enter a valid card number.';
    const m = form.cardExpiry.match(/^\s*(\d{2})\s*\/\s*(\d{2})\s*$/);
    const now = new Date();
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || new Date(2000 + Number(m[2]), Number(m[1])) <= now) errors.cardExpiry = 'Enter a future expiry date as MM/YY.';
    if (!/^\d{3,4}$/.test(form.cardCvc)) errors.cardCvc = 'Enter the 3 or 4 digit code.';
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
export default function Checkout() {
  const { id: paramId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { user, isAuthenticated, loading: authLoading } = useAuth();
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
        const { data } = await api.post('/bookings/initiate', {
          eventId,
          seatIds: mine.map((m) => m.id),
          paymentMethod: method,
          customerPhone: normalizePhone(form.phone) || undefined,
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
      let res;
      try {
        res = await api.post('/bookings/confirm', { orderId: order.id, paymentDetails: paymentDetailsFor(method, order.params, form) }, { timeout: 45000 });
      } catch (err) {
        // No answer from the server: the payment's outcome is unknown, so show the order's live status
        if (!err.response) {
          navigate(`/bookings/${order.id}/confirmation`, { replace: true, state: { eventId, pending: true } });
          return;
        }
        throw err;
      }
      const d = res.data.data;
      navigate(`/bookings/${order.id}/confirmation`, { replace: true, state: { eventId, order: d.order, receipt: d.paymentReceipt } });
    } catch (err) {
      const code = err.response?.status;
      const msg = err.response?.data?.message || 'Something went wrong. Please try again.';
      if (!err.response) {
        setProblem({ tone: 'error', kind: 'network', text: 'We couldn’t reach TicketLedger. Check your connection and try again — nothing has been charged.' });
      } else if (stage === 'initiate') {
        if (err.response?.data?.blockedByAI) setProblem({ tone: 'error', kind: 'blocked', text: msg });
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
                    <p key={l.id} className="tl-co-line">
                      <span><b>{lineTitle(l)}</b>{l.qty > 1 && <span className="tl-co-qty"> · {l.qty} × {formatPkr(l.unit)}</span>}</span>
                      <span>{formatPkr(l.total)}</span>
                    </p>
                  ))}
                </div>
              ))}
            </div>
            <Link to={seatsHref} className="tl-bk-link">Change seats</Link>
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
              <div className="tl-co-gateway tl-co-fields">
                <Field id="co-cardName" label="Name on card" autoComplete="cc-name" value={form.cardName} onChange={setField('cardName')} error={fieldErrors.cardName} wide />
                <Field id="co-cardNumber" label="Card number" inputMode="numeric" autoComplete="cc-number" className="tl-co-mono" value={form.cardNumber} onChange={setField('cardNumber')} error={fieldErrors.cardNumber} wide hint="Stripe test mode: 4242 4242 4242 4242." />
                <Field id="co-cardExpiry" label="Expiry (MM/YY)" autoComplete="cc-exp" className="tl-co-mono" value={form.cardExpiry} onChange={setField('cardExpiry')} error={fieldErrors.cardExpiry} />
                <Field id="co-cardCvc" label="CVC" inputMode="numeric" autoComplete="cc-csc" className="tl-co-mono" maxLength={4} value={form.cardCvc} onChange={setField('cardCvc')} error={fieldErrors.cardCvc} />
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
              <div ref={problemRef} tabIndex={-1} className={`tl-bk-notice is-${problem.tone}`} role="alert">
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
    </BookingShell>
  );
}
