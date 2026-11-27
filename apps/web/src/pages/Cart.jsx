import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock, Lock, MapPin, ShoppingBag } from 'lucide-react';
import api from '../utils/api';
import usePaymentMethods, { firstAvailable } from '../hooks/usePaymentMethods';
import { useAuth } from '../context/AuthContext';
import BookingShell from '../components/booking/BookingShell';
import { formatPkr } from '../components/venue/venueTheme';
import { formatEventDate } from '../utils/eventTime';
import { formatClock } from '../components/venue/BookingSummary';

/*
 * Cart (/cart): seats held for several events, paid together with one payment. Each event's seats become an
 * order (initiate with cart: true, priced by the server with that event's fees and discounts), then one
 * checkout pays for all of them. Card payments and discount codes go through each event's own checkout.
 */

// Which ones can be used comes from the server (GET /api/payments/methods)
const METHODS = [
  { value: 'MOCK', label: 'Test payment', note: 'Development only · no money is charged' },
  { value: 'JAZZCASH', label: 'JazzCash', note: 'Mobile wallet' },
  { value: 'EASYPAISA', label: 'EasyPaisa', note: 'Mobile wallet' },
];
const newKey = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `cart-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function Cart() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const location = useLocation();
  const [holds, setHolds] = useState(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [quotes, setQuotes] = useState({});
  const available = usePaymentMethods();
  const [method, setMethod] = useState(null);
  useEffect(() => {
    if (available && !available[method]?.available) setMethod(firstAvailable(available, METHODS.map((m) => m.value)));
  }, [available, method]);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | paying | done
  const [problem, setProblem] = useState('');
  const [result, setResult] = useState(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const keys = useRef({});

  const load = useCallback(async () => {
    try {
      const r = await api.get('/venues/holds/mine');
      setOffset(new Date(r.data.data.serverTime).getTime() - Date.now());
      setHolds(r.data.data.holds || []);
      const q = {};
      for (const h of r.data.data.holds || []) {
        q[h.eventId] = await api.post('/bookings/quote', { eventId: h.eventId, seatIds: h.seats.map((s) => s.id) }).then((x) => x.data.data).catch(() => null);
      }
      setQuotes(q);
    } catch {
      setHolds([]);
    }
  }, []);
  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!authLoading && !isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const live = (holds || []).filter((h) => new Date(h.expiresAt).getTime() > now + offset);
  const total = live.reduce((n, h) => n + (quotes[h.eventId]?.total ?? Number(h.totalPrice)), 0);
  const secondsLeft = live.length ? Math.max(0, Math.round((Math.min(...live.map((h) => new Date(h.expiresAt).getTime())) - (now + offset)) / 1000)) : null;
  const wallet = method === 'JAZZCASH' || method === 'EASYPAISA';

  const pay = async (e) => {
    e.preventDefault();
    if (wallet && !/^03\d{9}$/.test(phone.replace(/\D/g, ''))) return setProblem('Enter your mobile wallet number like 03001234567.');
    if (wallet && !/^\d{6}$/.test(otp)) return setProblem('Enter the 6-digit code.');
    if (!acceptTerms) return setProblem("Please accept the events' terms to continue.");
    setPhase('paying');
    setProblem('');
    try {
      const orderIds = [];
      for (const h of live) {
        keys.current[h.eventId] = keys.current[h.eventId] || newKey();
        const r = await api.post('/bookings/initiate', { eventId: h.eventId, seatIds: h.seats.map((s) => s.id), paymentMethod: method, cart: true, acceptTerms: true }, { headers: { 'Idempotency-Key': keys.current[h.eventId] } });
        orderIds.push(r.data.data.orderId);
      }
      const co = await api.post('/bookings/cart/checkout', { orderIds, paymentMethod: method, customerPhone: phone || undefined });
      const params = co.data.data.paymentParams;
      const paymentDetails = method === 'JAZZCASH' ? { otpCode: otp, ppTxnRefNo: params.ppTxnRefNo } : method === 'EASYPAISA' ? { otpCode: otp, epOrderId: params.epOrderId } : { paymentTxId: params.mockTxId };
      const done = await api.post('/bookings/cart/confirm', { groupId: co.data.data.groupId, paymentDetails }, { timeout: 60000 });
      setResult(done.data);
      setPhase('done');
      window.dispatchEvent(new Event('tl:holds-changed'));
    } catch (err) {
      setPhase('idle');
      setProblem(err.response?.data?.message || 'The payment could not be completed. Your seats are still held; try again.');
      load();
    }
  };

  const header = (
    <>
      <Link to="/events" className="tl-bk-back"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Explore events</Link>
      <header className="tl-bk-head tl-bk-rise">
        <div>
          <p className="tl-bk-kicker">Several events, one payment</p>
          <h1 className="tl-bk-title">Your cart</h1>
        </div>
      </header>
    </>
  );

  if (phase === 'done' && result) {
    return (
      <BookingShell>
        {header}
        <section className="tl-bk-panel">
          <h2 className="tl-bk-h2">Paid</h2>
          <p>{result.message}</p>
          <ul className="tl-co-lines" style={{ marginTop: 12 }}>
            {result.data.confirmed.map((c) => <li key={c.id} className="tl-co-line"><span><b>{c.event}</b> · confirmed</span><span className="tl-co-mono">{c.invoiceNumber}</span></li>)}
            {result.data.lapsed.map((c) => <li key={c.id} className="tl-co-line"><span><b>{c.event}</b> · reservation expired{c.refunded ? ', refunded' : ''}</span><span>{formatPkr(c.amount)}</span></li>)}
          </ul>
          <div className="tl-co-actions" style={{ marginTop: 16 }}><Link to="/wallet" className="tl-bk-btn">Open my tickets</Link><Link to="/my-bookings" className="tl-bk-btn tl-bk-btn--ghost">My bookings</Link></div>
        </section>
      </BookingShell>
    );
  }

  return (
    <BookingShell>
      {header}
      {holds === null ? <div className="tl-vb-skeleton" style={{ height: 320 }} /> : !live.length ? (
        <section className="tl-bk-panel tl-co-status">
          <span className="tl-co-status-icon" aria-hidden="true"><ShoppingBag className="w-6 h-6" /></span>
          <h2 className="tl-co-status-title">Your cart is empty</h2>
          <p>Hold seats for one or more events; they appear here so you can pay for them together.</p>
          <div className="tl-co-actions"><Link to="/events" className="tl-bk-btn">Explore events</Link></div>
        </section>
      ) : (
        <form className="tl-co-grid" onSubmit={pay} noValidate>
          <div className="tl-bk-rise">
            {live.map((h) => {
              const q = quotes[h.eventId];
              return (
                <section key={h.eventId} className="tl-bk-panel" aria-label={h.eventName}>
                  <h2 className="tl-bk-h2">{h.eventName} <small>{h.count} ticket{h.count === 1 ? '' : 's'}</small></h2>
                  <div className="tl-co-event-meta">
                    <span><MapPin className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> {h.venue}, {h.city}</span>
                    {h.date && <span><Calendar className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> {formatEventDate(h.date)}</span>}
                  </div>
                  <div className="tl-co-lines" style={{ marginTop: 10 }}>
                    {h.seats.map((s) => <p key={s.id} className="tl-co-line"><span><b>{s.tierName}</b> · {[s.section, s.row && `Row ${s.row}`, s.seatNumber && `Seat ${s.seatNumber}`].filter(Boolean).join(' · ')}</span><span className="tl-co-line-end">{formatPkr(s.price)}</span></p>)}
                  </div>
                  {q && (q.groupDiscount > 0 || q.serviceFee > 0 || q.tax > 0) && (
                    <p className="tl-bk-muted" style={{ marginTop: 8 }}>
                      {q.groupDiscount > 0 && `Group discount −${formatPkr(q.groupDiscount)} · `}{q.serviceFee > 0 && `Service fee ${formatPkr(q.serviceFee)} · `}{q.tax > 0 && `${q.taxLabel} ${formatPkr(q.tax)} · `}Total {formatPkr(q.total)}
                    </p>
                  )}
                  <div className="tl-co-ticket-actions"><Link to={`/events/${h.eventId}/checkout`} className="tl-bk-link">Pay for this event alone (card, discount code)</Link></div>
                </section>
              );
            })}
            <fieldset className="tl-bk-panel" disabled={phase !== 'idle'}>
              <legend className="sr-only">Payment method</legend>
              <h2 className="tl-bk-h2" aria-hidden="true">Payment</h2>
              <div className="tl-co-methods" role="radiogroup" aria-label="Payment method">
                {METHODS.filter((m) => m.value !== 'MOCK' || available?.MOCK?.available).map((m) => {
                  const off = !available?.[m.value]?.available;
                  return (
                    <label key={m.value} className="tl-co-method" aria-disabled={off || undefined} style={off ? { opacity: 0.55 } : undefined}>
                      <input type="radio" name="method" value={m.value} disabled={off} checked={method === m.value} onChange={() => { setMethod(m.value); setProblem(''); }} />
                      <span className="tl-co-radio" aria-hidden="true" />
                      <span><strong>{m.label}</strong><small>{off ? (available ? 'Coming soon' : 'Checking…') : m.note}</small></span>
                    </label>
                  );
                })}
              </div>
              {available && !method && <p className="tl-co-gateway" role="alert">Paying for several events at once is not available right now. Pay for each event from its own checkout.</p>}
              {wallet && (
                <div className="tl-co-gateway">
                  <label className="tl-co-field" htmlFor="cart-phone"><span className="tl-bk-label">Mobile wallet number</span><input id="cart-phone" type="tel" inputMode="tel" placeholder="03001234567" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                  <label className="tl-co-field" htmlFor="cart-otp"><span className="tl-bk-label">Code (sandbox: 123456)</span><input id="cart-otp" className="tl-co-mono" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} /></label>
                </div>
              )}
            </fieldset>
          </div>
          <aside className="tl-co-aside tl-bk-rise">
            <section className="tl-bk-panel">
              <h2 className="tl-bk-h2">Order summary</h2>
              <div className={`tl-co-reserve${secondsLeft != null && secondsLeft < 60 ? ' is-urgent' : ''}`} role="timer"><span><Clock className="w-4 h-4 inline -mt-0.5" aria-hidden="true" /> First hold ends in</span><strong className="tl-co-mono">{formatClock(secondsLeft)}</strong></div>
              <dl className="tl-co-sum">
                {live.map((h) => <div key={h.eventId}><dt>{h.eventName}</dt><dd>{formatPkr(quotes[h.eventId]?.total ?? h.totalPrice)}</dd></div>)}
              </dl>
              <p className="tl-co-total"><span>Total</span><strong>{formatPkr(total)}</strong></p>
              {problem && <div className="tl-bk-notice is-error" role="alert">{problem}</div>}
              <label className="tl-co-terms"><input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} /> <span>I accept each event's terms (shown on its event page)</span></label>
              <div className="tl-co-confirm">
                <button type="submit" className="tl-bk-btn tl-bk-btn--block tl-bk-btn--lg" disabled={phase !== 'idle' || !method}>
                  {phase === 'paying' ? <><span>Paying…</span><span className="tl-bk-spin" aria-hidden="true" /></> : <><span>Pay for {live.length} event{live.length === 1 ? '' : 's'}</span><span><Lock className="w-4 h-4 inline -mt-0.5" aria-hidden="true" /> {formatPkr(total)}</span></>}
                </button>
                <p className="tl-co-fine">One payment confirms every event. If a reservation expires before the payment arrives, that event is left out and its share is not kept.</p>
              </div>
            </section>
          </aside>
        </form>
      )}
    </BookingShell>
  );
}
