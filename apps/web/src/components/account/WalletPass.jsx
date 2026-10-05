import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Calendar, CheckCircle2, Clock, Download, History, Info, Lock, MapPin, MoreHorizontal,
  RefreshCw, Send, ShieldCheck, Tag, Code2, Sun,
} from 'lucide-react';
import { categoryName } from '../home/homeData';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';

/** Seat line for the pass: general admission has no row or seat number. */
export const seatParts = (seat) => {
  if (!seat) return { row: '—', seat: '—' };
  if (seat.kind === 'GA_SLOT') return { row: 'GA', seat: seat.seatNumber ?? '—', general: true };
  return { row: seat.row ?? '—', seat: seat.seatNumber ?? '—' };
};

/** Small "More" menu (resale, history, gate check, signed data). Closes on outside click and Escape. */
function MoreMenu({ items, className = '', compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const key = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={ref} className={`tl-pass-more ${className}`}>
      <button
        type="button"
        className="tl-pass-btn tl-pass-btn--ghost"
        aria-expanded={open}
        aria-label={compact ? 'More options' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="w-5 h-5" aria-hidden="true" />{!compact && ' More'}
      </button>
      {open && (
        <div className="tl-pass-menu" role="menu">
          {items.filter(Boolean).map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Wallet gate pass: event details on the left, the signed QR stub on the right (stacked on phones),
 * separated by a perforated tear line. Actions: download, transfer and a "More" menu.
 */
export default function WalletPass({
  ticket: t, downloading, verifying, verifyResult, payloadOpen,
  onDownload, onTransfer, onResale, onHistory, onVerify, onTogglePayload,
}) {
  const ev = t.event || {};
  const isActive = t.status === 'ACTIVE';
  const isScanned = t.status === 'SCANNED';
  const isInvalid = t.status === 'RESOLD' || t.status === 'TRANSFERRED';
  const time = formatEventTime(ev.time);
  const seat = seatParts(t.seat);
  const moreItems = [
    isActive && { label: 'List for resale (≤110%)', icon: <Tag className="w-4 h-4" aria-hidden="true" />, onClick: onResale },
    { label: 'Ownership history', icon: <History className="w-4 h-4" aria-hidden="true" />, onClick: onHistory },
    { label: verifying ? 'Checking…' : 'Check at gate', icon: <ShieldCheck className="w-4 h-4" aria-hidden="true" />, onClick: onVerify, disabled: verifying },
    { label: payloadOpen ? 'Hide signed pass' : 'Show signed pass', icon: <Code2 className="w-4 h-4" aria-hidden="true" />, onClick: onTogglePayload },
  ];

  return (
    <article className={`tl-pass${isActive ? '' : ' is-muted'}`} data-reveal aria-label={`Ticket for ${ev.name}`}>
      <div className="tl-pass-main">
        <div className="tl-pass-top">
          <p className="tl-pass-kicker">{[categoryName(ev.type), ev.city].filter(Boolean).join(' • ')}</p>
          <span className={`tl-pass-status is-${t.status?.toLowerCase()}`}>{t.status}</span>
        </div>
        <h3 className="tl-pass-title">{ev.name}</h3>

        <div className="tl-pass-place">
          <MapPin className="w-5 h-5" aria-hidden="true" />
          <div>
            <p className="tl-pass-venue">{ev.venue}</p>
            <p className="tl-pass-city">{ev.city}</p>
          </div>
        </div>
        <p className="tl-pass-when">
          <span><Calendar className="w-5 h-5" aria-hidden="true" /> {ev.date ? formatEventDate(ev.date) : 'Date to be announced'}</span>
          {time && <><span className="tl-pass-sep" aria-hidden="true" /><span><Clock className="w-5 h-5" aria-hidden="true" /> {time}</span></>}
        </p>

        <dl className="tl-pass-facts">
          <div><dt>Enclosure</dt><dd>{t.seat?.tierName || '—'}</dd></div>
          <div><dt>Section</dt><dd>{t.seat?.section || '—'}</dd></div>
          <div>
            <dt>{seat.general ? 'Entry / No.' : 'Row / Seat'}</dt>
            <dd className="tl-pass-seat">{seat.general ? `General / ${seat.seat}` : `${seat.row} / ${seat.seat}`}</dd>
          </div>
        </dl>

        {verifyResult && (
          <p className={`tl-pass-verify${verifyResult.valid ? ' is-ok' : ' is-bad'}`} role="status">
            {verifyResult.valid ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4" aria-hidden="true" />}
            {verifyResult.message}{!verifyResult.valid && verifyResult.reason ? ` (${verifyResult.reason})` : ''}
          </p>
        )}

        {payloadOpen && (
          <pre className="tl-pass-payload">{t.qr?.code || ''}</pre>
        )}

      </div>

      <div className="tl-pass-stub">
        <div className="tl-pass-qr">
          {t.qr?.qrCodeDataUrl && <img src={t.qr.qrCodeDataUrl} alt={`Entry QR code for ${ev.name}`} />}
          {(isScanned || isInvalid) && (
            <div className="tl-pass-qr-cover">
              {isScanned ? <CheckCircle2 className="w-8 h-8" aria-hidden="true" /> : <AlertTriangle className="w-8 h-8" aria-hidden="true" />}
              <strong>{isScanned ? 'Used' : 'QR no longer valid'}</strong>
              <span>
                {isScanned
                  ? t.checkedInAt
                    ? `Used at ${new Date(t.checkedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${t.gate ? `, ${t.gate}` : ''}`
                    : 'This pass was used at the gate.'
                  : 'This ticket was resold or transferred.'}
              </span>
            </div>
          )}
        </div>
        {t.qr?.manualCode && (
          <p className="tl-pass-code" aria-label={`Manual entry code ${t.qr.manualCode}`}>{t.qr.manualCode}</p>
        )}
        <p className="tl-pass-scan">{isActive ? 'Scan at entry' : isScanned ? 'Checked in' : 'Not valid for entry'}</p>
        <div className="tl-pass-badges">
          <p className="tl-pass-refresh">
            <Sun className="w-4 h-4" aria-hidden="true" /> Turn screen brightness up
          </p>
          <span className="tl-pass-dot" aria-hidden="true" />
          <p className="tl-pass-verified"><ShieldCheck className="w-6 h-6" aria-hidden="true" /> Verified ticket</p>
        </div>
      </div>

      <div className="tl-pass-actions">
        <button type="button" className="tl-pass-btn tl-pass-btn--primary" onClick={onDownload} disabled={downloading}>
          {downloading ? <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Download className="w-5 h-5" aria-hidden="true" />}
          {downloading ? 'Preparing…' : 'Download ticket'}
        </button>
        {isActive ? (
          <button type="button" className="tl-pass-btn tl-pass-btn--outline" onClick={onTransfer}>
            <Send className="w-5 h-5" aria-hidden="true" /> Transfer<span className="tl-pass-phone-only">&nbsp;ticket</span>
          </button>
        ) : (
          <span className="tl-pass-locked"><Lock className="w-4 h-4" aria-hidden="true" /> Can’t transfer ({t.status?.toLowerCase()})</span>
        )}
        <MoreMenu items={moreItems} className="tl-pass-more--bar" />
        <p className="tl-pass-note tl-pass-phone-only"><Info className="w-4 h-4" aria-hidden="true" /> Keep this screen open at the gate</p>
      </div>

      {/* Phones: the extra actions sit in a ··· button in the card's top-right corner */}
      <MoreMenu items={moreItems} className="tl-pass-more--corner" compact />
    </article>
  );
}
