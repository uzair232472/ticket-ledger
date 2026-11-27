import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, ChevronDown, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getEventVisual } from '../../utils/eventMedia';
import api from '../../utils/api';
import { activeOrg, can, ORG_PAGE_PERMISSIONS } from '../../lib/permissions';
import markUrl from '../../assets/ticketledger-mark.svg';
import HomeHeader from '../home/HomeHeader';
import SiteFooter from '../home/SiteFooter';
import '../home/home.css';
import '../events/events.css';
import './dash.css';
import './studio.css';
import { insightPath } from '../../lib/insightPaths';
import AdminSidebar, { ICONS as SIDEBAR_ICONS } from './AdminSidebar';
import ThemedSelectLayer from './ThemedSelect';
import ThemedDateLayer from './ThemedDate';
import { PageHero, AovFooter } from '../../pages/AdminOverview';
import { BadgeCheck, Brain, CalendarCheck, DoorOpen, LayoutGrid, Wallet, ShieldAlert } from 'lucide-react';
import './studio-dark.css';
import './admin-overview.css';

// Console areas per role (same routes and role rules as App.jsx)
const CONSOLES = {
  SUPER_ADMIN: {
    label: 'Admin console',
    links: [
      { to: '/admin/dashboard', label: 'Overview', adminPermission: 'admin.view' },
      { to: '/admin/companies', label: 'Approvals', badge: 'eventApprovals', adminPermission: 'admin.approvals' },
      { to: '/admin/organizer-approvals', label: 'Organizer approvals', badge: 'companies', adminPermission: 'admin.approvals' },
      { to: '/admin/finance', label: 'Finance', adminPermission: 'admin.finance' },
      { to: '/admin/fraud-watchlist', label: 'Fraud watchlist', adminPermission: 'admin.fraud' },
      { to: '/admin/fraud-review', label: 'Fraud review', adminPermission: 'admin.fraud' },
      { to: '/admin/investigations', label: 'Investigations', adminPermission: 'admin.fraud' },
      { to: '/organizer/team', label: 'Organization teams', adminPermission: 'admin.orgs' },
      { to: '/admin/platform', label: 'Platform', adminPermission: 'admin.view' },
      // AI: one dropdown in the nav (insights first, then the shadow models' monitoring and governance)
      {
        key: 'ai', label: 'AI', children: [
          { to: '/admin/demand-forecast', label: 'Demand forecast' },
          { to: '/admin/purchase-intent', label: 'Purchase intent' },
          { to: '/admin/abandoned-intents', label: 'Abandoned intents' },
          { to: '/admin/behavior-profile', label: 'Behavior' },
          { divider: true, label: 'Models' },
          { to: '/admin/ai-monitor', label: 'AI monitor' },
          { to: '/admin/ai-models', label: 'Model cards' },
          { to: '/admin/ai-readiness', label: 'Go-live readiness' },
          { to: '/admin/ai-report', label: 'Governance report' },
        ],
      },
      { to: '/admin/payouts', label: 'Payouts', adminPermission: 'admin.finance' },
      { to: '/support/desk', label: 'Support desk', adminPermission: 'admin.support' },
      { to: '/organizer/gates', label: 'Gates' },
      { to: '/scanner', label: 'Scanner' },
    ],
  },
  // Organization members (owners and employees of any account type): links filtered by permission
  ORGANIZER: {
    label: 'Organizer studio',
    links: [
      { to: '/organizer/dashboard', label: 'Overview', permission: 'event.view' },
      { to: '/organizer/events/new', label: 'Create event', permission: 'event.create' },
      { to: '/organizer/prebook', label: 'Prebookings', permission: 'event.create' },
      // Team page (members, invitations, roles, gate staff, activity), opened on its Gate staff tab
      { to: '/organizer/team?tab=gate', label: 'Gate staff', permission: ['staff.view', 'audit.view'] },
      { to: '/organizer/organization', label: 'Organization', permission: ORG_PAGE_PERMISSIONS },
      { to: '/organizer/discounts', label: 'Discount codes', permission: 'discount.manage' },
      { to: '/organizer/purchase-intent', label: 'Purchase intent', permission: 'attendee.view' },
      { to: '/organizer/demand-forecast', label: 'Demand forecast', permission: 'event.pricing' },
      { to: '/organizer/abandoned-intents', label: 'Abandoned intents', permission: 'attendee.view' },
      { to: '/organizer/gates', label: 'Gates', permission: 'gate.supervise' },
      { to: '/organizer/support', label: 'Support requests', permission: 'support.respond' },
      { to: '/organizer/checkout-settings', label: 'Checkout settings', permission: ['finance.view', 'event.edit'] },
      { to: '/scanner', label: 'Scanner', permission: 'gate.scan' },
    ],
  },
  GATE_STAFF: {
    label: 'Gate console',
    links: [
      { to: '/staff/events', label: 'My events' },
      { to: '/scanner', label: 'Scanner' },
    ],
  },
};

/** The console for this person: by organization permissions for members, by account role otherwise. */
function consoleFor(user) {
  if (!user) return null;
  // Admins see the console links their admin role allows
  if (user.role === 'SUPER_ADMIN') {
    const mine = new Set(user.adminPermissions || []);
    return { ...CONSOLES.SUPER_ADMIN, links: CONSOLES.SUPER_ADMIN.links.filter((l) => !l.adminPermission || mine.has(l.adminPermission) || !user.adminPermissions) };
  }
  const org = activeOrg(user);
  if (org) {
    if (org.permissions.includes('event.view') || org.permissions.includes('staff.view')) {
      const links = CONSOLES.ORGANIZER.links.filter((l) => can(user, l.permission));
      return { label: org.name ? `${org.name} studio` : CONSOLES.ORGANIZER.label, links };
    }
    if (org.permissions.includes('gate.scan')) return CONSOLES.GATE_STAFF;
    return user.isSupportAgent ? { label: 'Support desk', links: [{ to: '/support/desk', label: 'Queue' }] } : null;
  }
  // Support agents without an organization
  if (user.isSupportAgent) return { label: 'Support desk', links: [{ to: '/support/desk', label: 'Queue' }] };
  // Organizers before their company exists see the studio (its screens send them to registration)
  return CONSOLES[user.role] || null;
}

// Paths that open the same screen as a console link (aliases in App.jsx)
// Neutral addresses of the shared insight pages, highlighted as the admin or organizer menu item
const aliasesFor = (role) => ({ '/demand-forecast': insightPath(role, 'demand'), '/analytics/intent': insightPath(role, 'intent') });

/**
 * A nav entry that opens a small menu of links (the AI pages). Active when the current page is one of its links.
 * Closes on a link click, Escape, a click outside or a page change; the menu is a plain list of links.
 */
function NavGroup({ group, current }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const links = group.children.filter((c) => c.to);
  const active = links.find((c) => current.startsWith(c.to));
  useEffect(() => { setOpen(false); }, [current]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const id = `tl-nav-menu-${group.key}`;
  return (
    <span ref={ref} className={`tl-dash-nav-link tl-dash-nav-group${active ? ' is-active' : ''}`}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {group.label}{active ? `: ${active.label}` : ''}
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {open && (
        <ul id={id} className="tl-dash-nav-menu">
          {group.children.map((c) => (c.divider
            ? <li key={`d-${c.label}`} className="tl-dash-nav-menu-label" aria-hidden="true">{c.label}</li>
            : (
              <li key={c.to}>
                <Link to={c.to} aria-current={current.startsWith(c.to) ? 'page' : undefined} className={current.startsWith(c.to) ? 'is-active' : undefined}>{c.label}</Link>
              </li>
            )))}
        </ul>
      )}
    </span>
  );
}

// Screens on the organizer studio theme. The rest of the consoles follow once it is signed off.
const STUDIO_ROUTES = ['/admin/finance', '/admin/platform', '/admin/investigations', '/organizer/checkout-settings', '/admin/payouts', '/organizer/support', '/support/desk', '/organizer/gates', '/scanner', '/organizer/team', '/organizer/organization', '/organizer/discounts', '/admin/dashboard', '/admin/companies', '/admin/organizer-approvals', '/admin/event-approvals', '/admin/fraud-watchlist', '/admin/fraud-review', '/admin/behavior-profile', '/organizer/dashboard', '/admin/purchase-intent', '/analytics/intent', '/admin/demand-forecast', '/demand-forecast', '/admin/abandoned-intents', '/admin/ai-monitor', '/admin/ai-models', '/admin/ai-readiness', '/organizer/purchase-intent', '/organizer/demand-forecast', '/organizer/abandoned-intents'];

// Admin nav badges (like unread counts): what is waiting for a decision. Re-read on every page change, every
// 30 seconds, and when a review page fires `tl:pending-changed` after a decision.
export const notifyPendingChanged = () => window.dispatchEvent(new Event('tl:pending-changed'));
function usePendingCounts(enabled, pathname) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = () =>
      api
        .get('/admin/pending-counts')
        .then((res) => alive && setCounts(res.data.data))
        .catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener('tl:pending-changed', load);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('tl:pending-changed', load);
      window.removeEventListener('focus', load);
    };
  }, [enabled, pathname]);
  return counts;
}

// Admin console pages shown on the dark layout (super admins only; organizers keep the studio look)
const ADMIN_DARK = /^\/(admin\/|organizer\/(team|gates|dashboard)\/?$|support\/desk|scanner\/?$)/;
/** True inside an admin console page on the dark layout: page headings render the stadium hero. */
// Organizer pages that are the same screens admins or gate staff use: shown on the same dark design
const ORG_SHARED = /^\/(organizer\/(dashboard|team|gates|purchase-intent|demand-forecast|abandoned-intents)|demand-forecast|analytics\/intent|support\/desk|scanner|staff\/events)\/?$/;
// Organizer studio pages on the same dark design: creating and editing events (and every step of their setup),
// prebookings and the organization profile. Admins open the same screens on the same look.
const STUDIO_DARK = /^\/organizer\/(organization|discounts|checkout-settings|support(\/[^/]+)?|events\/new|create-event|prebook(\/[^/]+)?|events\/[^/]+\/(edit|submit|manage|changes|venue))\/?$/;
export const AdminDarkContext = createContext(false);
export const useAdminDark = () => useContext(AdminDarkContext);

// Icon tile for each admin page's heading
const PAGE_ICONS = {
  ...SIDEBAR_ICONS,
  '/admin/dashboard': LayoutGrid,
  '/admin/companies': BadgeCheck,
  '/admin/organizer-approvals': SIDEBAR_ICONS['/admin/organizer-approvals'],
  '/admin/event-approvals': CalendarCheck,
  '/admin/finance': Wallet,
  '/admin/fraud-watchlist': ShieldAlert,
  '/organizer/gates': DoorOpen,
  '/staff/events': CalendarCheck,
};
const iconForPath = (pathname) => {
  const key = Object.keys(PAGE_ICONS).sort((a, b) => b.length - a.length).find((p) => pathname.startsWith(p));
  return key ? PAGE_ICONS[key] : Brain; // the AI pages
};

/** Stadium heading for the dark admin pages: role badge, icon tile and green title, intro, tools on the right. */
export function DarkHero({ title, intro, aside, icon }) {
  const { pathname } = useLocation();
  // `icon={null}` leaves the icon tile out; otherwise the page's own icon
  return <PageHero icon={icon === undefined ? iconForPath(pathname) : icon} title={title} intro={intro} aside={aside} />;
}

/**
 * Static console layout for organizers, super admins and gate staff: the site header and footer around the
 * paper background, a slash-separated nav of the role's console areas, then the page. `.tl-dash-skin`
 * restyles the existing Tailwind markup of the sub-modules into the same theme.
 */
export default function DashShell({ children }) {
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const pageRef = useRef(null);
  const console_ = consoleFor(user);
  const pending = usePendingCounts(user?.role === 'SUPER_ADMIN', pathname);
  const current = Object.entries(aliasesFor(user?.role)).find(([from]) => pathname.startsWith(from))?.[1] || pathname;
  // Admin console pages on the dark layout (sidebar instead of the console nav), see ADMIN_DARK
  // ...the gate team's console (My events, Scanner), and for organizers the pages they share with admins or
  // gate staff (Team, Gates, Scanner, My events, Support desk, the insight pages)
  const orgConsole = Boolean(console_) && user?.role !== 'SUPER_ADMIN' && console_ !== CONSOLES.GATE_STAFF;
  const bare = (user?.role === 'SUPER_ADMIN' && (ADMIN_DARK.test(pathname) || STUDIO_DARK.test(pathname)))
    || (console_ === CONSOLES.GATE_STAFF && /^\/(staff\/events|scanner)\/?$/.test(pathname))
    || (orgConsole && (ORG_SHARED.test(pathname) || STUDIO_DARK.test(pathname)));
  const studio = STUDIO_ROUTES.some((r) => pathname.startsWith(r)) || /^\/organizer\/(create-event|prebook(\/.*)?|events\/(new|[^/]+\/(edit|submit|manage)))\/?$/.test(pathname);

  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  // The header logo steps aside once the dark footer (with its own wordmark) reaches it, as on the homepage
  useEffect(() => {
    const header = document.querySelector('[data-home-header]');
    const footer = document.querySelector('.tl-dash .tl-footer');
    if (!header || !footer) return undefined;
    const update = () => {
      header.dataset.atFooter = String(footer.getBoundingClientRect().top <= 80);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      delete header.dataset.atFooter;
    };
  }, [bare]);

  if (bare) {
    return (
      <div className="tl-home tl-dash tl-aov-root">
        <HomeHeader pageRef={pageRef} onCategories={() => navigate('/events')} tone="dark" />
        <div ref={pageRef} className="tl-aov-shell">
          <AdminSidebar console={console_} pending={pending} isAdmin={user?.role === 'SUPER_ADMIN'} />
          <ThemedSelectLayer />
          <ThemedDateLayer />
          <main className="tl-aov-main">
            <AdminDarkContext.Provider value>
              <div className="tl-aov-page tl-aov-sec">
                {children}
                <AovFooter />
              </div>
            </AdminDarkContext.Provider>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`tl-home tl-dash${studio ? ' tl-dash--studio' : ''}`}>
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/events')} tone="light" />
      <div ref={pageRef}>
        <main className="tl-dash-main">
          {console_ && (
            <nav className="tl-dash-nav" aria-label={console_.label}>
              <span className="tl-dash-nav-label">{console_.label}</span>
              <div className="tl-dash-nav-links">
                {console_.links.map((l) => (l.children ? <NavGroup key={l.key} group={l} current={current} /> : (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    className={() => `tl-dash-nav-link${current.startsWith(l.to) ? ' is-active' : ''}`}
                    aria-current={current.startsWith(l.to) ? 'page' : undefined}
                  >
                    {l.label}
                    {l.badge && pending[l.badge] > 0 && (
                      <span className="tl-dash-nav-badge" aria-label={`${pending[l.badge]} waiting`}>
                        {pending[l.badge] > 99 ? '99+' : pending[l.badge]}
                      </span>
                    )}
                  </NavLink>
                )))}
              </div>
            </nav>
          )}
          <div className="tl-dash-skin">{children}</div>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}

/**
 * Page heading: eyebrow + title (actions on the right), then an optional filter row underneath for tabs or
 * an event picker, laid out like the Explore heading and its filter bar.
 */
export function DashHead({ eyebrow, title, intro, segment, actions, note, icon }) {
  const dark = useAdminDark();
  if (dark) {
    return (
      <>
        <DarkHero title={title} intro={note || intro} icon={icon} aside={actions && <div className="tl-dk-tools">{actions}</div>} />
        {segment && <div className="tl-dk-seg">{segment}</div>}
      </>
    );
  }
  if (note) {
    // Resale market head: title on the left, a short note on the right
    return (
      <header className="tl-dash-head tl-dash-head--note">
        <div>
          {eyebrow && <p className="tl-dash-eyebrow">{eyebrow}</p>}
          <h1 className="tl-dash-title">{title}</h1>
        </div>
        <p className="tl-dash-intro">{note}</p>
      </header>
    );
  }
  return (
    <>
      <header className="tl-dash-head">
        <div>
          {eyebrow && <p className="tl-dash-eyebrow">{eyebrow}</p>}
          <h1 className="tl-dash-title">{title}</h1>
          {intro && <p className="tl-dash-intro">{intro}</p>}
        </div>
        {actions && <div className="tl-dash-actions">{actions}</div>}
      </header>
      {segment && <div className="tl-dash-filter">{segment}</div>}
    </>
  );
}

/** Segmented control. `options` = [{ value, label, count? }]. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="tl-dash-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon className="w-3.5 h-3.5" aria-hidden="true" />}
          {o.label}
          {o.count != null && <span className="tl-dash-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Paper card with a title row and an optional corner link (route `to` or click `onOpen`). `tone="night"` = homepage night section. */
export function DashCard({ title, sub, icon: Icon, to, onOpen, openLabel, aside, tone, className = '', children }) {
  const corner = to ? (
    <Link to={to} className="tl-dash-card-link" aria-label={openLabel || `Open ${title}`}><ArrowUpRight className="w-4 h-4" /></Link>
  ) : onOpen ? (
    <button type="button" className="tl-dash-card-link" onClick={onOpen} aria-label={openLabel || `Open ${title}`}><ArrowUpRight className="w-4 h-4" /></button>
  ) : null;
  return (
    <section className={`tl-dash-card${tone === 'night' ? ' tl-dash-night' : ''} ${className}`}>
      {(title || corner || aside) && (
        <div className="tl-dash-card-head">
          <div>
            {title && <h2 className="tl-dash-card-title">{Icon && <Icon className="tl-dash-card-icon" aria-hidden="true" />}{title}</h2>}
            {sub && <p className="tl-dash-card-sub">{sub}</p>}
          </div>
          {aside}
          {corner}
        </div>
      )}
      <div className="tl-dash-card-body">{children}</div>
    </section>
  );
}

/** Big figure, as the account page stats. */
export function Figure({ value, unit, size }) {
  const text = typeof value === 'number' ? value.toLocaleString() : String(value ?? '–');
  return (
    <div className={`tl-dash-figure${size === 'md' ? ' tl-dash-figure--md' : ''}`}>
      {unit && <span className="tl-dash-figure-unit">{unit}</span>}
      {text}
    </div>
  );
}

const TREND_ICONS = { good: TrendingUp, bad: TrendingDown, warn: TrendingDown };

/** Explore filter chip under a figure; `tone` adds a trend icon (always with text, never colour alone). */
export function Chip({ tone, icon: Icon, dot, children }) {
  const Glyph = dot ? null : Icon || (tone ? TREND_ICONS[tone] : null);
  return (
    <span className="tl-dash-chip" data-tone={tone}>
      {dot && <span className="tl-dash-chip-dot" data-tone={dot} aria-hidden="true" />}
      {Glyph && <Glyph className="w-3.5 h-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** KPI: the account page stat (coloured left rule = the series it belongs to), on a paper card. */
export function Kpi({ label, color, icon: Icon, value, unit, chips = [] }) {
  return (
    <section className={`tl-dash-card tl-dash-kpi${color ? ' has-accent' : ''}`} style={{ '--dot': color }}>
      <h2 className="tl-dash-kpi-label">{Icon && <Icon className="tl-dash-kpi-icon" aria-hidden="true" />}{label}</h2>
      <Figure value={value} unit={unit} />
      <div className="tl-dash-kpi-foot">{chips}</div>
    </section>
  );
}

/** Numbered row for a night panel (as the resale / account numbered rows). */
export function Tile({ num, icon: Icon, title, value, cta, to, onClick, children }) {
  // Numbered rows show the icon beside the title; without a number the icon leads the row
  const inner = (
    <>
      {num != null ? (
        <span className="tl-dash-tile-num" aria-hidden="true">{String(num).padStart(2, '0')}</span>
      ) : (
        Icon && <span className="tl-dash-tile-lead" aria-hidden="true"><Icon className="w-6 h-6" /></span>
      )}
      <span className="tl-dash-tile-top">
        <span className="tl-dash-tile-name">{num != null && Icon && <Icon className="w-4 h-4" aria-hidden="true" />}{title}</span>
        {value != null && <span className="tl-dash-tile-value">{value}</span>}
      </span>
      <p>{children}</p>
      {cta && <span className="tl-dash-tile-cta">{cta} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></span>}
    </>
  );
  if (to) return <Link to={to} className="tl-dash-tile">{inner}</Link>;
  if (onClick) return <button type="button" className="tl-dash-tile" onClick={onClick}>{inner}</button>;
  return <div className="tl-dash-tile">{inner}</div>;
}

// Many venues already include the city ("Gaddafi Stadium, Ferozepur Road, Lahore"), as on Explore
const formatPlace = (venue = '', city = '') =>
  city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue || city;

const hideBroken = (e) => e.currentTarget.closest('.tl-tile-media')?.classList.add('is-broken');

/**
 * Event tile from Explore Events (b/w photo that turns to colour on hover, uppercase title, mono meta),
 * without the cursor effects. `flag` is the label over the photo; `children` go under the caption.
 */
export function EventTile({ event, index = 0, to, flag, flagTone, children }) {
  const image = getEventVisual(event, index).image;
  const date = new Date(event.date);
  return (
    <article className="tl-tile">
      <Link to={to || `/events/${event.id}`} className="tl-tile-link">
        <div className="tl-tile-media">
          <img className="tl-tile-img" src={image} alt="" loading="lazy" decoding="async" onError={hideBroken} />
          <img className="tl-tile-img tl-tile-gray" src={image} alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <span className="tl-tile-fallback" aria-hidden="true" style={{ backgroundImage: `url(${markUrl})` }} />
          {flag && <span className={`tl-tile-flag${flagTone ? ` is-${flagTone}` : ''}`}>{flag}</span>}
        </div>
        <div className="tl-tile-caption">
          <h3 className="tl-tile-title">{event.name}</h3>
          <p className="tl-tile-meta">
            {date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
          <p className="tl-tile-meta">{formatPlace(event.venue, event.city)}</p>
        </div>
      </Link>
      {children}
    </article>
  );
}

/** Small b/w event photo for table rows. */
export function EventThumb({ event, index = 0 }) {
  return (
    <span className="tl-cell-thumb" aria-hidden="true">
      <img src={getEventVisual(event, index).image} alt="" loading="lazy" onError={(e) => e.currentTarget.classList.add('is-broken')} />
    </span>
  );
}

/**
 * NFT ticket card: event photo banner with gradient, badges on top and a kicker/title on the image,
 * then a night body. Used for the event being scanned and the scan verdict.
 */
export function TicketCard({ event, index = 0, badges = [], kicker, title, banner, className = '', children, ...rest }) {
  const image = event ? getEventVisual(event, index).bannerImage : null;
  return (
    <section className={`tl-dash-card tl-ticket ${className}`} {...rest}>
      <div className="tl-ticket-banner">
        {image && <img src={image} alt="" onError={(e) => e.currentTarget.classList.add('is-broken')} />}
        {badges.length > 0 && (
          <div className="tl-ticket-badges">
            {badges.map((b, i) => <span key={i} className={`tl-ticket-badge${b.green ? ' is-green' : ''}`}>{b.label}</span>)}
          </div>
        )}
        {kicker && <p className="tl-ticket-kicker">{kicker}</p>}
        {title && <h2 className="tl-ticket-title">{title}</h2>}
        {banner}
      </div>
      <div className="tl-ticket-body">{children}</div>
    </section>
  );
}

const STATUS_TONES = {
  good: ['ACTIVE', 'APPROVED', 'VERIFIED', 'SUCCESSFUL', 'VALID_FIRST_SCAN', 'PUBLISHED', 'ACCEPTED', 'LOW'],
  warn: ['SUSPENDED', 'PENDING', 'UNVERIFIED', 'SCHEDULED', 'USED_UP', 'PENDING_VERIFICATION', 'ALREADY_SCANNED', 'SUSPICIOUS', 'DRAFT', 'MEDIUM', 'EXPIRED'],
  bad: ['BANNED', 'DEACTIVATED', 'REJECTED', 'FAILED', 'INVALID_SCAN', 'CRITICAL', 'HIGH', 'CANCELLED', 'ERROR'],
};
export const statusTone = (s) => Object.keys(STATUS_TONES).find((k) => STATUS_TONES[k].includes(s)) || 'neutral';
const pretty = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Status as dot + readable label. */
export function Status({ value, label }) {
  return <span className="tl-status" data-tone={statusTone(value)}>{label || pretty(value)}</span>;
}

export function Notice({ tone = 'good', icon: Icon, onDismiss, children }) {
  return (
    <div className="tl-dash-notice" data-tone={tone} role={tone === 'bad' ? 'alert' : 'status'}>
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
      <span>{children}</span>
      {onDismiss && <button type="button" onClick={onDismiss}>Dismiss</button>}
    </div>
  );
}

export function DashState({ icon: Icon, title, children }) {
  return (
    <div className="tl-dash-state">
      {Icon && <Icon className="w-7 h-7" aria-hidden="true" />}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
    </div>
  );
}
