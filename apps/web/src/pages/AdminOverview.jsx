import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { activeOrg } from '../lib/permissions';
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Clock,
  CreditCard,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Star,
  Ticket,
  TrendingUp,
  UserCog,
  Users,
  Zap,
} from 'lucide-react';
import { getEventVisual } from '../utils/eventMedia';
import { byDay, formatPkr } from '../components/dash/charts';

const DAY = 86400000;

const compact = (v) => {
  const n = Number(v) || 0;
  const trim = (x, d) => x.toFixed(d).replace(/\.0$/, '');
  if (Math.abs(n) >= 1e6) return `${trim(n / 1e6, 1)}M`;
  if (Math.abs(n) >= 1e3) return `${trim(n / 1e3, 1)}K`;
  return String(Math.round(n));
};
const pkr = (v) => `PKR ${compact(v)}`;

// Change between this window and the one before it; null when there is nothing to compare with
const change = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    setWidth(ref.current.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Smooth line through points (monotone-ish cardinal curve)
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i - 1] || pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] || pts[i + 1];
    const t = 0.18;
    d += ` C${x1 + (x2 - x0) * t},${y1 + (y2 - y0) * t} ${x2 - (x3 - x1) * t},${y2 - (y3 - y1) * t} ${x2},${y2}`;
  }
  return d;
}

/** Small trend line with a soft fill, for KPI cards and table rows. */
function Spark({ values, width = 120, height = 34 }) {
  const id = useId().replace(/:/g, '');
  const max = Math.max(...values, 0);
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * width,
    max > 0 ? height - 3 - (v / max) * (height - 8) : height - 3,
  ]);
  const line = smoothPath(pts);
  return (
    <svg className="tl-aov-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22e06b" stopOpacity="0.35" />
          <stop offset="1" stopColor="#22e06b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height}Z`} fill={`url(#sg${id})`} />
      <path d={line} fill="none" stroke="#22e06b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ value }) {
  if (value == null) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`tl-aov-delta${up ? '' : ' is-down'}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {Math.abs(value)}%
    </span>
  );
}

/** Stat card in the same design as the section pages (icon tile, label, figure), plus the 30-day change. */
function StatCard({ icon: Icon, label, value, delta, tone = 'green' }) {
  return (
    <section className={`tl-ts-card tl-ts-card--${tone}`}>
      <span className="tl-ts-icon" aria-hidden="true"><Icon className="w-6 h-6" /></span>
      <div>
        <h2>{label}</h2>
        <p>{value}</p>
        {delta != null && <span className="tl-aov-ts-delta"><Delta value={delta} /> vs last 30 days</span>}
      </div>
    </section>
  );
}

/** Area chart of daily paid volume, with gridlines, date ticks and a hover callout. */
function SalesChart({ data }) {
  const [ref, width] = useWidth();
  const id = useId().replace(/:/g, '');
  const height = 230;
  const pad = { l: 40, r: 14, t: 52, b: 28 };
  const max = Math.max(...data.map((d) => d.value), 0);
  const step = (() => {
    if (max <= 0) return 1;
    const raw = max / 3;
    const mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((s) => s >= raw);
  })();
  const top = step * 3;
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const x = (i) => pad.l + (i / Math.max(1, data.length - 1)) * w;
  const y = (v) => pad.t + h - (v / top) * h;
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const [hover, setHover] = useState(null);
  const at = hover ?? (max > 0 ? peak : null);
  const ticks = data.length <= 7 ? data.map((_, i) => i) : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (data.length - 1)));
  const line = smoothPath(pts);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.l) / Math.max(1, w)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div ref={ref} className="tl-aov-chart">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Paid sales per day, ${data[0]?.label} to ${data[data.length - 1]?.label}. Highest ${formatPkr(max)}.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`ag${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#22e06b" stopOpacity="0.45" />
              <stop offset="1" stopColor="#22e06b" stopOpacity="0" />
            </linearGradient>
            <filter id={`gl${id}`} x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {[0, 1, 2, 3].map((k) => (
            <g key={k}>
              <line x1={pad.l} x2={width - pad.r} y1={y(k * step)} y2={y(k * step)} className="tl-aov-grid" />
              <text x={pad.l - 10} y={y(k * step) + 4} textAnchor="end" className="tl-aov-axis">{compact(k * step)}</text>
            </g>
          ))}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="tl-aov-axis">{data[i]?.label}</text>
          ))}
          <path d={`${line} L${x(data.length - 1)},${pad.t + h} L${pad.l},${pad.t + h}Z`} fill={`url(#ag${id})`} />
          <path d={line} fill="none" stroke="#22e06b" strokeWidth="2.5" filter={`url(#gl${id})`} />
          {at != null && (
            <g>
              <line x1={x(at)} x2={x(at)} y1={y(data[at].value)} y2={pad.t + h} className="tl-aov-guide" />
              <circle cx={x(at)} cy={y(data[at].value)} r="6" fill="#eafff1" stroke="#22e06b" strokeWidth="3" />
              {(() => {
                const bw = 96;
                const bx = Math.min(Math.max(x(at) - bw / 2, pad.l), width - pad.r - bw);
                const by = Math.max(2, y(data[at].value) - 52);
                return (
                  <g className="tl-aov-callout">
                    <rect x={bx} y={by} width={bw} height={40} rx={8} />
                    <text x={bx + bw / 2} y={by + 17} textAnchor="middle" className="tl-aov-callout-v">{pkr(data[at].value)}</text>
                    <text x={bx + bw / 2} y={by + 32} textAnchor="middle" className="tl-aov-callout-d">{data[at].label}</text>
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/** Open ring (gap at the bottom) filled to `value` percent. */
function OpenRing({ value, size = 128, children }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * 0.8; // 288° of track
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="tl-aov-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(126deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#22e06b" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${Math.max(0.001, (arc * v) / 100)} ${c}`} className="tl-aov-ring-glow" />
      </svg>
      <div className="tl-aov-ring-mid">{children}</div>
    </div>
  );
}

/** Donut split into parts (each part's share of the total). */
function Donut({ parts, size = 128, children }) {
  const stroke = 13;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((n, p) => n + p.value, 0);
  const gap = total > 0 && parts.filter((p) => p.value > 0).length > 1 ? 4 : 0;
  let offset = 0;
  return (
    <div className="tl-aov-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        {total > 0 && parts.map((p) => {
          const len = (p.value / total) * c;
          const el = len > 0 && (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke}
              strokeDasharray={`${Math.max(0.001, len - gap)} ${c}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="tl-aov-ring-mid">{children}</div>
    </div>
  );
}

function CardHead({ icon: Icon, title, children }) {
  return (
    <div className="tl-aov-card-head">
      <h2 className="tl-aov-card-title"><Icon className="tl-aov-card-icon" aria-hidden="true" />{title}</h2>
      {children}
    </div>
  );
}

function PillLink({ to, onClick, children }) {
  const inner = <>{children} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></>;
  return to ? <Link to={to} className="tl-aov-pill">{inner}</Link> : <button type="button" className="tl-aov-pill" onClick={onClick}>{inner}</button>;
}

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

/**
 * Admin overview: welcome hero over a floodlit stadium, headline counts, paid sales over time, quick
 * actions, best-selling events, gate turnout, account mix and the next events. `orders` are paid orders
 * (newest first), `events` the platform's events; counts in the cards come from `metrics`.
 */
export default function AdminOverview({ user, metrics, loading, orders, events, openTab, tabs }) {
  const [range, setRange] = useState(30);
  const m = metrics || {};
  const show = (v) => (loading && !metrics ? '…' : (v ?? 0).toLocaleString());

  const [first, ...rest] = String(user?.name || 'Admin').trim().split(/\s+/);
  // Accounts named after the role ("Super Admin", "Admin") show the role badge in place of a name
  const roleOnlyName = !user?.name || /^(super[\s_-]*)?admin(istrator)?$/i.test(user.name.trim());
  const now = Date.now();

  const inWindow = (rows, dateOf, from, to) => rows.filter((r) => { const t = new Date(dateOf(r)).getTime(); return t > now - from * DAY && t <= now - to * DAY; });
  const ticketsOf = (o) => o.tickets?.length || 0;
  const sum = (rows, pick) => rows.reduce((n, r) => n + pick(r), 0);

  const kpis = useMemo(() => {
    const cur = inWindow(orders, (o) => o.createdAt, 30, 0);
    const prev = inWindow(orders, (o) => o.createdAt, 60, 30);
    const evCur = inWindow(events, (e) => e.createdAt, 30, 0).length;
    const evPrev = inWindow(events, (e) => e.createdAt, 60, 30).length;
    return {
      tickets: { delta: change(sum(cur, ticketsOf), sum(prev, ticketsOf)) },
      events: { delta: change(evCur, evPrev) },
      orders: { delta: change(cur.length, prev.length) },
      revenue: { delta: change(sum(cur, (o) => Number(o.totalAmount) || 0), sum(prev, (o) => Number(o.totalAmount) || 0)) },
    };
  }, [orders, events]);

  const sales = useMemo(() => {
    const data = byDay(orders, { days: range, dateOf: (o) => o.createdAt, pick: (o) => Number(o.totalAmount) || 0 });
    const total = data.reduce((n, b) => n + b.value, 0);
    const prev = sum(inWindow(orders, (o) => o.createdAt, range * 2, range), (o) => Number(o.totalAmount) || 0);
    return { data, total, delta: change(total, prev) };
  }, [orders, range]);

  // Best sellers, each with its ticket sales over the last 14 days
  const top = useMemo(() => {
    const byEvent = new Map();
    orders.forEach((o) => { const k = o.event?.id; if (k) byEvent.set(k, [...(byEvent.get(k) || []), o]); });
    return [...events]
      .sort((a, b) => b.soldTickets - a.soldTickets)
      .slice(0, 5)
      .map((ev) => ({ ev, spark: byDay(byEvent.get(ev.id) || [], { days: 14, dateOf: (o) => o.createdAt, pick: ticketsOf }).map((b) => b.value) }));
  }, [orders, events]);

  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return events
      .filter((e) => new Date(e.date) >= today && e.status !== 'CANCELLED' && e.status !== 'DRAFT')
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 4);
  }, [events]);

  const users = m.users || {};
  const restricted = (users.suspended || 0) + (users.banned || 0);
  const pendingUsers = Math.max(0, (users.total || 0) - (users.active || 0) - restricted);
  const accountParts = [
    { label: 'Active', value: users.active || 0, color: '#22e06b' },
    { label: 'Pending', value: pendingUsers, color: '#facc15' },
    { label: 'Suspended', value: restricted, color: '#9ca3af' },
  ];
  const canFinance = !user?.adminPermissions || user.adminPermissions.includes('admin.finance');

  const actions = [
    { icon: CalendarPlus, label: 'Create event', to: '/organizer/events/new' },
    { icon: ShoppingBag, label: 'View orders', onClick: () => openTab('transactions') },
    canFinance && { icon: BarChart3, label: 'Check analytics', to: '/admin/finance' },
    { icon: UserCog, label: 'Manage accounts', onClick: () => openTab('users') },
  ].filter(Boolean);

  const dateTime = (d) => {
    const x = new Date(d);
    return `${x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} • ${x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <div className="tl-aov tl-aov-sec">
      <header className="tl-aov-hero">
        <div className="tl-aov-hero-copy">
          <p className="tl-aov-hello">Welcome back,</p>
          {roleOnlyName ? (
            <h1 className="tl-aov-name tl-aov-name--badge"><RoleBadge large /></h1>
          ) : (
            <>
              <h1 className="tl-aov-name">
                {rest.length ? <>{first} <span>{rest.join(' ')}</span></> : <span>{first}</span>}
              </h1>
              <RoleBadge />
            </>
          )}
          <p className="tl-aov-sub">Here's what's happening on TicketLedger today.</p>
          <span className="tl-aov-rule" aria-hidden="true" />
        </div>
      </header>

      {tabs && <SectionTabs tabs={tabs} value="overview" onChange={openTab} />}

      <div className="tl-ts">
        <StatCard icon={Ticket} tone="green" label="Total tickets sold" value={show(m.ticketing?.totalTickets)} delta={kpis.tickets.delta} />
        <StatCard icon={CalendarDays} tone="blue" label="Total events" value={show(m.events?.total)} delta={kpis.events.delta} />
        <StatCard icon={ShoppingBag} tone="amber" label="Total orders" value={show(m.ticketing?.successfulOrders)} delta={kpis.orders.delta} />
        <StatCard icon={CreditCard} tone="green" label="Total revenue" value={loading && !metrics ? '…' : pkr(m.financials?.grossRevenuePkr)} delta={kpis.revenue.delta} />
      </div>

      <div className="tl-aov-row tl-aov-row--sales">
        <section className="tl-aov-card tl-aov-sales">
          <CardHead icon={BarChart3} title="Sales overview">
            <label className="tl-aov-select">
              <span className="sr-only">Period</span>
              <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
                {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
              </select>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </label>
          </CardHead>
          <p className="tl-aov-sales-total"><span>PKR</span> {compact(sales.total)}</p>
          <p className="tl-aov-sales-cmp">
            {sales.delta == null ? 'No sales in the previous period to compare' : (
              <><Delta value={sales.delta} /> vs previous {range} days</>
            )}
          </p>
          <SalesChart data={sales.data} />
        </section>

        <section className="tl-aov-card tl-aov-actions">
          <CardHead icon={Zap} title="Quick actions" />
          <ul>
            {actions.map(({ icon: Icon, label, to, onClick }) => {
              const inner = <><Icon className="tl-aov-action-icon" aria-hidden="true" /><span>{label}</span><ArrowRight className="w-4 h-4" aria-hidden="true" /></>;
              return (
                <li key={label}>
                  {to ? <Link to={to} className="tl-aov-action">{inner}</Link> : <button type="button" className="tl-aov-action" onClick={onClick}>{inner}</button>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="tl-aov-row tl-aov-row--top">
        <section className="tl-aov-card tl-aov-top">
          <CardHead icon={Star} title="Top events">
            <PillLink onClick={() => openTab('events')}>View all</PillLink>
          </CardHead>
          {top.length === 0 ? <p className="tl-aov-empty">No events yet.</p> : (
            <ol className="tl-aov-top-list">
              {top.map(({ ev, spark }, i) => (
                <li key={ev.id}>
                  <Link to={`/events/${ev.id}`} className="tl-aov-top-row">
                    <span className="tl-aov-top-rank">{i + 1}</span>
                    <img className="tl-aov-top-thumb" src={getEventVisual(ev, i).image} alt="" loading="lazy" onError={(e) => e.currentTarget.classList.add('is-broken')} />
                    <span className="tl-aov-top-name">
                      <strong>{ev.name}</strong>
                      <span>{new Date(ev.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} • {ev.city}</span>
                    </span>
                    <span className="tl-aov-top-sold">{compact(ev.soldTickets)} sold</span>
                    <Spark values={spark} width={100} height={30} />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="tl-aov-stack">
          <section className="tl-aov-card tl-aov-turn">
            <CardHead icon={TrendingUp} title="Ticket turnout">
              <span className="tl-aov-tag">All time</span>
            </CardHead>
            <div className="tl-aov-turn-body">
              <OpenRing value={m.ticketing?.turnoutRate || 0}>
                <strong>{m.ticketing?.turnoutRate ?? 0}%</strong>
                <span>Scanned</span>
              </OpenRing>
              <div className="tl-aov-turn-figure">
                <strong>{show(m.ticketing?.scannedTickets)}</strong>
                <span>Tickets scanned of {show(m.ticketing?.totalTickets)} sold</span>
              </div>
            </div>
          </section>

          <section className="tl-aov-card tl-aov-acc">
            <CardHead icon={Users} title="Accounts">
              <PillLink onClick={() => openTab('users')}>View all</PillLink>
            </CardHead>
            <div className="tl-aov-acc-body">
              <Donut parts={accountParts}>
                <strong>{show(users.total)}</strong>
                <span>Total accounts</span>
              </Donut>
              <ul className="tl-aov-legend">
                {accountParts.map((p) => (
                  <li key={p.label}>
                    <span className="tl-aov-dot" style={{ background: p.color }} aria-hidden="true" />
                    {p.label}
                    <strong>{p.value.toLocaleString()}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>

      <section className="tl-aov-card tl-aov-up">
        <CardHead icon={CalendarDays} title="Upcoming events">
          <PillLink to="/events">View calendar</PillLink>
        </CardHead>
        {upcoming.length === 0 ? <p className="tl-aov-empty">No upcoming events.</p> : (
          <div className="tl-aov-up-grid">
            {upcoming.map((ev, i) => (
              <Link key={ev.id} to={`/events/${ev.id}`} className="tl-aov-up-card">
                <img src={getEventVisual(ev, i).image} alt="" loading="lazy" onError={(e) => e.currentTarget.classList.add('is-broken')} />
                <div className="tl-aov-up-copy">
                  <h3>{ev.name}</h3>
                  <p><Clock className="w-3.5 h-3.5" aria-hidden="true" /> {dateTime(ev.date)}</p>
                  <p><MapPin className="w-3.5 h-3.5" aria-hidden="true" /> {ev.city}</p>
                  <span className="tl-aov-up-flag">{ev.status === 'PUBLISHED' ? 'On sale' : 'Upcoming'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}

/** Slim footer of the admin pages. */
export function AovFooter() {
  return (
    <footer className="tl-aov-foot">
      <p>© {new Date().getFullYear()} TicketLedger. Made for fans in Pakistan.</p>
      <nav aria-label="Legal">
        <Link to="/terms">Terms of Service</Link>
        <Link to="/privacy">Privacy Policy</Link>
      </nav>
    </footer>
  );
}

/** The Super Admin role badge. */
export function RoleBadge({ large = false }) {
  const { user } = useAuth();
  // The console's role: super admins, organizers (and their team members with studio access), or gate staff
  const org = activeOrg(user);
  const label = user?.role === 'SUPER_ADMIN'
    ? 'Super Admin'
    : user?.role === 'ORGANIZER' || org?.permissions?.includes('event.view') || org?.permissions?.includes('staff.view') ? 'Organizer' : 'Gate Staff';
  return (
    <span className={`tl-aov-role${large ? ' tl-aov-role--lg' : ''}`}>
      <ShieldCheck className={large ? 'tl-aov-role-icon' : 'w-4 h-4'} aria-hidden="true" /> {label}
    </span>
  );
}

/** Stadium header of the admin console pages: role badge, white title, intro, and an optional right side. */
export function PageHero({ icon: Icon, title, intro, aside }) {
  // Same title as the dashboard sections: icon tile, first word white, the rest green (one word: all green)
  const text = typeof title === 'string' ? title : null;
  const [first, ...rest] = String(text || '').split(' ');
  return (
    <header className="tl-apv-hero">
      <div className="tl-apv-hero-bg" aria-hidden="true" />
      <div className="tl-apv-hero-copy">
        <RoleBadge />
        <h1 className="tl-aov-sectitle">
          {Icon && <span className="tl-aov-sectile" aria-hidden="true"><Icon /></span>}
          <span>{text == null ? <em>{title}</em> : rest.length ? <>{first} <em>{rest.join(' ')}</em></> : <em>{first}</em>}</span>
        </h1>
        {intro && <p>{intro}</p>}
      </div>
      {aside}
    </header>
  );
}

/** Pill tabs for every section of the admin dashboard. */
export function SectionTabs({ tabs, value, onChange, label = 'Dashboard sections' }) {
  return (
    <nav className="tl-aov-tabs" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" className={`tl-aov-tab${t.value === value ? ' is-active' : ''}`} aria-current={t.value === value ? 'page' : undefined} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon className="w-4 h-4" aria-hidden="true" />}
          {t.label}
          {t.count > 0 && <b className="tl-aov-tab-count">{t.count}</b>}
        </button>
      ))}
    </nav>
  );
}

/**
 * Heading of an admin section (Users, Events, ...): role badge, icon tile and two-tone title, a short intro and
 * actions on the right, then pill tabs for every section of the dashboard.
 */
export function SectionHead({ icon: Icon, title, intro, actions, tabs, value, onChange }) {
  const [first, ...rest] = String(title).split(' ');
  return (
    <header className="tl-aov-sechead">
      <div className="tl-aov-sechead-row">
        <div className="tl-aov-sechead-copy">
          <RoleBadge />
          <h1 className="tl-aov-sectitle">
            {Icon && <span className="tl-aov-sectile" aria-hidden="true"><Icon /></span>}
            <span>{rest.length ? <>{first} <em>{rest.join(' ')}</em></> : <em>{first}</em>}</span>
          </h1>
          {intro && <p className="tl-aov-sub">{intro}</p>}
        </div>
        {actions && <div className="tl-aov-sechead-actions">{actions}</div>}
      </div>
      {tabs && <SectionTabs tabs={tabs} value={value} onChange={onChange} />}
    </header>
  );
}
