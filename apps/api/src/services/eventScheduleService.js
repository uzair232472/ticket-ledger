import prisma from '../config/prisma.js';

// Event schedules are entered as Pakistan wall-clock time (PKT, UTC+5, no daylight saving) and stored as
// instants in Event.startsAt / Event.endsAt. Two events at the same venue need at least an hour between
// them; different venues (even inside the same campus or stadium complex) never conflict.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
export const MIN_GAP_MS = 60 * 60 * 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
// Events saved before end times existed are assumed to run this long
const LEGACY_DURATION_MS = 3 * 60 * 60 * 1000;

export class ScheduleError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** "19:30", "7:30 PM" or "7:30 PM PKT" → minutes after midnight, or null. */
export function parseTimeOfDay(text) {
  const m = String(text ?? '').match(/^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (minutes > 59) return null;
  if (m[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

/** "2026-10-12" (or a Date at UTC midnight) plus a PKT time of day → the instant. */
export function pktInstant(date, timeText) {
  const iso = date instanceof Date ? date.toISOString() : String(date ?? '');
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const minutes = parseTimeOfDay(timeText);
  if (!m || minutes == null) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + minutes * 60 * 1000 - PKT_OFFSET_MS);
}

/** Instant → { date: "2026-10-12", time: "18:00" } in PKT (for prefilling the edit form). */
export function toPktParts(instant) {
  const shifted = new Date(instant.getTime() + PKT_OFFSET_MS).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatPktTime(instant) {
  const d = new Date(instant.getTime() + PKT_OFFSET_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function formatPktDate(instant) {
  const d = new Date(instant.getTime() + PKT_OFFSET_MS);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Same text, case, spacing and punctuation → same venue ("CS Parking" ≠ "FMC Parking"). */
export const normalizeVenue = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Checks start/end fields and returns { startsAt, endsAt }. Throws a ScheduleError (400) naming the field.
 * Events that run past midnight set the end date to the next day.
 */
export function resolveSchedule({ date, time, endDate, endTime }) {
  const fail = (field, message) => {
    throw new ScheduleError(400, message, { field });
  };
  if (!date) fail('date', 'Choose the start date.');
  if (parseTimeOfDay(time) == null) fail('time', 'Choose the start time.');
  if (!endDate) fail('endDate', 'Choose the end date.');
  if (parseTimeOfDay(endTime) == null) fail('endTime', 'Choose the end time.');
  const startsAt = pktInstant(date, time);
  const endsAt = pktInstant(endDate, endTime);
  if (!startsAt) fail('date', 'Invalid start date.');
  if (!endsAt) fail('endDate', 'Invalid end date.');
  if (endsAt <= startsAt) {
    const sameDay = String(endDate).slice(0, 10) === String(date).slice(0, 10);
    fail(
      sameDay ? 'endTime' : 'endDate',
      sameDay
        ? 'The end time must be after the start time. If the event runs past midnight, set the end date to the next day.'
        : 'The event must end after it starts.',
    );
  }
  if (endsAt - startsAt > MAX_DURATION_MS) fail('endDate', 'An event can last at most 30 days.');
  return { startsAt, endsAt };
}

/** The interval an existing event occupies (older events without stored times fall back to date + time). */
export function occupiedInterval(event) {
  const start = event.startsAt || pktInstant(event.date, event.time) || pktInstant(event.date, '00:00');
  const end = event.endsAt || new Date(start.getTime() + LEGACY_DURATION_MS);
  return { start, end };
}

/** Whether two intervals at the same venue are less than the one-hour gap apart (exactly one hour is fine). */
export const slotsClash = (a, b) =>
  a.start.getTime() < b.end.getTime() + MIN_GAP_MS && a.end.getTime() + MIN_GAP_MS > b.start.getTime();

/**
 * What to change so `proposed` ({ start, end }) clears `other`. `who` names the other booking ("Another
 * event", "Date 2") and `you` the one being checked ("Your event", "This date").
 */
export function conflictMessage(proposed, other, { who = 'Another event', you = 'Your event' } = {}) {
  const startDay = formatPktDate(proposed.start);
  const on = (instant) => (formatPktDate(instant) === startDay ? '' : ` on ${formatPktDate(instant)}`);
  const at = (instant) => `${formatPktTime(instant)}${on(instant)}`;
  const latestEnd = new Date(other.start.getTime() - MIN_GAP_MS);
  const earliestStart = new Date(other.end.getTime() + MIN_GAP_MS);
  if (proposed.end > other.start && proposed.start < other.end) {
    return `${who} is booked at this venue from ${at(other.start)} to ${at(other.end)}. ${you} must end by ${at(latestEnd)} or start at ${at(earliestStart)} or later to allow a one-hour gap.`;
  }
  if (proposed.start < other.start) {
    return `${who} starts at this venue at ${at(other.start)}. ${you} must end by ${at(latestEnd)} to allow a one-hour gap.`;
  }
  return `${who} at this venue ends at ${at(other.end)}. ${you} must start at ${at(earliestStart)} or later to allow a one-hour gap.`;
}

// Statuses that don't hold a venue slot: cancelled events, and rejected requests (rechecked on resubmit)
export const RELEASED_STATUSES = ['CANCELLED', 'REJECTED'];

/**
 * Events at the same venue (same city and venue name) that overlap the proposed schedule or sit less than
 * an hour from it. A gap of exactly one hour is allowed. Every other status holds the slot, including
 * pending requests and hidden reserved dates; cancelled events and rejected requests don't.
 */
export async function findScheduleConflicts({ city, venue, startsAt, endsAt, excludeEventId }, db = prisma) {
  const key = normalizeVenue(venue);
  if (!key || !city) return [];
  const candidates = await db.event.findMany({
    where: {
      city: { equals: String(city).trim(), mode: 'insensitive' },
      status: { notIn: RELEASED_STATUSES },
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
      OR: [{ endsAt: null }, { endsAt: { gt: new Date(startsAt.getTime() - MIN_GAP_MS) } }],
    },
    select: { id: true, venue: true, date: true, time: true, startsAt: true, endsAt: true },
  });
  return candidates
    .filter((event) => normalizeVenue(event.venue) === key)
    .map((event) => ({ id: event.id, ...occupiedInterval(event) }))
    .filter((other) => slotsClash({ start: startsAt, end: endsAt }, other))
    .sort((a, b) => a.start - b.start)
    .map((other) => ({
      eventId: other.id,
      startsAt: other.start,
      endsAt: other.end,
      message: conflictMessage({ start: startsAt, end: endsAt }, other),
    }));
}

/** Transaction-scoped lock on one venue: concurrent checks-then-writes for that venue run one at a time. */
export async function lockVenue(tx, { city, venue }) {
  const lockKey = `venue:${String(city).trim().toLowerCase()}:${normalizeVenue(venue)}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text`;
}

/**
 * Throws a 409 ScheduleError when the venue isn't free. Pass a transaction client to also take a per-venue
 * lock, so two organizers saving the same slot at once can't both succeed.
 */
export async function assertVenueFree(schedule, tx) {
  if (tx) await lockVenue(tx, schedule);
  const conflicts = await findScheduleConflicts(schedule, tx || prisma);
  if (conflicts.length) {
    throw new ScheduleError(409, conflicts[0].message, { field: 'schedule', conflicts: conflicts.map((c) => c.message) });
  }
}
