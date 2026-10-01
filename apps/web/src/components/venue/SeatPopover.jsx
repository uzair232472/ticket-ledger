import React, { useEffect, useId, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { formatPkr } from './venueTheme';

/**
 * Seat information popover (reference: seats.io stadium). Shown over a dimmed plan when an available
 * seat, a held-by-you seat or a whole table is chosen. Nothing is reserved until "Select" is pressed.
 *
 * `info`: { title, facts: [[label, value]], tier: { name, color }, price, note, state }
 * `state`: 'available' → Select · 'mine' → Remove · 'checkout' → Close only.
 */
export default function SeatPopover({ info, image, busy = false, onSelect, onRemove, onClose }) {
  const titleId = useId();
  const ref = useRef(null);
  const primaryRef = useRef(null);

  useEffect(() => {
    (primaryRef.current || ref.current)?.focus();
  }, []);

  // Escape closes; Tab stays inside the popover
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      return onClose();
    }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll('button:not([disabled])')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="tl-vb-pop-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="tl-vb-pop" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="tl-vb-pop-media">
          {image && <img src={image} alt="" onError={(e) => e.currentTarget.remove()} />}
          <h3 id={titleId} className="tl-sr">{info.title}</h3>
          <dl className="tl-vb-pop-facts">
            {info.facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="tl-vb-pop-band" style={{ '--tier': info.tier?.color || '#0b0b0b' }}>
          <span>{info.tier?.name || 'Ticket'}</span>
          <strong>{formatPkr(info.price)}</strong>
        </p>
        {info.note && <p className="tl-vb-pop-note">{info.note}</p>}
        <div className="tl-vb-pop-actions">
          <button type="button" className="tl-bk-btn tl-bk-btn--ghost" onClick={onClose}>
            <X className="w-4 h-4" aria-hidden="true" /> Close
          </button>
          {info.state === 'available' && (
            <button ref={primaryRef} type="button" className="tl-bk-btn" onClick={onSelect} disabled={busy} aria-busy={busy}>
              <Check className="w-4 h-4" aria-hidden="true" /> {busy ? 'Reserving…' : 'Select'}
            </button>
          )}
          {info.state === 'mine' && (
            <button ref={primaryRef} type="button" className="tl-bk-btn tl-bk-btn--ghost" onClick={onRemove} disabled={busy} aria-busy={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
