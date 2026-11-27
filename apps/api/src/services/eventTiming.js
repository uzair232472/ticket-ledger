/**
 * When a ticket can be used or moved. ONE place, used by the gate scanner (online and offline sync), transfers,
 * gifts, resale listing and resale purchase, the ticket status shown to customers, and the job that marks
 * finished events COMPLETED.
 *
 *   start  Event.startsAt, else date + time in Pakistan time (eventScheduleService.occupiedInterval)
 *   end    Event.endsAt, else start + 3 hours (the same fallback the venue schedule uses)
 *
 *   Gate entry      from GATES_OPEN_BEFORE_MIN before the start until the end (exits are always recorded)
 *   Transfer, gift, resale listing, resale purchase   only before the start
 *   A ticket of an ended (or COMPLETED / CANCELLED) event is expired: it cannot be scanned, moved or sold
 */
import { occupiedInterval, formatPktDate, formatPktTime } from './eventScheduleService.js';

// Gates open this many minutes before the start (env GATES_OPEN_BEFORE_MIN, default 6 hours)
export const gatesOpenBeforeMin = () => {
  const v = Number(process.env.GATES_OPEN_BEFORE_MIN);
  return Number.isFinite(v) && v >= 0 ? v : 360;
};

const when = (d) => `${formatPktDate(d)} at ${formatPktTime(d)}`;

/** Phase of an event at `now`: UPCOMING (before gates open), DOORS_OPEN, LIVE (started), ENDED. */
export function eventTiming(event, now = new Date()) {
  const { start, end } = occupiedInterval(event);
  const gatesOpen = new Date(start.getTime() - gatesOpenBeforeMin() * 60_000);
  const t = now.getTime();
  const ended = t >= end.getTime() || event.status === 'COMPLETED';
  const phase = ended ? 'ENDED' : t >= start.getTime() ? 'LIVE' : t >= gatesOpen.getTime() ? 'DOORS_OPEN' : 'UPCOMING';
  return { phase, start, end, gatesOpen, started: phase === 'LIVE' || phase === 'ENDED', ended };
}

/** Gate entry check: null when entry is allowed, else { code, reason }. */
export function entryRefusal(event, at = new Date()) {
  if (!event) return null;
  const t = eventTiming(event, at);
  if (t.ended) return { code: 'EVENT_ENDED', reason: `Event ended (${when(t.end)}): this ticket has expired` };
  if (t.phase === 'UPCOMING') return { code: 'TOO_EARLY', reason: `Too early: gates open ${when(t.gatesOpen)}` };
  return null;
}

/**
 * Moving or selling a ticket (transfer, gift, resale listing, resale purchase): null when allowed, else a
 * customer-facing reason. Allowed only before the event starts and while it is not cancelled or completed.
 */
export function moveRefusal(event, action = 'transferred', now = new Date()) {
  if (!event) return null;
  if (event.status === 'CANCELLED') return `${event.name || 'This event'} was cancelled, so its tickets can’t be ${action}.`;
  const t = eventTiming(event, now);
  if (t.ended) return `${event.name || 'This event'} has ended, so its tickets can’t be ${action}.`;
  if (t.started) return `${event.name || 'This event'} has already started, so its tickets can’t be ${action}.`;
  return null;
}

/** Fields every check above needs (Prisma select). */
export const TIMING_SELECT = { id: true, name: true, status: true, date: true, time: true, startsAt: true, endsAt: true };

/**
 * Background job (every 5 minutes, server.js): marks events whose end has passed as COMPLETED and cancels the
 * resale listings still open for them. Status only; tickets keep their own status (shown as expired).
 * Returns { completed, listingsClosed }.
 */
export async function completeEndedEvents(now = new Date(), db) {
  const prisma = db || (await import('../config/prisma.js')).default;
  const candidates = await prisma.event.findMany({
    where: {
      status: { in: ['PUBLISHED', 'PAUSED'] },
      OR: [{ endsAt: { lte: now } }, { endsAt: null, date: { lte: now } }],
    },
    select: { ...TIMING_SELECT },
  });
  const ended = candidates.filter((e) => eventTiming(e, now).ended).map((e) => e.id);
  if (!ended.length) return { completed: 0, listingsClosed: 0 };
  const [done, listings] = await prisma.$transaction([
    prisma.event.updateMany({ where: { id: { in: ended }, status: { in: ['PUBLISHED', 'PAUSED'] } }, data: { status: 'COMPLETED' } }),
    prisma.resaleListing.updateMany({ where: { status: { in: ['ACTIVE', 'PAUSED'] }, ticket: { eventId: { in: ended } } }, data: { status: 'CANCELLED' } }),
  ]);
  return { completed: done.count, listingsClosed: listings.count };
}
