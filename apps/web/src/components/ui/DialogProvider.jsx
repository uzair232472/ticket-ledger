import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import './dialog.css';

const DialogContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

/** Visual theme from the page: organizer/admin consoles, the booking flow, or the dark site pages. */
function themeFor(pathname) {
  if (/^\/(admin|organizer|scanner|staff|demand-forecast|analytics)(\/|$)/.test(pathname)) return 'studio';
  if (/^\/(checkout|bookings|booking-success)(\/|$)|^\/events\/[^/]+\/(seats|checkout)/.test(pathname)) return 'paper';
  return 'dark';
}

/**
 * In-app replacement for the browser's alert() and confirm(): a designed, responsive dialog that
 * follows the current page's theme.
 *   const dialog = useDialog();
 *   await dialog.alert({ tone: 'success', title: 'Saved', message: '…' });
 *   if (await dialog.confirm({ title: 'Cancel listing?', message: '…', confirmLabel: 'Cancel listing', tone: 'warning' })) …
 */
export function DialogProvider({ children }) {
  const { pathname } = useLocation();
  const [queue, setQueue] = useState([]);
  const current = queue[0];

  const open = useCallback(
    (kind, opts) =>
      new Promise((resolve) => {
        setQueue((q) => [...q, { id: Math.random().toString(36).slice(2), kind, resolve, ...(typeof opts === 'string' ? { message: opts } : opts) }]);
      }),
    []
  );
  const alert = useCallback((opts) => open('alert', opts), [open]);
  const confirm = useCallback((opts) => open('confirm', opts), [open]);

  const close = (value) => {
    current?.resolve(value);
    setQueue((q) => q.slice(1));
  };

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {current && <Dialog key={current.id} dialog={current} theme={themeFor(pathname)} onClose={close} />}
    </DialogContext.Provider>
  );
}

function Dialog({ dialog, theme, onClose }) {
  const tone = dialog.tone || (dialog.kind === 'confirm' ? 'warning' : 'info');
  const Icon = ICONS[tone] || Info;
  const primaryRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    // Destructive confirmations start on Cancel; everything else on the main button
    (dialog.kind === 'confirm' && tone === 'error' ? cancelRef : primaryRef).current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose(dialog.kind === 'confirm' ? false : true);
      if (e.key === 'Tab') {
        const items = [cancelRef.current, primaryRef.current].filter(Boolean);
        const i = items.indexOf(document.activeElement);
        if (items.length > 1) {
          e.preventDefault();
          items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={`tl-dlg-overlay tl-dlg--${theme}`} onMouseDown={(e) => e.target === e.currentTarget && onClose(dialog.kind === 'confirm' ? false : true)}>
      <div className={`tl-dlg is-${tone}`} role={dialog.kind === 'confirm' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="tl-dlg-title" aria-describedby="tl-dlg-msg">
        <span className="tl-dlg-icon" aria-hidden="true"><Icon className="w-6 h-6" /></span>
        <h2 id="tl-dlg-title" className="tl-dlg-title">
          {dialog.title || { success: 'Done', error: 'Something went wrong', warning: 'Please confirm', info: 'Notice' }[tone]}
        </h2>
        {dialog.message && <p id="tl-dlg-msg" className="tl-dlg-msg">{dialog.message}</p>}
        <div className="tl-dlg-actions">
          {dialog.kind === 'confirm' && (
            <button ref={cancelRef} type="button" className="tl-dlg-btn tl-dlg-btn--ghost" onClick={() => onClose(false)}>
              {dialog.cancelLabel || 'Cancel'}
            </button>
          )}
          <button ref={primaryRef} type="button" className={`tl-dlg-btn${tone === 'error' && dialog.kind === 'confirm' ? ' tl-dlg-btn--danger' : ''}`} onClick={() => onClose(true)}>
            {dialog.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}
