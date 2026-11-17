import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Activity, DoorOpen, Users, Smartphone, ShieldAlert, ListChecks, FileBarChart, Plus, Save, RefreshCw, Download, Undo2, Check, X } from 'lucide-react';
import api from '../utils/api';
import { API_URL } from '../lib/session';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';

/*
 * Gate management for supervisors (gate.supervise): live load per gate, the gates themselves (type, ticket
 * types, capacity), re-entry policy, which staff work which gates, scanner devices and their sync status,
 * exception requests from the gates, check-ins (with reversal) and per-gate attendance reports.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const clock = (v) => (v ? new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');
const TYPE_LABELS = { ENTRY: 'Entry only', EXIT: 'Exit only', ENTRY_EXIT: 'Entry & exit' };
const SYNC = {
  IN_SYNC: ['ACTIVE', 'In sync'],
  UPLOADING: ['PENDING', 'Uploading scans'],
  OFFLINE: ['PENDING', 'Offline'],
  OFFLINE_WITH_SCANS: ['FAILED', 'Offline with scans not uploaded'],
  NOT_SEEN: ['INACTIVE', 'Not seen recently'],
  REVOKED: ['REJECTED', 'Revoked'],
};

export default function GateManagement() {
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const eventId = params.get('event') || '';
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const tab = params.get('tab') || 'live';
  const setTab = (v) => setParams((p) => { p.set('tab', v); return p; }, { replace: true });
  const flash = (tone, text) => setNotice({ tone, text });

  useEffect(() => {
    api.get('/events/organizer/my-events').then((r) => setEvents(r.data.data.events || [])).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      const r = await api.get(`/checkin/manage/events/${eventId}`);
      setData(r.data.data);
    } catch (e) {
      setData(null);
      flash('bad', errText(e));
    }
  }, [eventId]);
  useEffect(() => { setData(null); load(); }, [load]);

  // Live counters while the page is open
  useEffect(() => {
    if (!eventId) return undefined;
    const socket = io(import.meta.env.VITE_SOCKET_URL || API_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('join_event_room', eventId));
    socket.on('checkin:stats', (s) => s.eventId === eventId && setData((d) => (d ? { ...d, live: s } : d)));
    socket.on('gate:exception', () => setData((d) => (d ? { ...d, live: { ...d.live, pendingExceptions: (d.live?.pendingExceptions || 0) + 1 } } : d)));
    return () => {
      socket.emit('leave_event_room', eventId);
      socket.disconnect();
    };
  }, [eventId]);

  const run = async (fn) => {
    try {
      const r = await fn();
      flash('good', r.data.message || 'Saved.');
      await load();
      return r;
    } catch (e) {
      flash('bad', errText(e));
      return null;
    }
  };

  const tabs = [
    { value: 'live', label: 'Live', icon: Activity },
    { value: 'gates', label: 'Gates & re-entry', icon: DoorOpen },
    { value: 'staff', label: 'Gate staff', icon: Users },
    { value: 'devices', label: 'Devices', icon: Smartphone },
    { value: 'exceptions', label: 'Exceptions', icon: ShieldAlert, count: data?.live?.pendingExceptions || undefined },
    { value: 'checkins', label: 'Check-ins', icon: ListChecks },
    { value: 'report', label: 'Reports', icon: FileBarChart },
  ];

  return (
    <div className="space-y-6">
      <DashHead
        eyebrow="Gate management"
        title={data?.event?.name || 'Gates'}
        intro="Set up gates, assign staff to them, watch the load and handle problems at the gate."
        segment={eventId && <Segmented label="Gate sections" options={tabs} value={tab} onChange={setTab} />}
      />
      <DashCard title="Event">
        <select className="tl-dash-select w-full" value={eventId} onChange={(e) => setParams({ event: e.target.value, tab })} aria-label="Event">
          <option value="">Choose an event…</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name} · {new Date(e.date).toLocaleDateString()}</option>)}
        </select>
      </DashCard>
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      {eventId && !data && <DashState icon={RefreshCw} title="Loading…" />}
      {data && (
        <>
          {tab === 'live' && <Live data={data} />}
          {tab === 'gates' && <Gates data={data} eventId={eventId} run={run} />}
          {tab === 'staff' && <Staff data={data} eventId={eventId} run={run} />}
          {tab === 'devices' && <Devices eventId={eventId} flash={flash} />}
          {tab === 'exceptions' && <Exceptions eventId={eventId} flash={flash} onChange={load} />}
          {tab === 'checkins' && <CheckIns data={data} eventId={eventId} flash={flash} onChange={load} />}
          {tab === 'report' && <Report eventId={eventId} />}
        </>
      )}
    </div>
  );
}

// ── Live ───────────────────────────────────────────────────────────────────────────────────────────────

function Live({ data }) {
  const s = data.live;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[['Entered', `${s.entered} / ${s.sold}`], ['Inside now', s.inside], ['Turned away', s.scans?.RED || 0], ['Waiting for a supervisor', s.pendingExceptions || 0]].map(([l, v]) => (
          <DashCard key={l} title={l}><p className="text-3xl font-extrabold">{v}</p></DashCard>
        ))}
      </div>
      <DashCard title="Gate load" sub="Entries in the last 15 minutes, as a rate per hour, against each gate's capacity." icon={Activity}>
        {!s.gates.length ? <DashState icon={DoorOpen} title="No scans yet" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Gate</th><th>Entered</th><th>Exits</th><th>Last 15 min</th><th>Rate / hour</th><th>Load</th></tr></thead>
              <tbody>
                {s.gates.map((g) => (
                  <tr key={g.id || g.gate}>
                    <td><strong>{g.gate}</strong>{g.type && <div className="text-xs text-slate-500">{TYPE_LABELS[g.type]}{g.active === false ? ' · closed' : ''}</div>}</td>
                    <td>{g.entered}</td>
                    <td>{g.exits ?? '—'}</td>
                    <td>{g.last15 ?? '—'}</td>
                    <td>{g.ratePerHour ?? '—'}{g.capacityPerHour ? ` / ${g.capacityPerHour}` : ''}</td>
                    <td>
                      {g.loadPct == null ? <span className="text-xs text-slate-500">No capacity set</span> : (
                        <div style={{ minWidth: 120 }}>
                          <div style={{ height: 8, borderRadius: 4, background: '#e5e7eb', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${Math.min(100, g.loadPct)}%`, background: g.overloaded ? '#dc2626' : g.loadPct > 70 ? '#d97706' : '#16a34a' }} /></div>
                          <span className="text-xs">{g.loadPct}%{g.overloaded ? ' · send more staff or open another gate' : ''}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {s.conflicts > 0 && <p className="text-xs mt-3 text-rose-700">{s.conflicts} ticket(s) were admitted twice while devices were offline. See Check-ins.</p>}
      </DashCard>
    </div>
  );
}

// ── Gates & re-entry ───────────────────────────────────────────────────────────────────────────────────

const EMPTY_GATE = { name: '', type: 'ENTRY_EXIT', allowedTierIds: [], capacityPerHour: '' };

function Gates({ data, eventId, run }) {
  const [form, setForm] = useState(EMPTY_GATE);
  const [editing, setEditing] = useState(null);
  const [policy, setPolicy] = useState({ reentryPolicy: data.event.reentryPolicy, maxReentries: data.event.maxReentries || 1 });
  const base = `/checkin/manage/events/${eventId}`;
  const start = (g) => {
    setEditing(g ? g.id : 'new');
    setForm(g ? { name: g.name, type: g.type, allowedTierIds: g.allowedTierIds, capacityPerHour: g.capacityPerHour || '' } : EMPTY_GATE);
  };
  const save = async (e) => {
    e.preventDefault();
    const body = { ...form, capacityPerHour: form.capacityPerHour === '' ? null : Number(form.capacityPerHour) };
    const ok = await run(() => (editing === 'new' ? api.post(`${base}/gates`, body) : api.patch(`${base}/gates/${editing}`, body)));
    if (ok) setEditing(null);
  };
  const toggleTier = (id) => setForm({ ...form, allowedTierIds: form.allowedTierIds.includes(id) ? form.allowedTierIds.filter((x) => x !== id) : [...form.allowedTierIds, id] });

  return (
    <div className="space-y-6">
      <DashCard
        title="Gates"
        sub="Without gates, staff type any gate name. Once you add gates, every scan names one of them."
        icon={DoorOpen}
        aside={editing !== 'new' && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => start(null)}><Plus className="w-3.5 h-3.5 inline" /> Add gate</button>}
      >
        {editing && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-4 mb-6 p-3 border rounded">
            <label className="grid gap-1 text-xs"><span className="font-bold">Name</span><input className="tl-dash-input" required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Type</span>
              <select className="tl-dash-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Capacity per hour (optional)</span><input className="tl-dash-input" type="number" min={1} value={form.capacityPerHour} onChange={(e) => setForm({ ...form, capacityPerHour: e.target.value })} /></label>
            <span />
            {form.type !== 'EXIT' && (
              <div className="sm:col-span-4 text-xs">
                <span className="font-bold">Ticket types allowed in</span> <span className="text-slate-500">(none ticked: every type)</span>
                <div className="flex flex-wrap gap-3 mt-1">
                  {data.tiers.map((t) => <label key={t.id} className="flex items-center gap-1"><input type="checkbox" checked={form.allowedTierIds.includes(t.id)} onChange={() => toggleTier(t.id)} /> {t.name}</label>)}
                </div>
              </div>
            )}
            <div className="sm:col-span-4 flex gap-2">
              <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Save className="w-3.5 h-3.5 inline" /> Save gate</button>
              <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}
        {!data.gates.length ? <DashState icon={DoorOpen} title="No gates yet" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Gate</th><th>Type</th><th>Ticket types</th><th>Capacity / hour</th><th>Staff</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.gates.map((g) => (
                  <tr key={g.id}>
                    <td><strong>{g.name}</strong></td>
                    <td className="text-xs">{TYPE_LABELS[g.type]}</td>
                    <td className="text-xs">{g.type === 'EXIT' ? '—' : g.allowedTiers.length ? g.allowedTiers.map((t) => t.name).join(', ') : 'All'}</td>
                    <td className="text-xs">{g.capacityPerHour || '—'}</td>
                    <td className="text-xs">{g.staff.length ? g.staff.map((s) => s.name).join(', ') : 'Anyone'}</td>
                    <td><Status value={g.active ? 'ACTIVE' : 'INACTIVE'} label={g.active ? 'Open' : 'Closed'} /></td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => start(g)}>Edit</button>
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.patch(`${base}/gates/${g.id}`, { active: !g.active }))}>{g.active ? 'Close' : 'Open'}</button>
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.delete(`${base}/gates/${g.id}`))}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>

      <DashCard title="Re-entry policy" sub="After an exit scan, can the guest come back in with the same ticket?" icon={Undo2}>
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); run(() => api.put(`${base}/policy`, { reentryPolicy: policy.reentryPolicy, maxReentries: policy.reentryPolicy === 'LIMITED' ? Number(policy.maxReentries) : null })); }}>
          <label className="grid gap-1 text-xs"><span className="font-bold">Policy</span>
            <select className="tl-dash-select" value={policy.reentryPolicy} onChange={(e) => setPolicy({ ...policy, reentryPolicy: e.target.value })}>
              <option value="NONE">No re-entry</option>
              <option value="UNLIMITED">Unlimited re-entry</option>
              <option value="LIMITED">Limited re-entry</option>
            </select>
          </label>
          {policy.reentryPolicy === 'LIMITED' && (
            <label className="grid gap-1 text-xs"><span className="font-bold">Re-entries allowed</span><input className="tl-dash-input" type="number" min={1} max={50} value={policy.maxReentries} onChange={(e) => setPolicy({ ...policy, maxReentries: e.target.value })} /></label>
          )}
          <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Save className="w-3.5 h-3.5 inline" /> Save policy</button>
        </form>
      </DashCard>
    </div>
  );
}

// ── Gate staff ─────────────────────────────────────────────────────────────────────────────────────────

function Staff({ data, eventId, run }) {
  const [draft, setDraft] = useState({});
  if (!data.gates.length) return <DashCard title="Gate staff"><DashState icon={Users} title="Add gates first">Then you can limit staff to the gates they work.</DashState></DashCard>;
  const gatesOf = (s) => draft[s.id] ?? s.gateIds;
  const toggle = (s, id) => {
    const cur = gatesOf(s);
    setDraft({ ...draft, [s.id]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <DashCard title="Gate staff" sub="Tick the gates each person may scan at. Nobody ticked: they may use every gate. Add people to the event under Team → Gate staff." icon={Users}>
      {!data.scanners.length ? <DashState icon={Users} title="Nobody scans at this event yet" /> : (
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>Person</th>{data.gates.map((g) => <th key={g.id}>{g.name}</th>)}<th /></tr></thead>
            <tbody>
              {data.scanners.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><div className="text-xs text-slate-500">{s.email}</div></td>
                  {data.gates.map((g) => <td key={g.id} className="text-center"><input type="checkbox" aria-label={`${s.name} at ${g.name}`} checked={gatesOf(s).includes(g.id)} onChange={() => toggle(s, g.id)} /></td>)}
                  <td>{draft[s.id] && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={async () => { if (await run(() => api.put(`/checkin/manage/events/${eventId}/staff/${s.id}/gates`, { gateIds: draft[s.id] }))) setDraft({ ...draft, [s.id]: undefined }); }}>Save</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashCard>
  );
}

// ── Devices ────────────────────────────────────────────────────────────────────────────────────────────

function Devices({ eventId, flash }) {
  const [devices, setDevices] = useState(null);
  const [reasons, setReasons] = useState({});
  const load = useCallback(() => api.get(`/checkin/manage/events/${eventId}/devices`).then((r) => setDevices(r.data.data.devices)).catch((e) => flash('bad', errText(e))), [eventId]);
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);
  const update = async (d, body) => {
    try {
      const r = await api.patch(`/checkin/manage/events/${eventId}/devices/${d.id}`, body);
      flash('good', r.data.message);
      load();
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  return (
    <DashCard title="Scanner devices" sub="Phones and tablets register the first time they scan. A revoked device can't scan, upload or download ticket lists. Updates every 30 seconds." icon={Smartphone} aside={<button type="button" className="tl-st-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>}>
      {!devices ? <DashState icon={RefreshCw} title="Loading…" /> : !devices.length ? <DashState icon={Smartphone} title="No devices yet" /> : (
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>Device</th><th>Sync</th><th>Waiting scans</th><th>Last seen</th><th>Ticket list</th><th>Used by</th><th /></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input className="tl-dash-input" defaultValue={d.name} aria-label="Device name" onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && update(d, { name: e.target.value.trim() })} />
                    <div className="text-xs text-slate-500">Registered {when(d.createdAt)} by {d.registeredBy || '—'}</div>
                  </td>
                  <td><Status value={SYNC[d.sync][0]} label={SYNC[d.sync][1]} />{d.atThisEvent && d.lastGate && <div className="text-xs">{d.lastGate}</div>}</td>
                  <td>{d.pendingScans}</td>
                  <td className="text-xs">{when(d.lastSeenAt)}<div className="text-slate-500">Last upload {when(d.lastSyncAt)}</div></td>
                  <td className="text-xs">{when(d.packAt)}</td>
                  <td className="text-xs">{d.lastUser || '—'}</td>
                  <td>
                    {d.status === 'REVOKED' ? (
                      <><div className="text-xs mb-1">{d.revokeReason} · {d.revokedBy}</div><button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => update(d, { status: 'ACTIVE' })}>Restore</button></>
                    ) : (
                      <div className="flex gap-2">
                        <input className="tl-dash-input" placeholder="Reason" value={reasons[d.id] || ''} onChange={(e) => setReasons({ ...reasons, [d.id]: e.target.value })} aria-label="Revoke reason" />
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => update(d, { status: 'REVOKED', reason: reasons[d.id] })}>Revoke</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashCard>
  );
}

// ── Exceptions ─────────────────────────────────────────────────────────────────────────────────────────

function Exceptions({ eventId, flash, onChange }) {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [notes, setNotes] = useState({});
  const load = useCallback(() => api.get(`/checkin/manage/events/${eventId}/exceptions`, { params: { status: status || undefined } }).then((r) => setRows(r.data.data.exceptions)).catch((e) => flash('bad', errText(e))), [eventId, status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (x, approve) => {
    try {
      const r = await api.post(`/checkin/manage/events/${eventId}/exceptions/${x.id}/decide`, { approve, note: notes[x.id] || '' });
      flash('good', r.data.message);
      load();
      onChange();
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  return (
    <DashCard title="Exception requests" sub="Gate staff ask here to let in someone the scanner turned away. Every decision is kept in the activity history." icon={ShieldAlert}
      aside={<select className="tl-dash-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show"><option value="PENDING">Waiting</option><option value="APPROVED">Approved</option><option value="DENIED">Denied</option><option value="">All</option></select>}>
      {!rows ? <DashState icon={RefreshCw} title="Loading…" /> : !rows.length ? <DashState icon={ShieldAlert} title="Nothing here" /> : (
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>When</th><th>Gate</th><th>Ticket</th><th>Scanner said</th><th>Staff reason</th><th>Decision</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td className="text-xs">{clock(x.createdAt)}<div className="text-slate-500">{x.requestedBy}</div></td>
                  <td className="text-xs">{x.gate || '—'}</td>
                  <td className="text-xs">{x.ticket ? <>{x.ticket.holder} · {x.ticket.type}<div className="font-mono">{x.ticket.code}</div></> : <span className="text-rose-700">No ticket found{x.code ? ` (${x.code.slice(0, 24)})` : ''}</span>}</td>
                  <td className="text-xs">{x.scanResult}</td>
                  <td className="text-xs">{x.reason}</td>
                  <td>
                    {x.status === 'PENDING' ? (
                      <div className="grid gap-2" style={{ minWidth: 200 }}>
                        <input className="tl-dash-input" placeholder="Note for the record" value={notes[x.id] || ''} onChange={(e) => setNotes({ ...notes, [x.id]: e.target.value })} aria-label="Decision note" />
                        <div className="flex gap-2">
                          <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" disabled={!x.ticket} onClick={() => decide(x, true)}><Check className="w-3.5 h-3.5 inline" /> Approve</button>
                          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => decide(x, false)}><X className="w-3.5 h-3.5 inline" /> Deny</button>
                        </div>
                      </div>
                    ) : <><Status value={x.status === 'APPROVED' ? 'APPROVED' : 'REJECTED'} label={x.status.toLowerCase()} /><div className="text-xs">{x.decidedBy}: {x.decisionNote}</div></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashCard>
  );
}

// ── Check-ins ──────────────────────────────────────────────────────────────────────────────────────────

function CheckIns({ data, eventId, flash, onChange }) {
  const [filters, setFilters] = useState({ gateId: '', result: '', q: '', page: 1 });
  const [rows, setRows] = useState(null);
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => api.get(`/checkin/manage/events/${eventId}/checkins`, { params: { ...filters, gateId: filters.gateId || undefined, result: filters.result || undefined, q: filters.q || undefined } }).then((r) => setRows(r.data.data)).catch((e) => flash('bad', errText(e))), [eventId, filters]);
  useEffect(() => { load(); }, [load]);
  const reverse = async (c) => {
    try {
      const r = await api.post(`/checkin/manage/events/${eventId}/checkins/${c.id}/reverse`, { reason });
      flash('good', r.data.message);
      setReversing(null);
      setReason('');
      load();
      onChange();
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  const pages = rows ? Math.max(1, Math.ceil(rows.total / rows.limit)) : 1;
  return (
    <DashCard title="Check-ins" sub="Every scan at the gates. A supervisor can reverse an admission made by mistake; the ticket becomes valid again." icon={ListChecks}>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <select className="tl-dash-select" value={filters.gateId} onChange={(e) => setFilters({ ...filters, gateId: e.target.value, page: 1 })} aria-label="Gate">
          <option value="">Every gate</option>
          {data.gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select className="tl-dash-select" value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value, page: 1 })} aria-label="Result">
          <option value="">Every result</option>
          <option value="GREEN">Admitted / exited</option>
          <option value="YELLOW">Already used</option>
          <option value="RED">Turned away</option>
        </select>
        <input className="tl-dash-input" placeholder="Ticket code or holder" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} aria-label="Search" />
      </div>
      {!rows ? <DashState icon={RefreshCw} title="Loading…" /> : !rows.items.length ? <DashState icon={ListChecks} title="No scans" /> : (
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>When</th><th>Gate</th><th>Ticket</th><th>Result</th><th>Staff</th><th /></tr></thead>
            <tbody>
              {rows.items.map((c) => (
                <tr key={c.id} style={c.reversedAt ? { opacity: 0.55 } : undefined}>
                  <td className="text-xs whitespace-nowrap">{when(c.scannedAt)}{c.offline && <div>offline</div>}</td>
                  <td className="text-xs">{c.gate || '—'}<div className="text-slate-500">{c.direction === 'EXIT' ? 'Exit' : c.reentry ? 'Re-entry' : 'Entry'}</div></td>
                  <td className="text-xs">{c.ticket ? <>{c.ticket.holder} · {c.ticket.type}<div className="font-mono">{c.ticket.code}</div></> : '—'}</td>
                  <td className="text-xs"><Status value={c.result === 'GREEN' ? 'ACTIVE' : c.result === 'YELLOW' ? 'PENDING' : 'FAILED'} label={c.reason} />{c.conflict && <div className="text-rose-700">Admitted twice offline</div>}{c.exceptionId && <div>By exception</div>}{c.reversedAt && <div>Reversed: {c.reversalReason}</div>}</td>
                  <td className="text-xs">{c.staff}</td>
                  <td>
                    {c.result === 'GREEN' && c.direction === 'ENTRY' && !c.reversedAt && (reversing === c.id ? (
                      <div className="grid gap-2" style={{ minWidth: 180 }}>
                        <input className="tl-dash-input" placeholder="Why?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reversal reason" autoFocus />
                        <div className="flex gap-2"><button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => reverse(c)}>Reverse</button><button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setReversing(null)}>Cancel</button></div>
                      </div>
                    ) : <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => { setReversing(c.id); setReason(''); }}><Undo2 className="w-3.5 h-3.5 inline" /> Reverse</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3 mt-3 text-xs">
          <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Previous</button>
          <span>Page {filters.page} of {pages}</span>
          <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={filters.page >= pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next</button>
        </div>
      )}
    </DashCard>
  );
}

// ── Report ─────────────────────────────────────────────────────────────────────────────────────────────

function Report({ eventId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/checkin/manage/events/${eventId}/report`).then((r) => setReport(r.data.data)).catch((e) => setError(errText(e))); }, [eventId]);
  const csv = async () => {
    const r = await api.get(`/checkin/manage/events/${eventId}/report`, { params: { format: 'csv' }, responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gate-attendance-${eventId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const totals = useMemo(() => report?.totals, [report]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!report) return <DashState icon={RefreshCw} title="Building the report…" />;
  return (
    <DashCard title="Attendance by gate" sub={`Generated ${when(report.generatedAt)}. Reversed scans are counted separately, not as entries.`} icon={FileBarChart} aside={<button type="button" className="tl-st-btn tl-st-btn--sm" onClick={csv}><Download className="w-3.5 h-3.5 inline" /> CSV</button>}>
      <p className="text-sm mb-4">{totals.entered} of {totals.sold} tickets entered · {totals.inside} inside · {totals.reentries} re-entries · {totals.exits} exits · {totals.turnedAway} turned away · {totals.duplicates} duplicate scans · {totals.exceptions} exceptions · {totals.reversed} reversed</p>
      <div className="tl-dash-table-wrap">
        <table className="tl-dash-table">
          <thead><tr><th>Gate</th><th>Entries</th><th>Re-entries</th><th>Exits</th><th>Turned away</th><th>Duplicates</th><th>Exceptions</th><th>Reversed</th><th>Busiest 15 min</th><th>First – last scan</th><th>Top staff</th></tr></thead>
          <tbody>
            {report.gates.map((g) => (
              <tr key={g.gateId || g.gate}>
                <td><strong>{g.gate}</strong>{g.type && <div className="text-xs text-slate-500">{TYPE_LABELS[g.type]}</div>}</td>
                <td>{g.entries}</td><td>{g.reentries}</td><td>{g.exits}</td><td>{g.turnedAway}</td><td>{g.duplicates}</td><td>{g.exceptions}</td><td>{g.reversed}</td>
                <td className="text-xs">{g.peak15 ? `${g.peak15.entries} at ${clock(g.peak15.at)} (${g.peak15.ratePerHour}/h${g.capacityPerHour ? ` of ${g.capacityPerHour}` : ''})` : '—'}</td>
                <td className="text-xs">{g.first ? `${clock(g.first)} – ${clock(g.last)}` : '—'}</td>
                <td className="text-xs">{g.staff.slice(0, 3).map((s) => `${s.name} (${s.admitted})`).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashCard>
  );
}
