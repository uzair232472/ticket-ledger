import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { ArrowLeft, List, Maximize2, Minus, Plus, RefreshCw, Users } from 'lucide-react';
import { tablesOf } from '@venue-core';
import VenueMap from './VenueMap';
import MyTicketsPanel, { MyTicketsButton } from './BookingSummary';
import SeatPopover from './SeatPopover';
import { getEventVisual } from '../../utils/eventMedia';
import { SEAT_STATES, formatPkr, generated, geometryBox, reducedMotion, tierPalette } from './venueTheme';
import './venue.css';
import '../booking/booking.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const MAX_TICKETS = 10;
const CODE = { S: 'sold', H: 'held', B: 'blocked' };

function LegendSeat({ state }) {
  const k = 3.5;
  const sym = {
    mine: `M${-k} 0 L${-k * 0.25} ${k * 0.7} L${k} ${-k * 0.6}`,
    sold: `M${-k} ${-k}L${k} ${k}M${k} ${-k}L${-k} ${k}`,
    blocked: `M${-k} ${k}L${k} ${-k}`,
    held: `M0 ${-k}V0L${k * 0.7} ${k * 0.5}`,
  }[state];
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden="true" className={`tl-vm-svg is-legend`}>
      <g className={`tl-vm-seat is-${state}`} style={{ '--tier': '#16a34a' }}>
        <circle r="6.5" />
        {sym && <path className="tl-vm-sym" d={sym} style={{ strokeWidth: 1.6 }} />}
      </g>
    </svg>
  );
}

export function SeatLegend() {
  return (
    <div className="tl-vm-legend" aria-label="Seat legend">
      {['available', 'mine', 'held', 'sold', 'blocked'].map((s) => (
        <span key={s}>
          <LegendSeat state={s} /> {SEAT_STATES[s].label}
        </span>
      ))}
    </div>
  );
}

/**
 * Attendee booking on an organizer's published venue plan (or the organizer's preview of a draft).
 * Select a section by its shape → the camera zooms to that exact section → choose seats, a table or a
 * quantity. Holds are only shown as yours once the server (or preview) confirms them.
 */
export default function VenueBooking({ adapter, isAuthenticated = true, userId = null, preview = false, eventId, onLoaded }) {
  const navigate = useNavigate();
  const location = useLocation();
  const mapRef = useRef(null);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [focusId, setFocusId] = useState(null);
  const [pending, setPending] = useState(() => new Set());
  const [notice, setNotice] = useState(null); // { tone, text }
  const [announce, setAnnounce] = useState('');
  const [tip, setTip] = useState(null);
  const [roving, setRoving] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [pop, setPop] = useState(null); // seat or table whose popover is open: { type, key }
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const [validating, setValidating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const refetchTimer = useRef(null);
  const prevMine = useRef(new Map());

  const say = useCallback((text, tone = 'info') => {
    setAnnounce(text);
    setNotice({ text, tone });
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await adapter.load();
      offset.current = new Date(d.serverTime).getTime() - Date.now();
      // Tell the customer when a hold lapsed on its own
      const nextMine = new Map((d.mine || []).map((m) => [m.key, m]));
      const lost = [...prevMine.current.values()].filter((m) => !nextMine.has(m.key));
      const expired = lost.filter((m) => new Date(m.lockedUntil).getTime() <= Date.now() + offset.current + 1000);
      if (expired.length) say(`${expired.length === 1 ? 'A hold' : `${expired.length} holds`} expired and ${expired.length === 1 ? 'was' : 'were'} released.`, 'warn');
      prevMine.current = nextMine;
      // Keeps the site-wide hold countdown (HoldBar) in step with this page
      window.dispatchEvent(new Event('tl:holds-changed'));
      setData(d);
      setLoadError('');
      onLoaded?.(d);
      return d;
    } catch (e) {
      setLoadError(e.message);
      return null;
    }
  }, [adapter, say, onLoaded]);

  useEffect(() => {
    load();
  }, [load]);

  const scheduleRefetch = useCallback(() => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(load, 700);
  }, [load]);

  // Live updates: patch the map immediately, then reconcile counts and holds with the server
  useEffect(() => {
    if (!adapter.live || !eventId) return undefined;
    const socket = io(API_BASE_URL, { transports: ['websocket', 'polling'] });
    let connectedOnce = false;
    const patch = (changes) => {
      setData((d) => {
        if (!d?.unavailable) return d;
        const unavailable = { ...d.unavailable };
        for (const c of changes) {
          if (!c.key) continue;
          if (c.lockedByUserId && c.lockedByUserId === userId) continue;
          if (c.status === 'AVAILABLE') delete unavailable[c.key];
          else unavailable[c.key] = c.status === 'SOLD' ? 'S' : c.status === 'BLOCKED' ? 'B' : 'H';
        }
        return { ...d, unavailable };
      });
      scheduleRefetch();
    };
    socket.on('connect', () => {
      if (connectedOnce) load(); // reconnect: refresh availability and our holds
      connectedOnce = true;
    });
    socket.on('seat:status_change', (p) => p.eventId === eventId && patch([p]));
    socket.on('seat:status_batch', (p) => p.eventId === eventId && patch(p.seats || []));
    socket.on('venue:published', (p) => p.eventId === eventId && load());
    return () => {
      socket.disconnect();
      clearTimeout(refetchTimer.current);
    };
  }, [adapter, eventId, userId, load, scheduleRefetch]);

  // Hold countdown (from the server's own expiry times; never restarted by navigation). Seats already in
  // a checkout keep the same reservation, so they count too.
  const mine = useMemo(() => data?.mine || [], [data]);
  const earliest = useMemo(() => {
    const t = mine.map((m) => new Date(m.lockedUntil).getTime());
    return t.length ? Math.min(...t) : null;
  }, [mine]);
  useEffect(() => {
    if (!earliest) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [earliest]);
  const secondsLeft = earliest ? Math.max(0, Math.round((earliest - (now + offset.current)) / 1000)) : null;
  useEffect(() => {
    if (secondsLeft === 0) load();
  }, [secondsLeft, load]);

  const layout = data?.layout?.data || null;
  // The map area takes the drawn plan's own proportions (plus the camera's fit padding), so the whole
  // venue fills the available width instead of shrinking into a fixed, shallow box
  const planRatio = useMemo(() => {
    if (!layout) return null;
    const b = geometryBox(layout);
    return `${Math.round(b.w * 1.12)} / ${Math.round(b.h * 1.12)}`;
  }, [layout]);
  const tiers = useMemo(() => tierPalette(data?.event?.tiers || []), [data]);
  const sectionById = useMemo(() => Object.fromEntries((layout?.sections || []).map((s) => [s.id, s])), [layout]);
  const focused = focusId ? sectionById[focusId] : null;
  const mineByKey = useMemo(() => new Map(mine.map((m) => [m.key, m])), [mine]);

  // Per-section availability and the text shown on the plan
  const sectionInfo = useCallback(
    (s) => {
      const st = data?.sections?.[s.id] || { total: 0, available: 0 };
      const tier = tiers[s.tierId];
      const whole = s.booking === 'tables' && tablesOf(s).mode === 'whole';
      let available = st.available;
      let unit = 'seat';
      if (s.booking === 'ga') unit = 'place';
      if (whole) {
        unit = 'table';
        const g = generated(s);
        available = g.tables.filter((t) => t.seatKeys.every((k) => !data?.unavailable?.[k] && !mineByKey.has(k))).length;
      }
      const mineHere = mine.filter((m) => m.sectionId === s.id).length;
      const status = !st.total ? 'unavailable' : available === 0 && !mineHere ? 'soldout' : 'available';
      const price = tier ? (whole ? `${formatPkr(tier.price)} / seat` : formatPkr(tier.price)) : '';
      return {
        status,
        available,
        unit,
        price,
        tier,
        sub: status === 'soldout' ? 'Sold out' : status === 'unavailable' ? 'Not on sale' : price,
      };
    },
    [data, tiers, mine, mineByKey]
  );

  const describeSection = useCallback(
    (s, meta) => `${s.name}${s.level > 1 ? `, level ${s.level}` : ''}. ${meta.status === 'soldout' ? 'Sold out' : meta.status === 'unavailable' ? 'Not on sale' : `${meta.price}, ${meta.available} ${meta.unit}${meta.available === 1 ? '' : 's'} available`}. Press Enter to open.`,
    []
  );

  // Seat states for the focused section only (level of detail)
  const seatStates = useMemo(() => {
    if (!focused || !data) return null;
    const out = {};
    const prefix = `${focused.id}/`;
    for (const [k, code] of Object.entries(data.unavailable || {})) if (k.startsWith(prefix)) out[k] = CODE[code];
    for (const m of mine) if (m.sectionId === focused.id) out[m.key] = 'mine';
    for (const k of pending) if (k.startsWith(prefix)) out[k] = 'pending';
    return out;
  }, [focused, data, mine, pending]);

  const tableStates = useMemo(() => {
    if (!focused || focused.booking !== 'tables' || tablesOf(focused).mode !== 'whole') return null;
    const out = {};
    for (const t of generated(focused).tables) {
      const states = t.seatKeys.map((k) => seatStates?.[k] || 'available');
      out[t.key] = pending.has(t.key) ? 'pending' : states.every((x) => x === 'mine') ? 'mine' : states.includes('sold') ? 'sold' : states.includes('held') || states.includes('mine') ? 'held' : states.includes('blocked') ? 'blocked' : 'available';
    }
    return out;
  }, [focused, seatStates, pending]);

  const priceOf = (s) => tiers[s?.tierId]?.price || 0;
  const describeSeat = useCallback(
    ({ seat, table, state }) => {
      const p = formatPkr(priceOf(focused));
      if (table) {
        const n = table.seatKeys.length;
        return `${table.label}, ${n} seats, ${formatPkr(priceOf(focused) * n)} for the table. ${SEAT_STATES[state]?.label || state}.`;
      }
      const where = seat.tableKey ? `${seat.row}, seat ${seat.number}` : `Row ${seat.row}, seat ${seat.number}`;
      return `${where}, ${p}. ${SEAT_STATES[state]?.label || state}.`;
    },
    [focused, tiers]
  );

  const requireLogin = () => {
    if (preview || isAuthenticated) return false;
    say('Sign in to hold seats. Your choice of section is kept.', 'info');
    navigate('/login', { state: { from: location.pathname } });
    return true;
  };

  const run = async (busyKey, fn, okText) => {
    setPending((p) => new Set(p).add(busyKey));
    try {
      await fn();
      await load();
      if (okText) say(okText, 'ok');
    } catch (e) {
      say(e.message, 'error');
      await load();
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(busyKey);
        return n;
      });
    }
  };

  const toggleSeat = (key) => {
    if (!focused) return;
    const seat = generated(focused).seats.find((s) => s.key === key);
    if (!seat) return;
    setRoving(key);
    const state = seatStates?.[key] || (seat.blocked ? 'blocked' : 'available');
    const label = seat.tableKey ? `${seat.row}, seat ${seat.number}` : `Row ${seat.row}, seat ${seat.number}`;
    if (state === 'pending') return;
    if (state !== 'available' && state !== 'mine') return say(`${label} is ${SEAT_STATES[state].label.toLowerCase()}.`, 'info');
    // Available or yours: show the seat's details first; nothing is reserved until "Select"
    setTip(null);
    setPop({ type: 'seat', key, was: state });
  };

  const toggleTable = (tableKey) => {
    const t = generated(focused).tables.find((x) => x.key === tableKey);
    if (!t) return;
    setRoving(tableKey);
    const state = tableStates?.[tableKey];
    if (state === 'pending') return;
    if (state !== 'available' && state !== 'mine') return say(`${t.label} is ${state === 'sold' ? 'sold' : 'not available'}.`, 'info');
    setTip(null);
    setPop({ type: 'table', key: tableKey, was: state });
  };

  // ---------- Seat popover ----------
  const popInfo = useMemo(() => {
    if (!pop || !focused) return null;
    const tier = tiers[focused.tierId];
    if (pop.type === 'table') {
      const t = generated(focused).tables.find((x) => x.key === pop.key);
      if (!t) return null;
      const raw = tableStates?.[pop.key];
      const state = raw === 'pending' ? pop.was : raw;
      const inCheckout = state === 'mine' && t.seatKeys.some((k) => mineByKey.get(k)?.inCheckout);
      return {
        title: `${focused.name}, ${t.label}`,
        facts: [['Section', focused.name], ['Table', t.number], ['Seats', t.seatKeys.length]],
        tier,
        price: (tier?.price || 0) * t.seatKeys.length,
        state: inCheckout ? 'checkout' : state === 'mine' ? 'mine' : state === 'available' ? 'available' : 'none',
        note: inCheckout ? 'This table is in your unfinished checkout.' : state === 'mine' ? 'Reserved for you. The whole table is sold together.' : `The whole table is sold together: ${t.seatKeys.length} × ${formatPkr(tier?.price)}.`,
        keys: t.seatKeys,
        label: t.label,
      };
    }
    const seat = generated(focused).seats.find((s) => s.key === pop.key);
    if (!seat) return null;
    const raw = seatStates?.[pop.key] || (seat.blocked ? 'blocked' : 'available');
    const state = raw === 'pending' ? pop.was : raw;
    const hold = mineByKey.get(pop.key);
    return {
      title: `${focused.name}, row ${seat.row}, seat ${seat.number}`,
      facts: [['Section', focused.name], [seat.tableKey ? 'Table' : 'Row', seat.row], ['Seat', seat.number]],
      tier,
      price: tier?.price || 0,
      state: hold?.inCheckout ? 'checkout' : state === 'mine' ? 'mine' : state === 'available' ? 'available' : 'none',
      note: hold?.inCheckout ? 'This seat is in your unfinished checkout.' : state === 'mine' ? 'Reserved for you.' : state === 'available' ? null : `${SEAT_STATES[state]?.label || 'Not available'}.`,
      keys: [pop.key],
      label: seat.tableKey ? `${seat.row}, seat ${seat.number}` : `Row ${seat.row}, seat ${seat.number}`,
    };
  }, [pop, focused, tiers, tableStates, seatStates, mineByKey]);

  const closePop = useCallback(() => {
    const key = pop?.key;
    setPop(null);
    if (key) requestAnimationFrame(() => mapRef.current?.svg()?.querySelector(`[data-seat="${CSS.escape(key)}"], [data-table="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }));
  }, [pop]);

  // The seat was taken or released elsewhere while its popover was open
  useEffect(() => {
    if (pop && popInfo && popInfo.state === 'none') {
      say(`${popInfo.label} is no longer available.`, 'warn');
      setPop(null);
    }
  }, [pop, popInfo, say]);

  const selectFromPop = async () => {
    if (!popInfo) return;
    if (requireLogin()) return;
    if (mine.length + popInfo.keys.length > MAX_TICKETS) return say(`You can hold at most ${MAX_TICKETS} tickets at a time.`, 'warn');
    const body = pop.type === 'table' ? { tableKey: pop.key } : { key: pop.key };
    await run(pop.key, () => adapter.hold(body), `${popInfo.label} added to My tickets.`);
    closePop();
  };

  const removeFromPop = async () => {
    if (!popInfo) return;
    await run(pop.key, () => adapter.release(popInfo.keys), `${popInfo.label} removed from My tickets.`);
    closePop();
  };

  const setGa = (section, quantity) => {
    if (requireLogin()) return;
    run(`ga:${section.id}`, () => adapter.hold({ sectionId: section.id, quantity }), quantity ? `${quantity} place${quantity === 1 ? '' : 's'} held in ${section.name}.` : `Places in ${section.name} released.`);
  };

  // ---------- Navigation between overview and a section ----------
  const openSection = useCallback(
    (s, { fromKeyboard = false } = {}) => {
      if (!s) return;
      setFocusId(s.id);
      setTip(null);
      const g = generated(s);
      const first = s.booking === 'tables' && tablesOf(s).mode === 'whole' ? g.tables[0]?.key : g.seats.find((x) => !x.blocked)?.key;
      setRoving(first || null);
      setAnnounce(`${s.name} opened. ${s.booking === 'ga' ? 'Choose a quantity.' : 'Use the arrow keys to move between seats, Enter to select, Escape to return to the full venue.'}`);
      mapRef.current?.fitSection(s.id, { duration: reducedMotion() ? 0 : 0.95 }).then(() => {
        if (fromKeyboard && first) mapRef.current?.svg()?.querySelector(`[data-seat="${CSS.escape(first)}"], [data-table="${CSS.escape(first)}"]`)?.focus();
      });
    },
    []
  );
  const backToVenue = useCallback(() => {
    setFocusId(null);
    setRoving(null);
    setAnnounce('Showing the full venue.');
    mapRef.current?.fitAll({ duration: reducedMotion() ? 0 : 0.85 });
  }, []);

  // Keep the map's camera on the section when the plan re-publishes and the section still exists
  useEffect(() => {
    if (focusId && layout && !sectionById[focusId]) backToVenue();
  }, [layout, focusId, sectionById, backToVenue]);

  // Arrow-key navigation between seats (rows follow the plan's own geometry)
  const onMapKeyDown = (e) => {
    if (e.key === 'Escape' && focused) {
      e.preventDefault();
      return backToVenue();
    }
    if (!focused || !roving) return;
    const g = generated(focused);
    const isTable = tableStates != null;
    const target = e.target.closest?.('[data-seat],[data-table]');
    if ((e.key === 'Enter' || e.key === ' ') && target) {
      e.preventDefault();
      return isTable ? toggleTable(roving) : toggleSeat(roving);
    }
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    let next;
    if (isTable) {
      const i = g.tables.findIndex((t) => t.key === roving);
      next = g.tables[Math.min(g.tables.length - 1, Math.max(0, i + d[0] + d[1] * (tablesOf(focused).columns || 1)))]?.key;
    } else {
      const cur = g.seats.find((s) => s.key === roving);
      if (!cur) return;
      if (d[0]) next = g.seats.find((s) => s.rowIndex === cur.rowIndex && s.position === cur.position + d[0])?.key;
      else {
        const row = g.seats.filter((s) => s.rowIndex === cur.rowIndex + d[1]);
        if (row.length) {
          const curRow = g.seats.filter((s) => s.rowIndex === cur.rowIndex).length;
          const pos = Math.round((cur.position / Math.max(1, curRow - 1)) * (row.length - 1));
          next = row.find((s) => s.position === pos)?.key;
        }
      }
    }
    if (next) {
      setRoving(next);
      requestAnimationFrame(() => mapRef.current?.svg()?.querySelector(`[data-seat="${CSS.escape(next)}"], [data-table="${CSS.escape(next)}"]`)?.focus());
    }
  };

  const removeLine = (line) => {
    const busy = line.keys[0];
    if (line.type === 'ga') return setGa(sectionById[line.sectionId], 0);
    return run(busy, () => adapter.release(line.keys), `${line.section} selection removed.`);
  };

  // "Get tickets": re-read holds from the server, make sure every selected ticket is still reserved for
  // this customer, then open the existing checkout (which loads seats and prices from the server again).
  const getTickets = async () => {
    if (preview || validating) return;
    if (!isAuthenticated) return requireLogin();
    setValidating(true);
    const before = new Set(mine.map((m) => m.key));
    const d = await load();
    setValidating(false);
    if (!d) return say('We couldn’t check your reservation. Please try again.', 'error');
    const fresh = d.mine || [];
    const serverNow = new Date(d.serverTime).getTime();
    const lapsed = fresh.filter((m) => new Date(m.lockedUntil).getTime() <= serverNow + 5000);
    const lost = [...before].filter((k) => !fresh.some((m) => m.key === k));
    if (!fresh.length) return say('Your reservation has expired, so the seats were released. Please select your seats again.', 'warn');
    if (lost.length) return say(`${lost.length === 1 ? 'One ticket' : `${lost.length} tickets`} in your selection ${lost.length === 1 ? 'is' : 'are'} no longer reserved for you. Please review My tickets before continuing.`, 'warn');
    if (lapsed.length) return say('Part of your reservation has just expired. Remove those tickets or select them again.', 'warn');
    if (fresh.length > MAX_TICKETS) return say(`You can buy at most ${MAX_TICKETS} tickets per order.`, 'warn');
    navigate(`/events/${eventId}/checkout`, { state: { eventId, from: 'seats' } });
  };

  if (loadError && !data) {
    return (
      <div className="tl-bk-panel tl-bk-empty" role="alert">
        <p className="tl-bk-h3">We couldn’t load the venue plan</p>
        <p className="tl-bk-muted">{loadError}</p>
        <button type="button" onClick={load} className="tl-bk-btn">
          <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }
  if (!data || !layout) {
    return <div className="tl-vb-skeleton" aria-busy="true" aria-label="Loading venue plan" />;
  }

  const info = focused ? sectionInfo(focused) : null;
  const gaHeld = focused?.booking === 'ga' ? mine.filter((m) => m.sectionId === focused.id).length : 0;
  const gaMax = focused?.booking === 'ga' ? Math.min(gaHeld + (info?.available || 0), gaHeld + MAX_TICKETS - mine.length) : 0;
  const tierList = Object.values(tiers).filter((t) => layout.sections.some((s) => s.tierId === t.id));
  const popImage = data.event ? getEventVisual(data.event).imageUrl : null;

  return (
    <div className="tl-vb">
      {/* Only the My tickets button sits above the plan, right-aligned in the normal page flow */}
      <div className="tl-vb-top">
        <div className="tl-vb-mine-wrap">
          <MyTicketsButton count={mine.length} open={ticketsOpen} onToggle={() => setTicketsOpen((o) => !o)} secondsLeft={secondsLeft} controls="tl-vb-panel" />
          {ticketsOpen && (
            <MyTicketsPanel
              id="tl-vb-panel"
              mine={mine}
              secondsLeft={secondsLeft}
              busyKeys={pending}
              preview={preview}
              validating={validating}
              onRemove={removeLine}
              onGetTickets={getTickets}
              onFocusSection={(id) => {
                setTicketsOpen(false);
                openSection(sectionById[id]);
              }}
              onClose={() => setTicketsOpen(false)}
            />
          )}
        </div>
      </div>

      {!focused && tierList.length > 0 && (
        <ul className="tl-vb-tiers" aria-label="Price categories">
          {tierList.map((t) => (
            <li key={t.id}>
              <span className="tl-vb-dot" style={{ background: t.color }} aria-hidden="true" /> {t.name} <strong>{formatPkr(t.price)}</strong>
            </li>
          ))}
        </ul>
      )}
      {tableStates && <p className="tl-vb-hint-line"><Users className="w-3.5 h-3.5" aria-hidden="true" /> Tables are sold whole: choose a table to see its {tablesOf(focused).seatsPerTable} seats and price.</p>}

      <div className={`tl-vb-stage${pop ? ' has-pop' : ''}`} style={{ aspectRatio: planRatio }}>
        <VenueMap
          ref={mapRef}
          layout={layout}
          tiers={tiers}
          mode="book"
          fitTo="geometry"
          focusId={focusId}
          dim
          sectionMeta={sectionInfo}
          describeSection={describeSection}
          seatStates={seatStates}
          tableStates={tableStates}
          rovingKey={roving}
          describeSeat={describeSeat}
          onSectionClick={(s, e) => (s.id === focusId ? null : openSection(s, { fromKeyboard: e?.type === 'keydown' }))}
          onSeatClick={toggleSeat}
          onTableClick={toggleTable}
          onBackgroundClick={() => focused && null}
          onHover={(s, pt) => setTip(s && s.id !== focusId && !pop ? { s, pt } : null)}
          onKeyDown={onMapKeyDown}
          ariaLabel={`${data.event.name} venue plan`}
        />
        {tip && (() => {
          const m = sectionInfo(tip.s);
          return (
            <div className="tl-vm-tip" style={{ left: tip.pt.x, top: tip.pt.y }} role="presentation">
              <div className="tl-vm-tip-name">{tip.s.name}</div>
              <div className="tl-vm-tip-row"><span>{m.tier?.name || 'Price'}</span><strong>{m.price || '—'}</strong></div>
              <div className="tl-vm-tip-row">
                <span>Available</span>
                <strong>{m.status === 'soldout' ? 'Sold out' : m.status === 'unavailable' ? 'Not on sale' : `${m.available.toLocaleString('en-PK')} ${m.unit}${m.available === 1 ? '' : 's'}`}</strong>
              </div>
            </div>
          );
        })()}
        {/* Inside a section: a minimal way back, plus the quantity picker for standing zones */}
        {focused && (
          <div className="tl-vb-mapnav">
            <button type="button" onClick={backToVenue} className="tl-vb-backlink" aria-label={`Back to full venue (leave ${focused.name})`}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Full venue
            </button>
            {focused.booking === 'ga' && (
              <div className="tl-vb-stepper" role="group" aria-label={`Tickets for ${focused.name}`}>
                <button type="button" onClick={() => setGa(focused, gaHeld - 1)} disabled={gaHeld <= 0 || pending.has(`ga:${focused.id}`)} aria-label="One fewer ticket">
                  <Minus className="w-4 h-4" aria-hidden="true" />
                </button>
                <span aria-live="polite">{pending.has(`ga:${focused.id}`) ? '…' : gaHeld} <small>selected</small></span>
                <button type="button" onClick={() => setGa(focused, gaHeld + 1)} disabled={gaHeld >= gaMax || pending.has(`ga:${focused.id}`)} aria-label="One more ticket">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}
        {/* Anchored to the map viewport (not the drawing), so they stay put while the plan pans or zooms */}
        <div className="tl-vb-zoom" role="group" aria-label="Map zoom">
          <button type="button" className="tl-vb-fit" onClick={() => (focused ? mapRef.current?.fitSection(focused.id) : mapRef.current?.fitAll())} aria-label={focused ? 'Fit section to view' : 'Fit venue to view'} title="Fit to view">
            <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <div className="tl-vb-zoom-pair">
            <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in" title="Zoom in"><Plus className="w-4 h-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out" title="Zoom out"><Minus className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        </div>
        <span className="tl-vb-hint tl-vb-hide-sm">Drag to move · Ctrl + scroll to zoom</span>
        {popInfo && (
          <SeatPopover
            key={pop.key}
            info={popInfo}
            image={popImage}
            busy={pending.has(pop.key)}
            onSelect={selectFromPop}
            onRemove={removeFromPop}
            onClose={closePop}
          />
        )}
      </div>

      {notice && <p className={`tl-bk-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : undefined}>{notice.text}</p>}
      <div className="tl-vb-foot">
        <SeatLegend />
        <button type="button" className="tl-bk-link" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
          <List className="w-3.5 h-3.5" aria-hidden="true" /> {listOpen ? 'Hide section list' : 'Browse sections as a list'}
        </button>
      </div>
      {listOpen && (
        <ul className="tl-vb-list" aria-label="Sections">
          {layout.sections.map((s) => {
            const m = sectionInfo(s);
            return (
              <li key={s.id}>
                <button type="button" onClick={() => openSection(s, { fromKeyboard: true })}>
                  <strong>{s.name}</strong>
                  <span>{m.price} · {m.status === 'soldout' ? 'Sold out' : `${m.available} ${m.unit}${m.available === 1 ? '' : 's'} available`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="tl-sr" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}
