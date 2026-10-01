import api from '../../utils/api';
import { layoutInventory } from '@venue-core';

const HOLD_MS = 600 * 1000;
const MAX = 10;

/** Live booking: the server is the source of truth for the plan, prices, availability and holds. */
export function liveAdapter(eventId) {
  const unwrap = (p) =>
    p.then(
      (r) => r.data.data,
      (err) => {
        throw new Error(err.response?.data?.message || 'Something went wrong. Please try again.');
      }
    );
  return {
    live: true,
    load: () => unwrap(api.get(`/venues/event/${eventId}`)),
    hold: (body) => unwrap(api.post(`/venues/event/${eventId}/holds`, body)),
    release: (keys) => unwrap(api.post(`/venues/event/${eventId}/holds/release`, { keys })),
  };
}

/**
 * Organizer's attendee preview: the same booking experience on the unsaved plan, with simulated holds
 * kept in memory. Nothing is sent to the server and no seats are reserved.
 */
export function previewAdapter({ layout, tiers, event }) {
  const inventory = layoutInventory(layout);
  const byKey = new Map(inventory.map((s) => [s.key, s]));
  const tierById = Object.fromEntries(tiers.map((t) => [t.id, t]));
  const held = new Map();
  const view = (s) => ({
    id: `preview:${s.key}`,
    key: s.key,
    sectionId: s.sectionId,
    section: s.sectionName,
    row: s.row,
    seatNumber: s.number,
    kind: s.kind,
    tableKey: s.tableKey,
    wholeTable: s.wholeTable,
    lockedUntil: new Date(Date.now() + HOLD_MS).toISOString(),
    tier: tierById[s.tierId],
  });
  const room = (n) => {
    if (held.size + n > MAX) throw new Error(`You can hold at most ${MAX} tickets at a time.`);
  };
  const snapshot = () => {
    const sections = {};
    const unavailable = {};
    for (const s of inventory) {
      const st = (sections[s.sectionId] ||= { total: 0, available: 0, held: 0, sold: 0, blocked: 0 });
      st.total++;
      if (s.blocked) {
        st.blocked++;
        unavailable[s.key] = 'B';
      } else if (held.has(s.key)) st.held++;
      else st.available++;
    }
    return {
      event,
      layout: { id: 'preview', version: 'preview', data: layout },
      sections,
      unavailable,
      mine: [...held.values()],
      holdSeconds: HOLD_MS / 1000,
      serverTime: new Date().toISOString(),
    };
  };
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 180));
  return {
    live: false,
    load: () => wait(snapshot()),
    hold: async (body) => {
      if (body.key) {
        const s = byKey.get(body.key);
        if (!s || s.blocked) throw new Error('This seat is not on sale.');
        if (!held.has(s.key)) {
          room(1);
          held.set(s.key, view(s));
        }
        return wait({ holds: [held.get(s.key)] });
      }
      if (body.tableKey) {
        const chairs = inventory.filter((s) => s.tableKey === body.tableKey);
        const missing = chairs.filter((c) => !held.has(c.key));
        room(missing.length);
        missing.forEach((c) => held.set(c.key, view(c)));
        return wait({ holds: chairs.map((c) => held.get(c.key)) });
      }
      const slots = inventory.filter((s) => s.sectionId === body.sectionId);
      const mine = slots.filter((s) => held.has(s.key));
      if (body.quantity > mine.length) {
        const free = slots.filter((s) => !held.has(s.key)).slice(0, body.quantity - mine.length);
        if (free.length < body.quantity - mine.length) throw new Error(`Only ${free.length + mine.length} place(s) are left in this zone.`);
        room(free.length);
        free.forEach((s) => held.set(s.key, view(s)));
      } else {
        mine.slice(body.quantity).forEach((s) => held.delete(s.key));
      }
      return wait({ holds: slots.filter((s) => held.has(s.key)).map((s) => held.get(s.key)) });
    },
    release: async (keys) => {
      const tables = new Set(keys.map((k) => byKey.get(k)).filter((s) => s?.wholeTable).map((s) => s.tableKey));
      let released = 0;
      for (const [k, h] of held) {
        if (keys.includes(k) || (h.tableKey && tables.has(h.tableKey))) {
          held.delete(k);
          released++;
        }
      }
      return wait({ released, inCheckout: 0 });
    },
  };
}
