import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  CreditCard,
  Download,
  Landmark,
  MapPin,
  PauseCircle,
  Percent,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Ticket,
  Trophy,
  Wallet,
} from 'lucide-react';
import api from '../utils/api';
import { Notice } from '../components/dash/DashShell';
import { PageHero, AovFooter } from './AdminOverview';

/*
 * Admin finance overview: money collected in a period by line (tickets, discounts, fees, tax), refunds, the
 * platform's fee, what is owed to organizations (payouts by status), things waiting for finance, payment
 * methods, daily sales and the top organizations. Links to payouts and exports.
 */

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const compact = (v) => {
  const n = Number(v) || 0;
  const trim = (x, d) => x.toFixed(d).replace(/\.0$/, '');
  if (Math.abs(n) >= 1e6) return `${trim(n / 1e6, 1)}M`;
  if (Math.abs(n) >= 1e3) return `${trim(n / 1e3, 1)}K`;
  return String(Math.round(n));
};
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));
const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

const QUICK = [
  { label: '7 days', from: () => daysAgo(7) },
  { label: '30 days', from: () => daysAgo(30) },
  { label: '90 days', from: () => daysAgo(90) },
  { label: 'This year', from: () => `${new Date().getFullYear()}-01-01` },
];
const METHOD_LABEL = { JAZZCASH: 'JazzCash', EASYPAISA: 'EasyPaisa', STRIPE: 'Card', MOCK: 'Test payments', BANK_TRANSFER: 'Bank transfer' };
const PAYOUT_ICON = { ON_HOLD: PauseCircle, PROCESSING: ArrowRightLeft, PAID: Wallet };

/** Every day of the period, with the days without sales at zero. */
function fillDays(daily, from, to) {
  const byDay = Object.fromEntries(daily.map((d) => [d.day, d.amount]));
  const out = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, amount: byDay[key] || 0 });
  }
  return out;
}

/** Glowing column chart of daily sales: gridlines, date ticks, the best day marked, hover readout. */
function DailyChart({ days }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...days.map((d) => d.amount), 0);
  const step = (() => {
    if (max <= 0) return 1;
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((s) => s >= raw);
  })();
  const top = step * 4;
  const best = days.reduce((b, d, i) => (d.amount > (days[b]?.amount ?? -1) ? i : b), 0);
  const label = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', timeZone: 'UTC' });
  const ticks = days.length <= 8 ? days.map((_, i) => i) : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (days.length - 1)));
  const at = hover ?? (max > 0 ? best : null);

  return (
    <div className="tl-fin-chart" role="img" aria-label={`Daily sales from ${label(days[0].day)} to ${label(days[days.length - 1].day)}. Best day ${pkr(max)}.`}>
      <div className="tl-fin-chart-y" aria-hidden="true">
        {[4, 3, 2, 1, 0].map((k) => <span key={k}>{compact(k * step)}</span>)}
      </div>
      <div className="tl-fin-chart-plot" onPointerLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((k) => <span key={k} className="tl-fin-grid" style={{ bottom: `${(k / 4) * 100}%` }} aria-hidden="true" />)}
        <div className="tl-fin-bars">
          {days.map((d, i) => (
            <div key={d.day} className={`tl-fin-bar${i === at ? ' is-on' : ''}`} onPointerEnter={() => setHover(i)}>
              <span style={{ height: `${d.amount > 0 ? Math.max(2, (d.amount / top) * 100) : 0.8}%` }} />
            </div>
          ))}
        </div>
        {at != null && (
          <div className="tl-fin-tip" style={{ left: `${((at + 0.5) / days.length) * 100}%`, bottom: `${Math.min(88, (days[at].amount / top) * 100)}%` }}>
            <strong>{pkr(days[at].amount)}</strong>
            <span>{label(days[at].day)}{hover == null ? ' · best day' : ''}</span>
          </div>
        )}
      </div>
      <div className="tl-fin-chart-x" aria-hidden="true">
        {ticks.map((i) => <span key={i} style={{ left: `${((i + 0.5) / days.length) * 100}%` }}>{label(days[i].day)}</span>)}
      </div>
    </div>
  );
}

function Panel({ icon: Icon, title, aside, className = '', children }) {
  return (
    <section className={`tl-aov-card tl-fin-panel ${className}`}>
      <div className="tl-aov-card-head">
        <h2 className="tl-aov-card-title"><Icon className="tl-aov-card-icon" aria-hidden="true" />{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function AdminFinance() {
  const [range, setRange] = useState({ from: daysAgo(30), to: iso(new Date()) });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false); // the period box starts closed

  const load = useCallback(() => {
    setLoading(true);
    return api.get('/admin/finance', { params: range })
      .then((r) => { setData(r.data.data); setError(''); })
      .catch((e) => setError(e.response?.data?.message || 'Could not load the finance overview.'))
      .finally(() => setLoading(false));
  }, [range]);
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

  const days = useMemo(() => (data ? fillDays(data.daily, range.from, range.to) : []), [data, range]);
  const t = data?.totals || {};
  const attention = data?.attention || {};
  const needsAttention = attention.failedRefunds > 0 || attention.payoutDetailsToCheck > 0 || attention.payoutsReady > 0 || attention.payoutsOnHold > 0;
  const methodTotal = (data?.byMethod || []).reduce((n, m) => n + m.amount, 0);
  const orgTop = data?.topOrganizations?.[0]?.amount || 0;
  const activeQuick = QUICK.find((q) => q.from() === range.from && range.to === iso(new Date()))?.label;

  const kpis = [
    { icon: ShoppingCart, label: 'Collected', value: t.collected, sub: `${(t.orders || 0).toLocaleString()} paid orders`, bar: 100, barLabel: 'All money taken in' },
    { icon: Ticket, label: 'Ticket sales', value: t.ticketSales, sub: `after ${pkr(t.discounts)} discounts`, bar: pct(t.ticketSales, t.collected), barLabel: `${Math.round(pct(t.ticketSales, t.collected))}% of collected` },
    { icon: Percent, label: 'Platform fee', value: t.platformFee, sub: `${data?.platformFeePercent ?? 0}% of ticket sales`, bar: pct(t.platformFee, t.ticketSales), barLabel: `${data?.platformFeePercent ?? 0}% take rate` },
    { icon: RotateCcw, label: 'Refunded', value: t.refunded, sub: `${(t.refundsCount || 0).toLocaleString()} refunds`, bar: pct(t.refunded, t.collected), barLabel: `${Math.round(pct(t.refunded, t.collected))}% of collected`, tone: 'rose' },
  ];

  return (
    <div className="tl-aov tl-aov-sec tl-fin">
      <PageHero
        icon={Wallet}
        title="Finance"
        intro="Money in, money back, the platform's fee and what TicketLedger owes organizers."
        aside={(
          <button type="button" className="tl-aov-refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4${loading ? ' tl-dash-spin' : ''}`} /> Refresh
          </button>
        )}
      />

      <section className="tl-aov-card tl-fin-period">
        <button type="button" className="tl-fin-period-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="tl-aov-card-title"><CalendarDays className="tl-aov-card-icon" aria-hidden="true" />Period</span>
          <span className="tl-fin-period-sum">{new Date(range.from).toLocaleDateString()} – {new Date(range.to).toLocaleDateString()}</span>
          <ChevronDown className="tl-fin-chev" aria-hidden="true" />
        </button>
        {open && (
          <div className="tl-fin-period-body">
            <label className="tl-fin-date"><span>From</span><input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
            <label className="tl-fin-date"><span>To</span><input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
            <div className="tl-fin-quick" role="group" aria-label="Quick periods">
              {QUICK.map((q) => (
                <button key={q.label} type="button" className={activeQuick === q.label ? 'is-on' : undefined} aria-pressed={activeQuick === q.label} onClick={() => setRange({ from: q.from(), to: iso(new Date()) })}>{q.label}</button>
              ))}
            </div>
            <span className="tl-fin-divider" aria-hidden="true" />
            <div className="tl-fin-exports">
              {['orders', 'refunds', 'payouts'].map((d) => (
                <button key={d} type="button" onClick={() => download(d)}><Download className="w-4 h-4" aria-hidden="true" /> {d[0].toUpperCase() + d.slice(1)} CSV</button>
              ))}
            </div>
          </div>
        )}
      </section>

      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}

      {!data ? (
        <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading the finance overview…</p></div>
      ) : (
        <>
          <div className="tl-fin-kpis">
            {kpis.map((k) => (
              <section key={k.label} className={`tl-fin-kpi${k.tone ? ` is-${k.tone}` : ''}`}>
                <div className="tl-fin-kpi-top">
                  <span className="tl-fin-kpi-icon" aria-hidden="true"><k.icon /></span>
                  <div>
                    <h2>{k.label}</h2>
                    <p className="tl-fin-kpi-value">{pkr(k.value)}</p>
                    <p className="tl-fin-kpi-sub">{k.sub}</p>
                  </div>
                </div>
                <div className="tl-fin-kpi-bar" title={k.barLabel}>
                  <span style={{ width: `${k.bar}%` }} />
                </div>
                <p className="tl-fin-kpi-foot">{k.barLabel}</p>
              </section>
            ))}
          </div>

          {needsAttention && (
            <section className="tl-fin-attn" aria-label="Needs attention">
              <span className="tl-fin-attn-icon" aria-hidden="true"><AlertTriangle /></span>
              <strong>Needs attention</strong>
              <div>
                {attention.payoutsReady > 0 && <Link to="/admin/payouts">{attention.payoutsReady} payout{attention.payoutsReady === 1 ? '' : 's'} ready to pay <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>}
                {attention.payoutDetailsToCheck > 0 && <Link to="/admin/payouts">{attention.payoutDetailsToCheck} payout detail{attention.payoutDetailsToCheck === 1 ? '' : 's'} to check <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>}
                {attention.failedRefunds > 0 && <Link to="/admin/event-approvals?tab=refunds">{attention.failedRefunds} refund{attention.failedRefunds === 1 ? '' : 's'} failed, retrying <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>}
                {attention.payoutsOnHold > 0 && <span>{attention.payoutsOnHold} payout{attention.payoutsOnHold === 1 ? '' : 's'} on hold</span>}
              </div>
            </section>
          )}

          <div className="tl-fin-row">
            <Panel icon={BarChart3} title="Daily sales" aside={<span className="tl-aov-tag">{days.length} days</span>} className="tl-fin-daily">
              {days.length === 0 || !data.daily.length ? <p className="tl-aov-empty">No sales in this period.</p> : <DailyChart days={days} />}
            </Panel>

            <Panel icon={MapPin} title="Where the money is">
              <ul className="tl-fin-lines">
                <li><span className="tl-fin-line-icon" aria-hidden="true"><CreditCard /></span>Service fees collected<strong>{pkr(t.serviceFees)}</strong></li>
                <li><span className="tl-fin-line-icon" aria-hidden="true"><Landmark /></span>Tax collected <em>(owed to organizers)</em><strong>{pkr(t.taxCollected)}</strong></li>
                {Object.entries(data.payouts).map(([st, p]) => {
                  const Icon = PAYOUT_ICON[st] || Wallet;
                  return (
                    <li key={st}><span className="tl-fin-line-icon" aria-hidden="true"><Icon /></span>Payouts {st.replace(/_/g, ' ').toLowerCase()} <em>({p.count})</em><strong>{pkr(p.amount)}</strong></li>
                  );
                })}
              </ul>
              <Link to="/admin/payouts" className="tl-fin-more">Open payouts <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
            </Panel>
          </div>

          <div className="tl-fin-row tl-fin-row--even">
            <Panel icon={CreditCard} title="By payment method">
              {!data.byMethod.length ? <p className="tl-aov-empty">No payments in this period.</p> : (
                <ul className="tl-fin-rank">
                  {[...data.byMethod].sort((a, b) => b.amount - a.amount).map((m) => (
                    <li key={m.method}>
                      <div className="tl-fin-rank-top">
                        <strong>{METHOD_LABEL[m.method] || m.method}</strong>
                        <span>{m.orders.toLocaleString()} order{m.orders === 1 ? '' : 's'}</span>
                        <b>{pkr(m.amount)}</b>
                      </div>
                      <div className="tl-fin-share"><span style={{ width: `${pct(m.amount, methodTotal)}%` }} /></div>
                      <small>{Math.round(pct(m.amount, methodTotal))}% of payments</small>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel icon={Trophy} title="Top organizations">
              {!data.topOrganizations.length ? <p className="tl-aov-empty">No sales in this period.</p> : (
                <ol className="tl-fin-rank tl-fin-orgs">
                  {data.topOrganizations.map((o, i) => (
                    <li key={o.id}>
                      <div className="tl-fin-rank-top">
                        <span className={`tl-fin-medal is-${i + 1}`} aria-label={`Rank ${i + 1}`}>{i + 1}</span>
                        <strong><Building2 className="w-4 h-4" aria-hidden="true" /> {o.name}</strong>
                        <b>{pkr(o.amount)}</b>
                      </div>
                      <div className="tl-fin-share"><span style={{ width: `${pct(o.amount, orgTop)}%` }} /></div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
        </>
      )}

    </div>
  );
}
