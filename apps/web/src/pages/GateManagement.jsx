import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { connectSocket } from '../lib/socket';
import { Activity, DoorOpen, Users, Smartphone, ShieldAlert, ListChecks, FileBarChart, Plus, Save, RefreshCw, Download, Undo2, Check, X, GitCompareArrows, Archive, Wifi, AlertTriangle, CalendarDays, Eye, EyeOff, Lock, Unlock, RotateCcw, KeyRound, UploadCloud, Clock } from 'lucide-react';
import { PageHero, SectionTabs, AovFooter } from './AdminOverview';
import api from '../utils/api';
import { DashCard, DashHead, DashState, Notice, Segmented, Status, useAdminDark } from '../components/dash/DashShell';
import { AttendanceInsightPanel, InsightBoundary } from '../components/ml/InsightPanels';
import GateLoadPlan from '../components/gates/GateLoadPlan';
import CrowdFlowSection from '../components/gates/CrowdFlowSection';

/*
 * Gate management for supervisors (gate.supervise): live load per gate, the gates themselves (type, ticket
 * types, capacity), re-entry policy, which staff work which gates, scanner devices and their sync status,
 * exception requests from the gates, check-ins (with reversal) and per-gate attendance reports.
 */

/** Downloads a CSV from the API (the browser keeps the auth header out of the URL). */
async function downloadCsv(path, params, filename) {
  const r = await api.get(path, { params: { ...params, format: 'csv' }, responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const HEALTH = { HEALTHY: ['ACTIVE', 'Healthy'], ATTENTION: ['PENDING', 'Needs attention'], CRITICAL: ['FAILED', 'Critical'], REVOKED: ['REJECTED', 'Revoked'] };
const CONNECTION = { ONLINE: 'Online', OFFLINE: 'Offline (reported)', NOT_SEEN: 'Not seen recently', REVOKED: 'Revoked' };

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
  // On the dark console layout (admins, and organizers on this shared page) the page uses the console design
  const dark = useAdminDark();
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
    const socket = connectSocket();
    socket.on('connect', () => socket.emit('join_event_room', eventId));
    socket.on('checkin:stats', (s) => s.eventId === eventId && setData((d) => (d ? { ...d, live: s } : d)));
    socket.on('gate:exception', () => setData((d) => (d ? { ...d, live: { ...d.live, pendingExceptions: (d.live?.pendingExceptions || 0) + 1 } } : d)));
    // Supervisors only: new offline conflicts (the counter also arrives with checkin:stats)
    socket.on('gate:conflict', (p) => p?.eventId === eventId && setData((d) => (d ? { ...d, live: { ...d.live, openConflicts: (d.live?.openConflicts || 0) + (p.count || 1) } } : d)));
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
    { value: 'conflicts', label: 'Conflicts', icon: GitCompareArrows, count: data?.live?.openConflicts || undefined },
    { value: 'evidence', label: 'Evidence', icon: Archive },
    { value: 'checkins', label: 'Check-ins', icon: ListChecks },
    { value: 'report', label: 'Reports', icon: FileBarChart },
  ];

  const body = data && (
    <>
      {tab === 'live' && <Live data={data} eventId={eventId} onTab={setTab} />}
      {tab === 'live' && <GateLoadPlan eventId={eventId} onTab={setTab} />}
      {/* Step 6: rule estimates (with the experimental model muted beside them). Admission never uses them. */}
      {tab === 'live' && (
        <InsightBoundary>
          <div className="space-y-6" style={{ marginTop: 24 }}>
            <AttendanceInsightPanel eventId={eventId} />
            {/* The arrivals panel (with the crowd-flow chart) and the 3D view share one data load and one selection */}
            <CrowdFlowSection eventId={eventId} />
          </div>
        </InsightBoundary>
      )}
      {tab === 'gates' && <Gates data={data} eventId={eventId} run={run} />}
      {tab === 'staff' && <Staff data={data} eventId={eventId} run={run} />}
      {tab === 'devices' && (dark ? <DeviceRows eventId={eventId} flash={flash} /> : <Devices eventId={eventId} flash={flash} />)}
      {tab === 'exceptions' && <Exceptions eventId={eventId} flash={flash} onChange={load} />}
      {tab === 'conflicts' && <Conflicts eventId={eventId} flash={flash} onChange={load} />}
      {tab === 'evidence' && <Evidence eventId={eventId} flash={flash} />}
      {tab === 'checkins' && <CheckIns data={data} eventId={eventId} flash={flash} onChange={load} dark={dark} />}
      {tab === 'report' && <Report eventId={eventId} />}
    </>
  );

  if (dark) {
    return (
      <div className="tl-aov tl-aov-sec tl-gm">
        <PageHero
          icon={DoorOpen}
          title="Gate Management"
          intro="Set up gates, assign staff to them, watch the load and handle problems at the gate."
          aside={(
            <div className="tl-gm-pick">
              <label className="tl-gm-event">
                <CalendarDays className="w-5 h-5" aria-hidden="true" />
                <span className="sr-only">Event</span>
                <select value={eventId} onChange={(e) => setParams({ event: e.target.value, tab })}>
                  <option value="">Choose an event…</option>
                  {events.map((e) => <option key={e.id} value={e.id}>{e.name} · {new Date(e.date).toLocaleDateString()}</option>)}
                </select>
              </label>
              {eventId && (
                <button type="button" className="tl-aov-iconbtn" onClick={load} aria-label="Refresh" title="Refresh">
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        />
        {eventId && <SectionTabs tabs={tabs} value={tab} onChange={setTab} label="Gate sections" />}
        {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
        {!eventId && (
          <div className="tl-gm-empty">
            <span className="tl-gm-empty-icon" aria-hidden="true"><DoorOpen /></span>
            <h2>Choose an event</h2>
            <p>Pick an event at the top right to see its gates, staff, scanner devices and live load.</p>
          </div>
        )}
        {eventId && !data && <DashState icon={RefreshCw} title="Loading…" />}
        {body}
      </div>
    );
  }

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
          {tab === 'live' && <Live data={data} eventId={eventId} onTab={setTab} />}
          {tab === 'live' && <GateLoadPlan eventId={eventId} onTab={setTab} />}
          {/* Step 6: rule estimates (with the experimental model muted beside them). Admission never uses them. */}
          {tab === 'live' && (
            <InsightBoundary>
              <div className="space-y-6" style={{ marginTop: 24 }}>
                <AttendanceInsightPanel eventId={eventId} />
                {/* The arrivals panel (with the crowd-flow chart) and the 3D view share one data load and one selection */}
                <CrowdFlowSection eventId={eventId} />
              </div>
            </InsightBoundary>
          )}
          {tab === 'gates' && <Gates data={data} eventId={eventId} run={run} />}
          {tab === 'staff' && <Staff data={data} eventId={eventId} run={run} />}
          {tab === 'devices' && <Devices eventId={eventId} flash={flash} />}
          {tab === 'exceptions' && <Exceptions eventId={eventId} flash={flash} onChange={load} />}
          {tab === 'conflicts' && <Conflicts eventId={eventId} flash={flash} onChange={load} />}
          {tab === 'evidence' && <Evidence eventId={eventId} flash={flash} />}
          {tab === 'checkins' && <CheckIns data={data} eventId={eventId} flash={flash} onChange={load} />}
          {tab === 'report' && <Report eventId={eventId} />}
        </>
      )}
    </div>
  );
}

// ── Live ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Gate operations dashboard: scanner devices (online, offline, needing attention), scans waiting or failing to
 * upload, conflicts and evidence to review, attendance and gate capacity. Refreshes every 30 seconds and with live
 * attendance updates.
 */
function Operations({ eventId, live, onTab }) {
  const [ops, setOps] = useState(null);
  const load = useCallback(() => api.get(`/checkin/manage/events/${eventId}/operations`).then((r) => setOps(r.data.data)).catch(() => {}), [eventId]);
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load, live?.entered, live?.openConflicts]);
  if (!ops) return <DashState icon={RefreshCw} title="Loading gate operations…" />;
  const d = ops.devices;
  const tiles = [
    ['Scanner devices', d.registered, `${d.atThisEvent} at this event${d.notEnrolled ? ` · ${d.notEnrolled} not enrolled` : ''}`, 'devices'],
    ['Online', d.online, `${d.offline} offline · ${d.notSeen} not seen`, 'devices'],
    ['Need attention', d.needingAttention, d.critical ? `${d.critical} critical` : 'none critical', 'devices', d.needingAttention > 0],
    ['Waiting to upload', ops.scans.pending, ops.scans.stuck ? `${ops.scans.stuck} stuck` : 'on the devices', 'devices', ops.scans.stuck > 0],
    ['Failed uploads', ops.scans.failed, `${ops.scans.failedUploadsLastHour} upload problem${ops.scans.failedUploadsLastHour === 1 ? '' : 's'} in the last hour`, 'devices', ops.scans.failed > 0],
    ['Open conflicts', ops.conflicts.open, 'offline scans to decide', 'conflicts', ops.conflicts.open > 0],
    ['Evidence to review', ops.scans.quarantinedAwaitingReview, 'scans kept, not admitted', 'evidence', ops.scans.quarantinedAwaitingReview > 0],
    ['Attendance', `${ops.attendance.inside} inside`, `${ops.attendance.entered} of ${ops.attendance.sold} entered`, null],
    ['Gate capacity', ops.capacity.perHour ? `${ops.capacity.loadPct}%` : '—', ops.capacity.perHour ? `${ops.capacity.currentRatePerHour} / ${ops.capacity.perHour} per hour${ops.capacity.overloadedGates.length ? ` · busy: ${ops.capacity.overloadedGates.join(', ')}` : ''}` : 'No gate capacity set', 'gates', ops.capacity.overloadedGates.length > 0],
  ];
  return (
    <DashCard title="Gate operations" sub={`Updated ${clock(ops.generatedAt)} · device credentials: ${ops.auth.mode}`} icon={Activity} aside={<button type="button" className="tl-st-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value, sub, tab, warn]) => (
          <button key={label} type="button" disabled={!tab} onClick={() => tab && onTab(tab)} className={`text-left rounded-lg border p-3 ${warn ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
            <span className="block text-xs text-slate-500">{label}</span>
            <strong className="block text-2xl">{value}</strong>
            <span className="block text-xs text-slate-500">{sub}</span>
          </button>
        ))}
      </div>
      {ops.attention.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Devices needing attention</p>
          <ul className="text-xs mt-1 space-y-1">
            {ops.attention.map((a) => <li key={a.id}><Status value={HEALTH[a.health][0]} label={HEALTH[a.health][1]} /> <strong>{a.name}</strong>: {a.reasons.map((r) => r.message).join(' · ')}</li>)}
          </ul>
        </div>
      )}
    </DashCard>
  );
}

function Live({ data, eventId, onTab }) {
  const s = data.live;
  return (
    <div className="space-y-6">
      <Operations eventId={eventId} live={s} onTab={onTab} />
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
        {s.openConflicts > 0 && <p className="text-xs mt-3 text-rose-700">{s.openConflicts} offline scan conflict{s.openConflicts === 1 ? '' : 's'} waiting for a supervisor decision. See Conflicts.</p>}
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

const AUTH_MODE = {
  enforce: 'Every scanner must be enrolled (device credential required).',
  warn: 'Migration: enrolled scanners must use their credential; scanners that never enrolled still work until',
  off: 'Device credentials are switched off (emergency rollback) until',
};

function Devices({ eventId, flash }) {
  const [devices, setDevices] = useState(null);
  const [auth, setAuth] = useState(null);
  const [reasons, setReasons] = useState({});
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get(`/checkin/manage/events/${eventId}/devices`).then((r) => { setDevices(r.data.data.devices); setAuth(r.data.data.auth || null); }).catch((e) => flash('bad', errText(e))), [eventId]);
  const legacy = (devices || []).filter((d) => d.status === 'ACTIVE' && !d.enrolled && d.legacyRequests > 0);
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
      {auth && (
        <p className="text-xs text-slate-500 mb-3">
          {AUTH_MODE[auth.mode]}{auth.mode !== 'enforce' ? ` ${when(auth.deadline)}.` : ''}
          {legacy.length > 0 && auth.mode !== 'enforce' && ` ${legacy.length} device${legacy.length === 1 ? ' has' : 's have'} not enrolled yet: open the scanner on ${legacy.length === 1 ? 'it' : 'them'} while online.`}
        </p>
      )}
      {!devices ? <DashState icon={RefreshCw} title="Loading…" /> : !devices.length ? <DashState icon={Smartphone} title="No devices yet" /> : (
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>Device</th><th>Health</th><th>Sync</th><th>Credential</th><th>Waiting scans</th><th>Last seen</th><th>Ticket list</th><th>Used by</th><th /></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input className="tl-dash-input" defaultValue={d.name} aria-label="Device name" onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && update(d, { name: e.target.value.trim() })} />
                    <div className="text-xs text-slate-500">Registered {when(d.createdAt)} by {d.registeredBy || '—'}</div>
                  </td>
                  <td className="text-xs">
                    <Status value={HEALTH[d.health][0]} label={HEALTH[d.health][1]} />
                    <div className="text-slate-500">{CONNECTION[d.connection]}</div>
                    {d.reasons?.slice(0, 2).map((r) => <div key={r.code} className={r.severity === 'critical' ? 'text-red-600' : 'text-amber-700'}>{r.message}</div>)}
                    <button type="button" className="tl-st-btn tl-st-btn--sm mt-1" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>{open === d.id ? 'Hide details' : 'Details & actions'}</button>
                  </td>
                  <td><Status value={SYNC[d.sync][0]} label={SYNC[d.sync][1]} />{d.atThisEvent && d.lastGate && <div className="text-xs">{d.lastGate}</div>}</td>
                  <td className="text-xs">
                    {d.enrolled ? <Status value="ACTIVE" label="Enrolled" /> : d.status === 'REVOKED' ? '—' : <Status value="PENDING" label="Not enrolled" />}
                    {d.enrolled && <div className="text-slate-500">Since {when(d.tokenIssuedAt)}</div>}
                    {d.authFailures > 0 && <div className="text-red-600">{d.authFailures} rejected credential{d.authFailures === 1 ? '' : 's'} · last {when(d.lastAuthFailureAt)}</div>}
                  </td>
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
                        {d.enrolled && <button type="button" className="tl-st-btn tl-st-btn--sm" title="Deletes the device credential; the device enrolls again on its next connection" onClick={() => update(d, { resetEnrollment: true, reason: reasons[d.id] })}>Reset enrollment</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <DeviceDetails eventId={eventId} deviceId={open} flash={flash} onChange={load} />}
    </DashCard>
  );
}

// Status pill tones for the dark device rows
const TONE_OF = { ACTIVE: 'good', PENDING: 'warn', FAILED: 'bad', REJECTED: 'neutral', INACTIVE: 'neutral' };
const HEALTH_ICON = { HEALTHY: Check, ATTENTION: AlertTriangle, CRITICAL: X, REVOKED: Lock };
const dayTime = (v) => {
  if (!v) return ['—', ''];
  const x = new Date(v);
  return [x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })];
};

/**
 * Scanner devices on the dark admin console, laid out like Approvals: one row per device with its health,
 * sync, waiting scans and last contact; Details opens the device panel, Revoke asks for a reason.
 */
function DeviceRows({ eventId, flash }) {
  const [devices, setDevices] = useState(null);
  const [auth, setAuth] = useState(null);
  const [open, setOpen] = useState(null);
  const [revoke, setRevoke] = useState(null); // { device, reason, reset }
  const [filter, setFilter] = useState('ALL');
  const load = useCallback(() => api.get(`/checkin/manage/events/${eventId}/devices`).then((r) => { setDevices(r.data.data.devices); setAuth(r.data.data.auth || null); }).catch((e) => flash('bad', errText(e))), [eventId]);
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
      return true;
    } catch (e) {
      flash('bad', errText(e));
      return false;
    }
  };
  const list = devices || [];
  const legacy = list.filter((d) => d.status === 'ACTIVE' && !d.enrolled && d.legacyRequests > 0);
  const counts = {
    ALL: list.length,
    ONLINE: list.filter((d) => d.connection === 'ONLINE').length,
    ATTENTION: list.filter((d) => d.health === 'ATTENTION' || d.health === 'CRITICAL').length,
    REVOKED: list.filter((d) => d.status === 'REVOKED').length,
  };
  const shown = list.filter((d) => filter === 'ALL'
    || (filter === 'ONLINE' && d.connection === 'ONLINE')
    || (filter === 'ATTENTION' && (d.health === 'ATTENTION' || d.health === 'CRITICAL'))
    || (filter === 'REVOKED' && d.status === 'REVOKED'));
  const FILTERS = [['ALL', 'All devices'], ['ONLINE', 'Online'], ['ATTENTION', 'Need attention'], ['REVOKED', 'Revoked']];

  return (
    <>
      <div className="tl-apv-bar">
        <div className="tl-apv-filters" role="group" aria-label="Filter devices">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" className={`tl-apv-filter${filter === v ? ' is-active' : ''}`} aria-pressed={filter === v} onClick={() => setFilter(v)}>
              {label} <span>{counts[v]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="tl-apv-filterbtn" onClick={load}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh</button>
      </div>

      {auth && (
        <p className="tl-gm-note">
          <KeyRound className="w-4 h-4" aria-hidden="true" />
          <span>
            {AUTH_MODE[auth.mode]}{auth.mode !== 'enforce' ? ` ${when(auth.deadline)}.` : ''}
            {legacy.length > 0 && auth.mode !== 'enforce' && ` ${legacy.length} device${legacy.length === 1 ? ' has' : 's have'} not enrolled yet: open the scanner on ${legacy.length === 1 ? 'it' : 'them'} while online.`}
            {' '}Updates every 30 seconds.
          </span>
        </p>
      )}

      <section className="tl-apv-table tl-gm-devices" aria-label="Scanner devices">
        <div className="tl-apv-row tl-apv-row--head" aria-hidden="true">
          <span>Device</span>
          <span>Sync</span>
          <span>Last seen</span>
          <span>Waiting scans</span>
          <span>Health</span>
          <span className="is-right">Actions</span>
        </div>
        {!devices ? (
          <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading devices…</p></div>
        ) : !shown.length ? (
          <div className="tl-dash-state"><Smartphone className="w-7 h-7" /><p>{list.length ? 'No devices match this filter.' : 'No devices yet. Phones and tablets register the first time they scan.'}</p></div>
        ) : shown.map((d) => {
          const [healthStatus, healthLabel] = HEALTH[d.health] || ['INACTIVE', d.health];
          const healthTone = TONE_OF[healthStatus] || 'neutral';
          const HealthIcon = HEALTH_ICON[d.health] || Check;
          const [syncStatus, syncLabel] = SYNC[d.sync] || ['INACTIVE', d.sync];
          const [seenDay, seenTime] = dayTime(d.lastSeenAt);
          const revoked = d.status === 'REVOKED';
          const isOpen = open === d.id;
          return (
            <article key={d.id} className={`tl-apv-row${isOpen ? ' is-open' : ''}`}>
              <div className="tl-apv-co">
                <span className={`tl-fw-tile is-${healthTone === 'neutral' ? 'warn' : healthTone}`} aria-hidden="true"><Smartphone /></span>
                <div>
                  <h3>{d.name}</h3>
                  <p>{d.lastUser ? `Used by ${d.lastUser}` : `Registered by ${d.registeredBy || '—'}`}</p>
                  <span className={`tl-apv-tag${d.enrolled ? '' : ' tl-gm-tag--warn'}`}>{revoked ? 'Revoked' : d.enrolled ? 'Enrolled' : 'Not enrolled'}</span>
                </div>
              </div>

              <div className="tl-gm-sync">
                <span className="tl-gm-dot" data-tone={TONE_OF[syncStatus] || 'neutral'} aria-hidden="true" />
                <div>
                  <strong>{syncLabel}</strong>
                  <span>{CONNECTION[d.connection]}{d.atThisEvent && d.lastGate ? ` · ${d.lastGate}` : ''}</span>
                </div>
              </div>

              <div className="tl-apv-when">
                <Clock className="w-5 h-5" aria-hidden="true" />
                <div><strong>{seenDay}</strong><span>{seenTime}{d.lastSyncAt ? ` · upload ${clock(d.lastSyncAt)}` : ''}</span></div>
              </div>

              <div className="tl-gm-waiting">
                <UploadCloud className="w-5 h-5" aria-hidden="true" />
                <div>
                  <strong>{d.pendingScans ?? 0}</strong>
                  <span>{d.authFailures > 0 ? `${d.authFailures} rejected credential${d.authFailures === 1 ? '' : 's'}` : 'waiting to upload'}</span>
                </div>
              </div>

              <div className="tl-apv-state">
                <span className="tl-apv-status" data-tone={healthTone}><span className="tl-apv-status-dot" aria-hidden="true"><HealthIcon strokeWidth={3} /></span>{healthLabel}</span>
                {d.reasons?.[0] && <small className={d.reasons[0].severity === 'critical' ? '' : 'tl-gm-warn'} title={d.reasons.map((r) => r.message).join(' · ')}>{d.reasons[0].message}</small>}
              </div>

              <div className="tl-apv-actions">
                <button type="button" className="tl-apv-btn is-view" onClick={() => setOpen(isOpen ? null : d.id)} aria-expanded={isOpen}>
                  {isOpen ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />} {isOpen ? 'Hide' : 'Details'}
                </button>
                {revoked ? (
                  <button type="button" className="tl-apv-btn is-primary" onClick={() => update(d, { status: 'ACTIVE' })} title={`${d.revokeReason || ''}${d.revokedBy ? ` · ${d.revokedBy}` : ''}`}>
                    <Unlock className="w-4 h-4" aria-hidden="true" /> Restore
                  </button>
                ) : (
                  <button type="button" className="tl-apv-btn" onClick={() => setRevoke({ device: d, reason: '', reset: false })}>
                    <Lock className="w-4 h-4" aria-hidden="true" /> Revoke
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="tl-gm-details">
                  <label className="tl-gm-rename">
                    <span>Device name</span>
                    <input className="tl-dash-input" defaultValue={d.name} onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && update(d, { name: e.target.value.trim() })} />
                  </label>
                  {d.enrolled && !revoked && (
                    <button type="button" className="tl-apv-btn" title="Deletes the device credential; the device enrolls again on its next connection" onClick={() => setRevoke({ device: d, reason: '', reset: true })}>
                      <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reset enrollment
                    </button>
                  )}
                  <DeviceDetails eventId={eventId} deviceId={d.id} flash={flash} onChange={load} />
                </div>
              )}
            </article>
          );
        })}
      </section>

      {revoke && (
        <div className="tl-dash-dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setRevoke(null)}>
          <form
            className="tl-dash-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tl-gm-revoke-title"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await update(revoke.device, revoke.reset ? { resetEnrollment: true, reason: revoke.reason } : { status: 'REVOKED', reason: revoke.reason });
              if (ok) setRevoke(null);
            }}
          >
            <h3 id="tl-gm-revoke-title">{revoke.reset ? 'Reset enrollment' : 'Revoke device'}</h3>
            <p>
              <strong>{revoke.device.name}</strong>
              {revoke.reset
                ? ': its credential is deleted and it enrolls again on its next connection.'
                : ': it can no longer scan, upload or download ticket lists.'}
            </p>
            <label htmlFor="tl-gm-revoke-reason">Reason</label>
            <textarea id="tl-gm-revoke-reason" rows={3} className="tl-dash-textarea" value={revoke.reason} onChange={(e) => setRevoke({ ...revoke, reason: e.target.value })} placeholder="e.g. Lost at gate 3" />
            <div className="tl-dash-dialog-actions">
              <button type="button" className="tl-dash-btn" onClick={() => setRevoke(null)}>Cancel</button>
              <button type="submit" className="tl-dash-btn tl-dash-btn--danger">{revoke.reset ? 'Reset enrollment' : 'Revoke device'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

const ACTIONS = [['PING', 'Test connection'], ['SYNC', 'Upload now'], ['RETRY_FAILED', 'Retry failed uploads'], ['SEND_PENDING', 'Show pending scans']];

/** One device: health, details, actions sent to the scanner, upload history, recent errors, pending scans. */
function DeviceDetails({ eventId, deviceId, flash, onChange }) {
  const [info, setInfo] = useState(null);
  const base = `/checkin/manage/events/${eventId}/devices/${deviceId}`;
  const load = useCallback(() => api.get(base).then((r) => setInfo(r.data.data)).catch((e) => flash('bad', errText(e))), [base]);
  useEffect(() => {
    setInfo(null);
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);
  const act = async (action) => {
    try {
      const r = await api.post(`${base}/actions`, { action });
      flash(r.data.data.delivered ? 'good' : 'bad', r.data.message);
      setTimeout(() => { load(); onChange(); }, 2500);
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  if (!info) return <DashState icon={RefreshCw} title="Loading the device…" />;
  const d = info.device;
  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{d.name}</strong>
        <Status value={HEALTH[info.health][0]} label={HEALTH[info.health][1]} />
        <span className="text-xs text-slate-500">{CONNECTION[info.connection]} · sync {info.syncHealth.toLowerCase()} · id …{d.deviceKeyEnd}</span>
      </div>
      {d.status !== 'REVOKED' && (
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map(([a, label]) => <button key={a} type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(a)}><Wifi className="w-3.5 h-3.5 inline" /> {label}</button>)}
        </div>
      )}
      {info.reasons.length > 0 && <ul className="text-xs">{info.reasons.map((r) => <li key={r.code} className={r.severity === 'critical' ? 'text-red-600' : 'text-amber-700'}>{r.message}</li>)}</ul>}
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        {[
          ['Status', `${d.status}${d.enrolled ? ' · enrolled' : ' · not enrolled'}`], ['Last heartbeat', when(d.lastSeenAt)], ['Last upload', when(d.lastSyncAt)],
          ['Last scan', when(d.lastScanAt)], ['Waiting to upload', d.pendingScans], ['Failed', d.failedScans], ['Stuck', d.stuckScans], ['Oldest waiting', when(d.oldestPendingAt)],
          ['Open conflicts', info.openConflicts], ['Evidence handed in', info.quarantined], ['Last acknowledged #', d.lastSeqAcked ?? '—'], ['App version', d.appVersion || '—'],
          ['Storage kept by browser', d.storagePersisted == null ? '—' : d.storagePersisted ? 'yes' : 'no'], ['Clock difference', d.clockSkewMs == null ? '—' : `${Math.round(d.clockSkewMs / 1000)} s`],
          ['Ticket list', when(d.packAt)], ['Used by', d.lastUser || '—'], ['Registered', `${when(d.createdAt)} · ${d.registeredBy || '—'}`],
          ['Scans recorded', `${info.activity.GREEN} admitted · ${info.activity.YELLOW} already used · ${info.activity.RED} turned away`],
        ].map(([k, v]) => <div key={k}><dt className="inline text-slate-500">{k}: </dt><dd className="inline">{v}</dd></div>)}
      </dl>
      {d.lastSyncError && <p className="text-xs text-red-600">Last upload problem ({when(d.lastSyncErrorAt)}): {d.lastSyncError}</p>}
      <div>
        <p className="text-xs font-semibold">Pending scans on the device {info.pendingScans ? `(reported ${when(info.pendingScans.reportedAt)})` : ''}</p>
        {!info.pendingScans ? <p className="text-xs text-slate-500">Not reported yet: use “Show pending scans”.</p> : !info.pendingScans.scans.length ? <p className="text-xs text-slate-500">None.</p> : (
          <div className="tl-dash-table-wrap"><table className="tl-dash-table"><thead><tr><th>#</th><th>State</th><th>Scan</th><th>Device clock</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>
            {info.pendingScans.scans.map((p) => <tr key={p.scanId}><td>{p.seq}</td><td className="text-xs">{p.state}</td><td className="text-xs">{p.direction} · {p.localResult}{p.gate ? ` · ${p.gate}` : ''}</td><td className="text-xs">{when(p.deviceScannedAt)}</td><td>{p.attempts}</td><td className="text-xs">{p.lastError || '—'}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold">Upload history (latest 50)</p>
        {!info.syncHistory.length ? <p className="text-xs text-slate-500">No uploads yet.</p> : (
          <div className="tl-dash-table-wrap"><table className="tl-dash-table"><thead><tr><th>When</th><th>Kind</th><th>Received</th><th>Accepted</th><th>Repeats</th><th>Rejected</th><th>Retry</th><th>Conflicts</th><th>Time</th><th>Error</th></tr></thead><tbody>
            {info.syncHistory.map((b) => <tr key={b.id} className={b.error || b.retry || b.rejected ? 'text-red-700' : ''}><td className="text-xs">{when(b.createdAt)}</td><td className="text-xs">{b.kind}</td><td>{b.received}</td><td>{b.accepted}</td><td>{b.alreadyProcessed}</td><td>{b.rejected}</td><td>{b.retry}</td><td>{b.conflicts}</td><td className="text-xs">{b.durationMs} ms</td><td className="text-xs">{b.error || '—'}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold">Device history</p>
        <ul className="text-xs text-slate-600">{info.actions.map((a, i) => <li key={i}>{when(a.at)} · {a.action.replace('GATE_DEVICE_', '').replace(/_/g, ' ').toLowerCase()}{a.by ? ` · ${a.by}` : ''}{a.details?.action ? ` · ${a.details.action}${a.details.delivered === false ? ' (not connected)' : ''}` : ''}{a.details?.reason ? ` · ${a.details.reason}` : ''}</li>)}</ul>
      </div>
    </div>
  );
}

// ── Evidence (quarantined scans) ───────────────────────────────────────────────────────────────────────

const Q_REASON = { DEVICE_REVOKED: 'Held by a revoked device', ACCESS_REMOVED: 'Held by staff who lost access', INVALID: 'Could not be read' };

/** Scans the server kept without processing them. Reviewing records a note; it never admits anyone. */
function Evidence({ eventId, flash }) {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState({});
  const [note, setNote] = useState('');
  const base = `/checkin/manage/events/${eventId}/quarantine`;
  const load = useCallback(() => api.get(base, { params: { status: status || undefined } }).then((r) => { setRows(r.data.data.scans); setPicked({}); }).catch((e) => flash('bad', errText(e))), [base, status]);
  useEffect(() => { load(); }, [load]);
  const ids = Object.keys(picked).filter((k) => picked[k]);
  const review = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`${base}/review`, { ids, note });
      flash('good', r.data.message);
      setNote('');
      load();
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  return (
    <DashCard title="Evidence: scans kept for review" sub="Scans the server received but did not process: from revoked devices, from staff who lost access, or unreadable. They never admitted anyone. Review them with a note; to admit someone, use an exception." icon={Archive}
      aside={<select className="tl-dash-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="PENDING_REVIEW">To review</option><option value="REVIEWED">Reviewed</option><option value="">All</option></select>}>
      {!rows ? <DashState icon={RefreshCw} title="Loading…" /> : !rows.length ? <DashState icon={Check} title="Nothing to review" /> : (
        <>
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th /><th>Received</th><th>Why kept</th><th>Device</th><th>Scan</th><th>Handed in by</th><th>Review</th></tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td>{q.status === 'PENDING_REVIEW' && <input type="checkbox" checked={Boolean(picked[q.id])} onChange={(e) => setPicked({ ...picked, [q.id]: e.target.checked })} aria-label="Select" />}</td>
                    <td className="text-xs">{when(q.createdAt)}</td>
                    <td className="text-xs">{Q_REASON[q.reason]}{q.detail ? <div className="text-slate-500">{q.detail}</div> : null}</td>
                    <td className="text-xs">{q.device || `…${q.deviceKey}`}{q.deviceSeq ? <div className="text-slate-500">#{q.deviceSeq}</div> : null}</td>
                    <td className="text-xs">{q.payload?.direction || 'ENTRY'} · on the device: {q.payload?.localResult || '—'}{q.payload?.gate ? ` · ${q.payload.gate}` : ''}<div className="text-slate-500">{q.payload?.scannedAt ? when(q.payload.scannedAt) : ''}</div></td>
                    <td className="text-xs">{q.submittedBy || '—'}</td>
                    <td className="text-xs">{q.status === 'REVIEWED' ? `${q.reviewedBy || '—'} · ${when(q.reviewedAt)}: ${q.reviewNote}` : 'To review'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status !== 'REVIEWED' && (
            <form className="flex flex-wrap gap-2 items-end mt-3" onSubmit={review}>
              <input className="tl-dash-input flex-1" style={{ minWidth: 240 }} required minLength={10} maxLength={1000} placeholder="Review note (kept in the audit history)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Review note" />
              <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" disabled={!ids.length}><Check className="w-4 h-4" /> Mark {ids.length || ''} reviewed</button>
            </form>
          )}
        </>
      )}
    </DashCard>
  );
}

// ── Conflicts ──────────────────────────────────────────────────────────────────────────────────────────

const CONFLICT_TYPE = {
  DUPLICATE_ADMISSION: 'Admitted on more than one device',
  TICKET_INVALIDATED: 'Admitted with a ticket that is not valid',
  ORDERING: 'Exit the server could not place',
  REENTRY_LIMIT: 'Re-entry beyond the policy',
  RULE_MISMATCH: 'Admitted against a gate rule',
};
const RESOLUTION = {
  CONFIRMED_SINGLE_ENTRY: 'One guest, scanned more than once',
  CONFIRMED_MULTIPLE_ENTRY: 'More than one person entered (suspected fraud)',
  ADMISSION_ACCEPTED: 'Accept the admission',
  ADMISSION_REJECTED: 'Should not have been admitted',
  DEVICE_ERROR: 'Device data was wrong (clock, old list)',
  DISMISSED: 'Not a real problem',
};

/**
 * Offline scans that disagree with the server. Every scan stays listed; resolving records a decision with a reason
 * and changes no ticket (use Check-ins → Reverse or an exception to correct attendance).
 */
function Conflicts({ eventId, flash, onChange }) {
  const [status, setStatus] = useState('OPEN');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({});
  const base = `/checkin/manage/events/${eventId}/conflicts`;
  const load = useCallback(() => api.get(base, { params: { status: status || undefined } }).then((r) => setData(r.data.data)).catch((e) => flash('bad', errText(e))), [base, status]);
  useEffect(() => { load(); }, [load]);
  const resolve = async (c) => {
    const f = form[c.id] || {};
    try {
      const r = await api.post(`${base}/${c.id}/resolve`, { resolution: f.resolution, reason: f.reason || '' });
      flash('good', r.data.message);
      setForm({ ...form, [c.id]: undefined });
      load();
      onChange();
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  const exportCsv = async () => {
    try {
      const r = await api.get(base, { params: { status: 'OPEN', format: 'csv' }, responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gate-conflicts-open-${eventId.slice(0, 8)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  return (
    <DashCard
      title="Offline scan conflicts"
      sub="A device admitted or let out a ticket while offline and the server disagreed when the scan arrived. Attendance follows the server; nothing is decided automatically. Resolving needs a reason and is kept in the history; it doesn't change the ticket."
      icon={GitCompareArrows}
      aside={(
        <div className="flex gap-2">
          <select className="tl-dash-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="OPEN">Open{data ? ` (${data.open})` : ''}</option>
            <option value="RESOLVED">Resolved{data ? ` (${data.resolved})` : ''}</option>
            <option value="">All</option>
          </select>
          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={exportCsv}><Download className="w-4 h-4" /> Export open</button>
        </div>
      )}
    >
      {!data ? <DashState icon={RefreshCw} title="Loading…" /> : !data.conflicts.length ? <DashState icon={Check} title={status === 'OPEN' ? 'No open conflicts' : 'Nothing here'} /> : (
        <ul className="space-y-3">
          {data.conflicts.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 p-3">
              <button type="button" className="w-full text-left" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Status value={c.status === 'OPEN' ? 'FAILED' : 'ACTIVE'} label={c.status === 'OPEN' ? 'Open' : RESOLUTION[c.resolution]} />
                  <strong>{CONFLICT_TYPE[c.type]}</strong>
                  <span className="text-xs text-slate-500">{c.ticket ? `${c.ticket.code} · ${c.ticket.holder || 'Guest'} · ${c.ticket.type || 'Ticket'}` : 'Unknown ticket'} · {c.scans.length} scan{c.scans.length === 1 ? '' : 's'} · {when(c.createdAt)}</span>
                </div>
                <div className="text-xs mt-1">{c.summary}</div>
              </button>
              {open === c.id && (
                <div className="mt-3 space-y-3">
                  {c.ticket && <p className="text-xs">Ticket now: <strong>{c.ticket.status}</strong> · {c.ticket.isInside ? 'inside' : 'outside'} · {c.ticket.entryCount} entr{c.ticket.entryCount === 1 ? 'y' : 'ies'}{c.ticket.checkedInAt ? ` · first entry ${when(c.ticket.checkedInAt)}${c.ticket.gate ? ` at ${c.ticket.gate}` : ''}` : ''}</p>}
                  <div className="tl-dash-table-wrap">
                    <table className="tl-dash-table">
                      <thead><tr><th>Scan</th><th>Device</th><th>Gate</th><th>On the device</th><th>Server</th><th>Device clock</th><th>Received</th></tr></thead>
                      <tbody>
                        {c.scans.map((x) => (
                          <tr key={x.checkInId}>
                            <td className="text-xs">{x.direction === 'EXIT' ? 'Exit' : 'Entry'}{x.offline ? ' · offline' : ' · online'}{x.flagged ? ' · flagged' : ''}{x.reversedAt ? ' · reversed' : ''}<div className="text-slate-500">{x.staff || '—'}</div></td>
                            <td className="text-xs">{x.device?.name || '—'}{x.deviceSeq ? <div className="text-slate-500">#{x.deviceSeq}</div> : null}</td>
                            <td className="text-xs">{x.gate || '—'}</td>
                            <td className="text-xs">{x.localResult || '—'}{x.localReason ? <div className="text-slate-500">{x.localReason}</div> : null}</td>
                            <td className="text-xs">{x.result}<div className="text-slate-500">{x.reason}</div></td>
                            <td className="text-xs">{x.deviceScannedAt ? when(x.deviceScannedAt) : '—'}</td>
                            <td className="text-xs">{when(x.receivedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500">Device clocks are shown as reported and may be wrong; the order of scans on one device follows its sequence number.</p>
                  {c.status === 'OPEN' ? (
                    <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); resolve(c); }}>
                      <select className="tl-dash-select" required value={form[c.id]?.resolution || ''} onChange={(e) => setForm({ ...form, [c.id]: { ...form[c.id], resolution: e.target.value } })} aria-label="Decision">
                        <option value="">Decision…</option>
                        {c.allowedResolutions.map((r) => <option key={r} value={r}>{RESOLUTION[r]}</option>)}
                      </select>
                      <input className="tl-dash-input flex-1" style={{ minWidth: 220 }} required minLength={10} maxLength={1000} placeholder="Reason (kept in the audit history)" value={form[c.id]?.reason || ''} onChange={(e) => setForm({ ...form, [c.id]: { ...form[c.id], reason: e.target.value } })} aria-label="Reason" />
                      <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Check className="w-4 h-4" /> Resolve</button>
                    </form>
                  ) : (
                    <p className="text-xs">Resolved by <strong>{c.resolvedBy || '—'}</strong> on {when(c.resolvedAt)}: {c.resolutionReason}</p>
                  )}
                  <div>
                    <p className="text-xs font-semibold">History</p>
                    <ul className="text-xs text-slate-600">
                      {c.history.map((h, i) => <li key={i}>{when(h.at)} · {h.action.replace('GATE_CONFLICT_', '').replace(/_/g, ' ').toLowerCase()}{h.by ? ` · ${h.by}` : ''}{h.details?.reason ? ` · ${h.details.reason}` : ''}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
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

function CheckIns({ data, eventId, flash, onChange, dark }) {
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

  // Admin console: filters bar and one card per scan (Approvals layout), wrapping on narrow screens
  if (dark) {
    const TONE = { GREEN: 'good', YELLOW: 'warn', RED: 'bad' };
    const ICON = { GREEN: Check, YELLOW: AlertTriangle, RED: X };
    return (
      <>
        <div className="tl-apv-bar tl-gm-ci-bar">
          <div className="tl-gm-ci-filters">
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
          </div>
          <label className="tl-apv-search">
            <ListChecks className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Search check-ins</span>
            <input type="search" placeholder="Ticket code or holder…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} />
          </label>
        </div>
        <p className="tl-gm-note"><Undo2 className="w-4 h-4" aria-hidden="true" /><span>Every scan at the gates. A supervisor can reverse an admission made by mistake; the ticket becomes valid again.</span></p>

        <section className="tl-apv-table tl-gm-ci" aria-label="Check-ins">
          <div className="tl-apv-row tl-apv-row--head" aria-hidden="true">
            <span>Ticket</span>
            <span>Gate</span>
            <span>When</span>
            <span>Result</span>
            <span>Staff</span>
            <span className="is-right">Actions</span>
          </div>
          {!rows ? (
            <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading scans…</p></div>
          ) : !rows.items.length ? (
            <div className="tl-dash-state"><ListChecks className="w-7 h-7" /><p>No scans match these filters.</p></div>
          ) : rows.items.map((c) => {
            const tone = TONE[c.result] || 'neutral';
            const Icon = ICON[c.result] || Check;
            const [day, time] = dayTime(c.scannedAt);
            const canReverse = c.result === 'GREEN' && c.direction === 'ENTRY' && !c.reversedAt;
            return (
              <article key={c.id} className={`tl-apv-row${c.reversedAt ? ' is-reversed' : ''}`}>
                <div className="tl-apv-co">
                  <span className={`tl-fw-tile is-${tone === 'neutral' ? 'warn' : tone}`} aria-hidden="true"><Icon /></span>
                  <div>
                    <h3>{c.ticket?.holder || 'Unknown ticket'}</h3>
                    <p>{c.ticket?.type || '—'}</p>
                    {c.ticket?.code && <span className="tl-apv-tag tl-fw-session">{c.ticket.code}</span>}
                  </div>
                </div>
                <div className="tl-gm-sync">
                  <DoorOpen className="w-5 h-5 tl-gm-ico" aria-hidden="true" />
                  <div>
                    <strong>{c.gate || '—'}</strong>
                    <span>{c.direction === 'EXIT' ? 'Exit' : c.reentry ? 'Re-entry' : 'Entry'}{c.offline ? ' · offline' : ''}</span>
                  </div>
                </div>
                <div className="tl-apv-when">
                  <CalendarDays className="w-5 h-5" aria-hidden="true" />
                  <div><strong>{day}</strong><span>{time}</span></div>
                </div>
                <div className="tl-apv-state">
                  <span className="tl-apv-status tl-gm-result" data-tone={tone}><span className="tl-apv-status-dot" aria-hidden="true"><Icon strokeWidth={3} /></span><span>{c.reason}</span></span>
                  {c.conflict && <small>Admitted twice offline</small>}
                  {c.exceptionId && <small className="tl-gm-warn">By exception</small>}
                  {c.reversedAt && <small className="tl-gm-warn">Reversed: {c.reversalReason}</small>}
                </div>
                <div className="tl-apv-who">
                  <span className="tl-av" aria-hidden="true">{(c.staff || '?').trim()[0]?.toUpperCase()}</span>
                  <div><strong>{c.staff || '—'}</strong></div>
                </div>
                <div className="tl-apv-actions">
                  {canReverse && (reversing === c.id ? (
                    <div className="tl-gm-reverse">
                      <input className="tl-dash-input" placeholder="Why?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reversal reason" autoFocus />
                      <div>
                        <button type="button" className="tl-apv-btn is-primary" onClick={() => reverse(c)}>Reverse</button>
                        <button type="button" className="tl-apv-btn" onClick={() => setReversing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="tl-apv-btn" onClick={() => { setReversing(c.id); setReason(''); }}><Undo2 className="w-4 h-4" aria-hidden="true" /> Reverse</button>
                  ))}
                </div>
              </article>
            );
          })}
        </section>

        {rows && rows.total > 0 && (
          <nav className="tl-apv-pager" aria-label="Pages">
            <p>Page <strong>{filters.page}</strong> of <strong>{pages}</strong> · <strong>{rows.total}</strong> scans</p>
            <div>
              <button type="button" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} aria-label="Previous page">‹</button>
              <button type="button" className="is-active" aria-current="page">{filters.page}</button>
              <button type="button" disabled={filters.page >= pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} aria-label="Next page">›</button>
            </div>
          </nav>
        )}
      </>
    );
  }

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
  const [busy, setBusy] = useState('');
  const ops = async (kind, filename, path = `/checkin/manage/events/${eventId}/reports/${kind}`, params = {}) => {
    setBusy(kind);
    try {
      await downloadCsv(path, params, filename);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!report) return <DashState icon={RefreshCw} title="Building the report…" />;
  const opsReports = [
    ['device-sync', 'Device synchronization', 'Every device: health, last heartbeat / upload / scan, waiting, failed, stuck, conflicts, uploads in the last 24 h.'],
    ['failed-scans', 'Failed scans', 'Scans kept by the server (unreadable, revoked devices, lost access) and scans failing on devices.'],
    ['conflicts', 'Unresolved conflicts', 'Open offline conflicts with tickets, devices and gates.'],
    ['device-activity', 'Device activity', 'Scans per device: admitted, already used, turned away, offline, first and last scan.'],
    ['recovery-history', 'Recovery history', 'Revocations, resets, enrollments, supervisor device actions, evidence, conflict decisions, reversals, exceptions.'],
  ];
  return (
    <div className="space-y-6">
    <DashCard title="Gate operations reports" sub="CSV downloads for this event." icon={Download}>
      <ul className="space-y-2">
        {opsReports.map(([kind, title, sub]) => (
          <li key={kind} className="flex flex-wrap items-center justify-between gap-2">
            <span><strong className="text-sm">{title}</strong><span className="block text-xs text-slate-500">{sub}</span></span>
            <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={busy === kind} onClick={() => (kind === 'conflicts' ? ops(kind, `gate-conflicts-open-${eventId.slice(0, 8)}.csv`, `/checkin/manage/events/${eventId}/conflicts`, { status: 'OPEN' }) : ops(kind, `gate-${kind}-${eventId.slice(0, 8)}.csv`))}><Download className="w-3.5 h-3.5 inline" /> {busy === kind ? 'Preparing…' : 'CSV'}</button>
          </li>
        ))}
      </ul>
    </DashCard>
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
    </div>
  );
}
