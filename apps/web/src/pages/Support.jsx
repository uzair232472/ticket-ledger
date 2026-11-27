import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessagesSquare, Plus, Send, X } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { StatusPill } from '../components/support/SupportThread';
import './legal.css';
import './info.css';
import '../components/support/support.css';

/** Help & support (/support): the customer's support requests, and a New request button that opens the form in a dialog. */
export default function Support() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('open');
  const [form, setForm] = useState({ category: 'BOOKING', subject: '', message: '', orderId: '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false); // the New request dialog
  const dialogRef = useRef(null);
  const openerRef = useRef(null);

  const openForm = (e) => {
    openerRef.current = e?.currentTarget || null;
    setError('');
    setOpen(true);
  };
  const closeForm = () => {
    if (sending) return;
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  };
  // While the dialog is open: Escape closes it, Tab stays inside it, the page behind doesn't scroll
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => dialogRef.current?.querySelector('select, input, textarea')?.focus());
    const onKey = (e) => {
      if (e.key === 'Escape') closeForm();
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const els = [...dialogRef.current.querySelectorAll('button, select, input, textarea')].filter((el) => !el.disabled);
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = 'Help & support · TicketLedger';
    api.get('/support/meta').then((r) => setMeta(r.data.data)).catch(() => {});
    api.get('/bookings/my-bookings').then((r) => setOrders(r.data.data.orders || [])).catch(() => {});
  }, []);
  useEffect(() => {
    setTickets(null);
    api.get('/support/tickets', { params: { status: filter === 'all' ? undefined : filter } }).then((r) => setTickets(r.data.data.tickets)).catch(() => setTickets([]));
  }, [filter]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (form.subject.trim().length < 4) return setError('Add a short subject (at least 4 characters).');
    if (form.message.trim().length < 2) return setError('Describe the problem.');
    if (files.length > (meta?.maxAttachments || 5)) return setError(`Attach at most ${meta?.maxAttachments || 5} files.`);
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => v && fd.append(k, typeof v === 'string' ? v.trim() : v));
    files.forEach((f) => fd.append('attachments', f));
    setSending(true);
    setError('');
    try {
      const r = await api.post('/support/tickets', fd);
      navigate(`/support/${r.data.data.ticket.reference}`, { state: { created: true } });
    } catch (err) {
      setError(err.response?.data?.message || 'We couldn’t send your request. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="tl-legal tl-info tl-sp tl-sp--dark">
      <header className="tl-legal-head tl-info-head">
        <p className="tl-legal-eyebrow">Help &amp; support</p>
        <h1>How can we help?</h1>
        <p className="tl-legal-intro">Open a support request and follow it here. Every request gets a reference number, and you’ll be notified when we reply.</p>
        <div className="tl-sp-head-actions">
          <button type="button" className="tl-info-btn is-primary tl-sp-new" onClick={openForm}><Plus className="w-4 h-4" aria-hidden="true" /> New request</button>
          {user?.isSupportAgent && <Link to="/support/desk" className="tl-legal-switch">Open the support desk →</Link>}
        </div>
      </header>

      <div className="tl-sp-grid tl-sp-grid--single">
        <section aria-labelledby="sp-mine">
          <h2 id="sp-mine" className="text-xl font-extrabold">Your requests</h2>
          <div className="tl-sp-tabs" role="group" aria-label="Show">
            {[['open', 'Open'], ['closed', 'Resolved & closed'], ['all', 'All']].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          {!tickets ? <p className="tl-sp-empty">Loading…</p> : !tickets.length ? (
            <div className="tl-sp-empty">
              <span className="tl-sp-empty-icon" aria-hidden="true"><MessagesSquare className="w-8 h-8" /></span>
              <p className="tl-sp-empty-title">No {filter === 'all' ? '' : filter === 'open' ? 'open ' : 'resolved '}requests.</p>
              <p>You’re all caught up! If you need anything, open a new request.</p>
              <button type="button" className="tl-info-btn is-primary tl-sp-new" onClick={openForm}><Plus className="w-4 h-4" aria-hidden="true" /> New request</button>
            </div>
          ) : (
            <div className="tl-sp-list">
              {tickets.map((t) => (
                <Link key={t.id} to={`/support/${t.reference}`} className="tl-sp-item">
                  <span><span className="tl-sp-ref">{t.reference}</span><br /><strong>{t.subject}</strong></span>
                  <StatusPill status={t.status} label={t.statusLabel} />
                  <small>{t.categoryLabel} · updated {new Date(t.updatedAt).toLocaleDateString()}</small>
                  <small>{t.messageCount} message{t.messageCount === 1 ? '' : 's'}</small>
                </Link>
              ))}
            </div>
          )}
        </section>

      </div>

      {open && (
        <div className="tl-sp-modal" onMouseDown={(e) => e.target === e.currentTarget && closeForm()}>
        <section ref={dialogRef} className="tl-info-formcard tl-sp-modal-card" role="dialog" aria-modal="true" aria-labelledby="sp-new">
          <button type="button" className="tl-sp-modal-x" onClick={closeForm} aria-label="Close" disabled={sending}><X className="w-5 h-5" aria-hidden="true" /></button>
          <h2 id="sp-new"><Plus className="w-5 h-5 inline -mt-1" aria-hidden="true" /> New request</h2>
          <p className="tl-sp-modal-intro">You’ll get a reference number, and we’ll notify you when we reply.</p>
          <form onSubmit={submit} noValidate>
            <label className="tl-info-field">
              <span>What is it about?</span>
              <select value={form.category} onChange={set('category')}>
                {(meta?.categories || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            {orders.length > 0 && (
              <label className="tl-info-field">
                <span>Booking (optional)</span>
                <select value={form.orderId} onChange={set('orderId')}>
                  <option value="">Not about a booking</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.event?.name || 'Booking'} · {new Date(o.createdAt).toLocaleDateString()} · #{o.id.slice(0, 8)}</option>)}
                </select>
              </label>
            )}
            <label className="tl-info-field">
              <span>Subject</span>
              <input value={form.subject} onChange={set('subject')} maxLength={140} placeholder="e.g. Refund not received" />
            </label>
            <label className="tl-info-field">
              <span>Describe the problem</span>
              <textarea value={form.message} onChange={set('message')} maxLength={5000} placeholder="What happened, and when? Include any error message you saw." />
            </label>
            <label className="tl-info-field">
              <span>Screenshots or documents (optional)</span>
              <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFiles([...(e.target.files || [])])} />
              <small>Images or PDF, up to 5 MB each, {meta?.maxAttachments || 5} files.</small>
            </label>
            {error && <p className="tl-info-error" role="alert">{error}</p>}
            <div className="tl-sp-modal-actions">
              <button type="button" className="tl-info-btn" onClick={closeForm} disabled={sending}>Cancel</button>
              <button type="submit" className="tl-info-btn is-primary" disabled={sending}><Send className="w-4 h-4" aria-hidden="true" /> {sending ? 'Sending…' : 'Send request'}</button>
            </div>
          </form>
        </section>
        </div>
      )}
    </main>
  );
}
