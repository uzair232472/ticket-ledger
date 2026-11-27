import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Inbox, LifeBuoy, MessageSquare, MessageSquareWarning, RefreshCw, Search, X } from 'lucide-react';
import api from '../utils/api';
import { DashCard, DashHead, DashState, Notice, Segmented } from '../components/dash/DashShell';
import { ReplyBox, StatusPill, Thread } from '../components/support/SupportThread';
import { StatCard } from '../components/dash/Studio';
import Pager, { pageOf } from '../components/dash/Pager';
import '../components/support/support.css';
import '../components/dash/discounts.css';

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
  const [query, setQuery] = useState(''); // what was typed; searched a moment after typing stops
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const load = useCallback(() => api.get('/support/org/tickets', { params: { status, q: q || undefined } }).then((r) => { setRows(r.data.data.tickets); setError(''); }).catch((e) => setError(errText(e))), [status, q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [status, q]);
  const list = rows || [];
  const shown = pageOf(list, page, 10);
  const needReply = list.filter((t) => t.waitingForReply).length;
  const open = list.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status)).length;
  const events = new Set(list.map((t) => t.eventName).filter(Boolean)).size;
  return (
    <div className="space-y-6 tl-sp tl-dc tl-so">
      <DashHead
        eyebrow="Customer care"
        title="Support requests"
        intro="Questions customers sent TicketLedger support about your events. Reply here; TicketLedger support resolves them."
        actions={<button type="button" className="tl-aov-iconbtn" onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw className="w-4 h-4" /></button>}
        segment={<Segmented label="Show" options={[{ value: 'open', label: 'Open', icon: Inbox }, { value: 'closed', label: 'Resolved & closed' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} />}
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="tl-dc-stats">
        <StatCard icon={LifeBuoy} tone="green" label="Requests shown" value={rows ? list.length : '…'} note={status === 'open' ? 'Open requests' : status === 'closed' ? 'Resolved and closed' : 'Every request'} />
        <StatCard icon={MessageSquareWarning} tone="rose" label="Need a reply" value={rows ? needReply : '…'} note="The customer wrote last" />
        <StatCard icon={Inbox} tone="blue" label="Still open" value={rows ? open : '…'} note="Not resolved by TicketLedger yet" />
        <StatCard icon={CalendarDays} tone="amber" label="Events" value={rows ? events : '…'} note="With a request in this list" />
      </div>
      <DashCard
        title="Requests"
        icon={LifeBuoy}
        aside={(
          <label className="tl-co-search">
            <Search className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Search requests</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reference, subject or customer" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>}
          </label>
        )}
      >
        {!rows ? <DashState icon={RefreshCw} title="Loading…" /> : !rows.length ? <DashState icon={LifeBuoy} title={q ? `No requests match “${q}”` : 'No requests'} /> : (
          <>
            <div className="tl-dash-table-wrap">
              <table className="tl-dash-table tl-dc-table">
                <thead><tr><th>Request</th><th>Event</th><th>Customer</th><th>Status</th><th>Updated</th><th className="is-num">Open</th></tr></thead>
                <tbody>
                  {shown.rows.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link to={`/organizer/support/${t.reference}`} className="tl-so-subject">{t.subject}</Link>
                        <div className="tl-dc-note"><span className="tl-dc-code tl-so-ref">{t.reference}</span> {t.categoryLabel}</div>
                      </td>
                      <td>{t.eventName || '—'}</td>
                      <td>{t.customer?.name}<div className="tl-dc-note">{t.customer?.email}</div></td>
                      <td><StatusPill status={t.status} label={t.statusLabel} />{t.waitingForReply && <div className="tl-so-needs">Needs a reply</div>}</td>
                      <td className="tl-dc-window">{when(t.updatedAt)}</td>
                      <td className="is-num"><Link to={`/organizer/support/${t.reference}`} className="tl-st-btn tl-st-btn--sm"><MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> {t.waitingForReply ? 'Reply' : 'View'}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={shown.page} total={list.length} onPage={setPage} label="Support requests" />
          </>
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
    <div className="space-y-6 tl-sp tl-so">
      <DashHead
        eyebrow={`${t.reference} · ${t.categoryLabel}`}
        title={t.subject}
        intro={`${t.reference} · ${t.categoryLabel} · ${t.customer?.name} (${t.customer?.email}) · opened ${when(t.createdAt)}`}
        actions={<button type="button" className="tl-aov-pill tl-so-back" onClick={() => navigate('/organizer/support')}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> All requests</button>}
      />
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
