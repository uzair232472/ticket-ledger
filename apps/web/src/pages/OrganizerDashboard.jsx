import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { connectSocket } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { insightPath } from '../lib/insightPaths';
import { can } from '../lib/permissions';
import { DashHead, Notice } from '../components/dash/DashShell';
import { formatPkr } from '../components/dash/charts';
import Pager, { PAGE_SIZE } from '../components/dash/Pager';
import { getEventVisual } from '../utils/eventMedia';
import api from '../utils/api';
import { formatPromoDay, isPromotionActive } from '../utils/promotion';
import { useDialog } from '../components/ui/DialogProvider';
import '../components/dash/organizer-overview.css';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Armchair,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  ClipboardCheck,
  Info,
  List,
  Megaphone,
  MessageSquareWarning,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  Settings2,
  ShieldAlert,
  Ticket,
  Trash2,
  Trophy,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const DAY = 86400000;
// An event without an end time counts as running for this long after it starts
const DEFAULT_LENGTH = 6 * 3600000;

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

const compact = (v) => {
  const n = Number(v) || 0;
  const trim = (x, d) => x.toFixed(d).replace(/\.0$/, '');
  if (Math.abs(n) >= 1e6) return `${trim(n / 1e6, 2).replace(/0$/, '')}M`;
  if (Math.abs(n) >= 1e3) return `${trim(n / 1e3, 1)}K`;
  return String(Math.round(n));
};
const change = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const dateTime = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} • ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};
// Many venues already include the city ("Gaddafi Stadium, Ferozepur Road, Lahore")
const place = (venue = '', city = '') => (city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue || city);
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Where an event is in time: upcoming (not started), live (running now) or past (ended, completed or cancelled). */
function phaseOf(event, now = Date.now()) {
  if (event.status === 'CANCELLED' || event.status === 'COMPLETED') return 'past';
  const start = new Date(event.date).getTime();
  const end = event.endsAt ? new Date(event.endsAt).getTime() : start + DEFAULT_LENGTH;
  if (end < now) return 'past';
  if (start <= now) return 'live';
  return 'upcoming';
}

const STATUS_BADGE = {
  DRAFT: ['Draft', 'warn'],
  PRELAUNCH_ANALYSIS: ['Pre-launch', 'warn'],
  PENDING_APPROVAL: ['Awaiting approval', 'warn'],
  REJECTED: ['Rejected', 'bad'],
  PAUSED: ['Paused', 'warn'],
  CANCELLED: ['Cancelled', 'neutral'],
};
const PHASE_BADGE = { upcoming: ['Upcoming', 'good'], live: ['Live', 'info'], past: ['Past', 'neutral'] };
/** Status pill: review states first (a reply needed, a reserved date in review), then where the event is in time. */
function eventBadge(event, phase) {
  if (event.postponedAt) return ['Postponed', 'warn'];
  if (event.status === 'PENDING_APPROVAL' && event.reviewRequest === 'CHANGES_REQUESTED') return ['Reply needed', 'warn'];
  if (event.prebookDraftId && event.reservedAt && ['PUBLISHED', 'PAUSED'].includes(event.status)) {
    if (event.launchStatus === 'CHANGES_REQUESTED') return ['Reserved · reply needed', 'warn'];
    if (event.launchStatus === 'PENDING') return ['Reserved · in review', 'warn'];
    if (event.launchStatus !== 'APPROVED') return ['Reserved · setup needed', 'warn'];
  }
  if (event.status === 'PUBLISHED' && event.isHidden) return ['Hidden', 'warn'];
  if (STATUS_BADGE[event.status]) return STATUS_BADGE[event.status];
  return PHASE_BADGE[phase];
}
// Needs the Review page: not on sale yet, a question to answer, or a reserved date still to be approved
const needsReview = (event) =>
  !['PUBLISHED', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(event.status) || (event.prebookDraftId && event.reservedAt && event.launchStatus !== 'APPROVED');
const replyNeeded = (event) => event.reviewRequest === 'CHANGES_REQUESTED' || event.launchStatus === 'CHANGES_REQUESTED';

// Per-event totals from the all-events tier breakdown (the API reports tiers with their event name)
function totalsByEvent(tiers) {
  const map = new Map();
  tiers.forEach((t) => {
    const e = map.get(t.eventName) || { sold: 0, capacity: 0, revenue: 0 };
    e.sold += t.soldQuantity;
    e.capacity += t.totalQuantity;
    e.revenue += t.tierRevenuePkr || 0;
    map.set(t.eventName, e);
  });
  return map;
}

/** One bucket per day for the last `days` days (oldest first), filled from the API's sales-by-date rows. */
function dailySales(salesGraph, days, endOffset = 0) {
  const byDate = new Map(salesGraph.map((d) => [d.date, d]));
  const out = [];
  for (let i = days - 1 + endOffset; i >= endOffset; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const row = byDate.get(localKey(d));
    out.push({
      key: localKey(d),
      label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      tickets: row?.ticketsSold || 0,
      revenue: row?.revenuePkr || 0,
      orders: row?.ordersCount || 0,
    });
  }
  return out;
}

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

// Smooth line through points
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

// Round axis step so the top line is a tidy number
const niceStep = (max, lines) => {
  if (max <= 0) return 1;
  const raw = max / lines;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((s) => s >= raw);
};

/** Small trend line with a soft fill, for the KPI cards. */
function Spark({ values, width = 120, height = 36 }) {
  const id = useId().replace(/:/g, '');
  const max = Math.max(...values, 0);
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * width,
    max > 0 ? height - 3 - (v / max) * (height - 8) : height - 3,
  ]);
  const line = smoothPath(pts);
  return (
    <svg className="tl-oev-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={`os${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22e06b" stopOpacity="0.35" />
          <stop offset="1" stopColor="#22e06b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height}Z`} fill={`url(#os${id})`} />
      <path d={line} fill="none" stroke="#22e06b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ value, suffix = '%' }) {
  if (value == null) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`tl-oev-delta${up ? '' : ' is-down'}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {suffix === '%' ? `${Math.abs(value)}%` : `${up ? '+' : '−'}${Math.abs(value)}`}
    </span>
  );
}

/** Headline figure: round icon, label, value with its change over the selected period, a trend line. */
function KpiCard({ icon: Icon, label, value, delta, deltaKind = '%', note, spark }) {
  return (
    <section className="tl-oev-kpi">
      <span className="tl-oev-kpi-icon" aria-hidden="true"><Icon /></span>
      <div className="tl-oev-kpi-copy">
        <h2>{label}</h2>
        <p className="tl-oev-kpi-value">{value}<Delta value={delta} suffix={deltaKind} /></p>
        {note && <p className="tl-oev-kpi-note">{note}</p>}
      </div>
      {spark && <Spark values={spark} />}
    </section>
  );
}

function CardHead({ icon: Icon, title, children }) {
  return (
    <div className="tl-oev-card-head">
      <h2 className="tl-oev-card-title"><Icon className="tl-oev-card-icon" aria-hidden="true" />{title}</h2>
      {children}
    </div>
  );
}

const SERIES_COLORS = { tickets: '#22e06b', revenue: '#38bdf8' };

/**
 * Tickets sold and revenue per day on one chart: tickets on the left axis, revenue on the right, so both
 * lines use the full height. Hover (or touch) shows both values for the day.
 */
function OverviewChart({ data, showRevenue }) {
  const [ref, width] = useWidth();
  const id = useId().replace(/:/g, '');
  const height = width < 560 ? 250 : 320;
  const pad = { l: 44, r: showRevenue ? 64 : 16, t: 48, b: 32 };
  const lines = 4;
  const tStep = niceStep(Math.max(...data.map((d) => d.tickets), 0), lines);
  const rStep = niceStep(Math.max(...data.map((d) => d.revenue), 0), lines);
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const x = (i) => pad.l + (i / Math.max(1, data.length - 1)) * w;
  const yT = (v) => pad.t + h - (v / (tStep * lines)) * h;
  const yR = (v) => pad.t + h - (v / (rStep * lines)) * h;
  const series = [
    { key: 'tickets', label: 'Tickets sold', color: SERIES_COLORS.tickets, y: yT },
    ...(showRevenue ? [{ key: 'revenue', label: 'Revenue', color: SERIES_COLORS.revenue, y: yR }] : []),
  ];
  const peak = data.reduce((best, d, i) => (d.tickets > (data[best]?.tickets ?? -1) ? i : best), 0);
  const hasData = data.some((d) => d.tickets > 0 || d.revenue > 0);
  const [hover, setHover] = useState(null);
  const at = hover ?? (hasData ? peak : null);
  const tickCount = width < 560 ? 4 : 6;
  const ticks = data.length <= tickCount ? data.map((_, i) => i) : Array.from({ length: tickCount }, (_, k) => Math.round((k / (tickCount - 1)) * (data.length - 1)));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - pad.l) / Math.max(1, w)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  const totalTickets = data.reduce((n, d) => n + d.tickets, 0);
  const totalRevenue = data.reduce((n, d) => n + d.revenue, 0);

  return (
    <>
      <div ref={ref} className="tl-oev-chart">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Tickets sold${showRevenue ? ' and revenue' : ''} per day, ${data[0]?.label} to ${data[data.length - 1]?.label}: ${totalTickets.toLocaleString()} tickets${showRevenue ? `, ${formatPkr(totalRevenue)}` : ''}.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`og${s.key}${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity={s.key === 'tickets' ? 0.32 : 0.18} />
                  <stop offset="1" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
              <filter id={`ogl${id}`} x="-20%" y="-50%" width="140%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {Array.from({ length: lines + 1 }, (_, k) => (
              <g key={k}>
                <line x1={pad.l} x2={width - pad.r} y1={yT(k * tStep)} y2={yT(k * tStep)} className="tl-oev-grid" />
                <text x={pad.l - 10} y={yT(k * tStep) + 4} textAnchor="end" className="tl-oev-axis">{compact(k * tStep)}</text>
                {showRevenue && <text x={width - pad.r + 10} y={yR(k * rStep) + 4} textAnchor="start" className="tl-oev-axis">{compact(k * rStep)}</text>}
              </g>
            ))}
            {ticks.map((i) => (
              <line key={`v${i}`} x1={x(i)} x2={x(i)} y1={pad.t} y2={pad.t + h} className="tl-oev-grid tl-oev-grid--v" />
            ))}
            {ticks.map((i) => (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="tl-oev-axis">{data[i]?.label}</text>
            ))}
            {showRevenue && <text x={width - 4} y={pad.t - 16} textAnchor="end" className="tl-oev-axis tl-oev-axis--unit">PKR</text>}
            <text x={4} y={pad.t - 16} textAnchor="start" className="tl-oev-axis tl-oev-axis--unit">Tickets</text>
            {[...series].reverse().map((s) => {
              const pts = data.map((d, i) => [x(i), s.y(d[s.key])]);
              const line = smoothPath(pts);
              return (
                <g key={s.key}>
                  <path d={`${line} L${x(data.length - 1)},${pad.t + h} L${pad.l},${pad.t + h}Z`} fill={`url(#og${s.key}${id})`} />
                  <path d={line} fill="none" stroke={s.color} strokeWidth="2.5" filter={`url(#ogl${id})`} />
                </g>
              );
            })}
            {at != null && (
              <g>
                <line x1={x(at)} x2={x(at)} y1={pad.t - 6} y2={pad.t + h} className="tl-oev-guide" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(at)} cy={s.y(data[at][s.key])} r="5.5" fill="#eafff1" stroke={s.color} strokeWidth="3" />
                ))}
                {(() => {
                  const bw = showRevenue ? 150 : 120;
                  const bh = showRevenue ? 58 : 42;
                  const bx = Math.min(Math.max(x(at) - bw / 2, pad.l), width - pad.r - bw);
                  const top = Math.min(...series.map((s) => s.y(data[at][s.key])));
                  const by = Math.max(2, top - bh - 12);
                  return (
                    <g className="tl-oev-callout">
                      <rect x={bx} y={by} width={bw} height={bh} rx={10} />
                      <text x={bx + 12} y={by + 18} className="tl-oev-callout-v">{data[at].tickets.toLocaleString()} tickets</text>
                      {showRevenue && <text x={bx + 12} y={by + 34} className="tl-oev-callout-r">PKR {Math.round(data[at].revenue).toLocaleString()}</text>}
                      <text x={bx + 12} y={by + (showRevenue ? 50 : 34)} className="tl-oev-callout-d">{data[at].label}</text>
                    </g>
                  );
                })()}
              </g>
            )}
          </svg>
        )}
      </div>
      <ul className="tl-oev-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className="tl-oev-dot" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
            <strong>{s.key === 'tickets' ? totalTickets.toLocaleString() : formatPkr(totalRevenue)}</strong>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Full ring filled to `value` percent, with a glow. */
function PercentRing({ value, size = 132, children }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="tl-oev-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#22e06b" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${Math.max(0.001, (c * v) / 100)} ${c}`} className="tl-oev-ring-glow" />
      </svg>
      <div className="tl-oev-ring-mid">{children}</div>
    </div>
  );
}

/** Donut split into parts (each part's share of the total). */
function Donut({ parts, size = 128 }) {
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((n, p) => n + p.value, 0);
  let offset = 0;
  return (
    <div className="tl-oev-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        {total > 0 && parts.map((p) => {
          const len = (p.value / total) * c;
          const el = len > 0 && (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} strokeDasharray={`${len} ${c}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="tl-oev-ring-mid"><strong>{total}</strong><span>events</span></div>
    </div>
  );
}

/**
 * Row actions menu (the ⋮ button). Opens in a fixed layer under the button so the table's scroll box can't
 * clip it; closes on a choice, Escape, a click outside, scrolling or resizing.
 */
function RowMenu({ label, items }) {
  const [rect, setRect] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  useEffect(() => {
    if (!rect) return undefined;
    const close = () => setRect(null);
    const onDown = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); btn.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    requestAnimationFrame(() => menu.current?.querySelector('a, button')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [rect]);
  const onMenuKey = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const els = [...menu.current.querySelectorAll('a, button')];
    const i = els.indexOf(document.activeElement);
    els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
  };
  const width = 210;
  const style = rect && {
    top: rect.bottom + 6 + 320 > window.innerHeight ? undefined : rect.bottom + 6,
    bottom: rect.bottom + 6 + 320 > window.innerHeight ? window.innerHeight - rect.top + 6 : undefined,
    left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    width,
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="tl-oev-kebab"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(rect)}
        onClick={() => setRect((r) => (r ? null : btn.current.getBoundingClientRect()))}
      >
        <MoreVertical className="w-4 h-4" aria-hidden="true" />
      </button>
      {rect && createPortal(
        <div ref={menu} role="menu" aria-label={label} className="tl-oev-menu" style={style} onKeyDown={onMenuKey}>
          {items.filter(Boolean).map(({ icon: Icon, label: text, to, onClick, tone, title }) => {
            const inner = <><Icon className="w-4 h-4" aria-hidden="true" />{text}</>;
            const cls = `tl-oev-menu-item${tone ? ` is-${tone}` : ''}`;
            return to ? (
              <Link key={text} role="menuitem" to={to} className={cls} title={title} onClick={() => setRect(null)}>{inner}</Link>
            ) : (
              <button key={text} role="menuitem" type="button" className={cls} title={title} onClick={() => { setRect(null); onClick(); }}>{inner}</button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function OrganizerDashboard() {
  const dialog = useDialog();
  // Delete an event: ask first, then report the outcome in the app's dialog
  const deleteEvent = async (ev, after) => {
    const ok = await dialog.confirm({
      tone: 'error',
      title: `Delete “${ev.name}”?`,
      message: 'This permanently removes the event, its tickets setup, seating plan and images. It can’t be undone.\nEvents with sold tickets can’t be deleted; cancel them instead.',
      confirmLabel: 'Delete event',
      cancelLabel: 'Keep event',
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/events/${ev.id}`);
      await dialog.alert({ tone: 'success', title: 'Event deleted', message: res.data.message });
      after?.();
    } catch (err) {
      dialog.alert({ tone: 'error', title: 'Couldn’t delete the event', message: err.response?.data?.message || 'Please try again.' });
    }
  };

  const { user, token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedEventId, setSelectedEventId] = useState(searchParams.get('eventId') || 'ALL');
  const [dashboardData, setDashboardData] = useState(null);
  const [allTiers, setAllTiers] = useState(null); // tier breakdown for every event (per-event row totals)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [range, setRange] = useState(30);
  const [eventView, setEventView] = useState('active'); // active (upcoming + live) | all | past
  const [eventSort, setEventSort] = useState('newest'); // newest (recently created) | date (soonest first)
  const [query, setQuery] = useState('');
  const [rowPage, setRowPage] = useState(0);
  const [tierPage, setTierPage] = useState(0);
  const tableRef = useRef(null);

  const load = async (eventId) => {
    const params = new URLSearchParams();
    if (eventId && eventId !== 'ALL') params.append('eventId', eventId);
    const res = await fetch(`${API_URL}/api/organizer/organizer-dashboard?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || 'Failed to load organizer dashboard');
    return json.data;
  };

  const fetchDashboard = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await load(selectedEventId);
      setDashboardData(data);
      if (selectedEventId === 'ALL') setAllTiers(data.tierBreakdown || []);
      else if (!allTiers) load('ALL').then((all) => setAllTiers(all.tierBreakdown || [])).catch(() => {});
    } catch (err) {
      setError(err.message || 'Network error fetching dashboard metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (token) fetchDashboard();
  }, [selectedEventId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live entry counter: each admission at a gate refreshes the turnout figures (quietly, at most every 2 s)
  const liveRef = useRef({ eventId: selectedEventId, timer: null });
  liveRef.current.eventId = selectedEventId;
  useEffect(() => {
    if (!user?.id) return undefined;
    const socket = connectSocket();
    socket.on('connect', () => socket.emit('join_user_room', user.id));
    socket.on('checkin:stats', (stats) => {
      const scope = liveRef.current.eventId;
      if (scope !== 'ALL' && scope !== stats.eventId) return;
      clearTimeout(liveRef.current.timer);
      liveRef.current.timer = setTimeout(() => {
        load(liveRef.current.eventId).then(setDashboardData).catch(() => {});
      }, 2000);
    });
    return () => {
      clearTimeout(liveRef.current.timer);
      socket.disconnect();
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Members without finance.view get no money figures from the API; their figures are hidden
  const finance = dashboardData?.access?.finance !== false;
  const metrics = dashboardData?.metrics || {};
  const liveGate = dashboardData?.liveGatePacing || {};
  const attendance = dashboardData?.attendancePrediction || {};
  const tierBreakdown = dashboardData?.tierBreakdown || [];
  const salesGraph = dashboardData?.salesGraph || [];
  const fraudFeed = dashboardData?.fraudFeed || [];
  const events = dashboardData?.events || [];
  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const eventQuery = selectedEventId !== 'ALL' ? `?eventId=${selectedEventId}` : '';

  const phases = useMemo(() => {
    const now = Date.now();
    return new Map(events.map((e) => [e.id, phaseOf(e, now)]));
  }, [events]);
  const statusParts = useMemo(() => {
    const count = (p) => events.filter((e) => phases.get(e.id) === p).length;
    return [
      { label: 'Upcoming', value: count('upcoming'), color: '#22e06b' },
      { label: 'Live', value: count('live'), color: '#38bdf8' },
      { label: 'Past', value: count('past'), color: '#94a3b8' },
    ];
  }, [events, phases]);

  // Daily figures for the selected period and the one before it (for the changes on the cards)
  const days = useMemo(() => dailySales(salesGraph, range), [salesGraph, range]);
  const prevDays = useMemo(() => dailySales(salesGraph, range, range), [salesGraph, range]);
  const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
  const kpi = useMemo(() => {
    const since = Date.now() - range * DAY;
    const created = events.filter((e) => new Date(e.createdAt).getTime() > since).length;
    // Events count over the period, day by day (for the trend line)
    const eventsLine = days.map((_, i) => {
      const end = Date.now() - (days.length - 1 - i) * DAY;
      return events.filter((e) => new Date(e.createdAt).getTime() <= end).length;
    });
    return {
      created,
      eventsLine,
      tickets: change(sum(days, 'tickets'), sum(prevDays, 'tickets')),
      revenue: change(sum(days, 'revenue'), sum(prevDays, 'revenue')),
      orders: change(sum(days, 'orders'), sum(prevDays, 'orders')),
    };
  }, [events, days, prevDays, range]);

  const eventTotals = useMemo(() => totalsByEvent(allTiers || []), [allTiers]);
  // Upcoming and live events by default, past ones on request. Newest created first, so an event you've
  // just created is at the top; or by event date (upcoming soonest first, past latest first).
  const listedEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (e) => !q || [e.name, e.venue, e.city].some((s) => s?.toLowerCase().includes(q));
    const newest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    const active = events.filter((e) => phases.get(e.id) !== 'past' && matches(e)).sort(eventSort === 'newest' ? newest : (a, b) => new Date(a.date) - new Date(b.date));
    const past = events.filter((e) => phases.get(e.id) === 'past' && matches(e)).sort(eventSort === 'newest' ? newest : (a, b) => new Date(b.date) - new Date(a.date));
    if (eventView === 'past') return past;
    if (eventView === 'all') return eventSort === 'newest' ? [...active, ...past].sort(newest) : [...active, ...past];
    return active;
  }, [events, phases, eventView, eventSort, query]);
  // Back to the first page whenever the list changes shape (search, filter, sort, another event's stats)
  useEffect(() => { setRowPage(0); }, [query, eventView, eventSort]);
  useEffect(() => { setTierPage(0); }, [selectedEventId]);
  // Stay on a page that still exists after a delete or refresh
  const rowPageNow = Math.min(rowPage, Math.max(0, Math.ceil(listedEvents.length / PAGE_SIZE) - 1));
  const shownRows = listedEvents.slice(rowPageNow * PAGE_SIZE, (rowPageNow + 1) * PAGE_SIZE);
  // Best-selling tiers first
  const sortedTiers = useMemo(
    () => [...tierBreakdown].sort((a, b) => b.tierRevenuePkr - a.tierRevenuePkr || b.soldQuantity - a.soldQuantity || b.price - a.price),
    [tierBreakdown]
  );
  const tierPageNow = Math.min(tierPage, Math.max(0, Math.ceil(sortedTiers.length / PAGE_SIZE) - 1));
  const shownTiers = sortedTiers.slice(tierPageNow * PAGE_SIZE, (tierPageNow + 1) * PAGE_SIZE);

  const activeCount = statusParts[0].value + statusParts[1].value;
  const occupancy = metrics.totalCapacity > 0 ? Math.round((metrics.totalTicketsSold / metrics.totalCapacity) * 100) : 0;
  const highRisk = fraudFeed.filter((f) => f.fraudScore >= 75).length;
  const rangeLabel = RANGES.find((r) => r.days === range)?.label.toLowerCase();

  const changeEvent = (id) => {
    setSelectedEventId(id);
    setSearchParams(id !== 'ALL' ? { eventId: id } : {});
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const quickActions = [
    can(user, 'gate.scan') && { icon: ScanLine, label: 'Open scanner', to: '/scanner', primary: true },
    { icon: CalendarCheck, label: 'Manage events', onClick: () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    can(user, 'event.pricing') && { icon: BarChart3, label: 'View reports', to: `${insightPath(user?.role, 'demand')}${eventQuery}` },
    can(user, 'attendee.view') && { icon: Activity, label: 'Purchase intent', to: `${insightPath(user?.role, 'intent')}${eventQuery}` },
    can(user, ['finance.view', 'event.edit']) && { icon: Settings, label: 'Event settings', to: '/organizer/checkout-settings' },
  ].filter(Boolean).slice(0, 4);

  const rowActions = (ev) => {
    const promoPending = ev.priorityStatus === 'REQUESTED' || ev.heroStatus === 'REQUESTED';
    return [
      needsReview(ev) && {
        icon: replyNeeded(ev) ? MessageSquareWarning : ClipboardCheck,
        label: replyNeeded(ev) ? 'Reply to review' : ev.status === 'PENDING_APPROVAL' || ev.launchStatus === 'PENDING' ? 'Review status' : 'Review & send',
        to: `/organizer/events/${ev.id}/submit`,
      },
      { icon: BarChart3, label: ev.id === selectedEventId ? 'Hide stats' : 'Show stats', onClick: () => changeEvent(ev.id === selectedEventId ? 'ALL' : ev.id) },
      { icon: Pencil, label: 'Edit', to: `/organizer/events/${ev.id}/edit` },
      { icon: Settings2, label: 'Tools', to: `/organizer/events/${ev.id}/manage`, title: 'Settings, sale phases, duplicate, more dates, announcements, staff, history, report' },
      { icon: Armchair, label: 'Seating', to: `/organizer/events/${ev.id}/venue` },
      !['CANCELLED', 'COMPLETED'].includes(ev.status) && { icon: Megaphone, label: promoPending ? 'Promo pending' : 'Promote', to: `/organizer/events/${ev.id}/submit#promote`, title: 'Ask for top of listings or the home page hero banner' },
      // Live events are moved (with admin approval) or cancelled with refunds here
      ['PUBLISHED', 'PAUSED'].includes(ev.status) && { icon: CalendarClock, label: 'Date / cancel', to: `/organizer/events/${ev.id}/changes` },
      { icon: Trash2, label: 'Delete', tone: 'danger', onClick: () => deleteEvent(ev, fetchDashboard) },
    ];
  };

  const show = (v) => (loading ? '…' : v);

  return (
    <div className="tl-oev">
      <DashHead
        title={selectedEvent ? 'Event stats' : 'Your events'}
        note={
          selectedEvent
            ? `${selectedEvent.name}. Sales, gate check-ins and attendance for this event only.`
            : 'Monitor performance, manage your events and track real-time activity.'
        }
        actions={(
          <>
            {selectedEvent && (
              <button type="button" className="tl-aov-pill tl-oev-back" onClick={() => changeEvent('ALL')}>
                <X className="w-3.5 h-3.5" aria-hidden="true" /> All events
              </button>
            )}
            <label className="tl-aov-select tl-oev-range">
              <CalendarDays className="w-4 h-4 tl-oev-range-icon" aria-hidden="true" />
              <span className="sr-only">Period</span>
              <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
                {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
              </select>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </label>
            <button type="button" className="tl-aov-iconbtn" onClick={fetchDashboard} disabled={refreshing} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'tl-dash-spin' : ''}`} aria-hidden="true" />
            </button>
            {can(user, 'event.create') && (
              <Link to="/organizer/events/new" className="tl-aov-cta">
                <Plus className="w-4 h-4" aria-hidden="true" /> Create event
              </Link>
            )}
          </>
        )}
      />

      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}
      {/* Payouts wait until a few days after each event, so refunds for cancellations can always be paid */}
      {!loading && finance && (metrics.payoutHeldPkr > 0 || metrics.payoutReleasablePkr > 0) && (
        <Notice tone="good" icon={Info}>
          Payout available: PKR {(metrics.payoutReleasablePkr || 0).toLocaleString()} · Held until {metrics.payoutHoldDays || 3} days after each event ends: PKR {(metrics.payoutHeldPkr || 0).toLocaleString()}
          {metrics.refundsPending > 0 ? ` · ${metrics.refundsPending} refund${metrics.refundsPending === 1 ? '' : 's'} still processing` : ''}
        </Notice>
      )}
      {!loading && fraudFeed.length > 0 && (
        <Notice tone="bad" icon={ShieldAlert}>
          {fraudFeed.length} suspicious {fraudFeed.length === 1 ? 'activity' : 'activities'} flagged{highRisk ? `, ${highRisk} high risk` : ''}. Latest: {fraudFeed[0].userName}, {fraudFeed[0].reason.toLowerCase()}.{' '}
          <Link to={`${insightPath(user?.role, 'intent')}${eventQuery}`} className="tl-oev-link">Review</Link>
        </Notice>
      )}

      {/* Headline figures */}
      <div className="tl-oev-kpis">
        <KpiCard
          icon={Ticket}
          label={selectedEvent ? 'Events shown' : 'Total events'}
          value={show(selectedEvent ? 1 : events.length)}
          delta={!selectedEvent && kpi.created > 0 ? kpi.created : null}
          deltaKind="count"
          note={selectedEvent ? 'One event selected' : `${kpi.created} created in the ${rangeLabel}`}
          spark={kpi.eventsLine}
        />
        <KpiCard
          icon={Users}
          label="Tickets sold"
          value={show((metrics.totalTicketsSold || 0).toLocaleString())}
          delta={kpi.tickets}
          note={`${occupancy}% of ${(metrics.totalCapacity || 0).toLocaleString()} seats`}
          spark={days.map((d) => d.tickets)}
        />
        {finance ? (
          <KpiCard
            icon={Wallet}
            label="Total revenue"
            value={show((metrics.totalRevenuePkr || 0) >= 1e6 ? `PKR ${compact(metrics.totalRevenuePkr)}` : formatPkr(metrics.totalRevenuePkr))}
            delta={kpi.revenue}
            note={`Net PKR ${(metrics.netRevenuePkr || 0).toLocaleString()} after fees`}
            spark={days.map((d) => d.revenue)}
          />
        ) : (
          <KpiCard
            icon={ScanLine}
            label="Checked in"
            value={show((liveGate.scanned || 0).toLocaleString())}
            note={`${liveGate.remaining || 0} still to arrive`}
            spark={days.map((d) => d.orders)}
          />
        )}
        <KpiCard
          icon={CircleCheck}
          label="Active events"
          value={show(activeCount)}
          note={`${statusParts[1].value} live now · ${statusParts[0].value} upcoming`}
          delta={kpi.orders}
          spark={days.map((d) => d.orders)}
        />
      </div>

      {/* Tickets and revenue over the period, full width */}
      <section className="tl-oev-card">
        <CardHead icon={BarChart3} title="Events overview">
          <span className="tl-oev-card-sub">Tickets sold{finance ? ' and revenue' : ''} per day · {rangeLabel}</span>
          {can(user, 'event.pricing') && (
            <Link to={`${insightPath(user?.role, 'demand')}${eventQuery}`} className="tl-oev-headlink">View analytics <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
          )}
        </CardHead>
        <OverviewChart data={days} showRevenue={finance} />
      </section>

      <div className="tl-oev-row">
        <section className="tl-oev-card">
          <CardHead icon={Trophy} title="Event performance">
            {can(user, 'gate.supervise') && (
              <Link to="/organizer/gates" className="tl-oev-headlink">View details <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
            )}
          </CardHead>
          <div className="tl-oev-perf">
            <figure className="tl-oev-perf-ring">
              <PercentRing value={liveGate.turnoutPercentage || 0}>
                <strong>{liveGate.turnoutPercentage || 0}%</strong>
              </PercentRing>
              <figcaption>Overall attendance rate</figcaption>
            </figure>
            <ul className="tl-oev-perf-list">
              <li>
                <Users className="tl-oev-perf-icon" aria-hidden="true" />
                <span><strong>{(liveGate.scanned || 0).toLocaleString()}</strong>Checked in of {(liveGate.totalTicketsSold || 0).toLocaleString()} sold</span>
              </li>
              {finance ? (
                <li>
                  <Wallet className="tl-oev-perf-icon" aria-hidden="true" />
                  <span><strong>PKR {compact(metrics.totalRevenuePkr)}</strong>Total revenue</span>
                </li>
              ) : null}
              <li>
                <Activity className="tl-oev-perf-icon" aria-hidden="true" />
                <span title="Forecast from past events' check-ins"><strong>{attendance.rate || 0}%</strong>Expected to attend{attendance.predictedAttendees ? ` · ~${attendance.predictedAttendees.toLocaleString()}` : ''}</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="tl-oev-card">
          <CardHead icon={Activity} title="Event status" />
          <div className="tl-oev-status">
            <Donut parts={statusParts} />
            <ul className="tl-oev-status-list">
              {statusParts.map((p) => (
                <li key={p.label}>
                  <span className="tl-oev-dot" style={{ background: p.color }} aria-hidden="true" />
                  {p.label}
                  <strong>{p.value}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="tl-oev-card">
          <CardHead icon={Zap} title="Quick actions" />
          <ul className="tl-oev-actions">
            {quickActions.map(({ icon: Icon, label, to, onClick, primary }) => {
              const cls = `tl-oev-action${primary ? ' is-primary' : ''}`;
              const inner = <><Icon className="tl-oev-action-icon" aria-hidden="true" /><span>{label}</span></>;
              return <li key={label}>{to ? <Link to={to} className={cls}>{inner}</Link> : <button type="button" className={cls} onClick={onClick}>{inner}</button>}</li>;
            })}
          </ul>
        </section>
      </div>

      {/* Every event, as a table with search, filter and a menu per row */}
      <section ref={tableRef} className="tl-oev-card tl-oev-events" aria-labelledby="tl-oev-all">
        <div className="tl-oev-card-head tl-oev-events-head">
          <h2 id="tl-oev-all" className="tl-oev-card-title"><List className="tl-oev-card-icon" aria-hidden="true" />All events</h2>
          <div className="tl-oev-tools">
            <label className="tl-oev-search">
              <Search className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">Search events</span>
              <input type="search" placeholder="Search events…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="tl-aov-select">
              <span className="sr-only">Which events to show</span>
              <select value={eventView} onChange={(e) => setEventView(e.target.value)}>
                <option value="active">Upcoming &amp; live</option>
                <option value="all">All events</option>
                <option value="past">Past events</option>
              </select>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </label>
            <label className="tl-aov-select">
              <span className="sr-only">Sort events</span>
              <select value={eventSort} onChange={(e) => setEventSort(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="date">By event date</option>
              </select>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </label>
          </div>
        </div>
        {loading ? (
          <p className="tl-oev-empty">Loading your events…</p>
        ) : listedEvents.length === 0 ? (
          <p className="tl-oev-empty">
            {query ? `No events match “${query}”.` : eventView === 'past' ? 'No past events yet.' : 'No upcoming events. '}
            {!query && eventView !== 'past' && can(user, 'event.create') && <Link to="/organizer/events/new" className="tl-oev-link">Create one</Link>}
          </p>
        ) : (
          <div className="tl-oev-table-wrap">
            <table className="tl-oev-table">
              <thead>
                <tr>
                  <th scope="col">Event name</th>
                  <th scope="col">Date &amp; time</th>
                  <th scope="col">Venue</th>
                  <th scope="col">Tickets sold</th>
                  {finance && <th scope="col">Revenue</th>}
                  <th scope="col">Status</th>
                  <th scope="col" className="is-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((ev, i) => {
                  const totals = eventTotals.get(ev.name);
                  const [badge, tone] = eventBadge(ev, phases.get(ev.id));
                  const promo = isPromotionActive(ev, 'hero') ? 'hero' : isPromotionActive(ev, 'priority') ? 'priority' : null;
                  return (
                    <tr key={ev.id} className={ev.id === selectedEventId ? 'is-selected' : undefined}>
                      <td>
                        <div className="tl-oev-ev">
                          <img src={getEventVisual(ev, i).image} alt="" loading="lazy" onError={(e) => e.currentTarget.classList.add('is-broken')} />
                          <span>
                            <Link to={`/events/${ev.id}`}>{ev.name}</Link>
                            {promo && (
                              <small className="tl-oev-promo">
                                {promo === 'hero' ? 'Hero banner' : 'Top of listings'}{ev[`${promo}EndsAt`] ? ` · until ${formatPromoDay(ev[`${promo}EndsAt`])}` : ''}
                              </small>
                            )}
                            {ev.status === 'REJECTED' && ev.reviewComment && (
                              <small className="tl-oev-reject" title={ev.reviewComment}>Admin: “{ev.reviewComment.length > 70 ? `${ev.reviewComment.slice(0, 70)}…` : ev.reviewComment}”</small>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="is-nowrap">{dateTime(ev.date)}</td>
                      <td className="tl-oev-venue">{place(ev.venue, ev.city)}</td>
                      <td className="is-nowrap">{totals ? `${totals.sold.toLocaleString()} / ${totals.capacity.toLocaleString()}` : '—'}</td>
                      {finance && <td className="is-nowrap">{totals ? formatPkr(totals.revenue) : '—'}</td>}
                      <td><span className="tl-oev-badge" data-tone={tone}>{badge}</span></td>
                      <td className="is-end">
                        <div className="tl-oev-row-actions">
                          <Link to={`/events/${ev.id}`} className="tl-oev-view">View</Link>
                          <RowMenu label={`More actions for ${ev.name}`} items={rowActions(ev)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && <Pager page={rowPageNow} total={listedEvents.length} onPage={setRowPage} label="Events" />}
      </section>

      {/* Ticket tiers (gate staff are managed under Team > Gate staff) */}
      <section className="tl-oev-card">
          <CardHead icon={Ticket} title="Ticket tiers">
            <span className="tl-oev-card-sub">{tierBreakdown.length} tiers{selectedEvent ? '' : ' across all events'} · best sellers first</span>
          </CardHead>
          {tierBreakdown.length === 0 ? (
            <p className="tl-oev-empty">No ticket tiers yet. Create an event to start selling.</p>
          ) : (
            <div className="tl-oev-table-wrap">
              <table className="tl-oev-table">
                <thead>
                  <tr>
                    <th scope="col">Ticket tier</th>
                    {!selectedEvent && <th scope="col">Event</th>}
                    {finance && <th scope="col" className="is-end">Price</th>}
                    <th scope="col">Sold / total</th>
                    {finance && <th scope="col" className="is-end">Revenue</th>}
                  </tr>
                </thead>
                <tbody>
                  {shownTiers.map((t) => (
                    <tr key={t.tierId}>
                      <td className="tl-oev-strong">{t.tierName}</td>
                      {!selectedEvent && <td className="tl-oev-dimcell" title={t.eventName}>{t.eventName}</td>}
                      {finance && <td className="is-end is-nowrap">{formatPkr(t.price)}</td>}
                      <td>
                        <span className="tl-oev-sold">
                          {t.soldQuantity.toLocaleString()} / {t.totalQuantity.toLocaleString()}
                          <span className="tl-oev-meter" role="img" aria-label={`${t.percentageSold}% sold`}><i style={{ width: `${Math.min(100, t.percentageSold)}%` }} /></span>
                        </span>
                      </td>
                      {finance && <td className="is-end is-nowrap">{formatPkr(t.tierRevenuePkr)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={tierPageNow} total={sortedTiers.length} onPage={setTierPage} label="Ticket tiers" />
      </section>
    </div>
  );
}
