import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, AlertTriangle, RefreshCw, Download } from 'lucide-react';
import api from '../utils/api';
import { DashCard, DashHead, DashState, Notice } from '../components/dash/DashShell';

/*
 * Admin finance overview: money collected in a period by line (tickets, discounts, fees, tax), refunds, the
 * platform's fee, what is owed to organizations (payouts by status), things waiting for finance, payment
 * methods, daily sales and the top organizations. Links to payouts and exports.
 */

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const iso = (d) => d.toISOString().slice(0, 10);

export default function AdminFinance() {
  const [range, setRange] = useState({ from: iso(new Date(Date.now() - 30 * 86400000)), to: iso(new Date()) });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/admin/finance', { params: range }).then((r) => { setData(r.data.data); setError(''); }).catch((e) => setError(e.response?.data?.message || 'Could not load the finance overview.')), [range]);
  useEffect(() => { load(); }, [load]);
  const download = async (dataset) => {
    const r = await api.get(`/admin/exports/${dataset}`, { params: range, responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticketledger-${dataset}-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const max = Math.max(1, ...(data?.daily || []).map((d) => d.amount));
  return (
    <div className="space-y-6">
      <DashHead eyebrow="Admin console" title="Finance" intro="Money in, money back, the platform's fee and what TicketLedger owes organizers." />
      <DashCard title="Period" icon={Banknote} aside={<button type="button" className="tl-st-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>}>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="grid gap-1 text-xs"><span className="font-bold">From</span><input className="tl-dash-input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="font-bold">To</span><input className="tl-dash-input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => download('orders')}><Download className="w-3.5 h-3.5 inline" /> Orders CSV</button>
          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => download('refunds')}><Download className="w-3.5 h-3.5 inline" /> Refunds CSV</button>
          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => download('payouts')}><Download className="w-3.5 h-3.5 inline" /> Payouts CSV</button>
        </div>
      </DashCard>
      {error && <Notice tone="bad">{error}</Notice>}
      {!data ? <DashState icon={RefreshCw} title="Loading…" /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            {[['Collected', data.totals.collected, `${data.totals.orders} paid orders`], ['Ticket sales', data.totals.ticketSales, `after ${pkr(data.totals.discounts)} discounts`], ['Platform fee', data.totals.platformFee, `${data.platformFeePercent}% of ticket sales`], ['Refunded', data.totals.refunded, `${data.totals.refundsCount} refunds`]].map(([l, v, sub]) => (
              <DashCard key={l} title={l}><p className="text-2xl font-extrabold">{pkr(v)}</p><p className="text-xs text-slate-500">{sub}</p></DashCard>
            ))}
          </div>
          {(data.attention.failedRefunds > 0 || data.attention.payoutDetailsToCheck > 0 || data.attention.payoutsReady > 0) && (
            <DashCard title="Needs attention" icon={AlertTriangle} tone="amber">
              <ul className="text-sm space-y-1">
                {data.attention.payoutsReady > 0 && <li><Link className="underline font-bold" to="/admin/payouts">{data.attention.payoutsReady} payout(s) ready to pay</Link></li>}
                {data.attention.payoutDetailsToCheck > 0 && <li><Link className="underline font-bold" to="/admin/payouts">{data.attention.payoutDetailsToCheck} payout detail(s) to check</Link></li>}
                {data.attention.failedRefunds > 0 && <li><Link className="underline font-bold" to="/admin/event-approvals">{data.attention.failedRefunds} refund(s) failed and retrying</Link></li>}
                {data.attention.payoutsOnHold > 0 && <li>{data.attention.payoutsOnHold} payout(s) on hold</li>}
              </ul>
            </DashCard>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <DashCard title="Daily sales">
              {!data.daily.length ? <DashState icon={Banknote} title="No sales in this period" /> : (
                <div className="flex items-end gap-1" style={{ height: 160 }} role="img" aria-label="Daily sales">
                  {data.daily.map((d) => <div key={d.day} title={`${d.day}: ${pkr(d.amount)}`} style={{ flex: 1, height: `${Math.max(3, (d.amount / max) * 100)}%`, background: '#16a34a', borderRadius: '3px 3px 0 0' }} />)}
                </div>
              )}
            </DashCard>
            <DashCard title="Where the money is">
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between"><dt>Service fees collected</dt><dd>{pkr(data.totals.serviceFees)}</dd></div>
                <div className="flex justify-between"><dt>Tax collected (owed to organizers)</dt><dd>{pkr(data.totals.taxCollected)}</dd></div>
                {Object.entries(data.payouts).map(([st, p]) => <div key={st} className="flex justify-between"><dt>Payouts {st.replace('_', ' ').toLowerCase()} ({p.count})</dt><dd>{pkr(p.amount)}</dd></div>)}
              </dl>
            </DashCard>
            <DashCard title="By payment method">
              <table className="tl-dash-table"><tbody>{data.byMethod.map((m) => <tr key={m.method}><td>{m.method}</td><td>{m.orders} orders</td><td>{pkr(m.amount)}</td></tr>)}</tbody></table>
            </DashCard>
            <DashCard title="Top organizations">
              <table className="tl-dash-table"><tbody>{data.topOrganizations.map((o) => <tr key={o.id}><td>{o.name}</td><td>{pkr(o.amount)}</td></tr>)}</tbody></table>
            </DashCard>
          </div>
        </>
      )}
    </div>
  );
}
