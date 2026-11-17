import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Inbox, LifeBuoy, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { DashCard, DashHead, DashState, Notice, Segmented } from '../components/dash/DashShell';
import { ReplyBox, StatusPill, Thread } from '../components/support/SupportThread';
import '../components/support/support.css';

/*
 * Support requests about this organization's events (permission support.respond). Organizers read the
 * conversation and answer the customer; status, assignment, escalation and internal notes stay with
 * TicketLedger support. Event-scoped roles see requests about their assigned events only.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function OrganizerSupport() {
  const { reference } = useParams();
  return reference ? <OrgTicket reference={reference} /> : <OrgQueue />;
}

function OrgQueue() {
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/support/org/tickets', { params: { status, q: q || undefined } }).then((r) => { setRows(r.data.data.tickets); setError(''); }).catch((e) => setError(errText(e))), [status, q]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-6 tl-sp">
      <DashHead
        eyebrow="Customer care"
        title="Support requests"
        intro="Questions customers sent TicketLedger support about your events. Reply here; TicketLedger support resolves them."
        segment={<Segmented label="Show" options={[{ value: 'open', label: 'Open', icon: Inbox }, { value: 'closed', label: 'Resolved & closed' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} />}
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <DashCard title="Requests" icon={LifeBuoy} aside={<button type="button" className="tl-st-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>}>
        <input className="tl-dash-input w-full mb-4" placeholder="Search reference or subject" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {!rows ? <DashState icon={RefreshCw} title="Loading…" /> : !rows.length ? <DashState icon={LifeBuoy} title="No requests" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Request</th><th>Event</th><th>Customer</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><Link to={`/organizer/support/${t.reference}`} className="font-bold underline">{t.subject}</Link><div className="tl-sp-ref">{t.reference} · {t.categoryLabel}</div></td>
                    <td className="text-xs">{t.eventName || '—'}</td>
                    <td className="text-xs">{t.customer?.name}<div className="text-slate-500">{t.customer?.email}</div></td>
                    <td><StatusPill status={t.status} label={t.statusLabel} />{t.waitingForReply && <div className="text-xs text-rose-700 mt-1">Needs a reply</div>}</td>
                    <td className="text-xs">{when(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>
    </div>
  );
}

function OrgTicket({ reference }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => api.get(`/support/tickets/${reference}`).then((r) => setData(r.data.data)).catch((e) => setNotice({ tone: 'bad', text: errText(e) })), [reference]);
  useEffect(() => { load(); }, [load]);
  const send = async (fd) => {
    try {
      const r = await api.post(`/support/tickets/${reference}/replies`, fd);
      setData(r.data.data);
      setNotice({ tone: 'good', text: 'Reply sent to the customer.' });
      return true;
    } catch (e) {
      setNotice({ tone: 'bad', text: errText(e) });
      return false;
    }
  };
  if (!data) return <div className="space-y-6"><DashHead eyebrow="Support requests" title={reference} />{notice ? <Notice tone="bad">{notice.text}</Notice> : <DashState icon={RefreshCw} title="Loading…" />}</div>;
  const t = data.ticket;
  const closed = ['RESOLVED', 'CLOSED'].includes(t.status);
  return (
    <div className="space-y-6 tl-sp">
      <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => navigate('/organizer/support')}><ArrowLeft className="w-3.5 h-3.5 inline" /> All requests</button>
      <DashHead eyebrow={`${t.reference} · ${t.categoryLabel}`} title={t.subject} intro={`${t.customer?.name} (${t.customer?.email}) · opened ${when(t.createdAt)}`} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      <div className="tl-sp-grid">
        <section aria-label="Conversation">
          <Thread messages={data.messages} viewer="organizer" />
          <ReplyBox disabled={closed} disabledText="TicketLedger support has resolved this request." onSend={send} />
        </section>
        <aside className="tl-sp-facts">
          <dl className="grid gap-3 text-sm">
            <div><dt>Status</dt><dd><StatusPill status={t.status} label={t.statusLabel} /></dd></div>
            <div><dt>TicketLedger support</dt><dd>{t.assignee?.name || 'Not assigned yet'}</dd></div>
            {data.context?.event && <div><dt>Event</dt><dd>{data.context.event.name}</dd></div>}
            {data.context?.order && <div><dt>Booking</dt><dd>#{data.context.order.id.slice(0, 8)} · {data.context.order.status.toLowerCase()} · PKR {data.context.order.totalAmount.toLocaleString()} · {data.context.order.tickets} ticket(s)</dd></div>}
          </dl>
          <p className="text-xs text-slate-500">Your replies go to the customer and TicketLedger support. Only TicketLedger support changes the status.</p>
        </aside>
      </div>
    </div>
  );
}
