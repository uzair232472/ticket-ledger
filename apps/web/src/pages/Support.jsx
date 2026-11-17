import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LifeBuoy, Plus, Send } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { StatusPill } from '../components/support/SupportThread';
import './legal.css';
import './info.css';
import '../components/support/support.css';

/** Help & support (/support): the customer's support requests and a form to open a new one. */
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
    <main className="tl-legal tl-info tl-sp">
      <header className="tl-legal-head tl-info-head">
        <p className="tl-legal-eyebrow">Help &amp; support</p>
        <h1>How can we help?</h1>
        <p className="tl-legal-intro">Open a support request and follow it here. Every request gets a reference number, and you’ll be notified when we reply.</p>
        {user?.isSupportAgent && <Link to="/support/desk" className="tl-legal-switch">Open the support desk →</Link>}
      </header>

      <div className="tl-sp-grid">
        <section aria-labelledby="sp-mine">
          <h2 id="sp-mine" className="text-xl font-extrabold">Your requests</h2>
          <div className="tl-sp-tabs" role="group" aria-label="Show">
            {[['open', 'Open'], ['closed', 'Resolved & closed'], ['all', 'All']].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          {!tickets ? <p className="tl-sp-empty">Loading…</p> : !tickets.length ? (
            <p className="tl-sp-empty"><LifeBuoy className="w-6 h-6 inline mb-2" aria-hidden="true" /><br />No {filter === 'all' ? '' : filter === 'open' ? 'open ' : 'resolved '}requests.</p>
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

        <section className="tl-info-formcard" aria-labelledby="sp-new">
          <h2 id="sp-new"><Plus className="w-5 h-5 inline -mt-1" aria-hidden="true" /> New request</h2>
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
            <button type="submit" className="tl-info-btn is-primary" disabled={sending}><Send className="w-4 h-4" aria-hidden="true" /> {sending ? 'Sending…' : 'Send request'}</button>
          </form>
        </section>
      </div>
    </main>
  );
}
