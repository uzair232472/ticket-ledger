import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tag, Plus, RefreshCw, Save, Trash2, Power, Pencil, Percent, Ticket, X } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../components/ui/DialogProvider';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';
import { StatCard } from '../components/dash/Studio';
import Pager, { pageOf } from '../components/dash/Pager';
import '../components/dash/discounts.css';

/*
 * Discount codes: a New coupon button opens a dialog to create codes for every event or one event, with a usage limit, a per-customer limit, a minimum
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
  const [editing, setEditing] = useState(null); // id or 'new': the coupon dialog is open
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [page, setPage] = useState(0); // 10 codes a page
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
  // The coupon dialog closes with Escape (unless it is saving)
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) setEditing(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, saving]);
  useEffect(() => {
    if (isAdmin) api.get('/companies/admin/all').then((r) => setCompanies(r.data.data?.companies || [])).catch(() => {});
  }, [isAdmin]);

  // Event-scoped members can only make codes for their own events
  const pickable = me?.eventScoped ? events.filter((e) => me.eventIds?.includes(e.id)) : events;

  const startEdit = (c) => {
    setFormError('');
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
    setSaving(true);
    setFormError('');
    const created = editing === 'new';
    let ok = false;
    try {
      const res = await (created
        ? api.post('/org/discounts', { ...body, code: form.code, eventId: form.eventId || null }, { params: scope })
        : api.patch(`/org/discounts/${editing}`, body, { params: scope }));
      flash('good', res.data.message);
      await load();
      ok = true;
    } catch (err) {
      // Shown inside the dialog, which stays open so nothing typed is lost
      setFormError(errText(err));
    }
    setSaving(false);
    if (ok) {
      setEditing(null);
      // A new coupon shows on the first page of the coupon list
      if (created) { setSource('MANUAL'); setPage(0); }
    }
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
  const list = codes || [];
  const shown = pageOf(list, page, 10);
  const totals = {
    active: list.filter((c) => c.state === 'ACTIVE').length,
    used: list.reduce((n, c) => n + (c.used || 0), 0),
    given: list.reduce((n, c) => n + Number(c.discountGiven || 0), 0),
  };
  const recovery = source === 'CART_RECOVERY';
  return (
    <div className="space-y-6 tl-dc">
      <DashHead
        eyebrow={me?.organization?.name || 'Organization'}
        title="Discount codes"
        intro={`Customers enter codes at checkout. Codes go up to ${maxPercent}% and never make an order free.`}
        actions={(
          <button type="button" className="tl-aov-cta" onClick={() => startEdit(null)}>
            <Plus className="w-4 h-4" aria-hidden="true" /> New coupon
          </button>
        )}
        segment={<Segmented label="Code types" options={[{ value: 'MANUAL', label: 'Coupon codes', icon: Tag }, { value: 'CART_RECOVERY', label: 'Recovery codes', icon: RefreshCw }]} value={source} onChange={(v) => { setSource(v); setEditing(null); setPage(0); }} />}
      />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

      <div className="tl-dc-stats">
        <StatCard icon={recovery ? RefreshCw : Tag} tone="green" label={recovery ? 'Recovery codes' : 'Coupon codes'} value={codes ? list.length.toLocaleString() : '…'} note={recovery ? 'Sent with checkout reminders' : 'Created by your team'} />
        <StatCard icon={Power} tone="blue" label="Active now" value={codes ? totals.active.toLocaleString() : '…'} note="Customers can use these today" />
        <StatCard icon={Ticket} tone="amber" label="Times used" value={codes ? totals.used.toLocaleString() : '…'} note="Paid and awaiting-payment orders" />
        <StatCard icon={Percent} tone="rose" label="Discount given" value={codes ? pkr(totals.given) : '…'} note="Across paid orders" />
      </div>

      <DashCard
        title={recovery ? 'Recovery codes' : 'Coupon codes'}
        sub={recovery ? 'Personal single-use codes sent with abandoned-checkout reminders (Abandoned intents). They are made automatically.' : 'A use counts while the order is waiting for payment and once it is paid. Lapsed checkouts give the use back.'}
        icon={recovery ? RefreshCw : Tag}
      >
        {!codes ? <DashState icon={RefreshCw} title="Loading…" /> : !codes.length ? (
          <DashState icon={Tag} title={recovery ? 'No recovery codes yet' : 'No coupon codes yet'}>
            {recovery ? 'They appear here when reminders with a personal code are sent.' : 'Press New coupon to create your first code.'}
          </DashState>
        ) : (
          <>
            <div className="tl-dash-table-wrap">
              <table className="tl-dash-table tl-dc-table">
                <thead><tr><th>Code</th><th>Discount</th><th>Works on</th><th>Used</th><th>Given</th><th>Window</th><th>Status</th><th className="is-num">Actions</th></tr></thead>
                <tbody>
                  {shown.rows.map((c) => (
                    <tr key={c.id}>
                      <td><code className="tl-dc-code">{c.code}</code>{c.description && <div className="tl-dc-note">{c.description}</div>}</td>
                      <td><strong className="tl-dc-value">{c.type === 'PERCENT' ? `${c.value}%` : pkr(c.value)}</strong>{c.minTickets > 1 && <div className="tl-dc-note">min {c.minTickets} tickets</div>}</td>
                      <td>{c.event?.name || 'All events'}</td>
                      <td>{c.used}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}{c.reserved ? <div className="tl-dc-note">{c.reserved} awaiting payment</div> : null}</td>
                      <td>{pkr(c.discountGiven)}</td>
                      <td className="tl-dc-window">{c.startsAt || c.endsAt ? <>{c.startsAt ? fmt(c.startsAt) : 'Now'} → {c.endsAt ? fmt(c.endsAt) : 'no end'}</> : 'Always'}</td>
                      <td><Status value={c.state === 'OFF' ? 'INACTIVE' : c.state} label={STATE_LABELS[c.state]} /></td>
                      <td className="is-num">
                        <div className="tl-dc-actions">
                          {!recovery && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => startEdit(c)}><Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit</button>}
                          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.patch(`/org/discounts/${c.id}`, { active: !c.active }, { params: scope }))}><Power className="w-3.5 h-3.5" aria-hidden="true" /> {c.active ? 'Turn off' : 'Turn on'}</button>
                          <button type="button" className="tl-st-btn tl-st-btn--sm tl-dc-del" onClick={() => remove(c)} aria-label={`Delete ${c.code}`} title="Delete"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={shown.page} total={list.length} onPage={setPage} label={recovery ? 'Recovery codes' : 'Coupon codes'} />
          </>
        )}
      </DashCard>

      {editing && (
        <div className="tl-dash-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <form onSubmit={save} className="tl-dash-dialog tl-inv-dialog tl-dc-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-dc-title" noValidate={false}>
            <button type="button" className="tl-inv-close" onClick={() => setEditing(null)} aria-label="Close"><X className="w-4 h-4" /></button>
            <h3 id="tl-dc-title">{editing === 'new' ? 'New coupon' : `Edit ${form.code}`}</h3>
            <p>{editing === 'new' ? 'Customers type the code at checkout.' : 'The code and its event can’t change once it exists.'}</p>
            <div className="tl-dc-form">
              <label className="tl-dc-field"><span>Code</span>
                <input className="tl-dash-input tl-dc-mono" required minLength={3} maxLength={32} disabled={editing !== 'new'} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="EARLYBIRD" autoFocus={editing === 'new'} />
              </label>
              <label className="tl-dc-field"><span>Discount</span>
                <span className="tl-dc-pair">
                  <input className="tl-dash-input" type="number" required min={1} max={form.type === 'PERCENT' ? maxPercent : undefined} step="any" value={form.value} onChange={set('value')} />
                  <select className="tl-dash-select" value={form.type} onChange={set('type')} aria-label="Discount type">
                    <option value="PERCENT">%</option>
                    <option value="FIXED">PKR</option>
                  </select>
                </span>
              </label>
              <label className="tl-dc-field is-wide"><span>Works on</span>
                <select className="tl-dash-select" disabled={editing !== 'new'} value={form.eventId} onChange={set('eventId')}>
                  {!me?.eventScoped && <option value="">Every event of the organization</option>}
                  {pickable.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </label>
              <label className="tl-dc-field"><span>Total uses</span>
                <input className="tl-dash-input" type="number" min={1} placeholder="Unlimited" value={form.maxRedemptions} onChange={set('maxRedemptions')} />
              </label>
              <label className="tl-dc-field"><span>Uses per customer</span>
                <input className="tl-dash-input" type="number" min={1} max={100} value={form.perUserLimit} onChange={set('perUserLimit')} />
              </label>
              <label className="tl-dc-field"><span>Minimum tickets</span>
                <input className="tl-dash-input" type="number" min={1} max={10} value={form.minTickets} onChange={set('minTickets')} />
              </label>
              <span className="tl-dc-spacer" aria-hidden="true" />
              <label className="tl-dc-field"><span>Starts (optional)</span>
                <input className="tl-dash-input" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
              </label>
              <label className="tl-dc-field"><span>Ends (optional)</span>
                <input className="tl-dash-input" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
              </label>
              <label className="tl-dc-field is-wide"><span>Note (optional, not shown to customers)</span>
                <input className="tl-dash-input" maxLength={200} value={form.description} onChange={set('description')} placeholder="e.g. Launch week offer" />
              </label>
            </div>
            {formError && <p className="tl-inv-error" role="alert">{formError}</p>}
            <div className="tl-dash-dialog-actions">
              <button type="button" className="tl-dash-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="tl-dash-btn tl-dash-btn--green" disabled={saving}><Save className="w-4 h-4" aria-hidden="true" /> {saving ? 'Saving…' : editing === 'new' ? 'Create coupon' : 'Save changes'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
