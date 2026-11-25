import React, { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Clock, Eye, ShoppingBag, Ticket, Trash2, X } from 'lucide-react';
import { formatPkr } from './venueTheme';

const pad = (n) => String(n).padStart(2, '0');
export const formatClock = (s) => (s == null ? '--:--' : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`);

/** Groups holds into lines: assigned seats, general-admission quantities and whole tables. */
export function summaryLines(mine) {
  const lines = [];
  const ga = new Map();
  const tables = new Map();
  for (const h of mine) {
    const price = Number(h.tier?.price || 0);
    const tier = { id: h.tier?.id || null, name: h.tier?.name || 'Ticket', color: h.tier?.color || null };
    if (h.kind === 'GA_SLOT') {
      const l = ga.get(h.sectionId) || { type: 'ga', id: `ga:${h.sectionId}`, section: h.section, sectionId: h.sectionId, tier, qty: 0, unit: price, total: 0, keys: [], inCheckout: false };
      l.qty++;
      l.total += price;
      l.keys.push(h.key);
      l.inCheckout ||= Boolean(h.inCheckout);
      ga.set(h.sectionId, l);
    } else if (h.wholeTable) {
      const l = tables.get(h.tableKey) || { type: 'table', id: `table:${h.tableKey}`, section: h.section, sectionId: h.sectionId, tier, table: h.row, qty: 0, unit: price, total: 0, keys: [], inCheckout: false };
      l.qty++;
      l.total += price;
      l.keys.push(h.key);
      l.inCheckout ||= Boolean(h.inCheckout);
      tables.set(h.tableKey, l);
    } else {
      lines.push({ type: h.tableKey ? 'tableSeat' : 'seat', id: h.key, section: h.section, sectionId: h.sectionId, tier, row: h.row, seat: h.seatNumber, qty: 1, unit: price, total: price, keys: [h.key], inCheckout: Boolean(h.inCheckout) });
    }
  }
  return [...lines.sort((a, b) => `${a.section}${a.row}`.localeCompare(`${b.section}${b.row}`, undefined, { numeric: true }) || Number(a.seat) - Number(b.seat)), ...tables.values(), ...ga.values()];
}

/** Lines grouped by price category (as the reference's "My tickets" list), priciest first. */
export function groupByTier(lines) {
  const groups = new Map();
  for (const l of lines) {
    const k = l.tier.id || l.tier.name;
    const g = groups.get(k) || { key: k, name: l.tier.name, unit: l.unit, lines: [], qty: 0, total: 0 };
    g.lines.push(l);
    g.qty += l.qty;
    g.total += l.total;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.unit - a.unit);
}

// Short seat label for the card rows (the section is shown above it)
const lineSeat = (l) => (l.type === 'ga' ? `General admission · ${l.qty}` : l.type === 'table' ? `${l.table} · whole table` : l.type === 'tableSeat' ? `${l.row} · Seat ${l.seat}` : `Row ${l.row} · Seat ${l.seat}`);

export const lineTitle = (l) =>
  l.type === 'ga' ? `${l.section} · General admission` : l.type === 'table' ? `${l.section} · ${l.table} (whole table)` : l.type === 'tableSeat' ? `${l.section} · ${l.row}, seat ${l.seat}` : `${l.section} · Row ${l.row} · Seat ${l.seat}`;
export const lineDetail = (l) => (l.type === 'ga' ? `${l.qty} × ${formatPkr(l.unit)} · no assigned seats` : l.type === 'table' ? `${l.qty} seats × ${formatPkr(l.unit)}` : formatPkr(l.unit));

export function HoldTimer({ secondsLeft, label = 'Reserved for' }) {
  const urgent = secondsLeft != null && secondsLeft < 60;
  return (
    <span className={`tl-vb-timer${urgent ? ' is-urgent' : ''}`} role="timer" aria-label={`${label} ${formatClock(secondsLeft)}`}>
      <Clock className="w-3.5 h-3.5" aria-hidden="true" /> {formatClock(secondsLeft)}
    </span>
  );
}

/**
 * The seat card: shown when a seat is selected in the 3D stadium, and once per held ticket in My tickets, so a
 * ticket looks the same everywhere. No ticket, NFT or QR preview is shown before payment.
 */
export function SeatTicketCard({ section, title, tierName, tierColor, price, gates = [], secondsLeft = null, extra = null, note = null, onClose, closeLabel = 'Close', className = '', label = 'Your seat', nav = null, children }) {
  return (
    <section className={`tl-v3-card tl-seatcard${className ? ` ${className}` : ''}`} aria-label={label}>
      <div className="tl-v3-card-head">
        <div><small>{section}</small><b>{title}</b></div>
        <div className="tl-seatcard-tools">
          {secondsLeft != null && <span className="tl-v3-timer"><Clock className="w-3.5 h-3.5" aria-hidden="true" /> {formatClock(secondsLeft)}</span>}
          {onClose && (
            <button type="button" className="tl-seatcard-x" onClick={onClose} aria-label={closeLabel} title={closeLabel}><X className="w-4 h-4" aria-hidden="true" /></button>
          )}
        </div>
      </div>
      {nav && (
        <div className="tl-seatcard-nav" role="group" aria-label="Your held tickets">
          <button type="button" onClick={nav.prev} aria-label="Previous held ticket"><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button>
          <span>Ticket <b>{nav.index + 1}</b> of {nav.count}</span>
          <button type="button" onClick={nav.next} aria-label="Next held ticket"><ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
        </div>
      )}
      <div className="tl-v3-facts">
        <div><small>Ticket type</small><b><i style={{ background: tierColor || '#c7ccd1' }} />{tierName || '—'}</b></div>
        <div><small>Price</small><b>{price}</b></div>
        {extra && <div><small>{extra.label}</small><b>{extra.value}</b></div>}
      </div>
      {gates.length > 0 && (
        <p className="tl-v3-gate">Entry: <b>{gates.slice(0, 3).join(' or ')}</b>{gates.length > 3 ? ' or another gate for this ticket type' : ''}</p>
      )}
      {note && <p className="tl-v3-note">{note}</p>}
      {children}
    </section>
  );
}

/**
 * The one My Tickets button, the same on every page while seats are held: bottom right, ticket icon, the hold
 * countdown and the count. On the seat page it opens My tickets; elsewhere (HoldBar) it is a link back to it.
 */
export function MyTicketsFab({ as: Tag = 'button', count, secondsLeft, open = false, urgent = false, className = '', ...rest }) {
  const props = Tag === 'button' ? { type: 'button', 'aria-expanded': open } : {};
  return (
    <Tag className={`tl-fab${open ? ' is-open' : ''}${urgent ? ' is-urgent' : ''}${className ? ` ${className}` : ''}`} {...props} {...rest}>
      <Ticket className="w-4 h-4" aria-hidden="true" />
      <span className="tl-fab-label">My Tickets</span>
      {secondsLeft != null && <span className="tl-fab-time" role="timer" aria-hidden="true">{formatClock(secondsLeft)}</span>}
      <span className="tl-fab-count" aria-hidden="true">{count}</span>
    </Tag>
  );
}

/** "My tickets" button used in the 2D seat page's hero box. */
export function MyTicketsButton({ count, open, onToggle, secondsLeft, controls }) {
  return (
    <button type="button" className={`tl-vb-mine${open ? ' is-open' : ''}`} onClick={onToggle} aria-expanded={open} aria-controls={controls}>
      <span>My tickets</span>
      {count > 0 && secondsLeft != null && <span className="tl-vb-mine-time" aria-hidden="true">{formatClock(secondsLeft)}</span>}
      <span className={`tl-vb-badge${count ? '' : ' is-empty'}`} aria-label={`${count} selected`}>{count}</span>
    </button>
  );
}

/**
 * My tickets: every held ticket as its seat card (the same card as when the seat was selected), then the total
 * and "Get tickets". Desktop: a panel by the button. Phones: a bottom sheet.
 */
export default function MyTicketsPanel({ id, mine, secondsLeft, onRemove, onGetTickets, busyKeys, validating = false, preview = false, onFocusSection, onClose, tierColorOf, gatesFor, className = '' }) {
  const lines = useMemo(() => summaryLines(mine), [mine]);
  const total = lines.reduce((n, l) => n + l.total, 0);
  const anyInCheckout = lines.some((l) => l.inCheckout);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="tl-vb-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <section id={id} ref={ref} tabIndex={-1} className={`tl-vb-panel tl-mt${className ? ` ${className}` : ''}`} aria-label="My tickets">
        <header className="tl-vb-panel-head">
          <div>
            <small>My tickets</small>
            <h2>{mine.length ? `${mine.length} of 10 selected` : 'No tickets yet'}</h2>
          </div>
          {mine.length > 0 && <HoldTimer secondsLeft={secondsLeft} />}
          <button type="button" className="tl-vb-icon" onClick={onClose} aria-label="Close my tickets"><X className="w-4 h-4" /></button>
        </header>

        {lines.length === 0 ? (
          <div className="tl-vb-panel-empty">
            <Ticket className="w-6 h-6" aria-hidden="true" />
            <p>No tickets selected yet.</p>
            <p className="tl-vb-muted">Choose a section on the plan, then select a seat.</p>
          </div>
        ) : (
          <>
            <ul className="tl-mt-list" aria-label="Held tickets">
              {lines.map((l) => {
                const busy = l.inCheckout || l.keys.some((k) => busyKeys.has(k));
                return (
                  <li key={l.id}>
                    <SeatTicketCard
                      label={lineTitle(l)}
                      section={l.section}
                      title={lineSeat(l)}
                      tierName={l.tier.name}
                      tierColor={tierColorOf?.(l.tier.id) || l.tier.color}
                      price={l.qty > 1 ? `${formatPkr(l.total)}` : formatPkr(l.unit)}
                      extra={l.qty > 1 ? { label: 'Tickets', value: `${l.qty} × ${formatPkr(l.unit)}` } : null}
                      gates={gatesFor?.(l.tier.id) || []}
                      note={l.inCheckout ? 'In your unfinished checkout: continuing replaces it.' : null}
                    >
                      <div className="tl-v3-actions">
                        {onFocusSection && (
                          <button type="button" className="tl-v3-btn" onClick={() => onFocusSection(l.sectionId, l)}><Eye className="w-4 h-4" aria-hidden="true" /> View seat</button>
                        )}
                        <button type="button" className="tl-v3-btn is-ghost" onClick={() => onRemove(l)} disabled={busy} aria-label={`Remove ${lineTitle(l)}`}>
                          <Trash2 className="w-4 h-4" aria-hidden="true" /> Remove
                        </button>
                      </div>
                    </SeatTicketCard>
                  </li>
                );
              })}
            </ul>
            <div className="tl-vb-panel-foot">
              <div className="tl-vb-total">
                <div><small>Tickets</small><b>{mine.length}</b></div>
                <div><small>Subtotal</small><b>{formatPkr(total)}</b></div>
              </div>
              <p className="tl-vb-muted">Held for you for 10 minutes. Fees and the final total are confirmed at checkout.</p>
              {anyInCheckout && <p className="tl-vb-muted">“In checkout” items belong to your unfinished checkout; continuing replaces it.</p>}
              <button type="button" className="tl-vb-get" onClick={onGetTickets} disabled={preview || validating} aria-busy={validating}>
                {!preview && !validating && <ShoppingBag className="w-4 h-4" aria-hidden="true" />}
                {preview ? 'Preview: checkout is disabled' : validating ? 'Checking your reservation…' : `Get tickets (${mine.length})`}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
