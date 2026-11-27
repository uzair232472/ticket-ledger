import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, Ticket, Save, RefreshCw, Search, Pencil, Percent, Users, Armchair, X, Calculator } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/permissions';
import { DashCard, DashHead, DashState, Notice, Status } from '../components/dash/DashShell';
import { StatCard } from '../components/dash/Studio';
import Pager, { pageOf } from '../components/dash/Pager';
import '../components/dash/discounts.css';

/*
 * Checkout settings: the organization's service fee and tax (finance.manage), and each event's rules
 * (event.edit): tickets per customer, automatic group discount, seat changes. Both are edited in a dialog;
 * the page lists what is set. New settings apply to new checkouts; orders already placed keep their prices.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const pkr = (n) => `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const PAGE = 10;

/** What a 2,000-rupee ticket costs with these fees, as a quick check for the organizer. */
function example(fees) {
  const price = 2000;
  const fee = fees.serviceFeeType === 'PERCENT' ? (price * Number(fees.serviceFeeValue || 0)) / 100 : fees.serviceFeeType === 'PER_TICKET' ? Number(fees.serviceFeeValue || 0) : 0;
  const tax = ((price + fee) * Number(fees.taxPercent || 0)) / 100;
  return { price, fee, tax, total: price + fee + tax };
}

const feeText = (f) => (f.serviceFeeType === 'PERCENT' ? `${Number(f.serviceFeeValue || 0)}% of tickets` : f.serviceFeeType === 'PER_TICKET' ? `${pkr(f.serviceFeeValue)} per ticket` : 'No service fee');
const rulesOf = (e) => ({
  maxTicketsPerCustomer: e.maxTicketsPerCustomer ?? '',
  groupMinTickets: e.groupMinTickets ?? '',
  groupDiscountPercent: e.groupDiscountPercent ?? '',
  allowSeatChanges: Boolean(e.allowSeatChanges),
  seatChangeCutoffHours: e.seatChangeCutoffHours ?? 24,
});

/** Dialog shell shared by the two editors: closes on Escape, the backdrop or Cancel (not while saving). */
function Dialog({ title, intro, onClose, onSubmit, saving, error, submitLabel, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);
  return (
    <div className="tl-dash-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form onSubmit={onSubmit} className="tl-dash-dialog tl-inv-dialog tl-dc-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-co-title">
        <button type="button" className="tl-inv-close" onClick={onClose} aria-label="Close" disabled={saving}><X className="w-4 h-4" /></button>
        <h3 id="tl-co-title">{title}</h3>
        {intro && <p>{intro}</p>}
        {children}
        {error && <p className="tl-inv-error" role="alert">{error}</p>}
        <div className="tl-dash-dialog-actions">
          <button type="button" className="tl-dash-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="tl-dash-btn tl-dash-btn--green" disabled={saving}><Save className="w-4 h-4" aria-hidden="true" /> {saving ? 'Saving…' : submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

export default function OrganizerCheckoutSettings() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [editFees, setEditFees] = useState(null); // fee form while the dialog is open
  const [editRules, setEditRules] = useState(null); // { event, form } while the dialog is open
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const canFees = can(user, 'finance.manage');
  const canRules = can(user, 'event.edit');

  const load = useCallback(() => api.get('/org/checkout').then((r) => setData(r.data.data)).catch((e) => setNotice({ tone: 'bad', text: errText(e) })), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [query]);

  const events = useMemo(() => data?.events || [], [data]);
  const listed = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? events.filter((e) => words.every((w) => `${e.name} ${e.status} ${new Date(e.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`.toLowerCase().includes(w))) : events;
  }, [events, query]);
  const shown = pageOf(listed, page, PAGE);

  const close = () => { setEditFees(null); setEditRules(null); setFormError(''); };
  const submit = async (e, request) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const r = await request();
      setNotice({ tone: 'good', text: r.data.message });
      setData(r.data.data);
      close();
    } catch (err) {
      setFormError(errText(err)); // the dialog stays open with what was typed
    } finally {
      setSaving(false);
    }
  };
  const saveFees = (e) => submit(e, () => api.put('/org/checkout/fees', { ...editFees, taxRegistrationNumber: editFees.taxRegistrationNumber || '' }));
  const saveRules = (e) => submit(e, () => api.put(`/org/events/${editRules.event.id}/checkout-rules`, editRules.form));

  if (!data) {
    return (
      <div className="space-y-6">
        <DashHead eyebrow="Sales" title="Checkout settings" />
        {notice ? <Notice tone="bad">{notice.text}</Notice> : <DashState icon={RefreshCw} title="Loading…" />}
      </div>
    );
  }

  const fees = data.fees;
  const ex = example(fees);
  const withLimit = events.filter((e) => e.maxTicketsPerCustomer).length;
  const withGroup = events.filter((e) => e.groupDiscountPercent && e.groupMinTickets).length;
  const withSeat = events.filter((e) => e.allowSeatChanges).length;
  const f = editFees;
  const fex = f && example(f);
  const r = editRules?.form;
  const setRule = (k, v) => setEditRules((x) => ({ ...x, form: { ...x.form, [k]: v } }));

  return (
    <div className="space-y-6 tl-dc tl-co">
      <DashHead
        eyebrow="Sales"
        title="Checkout settings"
        intro="Fees, tax and per-event rules customers see at checkout. Changes apply to new orders; paid orders keep their prices."
        actions={canFees && (
          <button type="button" className="tl-aov-cta" onClick={() => { setFormError(''); setEditFees({ ...fees }); }}>
            <Pencil className="w-4 h-4" aria-hidden="true" /> Edit fees &amp; tax
          </button>
        )}
      />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

      <div className="tl-dc-stats">
        <StatCard icon={Receipt} tone="green" label="Service fee" value={fees.serviceFeeType === 'NONE' ? 'None' : fees.serviceFeeType === 'PERCENT' ? `${Number(fees.serviceFeeValue || 0)}%` : pkr(fees.serviceFeeValue)} note={fees.serviceFeeType === 'PER_TICKET' ? 'Per ticket' : fees.serviceFeeType === 'PERCENT' ? 'Of the ticket price' : 'Customers pay the ticket price'} />
        <StatCard icon={Percent} tone="blue" label="Tax" value={`${Number(fees.taxPercent || 0)}%`} note={fees.taxLabel || 'No tax name set'} />
        <StatCard icon={Calculator} tone="amber" label="Example checkout" value={pkr(ex.total.toFixed(2))} note={`For a ${pkr(ex.price)} ticket`} />
        <StatCard icon={Ticket} tone="rose" label="Events with rules" value={(new Set(events.filter((e) => e.maxTicketsPerCustomer || (e.groupDiscountPercent && e.groupMinTickets) || e.allowSeatChanges).map((e) => e.id))).size} note={`${withLimit} limits · ${withGroup} group deals · ${withSeat} seat changes`} />
      </div>

      <DashCard title="Service fee & tax" sub={canFees ? 'Added on top of the ticket price and shown as separate lines at checkout and on invoices.' : 'Only owners, admins and finance managers can change these.'} icon={Receipt}>
        <dl className="tl-co-facts">
          <div><dt>Service fee</dt><dd>{feeText(fees)}</dd></div>
          <div><dt>Tax</dt><dd>{Number(fees.taxPercent || 0)}%{fees.taxLabel ? ` · ${fees.taxLabel}` : ''}</dd></div>
          <div><dt>Tax registration number</dt><dd>{fees.taxRegistrationNumber || 'Not set'}</dd></div>
        </dl>
        <div className="tl-co-example" aria-label="Example checkout for a 2,000 rupee ticket">
          <span>Ticket <b>{pkr(ex.price)}</b></span>
          <span>+ Service fee <b>{pkr(ex.fee.toFixed(2))}</b></span>
          <span>+ {fees.taxLabel || 'Tax'} <b>{pkr(ex.tax.toFixed(2))}</b></span>
          <span className="is-total">= <b>{pkr(ex.total.toFixed(2))}</b> at checkout</span>
        </div>
      </DashCard>

      <DashCard
        title="Event rules"
        sub="Limit tickets per customer, give groups an automatic discount (codes and group discounts don't stack: the bigger one applies), and let customers move to another free seat of the same type."
        icon={Ticket}
        aside={events.length > 0 && (
          <label className="tl-co-search">
            <Search className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Search events</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>}
          </label>
        )}
      >
        {!events.length ? <DashState icon={Ticket} title="No events yet" /> : !listed.length ? (
          <DashState icon={Search} title={`No events match “${query}”`} />
        ) : (
          <>
            <div className="tl-dash-table-wrap">
              <table className="tl-dash-table tl-dc-table">
                <thead><tr><th>Event</th><th>Max per customer</th><th>Group discount</th><th>Seat changes</th><th className="is-num">Actions</th></tr></thead>
                <tbody>
                  {shown.rows.map((ev) => (
                    <tr key={ev.id}>
                      <td><strong className="tl-dc-value">{ev.name}</strong><div className="tl-dc-note">{new Date(ev.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {ev.status.toLowerCase().replace(/_/g, ' ')}</div></td>
                      <td>{ev.maxTicketsPerCustomer ? <><Users className="w-3.5 h-3.5 inline -mt-0.5 tl-co-ic" aria-hidden="true" /> {ev.maxTicketsPerCustomer} tickets</> : <span className="tl-dc-note">No limit</span>}</td>
                      <td>{ev.groupDiscountPercent && ev.groupMinTickets ? <span className="tl-dc-code">{ev.groupDiscountPercent}% off · {ev.groupMinTickets}+ tickets</span> : <span className="tl-dc-note">None</span>}</td>
                      <td>{ev.allowSeatChanges ? <Status value="ACTIVE" label={`Until ${ev.seatChangeCutoffHours ?? 0}h before`} /> : <Status value="INACTIVE" label="Not allowed" />}</td>
                      <td className="is-num">
                        {canRules && (
                          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => { setFormError(''); setEditRules({ event: ev, form: rulesOf(ev) }); }}>
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit rules
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={shown.page} total={listed.length} onPage={setPage} label="Event rules" />
          </>
        )}
      </DashCard>

      {f && (
        <Dialog title="Fees & tax" intro="Added on top of the ticket price. New checkouts use the new values." onClose={close} onSubmit={saveFees} saving={saving} error={formError} submitLabel="Save fees & tax">
          <div className="tl-dc-form">
            <label className="tl-dc-field"><span>Service fee</span>
              <select className="tl-dash-select" value={f.serviceFeeType} onChange={(e) => setEditFees({ ...f, serviceFeeType: e.target.value })}>
                <option value="NONE">No service fee</option>
                <option value="PERCENT">Percent of tickets</option>
                <option value="PER_TICKET">PKR per ticket</option>
              </select>
            </label>
            <label className="tl-dc-field"><span>{f.serviceFeeType === 'PERCENT' ? 'Fee (%) — up to 30' : 'Fee per ticket (PKR)'}</span>
              <input className="tl-dash-input" type="number" min={0} step="any" disabled={f.serviceFeeType === 'NONE'} value={f.serviceFeeType === 'NONE' ? '' : f.serviceFeeValue} onChange={(e) => setEditFees({ ...f, serviceFeeValue: e.target.value })} />
            </label>
            <label className="tl-dc-field"><span>Tax (%)</span>
              <input className="tl-dash-input" type="number" min={0} max={30} step="any" value={f.taxPercent} onChange={(e) => setEditFees({ ...f, taxPercent: e.target.value })} />
            </label>
            <label className="tl-dc-field"><span>Tax name on receipts</span>
              <input className="tl-dash-input" maxLength={40} value={f.taxLabel} onChange={(e) => setEditFees({ ...f, taxLabel: e.target.value })} placeholder="e.g. Punjab sales tax" />
            </label>
            <label className="tl-dc-field is-wide"><span>Tax registration number (optional)</span>
              <input className="tl-dash-input" maxLength={40} value={f.taxRegistrationNumber || ''} onChange={(e) => setEditFees({ ...f, taxRegistrationNumber: e.target.value })} placeholder="Printed on invoices" />
            </label>
          </div>
          <p className="tl-co-preview">A {pkr(fex.price)} ticket → fee {pkr(fex.fee.toFixed(2))} + {f.taxLabel || 'tax'} {pkr(fex.tax.toFixed(2))} = <b>{pkr(fex.total.toFixed(2))}</b></p>
        </Dialog>
      )}

      {editRules && (
        <Dialog title="Event rules" intro={editRules.event.name} onClose={close} onSubmit={saveRules} saving={saving} error={formError} submitLabel="Save rules">
          <div className="tl-dc-form">
            <label className="tl-dc-field is-wide"><span>Most tickets one customer can buy</span>
              <input className="tl-dash-input" type="number" min={1} max={100} placeholder="No limit" value={r.maxTicketsPerCustomer} onChange={(e) => setRule('maxTicketsPerCustomer', e.target.value)} />
            </label>
            <label className="tl-dc-field"><span>Group discount (%)</span>
              <input className="tl-dash-input" type="number" min={1} max={50} placeholder="None" value={r.groupDiscountPercent} onChange={(e) => setRule('groupDiscountPercent', e.target.value)} />
            </label>
            <label className="tl-dc-field"><span>For orders of at least (tickets)</span>
              <input className="tl-dash-input" type="number" min={2} max={10} placeholder="e.g. 4" value={r.groupMinTickets} onChange={(e) => setRule('groupMinTickets', e.target.value)} />
            </label>
            <label className="tl-co-check is-wide">
              <input type="checkbox" checked={r.allowSeatChanges} onChange={(e) => setRule('allowSeatChanges', e.target.checked)} />
              <span><Armchair className="w-4 h-4 inline -mt-0.5" aria-hidden="true" /> Customers may move to another free seat of the same type</span>
            </label>
            {r.allowSeatChanges && (
              <label className="tl-dc-field is-wide"><span>Seat changes close this many hours before the event</span>
                <input className="tl-dash-input" type="number" min={0} max={720} value={r.seatChangeCutoffHours} onChange={(e) => setRule('seatChangeCutoffHours', Number(e.target.value))} />
              </label>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
