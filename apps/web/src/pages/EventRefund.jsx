import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Ban, CalendarClock, CheckCircle2, Clock, PauseCircle, RefreshCw, Ticket } from 'lucide-react';
import api from '../utils/api';
import BasicShell from '../components/basic/BasicShell';
import { useDialog } from '../components/ui/DialogProvider';
import '../components/lifecycle/lifecycle.css';

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;
const when = (iso, withTime = true) =>
  new Date(iso).toLocaleString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}), timeZone: 'Asia/Karachi' });
const REFUND_STATE = { PENDING: 'Being processed', PROCESSING: 'Being processed', SUCCEEDED: 'Refunded', FAILED: 'Delayed, retrying' };
const seatText = (seat) => (seat ? `Section ${seat.section} · Row ${seat.row}, Seat ${seat.seatNumber}` : 'Ticket');

/**
 * Ticket holder, after a date change or postponement: keep the tickets (nothing to do) or give some back
 * for a full refund while the window is open. Also shows refunds already made for this event.
 */
export default function EventRefund() {
  const { id } = useParams();
  const dialog = useDialog();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/events/${id}/refund-options`);
      setData(res.data.data);
      setPicked([]);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load your tickets for this event.');
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <BasicShell eyebrow="Your tickets" title="Event update">
        {error ? <p className="tl-lcu-error" role="alert"><AlertCircle className="w-4 h-4" aria-hidden="true" /> {error}</p> : <p className="tl-lcu-muted"><RefreshCw className="w-4 h-4 tl-nt-spin" aria-hidden="true" /> Loading…</p>}
      </BasicShell>
    );
  }

  const { event, window: win, tickets, refunds, change } = data;
  const total = tickets.filter((t) => picked.includes(t.id)).reduce((n, t) => n + Number(t.amount), 0);
  const toggle = (ticketId) => setPicked((p) => (p.includes(ticketId) ? p.filter((x) => x !== ticketId) : [...p, ticketId]));
  const refundable = tickets.filter((t) => t.status === 'ACTIVE');

  const send = async () => {
    const chosen = tickets.filter((t) => picked.includes(t.id));
    const toOthers = chosen.filter((t) => !t.refundToYou).length;
    const ok = await dialog.confirm({
      tone: 'warning',
      title: `Give back ${chosen.length} ticket${chosen.length === 1 ? '' : 's'}?`,
      message: `${chosen.length === 1 ? 'This ticket stops' : 'These tickets stop'} working straight away and can’t be restored. ${toOthers ? `${toOthers === chosen.length ? 'The refund goes' : `${toOthers} of the refunds go`} to the person who paid for ${toOthers === 1 ? 'that ticket' : 'them'}. ` : ''}Refund: ${pkr(total)}.`,
      confirmLabel: 'Refund my tickets',
      cancelLabel: 'Keep them',
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await api.post(`/events/${id}/refund-request`, { ticketIds: picked });
      await dialog.alert({ tone: 'success', title: 'Refund requested', message: res.data.message });
      await load();
    } catch (err) {
      dialog.alert({ tone: 'error', title: 'Couldn’t refund the tickets', message: err.response?.data?.message || 'Please try again.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <BasicShell
      eyebrow="Your tickets"
      title={event.name}
      intro={`${event.venue}, ${event.city} · ${when(event.startsAt || event.date)}`}
      actions={<Link to="/my-bookings" className="tl-btn tl-btn--ghost"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> My orders</Link>}
    >
      <div className="tl-lcu">
        {event.status === 'CANCELLED' ? (
          <div className="tl-lcu-banner is-bad">
            <Ban className="w-5 h-5" aria-hidden="true" />
            <div>
              <strong>This event has been cancelled</strong>
              <p>{event.cancelReason ? `Reason: ${event.cancelReason} ` : ''}Every ticket is refunded in full automatically; you don’t need to do anything.</p>
            </div>
          </div>
        ) : event.postponedAt ? (
          <div className="tl-lcu-banner is-wait">
            <PauseCircle className="w-5 h-5" aria-hidden="true" />
            <div>
              <strong>Postponed: the new date hasn’t been set yet</strong>
              <p>{event.postponeReason ? `Reason: ${event.postponeReason} ` : ''}Your tickets stay valid for the new date. If you’d rather not wait, you can get a full refund at any time until it’s announced.</p>
            </div>
          </div>
        ) : change ? (
          <div className="tl-lcu-banner is-wait">
            <CalendarClock className="w-5 h-5" aria-hidden="true" />
            <div>
              <strong>This event has moved</strong>
              <p className="tl-lcu-was">Was: {when(change.oldStartsAt)} · {change.oldVenue}, {change.oldCity}</p>
              <p className="tl-lcu-now">Now: {when(event.startsAt)} · {event.venue}, {event.city}</p>
              <p>Reason: {change.reason}</p>
            </div>
          </div>
        ) : null}

        {win.open && (
          <p className="tl-lcu-window">
            <Clock className="w-4 h-4" aria-hidden="true" />
            {win.until ? <>You can get a full refund until <strong>{when(win.until)}</strong>.</> : <>You can get a full refund at any time until the new date is announced.</>}
            {' '}Going? Keep your tickets: they work as they are, with the same seats and QR codes.
          </p>
        )}
        {!win.open && event.status !== 'CANCELLED' && win.closedAt && (
          <p className="tl-lcu-window"><Clock className="w-4 h-4" aria-hidden="true" /> The refund window closed on {when(win.closedAt)}. You can still resell your tickets from your NFT wallet.</p>
        )}

        {refundable.length > 0 && (
          <section className="tl-basic-card tl-lcu-card" aria-labelledby="lcu-tickets">
            <h2 id="lcu-tickets">Your tickets</h2>
            <ul className="tl-lcu-tickets">
              {refundable.map((t) => (
                <li key={t.id}>
                  <label>
                    {win.open && <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />}
                    <Ticket className="w-4 h-4" aria-hidden="true" />
                    <span>
                      <strong>{seatText(t.seat)}</strong>
                      <small>{t.seat?.tier?.name || 'Ticket'} · refund {pkr(t.amount)}{t.refundToYou ? '' : ' to the person who paid for it'}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {win.open && (
              <div className="tl-lcu-actions">
                <button type="button" className="tl-btn tl-btn--ghost" onClick={() => setPicked(picked.length === refundable.length ? [] : refundable.map((t) => t.id))}>
                  {picked.length === refundable.length ? 'Clear selection' : 'Select all'}
                </button>
                <button type="button" className="tl-btn tl-btn--green" onClick={send} disabled={!picked.length || sending}>
                  {sending ? 'Refunding…' : picked.length ? `Refund ${picked.length} ticket${picked.length === 1 ? '' : 's'} (${pkr(total)})` : 'Choose tickets to refund'}
                </button>
              </div>
            )}
          </section>
        )}
        {refundable.length === 0 && !refunds.length && <p className="tl-lcu-muted">You don’t hold any tickets for this event.</p>}

        {refunds.length > 0 && (
          <section className="tl-basic-card tl-lcu-card" aria-labelledby="lcu-refunds">
            <h2 id="lcu-refunds">Refunds</h2>
            <ul className="tl-lcu-tickets">
              {refunds.map((r) => (
                <li key={r.id}>
                  <div className="tl-lcu-refund">
                    {r.status === 'SUCCEEDED' ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <Clock className="w-4 h-4" aria-hidden="true" />}
                    <span>
                      <strong>{pkr(r.amount)} · {REFUND_STATE[r.status]}</strong>
                      <small>{seatText(r.ticket?.seat)}{r.providerRef ? ` · Ref ${r.providerRef}` : ''}{r.processedAt ? ` · ${when(r.processedAt, false)}` : ''}</small>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </BasicShell>
  );
}
