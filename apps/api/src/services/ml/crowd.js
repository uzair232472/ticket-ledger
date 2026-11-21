/**
 * Crowd flow: entries per gate per 5-minute slot, from 90 minutes before the start to 60 minutes after
 * (same slots as crowd_flow.csv). Scored once per event, 2 to 26 hours before it starts.
 *
 * Baseline (mirrors ml/baselines.py crowd_features_and_baseline): average arrival curve of past finished
 * events (same type with >= 5 events, else all with >= 5, else flat) x expected attendees (tickets sold
 * x their average show rate, else 0.85) x the gate's share of the event's gate capacity. Counted
 * entries: ENTRY scans admitted (GREEN), first entry only (not re-entry), not reversed.
 */
import prisma from '../../config/prisma.js';
import { COUNTRY, MissingInput, localParts, startOf } from './features.js';

export const SLOTS = Array.from({ length: 30 }, (_, i) => -90 + 5 * i); // -90 .. +55
const MIN_EVENTS = 5;
const MIN = 60_000;
const DAY = 86_400_000;
const LIVE = ['ACTIVE', 'SCANNED'];

export const slotSubject = (gateId, minutes) => `${gateId}|${minutes}`;
export function parseSlotSubject(id) {
  const [gateId, m] = id.split('|');
  return { gateId, minutes: Number(m) };
}

/** Entries counted per slot for one event (all gates or one gate). */
export async function entriesBySlot(eventId, start, gateId = null, db = prisma) {
  const rows = await db.checkIn.findMany({
    where: {
      eventId, ...(gateId ? { gateId } : {}), direction: 'ENTRY', result: 'GREEN', reentry: false, reversedAt: null,
      scannedAt: { gte: new Date(start.getTime() + SLOTS[0] * MIN), lt: new Date(start.getTime() + (SLOTS.at(-1) + 5) * MIN) },
    },
    select: { scannedAt: true, gateId: true },
  });
  const counts = new Array(SLOTS.length).fill(0);
  for (const r of rows) counts[Math.floor((r.scannedAt - start) / (5 * MIN) + 18)] += 1;
  return counts;
}

/** As-of arrival curves and show rates from events that finished (start + 1 day) before `at`. */
export async function arrivalHistory(at) {
  const scanned = await prisma.checkIn.findMany({
    where: { direction: 'ENTRY', result: 'GREEN', scannedAt: { lt: at } }, select: { eventId: true }, distinct: ['eventId'],
  });
  const events = await prisma.event.findMany({
    where: { id: { in: scanned.map((s) => s.eventId) }, cancelledAt: null },
    select: { id: true, type: true, date: true, time: true, startsAt: true },
  });
  const groups = new Map(); // key -> {curve, show, n}
  for (const e of events) {
    const start = startOf(e);
    if (start.getTime() + DAY > at.getTime()) continue;
    const counts = await entriesBySlot(e.id, start);
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) continue;
    const sold = await prisma.ticket.count({ where: { eventId: e.id, status: { in: LIVE } } });
    for (const key of [`t:${e.type}`, 'all']) {
      if (!groups.has(key)) groups.set(key, { curve: new Array(SLOTS.length).fill(0), show: 0, n: 0 });
      const g = groups.get(key);
      counts.forEach((c, i) => { g.curve[i] += c / total; });
      g.show += total / Math.max(sold, 1);
      g.n += 1;
    }
  }
  return (type) => {
    for (const key of [`t:${type}`, 'all']) {
      const g = groups.get(key);
      if (g && g.n >= MIN_EVENTS) return { curve: g.curve.map((x) => x / g.n), show: g.show / g.n, basis: key, events: g.n };
    }
    return { curve: new Array(SLOTS.length).fill(1 / SLOTS.length), show: 0.85, basis: 'default', events: 0 };
  };
}

/**
 * Can crowd flow be forecast for this event? Needs at least one active gate, and every active gate needs its
 * capacity per hour (the model splits arrivals by capacity share; a missing capacity is never guessed).
 * gates: [{name, active, capacityPerHour}]. Used by the gate dashboard, the gate preflight and the exporter.
 */
export function crowdReadiness(gates) {
  const active = (gates || []).filter((g) => g.active !== false);
  const missing = active.filter((g) => !(g.capacityPerHour > 0)).map((g) => g.name ?? g.id);
  if (!active.length) return { ready: false, reason: 'NO_ACTIVE_GATES', missingCapacity: [] };
  if (missing.length) return { ready: false, reason: 'GATE_CAPACITY_MISSING', missingCapacity: missing };
  return { ready: true, reason: null, missingCapacity: [] };
}

/** One row per active gate per slot, as of `at`. Throws MissingInput when a gate has no capacity set. */
export async function crowdRows({ eventId, at, history }) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, type: true, city: true, date: true, time: true, startsAt: true, gates: { where: { active: true }, select: { id: true, capacityPerHour: true } } },
  });
  if (!event || !event.gates.length) throw new MissingInput('event has no active gates');
  const noCap = event.gates.filter((g) => !(g.capacityPerHour > 0));
  if (noCap.length) throw new MissingInput(`${noCap.length} gate(s) have no capacity per hour set`);
  const start = startOf(event);
  const lp = localParts(start);
  const sold = await prisma.ticket.count({ where: { eventId, status: { in: LIVE }, createdAt: { lt: at } } });
  const totalCap = event.gates.reduce((a, g) => a + g.capacityPerHour, 0);
  const base = (history || (await arrivalHistory(at)))(event.type);
  const rows = [];
  for (const g of event.gates) {
    const share = g.capacityPerHour / totalCap;
    SLOTS.forEach((m, i) => {
      rows.push({
        gateId: g.id, minutes: m, start,
        baseline: sold * base.show * base.curve[i] * share, basis: base.basis,
        features: {
          event_type: event.type, city: event.city, country: COUNTRY, day_of_week: lp.weekday, start_hour: lp.hour,
          minutes_from_start: m, tickets_sold: sold, gate_count: event.gates.length,
          gate_capacity_per_hour: g.capacityPerHour, gate_capacity_share: Math.round(share * 1e6) / 1e6,
          baseline_scans: Math.round(sold * base.show * base.curve[i] * share * 1e4) / 1e4,
        },
      });
    });
  }
  return rows;
}
