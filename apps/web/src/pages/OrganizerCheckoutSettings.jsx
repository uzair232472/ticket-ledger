import React, { useCallback, useEffect, useState } from 'react';
import { Receipt, Ticket, Save, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/permissions';
import { DashCard, DashHead, DashState, Notice } from '../components/dash/DashShell';

/*
 * Checkout settings: the organization's service fee and tax (finance.manage), and each event's rules
 * (event.edit): tickets per customer, automatic group discount, seat changes. New settings apply to new
 * checkouts; orders already placed keep their prices.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const pkr = (n) => `PKR ${Number(n || 0).toLocaleString()}`;

/** What a 2,000-rupee ticket costs with these fees, as a quick check for the organizer. */
function example(fees) {
  const price = 2000;
  const fee = fees.serviceFeeType === 'PERCENT' ? (price * Number(fees.serviceFeeValue || 0)) / 100 : fees.serviceFeeType === 'PER_TICKET' ? Number(fees.serviceFeeValue || 0) : 0;
  const tax = ((price + fee) * Number(fees.taxPercent || 0)) / 100;
  return { price, fee, tax, total: price + fee + tax };
}

export default function OrganizerCheckoutSettings() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [fees, setFees] = useState(null);
  const [rules, setRules] = useState({});
  const [notice, setNotice] = useState(null);
  const canFees = can(user, 'finance.manage');
  const canRules = can(user, 'event.edit');

  const load = useCallback(() => api.get('/org/checkout').then((r) => {
    setData(r.data.data);
    setFees(r.data.data.fees);
    setRules(Object.fromEntries(r.data.data.events.map((e) => [e.id, { maxTicketsPerCustomer: e.maxTicketsPerCustomer ?? '', groupMinTickets: e.groupMinTickets ?? '', groupDiscountPercent: e.groupDiscountPercent ?? '', allowSeatChanges: e.allowSeatChanges, seatChangeCutoffHours: e.seatChangeCutoffHours }])));
  }).catch((e) => setNotice({ tone: 'bad', text: errText(e) })), []);
  useEffect(() => { load(); }, [load]);

  const saveFees = async (e) => {
    e.preventDefault();
    try {
      const r = await api.put('/org/checkout/fees', { ...fees, taxRegistrationNumber: fees.taxRegistrationNumber || '' });
      setNotice({ tone: 'good', text: r.data.message });
      setData(r.data.data);
      setFees(r.data.data.fees);
    } catch (err) {
      setNotice({ tone: 'bad', text: errText(err) });
    }
  };
  const saveRules = async (eventId) => {
    try {
      const r = await api.put(`/org/events/${eventId}/checkout-rules`, rules[eventId]);
      setNotice({ tone: 'good', text: r.data.message });
      setData(r.data.data);
    } catch (err) {
      setNotice({ tone: 'bad', text: errText(err) });
    }
  };
  const setRule = (id, k, v) => setRules({ ...rules, [id]: { ...rules[id], [k]: v } });

  if (!data || !fees) return <div className="space-y-6"><DashHead eyebrow="Sales" title="Checkout settings" />{notice ? <Notice tone="bad">{notice.text}</Notice> : <DashState icon={RefreshCw} title="Loading…" />}</div>;
  const ex = example(fees);
  return (
    <div className="space-y-6">
      <DashHead eyebrow="Sales" title="Checkout settings" intro="Fees, tax and per-event rules customers see at checkout. Changes apply to new orders; paid orders keep their prices." />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

      <DashCard title="Service fee & tax" sub={canFees ? 'Added on top of the ticket price and shown as separate lines at checkout and on invoices.' : 'Only owners, admins and finance managers can change these.'} icon={Receipt}>
        <form onSubmit={saveFees} className="grid gap-3 sm:grid-cols-3">
          <fieldset disabled={!canFees} className="contents">
            <label className="grid gap-1 text-xs"><span className="font-bold">Service fee</span>
              <select className="tl-dash-select" value={fees.serviceFeeType} onChange={(e) => setFees({ ...fees, serviceFeeType: e.target.value })}>
                <option value="NONE">No service fee</option>
                <option value="PERCENT">Percent of tickets</option>
                <option value="PER_TICKET">PKR per ticket</option>
              </select>
            </label>
            {fees.serviceFeeType !== 'NONE' && (
              <label className="grid gap-1 text-xs"><span className="font-bold">{fees.serviceFeeType === 'PERCENT' ? 'Fee (%) — up to 30' : 'Fee per ticket (PKR)'}</span>
                <input className="tl-dash-input" type="number" min={0} step="any" value={fees.serviceFeeValue} onChange={(e) => setFees({ ...fees, serviceFeeValue: e.target.value })} />
              </label>
            )}
            <label className="grid gap-1 text-xs"><span className="font-bold">Tax (%)</span>
              <input className="tl-dash-input" type="number" min={0} max={30} step="any" value={fees.taxPercent} onChange={(e) => setFees({ ...fees, taxPercent: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Tax name on receipts</span>
              <input className="tl-dash-input" maxLength={40} value={fees.taxLabel} onChange={(e) => setFees({ ...fees, taxLabel: e.target.value })} placeholder="e.g. Punjab sales tax" />
            </label>
            <label className="grid gap-1 text-xs"><span className="font-bold">Tax registration number (optional)</span>
              <input className="tl-dash-input" maxLength={40} value={fees.taxRegistrationNumber || ''} onChange={(e) => setFees({ ...fees, taxRegistrationNumber: e.target.value })} placeholder="Printed on invoices" />
            </label>
          </fieldset>
          <p className="text-xs sm:col-span-3 text-slate-600">Example: a {pkr(ex.price)} ticket → service fee {pkr(ex.fee)} + {fees.taxLabel} {pkr(ex.tax.toFixed(2))} = <b>{pkr(ex.total.toFixed(2))}</b> at checkout.</p>
          {canFees && <div className="sm:col-span-3"><button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Save className="w-3.5 h-3.5 inline" /> Save fees & tax</button></div>}
        </form>
      </DashCard>

      <DashCard title="Event rules" sub="Limit tickets per customer, give groups an automatic discount (codes and group discounts don't stack: the bigger one applies), and let customers move to another free seat of the same type." icon={Ticket}>
        {!data.events.length ? <DashState icon={Ticket} title="No events yet" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Event</th><th>Max per customer</th><th>Group discount</th><th>Seat changes</th><th /></tr></thead>
              <tbody>
                {data.events.map((ev) => {
                  const r = rules[ev.id] || {};
                  return (
                    <tr key={ev.id}>
                      <td><strong>{ev.name}</strong><div className="text-xs text-slate-500">{new Date(ev.date).toLocaleDateString()} · {ev.status.toLowerCase()}</div></td>
                      <td><input className="tl-dash-input" style={{ width: 90 }} type="number" min={1} max={100} placeholder="No limit" disabled={!canRules} value={r.maxTicketsPerCustomer} onChange={(e) => setRule(ev.id, 'maxTicketsPerCustomer', e.target.value)} aria-label={`Max tickets per customer for ${ev.name}`} /></td>
                      <td>
                        <div className="flex items-center gap-1 text-xs">
                          <input className="tl-dash-input" style={{ width: 64 }} type="number" min={1} max={50} placeholder="%" disabled={!canRules} value={r.groupDiscountPercent} onChange={(e) => setRule(ev.id, 'groupDiscountPercent', e.target.value)} aria-label="Group discount percent" /> % off for
                          <input className="tl-dash-input" style={{ width: 64 }} type="number" min={2} max={10} placeholder="N" disabled={!canRules} value={r.groupMinTickets} onChange={(e) => setRule(ev.id, 'groupMinTickets', e.target.value)} aria-label="Group size" /> + tickets
                        </div>
                      </td>
                      <td>
                        <label className="text-xs flex items-center gap-2"><input type="checkbox" disabled={!canRules} checked={Boolean(r.allowSeatChanges)} onChange={(e) => setRule(ev.id, 'allowSeatChanges', e.target.checked)} /> Allowed</label>
                        {r.allowSeatChanges && (
                          <label className="text-xs flex items-center gap-1 mt-1">until <input className="tl-dash-input" style={{ width: 64 }} type="number" min={0} max={720} disabled={!canRules} value={r.seatChangeCutoffHours} onChange={(e) => setRule(ev.id, 'seatChangeCutoffHours', Number(e.target.value))} aria-label="Cut-off hours" /> h before</label>
                        )}
                      </td>
                      <td>{canRules && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => saveRules(ev.id)}><Save className="w-3.5 h-3.5 inline" /> Save</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>
    </div>
  );
}
