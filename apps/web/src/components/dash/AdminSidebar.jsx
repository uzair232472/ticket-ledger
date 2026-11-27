import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  Menu,
  X,
  BadgeCheck,
  UserCheck,
  Banknote,
  Brain,
  Building2,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  DoorOpen,
  Home,
  LifeBuoy,
  ScanLine,
  Search,
  Settings,
  ShoppingBag,
  Users,
  Wallet,
  BarChart3,
  CalendarClock,
  CalendarPlus,
  LayoutGrid,
  ShoppingCart,
  Tag,
  TrendingUp,
} from 'lucide-react';

// Sections of the overview page itself (tabs of /admin/dashboard)
const PAGE_LINKS = [
  { tab: null, label: 'Dashboard', icon: Home },
  { tab: 'events', label: 'Events', icon: CalendarDays },
  { tab: 'transactions', label: 'Orders', icon: ShoppingBag },
  { tab: 'users', label: 'Users', icon: Users },
];

// Icons for the admin console links (DashShell CONSOLES.SUPER_ADMIN)
export const ICONS = {
  '/admin/companies': BadgeCheck,
  '/admin/organizer-approvals': UserCheck,
  '/admin/event-approvals': CalendarCheck,
  '/admin/finance': Banknote,
  '/admin/fraud-watchlist': AlertTriangle,
  '/admin/fraud-review': AlertTriangle,
  '/admin/investigations': Search,
  '/organizer/team': Building2,
  '/admin/platform': Settings,
  '/admin/payouts': Wallet,
  '/support/desk': LifeBuoy,
  '/organizer/gates': DoorOpen,
  '/scanner': ScanLine,
  '/staff/events': CalendarCheck,
  // Organizer studio links (shown when an organizer is on a shared page)
  '/organizer/dashboard': LayoutGrid,
  '/organizer/events/new': CalendarPlus,
  '/organizer/prebook': CalendarClock,
  '/organizer/team': Users,
  '/organizer/organization': Building2,
  '/organizer/discounts': Tag,
  '/organizer/purchase-intent': TrendingUp,
  '/organizer/demand-forecast': BarChart3,
  '/organizer/abandoned-intents': ShoppingCart,
  '/organizer/support': LifeBuoy,
  '/organizer/checkout-settings': Settings,
  '/organizer/team?tab=gate': ScanLine,
};

// Fans with raised hands and flags at the foot of the sidebar (fixed seed, so it never changes between renders)
function Crowd() {
  const shapes = useMemo(() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const out = [];
    for (let row = 0; row < 3; row += 1) {
      const base = 150 - row * 14;
      for (let x = -6 + row * 7; x < 230; x += 15 + rnd() * 6) {
        const h = 6 + rnd() * 3;
        const y = base - 26 - rnd() * 10;
        out.push(<circle key={`h${row}-${x}`} cx={x} cy={y} r={h} />);
        out.push(<rect key={`b${row}-${x}`} x={x - 9} y={y + h - 1} width={18} height={60} rx={8} />);
        if (rnd() > 0.45) {
          const side = rnd() > 0.5 ? 1 : -1;
          const ax = x + side * 7;
          out.push(<path key={`a${row}-${x}`} d={`M${ax - 2} ${y + 10} L${ax + side * 6} ${y - 22 - rnd() * 12} l4 1 L${ax + 3} ${y + 12}Z`} />);
          if (rnd() > 0.75) {
            const fx = ax + side * 6;
            const fy = y - 34;
            out.push(<path key={`f${row}-${x}`} d={`M${fx} ${fy} l${side * 18} 3 l${side * -2} 10 l${side * -16} -4Z`} />);
          }
        }
      }
    }
    return out;
  }, []);
  return (
    <svg className="tl-aov-crowd" viewBox="0 0 220 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <g>{shapes}</g>
    </svg>
  );
}

/**
 * Left sidebar of the admin overview: the page's own sections first, then every console area the admin's
 * role allows (the same links as the console nav, with the same pending badges). The site header stays on
 * top, so its logo sits above this column.
 */
const KEY = 'tl-admin-side-collapsed';
const readCollapsed = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

export default function AdminSidebar({ console: consoleNav, pending = {}, isAdmin = true }) {
  const { pathname, search } = useLocation();
  // Collapsed = slim icon rail; the choice is kept for next time
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* private mode */ }
  }, [collapsed]);
  // Phones and small tablets: the sidebar is a drawer that slides in from the left
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => { setMobile(mq.matches); if (!mq.matches) setDrawer(false); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => { setDrawer(false); }, [pathname, search]);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [drawer]);
  const rail = collapsed && !mobile;
  const tab = new URLSearchParams(search).get('tab');
  const onPage = pathname.startsWith('/admin/dashboard');
  const links = (consoleNav?.links || []).filter((l) => l.to !== '/admin/dashboard');
  const flat = links.filter((l) => !l.children);
  // A link with a query (Team page > Gate staff tab) is active on the whole page unless a plain link to that
  // page is also listed (then it is active on its own tab only, and the plain link on the rest)
  const isActive = (to) => {
    const [path, query] = to.split('?');
    if (!pathname.startsWith(path)) return false;
    if (!query) return !flat.some((l) => l.to !== to && l.to.startsWith(`${path}?`) && isActive(l.to));
    if (!flat.some((l) => l.to === path)) return true;
    const params = new URLSearchParams(search);
    return [...new URLSearchParams(query)].every(([k, v]) => params.get(k) === v);
  };
  const groups = links.filter((l) => l.children);

  const badge = (key) => (key && pending[key] > 0 ? (
    <span className="tl-aov-side-badge" aria-label={`${pending[key]} waiting`}>{pending[key] > 99 ? '99+' : pending[key]}</span>
  ) : null);

  return (
    <>
    {mobile && (
      <button type="button" className="tl-aov-side-mobbtn" onClick={() => setDrawer(true)} aria-expanded={drawer} aria-controls="tl-aov-side">
        <Menu className="w-5 h-5" aria-hidden="true" /> Menu
      </button>
    )}
    {mobile && drawer && <div className="tl-aov-side-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
    <aside id="tl-aov-side" className={`tl-aov-side${rail ? ' is-collapsed' : ''}${drawer ? ' is-open' : ''}`} aria-label={consoleNav?.label || 'Console'}>
      {mobile && (
        <div className="tl-aov-side-drawhead">
          <span>{consoleNav?.label || 'Console'}</span>
          <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="w-5 h-5" aria-hidden="true" /></button>
        </div>
      )}
      <button
        type="button"
        className="tl-aov-side-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronsRight className="w-4 h-4" aria-hidden="true" /> : <ChevronsLeft className="w-4 h-4" aria-hidden="true" />}
      </button>
      <nav className="tl-aov-side-nav">
        {isAdmin && <ul className="tl-aov-side-list">
          {PAGE_LINKS.map(({ tab: t, label, icon: Icon }) => {
            const active = onPage && (tab || null) === t;
            return (
              <li key={label}>
                <Link
                  to={t ? `/admin/dashboard?tab=${t}` : '/admin/dashboard'}
                  className={`tl-aov-side-link${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={rail ? label : undefined}
                >
                  <Icon className="tl-aov-side-icon" aria-hidden="true" />
                  <span className="tl-aov-side-text">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>}

        {flat.length > 0 && (
          <>
            <p className="tl-aov-side-label">{isAdmin ? 'Console' : consoleNav?.label || 'Console'}</p>
            <ul className="tl-aov-side-list">
              {flat.map((l) => {
                const Icon = ICONS[l.to] || Settings;
                const active = isActive(l.to);
                return (
                  <li key={l.to}>
                    <Link to={l.to} className={`tl-aov-side-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} title={rail ? l.label : undefined}>
                      <Icon className="tl-aov-side-icon" aria-hidden="true" />
                      <span className="tl-aov-side-text">{l.label}</span>
                      {badge(l.badge)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {groups.map((g) => (
          <details key={g.key} className="tl-aov-side-group" onToggle={(e) => { if (e.currentTarget.open && rail) setCollapsed(false); }}>
            <summary className="tl-aov-side-link" title={rail ? g.label : undefined}>
              <Brain className="tl-aov-side-icon" aria-hidden="true" />
              <span className="tl-aov-side-text">{g.label}</span>
              <ChevronDown className="tl-aov-side-chev" aria-hidden="true" />
            </summary>
            <ul className="tl-aov-side-list tl-aov-side-sub">
              {g.children.map((c) => (c.divider
                ? <li key={`d-${c.label}`} className="tl-aov-side-sublabel" aria-hidden="true">{c.label}</li>
                : <li key={c.to}><Link to={c.to} className="tl-aov-side-link">{c.label}</Link></li>))}
            </ul>
          </details>
        ))}
      </nav>
      <Crowd />
    </aside>
    </>
  );
}
