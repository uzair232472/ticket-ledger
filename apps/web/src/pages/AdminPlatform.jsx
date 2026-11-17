import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings, ShieldCheck, Megaphone, Download, History, RefreshCw, Save, Undo2, UserPlus, Trash2, Send, X } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';

/*
 * Platform administration: system settings, admins and their permissions, platform-wide messages, data exports
 * and the admin action log with Undo. Tabs follow the admin's own permissions; the API checks every one again.
 * Destructive changes ask for a typed confirmation (lib/typedConfirm.js handles the API's request for it).
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function AdminPlatform() {
  const { user } = useAuth();
  const perms = new Set(user?.adminPermissions || []);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState(null);
  const flash = (tone, text) => setNotice({ tone, text });
  const tabs = [
    perms.has('admin.view') && { value: 'settings', label: 'Settings', icon: Settings },
    perms.has('admin.admins') && { value: 'admins', label: 'Admins', icon: ShieldCheck },
    perms.has('admin.notify') && { value: 'messages', label: 'Messages', icon: Megaphone },
    perms.has('admin.export') && { value: 'exports', label: 'Exports', icon: Download },
    perms.has('admin.view') && { value: 'actions', label: 'Admin actions', icon: History },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  const shared = { flash, perms, me: user };
  return (
    <div className="space-y-6">
      <DashHead eyebrow="Admin console" title="Platform" intro="Settings, admins, platform-wide messages, exports and the log of admin decisions." segment={<Segmented label="Platform sections" options={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />} />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      {tab === 'settings' && <SettingsTab {...shared} />}
      {tab === 'admins' && <AdminsTab {...shared} />}
      {tab === 'messages' && <MessagesTab {...shared} />}
      {tab === 'exports' && <ExportsTab {...shared} />}
      {tab === 'actions' && <ActionsTab {...shared} />}
    </div>
  );
}

function SettingsTab({ flash, perms }) {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const load = useCallback(() => api.get('/admin/config').then((r) => { setSettings(r.data.data.settings); setDraft(Object.fromEntries(r.data.data.settings.map((s) => [s.key, s.value]))); }).catch((e) => flash('bad', errText(e))), []);
  useEffect(() => { load(); }, [load]);
  const save = async (key) => {
    try {
      const r = await api.put(`/admin/config/${key}`, { value: draft[key] });
      flash('good', r.data.message);
      setSettings(r.data.data.settings);
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  if (!settings) return <DashState icon={RefreshCw} title="Loading…" />;
  const can = perms.has('admin.config');
  return (
    <DashCard title="System settings" sub={can ? 'Changes apply within 30 seconds. They are logged and can be undone from Admin actions.' : 'Your admin role can see but not change these.'} icon={Settings}>
      <div className="grid gap-4">
        {settings.map((s) => (
          <div key={s.key} className="grid gap-2 sm:grid-cols-[1fr_auto] items-end border-b pb-3">
            <label className="grid gap-1 text-sm"><span className="font-bold">{s.label}</span>
              {s.type === 'number' && <input className="tl-dash-input" type="number" min={s.min} max={s.max} disabled={!can} value={draft[s.key]} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} />}
              {s.type === 'boolean' && <span className="flex items-center gap-2"><input type="checkbox" disabled={!can} checked={Boolean(draft[s.key])} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.checked })} /> {draft[s.key] ? 'Yes' : 'No'}</span>}
              {s.type === 'banner' && (
                <span className="grid gap-2">
                  <label className="flex items-center gap-2"><input type="checkbox" disabled={!can} checked={Boolean(draft[s.key]?.active)} onChange={(e) => setDraft({ ...draft, [s.key]: { ...draft[s.key], active: e.target.checked } })} /> Show the banner</label>
                  <input className="tl-dash-input" disabled={!can} maxLength={300} placeholder="Message shown at the top of every page" value={draft[s.key]?.message || ''} onChange={(e) => setDraft({ ...draft, [s.key]: { ...draft[s.key], message: e.target.value } })} />
                  <select className="tl-dash-select" disabled={!can} value={draft[s.key]?.tone || 'info'} onChange={(e) => setDraft({ ...draft, [s.key]: { ...draft[s.key], tone: e.target.value } })}><option value="info">Information</option><option value="warn">Warning</option><option value="bad">Problem</option></select>
                </span>
              )}
              <span className="text-xs text-slate-500">{s.updatedAt ? `Last changed ${when(s.updatedAt)}` : `Default: ${typeof s.default === 'object' ? 'off' : String(s.default)}`}{s.confirm ? ' · needs typed confirmation' : ''}</span>
            </label>
            {can && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => save(s.key)}><Save className="w-3.5 h-3.5 inline" /> Save</button>}
          </div>
        ))}
      </div>
    </DashCard>
  );
}

function AdminsTab({ flash, me }) {
  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [form, setForm] = useState({ email: '', role: 'SUPPORT', password: '' });
  const [open, setOpen] = useState(null);
  const load = useCallback(() => Promise.all([api.get('/admin/admins'), api.get('/admin/me')]).then(([a, m]) => { setData(a.data.data.admins); setCatalog(m.data.data.catalog); }).catch((e) => flash('bad', errText(e))), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn) => {
    try {
      const r = await fn();
      flash('good', r.data.message);
      load();
      return true;
    } catch (e) {
      flash('bad', errText(e));
      return false;
    }
  };
  if (!data || !catalog) return <DashState icon={RefreshCw} title="Loading…" />;
  return (
    <div className="space-y-6">
      <DashCard title="Add an admin" sub="An existing, active account that isn't in an organization. You'll type their email to confirm." icon={UserPlus}>
        <form className="grid gap-3 sm:grid-cols-4 items-end" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post('/admin/admins', form))) setForm({ email: '', role: form.role, password: '' }); }}>
          <input className="tl-dash-input" type="email" required placeholder="Account email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Account email" />
          <select className="tl-dash-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Admin role">{Object.entries(catalog.roles).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select>
          <input className="tl-dash-input" type="password" required placeholder="Your password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Your password" />
          <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><UserPlus className="w-3.5 h-3.5 inline" /> Add admin</button>
        </form>
      </DashCard>
      <DashCard title="Admins" sub="Roles: Owner (everything), Finance, Support, Moderator, Analyst (read only). Add single permissions on top of a role." icon={ShieldCheck}>
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>Admin</th><th>Role</th><th>Permissions</th><th /></tr></thead>
            <tbody>
              {data.map((a) => (
                <React.Fragment key={a.id}>
                  <tr>
                    <td><strong>{a.name}</strong><div className="text-xs text-slate-500">{a.email}{a.id === me?.id ? ' · you' : ''}</div></td>
                    <td>{a.id === me?.id ? a.roleLabel : <select className="tl-dash-select" value={a.adminRole} onChange={(e) => run(() => api.patch(`/admin/admins/${a.id}`, { role: e.target.value }))}>{Object.entries(catalog.roles).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select>}</td>
                    <td className="text-xs">{a.permissions.length} of {Object.keys(catalog.permissions).length}</td>
                    <td>{a.id !== me?.id && (
                      <div className="flex gap-2">
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setOpen(open === a.id ? null : a.id)}>Extra permissions</button>
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.delete(`/admin/admins/${a.id}`, { data: {} }))} aria-label={`Remove ${a.email}`}><Trash2 className="w-3.5 h-3.5 inline" /></button>
                      </div>
                    )}</td>
                  </tr>
                  {open === a.id && (
                    <tr><td colSpan={4}>
                      <ExtraPermissions admin={a} catalog={catalog} onSave={(permissions) => run(() => api.patch(`/admin/admins/${a.id}`, { permissions }))} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  );
}

function ExtraPermissions({ admin, catalog, onSave }) {
  const base = new Set(catalog.roles[admin.adminRole]?.permissions || []);
  const [extra, setExtra] = useState(admin.adminPermissions || []);
  return (
    <div className="grid gap-2 p-2">
      {Object.entries(catalog.permissions).map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-xs">
          <input type="checkbox" disabled={base.has(k)} checked={base.has(k) || extra.includes(k)} onChange={() => setExtra(extra.includes(k) ? extra.filter((x) => x !== k) : [...extra, k])} />
          <code>{k}</code> {label}{base.has(k) ? ' (from the role)' : ''}
        </label>
      ))}
      <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm justify-self-start" onClick={() => onSave(extra.filter((k) => !base.has(k)))}><Save className="w-3.5 h-3.5 inline" /> Save permissions</button>
    </div>
  );
}

function MessagesTab({ flash }) {
  const [list, setList] = useState(null);
  const [audiences, setAudiences] = useState({});
  const [form, setForm] = useState({ title: '', message: '', link: '', audience: 'CUSTOMERS', city: '', sendEmail: true, scheduledFor: '' });
  const [count, setCount] = useState(null);
  const load = useCallback(() => api.get('/admin/broadcasts').then((r) => { setList(r.data.data.broadcasts); setAudiences(r.data.data.audiences); }).catch((e) => flash('bad', errText(e))), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setTimeout(() => api.get('/admin/broadcasts/audience', { params: { audience: form.audience, city: form.city || undefined } }).then((r) => setCount(r.data.data.recipients)).catch(() => setCount(null)), 300);
    return () => clearTimeout(id);
  }, [form.audience, form.city]);
  const send = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/admin/broadcasts', { ...form, scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : '' });
      flash('good', r.data.message);
      setForm({ ...form, title: '', message: '', link: '', scheduledFor: '' });
      load();
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  return (
    <div className="space-y-6">
      <DashCard title="New message" sub="Each person gets an in-app notification (and an email if you choose). Sending to everyone asks for a typed confirmation." icon={Megaphone}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={send}>
          <input className="tl-dash-input sm:col-span-2" required maxLength={120} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" />
          <textarea className="tl-dash-input sm:col-span-2" rows={4} required maxLength={2000} placeholder="Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} aria-label="Message" />
          <select className="tl-dash-select" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} aria-label="Audience">{Object.entries(audiences).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className="tl-dash-input" maxLength={60} placeholder="Only in this city (optional)" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} aria-label="City" />
          <input className="tl-dash-input" maxLength={200} placeholder="Link to a page, e.g. /events (optional)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} aria-label="Link" />
          <label className="grid gap-1 text-xs"><span className="font-bold">Send later (optional)</span><input className="tl-dash-input" type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} /></label>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} /> Also email it (people who turned email off get it in-app only)</label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Send className="w-3.5 h-3.5 inline" /> {form.scheduledFor ? 'Schedule' : 'Send'}</button>
            {count != null && <span className="text-xs text-slate-600">{count} recipient{count === 1 ? '' : 's'}</span>}
          </div>
        </form>
      </DashCard>
      <DashCard title="Sent and scheduled" icon={History}>
        {!list ? <DashState icon={RefreshCw} title="Loading…" /> : !list.length ? <DashState icon={Megaphone} title="No messages yet" /> : (
          <div className="tl-dash-table-wrap"><table className="tl-dash-table">
            <thead><tr><th>Message</th><th>Audience</th><th>Status</th><th>Recipients</th><th /></tr></thead>
            <tbody>{list.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.title}</strong><div className="text-xs text-slate-500">{b.sentBy} · {when(b.sentAt || b.createdAt)}</div></td>
                <td className="text-xs">{b.audienceLabel}{b.city ? ` · ${b.city}` : ''}{b.sendEmail ? ' · email' : ''}</td>
                <td><Status value={b.status === 'SENT' ? 'ACTIVE' : b.status === 'SCHEDULED' ? 'PENDING' : 'INACTIVE'} label={b.status === 'SCHEDULED' ? `Scheduled ${when(b.scheduledFor)}` : b.status.toLowerCase()} /></td>
                <td>{b.recipientCount}</td>
                <td>{b.status === 'SCHEDULED' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={async () => { try { await api.post(`/admin/broadcasts/${b.id}/cancel`); load(); } catch (e) { flash('bad', errText(e)); } }}><X className="w-3.5 h-3.5 inline" /> Cancel</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </DashCard>
    </div>
  );
}

function ExportsTab({ flash }) {
  const [sets, setSets] = useState([]);
  const [range, setRange] = useState({ from: '', to: '' });
  useEffect(() => { api.get('/admin/exports').then((r) => setSets(r.data.data.datasets)).catch((e) => flash('bad', errText(e))); }, []);
  const download = async (key) => {
    try {
      const r = await api.get(`/admin/exports/${key}`, { params: { from: range.from || undefined, to: range.to || undefined }, responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ticketledger-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      flash('bad', 'The export could not be downloaded.');
    }
  };
  return (
    <DashCard title="Data exports" sub="CSV files, up to 50,000 rows. Every export is recorded in the audit log." icon={Download}>
      <div className="flex flex-wrap gap-3 mb-4">
        <label className="grid gap-1 text-xs"><span className="font-bold">Created from</span><input className="tl-dash-input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="grid gap-1 text-xs"><span className="font-bold">to</span><input className="tl-dash-input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      </div>
      <div className="tl-dash-table-wrap"><table className="tl-dash-table">
        <tbody>{sets.map((d) => <tr key={d.key}><td><strong>{d.label}</strong><div className="text-xs text-slate-500">{d.columns.join(', ')}</div></td><td><button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => download(d.key)}><Download className="w-3.5 h-3.5 inline" /> CSV</button></td></tr>)}</tbody>
      </table></div>
    </DashCard>
  );
}

function ActionsTab({ flash }) {
  const [onlyUndoable, setOnlyUndoable] = useState(false);
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/admin/actions', { params: { reversible: onlyUndoable || undefined } }).then((r) => setData(r.data.data)).catch((e) => flash('bad', errText(e))), [onlyUndoable]);
  useEffect(() => { load(); }, [load]);
  const undo = async (a) => {
    try {
      const r = await api.post(`/admin/actions/${a.id}/undo`);
      flash('good', r.data.message);
      load();
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  return (
    <DashCard title="Admin actions" sub="Decisions on accounts, organizations, payouts and settings. Reversible ones can be undone for 30 days if nothing changed them since." icon={History}
      aside={<label className="text-xs flex items-center gap-2"><input type="checkbox" checked={onlyUndoable} onChange={(e) => setOnlyUndoable(e.target.checked)} /> Only undoable</label>}>
      {!data ? <DashState icon={RefreshCw} title="Loading…" /> : !data.items.length ? <DashState icon={History} title="Nothing yet" /> : (
        <div className="tl-dash-table-wrap"><table className="tl-dash-table">
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th /></tr></thead>
          <tbody>{data.items.map((a) => (
            <tr key={a.id} style={a.reversedAt ? { opacity: 0.55 } : undefined}>
              <td className="text-xs whitespace-nowrap">{when(a.createdAt)}</td>
              <td className="text-xs">{a.admin}</td>
              <td className="text-xs"><code>{a.action}</code><div>{a.summary}</div>{a.reversedAt && <div>Undone by {a.reversedBy} · {when(a.reversedAt)}</div>}</td>
              <td>{a.canUndo && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => undo(a)}><Undo2 className="w-3.5 h-3.5 inline" /> Undo</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </DashCard>
  );
}
