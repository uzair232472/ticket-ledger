import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import api from '../../utils/api';

// Dates are Pakistan days (PKT, UTC+5, no daylight saving). Bookings at the same venue need an hour between
// them, so the hour either side of a booking is taken too.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GAP = HOUR;
// A day counts as fully booked when no free stretch of this length is left in it
const USABLE = 2 * HOUR;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const dayStart = (iso) => Date.parse(`${iso}T00:00:00+05:00`);
export const pktInstant = (iso, hhmm) => (iso && hhmm ? Date.parse(`${iso}T${hhmm}:00+05:00`) : NaN);
const todayIso = () => new Date(Date.now() + 5 * HOUR).toISOString().slice(0, 10);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
const fmtDay = (iso) => new Date(dayStart(iso)).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Karachi' });

/** Taken stretches of one day (bookings plus their one-hour gap), merged, and the free stretches between them. */
function dayPlan(iso, bookings) {
  const start = dayStart(iso);
  const end = start + DAY;
  const taken = bookings
    .map((b) => [Math.max(b.start - GAP, start), Math.min(b.end + GAP, end)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
    .reduce((out, [s, e]) => {
      const last = out[out.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else out.push([s, e]);
      return out;
    }, []);
  const free = [];
  let cursor = start;
  taken.forEach(([s, e]) => {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  });
  if (cursor < end) free.push([cursor, end]);
  const longest = free.reduce((n, [s, e]) => Math.max(n, e - s), 0);
  const here = bookings.filter((b) => b.start < end && b.end > start);
  return { here, free, state: !here.length ? 'free' : longest < USABLE ? 'full' : 'partly' };
}

const describe = (b) => {
  if (b.formLabel) return `${b.formLabel} in this form`;
  if (!b.own) return b.space ? `Booked (${b.space})` : 'Booked';
  return `${b.name} · ${b.reserved ? 'your reservation' : b.status === 'PENDING_APPROVAL' ? 'your request, held for you' : 'your booking'}`;
};

/**
 * Month calendar of a venue's bookings, like a flight date picker: each day shows free, partly booked or
 * fully booked, and clicking one picks it. Below, the chosen day's bookings and free times.
 * `formBookings` are other dates in this form at the same venue ({ formLabel, start, end }).
 */
export default function AvailabilityCalendar({ city, placeId, space, date, onPick, formBookings = [], refreshKey }) {
  const today = todayIso();
  const initial = (date || today).slice(0, 7);
  const [month, setMonth] = useState(initial); // "2026-11"
  const [bookings, setBookings] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  // Follow the picked date when it moves to another month
  useEffect(() => {
    if (date) setMonth(date.slice(0, 7));
  }, [date]);

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  useEffect(() => {
    if (!placeId || !city) return undefined;
    let alive = true;
    setStatus('loading');
    api
      .get('/prebook/availability', { params: { city, placeId, space: space || '', from: isoOf(y, m - 1, 1), to: isoOf(y, m - 1, daysInMonth) } })
      .then((res) => {
        if (!alive) return;
        setBookings(res.data.data.bookings.map((b) => ({ ...b, start: Date.parse(b.start), end: Date.parse(b.end) })));
        setStatus('ready');
      })
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
    };
  }, [city, placeId, space, y, m, daysInMonth, refreshKey]);

  const all = useMemo(() => [...bookings, ...formBookings], [bookings, formBookings]);
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => {
      const iso = isoOf(y, m - 1, i + 1);
      return { iso, day: i + 1, past: iso < today, ...dayPlan(iso, all) };
    }),
    [all, y, m, daysInMonth, today],
  );
  // Monday-first grid
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const selected = date && date.startsWith(month) ? days.find((d) => d.iso === date) : null;

  const shift = (delta) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-PK', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="tl-ac">
      <div className="tl-ac-head">
        <button type="button" className="tl-ac-nav" onClick={() => shift(-1)} disabled={month <= today.slice(0, 7)} aria-label="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <strong aria-live="polite">{monthName}</strong>
        {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" aria-label="Loading bookings" style={{ color: 'var(--st-green)' }} />}
        <button type="button" className="tl-ac-nav" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {status === 'error' && <p className="tl-lp-msg" role="status">Couldn’t load this venue’s bookings. Your dates are still checked when you pick a time.</p>}

      <div className="tl-ac-grid" role="grid" aria-label={`${monthName} availability`}>
        {WEEKDAYS.map((w) => <span key={w} className="tl-ac-wd" aria-hidden="true">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} aria-hidden="true" />)}
        {days.map((d) => {
          const label = d.past ? 'past' : d.state === 'free' ? 'free' : d.state === 'full' ? 'fully booked' : 'partly booked';
          return (
            <button
              key={d.iso}
              type="button"
              className={`tl-ac-day is-${d.past ? 'past' : d.state}${d.iso === date ? ' is-selected' : ''}`}
              disabled={d.past || status !== 'ready'}
              onClick={() => onPick(d.iso)}
              aria-pressed={d.iso === date}
              aria-label={`${fmtDay(d.iso)}: ${label}`}
            >
              {d.day}
              {d.here.some((b) => b.own || b.formLabel) && <i className="tl-ac-mine" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <ul className="tl-ac-legend" aria-label="Legend">
        <li><i className="is-free" /> Free</li>
        <li><i className="is-partly" /> Partly booked</li>
        <li><i className="is-full" /> Fully booked</li>
        <li><i className="tl-ac-mine" /> Your dates</li>
      </ul>

      {selected && (
        <div className="tl-ac-day-info" aria-live="polite">
          <strong>{fmtDay(selected.iso)}</strong>
          {selected.here.length === 0 ? (
            <p>Nothing is booked here this day. Any time works.</p>
          ) : (
            <>
              <ul>
                {selected.here.map((b, i) => (
                  <li key={i}>
                    <span className={`tl-ac-dot${b.own || b.formLabel ? ' is-mine' : ''}`} aria-hidden="true" />
                    {fmtTime(b.start)} – {fmtTime(b.end)}{b.end - b.start > DAY || b.end > dayStart(selected.iso) + DAY ? ' (runs over more than one day)' : ''} · {describe(b)}
                  </li>
                ))}
              </ul>
              <p>
                {selected.free.length
                  ? <>Free for your event: {selected.free.map(([s, e]) => `${fmtTime(s)} – ${e >= dayStart(selected.iso) + DAY ? 'midnight' : fmtTime(e)}`).join(', ')}.</>
                  : 'No time is free this day. Pick another date.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
