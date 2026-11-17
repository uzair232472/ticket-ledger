import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Settings2, Layers, Copy, Megaphone, Users, History, BarChart3, Save, Plus, Trash2, Download, RefreshCw, ExternalLink } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/permissions';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';

/*
 * Event tools (/organizer/events/:id/manage): settings (scheduled publication, sales window, capacity, terms,
 * refund policy, age limit), sale phases per ticket type, duplicating the event and adding more dates or
 * sessions, announcements to ticket holders, event staff, the change history and the performance report.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const pkr = (n) => `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const local = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const iso = (v) => (v ? new Date(v).toISOString() : '');

export default function EventTools() {
  const { id } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const flash = (tone, text) => setNotice({ tone, text });
  const load = useCallback(() => api.get(`/org/events/${id}/tools`).then((r) => setData(r.data.data)).catch((e) => flash('bad', errText(e))), [id]);
  useEffect(() => { load(); }, [load]);
  const tabs = [
    { value: 'settings', label: 'Settings', icon: Settings2 },
    { value: 'phases', label: 'Sale phases', icon: Layers },
    can(user, 'event.create') && { value: 'copies', label: 'Copies & dates', icon: Copy },
    can(user, 'attendee.contact') && { value: 'announcements', label: 'Announcements', icon: Megaphone },
    { value: 'staff', label: 'Staff', icon: Users },
    { value: 'history', label: 'History', icon: History },
    can(user, 'booking.view') && { value: 'report', label: 'Report', icon: BarChart3 },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'settings';
  const shared = { id, data, load, flash, user };
  return (
    <div className="space-y-6">
      <DashHead
        eyebrow="Event tools"
        title={data?.event?.name || 'Event'}
        intro={data ? `${when(data.event.startsAt || data.event.date)} · ${data.event.venue}, ${data.event.city} · ${data.event.status.toLowerCase()}${data.event.isHidden ? ' (hidden)' : ''}` : undefined}
        actions={data && <div className="flex gap-2"><Link className="tl-st-btn tl-st-btn--sm" to={`/organizer/events/${id}/edit`}>Edit details</Link><Link className="tl-st-btn tl-st-btn--sm" to={`/events/${id}`}><ExternalLink className="w-3.5 h-3.5 inline" /> Event page</Link></div>}
        segment={<Segmented label="Event tools" options={tabs} value={tab} onChange={(v) => setParams({ tab: v })} />}
      />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      {!data ? <DashState icon={RefreshCw} title="Loading…" /> : (
        <>
          {tab === 'settings' && <SettingsTab {...shared} />}
          {tab === 'phases' && <PhasesTab {...shared} />}
          {tab === 'copies' && <CopiesTab {...shared} />}
          {tab === 'announcements' && <AnnouncementsTab {...shared} />}
          {tab === 'staff' && <StaffTab {...shared} />}
          {tab === 'history' && <HistoryTab {...shared} />}
          {tab === 'report' && <ReportTab {...shared} />}
        </>
      )}
    </div>
  );
}

function SettingsTab({ id, data, load, flash, user }) {
  const e = data.event;
  const [f, setF] = useState({ publishAt: local(e.publishAt), salesOpenAt: local(e.salesOpenAt), salesCloseAt: local(e.salesCloseAt), capacityLimit: e.capacityLimit ?? '', terms: e.terms || '', refundPolicy: e.refundPolicy || '', ageRestriction: e.ageRestriction ?? '', sessionLabel: e.sessionLabel || '' });
  const editable = can(user, 'event.edit');
  const save = async (ev) => {
    ev.preventDefault();
    try {
      const r = await api.put(`/org/events/${id}/settings`, { ...f, publishAt: iso(f.publishAt), salesOpenAt: iso(f.salesOpenAt), salesCloseAt: iso(f.salesCloseAt) });
      flash('good', r.data.message);
      load();
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  const set = (k) => (x) => setF({ ...f, [k]: x.target.value });
  const isPublic = e.status === 'PUBLISHED' && !e.isHidden;
  return (
    <form onSubmit={save} className="space-y-6">
      <fieldset disabled={!editable} className="contents">
        <DashCard title="Schedule" sub="Times are in your browser's time zone.">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs"><span className="font-bold">Publish at (after approval)</span><input className="tl-dash-input" type="datetime-local" disabled={isPublic} value={f.publishAt} onChange={set('publishAt')} /><span className="text-slate-500">{isPublic ? 'Already public.' : 'Empty: public as soon as it is approved.'}</span></label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Sales open</span><input className="tl-dash-input" type="datetime-local" value={f.salesOpenAt} onChange={set('salesOpenAt')} /><span className="text-slate-500">Empty: as soon as it is public.</span></label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Sales close</span><input className="tl-dash-input" type="datetime-local" value={f.salesCloseAt} onChange={set('salesCloseAt')} /><span className="text-slate-500">Empty: until the event.</span></label>
          </div>
        </DashCard>
        <DashCard title="Capacity">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs"><span className="font-bold">Most tickets that can be sold</span><input className="tl-dash-input" type="number" min={1} placeholder="Seats on the plan" value={f.capacityLimit} onChange={set('capacityLimit')} /></label>
            <p className="text-sm sm:col-span-2 self-end">{data.capacity.limit ? `${data.capacity.left} of ${data.capacity.limit} still available.` : 'No limit beyond the seats and ticket quantities.'}</p>
          </div>
        </DashCard>
        <DashCard title="Policies" sub="Customers accept the terms at checkout. Changing them makes a new version; paid orders keep the one they accepted.">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs"><span className="font-bold">Event terms (version {e.termsVersion})</span><textarea className="tl-dash-input" rows={5} maxLength={10000} value={f.terms} onChange={set('terms')} placeholder="e.g. Bags are searched. No outside food or drink." /></label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Refund policy</span><textarea className="tl-dash-input" rows={3} maxLength={5000} value={f.refundPolicy} onChange={set('refundPolicy')} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs"><span className="font-bold">Minimum age</span><input className="tl-dash-input" type="number" min={1} max={99} placeholder="All ages" value={f.ageRestriction} onChange={set('ageRestriction')} /></label>
              <label className="grid gap-1 text-xs"><span className="font-bold">Session name (when it has several dates)</span><input className="tl-dash-input" maxLength={60} placeholder="e.g. Evening show" value={f.sessionLabel} onChange={set('sessionLabel')} /></label>
            </div>
          </div>
        </DashCard>
      </fieldset>
      {editable && <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Save className="w-3.5 h-3.5 inline" /> Save settings</button>}
    </form>
  );
}

function PhasesTab({ id, data, load, flash, user }) {
  const editable = can(user, 'event.pricing');
  const [drafts, setDrafts] = useState(() => Object.fromEntries(data.event.tiers.map((t) => [t.id, t.phases.map((p) => ({ name: p.name, price: Number(p.price), startsAt: local(p.startsAt), endsAt: local(p.endsAt), quantity: p.quantity ?? '' }))])));
  const save = async (tierId) => {
    try {
      const r = await api.put(`/org/events/${id}/tiers/${tierId}/phases`, { phases: drafts[tierId].map((p) => ({ ...p, startsAt: iso(p.startsAt), endsAt: iso(p.endsAt) })) });
      flash('good', r.data.message);
      load();
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  const setP = (tierId, i, k, v) => setDrafts({ ...drafts, [tierId]: drafts[tierId].map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">Phases run in order. A phase becomes current when its start time comes (or the one before sells its quantity); its price then becomes the ticket's price everywhere. With no phases, the ticket keeps its own price.</p>
      {data.event.tiers.map((t) => (
        <DashCard key={t.id} title={`${t.name} · now ${pkr(t.price)}`} icon={Layers} sub={t.currentPhaseId ? `Current phase: ${t.phases.find((p) => p.id === t.currentPhaseId)?.name || '—'}` : 'No phase running'}>
          <div className="grid gap-2">
            {drafts[t.id].map((p, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-6 items-end">
                <input className="tl-dash-input" disabled={!editable} placeholder="Name" value={p.name} onChange={(e) => setP(t.id, i, 'name', e.target.value)} aria-label="Phase name" />
                <input className="tl-dash-input" disabled={!editable} type="number" min={0} placeholder="Price" value={p.price} onChange={(e) => setP(t.id, i, 'price', e.target.value)} aria-label="Price" />
                <input className="tl-dash-input" disabled={!editable} type="datetime-local" value={p.startsAt} onChange={(e) => setP(t.id, i, 'startsAt', e.target.value)} aria-label="Starts" />
                <input className="tl-dash-input" disabled={!editable} type="datetime-local" value={p.endsAt} onChange={(e) => setP(t.id, i, 'endsAt', e.target.value)} aria-label="Ends" />
                <input className="tl-dash-input" disabled={!editable} type="number" min={1} placeholder="Tickets (optional)" value={p.quantity} onChange={(e) => setP(t.id, i, 'quantity', e.target.value)} aria-label="Quantity" />
                {editable && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setDrafts({ ...drafts, [t.id]: drafts[t.id].filter((_, j) => j !== i) })} aria-label="Remove phase"><Trash2 className="w-3.5 h-3.5 inline" /></button>}
              </div>
            ))}
            {editable && (
              <div className="flex gap-2">
                <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={drafts[t.id].length >= 6} onClick={() => setDrafts({ ...drafts, [t.id]: [...drafts[t.id], { name: drafts[t.id].length ? 'Regular' : 'Early bird', price: Number(t.price), startsAt: '', endsAt: '', quantity: '' }] })}><Plus className="w-3.5 h-3.5 inline" /> Add phase</button>
                <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => save(t.id)}><Save className="w-3.5 h-3.5 inline" /> Save phases</button>
              </div>
            )}
          </div>
        </DashCard>
      ))}
    </div>
  );
}

function CopiesTab({ id, data, load, flash }) {
  const navigate = useNavigate();
  const [copy, setCopy] = useState({ name: `${data.event.name} (copy)`, date: '', time: '19:00', endDate: '', endTime: '22:00' });
  const [rule, setRule] = useState({ frequency: 'WEEKLY', count: 4, interval: 1, label: data.event.sessionLabel || '' });
  const duplicate = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/org/events/${id}/duplicate`, { ...copy, endDate: copy.endDate || copy.date });
      flash('good', r.data.message);
      navigate(`/organizer/events/${r.data.data.event.id}/manage`);
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  const repeat = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/org/events/${id}/dates`, { recurrence: { frequency: rule.frequency, count: Number(rule.count), interval: Number(rule.interval) }, label: rule.label || undefined });
      flash('good', r.data.message + (r.data.data.skipped.length ? ` Skipped: ${r.data.data.skipped.map((s) => `${s.date} (${s.reason})`).join('; ')}` : ''));
      load();
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  return (
    <div className="space-y-6">
      <DashCard title="Duplicate this event" sub="A new draft with the same details, images, ticket types, sale phases, seating plan, gates and rules (new records, no sales). Send it for approval when ready." icon={Copy}>
        <form className="grid gap-3 sm:grid-cols-5 items-end" onSubmit={duplicate}>
          <label className="grid gap-1 text-xs sm:col-span-5"><span className="font-bold">Name</span><input className="tl-dash-input" required minLength={3} value={copy.name} onChange={(e) => setCopy({ ...copy, name: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">Date</span><input className="tl-dash-input" type="date" required value={copy.date} onChange={(e) => setCopy({ ...copy, date: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">Starts</span><input className="tl-dash-input" type="time" required value={copy.time} onChange={(e) => setCopy({ ...copy, time: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">End date</span><input className="tl-dash-input" type="date" value={copy.endDate} onChange={(e) => setCopy({ ...copy, endDate: e.target.value })} placeholder="Same day" /></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">Ends</span><input className="tl-dash-input" type="time" required value={copy.endTime} onChange={(e) => setCopy({ ...copy, endTime: e.target.value })} /></label>
          <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Copy className="w-3.5 h-3.5 inline" /> Duplicate</button>
        </form>
      </DashCard>
      <DashCard title="More dates or sessions" sub="Copies at the same time of day and length, grouped with this event so customers can pick a date. Dates the venue is already booked for are skipped." icon={Plus}>
        <form className="grid gap-3 sm:grid-cols-5 items-end" onSubmit={repeat}>
          <label className="grid gap-1 text-xs"><span className="font-bold">Repeat</span><select className="tl-dash-select" value={rule.frequency} onChange={(e) => setRule({ ...rule, frequency: e.target.value })}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">Every</span><input className="tl-dash-input" type="number" min={1} max={12} value={rule.interval} onChange={(e) => setRule({ ...rule, interval: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">How many more</span><input className="tl-dash-input" type="number" min={1} max={52} value={rule.count} onChange={(e) => setRule({ ...rule, count: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">This date's session name</span><input className="tl-dash-input" maxLength={60} value={rule.label} onChange={(e) => setRule({ ...rule, label: e.target.value })} placeholder="optional" /></label>
          <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Plus className="w-3.5 h-3.5 inline" /> Add dates</button>
        </form>
      </DashCard>
      {data.dates.length > 0 && (
        <DashCard title="All dates of this event">
          <div className="tl-dash-table-wrap"><table className="tl-dash-table"><tbody>
            {data.dates.map((d) => <tr key={d.id}><td>{when(d.startsAt || d.date)}{d.id === id ? ' · this one' : ''}</td><td className="text-xs">{d.sessionLabel || ''}</td><td><Status value={d.status} /></td><td>{d.id !== id && <Link className="tl-st-btn tl-st-btn--sm" to={`/organizer/events/${d.id}/manage`}>Open</Link>}</td></tr>)}
          </tbody></table></div>
        </DashCard>
      )}
    </div>
  );
}

function AnnouncementsTab({ id, data, load, flash }) {
  const [f, setF] = useState({ title: '', body: '', isPublic: true, notifyHolders: true });
  const send = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/org/events/${id}/announcements`, f);
      flash('good', r.data.message);
      setF({ ...f, title: '', body: '' });
      load();
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  return (
    <div className="space-y-6">
      <DashCard title="New announcement" sub="Ticket holders get it in-app and by email; public ones also show on the event page." icon={Megaphone}>
        <form className="grid gap-3" onSubmit={send}>
          <input className="tl-dash-input" required minLength={3} maxLength={120} placeholder="Title, e.g. Doors open at 6:30" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Title" />
          <textarea className="tl-dash-input" rows={4} required minLength={5} maxLength={3000} placeholder="Message" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-label="Message" />
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={f.notifyHolders} onChange={(e) => setF({ ...f, notifyHolders: e.target.checked })} /> Notify ticket holders</label>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Show on the event page</label>
          <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm justify-self-start"><Megaphone className="w-3.5 h-3.5 inline" /> Post</button>
        </form>
      </DashCard>
      <DashCard title="Posted">
        {!data.announcements.length ? <DashState icon={Megaphone} title="No announcements yet" /> : (
          <ul className="grid gap-3">{data.announcements.map((a) => (
            <li key={a.id} className="border-b pb-2">
              <div className="flex justify-between gap-2"><strong>{a.title}</strong><button type="button" className="tl-st-btn tl-st-btn--sm" onClick={async () => { try { await api.delete(`/org/events/${id}/announcements/${a.id}`); load(); } catch (e) { flash('bad', errText(e)); } }} aria-label="Remove"><Trash2 className="w-3.5 h-3.5 inline" /></button></div>
              <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
              <p className="text-xs text-slate-500">{when(a.createdAt)} · {a.notifyHolders ? `${a.recipientCount} notified` : 'not sent'} · {a.isPublic ? 'public' : 'holders only'}</p>
            </li>
          ))}</ul>
        )}
      </DashCard>
    </div>
  );
}

function StaffTab({ id, flash, user }) {
  const [staff, setStaff] = useState(null);
  const load = useCallback(() => api.get(`/org/events/${id}/staff`).then((r) => setStaff(r.data.data.staff)).catch((e) => flash('bad', errText(e))), [id]);
  useEffect(() => { load(); }, [load]);
  const set = async (m, assign) => {
    try {
      const r = await api.put(`/org/events/${id}/staff/${m.memberId}`, { assign });
      setStaff(r.data.data.staff);
    } catch (e) {
      flash('bad', errText(e));
    }
  };
  if (!staff) return <DashState icon={RefreshCw} title="Loading…" />;
  const editable = can(user, 'staff.manage');
  return (
    <DashCard title="Who works on this event" sub="Owners, admins and finance managers cover every event. Event managers, staff and gate staff only work on events they are added to. Gates per person: Gates page." icon={Users}>
      <div className="tl-dash-table-wrap"><table className="tl-dash-table">
        <thead><tr><th>Member</th><th>Role</th><th>On this event</th></tr></thead>
        <tbody>{staff.map((m) => (
          <tr key={m.memberId}>
            <td><strong>{m.name}</strong><div className="text-xs text-slate-500">{m.email}</div></td>
            <td className="text-xs">{m.roleLabel}</td>
            <td>{!m.scoped ? <span className="text-xs">Every event</span> : editable ? <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={m.assigned} onChange={(e) => set(m, e.target.checked)} /> {m.assigned ? 'Assigned' : 'Not assigned'}</label> : (m.assigned ? 'Assigned' : '—')}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </DashCard>
  );
}

const shortValue = (v) => {
  if (v == null) return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

function HistoryTab({ id, flash }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get(`/org/events/${id}/history`).then((r) => setRows(r.data.data.history)).catch((e) => flash('bad', errText(e))); }, [id]);
  if (!rows) return <DashState icon={RefreshCw} title="Loading…" />;
  return (
    <DashCard title="Change history" sub="Every change to the event, its settings, tickets, staff and reviews." icon={History}>
      {!rows.length ? <DashState icon={History} title="Nothing recorded yet" /> : (
        <div className="tl-dash-table-wrap"><table className="tl-dash-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
          <tbody>{rows.map((h) => (
            <tr key={h.id}>
              <td className="text-xs whitespace-nowrap">{when(h.at)}</td>
              <td className="text-xs">{h.who || 'System'}</td>
              <td className="text-xs"><code>{h.action}</code></td>
              <td className="text-xs">
                {h.after && typeof h.after === 'object' ? Object.keys(h.after).map((k) => <div key={k}><b>{k}</b>: <span className="text-slate-500">{shortValue(h.before?.[k])}</span> → {shortValue(h.after[k])}</div>) : (h.details?.message || h.details?.title || '')}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </DashCard>
  );
}

function ReportTab({ id, flash }) {
  const [r, setR] = useState(null);
  useEffect(() => { api.get(`/org/events/${id}/report`).then((x) => setR(x.data.data)).catch((e) => flash('bad', errText(e))); }, [id]);
  const csv = async () => {
    const x = await api.get(`/org/events/${id}/report`, { params: { format: 'csv' }, responseType: 'blob' });
    const url = URL.createObjectURL(x.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-report-${id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (!r) return <DashState icon={RefreshCw} title="Building the report…" />;
  const t = r.totals;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[['Tickets sold', t.ticketsSold], ['Collected', pkr(t.collected)], ['Checked in', `${t.checkedIn} (${t.noShows} no-shows)`], ['Refunded', pkr(t.refunded)]].map(([l, v]) => <DashCard key={l} title={l}><p className="text-2xl font-extrabold">{v}</p></DashCard>)}
      </div>
      <DashCard title="Performance" icon={BarChart3} aside={<button type="button" className="tl-st-btn tl-st-btn--sm" onClick={csv}><Download className="w-3.5 h-3.5 inline" /> CSV</button>}>
        <p className="text-sm mb-3">Ticket sales {pkr(t.ticketSales)} · discounts {pkr(t.discounts)} · service fees {pkr(t.serviceFees)} · tax {pkr(t.tax)} · {t.orders} orders{t.views ? ` · ${t.views} page views` : ''}</p>
        <div className="tl-dash-table-wrap"><table className="tl-dash-table">
          <thead><tr><th>Ticket type</th><th>Price now</th><th>Sold</th><th>Revenue</th></tr></thead>
          <tbody>{r.byTier.map((x) => <tr key={x.tier}><td>{x.tier}</td><td>{pkr(x.price)}</td><td>{x.sold} / {x.capacity}</td><td>{pkr(x.revenue)}</td></tr>)}</tbody>
        </table></div>
      </DashCard>
      <DashCard title="Sales by day">
        {!r.daily.length ? <DashState icon={BarChart3} title="No sales yet" /> : (
          <div className="tl-dash-table-wrap"><table className="tl-dash-table"><tbody>{r.daily.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.orders} orders</td><td>{pkr(d.amount)}</td></tr>)}</tbody></table></div>
        )}
      </DashCard>
    </div>
  );
}
