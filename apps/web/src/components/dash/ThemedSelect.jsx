import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

/*
 * Themed dropdown lists for the dark admin pages. Every native <select> inside `.tl-aov-root` keeps its
 * markup, value and onChange; only the list that opens is ours. Clicking a select (or Enter / Space /
 * Alt+ArrowDown on it) opens a dark menu under it; choosing an option sets the select's value through the
 * native setter and fires a bubbling `change` event, so React's onChange runs exactly as before.
 * Touch screens keep the operating system's picker.
 */

const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;

function choose(select, value) {
  if (select.value === value) return;
  valueSetter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const readOptions = (select) => [...select.options].map((o) => ({
  value: o.value,
  label: o.textContent,
  disabled: o.disabled,
  group: o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : null,
}));

export default function ThemedSelectLayer() {
  const [menu, setMenu] = useState(null); // { select, options, active, rect }
  const listRef = useRef(null);
  // Latest menu, for the document listeners
  const menuRef = useRef(null);
  menuRef.current = menu;

  const close = useCallback((refocus = true) => {
    setMenu((m) => {
      if (m && refocus) requestAnimationFrame(() => m.select.focus({ preventScroll: true }));
      return null;
    });
  }, []);

  const open = useCallback((select) => {
    const options = readOptions(select);
    const current = options.findIndex((o) => o.value === select.value);
    setMenu({ select, options, active: current >= 0 ? current : options.findIndex((o) => !o.disabled), rect: select.getBoundingClientRect() });
  }, []);

  // Open on click / keyboard for selects inside the dark admin pages
  useEffect(() => {
    const fine = window.matchMedia?.('(pointer: fine)');
    const target = (el) => {
      const sel = el?.closest?.('select');
      return sel && sel.closest('.tl-aov-root') && !sel.multiple && !(sel.size > 1) && !sel.disabled ? sel : null;
    };
    const onDown = (e) => {
      if (e.button !== 0 || (fine && !fine.matches)) return;
      const sel = target(e.target);
      if (!sel) return;
      e.preventDefault();
      sel.focus({ preventScroll: true });
      setMenu((m) => (m?.select === sel ? null : m));
      if (!menuRef.current || menuRef.current.select !== sel) open(sel);
    };
    const onKey = (e) => {
      const sel = target(e.target);
      if (!sel || menuRef.current) return;
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        open(sel);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Close on outside click, scroll of the page, resize; keyboard inside the menu
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      // Clicks on the list, or on any themed select (which opens its own list), don't close here
      if (listRef.current?.contains(e.target) || e.target.closest?.('select')?.closest('.tl-aov-root')) return;
      close(false);
    };
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) close(false); };
    const onKey = (e) => {
      const m = menuRef.current;
      if (!m) return;
      const step = (dir) => {
        let i = m.active;
        for (let n = 0; n < m.options.length; n += 1) {
          i = (i + dir + m.options.length) % m.options.length;
          if (!m.options[i].disabled) break;
        }
        setMenu({ ...m, active: i });
      };
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); setMenu({ ...m, active: m.options.findIndex((o) => !o.disabled) }); }
      else if (e.key === 'End') { e.preventDefault(); const rev = [...m.options].reverse().findIndex((o) => !o.disabled); setMenu({ ...m, active: m.options.length - 1 - rev }); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const o = m.options[m.active];
        if (o && !o.disabled) choose(m.select, o.value);
        close();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu?.select, close]);

  // Keep the highlighted option in view
  useLayoutEffect(() => {
    if (!menu) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [menu?.active, menu?.select]);

  if (!menu) return null;
  const { rect, options, active, select } = menu;
  const below = window.innerHeight - rect.bottom;
  const up = below < 240 && rect.top > below;
  const width = Math.max(rect.width, 200);
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  const style = {
    left: Math.max(8, left),
    width,
    maxHeight: Math.min(340, (up ? rect.top : below) - 16),
    ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
  };
  let lastGroup = null;

  return createPortal(
    <ul ref={listRef} className={`tl-tsel${up ? ' is-up' : ''}`} style={style} role="listbox" aria-label={select.getAttribute('aria-label') || 'Options'}>
      {options.map((o, i) => {
        const heading = o.group && o.group !== lastGroup ? o.group : null;
        lastGroup = o.group;
        const selected = o.value === select.value;
        return (
          <React.Fragment key={`${o.value}-${i}`}>
            {heading && <li className="tl-tsel-group" role="presentation">{heading}</li>}
            <li
              role="option"
              aria-selected={selected}
              aria-disabled={o.disabled || undefined}
              data-active={i === active}
              className={`tl-tsel-opt${selected ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}
              onMouseEnter={() => !o.disabled && setMenu((m) => (m ? { ...m, active: i } : m))}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (o.disabled) return; choose(select, o.value); close(); }}
            >
              <span>{o.label || ' '}</span>
              {selected && <Check className="w-4 h-4" aria-hidden="true" />}
            </li>
          </React.Fragment>
        );
      })}
    </ul>,
    document.body,
  );
}
