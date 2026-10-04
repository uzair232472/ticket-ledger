import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

const SELECTOR = 'select:not([multiple]):not([size]):not([data-native])';
const MAX_H = 320;

/** Theme from where the select sits: dark sections, the organizer / admin studio, or paper pages. */
function themeOf(el) {
  if (el.closest('.tl-pill, .tl-mapscene, .tl-acct-section--dark, .tl-dlg--dark, .tl-st-select')) return 'dark';
  if (el.closest('.tl-dash--studio, .tl-ve-panel, .tl-wz-card, .tl-lp, .tl-dash')) return 'studio';
  return 'paper';
}

/** Options of a native select, keeping optgroup labels. */
function readOptions(select) {
  const out = [];
  [...select.children].forEach((node) => {
    if (node.tagName === 'OPTGROUP') {
      out.push({ group: node.label });
      [...node.children].forEach((o) => out.push({ value: o.value, label: o.textContent, disabled: o.disabled || node.disabled, index: o.index }));
    } else if (node.tagName === 'OPTION') {
      out.push({ value: node.value, label: node.textContent, disabled: node.disabled, index: node.index });
    }
  });
  return out;
}

/**
 * Designed dropdown lists for every native <select> in the app. Opening a select with the mouse or the
 * keyboard (Space, Enter, Alt+↓) shows this themed list instead of the browser's; choosing an option
 * sets the select's value and fires its normal change event, so pages keep their own logic and styles.
 * Taps on touch screens open the same list (a scroll that starts on a select does not). Add data-native
 * to a select to keep the browser's own picker.
 */
export default function SelectEnhancer() {
  const [open, setOpen] = useState(null); // { select, options, theme }
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const listRef = useRef(null);
  const lastPointer = useRef('mouse');
  const typed = useRef({ text: '', at: 0 });

  const close = useCallback((refocus = true) => {
    setOpen((o) => {
      if (o?.select) {
        o.select.removeAttribute('aria-expanded');
        if (refocus) o.select.focus({ preventScroll: true });
      }
      return null;
    });
  }, []);

  const show = useCallback((select) => {
    if (select.disabled) return;
    const options = readOptions(select);
    if (!options.some((o) => !o.group)) return;
    select.setAttribute('aria-expanded', 'true');
    setOpen({ select, options, theme: themeOf(select) });
    setActive(options.findIndex((o) => !o.group && o.index === select.selectedIndex));
  }, []);

  // Intercept native opening (mouse) and the keys that would open it
  useEffect(() => {
    const onPointer = (e) => {
      lastPointer.current = e.pointerType || 'mouse';
    };
    const onMouseDown = (e) => {
      const select = e.target.closest?.(SELECTOR);
      if (!select || e.button !== 0 || lastPointer.current === 'touch') return;
      e.preventDefault();
      select.focus({ preventScroll: true });
      if (open?.select === select) close(false);
      else show(select);
    };
    const onKeyDown = (e) => {
      const select = e.target.closest?.(SELECTOR);
      if (!select || open) return;
      if (e.key === ' ' || e.key === 'Enter' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) || e.key === 'F4') {
        e.preventDefault();
        show(select);
      }
    };
    // Touch: a tap (not a scroll) on a select opens the designed list instead of the native picker
    let touch = null;
    const onTouchStart = (e) => {
      const select = e.target.closest?.(SELECTOR);
      touch = select && e.touches.length === 1 ? { select, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onTouchEnd = (e) => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const tap = Math.abs(t.clientX - touch.x) < 10 && Math.abs(t.clientY - touch.y) < 10;
      const { select } = touch;
      touch = null;
      if (!tap || select.disabled) return;
      e.preventDefault(); // stops the synthetic click that would open the native picker
      select.focus({ preventScroll: true });
      if (open?.select === select) close(false);
      else show(select);
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
    };
  }, [open, show, close]);

  // Position under (or above) the select; follow scroll and resize
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = open.select.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return close(false);
      const listH = Math.min(MAX_H, (listRef.current?.scrollHeight || MAX_H) + 2);
      const below = window.innerHeight - r.bottom - 12;
      const up = below < listH && r.top - 12 > below;
      const width = Math.max(r.width, 200);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setPos({ left, width, top: up ? undefined : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : undefined, maxH: Math.max(140, Math.min(MAX_H, up ? r.top - 18 : below)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close]);

  // Outside click closes
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (listRef.current?.contains(e.target) || e.target === open.select) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, close]);

  // Keep the active option in view
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, pos]);

  const choose = useCallback(
    (opt) => {
      if (!open || !opt || opt.group || opt.disabled) return;
      const { select } = open;
      if (select.selectedIndex !== opt.index) {
        select.selectedIndex = opt.index;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
      }
      close(true);
    },
    [open, close]
  );

  // Keyboard inside the open list (focus stays on the select)
  useEffect(() => {
    if (!open) return undefined;
    const opts = open.options;
    const step = (from, dir) => {
      let i = from;
      for (let n = 0; n < opts.length; n++) {
        i = (i + dir + opts.length) % opts.length;
        if (!opts[i].group && !opts[i].disabled) return i;
      }
      return from;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => step(a < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : a, e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setActive(e.key === 'Home' ? step(-1, 1) : step(opts.length, -1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(opts[active]);
      } else if (e.key === 'Tab') {
        close(false);
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        // Type-ahead
        const now = Date.now();
        typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
        const hit = opts.findIndex((o) => !o.group && !o.disabled && o.label.trim().toLowerCase().startsWith(typed.current.text));
        if (hit >= 0) setActive(hit);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, active, choose, close]);

  if (!open || !pos) {
    // First render after opening measures the list; render it hidden until placed
    if (!open) return null;
  }

  const selectedIndex = open.select.selectedIndex;
  return createPortal(
    <div
      ref={listRef}
      className={`tl-sel-list tl-sel--${open.theme}`}
      role="listbox"
      aria-label={open.select.getAttribute('aria-label') || open.select.labels?.[0]?.textContent || 'Options'}
      style={pos ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH } : { visibility: 'hidden', left: 0, top: 0 }}
    >
      {open.options.map((o, i) =>
        o.group ? (
          <div key={`g${i}`} className="tl-sel-group" role="presentation">{o.group}</div>
        ) : (
          <div
            key={`${o.index}-${o.value}`}
            data-i={i}
            role="option"
            aria-selected={o.index === selectedIndex}
            aria-disabled={o.disabled || undefined}
            className={`tl-sel-opt${i === active ? ' is-active' : ''}${o.index === selectedIndex ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}
            onMouseEnter={() => !o.disabled && setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(o)}
          >
            <span>{o.label}</span>
            {o.index === selectedIndex && <Check className="w-4 h-4" aria-hidden="true" />}
          </div>
        )
      )}
    </div>,
    document.body
  );
}
