import React, { useState } from 'react';
import { Download, Gift, Users, ArrowLeftRight, X, Send } from 'lucide-react';
import api from '../../utils/api';

/*
 * Tools under a paid booking (My bookings): download the invoice, send tickets as a gift or to group members,
 * move a ticket to another free seat (when the organizer allows it), and see / cancel gifts waiting to be
 * claimed. `gifts` are the gifts this customer sent (from GET /bookings/gifts).
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const seatText = (s) => [s?.section && `Section ${s.section}`, s?.row && `Row ${s.row}`, s?.seatNumber && `Seat ${s.seatNumber}`].filter(Boolean).join(' · ') || 'General admission';

export async function downloadInvoice(order, setMsg) {
  try {
    const res = await api.get(`/bookings/${order.id}/invoice`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.invoiceNumber || 'invoice'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    setMsg?.({ tone: 'bad', text: e.response?.status === 409 ? 'The invoice is available once the booking is paid.' : 'The invoice could not be downloaded.' });
  }
}

export default function BookingTools({ order, userId, gifts = [], onChanged }) {
  const [mode, setMode] = useState(null); // null | 'GIFT' | 'GROUP' | { seatFor: ticketId }
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gift, setGift] = useState({ ticketIds: [], email: '', message: '' });
  const [group, setGroup] = useState({});
  const [seatOpts, setSeatOpts] = useState(null);
  const [seatId, setSeatId] = useState('');

  const pendingGift = (ticketId) => gifts.find((g) => g.ticketId === ticketId && g.status === 'PENDING');
  const mine = (order.tickets || []).filter((t) => t.userId === userId && t.status === 'ACTIVE' && !pendingGift(t.id));
  const paid = ['SUCCESSFUL', 'PARTIALLY_REFUNDED'].includes(order.status);
  if (!paid) return null;

  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: 'good', text: r.data.message });
      setMode(null);
      onChanged?.();
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const openSeats = async (ticketId) => {
    setMsg(null);
    setSeatOpts(null);
    setSeatId('');
    try {
      const r = await api.get(`/bookings/tickets/${ticketId}/seat-options`);
      setSeatOpts(r.data.data);
      setMode({ seatFor: ticketId });
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e) });
    }
  };

  return (
    <div className="space-y-3">
      {/* Who holds each ticket now */}
      {(order.tickets || []).some((t) => t.userId !== userId || pendingGift(t.id)) && (
        <ul className="text-xs space-y-1">
          {(order.tickets || []).map((t) => {
            const g = pendingGift(t.id);
            const sent = gifts.find((x) => x.ticketId === t.id && x.status === 'CLAIMED');
            if (g) return <li key={t.id}>{seatText(t.seat)}: waiting for <b>{g.recipientEmail}</b> to claim it · <button type="button" className="underline text-rose-700" onClick={() => run(() => api.post(`/bookings/gifts/${g.id}/cancel`))}>Cancel</button></li>;
            if (t.userId !== userId) return <li key={t.id} className="text-slate-500">{seatText(t.seat)}: sent to {sent?.recipientEmail || 'someone else'}</li>;
            return null;
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {order.invoiceNumber && (
          <button type="button" className="tl-bt-btn" onClick={() => downloadInvoice(order, setMsg)}><Download className="w-3.5 h-3.5" /> Invoice {order.invoiceNumber}</button>
        )}
        {mine.length > 0 && (
          <>
            <button type="button" className="tl-bt-btn" aria-pressed={mode === 'GIFT'} onClick={() => setMode(mode === 'GIFT' ? null : 'GIFT')}><Gift className="w-3.5 h-3.5" /> Send as a gift</button>
            {mine.length > 1 && <button type="button" className="tl-bt-btn" aria-pressed={mode === 'GROUP'} onClick={() => setMode(mode === 'GROUP' ? null : 'GROUP')}><Users className="w-3.5 h-3.5" /> Give tickets to my group</button>}
          </>
        )}
      </div>

      {mode === 'GIFT' && (
        <form className="tl-bt-panel" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/bookings/gifts', { kind: 'GIFT', ticketIds: gift.ticketIds, email: gift.email, message: gift.message || undefined })); }}>
          <p className="font-bold">Which tickets?</p>
          <div className="flex flex-wrap gap-3">
            {mine.map((t) => (
              <label key={t.id} className="flex items-center gap-1"><input type="checkbox" checked={gift.ticketIds.includes(t.id)} onChange={() => setGift({ ...gift, ticketIds: gift.ticketIds.includes(t.id) ? gift.ticketIds.filter((x) => x !== t.id) : [...gift.ticketIds, t.id] })} /> {seatText(t.seat)}</label>
            ))}
          </div>
          <input type="email" required placeholder="Their email" value={gift.email} onChange={(e) => setGift({ ...gift, email: e.target.value })} aria-label="Recipient email" />
          <input maxLength={300} placeholder="A message (optional)" value={gift.message} onChange={(e) => setGift({ ...gift, message: e.target.value })} aria-label="Message" />
          <p className="text-slate-500">The tickets move to their TicketLedger account (they get a claim link if they don't have one yet). Your QR codes for them stop working.</p>
          <button type="submit" className="tl-bt-btn is-primary" disabled={busy || !gift.ticketIds.length}><Send className="w-3.5 h-3.5" /> Send</button>
        </form>
      )}

      {mode === 'GROUP' && (
        <form className="tl-bt-panel" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/bookings/gifts', { kind: 'GROUP', recipients: Object.entries(group).filter(([, v]) => v?.email).map(([ticketId, v]) => ({ ticketId, email: v.email, name: v.name || undefined })) })); }}>
          <p className="font-bold">Give each group member their own ticket</p>
          <p className="text-slate-500">Leave a ticket empty to keep it. Everyone gets their own QR pass.</p>
          {mine.map((t) => (
            <div key={t.id} className="grid gap-2 sm:grid-cols-3 items-center">
              <span>{seatText(t.seat)}</span>
              <input placeholder="Name (optional)" value={group[t.id]?.name || ''} onChange={(e) => setGroup({ ...group, [t.id]: { ...group[t.id], name: e.target.value } })} aria-label="Name" />
              <input type="email" placeholder="Email" value={group[t.id]?.email || ''} onChange={(e) => setGroup({ ...group, [t.id]: { ...group[t.id], email: e.target.value } })} aria-label="Email" />
            </div>
          ))}
          <button type="submit" className="tl-bt-btn is-primary" disabled={busy || !Object.values(group).some((v) => v?.email)}><Send className="w-3.5 h-3.5" /> Send to the group</button>
        </form>
      )}

      {mine.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {mine.map((t) => <button key={t.id} type="button" className="tl-bt-link" onClick={() => openSeats(t.id)}><ArrowLeftRight className="w-3 h-3 inline" /> Change seat: {seatText(t.seat)}</button>)}
        </div>
      )}

      {mode?.seatFor && seatOpts && (
        <form className="tl-bt-panel" onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/bookings/tickets/${mode.seatFor}/change-seat`, { seatId })); }}>
          <p className="font-bold">Move to another {seatOpts.ticket.tier} seat <button type="button" className="float-right" onClick={() => setMode(null)} aria-label="Close"><X className="w-4 h-4" /></button></p>
          <p className="text-slate-500">Free of charge · {seatOpts.ticket.changesLeft} change{seatOpts.ticket.changesLeft === 1 ? '' : 's'} left · until {new Date(seatOpts.cutoffAt).toLocaleString()}. Your current QR stops working; the new one is in your wallet.</p>
          {!seatOpts.seats.length ? <p>No other free seats of this type right now.</p> : (
            <select required value={seatId} onChange={(e) => setSeatId(e.target.value)} aria-label="New seat">
              <option value="">Choose a seat…</option>
              {seatOpts.seats.map((s) => <option key={s.id} value={s.id}>{seatText(s)}</option>)}
            </select>
          )}
          <button type="submit" className="tl-bt-btn is-primary" disabled={busy || !seatId}>Move my seat</button>
        </form>
      )}

      {msg && <p className={`tl-bt-msg${msg.tone === 'bad' ? ' is-bad' : ''}`} role="status">{msg.text}</p>}
    </div>
  );
}
