import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Inbox, AlertTriangle, UserPlus, Users, RefreshCw, ShieldAlert } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { DashCard, DashHead, DashState, Notice, Segmented } from '../components/dash/DashShell';
import { ReplyBox, StatusPill, Thread } from '../components/support/SupportThread';
import '../components/support/support.css';

/*
 * Support desk for agents (User.isSupportAgent) and Super Admins: the queue, one ticket with assignment, status,
 * priority, internal notes and replies, and (admins) escalation and the list of agents.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const PRIORITY_TONE = { URGENT: 'ESCALATED', HIGH: 'WAITING_ON_CUSTOMER', NORMAL: 'OPEN', LOW: 'CLOSED' };

export default function SupportDesk() {
  const { reference } = useParams();
  return reference ? <DeskTicket reference={reference} /> : <DeskQueue />;
}

function DeskQueue() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const queue = params.get('queue') || 'waiting';
  const [filters, setFilters] = useState({ category: '', priority: '', q: '' });
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const isAdmin = user?.role === 'SUPER_ADMIN';

  const load = useCallback(() => {
    setError('');
    api.get('/support/desk/tickets', { params: { queue, category: filters.category || undefined, priority: filters.priority || undefined, q: filters.q || undefined } })
      .then((r) => setData(r.data.data))
      .catch((e) => setError(errText(e)));
  }, [queue, filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/support/meta').then((r) => setMeta(r.data.data)).catch(() => {}); }, []);

  const tabs = [
    { value: 'waiting', label: 'Needs a reply', icon: Inbox },
    { value: 'mine', label: 'Mine' },
    { value: 'unassigned', label: 'Unassigned' },
    { value: 'escalated', label: 'Escalated', icon: AlertTriangle, count: data?.counts?.ESCALATED },
    { value: 'all', label: 'All open' },
    { value: 'closed', label: 'Resolved & closed' },
    ...(isAdmin ? [{ value: 'agents', label: 'Agents', icon: Users }] : []),
  ];

  return (
    <div className="space-y-6 tl-sp">
      <DashHead
        eyebrow="Help desk"
        title="Support desk"
        intro="Customer requests. Unanswered requests escalate on their own after 24 hours (48 hours after a customer reply)."
        segment={<Segmented label="Queues" options={tabs} value={queue} onChange={(v) => setParams({ queue: v })} />}
      />
      {error && <Notice tone="bad" onDismiss={() => setError('')}>{error}</Notice>}
      {queue === 'agents' ? <Agents /> : (
        <DashCard
          title={tabs.find((t) => t.value === queue)?.label}
          icon={Inbox}
          aside={<button type="button" className="tl-st-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>}
        >
          <div className="grid gap-3 sm:grid-cols-3 mb-4">
            <input className="tl-dash-input" placeholder="Search reference, subject or email" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Search" />
            <select className="tl-dash-select" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} aria-label="Category">
              <option value="">Every category</option>
              {(meta?.categories || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select className="tl-dash-select" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} aria-label="Priority">
              <option value="">Every priority</option>
              {(meta?.priorities || []).map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
            </select>
          </div>
          {!data ? <DashState icon={RefreshCw} title="Loading…" /> : !data.items.length ? <DashState icon={Inbox} title="Nothing here" /> : (
            <div className="tl-dash-table-wrap">
              <table className="tl-dash-table">
                <thead><tr><th>Request</th><th>Customer</th><th>Status</th><th>Priority</th><th>Agent</th><th>Updated</th></tr></thead>
                <tbody>
                  {data.items.map((t) => (
                    <tr key={t.id}>
                      <td><Link to={`/support/desk/${t.reference}`} className="font-bold underline">{t.subject}</Link><div className="tl-sp-ref">{t.reference} · {t.categoryLabel}</div></td>
                      <td className="text-xs">{t.customer?.name}<div className="text-slate-500">{t.customer?.email}</div></td>
                      <td><StatusPill status={t.status} label={t.statusLabel} />{t.waitingOnAgent && <div className="text-xs text-rose-700 mt-1">Needs a reply</div>}</td>
                      <td><StatusPill status={PRIORITY_TONE[t.priority]} label={t.priority.toLowerCase()} /></td>
                      <td className="text-xs">{t.assignee?.name || '—'}</td>
                      <td className="text-xs">{when(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashCard>
      )}
    </div>
  );
}

function Agents() {
  const [agents, setAgents] = useState([]);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState(null);
  const load = () => api.get('/support/desk/agents').then((r) => setAgents(r.data.data.agents)).catch(() => {});
  useEffect(() => { load(); }, []);
  const set = async (body) => {
    try {
      const r = await api.post('/support/desk/agents', body);
      setNotice({ tone: 'good', text: r.data.message });
      setEmail('');
      load();
    } catch (e) {
      setNotice({ tone: 'bad', text: errText(e) });
    }
  };
  return (
    <DashCard title="Support agents" sub="Agents see every request, reply, assign and resolve. Only admins escalate. Removing an agent unassigns their open requests." icon={Users}>
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      <form className="flex flex-wrap gap-3 mb-4" onSubmit={(e) => { e.preventDefault(); set({ email, agent: true }); }}>
        <input className="tl-dash-input" type="email" required placeholder="Account email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Account email" />
        <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><UserPlus className="w-3.5 h-3.5 inline" /> Make agent</button>
      </form>
      <div className="tl-dash-table-wrap">
        <table className="tl-dash-table">
          <thead><tr><th>Agent</th><th>Open requests</th><th /></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.name}</strong><div className="text-xs text-slate-500">{a.email}{a.isAdmin ? ' · admin' : ''}</div></td>
                <td>{a.openTickets}</td>
                <td>{!a.isAdmin && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => set({ userId: a.id, agent: false })}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashCard>
  );
}

function DeskTicket({ reference }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [data, setData] = useState(null);
  const [agents, setAgents] = useState([]);
  const [notice, setNotice] = useState(null);
  const [escalation, setEscalation] = useState('');

  const load = useCallback(() => api.get(`/support/tickets/${reference}`).then((r) => setData(r.data.data)).catch((e) => setNotice({ tone: 'bad', text: errText(e) })), [reference]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/support/desk/agents').then((r) => setAgents(r.data.data.agents)).catch(() => {}); }, []);

  const act = async (fn, ok) => {
    try {
      const r = await fn();
      setData(r.data.data);
      setNotice({ tone: 'good', text: r.data.message || ok });
      return true;
    } catch (e) {
      setNotice({ tone: 'bad', text: errText(e) });
      return false;
    }
  };
  const update = (body) => act(() => api.patch(`/support/desk/tickets/${reference}`, body));

  if (!data) return <div className="space-y-6"><DashHead eyebrow="Support desk" title={reference} />{notice ? <Notice tone="bad">{notice.text}</Notice> : <DashState icon={RefreshCw} title="Loading…" />}</div>;
  const t = data.ticket;
  const done = t.status === 'CLOSED';
  return (
    <div className="space-y-6 tl-sp">
      <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => navigate('/support/desk')}><ArrowLeft className="w-3.5 h-3.5 inline" /> Queue</button>
      <DashHead eyebrow={`${t.reference} · ${t.categoryLabel}`} title={t.subject} intro={`${t.customer?.name} (${t.customer?.email}) · opened ${when(t.createdAt)}`} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      <div className="tl-sp-grid">
        <section aria-label="Conversation">
          <Thread messages={data.messages} viewer="agent" />
          <ReplyBox agent disabled={done} disabledText="This request is closed." onSend={(fd) => act(() => api.post(`/support/tickets/${reference}/replies`, fd))} />
        </section>
        <aside className="space-y-4">
          <div className="tl-sp-facts">
            <label className="grid gap-1 text-xs"><span className="font-bold">Status</span>
              <select className="tl-dash-select" value={t.status} disabled={done || (t.status === 'ESCALATED' && !isAdmin)} onChange={(e) => update({ status: e.target.value })}>
                {['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
                {t.status === 'ESCALATED' && <option value="ESCALATED">escalated</option>}
              </select>
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Priority</span>
              <select className="tl-dash-select" value={t.priority} disabled={done} onChange={(e) => update({ priority: e.target.value })}>
                {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Assigned to</span>
              <select className="tl-dash-select" value={t.assignee?.id || ''} disabled={done} onChange={(e) => update({ assigneeId: e.target.value || null })}>
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === user.id ? ' (me)' : ''} · {a.openTickets} open</option>)}
              </select>
            </label>
            {!t.assignee && !done && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => update({ assigneeId: user.id })}>Assign to me</button>}
            <dl className="grid gap-2 text-sm">
              <div><dt>First response</dt><dd>{when(t.firstResponseAt)}</dd></div>
              <div><dt>Last customer message</dt><dd>{when(t.lastCustomerReplyAt)}</dd></div>
              {t.escalationLevel > 0 && <div><dt>Escalation</dt><dd>Level {t.escalationLevel} · {t.escalationReason}</dd></div>}
            </dl>
          </div>

          {data.context && (
            <div className="tl-sp-facts">
              <strong className="text-sm">Linked to</strong>
              {data.context.event && <p className="text-sm">{data.context.event.name} · {data.context.event.company?.companyName} · {data.context.event.status.toLowerCase()}</p>}
              {data.context.order && <p className="text-sm">Booking #{data.context.order.id.slice(0, 8)} · {data.context.order.status.toLowerCase()} · PKR {data.context.order.totalAmount.toLocaleString()} · {data.context.order.tickets} ticket(s) · {data.context.order.paymentMethod}</p>}
            </div>
          )}

          {isAdmin && !done && t.status !== 'RESOLVED' && (
            <div className="tl-sp-facts">
              <strong className="text-sm"><ShieldAlert className="w-4 h-4 inline -mt-0.5" aria-hidden="true" /> Escalation</strong>
              {t.status === 'ESCALATED' ? (
                <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(() => api.post(`/support/desk/tickets/${reference}/deescalate`, { note: escalation || undefined }))}>Escalation handled</button>
              ) : (
                <form className="grid gap-2" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.post(`/support/desk/tickets/${reference}/escalate`, { reason: escalation }))) setEscalation(''); }}>
                  <input className="tl-dash-input" required minLength={3} placeholder="Why is it escalated?" value={escalation} onChange={(e) => setEscalation(e.target.value)} aria-label="Escalation reason" />
                  <button type="submit" className="tl-st-btn tl-st-btn--sm">Escalate</button>
                </form>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
