import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './themed-date.css';

/*
 * Themed date / time pickers for the dark console pages, the partner of ThemedSelect.jsx. Every
 * <input type="date | time | datetime-local"> inside `.tl-aov-root` keeps its markup, value, min / max and
 * onChange; only the picker that opens is ours (the browser's own calendar no longer opens on top of it).
 * Choosing sets the value through the native setter and fires a bubbling `input` event, so React's onChange
 * runs exactly as before. Typing into the field still works; Alt+Down opens the picker from the keyboard.
 * Touch screens keep the operating system's picker.
 */

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
const TYPES = ['date', 'time', 'datetime-local'];
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const parseTime = (s) => {
  const m = /(\d{2}):(\d{2})/.exec(s || '');
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
};
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12

function setValue(input, value) {
  if (input.value === value) return;
  valueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Month grid starting on Monday, six weeks. */
function monthDays(view) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function Calendar({ value, min, max, onPick }) {
  const selected = parseDay(value);
  const [view, setView] = useState(() => {
    const base = selected || parseDay(min) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const today = isoDay(new Date());
  const minDay = min ? min.slice(0, 10) : null;
  const maxDay = max ? max.slice(0, 10) : null;
  const move = (n) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));
  return (
    <div className="tl-tdp-cal">
      <div className="tl-tdp-head">
        <button type="button" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
        <strong aria-live="polite">{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" onClick={() => move(1)} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="tl-tdp-grid" role="grid">
        {WEEKDAYS.map((w) => <span key={w} className="tl-tdp-wd" aria-hidden="true">{w}</span>)}
        {monthDays(view).map((d) => {
          const key = isoDay(d);
          const off = (minDay && key < minDay) || (maxDay && key > maxDay);
          const cls = [
            'tl-tdp-day',
            d.getMonth() !== view.getMonth() && 'is-out',
            key === today && 'is-today',
            selected && key === isoDay(selected) && 'is-selected',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={key}
              type="button"
              className={cls}
              disabled={Boolean(off)}
              aria-pressed={Boolean(selected && key === isoDay(selected))}
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              onClick={() => onPick(key)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeColumns({ value, onPick }) {
  const t = parseTime(value);
  const h24 = t?.h ?? null;
  const pm = h24 != null ? h24 >= 12 : false;
  const h12 = h24 != null ? ((h24 + 11) % 12) + 1 : null;
  const mins = t && !MINUTES.includes(t.m) ? [...MINUTES, t.m].sort((a, b) => a - b) : MINUTES;
  const build = (h, m, isPm) => `${pad((h % 12) + (isPm ? 12 : 0))}:${pad(m)}`;
  const ref = useRef(null);
  useLayoutEffect(() => {
    // Centre the chosen hour and minute in their columns (without scrolling the page)
    ref.current?.querySelectorAll('.tl-tdp-col').forEach((col) => {
      const el = col.querySelector('.is-selected');
      if (el) col.scrollTop = el.offsetTop - col.offsetTop - (col.clientHeight - el.offsetHeight) / 2;
    });
  }, []);
  return (
    <div className="tl-tdp-time" ref={ref}>
      <div className="tl-tdp-col" aria-label="Hour">
        {HOURS.map((h) => (
          <button key={h} type="button" className={h === h12 ? 'is-selected' : undefined} onClick={() => onPick(build(h, t?.m ?? 0, pm))}>{h}</button>
        ))}
      </div>
      <div className="tl-tdp-col" aria-label="Minute">
        {mins.map((m) => (
          <button key={m} type="button" className={t && m === t.m ? 'is-selected' : undefined} onClick={() => onPick(build(h12 ?? 12, m, pm))}>{pad(m)}</button>
        ))}
      </div>
      <div className="tl-tdp-col tl-tdp-col--ampm" aria-label="AM or PM">
        {['AM', 'PM'].map((p) => (
          <button key={p} type="button" className={t && (p === 'PM') === pm ? 'is-selected' : undefined} onClick={() => onPick(build(h12 ?? 12, t?.m ?? 0, p === 'PM'))}>{p}</button>
        ))}
      </div>
    </div>
  );
}

export default function ThemedDateLayer() {
  const [picker, setPicker] = useState(null); // { input, type, rect, value }
  const boxRef = useRef(null);
  const pickerRef = useRef(null);
  pickerRef.current = picker;

  const close = useCallback((refocus = true) => {
    setPicker((p) => {
      if (p && refocus) requestAnimationFrame(() => p.input.focus({ preventScroll: true }));
      return null;
    });
  }, []);

  // Open on a click on the field (or Alt+Down / Enter on it); the browser's own picker stays closed
  useEffect(() => {
    const fine = window.matchMedia?.('(pointer: fine)');
    const target = (el) => {
      const input = el?.closest?.('input');
      return input && TYPES.includes(input.type) && input.closest('.tl-aov-root') && !input.disabled && !input.readOnly ? input : null;
    };
    let opened = 0;
    const open = (input) => { opened += 1; setPicker({ id: opened, input, type: input.type, rect: input.getBoundingClientRect(), value: input.value }); };
    const onDown = (e) => {
      if (e.button !== 0 || (fine && !fine.matches)) return;
      const input = target(e.target);
      if (!input) return;
      e.preventDefault();
      input.focus({ preventScroll: true });
      if (pickerRef.current?.input === input) close(false);
      else open(input);
    };
    // Firefox opens its picker on click: stop that too
    const onClick = (e) => { if ((!fine || fine.matches) && target(e.target)) e.preventDefault(); };
    const onKey = (e) => {
      const input = target(e.target);
      if (!input || pickerRef.current) return;
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        open(input);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [close]);

  // Close on outside click, page scroll, resize or Escape
  useEffect(() => {
    if (!picker) return undefined;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || e.target === picker.input) return;
      close(false);
    };
    const onScroll = (e) => { if (!boxRef.current?.contains(e.target)) close(false); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); close(e.key === 'Escape'); } };
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
  }, [picker?.input, close]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!picker) return null;
  const { input, type, rect } = picker;
  const value = picker.value;
  const [dayPart, timePart] = type === 'datetime-local' ? value.split('T') : type === 'date' ? [value, ''] : ['', value];

  const commit = (next, done) => {
    setValue(input, next);
    if (done) close();
    else setPicker((p) => (p ? { ...p, value: next } : p));
  };
  const pickDay = (day) => {
    if (type === 'date') return commit(day, true);
    return commit(`${day}T${timePart || '12:00'}`, false);
  };
  const pickTime = (time) => {
    if (type === 'time') return commit(time, false);
    return commit(`${dayPart || isoDay(new Date())}T${time}`, false);
  };

  const wide = type === 'datetime-local';
  const width = type === 'time' ? 240 : wide ? 520 : 300;
  const height = type === 'time' ? 300 : 380;
  const below = window.innerHeight - rect.bottom;
  const up = below < height + 16 && rect.top > below;
  const style = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(width, window.innerWidth - 16) - 8)),
    width: Math.min(width, window.innerWidth - 16),
    ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
  };
  const todayIso = isoDay(new Date());
  const min = input.min || '';
  const todayAllowed = (!min || todayIso >= min.slice(0, 10)) && (!input.max || todayIso <= input.max.slice(0, 10));

  return createPortal(
    <div ref={boxRef} className={`tl-tdp${up ? ' is-up' : ''}${wide ? ' is-wide' : ''}`} style={style} role="dialog" aria-label={type === 'time' ? 'Choose a time' : 'Choose a date'}>
      <div className="tl-tdp-body" key={picker.id}>
        {type !== 'time' && <Calendar value={dayPart} min={input.min} max={input.max} onPick={pickDay} />}
        {type !== 'date' && <TimeColumns key={type} value={timePart} onPick={pickTime} />}
      </div>
      <div className="tl-tdp-foot">
        {!input.required && <button type="button" onClick={() => commit('', true)}>Clear</button>}
        {type !== 'time' && todayAllowed && (
          <button type="button" onClick={() => (type === 'date' ? commit(todayIso, true) : pickDay(todayIso))}>Today</button>
        )}
        {type !== 'date' && <button type="button" className="is-primary" onClick={() => close()}>Done</button>}
      </div>
    </div>,
    document.body,
  );
}
