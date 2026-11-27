import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Drop-in for a native <select> whose open list matches the dark page theme (a native list is drawn by
 * the browser / OS and can't be styled). Listbox pattern: ↑ ↓ Home End move, Enter / Space pick,
 * Esc / Tab / outside click close, typing a letter jumps to the next option starting with it.
 * `labelId` points at the visible label element.
 */
export default function ThemedSelect({ value, options, onChange, labelId }) {
  const id = useId();
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const [active, setActive] = useState(selectedIndex);
  const current = options[selectedIndex];

  const openList = () => {
    setActive(selectedIndex);
    setOpen(true);
  };
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) btnRef.current?.focus();
  };
  const pick = (i) => {
    const option = options[i];
    if (option && option.value !== value) onChange(option.value);
    close();
  };

  // Focus the list when it opens; close on an outside click
  useEffect(() => {
    if (!open) return undefined;
    listRef.current?.focus();
    const onDown = (e) => !rootRef.current?.contains(e.target) && close(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the highlighted option in view
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onButtonKey = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openList();
    }
  };
  const onListKey = (e) => {
    const last = options.length - 1;
    const moves = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const order = [...options.slice(active + 1), ...options.slice(0, active + 1)];
      const hit = order.find((o) => o.label.toLowerCase().startsWith(ch));
      if (hit) setActive(options.indexOf(hit));
    }
  };

  return (
    <div ref={rootRef} className={`tl-dd${open ? ' is-open' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className="tl-dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${labelId} ${id}-value`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKey}
      >
        <span id={`${id}-value`}>{current?.label}</span>
        <ChevronDown className="tl-dd-chev w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          className="tl-dd-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={`${id}-opt-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value || 'any'}
              id={`${id}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === selectedIndex}
              className={`tl-dd-opt${i === active ? ' is-active' : ''}${i === selectedIndex ? ' is-selected' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span>{o.label}</span>
              {i === selectedIndex && <Check className="w-4 h-4" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
