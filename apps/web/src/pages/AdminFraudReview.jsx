import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, RecordCard, Badge } from '../components/dash/Studio';
import { ClipboardCheck, RefreshCw, ShieldAlert, ShieldCheck, HelpCircle, Info } from 'lucide-react';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
const money = (n) => `PKR ${Number(n || 0).toLocaleString()}`;
const when = (d) => new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });

/**
 * Blind fraud review. The queue mixes orders flagged by the rules, orders only the shadow model would
 * flag, and randomly chosen orders - in a shuffled order, without saying which is which or showing any
 * score. A review is only recorded for evaluation: it never changes the order, tickets, payment or account.
 */
export default function AdminFraudReview() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(0);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ml/fraud-review/queue?limit=25`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not load the review queue');
      setItems(data.data.items);
      setOpen(data.data.open);
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  const decide = async (item, decision) => {
    setBusy(item.sampleId);
    try {
      const res = await fetch(`${API_BASE}/ml/fraud-review/${item.sampleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decision, note: notes[item.sampleId] || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not record the review');
      setItems((xs) => xs.filter((x) => x.sampleId !== item.sampleId));
      setOpen((n) => (decision === 'UNRESOLVED' ? n : n - 1));
      setMsg({ tone: 'good', text: 'Review recorded. Nothing else about the order or account was changed.' });
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tl-studio">
      <StudioHead
        crumbs={['Admin', 'Fraud']}
        title="Fraud review"
        intro="Decide whether each order was fraud. Orders come from several sources in a shuffled order, and you are not told why an order is here - judge each on its own facts. Your decision is used only to measure how well fraud detection works: it does not cancel, refund, block or change anything. To act on an account, use the fraud watchlist."
        actions={(
          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        )}
      />
      {msg && <Notice tone={msg.tone} icon={Info} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
      <p className="tl-sh-intro">{loading ? 'Loading...' : `${open} order${open === 1 ? '' : 's'} waiting for review`}</p>
      {!loading && items.length === 0 && <Notice tone="good" icon={ClipboardCheck}>Nothing to review right now.</Notice>}
      {items.map((it) => (
        <RecordCard
          key={it.sampleId}
          icon={ClipboardCheck}
          title={it.order ? `${it.order.event?.name || 'Event'} - ${money(it.order.totalAmount)}` : 'Order no longer exists'}
          sub={it.order ? `Order ${it.orderId.slice(0, 8)} - ${when(it.order.createdAt)}` : `Order ${it.orderId}`}
          status={it.previouslyUnresolved ? <Badge tone="amber" icon={HelpCircle}>Unresolved before ({it.previouslyUnresolved})</Badge> : null}
          columns={it.order ? [
            { label: 'Order', content: <p>{it.order.tickets} ticket{it.order.tickets === 1 ? '' : 's'}, {it.order.paymentMethod}, {it.order.status.toLowerCase()}{it.order.usedDiscountCode ? ', discount code used' : ''}</p> },
            { label: 'Event', content: <p>{it.order.event?.type?.replaceAll('_', ' ').toLowerCase()} in {it.order.event?.city}</p> },
            { label: 'Customer', content: <p>{it.customer.ref ? `${it.customer.ref}: ` : ''}Account {it.customer.accountAgeDays} days old; {it.customer.earlierOrders} earlier orders; {it.customer.failedPayments30d} failed payments in 30 days; {it.customer.resaleListings} resale listings</p> },
          ] : []}
          actions={(
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <textarea
                className="tl-dash-input"
                rows={2}
                maxLength={1000}
                placeholder="Note (optional): what you checked"
                value={notes[it.sampleId] || ''}
                onChange={(e) => setNotes((n) => ({ ...n, [it.sampleId]: e.target.value }))}
              />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={busy === it.sampleId} onClick={() => decide(it, 'CONFIRMED_FRAUD')}>
                  <ShieldAlert className="w-4 h-4" /> Confirmed fraud
                </button>
                <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" disabled={busy === it.sampleId} onClick={() => decide(it, 'LEGITIMATE')}>
                  <ShieldCheck className="w-4 h-4" /> Legitimate
                </button>
                <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={busy === it.sampleId} onClick={() => decide(it, 'UNRESOLVED')}>
                  <HelpCircle className="w-4 h-4" /> Can&apos;t tell
                </button>
              </div>
            </div>
          )}
        />
      ))}
    </div>
  );
}
