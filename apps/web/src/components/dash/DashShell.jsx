import React, { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getEventVisual } from '../../utils/eventMedia';
import markUrl from '../../assets/ticketledger-mark.svg';
import HomeHeader from '../home/HomeHeader';
import SiteFooter from '../home/SiteFooter';
import '../home/home.css';
import '../events/events.css';
import './dash.css';
import './studio.css';

// Console areas per role (same routes and role rules as App.jsx)
const CONSOLES = {
  SUPER_ADMIN: {
    label: 'Admin console',
    links: [
      { to: '/admin/dashboard', label: 'Overview' },
      { to: '/admin/companies', label: 'Approvals' },
      { to: '/admin/event-approvals', label: 'Event approvals' },
      { to: '/admin/fraud-watchlist', label: 'Fraud watchlist' },
      { to: '/admin/demand-forecast', label: 'Demand forecast' },
      { to: '/admin/purchase-intent', label: 'Purchase intent' },
      { to: '/admin/abandoned-intents', label: 'Abandoned intents' },
      { to: '/admin/behavior-profile', label: 'Behavior' },
      { to: '/scanner', label: 'Scanner' },
    ],
  },
  ORGANIZER: {
    label: 'Organizer studio',
    links: [
      { to: '/organizer/dashboard', label: 'Overview' },
      { to: '/organizer/create-event', label: 'Create event' },
      { to: '/admin/purchase-intent', label: 'Purchase intent' },
      { to: '/admin/demand-forecast', label: 'Demand forecast' },
      { to: '/admin/abandoned-intents', label: 'Abandoned intents' },
      { to: '/scanner', label: 'Scanner' },
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

// Paths that open the same screen as a console link (aliases in App.jsx)
const ALIASES = { '/demand-forecast': '/admin/demand-forecast', '/analytics/intent': '/admin/purchase-intent' };

// Screens on the organizer studio theme. The rest of the consoles follow once it is signed off.
const STUDIO_ROUTES = ['/scanner', '/admin/dashboard', '/admin/companies', '/admin/event-approvals', '/admin/fraud-watchlist', '/admin/behavior-profile', '/organizer/dashboard', '/admin/purchase-intent', '/analytics/intent', '/admin/demand-forecast', '/demand-forecast', '/admin/abandoned-intents'];

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
  const console_ = CONSOLES[user?.role];
  const current = Object.entries(ALIASES).find(([from]) => pathname.startsWith(from))?.[1] || pathname;
  const studio = STUDIO_ROUTES.some((r) => pathname.startsWith(r)) || /^\/organizer\/(create-event|events\/[^/]+\/(edit|submit))\/?$/.test(pathname);

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
  }, []);

  return (
    <div className={`tl-home tl-dash${studio ? ' tl-dash--studio' : ''}`}>
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/events')} tone="light" />
      <div ref={pageRef}>
        <main className="tl-dash-main">
          {console_ && (
            <nav className="tl-dash-nav" aria-label={console_.label}>
              <span className="tl-dash-nav-label">{console_.label}</span>
              <div className="tl-dash-nav-links">
                {console_.links.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    className={() => `tl-dash-nav-link${current.startsWith(l.to) ? ' is-active' : ''}`}
                    aria-current={current.startsWith(l.to) ? 'page' : undefined}
                  >
                    {l.label}
                  </NavLink>
                ))}
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
export function DashHead({ eyebrow, title, intro, segment, actions, note }) {
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
  good: ['ACTIVE', 'APPROVED', 'SUCCESSFUL', 'VALID_FIRST_SCAN', 'PUBLISHED', 'ACCEPTED', 'LOW'],
  warn: ['SUSPENDED', 'PENDING', 'PENDING_VERIFICATION', 'ALREADY_SCANNED', 'SUSPICIOUS', 'DRAFT', 'MEDIUM', 'EXPIRED'],
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
