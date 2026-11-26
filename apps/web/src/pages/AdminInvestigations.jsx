import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, FolderOpen, ArrowLeft, RefreshCw, Plus, Ban, CheckCircle2 } from 'lucide-react';
import api from '../utils/api';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';
import AccountGraph from '../components/ml/AccountGraph';

/*
 * Suspicious account investigations: open a case on an account, add notes and evidence, act on the account
 * (actions are added to the case automatically), change the risk and close with an outcome. The full history
 * stays on the case.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const RISK_TONE = { LOW: 'ACTIVE', MEDIUM: 'PENDING', HIGH: 'FAILED', CRITICAL: 'BANNED' };

export default function AdminInvestigations() {
  const { id } = useParams();
  return id ? <CaseView id={id} /> : <CaseList />;
}

function CaseList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('OPEN');
  const [rows, setRows] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ email: '', title: '', riskLevel: 'MEDIUM', note: '' });
  const load = useCallback(() => api.get('/admin/investigations', { params: { status: status || undefined } }).then((r) => setRows(r.data.data.cases)).catch((e) => setNotice({ tone: 'bad', text: errText(e) })), [status]);
  useEffect(() => { load(); }, [load]);
  const open = async (e) => {
    e.preventDefault();
    try {
      const users = await api.get('/admin/users', { params: { search: form.email, limit: 5 } });
      const list = users.data.data?.users || users.data.users || [];
      const u = list.find((x) => x.email?.toLowerCase() === form.email.trim().toLowerCase());
      if (!u) return setNotice({ tone: 'bad', text: 'No account with this email.' });
      const r = await api.post('/admin/investigations', { userId: u.id, title: form.title, riskLevel: form.riskLevel, note: form.note || undefined });
      navigate(`/admin/investigations/${r.data.data.case.id}`);
    } catch (err) {
      setNotice({ tone: 'bad', text: errText(err) });
    }
  };
  return (
    <div className="space-y-6">
      <DashHead eyebrow="Admin console" title="Investigations" intro="Cases about suspicious accounts, with every note, piece of evidence and action in one history." segment={<Segmented label="Status" options={[{ value: 'OPEN', label: 'Open', icon: FolderOpen }, { value: 'MONITORING', label: 'Monitoring' }, { value: 'CLOSED', label: 'Closed' }, { value: '', label: 'All' }]} value={status} onChange={setStatus} />} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      <DashCard title="Open a case" icon={Plus}>
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={open}>
          <input className="tl-dash-input" type="email" required placeholder="Account email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Account email" />
          <input className="tl-dash-input sm:col-span-2" required minLength={3} maxLength={140} placeholder="What is suspected?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" />
          <select className="tl-dash-select" value={form.riskLevel} onChange={(e) => setForm({ ...form, riskLevel: e.target.value })} aria-label="Risk">{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((r) => <option key={r} value={r}>{r.toLowerCase()} risk</option>)}</select>
          <input className="tl-dash-input sm:col-span-3" maxLength={3000} placeholder="First note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" />
          <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm">Open case</button>
        </form>
      </DashCard>
      <DashCard title="Cases" icon={Search} aside={<button type="button" className="tl-st-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>}>
        {!rows ? <DashState icon={RefreshCw} title="Loading…" /> : !rows.length ? <DashState icon={FolderOpen} title="No cases" /> : (
          <div className="tl-dash-table-wrap"><table className="tl-dash-table">
            <thead><tr><th>Case</th><th>Account</th><th>Risk</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} onClick={() => navigate(`/admin/investigations/${c.id}`)} style={{ cursor: 'pointer' }}>
                <td><strong className="underline">{c.title}</strong><div className="text-xs text-slate-500">{c.notes} entries · opened by {c.openedBy}</div></td>
                <td className="text-xs">{c.user?.name}<div className="text-slate-500">{c.user?.email} · {c.user?.status?.toLowerCase()}</div></td>
                <td><Status value={RISK_TONE[c.riskLevel]} label={c.riskLevel.toLowerCase()} /></td>
                <td><Status value={c.status === 'CLOSED' ? 'INACTIVE' : 'PENDING'} label={c.status.toLowerCase()} /></td>
                <td className="text-xs">{when(c.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </DashCard>
    </div>
  );
}

function CaseView({ id }) {
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [note, setNote] = useState({ kind: 'NOTE', body: '' });
  const [outcome, setOutcome] = useState('');
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => api.get(`/admin/investigations/${id}`).then((r) => setC(r.data.data.case)).catch((e) => setNotice({ tone: 'bad', text: errText(e) })), [id]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn) => {
    try {
      const r = await fn();
      if (r.data.data?.case) setC(r.data.data.case);
      else load();
      setNotice({ tone: 'good', text: r.data.message });
      return true;
    } catch (e) {
      setNotice({ tone: 'bad', text: errText(e) });
      return false;
    }
  };
  if (!c) return <div className="space-y-6"><DashHead eyebrow="Investigations" title="Case" />{notice ? <Notice tone="bad">{notice.text}</Notice> : <DashState icon={RefreshCw} title="Loading…" />}</div>;
  const acct = c.account;
  const closed = c.status === 'CLOSED';
  return (
    <div className="space-y-6">
      <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => navigate('/admin/investigations')}><ArrowLeft className="w-3.5 h-3.5 inline" /> All cases</button>
      <DashHead eyebrow={`Investigation · ${c.status.toLowerCase()} · ${c.riskLevel.toLowerCase()} risk`} title={c.title} intro={`${acct?.name} (${acct?.email}) · opened ${when(c.createdAt)} by ${c.openedBy}`} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <DashCard title="History">
            <ol className="grid gap-3">
              {c.notes.map((n) => (
                <li key={n.id} className="text-sm border-l-4 pl-3" style={{ borderColor: n.kind === 'ACTION' ? '#dc2626' : n.kind === 'EVIDENCE' ? '#d97706' : n.kind === 'STATUS' ? '#64748b' : '#16a34a' }}>
                  <div className="text-xs text-slate-500">{when(n.createdAt)} · {n.author || 'System'} · {n.kind.toLowerCase()}</div>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
                </li>
              ))}
            </ol>
            {!closed && (
              <form className="grid gap-2 mt-4" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post(`/admin/investigations/${id}/notes`, note))) setNote({ ...note, body: '' }); }}>
                <textarea className="tl-dash-input" rows={3} required minLength={2} placeholder="Add a note or evidence" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} aria-label="Note" />
                <div className="flex gap-2">
                  <select className="tl-dash-select" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })} aria-label="Kind"><option value="NOTE">Note</option><option value="EVIDENCE">Evidence</option></select>
                  <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm">Add</button>
                </div>
              </form>
            )}
          </DashCard>
          {acct?.id && <AccountGraph userId={acct.id} />}
        </div>
        <aside className="space-y-6">
          <DashCard title="Account">
            <dl className="grid gap-2 text-sm">
              <div><dt className="text-xs text-slate-500">Status</dt><dd><Status value={acct?.status} /></dd></div>
              <div><dt className="text-xs text-slate-500">Role · city</dt><dd>{acct?.role?.toLowerCase()} · {acct?.city || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">Joined</dt><dd>{when(acct?.createdAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Orders</dt><dd>{Object.entries(c.signals.orders).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'none'}</dd></div>
              <div><dt className="text-xs text-slate-500">Bot checks at checkout</dt><dd>{c.signals.botChecks}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2 mt-3">
              {acct?.status === 'ACTIVE'
                ? <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.put(`/admin/users/${acct.id}/status`, { status: 'SUSPENDED', reason: `Investigation: ${c.title}` }))}><Ban className="w-3.5 h-3.5 inline" /> Suspend account</button>
                : <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.put(`/admin/users/${acct.id}/status`, { status: 'ACTIVE', reason: `Investigation: ${c.title}` }))}><CheckCircle2 className="w-3.5 h-3.5 inline" /> Reactivate</button>}
            </div>
          </DashCard>
          <DashCard title="Case">
            <div className="grid gap-2">
              <select className="tl-dash-select" value={c.riskLevel} onChange={(e) => run(() => api.patch(`/admin/investigations/${id}`, { riskLevel: e.target.value }))} aria-label="Risk">{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((r) => <option key={r} value={r}>{r.toLowerCase()} risk</option>)}</select>
              {closed ? (
                <><p className="text-sm"><b>Outcome:</b> {c.outcome}</p><button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.patch(`/admin/investigations/${id}`, { status: 'OPEN' }))}>Reopen</button></>
              ) : (
                <>
                  {c.status !== 'MONITORING' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.patch(`/admin/investigations/${id}`, { status: 'MONITORING' }))}>Move to monitoring</button>}
                  <textarea className="tl-dash-input" rows={2} placeholder="Outcome (needed to close)" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome" />
                  <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => run(() => api.patch(`/admin/investigations/${id}`, { status: 'CLOSED', outcome }))}>Close case</button>
                </>
              )}
            </div>
          </DashCard>
          <DashCard title="Recent account activity">
            <ul className="text-xs grid gap-1">{c.signals.recentActivity.map((a) => <li key={a.id}><code>{a.action}</code> · {when(a.createdAt)}{a.ipAddress ? ` · ${a.ipAddress}` : ''}</li>)}</ul>
          </DashCard>
        </aside>
      </div>
    </div>
  );
}
