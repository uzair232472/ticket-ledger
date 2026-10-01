import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowRight, Clock, Ticket, X } from 'lucide-react';
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
    const tier = { id: h.tier?.id || null, name: h.tier?.name || 'Ticket' };
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

/** "My tickets" button with the live count badge (reference: pill top-right of the plan). */
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
 * Selection panel: tickets grouped by category, remove buttons, total, hold timer and "Get tickets".
 * Desktop: dropdown under the My tickets button. Phones: a bottom sheet.
 */
export default function MyTicketsPanel({ id, mine, secondsLeft, onRemove, onGetTickets, busyKeys, validating = false, preview = false, onFocusSection, onClose }) {
  const lines = useMemo(() => summaryLines(mine), [mine]);
  const groups = useMemo(() => groupByTier(lines), [lines]);
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
      <section id={id} ref={ref} tabIndex={-1} className="tl-vb-panel" aria-label="My tickets">
        <header className="tl-vb-panel-head">
          <h2>My tickets <span>({mine.length})</span></h2>
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
            <div className="tl-vb-panel-list">
              {groups.map((g) => (
                <div key={g.key} className="tl-vb-group">
                  <p className="tl-vb-group-name">{g.name} <span>{formatPkr(g.unit)}</span></p>
                  <ul aria-label={g.name}>
                    {g.lines.map((l) => (
                      <li key={l.id}>
                        <button type="button" className="tl-vb-line" onClick={() => onFocusSection?.(l.sectionId)}>
                          <span className="tl-vb-line-title">{lineTitle(l)}</span>
                          <span className="tl-vb-muted">{lineDetail(l)}{l.inCheckout && <em className="tl-vb-tag">In checkout</em>}</span>
                        </button>
                        <span className="tl-vb-line-price">{formatPkr(l.total)}</span>
                        <button
                          type="button"
                          className="tl-vb-icon"
                          onClick={() => onRemove(l)}
                          disabled={l.inCheckout || l.keys.some((k) => busyKeys.has(k))}
                          aria-label={`Remove ${lineTitle(l)}`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="tl-vb-panel-foot">
              <p className="tl-vb-total"><span>Subtotal · {mine.length} ticket{mine.length === 1 ? '' : 's'}</span><strong>{formatPkr(total)}</strong></p>
              <p className="tl-vb-muted">Fees and the final total are confirmed at checkout.</p>
              {anyInCheckout && <p className="tl-vb-muted">“In checkout” items belong to your unfinished checkout; continuing replaces it.</p>}
              <button type="button" className="tl-bk-btn tl-bk-btn--block" onClick={onGetTickets} disabled={preview || validating} aria-busy={validating}>
                {preview ? 'Preview: checkout is disabled' : validating ? 'Checking your reservation…' : 'Get tickets'}
                {!preview && !validating && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
