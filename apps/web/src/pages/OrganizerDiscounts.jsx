import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tag, Plus, RefreshCw, Save, Trash2, Power } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../components/ui/DialogProvider';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';

/*
 * Discount codes: create codes for every event or one event, with a usage limit, a per-customer limit, a minimum
 * number of tickets and an optional time window. Personal codes made for abandoned-checkout reminders are listed
 * under "Recovery codes". The API checks every rule again; a used code can only be turned off, not deleted.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const fmt = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const pkr = (n) => `PKR ${Number(n || 0).toLocaleString()}`;
const toLocalInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const EMPTY = { code: '', description: '', type: 'PERCENT', value: 10, eventId: '', maxRedemptions: '', perUserLimit: 1, minTickets: 1, startsAt: '', endsAt: '' };
const STATE_LABELS = { ACTIVE: 'Active', OFF: 'Off', EXPIRED: 'Expired', SCHEDULED: 'Scheduled', USED_UP: 'Used up' };

export default function OrganizerDiscounts() {
  const { user } = useAuth();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [companyId, setCompanyId] = useState(params.get('companyId') || '');
  const [companies, setCompanies] = useState([]);
  const scope = useMemo(() => (isAdmin ? { companyId } : {}), [isAdmin, companyId]);
  const ready = !isAdmin || Boolean(companyId);

  const [source, setSource] = useState('MANUAL');
  const [codes, setCodes] = useState(null);
  const [maxPercent, setMaxPercent] = useState(90);
  const [events, setEvents] = useState([]);
  const [me, setMe] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // id or 'new'
  const [notice, setNotice] = useState(null);
  const flash = (tone, text) => setNotice({ tone, text });

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const [c, e, m] = await Promise.all([
        api.get('/org/discounts', { params: { ...scope, source } }),
        api.get('/events/organizer/my-events', { params: scope }).catch(() => null),
        api.get('/org/me', { params: scope }).catch(() => null),
      ]);
      setCodes(c.data.data.codes);
      setMaxPercent(c.data.data.maxPercent);
      setEvents(e?.data.data.events || []);
      setMe(m?.data.data || null);
    } catch (err) {
      flash('bad', errText(err));
    }
  }, [ready, scope, source]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isAdmin) api.get('/companies/admin/all').then((r) => setCompanies(r.data.data?.companies || [])).catch(() => {});
  }, [isAdmin]);

  // Event-scoped members can only make codes for their own events
  const pickable = me?.eventScoped ? events.filter((e) => me.eventIds?.includes(e.id)) : events;

  const startEdit = (c) => {
    setEditing(c ? c.id : 'new');
    setForm(c ? {
      code: c.code, description: c.description || '', type: c.type, value: c.value, eventId: c.eventId || '',
      maxRedemptions: c.maxRedemptions ?? '', perUserLimit: c.perUserLimit, minTickets: c.minTickets,
      startsAt: toLocalInput(c.startsAt), endsAt: toLocalInput(c.endsAt),
    } : { ...EMPTY, eventId: me?.eventScoped ? pickable[0]?.id || '' : '' });
  };
  const run = async (fn) => {
    try {
      const res = await fn();
      flash('good', res.data.message);
      await load();
      return true;
    } catch (err) {
      flash('bad', errText(err));
      return false;
    }
  };
  const save = async (e) => {
    e.preventDefault();
    const body = {
      description: form.description,
      type: form.type,
      value: Number(form.value),
      maxRedemptions: form.maxRedemptions === '' ? null : Number(form.maxRedemptions),
      perUserLimit: Number(form.perUserLimit) || 1,
      minTickets: Number(form.minTickets) || 1,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : '',
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : '',
    };
    const ok = await run(() => (editing === 'new'
      ? api.post('/org/discounts', { ...body, code: form.code, eventId: form.eventId || null }, { params: scope })
      : api.patch(`/org/discounts/${editing}`, body, { params: scope })));
    if (ok) setEditing(null);
  };
  const remove = async (c) => {
    if (!(await dialog.confirm({ tone: 'error', title: `Delete ${c.code}?`, message: c.used ? 'This code has been used, so it will be turned off instead (paid orders keep their discount).' : 'Customers can no longer use it.', confirmLabel: c.used ? 'Turn off' : 'Delete' }))) return;
    run(() => api.delete(`/org/discounts/${c.id}`, { params: scope }));
  };

  if (isAdmin && !companyId) {
    return (
      <div className="space-y-6">
        <DashHead eyebrow="Organization" title="Discount codes" intro="Choose an organization. Your access is recorded in its activity history." />
        <DashCard title="Organization">
          <select className="tl-dash-select w-full" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setParams({ companyId: e.target.value }); }}>
            <option value="">Select an organization…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
        </DashCard>
      </div>
    );
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-6">
      <DashHead
        eyebrow={me?.organization?.name || 'Organization'}
        title="Discount codes"
        intro={`Customers enter codes at checkout. Codes go up to ${maxPercent}% and never make an order free.`}
        segment={<Segmented label="Code types" options={[{ value: 'MANUAL', label: 'Codes', icon: Tag }, { value: 'CART_RECOVERY', label: 'Recovery codes', icon: RefreshCw }]} value={source} onChange={(v) => { setSource(v); setEditing(null); }} />}
      />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

      {source === 'MANUAL' && editing && (
        <DashCard title={editing === 'new' ? 'New code' : `Edit ${form.code}`} icon={Tag}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-xs"><span className="font-bold">Code</span>
              <input className="tl-dash-input font-mono" required minLength={3} maxLength={32} disabled={editing !== 'new'} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="EARLYBIRD" />
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Discount</span>
              <div className="flex gap-2">
                <input className="tl-dash-input" type="number" required min={1} max={form.type === 'PERCENT' ? maxPercent : undefined} step="any" value={form.value} onChange={set('value')} />
                <select className="tl-dash-select" value={form.type} onChange={set('type')} aria-label="Discount type">
                  <option value="PERCENT">%</option>
                  <option value="FIXED">PKR</option>
                </select>
              </div>
            </label>
            <label className="grid gap-1 text-xs sm:col-span-2"><span className="font-bold">Works on</span>
              <select className="tl-dash-select" disabled={editing !== 'new'} value={form.eventId} onChange={set('eventId')}>
                {!me?.eventScoped && <option value="">Every event of the organization</option>}
                {pickable.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Total uses</span>
              <input className="tl-dash-input" type="number" min={1} placeholder="Unlimited" value={form.maxRedemptions} onChange={set('maxRedemptions')} />
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Uses per customer</span>
              <input className="tl-dash-input" type="number" min={1} max={100} value={form.perUserLimit} onChange={set('perUserLimit')} />
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Minimum tickets</span>
              <input className="tl-dash-input" type="number" min={1} max={10} value={form.minTickets} onChange={set('minTickets')} />
            </label>
            <span />
            <label className="grid gap-1 text-xs"><span className="font-bold">Starts (optional)</span>
              <input className="tl-dash-input" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Ends (optional)</span>
              <input className="tl-dash-input" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
            </label>
            <label className="grid gap-1 text-xs sm:col-span-2"><span className="font-bold">Note (optional, not shown to customers)</span>
              <input className="tl-dash-input" maxLength={200} value={form.description} onChange={set('description')} />
            </label>
            <div className="sm:col-span-4 flex gap-2">
              <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Save className="w-3.5 h-3.5 inline" /> Save code</button>
              <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        </DashCard>
      )}

      <DashCard
        title={source === 'MANUAL' ? 'Codes' : 'Recovery codes'}
        sub={source === 'MANUAL' ? 'A use counts while the order is waiting for payment and once it is paid. Lapsed checkouts give the use back.' : 'Personal single-use codes sent with abandoned-checkout reminders (Abandoned intents).'}
        icon={Tag}
        aside={source === 'MANUAL' && editing !== 'new' && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => startEdit(null)}><Plus className="w-3.5 h-3.5 inline" /> New code</button>}
      >
        {!codes ? <DashState icon={RefreshCw} title="Loading…" /> : !codes.length ? <DashState icon={Tag} title="No codes yet" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Code</th><th>Discount</th><th>Works on</th><th>Used</th><th>Given</th><th>Window</th><th>Status</th><th /></tr></thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id}>
                    <td><code className="font-bold">{c.code}</code>{c.description && <div className="text-xs text-slate-500">{c.description}</div>}</td>
                    <td>{c.type === 'PERCENT' ? `${c.value}%` : pkr(c.value)}{c.minTickets > 1 && <div className="text-xs text-slate-500">min {c.minTickets} tickets</div>}</td>
                    <td className="text-xs">{c.event?.name || 'All events'}</td>
                    <td className="text-xs">{c.used}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}{c.reserved ? <div className="text-slate-500">{c.reserved} awaiting payment</div> : null}</td>
                    <td className="text-xs">{pkr(c.discountGiven)}</td>
                    <td className="text-xs">{c.startsAt || c.endsAt ? <>{c.startsAt ? fmt(c.startsAt) : 'Now'} → {c.endsAt ? fmt(c.endsAt) : 'no end'}</> : 'Always'}</td>
                    <td><Status value={c.state === 'OFF' ? 'INACTIVE' : c.state} label={STATE_LABELS[c.state]} /></td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {source === 'MANUAL' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => startEdit(c)}>Edit</button>}
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.patch(`/org/discounts/${c.id}`, { active: !c.active }, { params: scope }))}><Power className="w-3.5 h-3.5 inline" /> {c.active ? 'Turn off' : 'Turn on'}</button>
                        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => remove(c)} aria-label={`Delete ${c.code}`}><Trash2 className="w-3.5 h-3.5 inline" /></button>
                      </div>
                    </td>
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
