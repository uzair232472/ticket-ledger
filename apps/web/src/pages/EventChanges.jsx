import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, Ban, CalendarClock, CheckCircle2, ChevronRight, Clock, History, Loader2, PauseCircle,
  Receipt, Send, Tag, Ticket, Undo2, Users,
} from 'lucide-react';
import api from '../utils/api';
import { useDialog } from '../components/ui/DialogProvider';

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;
const PKT = 5 * 60 * 60 * 1000;
// Instant → PKT { date: "2026-10-21", time: "19:00" }
const pktParts = (iso) => {
  if (!iso) return { date: '', time: '' };
  const s = new Date(new Date(iso).getTime() + PKT).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
};
const toTimeText = (value) => {
  if (!value) return '';
  const [h, m] = value.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} PKT`;
};
const slot = (startsAt, venue, city) => {
  if (!startsAt) return `${venue}, ${city}`;
  const d = new Date(startsAt);
  return `${d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}, ${d.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' })} · ${venue}, ${city}`;
};
const when = (iso) => new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
const CHANGE_STATE = { APPROVED: ['Applied', 'is-ok'], REJECTED: ['Not approved', 'is-bad'], WITHDRAWN: ['Withdrawn', ''], PENDING: ['Waiting for admin', 'is-wait'] };

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="tl-lc-stat">
      <Icon className="w-5 h-5" aria-hidden="true" />
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

/**
 * Organizer: cancel, postpone or move an event that has ticket holders. Every route tells the holders
 * (in-app and by email); cancelling refunds them, and moving gives them a window to get a refund.
 */
export default function EventChanges() {
  const { id } = useParams();
  const dialog = useDialog();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(null);
  const [fieldError, setFieldError] = useState({});
  const [venueCheck, setVenueCheck] = useState({ status: 'idle' });
  const [postponeReason, setPostponeReason] = useState('');
  const [cancel, setCancel] = useState({ reason: '', confirmName: '' });

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/events/${id}/lifecycle`);
      setData(res.data.data);
      const ev = res.data.data.event;
      const start = pktParts(ev.startsAt || ev.date);
      const end = pktParts(ev.endsAt || ev.startsAt || ev.date);
      setForm((prev) => prev || { date: start.date, time: start.time, endDate: end.date, endTime: end.time, city: ev.city, venue: ev.venue, reason: '' });
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this event.');
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  // Live venue check for the new slot (the API checks again when the change is applied)
  const seq = useRef(0);
  useEffect(() => {
    if (!form || !form.date || !form.time || !form.endDate || !form.endTime || form.venue.trim().length < 2) return undefined;
    const mine = ++seq.current;
    setVenueCheck({ status: 'checking' });
    const timer = setTimeout(() => {
      api
        .get('/events/schedule-check', { params: { city: form.city, venue: form.venue.trim(), date: form.date, time: toTimeText(form.time), endDate: form.endDate, endTime: toTimeText(form.endTime), excludeEventId: id } })
        .then((res) => mine === seq.current && setVenueCheck(res.data.data.available ? { status: 'free' } : { status: 'conflict', message: res.data.data.message }))
        .catch(() => mine === seq.current && setVenueCheck({ status: 'error' }));
    }, 400);
    return () => clearTimeout(timer);
  }, [form?.date, form?.time, form?.endDate, form?.endTime, form?.city, form?.venue, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) {
    return (
      <div className="tl-wz-card" style={{ maxWidth: 640, margin: '48px auto', textAlign: 'center' }}>
        <AlertCircle className="w-7 h-7" style={{ margin: '0 auto 12px', color: 'var(--st-rose)' }} />
        <h2>Can’t open this event</h2>
        <p style={{ margin: '8px 0 20px', color: 'var(--st-muted)' }}>{error}</p>
        <Link to="/organizer/dashboard" className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> Back to dashboard</Link>
      </div>
    );
  }
  if (!data || !form) {
    return <div className="tl-dash-state"><Loader2 className="w-8 h-8 tl-dash-spin" style={{ color: 'var(--st-green)' }} aria-label="Loading" /></div>;
  }

  const { event, summary } = data;
  const closed = ['CANCELLED', 'COMPLETED'].includes(event.status);
  const onSale = ['PUBLISHED', 'PAUSED'].includes(event.status);
  const pending = summary.pendingChange;
  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === 'date' && f.endDate === f.date ? { endDate: value } : {}) }));
    setFieldError((fe) => ({ ...fe, [key]: undefined }));
  };

  const run = async (key, fn) => {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (err) {
      const body = err.response?.data;
      if (body?.field) setFieldError({ [body.field]: body.message });
      setError(body?.message || 'Something went wrong. Please try again.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy('');
    }
  };

  const reschedule = () =>
    run('reschedule', async () => {
      if (form.reason.trim().length < 10) {
        setFieldError({ reason: 'Tell attendees why the date is changing (at least 10 characters).' });
        return;
      }
      const ok = await dialog.confirm({
        tone: 'warning',
        title: 'Change the date?',
        message: summary.holders
          ? `${summary.holders} ticket holder${summary.holders === 1 ? '' : 's'} will be emailed the new date once it’s live, and can get a full refund until 48 hours before it (at most 14 days). Small same-day changes (two hours or less, same venue) go live straight away; anything else is checked by a TicketLedger admin first.`
          : 'No tickets are sold yet, so the new date goes live straight away.',
        confirmLabel: 'Send the change',
        cancelLabel: 'Not yet',
      });
      if (!ok) return;
      const res = await api.post(`/events/${id}/reschedule`, { ...form, time: toTimeText(form.time), endTime: toTimeText(form.endTime) });
      await dialog.alert({ tone: 'success', title: res.data.data.applied ? 'New date is live' : 'Sent for approval', message: res.data.message });
      setForm((f) => ({ ...f, reason: '' }));
      await load();
    });

  const withdraw = () =>
    run('withdraw', async () => {
      await api.delete(`/events/${id}/reschedule`);
      await load();
    });

  const postpone = () =>
    run('postpone', async () => {
      if (postponeReason.trim().length < 10) {
        setFieldError({ postpone: 'Give a reason of at least 10 characters; attendees will see it.' });
        return;
      }
      const ok = await dialog.confirm({
        tone: 'warning',
        title: `Postpone “${event.name}”?`,
        message: `Ticket sales pause and ${summary.holders} ticket holder${summary.holders === 1 ? '' : 's'} are emailed. Their tickets stay valid for the new date, and they can get a refund at any time until you set it. If there’s no new date within 90 days, the event is cancelled and everyone is refunded.`,
        confirmLabel: 'Postpone event',
        cancelLabel: 'Keep the date',
      });
      if (!ok) return;
      const res = await api.post(`/events/${id}/postpone`, { reason: postponeReason });
      await dialog.alert({ tone: 'success', title: 'Event postponed', message: res.data.message });
      setPostponeReason('');
      await load();
    });

  const cancelEvent = () =>
    run('cancel', async () => {
      if (cancel.reason.trim().length < 10) {
        setFieldError({ cancelReason: 'Give a reason of at least 10 characters; attendees will see it.' });
        return;
      }
      if (cancel.confirmName.trim().toLowerCase() !== event.name.trim().toLowerCase()) {
        setFieldError({ confirmName: 'Type the event name exactly to confirm.' });
        return;
      }
      const ok = await dialog.confirm({
        tone: 'error',
        title: `Cancel “${event.name}” for good?`,
        message: `${summary.tickets} ticket${summary.tickets === 1 ? '' : 's'} stop working and ${pkr(summary.refundTotal)} is refunded to the people who paid; ${pkr(summary.organizerShare)} comes out of your revenue. Everyone is emailed. This can’t be undone.`,
        confirmLabel: 'Cancel event and refund',
        cancelLabel: 'Go back',
      });
      if (!ok) return;
      const res = await api.post(`/events/${id}/cancel`, cancel);
      await dialog.alert({ tone: 'success', title: 'Event cancelled', message: res.data.message });
      await load();
    });

  const refundsBy = Object.fromEntries((summary.refunds || []).map((r) => [r.status, r]));
  const refundCount = (summary.refunds || []).reduce((n, r) => n + r.count, 0);

  return (
    <div>
      <nav className="tl-wz-crumbs" aria-label="Breadcrumb">
        <Link to="/organizer/dashboard">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        <Link to={`/events/${id}`}>{event.name}</Link>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        <span aria-current="page">Cancel or change date</span>
      </nav>
      <header className="tl-wz-head">
        <div>
          <h1 className="tl-wz-title">Cancel or change date</h1>
          <p className="tl-wz-step-text">{event.name} · {slot(event.startsAt || event.date, event.venue, event.city)}</p>
        </div>
        <Link to="/organizer/dashboard" className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> Back to dashboard</Link>
      </header>

      {error && <div className="tl-wz-alert" role="alert"><AlertCircle className="w-4 h-4" />{error}</div>}

      {event.status === 'CANCELLED' && (
        <div className="tl-rv-banner is-bad" role="status">
          <Ban className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>Cancelled {event.cancelledAt ? `on ${when(event.cancelledAt)}` : ''}</strong>
            <p>Reason given to attendees: “{event.cancelReason}”</p>
          </div>
        </div>
      )}
      {event.postponedAt && (
        <div className="tl-rv-banner is-wait" role="status">
          <PauseCircle className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>Postponed on {when(event.postponedAt)}</strong>
            <p>Sales are paused and holders can get a refund at any time. Set the new date below within 90 days, or the event is cancelled automatically.</p>
          </div>
        </div>
      )}
      {event.refundWindowEndsAt && new Date(event.refundWindowEndsAt) > new Date() && (
        <div className="tl-rv-banner is-wait" role="status">
          <Clock className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>Refund window open until {when(event.refundWindowEndsAt)}</strong>
            <p>After the last date change, ticket holders can give their tickets back for a full refund until then.</p>
          </div>
        </div>
      )}

      <div className="tl-lc-stats">
        <Stat icon={Ticket} label="valid tickets" value={summary.tickets.toLocaleString()} />
        <Stat icon={Users} label="ticket holders" value={summary.holders.toLocaleString()} />
        <Stat icon={Tag} label="resale listings" value={summary.resaleListings.toLocaleString()} />
        <Stat icon={Receipt} label={`refunded${refundsBy.FAILED ? ` · ${refundsBy.FAILED.count} failed, retrying` : ''}`} value={refundCount ? `${refundCount} · ${pkr((refundsBy.SUCCEEDED?.amount || 0) + (refundsBy.PENDING?.amount || 0) + (refundsBy.PROCESSING?.amount || 0) + (refundsBy.FAILED?.amount || 0))}` : '0'} />
      </div>

      {!closed && (
        <div className="tl-lc-grid">
          {/* ---------- Reschedule ---------- */}
          <section className="tl-wz-card tl-lc-card" aria-labelledby="lc-move">
            <h2 id="lc-move"><CalendarClock className="w-5 h-5" aria-hidden="true" /> Change date, time or venue</h2>
            {!onSale ? (
              <p className="tl-lc-text">This event isn’t on sale yet, so you can change its date in <Link to={`/organizer/events/${id}/edit`}>Edit event</Link>.</p>
            ) : pending ? (
              <div className="tl-lc-pending">
                <p><strong>Waiting for a TicketLedger admin</strong> (sent {when(pending.createdAt)})</p>
                <p>From {slot(pending.oldStartsAt, pending.oldVenue, pending.oldCity)}</p>
                <p>To <strong>{slot(pending.newStartsAt, pending.newVenue, pending.newCity)}</strong></p>
                <p className="tl-lc-muted">Reason: “{pending.reason}”. Attendees are emailed once it’s approved.</p>
                <button type="button" className="tl-wz-btn" onClick={withdraw} disabled={Boolean(busy)}>
                  <Undo2 className="w-4 h-4" /> {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw request'}
                </button>
              </div>
            ) : (
              <>
                <p className="tl-lc-text">
                  {summary.holders
                    ? 'Ticket holders keep their seats and QR codes for the new date, and can get a full refund if they can’t make it. A same-day shift of two hours or less at the same venue goes live straight away; other changes are approved by an admin first.'
                    : 'No tickets are sold yet, so the new date goes live straight away.'}
                </p>
                <div className="tl-wz-grid">
                  <div className={`tl-wz-field${fieldError.date ? ' has-error' : ''}`}>
                    <label htmlFor="lc-date">New start date</label>
                    <input id="lc-date" type="date" className="tl-wz-input" value={form.date} onChange={set('date')} />
                    {fieldError.date && <p className="tl-wz-error">{fieldError.date}</p>}
                  </div>
                  <div className="tl-wz-field">
                    <label htmlFor="lc-time">Start time (PKT)</label>
                    <input id="lc-time" type="time" className="tl-wz-input" value={form.time} onChange={set('time')} />
                  </div>
                  <div className={`tl-wz-field${fieldError.endDate ? ' has-error' : ''}`}>
                    <label htmlFor="lc-endDate">End date</label>
                    <input id="lc-endDate" type="date" className="tl-wz-input" value={form.endDate} min={form.date} onChange={set('endDate')} />
                    {fieldError.endDate && <p className="tl-wz-error">{fieldError.endDate}</p>}
                  </div>
                  <div className={`tl-wz-field${fieldError.endTime ? ' has-error' : ''}`}>
                    <label htmlFor="lc-endTime">End time (PKT)</label>
                    <input id="lc-endTime" type="time" className="tl-wz-input" value={form.endTime} onChange={set('endTime')} />
                    {fieldError.endTime && <p className="tl-wz-error">{fieldError.endTime}</p>}
                  </div>
                  <div className="tl-wz-field">
                    <label htmlFor="lc-city">City</label>
                    <input id="lc-city" className="tl-wz-input" value={form.city} onChange={set('city')} />
                  </div>
                  <div className={`tl-wz-field${fieldError.venue ? ' has-error' : ''}`}>
                    <label htmlFor="lc-venue">Venue</label>
                    <input id="lc-venue" className="tl-wz-input" value={form.venue} onChange={set('venue')} />
                    {fieldError.venue && <p className="tl-wz-error">{fieldError.venue}</p>}
                  </div>
                  <div className="tl-wz-field is-wide" aria-live="polite">
                    {venueCheck.status === 'conflict' ? (
                      <p className="tl-wz-error" role="alert"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />{venueCheck.message}</p>
                    ) : venueCheck.status === 'free' ? (
                      <p className="tl-wz-hint" style={{ color: '#16a34a' }}><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />The venue is free at this time.</p>
                    ) : venueCheck.status === 'checking' ? (
                      <p className="tl-wz-hint">Checking the venue…</p>
                    ) : null}
                  </div>
                  <div className={`tl-wz-field is-wide${fieldError.reason || fieldError.schedule ? ' has-error' : ''}`}>
                    <label htmlFor="lc-reason">Reason (shown to ticket holders)</label>
                    <textarea id="lc-reason" className="tl-wz-input" rows={2} maxLength={500} value={form.reason} onChange={set('reason')} placeholder="e.g. Rain is forecast for the original date, so the match moves to the following Saturday." />
                    {(fieldError.reason || fieldError.schedule) && <p className="tl-wz-error">{fieldError.reason || fieldError.schedule}</p>}
                  </div>
                </div>
                <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={reschedule} disabled={Boolean(busy) || venueCheck.status === 'conflict'}>
                  <Send className="w-4 h-4" /> {busy === 'reschedule' ? 'Sending…' : summary.holders ? 'Send date change' : 'Save new date'}
                </button>
              </>
            )}
          </section>

          <div className="tl-lc-side">
            {/* ---------- Postpone ---------- */}
            {onSale && !event.postponedAt && (
              <section className="tl-wz-card tl-lc-card" aria-labelledby="lc-postpone">
                <h2 id="lc-postpone"><PauseCircle className="w-5 h-5" aria-hidden="true" /> Postpone (no new date yet)</h2>
                <p className="tl-lc-text">Pause sales and tell ticket holders the date will change. Their tickets stay valid and they can get a refund at any time until you set the new date (within 90 days).</p>
                <div className={`tl-wz-field${fieldError.postpone ? ' has-error' : ''}`}>
                  <label htmlFor="lc-postpone-reason">Reason (shown to ticket holders)</label>
                  <textarea id="lc-postpone-reason" className="tl-wz-input" rows={2} maxLength={500} value={postponeReason} onChange={(e) => { setPostponeReason(e.target.value); setFieldError({}); }} placeholder="e.g. The venue is closed for repairs; we’ll announce the new date soon." />
                  {fieldError.postpone && <p className="tl-wz-error">{fieldError.postpone}</p>}
                </div>
                <button type="button" className="tl-wz-btn" onClick={postpone} disabled={Boolean(busy)}>
                  <PauseCircle className="w-4 h-4" /> {busy === 'postpone' ? 'Postponing…' : 'Postpone event'}
                </button>
              </section>
            )}

            {/* ---------- Cancel ---------- */}
            <section className="tl-wz-card tl-lc-card tl-lc-danger" aria-labelledby="lc-cancel">
              <h2 id="lc-cancel"><Ban className="w-5 h-5" aria-hidden="true" /> Cancel event</h2>
              <ul className="tl-lc-impact">
                <li><strong>{summary.tickets}</strong> ticket{summary.tickets === 1 ? '' : 's'} held by <strong>{summary.holders}</strong> {summary.holders === 1 ? 'person' : 'people'} stop working</li>
                <li><strong>{pkr(summary.refundTotal)}</strong> refunded in full to whoever paid (resale buyers get their resale price)</li>
                <li><strong>{pkr(summary.organizerShare)}</strong> in face value comes out of your revenue</li>
                {summary.resaleListings > 0 && <li><strong>{summary.resaleListings}</strong> resale listing{summary.resaleListings === 1 ? '' : 's'} closed</li>}
                <li>Everyone affected is emailed; this can’t be undone</li>
              </ul>
              <div className={`tl-wz-field${fieldError.cancelReason ? ' has-error' : ''}`}>
                <label htmlFor="lc-cancel-reason">Reason (shown to ticket holders)</label>
                <textarea id="lc-cancel-reason" className="tl-wz-input" rows={2} maxLength={500} value={cancel.reason} onChange={(e) => { setCancel((c) => ({ ...c, reason: e.target.value })); setFieldError({}); }} placeholder="e.g. The headline artist is unwell and can’t travel." />
                {fieldError.cancelReason && <p className="tl-wz-error">{fieldError.cancelReason}</p>}
              </div>
              <div className={`tl-wz-field${fieldError.confirmName ? ' has-error' : ''}`}>
                <label htmlFor="lc-cancel-name">Type <strong>{event.name}</strong> to confirm</label>
                <input id="lc-cancel-name" className="tl-wz-input" autoComplete="off" value={cancel.confirmName} onChange={(e) => { setCancel((c) => ({ ...c, confirmName: e.target.value })); setFieldError({}); }} />
                {fieldError.confirmName && <p className="tl-wz-error">{fieldError.confirmName}</p>}
              </div>
              <button type="button" className="tl-wz-btn tl-lc-cancel-btn" onClick={cancelEvent} disabled={Boolean(busy)}>
                <AlertTriangle className="w-4 h-4" /> {busy === 'cancel' ? 'Cancelling…' : 'Cancel event and refund everyone'}
              </button>
            </section>
          </div>
        </div>
      )}

      {summary.history.length > 0 && (
        <section className="tl-wz-card" style={{ marginTop: 18 }} aria-labelledby="lc-history">
          <h2 id="lc-history" style={{ fontSize: 20, display: 'flex', gap: 8, alignItems: 'center' }}><History className="w-5 h-5" aria-hidden="true" /> Date changes</h2>
          <ul className="tl-lc-history">
            {summary.history.map((c) => {
              const [label, cls] = CHANGE_STATE[c.status] || [c.status, ''];
              return (
                <li key={c.id}>
                  <span className={`tl-pr-state ${cls}`} style={{ margin: 0 }}>{label}{c.minor ? ' · small change' : ''}</span>
                  <div>
                    <p>{slot(c.oldStartsAt, c.oldVenue, c.oldCity)} → <strong>{slot(c.newStartsAt, c.newVenue, c.newCity)}</strong></p>
                    <p className="tl-lc-muted">“{c.reason}” · {when(c.createdAt)}{c.reviewComment ? ` · Admin: “${c.reviewComment}”` : ''}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
