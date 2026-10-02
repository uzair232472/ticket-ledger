import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/*
 * Building blocks for the organizer studio pages (styles in studio.css): breadcrumb heading, stat cards,
 * panels with an icon header, badges, avatars and a pager. Static, no animations.
 */

/** Breadcrumb + large title + intro, then a row with page controls (left) and actions (right). */
export function StudioHead({ crumbs = [], title, intro, controls, actions }) {
  return (
    <header className="tl-sh">
      {crumbs.length > 0 && (
        <p className="tl-sh-crumbs">
          {crumbs.map((c, i) => (
            <span key={c}>{c}</span>
          ))}
        </p>
      )}
      <h1 className="tl-sh-title">{title}</h1>
      {intro && <p className="tl-sh-intro">{intro}</p>}
      {(controls || actions) && (
        <div className="tl-sh-row">
          <div className="tl-sh-controls">{controls}</div>
          {actions && <div className="tl-sh-actions">{actions}</div>}
        </div>
      )}
    </header>
  );
}

/** Field-style select with a leading icon (event pickers and filters). */
export function StudioSelect({ icon: Icon, value, onChange, label, children, wide }) {
  return (
    <label className={`tl-ss${wide ? ' tl-ss--wide' : ''}`}>
      {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
      <select value={value} onChange={onChange} aria-label={label}>{children}</select>
    </label>
  );
}

/**
 * Stat card: tinted icon square, coloured mono label, large value, small note.
 * tone: green | amber | blue | ink. `iconSide="right"` puts the icon in the top-right corner.
 */
export function StatCard({ icon: Icon, label, value, unit, extra, note, tone = 'ink', iconSide = 'left', children }) {
  return (
    <section className={`tl-sc tl-sc--${tone}${iconSide === 'right' ? ' tl-sc--icon-right' : ''}`}>
      {Icon && <span className="tl-sc-icon" aria-hidden="true"><Icon className="w-5 h-5" /></span>}
      <div className="tl-sc-body">
        <h2 className="tl-sc-label">{label}</h2>
        <p className="tl-sc-value">
          {value}
          {unit && <small>{unit}</small>}
          {extra}
        </p>
        {note && <p className="tl-sc-note">{note}</p>}
        {children}
      </div>
    </section>
  );
}

/** Panel with a dark icon square, title, optional badge, subtitle and an action on the right. */
export function Panel({ icon: Icon, title, badge, badgeTone = 'green', sub, action, tone, className = '', children, flush }) {
  return (
    <section className={`tl-pn${tone ? ` tl-pn--${tone}` : ''}${flush ? ' tl-pn--flush' : ''} ${className}`}>
      {(title || action) && (
        <header className="tl-pn-head">
          <div className="tl-pn-title-wrap">
            {Icon && <span className={`tl-pn-icon${tone === 'amber' ? ' is-amber' : ''}`} aria-hidden="true"><Icon className="w-5 h-5" /></span>}
            <div>
              <div className="tl-pn-title-row">
                <h2 className="tl-pn-title">{title}</h2>
                {badge != null && <Badge tone={badgeTone}>{badge}</Badge>}
              </div>
              {sub && <p className="tl-pn-sub">{sub}</p>}
            </div>
          </div>
          {action && <div className="tl-pn-action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Small mono badge. tone: green | amber | blue | rose | ink | grey */
export function Badge({ tone = 'grey', icon: Icon, children }) {
  return (
    <span className={`tl-bd tl-bd--${tone}`}>
      {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

export const initials = (name = '') =>
  name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase() || '?';

/** Round avatar with initials, or a person icon for guests. */
export function Avatar({ name, guest, icon: Icon }) {
  return (
    <span className={`tl-av${guest ? ' is-guest' : ''}`} aria-hidden="true">
      {Icon ? <Icon className="w-4 h-4" /> : initials(name)}
    </span>
  );
}

/** "Showing 1–6 of 18" plus page buttons. */
export function Pager({ page, pageSize, total, onPage, noun = 'items' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="tl-pg" aria-label="Pages">
      <p>Showing {from}–{to} of {total} {noun}</p>
      <div>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </nav>
  );
}

/** Horizontal score bar. */
export function ScoreBar({ value, tone = 'green' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className={`tl-sb tl-sb--${tone}`} aria-hidden="true"><span style={{ width: `${v}%` }} /></span>
  );
}

/**
 * Approval-style stat: tinted icon circle, mono label, large value, tinted status pill.
 * tone: amber | green | blue | rose
 */
export function ApStat({ icon: Icon, label, value, tone = 'green', pill, pillIcon: PillIcon }) {
  return (
    <section className={`tl-ap-stat tl-ap-stat--${tone}`}>
      {Icon && <span className="tl-ap-stat-icon" aria-hidden="true"><Icon className="w-6 h-6" /></span>}
      <div>
        <h2 className="tl-ap-stat-label">{label}</h2>
        <p className="tl-ap-stat-value">{value}</p>
        {pill && <span className="tl-ap-stat-pill">{PillIcon && <PillIcon className="w-3.5 h-3.5" aria-hidden="true" />}{pill}</span>}
      </div>
    </section>
  );
}

/** Underlined tabs with counts. options = [{ value, label, count }] */
export function UnderlineTabs({ options, value, onChange, label }) {
  return (
    <div className="tl-ul-tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}{o.count != null && <span> ({o.count})</span>}
        </button>
      ))}
    </div>
  );
}

/** Record card: icon tile, title + sub, status badge, labelled columns, actions column. */
export function RecordCard({ icon: Icon, title, sub, status, columns = [], actions, footer }) {
  return (
    <article className="tl-rc">
      <header className="tl-rc-head">
        {Icon && <span className="tl-rc-icon" aria-hidden="true"><Icon className="w-7 h-7" /></span>}
        <div className="tl-rc-title">
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {status && <div className="tl-rc-status">{status}</div>}
      </header>
      <div className="tl-rc-body">
        {columns.map((c) => (
          <div key={c.label} className="tl-rc-col">
            <h4>{c.label}</h4>
            {c.content}
          </div>
        ))}
        {actions && <div className="tl-rc-actions">{actions}</div>}
      </div>
      {footer}
    </article>
  );
}

/** Row of compact stat cards (Users-tab style). items = [{ icon, label, value, tone }] tone: green | amber | rose | blue | ink */
export function TabStats({ items }) {
  return (
    <div className="tl-ts">
      {items.map(({ icon: Icon, label, value, tone = 'green' }) => (
        <section key={label} className={`tl-ts-card tl-ts-card--${tone}`}>
          <span className="tl-ts-icon" aria-hidden="true">{Icon && <Icon className="w-6 h-6" />}</span>
          <div>
            <h2>{label}</h2>
            <p>{value}</p>
          </div>
        </section>
      ))}
    </div>
  );
}

/** Directory card: title, sub, toolbar, table, then "Showing x – y of n" with Previous / Page / Next. */
export function Directory({ title, sub, toolbar, children, page, totalPages, total, pageSize, noun, onPage, loading }) {
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <section className="tl-dir">
      <header className="tl-dir-head">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </header>
      {toolbar && <div className="tl-dir-toolbar">{toolbar}</div>}
      {children}
      {total > 0 && (
        <nav className="tl-dir-pager" aria-label={`${title} pages`}>
          <p>Showing {from} – {to} of {total} {noun}</p>
          <div>
            <button type="button" onClick={() => onPage(page - 1)} disabled={loading || page <= 1}><ChevronLeft className="w-4 h-4" /> Previous</button>
            <span>Page {page} of {Math.max(1, totalPages)}</span>
            <button type="button" className="is-next" onClick={() => onPage(page + 1)} disabled={loading || page >= totalPages}>Next <ChevronRight className="w-4 h-4" /></button>
          </div>
        </nav>
      )}
    </section>
  );
}
