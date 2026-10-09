import prisma from '../config/prisma.js';
import { notifyAdmins } from './notificationService.js';
import { slotText } from './eventReviewNotices.js';
import { LIVE_TICKET_STATUSES, createRefunds, methodText, payerFor, pkr, processRefunds, processRefundsLater } from './refundService.js';
import { ScheduleError, findScheduleConflicts, lockVenue, normalizeVenue, occupiedInterval, resolveSchedule, toPktParts } from './eventScheduleService.js';

/*
 * What happens to ticket holders when an event is cancelled, postponed or moved.
 *
 * - Cancel: tickets stop working, open resale listings close, and everyone who paid is refunded in full.
 * - Postpone (no new date yet): sales pause and tickets stay valid; holders can get a refund at any time.
 *   With no new date after POSTPONE_LIMIT_DAYS the hourly job cancels the event (with refunds).
 * - Reschedule: an event with ticket holders can't just be edited. The organizer requests the change; an
 *   admin approves it unless it is minor (same venue and day, start and end within two hours). Tickets stay
 *   valid for the new date, open resale listings are paused, and holders can get a full refund until the
 *   refund window closes (14 days, or 48 hours before the new date, whichever is first).
 *
 * Everyone affected gets an in-app notification, which is also emailed (config/prisma.js).
 */

export const POSTPONE_LIMIT_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
const MINOR_SHIFT_MS = 2 * 60 * 60 * 1000;

export class LifecycleError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const liveTickets = (eventId, db = prisma, where = {}) =>
  db.ticket.findMany({
    where: { eventId, status: { in: LIVE_TICKET_STATUSES }, ...where },
    include: { order: { select: { id: true, userId: true, paymentMethod: true, paymentTxId: true, status: true } } },
  });

/** People following the event who don't hold a ticket (wishlist and waitlist). */
async function followersOf(eventId, holderIds) {
  const [wish, wait] = await Promise.all([
    prisma.wishlistItem.findMany({ where: { eventId }, select: { userId: true } }),
    prisma.waitlist.findMany({ where: { eventId }, select: { userId: true } }),
  ]);
  return [...new Set([...wish, ...wait].map((r) => r.userId))].filter((id) => !holderIds.has(id));
}

/** Refund window after a reschedule: 14 days, or until 48 hours before the new start; at least a day when possible. */
export function refundWindowFor(newStartsAt, now = Date.now()) {
  const start = newStartsAt.getTime();
  let end = Math.min(now + 14 * DAY, start - 2 * DAY);
  if (end < now + DAY) end = Math.min(now + DAY, start);
  return new Date(end);
}

const when = (date) => `${toPktParts(date).date.split('-').reverse().join('/')}`;
const deadline = (date) => {
  const d = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  const h = d.getUTCHours();
  return `${when(date)} at ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} PKT`;
};

// ---------------------------------------------------------------------------------------------------
// Impact preview (organizer's cancel and postpone screens)
// ---------------------------------------------------------------------------------------------------

export async function lifecycleSummary(event) {
  const tickets = await liveTickets(event.id);
  let refundTotal = 0;
  let organizerShare = 0;
  for (const t of tickets) {
    const payer = await payerFor(t);
    refundTotal += payer.amount;
    organizerShare += Math.min(payer.amount, Number(t.price));
  }
  const [listings, pending, history, refunds] = await Promise.all([
    prisma.resaleListing.count({ where: { ticket: { eventId: event.id }, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    prisma.eventScheduleChange.findFirst({ where: { eventId: event.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
    prisma.eventScheduleChange.findMany({ where: { eventId: event.id, status: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.refund.groupBy({ by: ['status'], where: { eventId: event.id }, _count: true, _sum: { amount: true } }),
  ]);
  return {
    tickets: tickets.length,
    holders: new Set(tickets.map((t) => t.userId)).size,
    resaleListings: listings,
    refundTotal,
    organizerShare,
    pendingChange: pending,
    history,
    refunds: refunds.map((r) => ({ status: r.status, count: r._count, amount: Number(r._sum.amount || 0) })),
  };
}

// ---------------------------------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------------------------------

/** Cancels the event and refunds everyone who paid. `actor` is the organizer or a Super Admin. */
export async function cancelEvent({ event, actor, reason }) {
  if (['CANCELLED', 'COMPLETED'].includes(event.status)) throw new LifecycleError(409, `This event is already ${event.status.toLowerCase()}.`);
  const tickets = await liveTickets(event.id);
  const now = new Date();
  const { refunds } = await prisma.$transaction(
    async (tx) => {
      await tx.event.update({
        where: { id: event.id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason, postponedAt: null, refundWindowEndsAt: null },
      });
      await tx.eventScheduleChange.updateMany({ where: { eventId: event.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
      // Checkouts in progress can't complete any more
      await tx.order.updateMany({ where: { eventId: event.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      await tx.seat.updateMany({ where: { eventId: event.id, status: 'LOCKED' }, data: { status: 'AVAILABLE' } });
      return { refunds: await createRefunds(tx, tickets, 'EVENT_CANCELLED') };
    },
    { timeout: 60000 },
  );

  // Who holds which tickets, and who gets how much back
  const holders = new Map();
  for (const t of tickets) holders.set(t.userId, (holders.get(t.userId) || 0) + 1);
  const payers = new Map();
  for (const r of refunds) {
    const p = payers.get(r.userId) || { amount: 0, count: 0, method: r.method };
    p.amount += Number(r.amount);
    p.count += 1;
    payers.set(r.userId, p);
  }
  const byAdmin = actor.role === 'SUPER_ADMIN' && actor.id !== event.company.userId;
  const who = byAdmin ? 'TicketLedger' : event.company.companyName;
  const slot = slotText(event);

  const people = new Set([...holders.keys(), ...payers.keys()]);
  const notes = [...people].map((userId) => {
    const held = holders.get(userId) || 0;
    const paid = payers.get(userId);
    const parts = [`“${event.name}” (${slot}) has been cancelled by ${who}. Reason: ${reason}`];
    if (held) parts.push(`Your ${held} ticket${held === 1 ? ' is' : 's are'} no longer valid.`);
    if (paid) parts.push(`We’re refunding ${pkr(paid.amount)} in full to ${methodText(paid.method)}. You’ll get another email when it has been sent.`);
    else if (held) parts.push('The refund goes to the person who paid for these tickets.');
    return { userId, type: 'EVENT_CANCELLED', title: `Cancelled: ${event.name}`, message: parts.join(' '), link: '/my-bookings' };
  });
  const followers = await followersOf(event.id, people);
  followers.forEach((userId) =>
    notes.push({ userId, type: 'WISHLIST_EVENT_CANCELLED', title: `Cancelled: ${event.name}`, message: `“${event.name}” (${slot}), which you saved, has been cancelled.`, link: `/events/${event.id}` }),
  );
  const staff = await prisma.staffEventAssignment.findMany({ where: { eventId: event.id }, select: { staffId: true } });
  staff.forEach(({ staffId }) =>
    notes.push({ userId: staffId, type: 'STAFF_EVENT_CANCELLED', title: `Cancelled: ${event.name}`, message: `“${event.name}” (${slot}) has been cancelled, so there is no gate duty for it. Its tickets no longer scan.` }),
  );
  const refundTotal = refunds.reduce((n, r) => n + Number(r.amount), 0);
  const organizerShare = refunds.reduce((n, r) => n + Number(r.organizerShare), 0);
  notes.push({
    userId: event.company.userId,
    type: 'EVENT_CANCELLED_ORGANIZER',
    title: `Cancelled: ${event.name}`,
    message: `${byAdmin ? `A TicketLedger admin cancelled “${event.name}”. Reason: ${reason} ` : `You cancelled “${event.name}”. `}${tickets.length} ticket${tickets.length === 1 ? '' : 's'} held by ${holders.size} attendee${holders.size === 1 ? '' : 's'} are being refunded (${pkr(refundTotal)}); ${pkr(organizerShare)} in face value comes out of your revenue for this event. Everyone affected has been emailed.`,
    link: '/organizer/dashboard',
  });
  if (notes.length) await prisma.notification.createMany({ data: notes });
  await notifyAdmins({
    type: 'ADMIN_EVENT_CANCELLED',
    title: `Event cancelled: ${event.name}`,
    message: `${byAdmin ? actor.email : event.company.companyName} cancelled “${event.name}” (${slot}). Reason: ${reason} ${refunds.length} refund${refunds.length === 1 ? '' : 's'} (${pkr(refundTotal)}) are being processed.`,
    link: '/admin/event-approvals?tab=refunds',
  });
  await prisma.waitlist.deleteMany({ where: { eventId: event.id } });
  await prisma.auditLog.create({
    data: { userId: actor.id, action: 'EVENT_CANCELLED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, reason, tickets: tickets.length, refundTotal } },
  });

  processRefundsLater(refunds.map((r) => r.id));
  return { tickets: tickets.length, holders: holders.size, refunds: refunds.length, refundTotal };
}

// ---------------------------------------------------------------------------------------------------
// Postpone
// ---------------------------------------------------------------------------------------------------

/** Pauses sales with no new date yet. Holders keep their tickets and can get a refund at any time. */
export async function postponeEvent({ event, actor, reason }) {
  if (!['PUBLISHED', 'PAUSED'].includes(event.status)) throw new LifecycleError(409, 'Only an event that is on sale (or paused) can be postponed.');
  if (event.postponedAt) throw new LifecycleError(409, 'This event is already postponed. Set its new date with Reschedule.');
  const tickets = await liveTickets(event.id);
  const paused = await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { status: 'PAUSED', postponedAt: new Date(), postponeReason: reason, refundWindowEndsAt: null } });
    const listings = await tx.resaleListing.findMany({ where: { ticket: { eventId: event.id }, status: 'ACTIVE' }, select: { id: true, sellerId: true } });
    await tx.resaleListing.updateMany({ where: { id: { in: listings.map((l) => l.id) } }, data: { status: 'PAUSED' } });
    return listings;
  });

  const slot = slotText(event);
  const holders = new Map();
  tickets.forEach((t) => holders.set(t.userId, (holders.get(t.userId) || 0) + 1));
  const sellers = new Set(paused.map((l) => l.sellerId));
  const notes = [...holders].map(([userId, count]) => ({
    userId,
    type: 'EVENT_POSTPONED',
    title: `Postponed: ${event.name}`,
    message: `“${event.name}” (${slot}) has been postponed. Reason: ${reason} Your ${count} ticket${count === 1 ? ' stays' : 's stay'} valid for the new date, which we’ll email you as soon as it’s set. If you’d rather not wait, you can get a full refund at any time until then.${sellers.has(userId) ? ' Your resale listing is paused until the new date is announced.' : ''}`,
    link: `/events/${event.id}/refund`,
  }));
  const followers = await followersOf(event.id, new Set(holders.keys()));
  followers.forEach((userId) =>
    notes.push({ userId, type: 'WISHLIST_EVENT_POSTPONED', title: `Postponed: ${event.name}`, message: `“${event.name}” (${slot}), which you saved, has been postponed. We’ll let you know the new date.`, link: `/events/${event.id}` }),
  );
  notes.push({
    userId: event.company.userId,
    type: 'SCHEDULE_CHANGE_POSTPONED',
    title: `Postponed: ${event.name}`,
    message: `Ticket sales are paused and ${holders.size} attendee${holders.size === 1 ? ' has' : 's have'} been emailed. Set the new date with Reschedule within ${POSTPONE_LIMIT_DAYS} days; after that the event is cancelled automatically and everyone is refunded.`,
    link: `/organizer/events/${event.id}/changes`,
  });
  await prisma.notification.createMany({ data: notes });
  await notifyAdmins({ type: 'ADMIN_EVENT_POSTPONED', title: `Event postponed: ${event.name}`, message: `${event.company.companyName} postponed “${event.name}” (${slot}). Reason: ${reason}` });
  await prisma.auditLog.create({ data: { userId: actor.id, action: 'EVENT_POSTPONED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, reason } } });
  return { holders: holders.size, tickets: tickets.length, pausedListings: paused.length };
}

// ---------------------------------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------------------------------

const isMinorChange = (event, next) => {
  const { start, end } = occupiedInterval(event);
  return (
    normalizeVenue(event.venue) === normalizeVenue(next.venue) &&
    String(event.city).trim().toLowerCase() === String(next.city).trim().toLowerCase() &&
    toPktParts(start).date === toPktParts(next.startsAt).date &&
    Math.abs(start - next.startsAt) <= MINOR_SHIFT_MS &&
    Math.abs(end - next.endsAt) <= MINOR_SHIFT_MS
  );
};

/** Checks the venue is free for the new slot (under the venue lock inside a transaction). */
async function assertSlotFree(db, eventId, slot) {
  const conflicts = await findScheduleConflicts({ ...slot, excludeEventId: eventId }, db);
  if (conflicts.length) throw new ScheduleError(409, conflicts[0].message, { field: 'schedule', conflicts: conflicts.map((c) => c.message) });
}

/**
 * Organizer asks to move the event. With no ticket holders it is applied right away; a minor change is
 * applied right away and holders are told; anything else waits for an admin.
 */
export async function requestReschedule({ event, actor, input }) {
  if (!['PUBLISHED', 'PAUSED'].includes(event.status)) {
    throw new LifecycleError(409, 'This event isn’t on sale yet, so change its date in Edit event instead.');
  }
  const reason = String(input.reason || '').trim();
  if (reason.length < 10) throw new LifecycleError(400, 'Tell attendees why the date is changing (at least 10 characters).', { field: 'reason' });
  const { startsAt, endsAt } = resolveSchedule(input);
  if (startsAt < new Date()) throw new LifecycleError(400, 'The new date has to be in the future.', { field: 'date' });
  const next = { startsAt, endsAt, city: String(input.city || event.city).trim(), venue: String(input.venue || event.venue).trim() };
  if (next.venue.length < 2) throw new LifecycleError(400, 'Enter the venue.', { field: 'venue' });
  const { start, end } = occupiedInterval(event);
  if (start.getTime() === startsAt.getTime() && end.getTime() === endsAt.getTime() && normalizeVenue(event.venue) === normalizeVenue(next.venue) && event.city === next.city) {
    throw new LifecycleError(400, 'That’s the current date, time and venue. Change at least one of them.');
  }
  if (await prisma.eventScheduleChange.findFirst({ where: { eventId: event.id, status: 'PENDING' }, select: { id: true } })) {
    throw new LifecycleError(409, 'A date change for this event is already waiting for approval. Withdraw it first to request a different one.');
  }
  await assertSlotFree(prisma, event.id, next);

  const holders = await prisma.ticket.count({ where: { eventId: event.id, status: { in: LIVE_TICKET_STATUSES } } });
  const minor = holders > 0 && !event.postponedAt && isMinorChange(event, next);
  const venueChanged = normalizeVenue(event.venue) !== normalizeVenue(next.venue) || event.city !== next.city;
  const change = await prisma.eventScheduleChange.create({
    data: {
      eventId: event.id,
      requestedById: actor.id,
      reason,
      minor,
      oldDate: event.date,
      oldTime: event.time,
      oldStartsAt: start,
      oldEndsAt: end,
      oldCity: event.city,
      oldVenue: event.venue,
      newDate: new Date(String(input.date).slice(0, 10)),
      newTime: input.time,
      newStartsAt: startsAt,
      newEndsAt: endsAt,
      newCity: next.city,
      newVenue: next.venue,
      newLatitude: venueChanged ? (input.latitude != null && input.latitude !== '' ? Number(input.latitude) : null) : event.latitude,
      newLongitude: venueChanged ? (input.longitude != null && input.longitude !== '' ? Number(input.longitude) : null) : event.longitude,
      newLocationAddress: venueChanged ? input.locationAddress || null : event.locationAddress,
    },
  });

  // Nobody to protect, or a small same-day shift: apply now
  if (holders === 0 || minor) {
    await applyScheduleChange({ changeId: change.id, reviewer: null });
    return { applied: true, minor, change };
  }

  await notifyAdmins({
    type: 'ADMIN_SCHEDULE_CHANGE_REQUEST',
    title: `Date change to review: ${event.name}`,
    message: `${event.company.companyName} wants to move “${event.name}” from ${slotText(event)} to ${slotText({ ...next, date: change.newDate, time: change.newTime })}. ${holders} ticket${holders === 1 ? '' : 's'} sold. Reason: ${reason}`,
    link: '/admin/event-approvals?tab=changes',
  });
  await prisma.notification.create({
    data: {
      userId: event.company.userId,
      type: 'SCHEDULE_CHANGE_SUBMITTED',
      title: `Date change sent for approval: ${event.name}`,
      message: `Your request to move “${event.name}” to ${slotText({ ...next, date: change.newDate, time: change.newTime })} is waiting for a TicketLedger admin. Attendees are emailed once it’s approved.`,
      link: `/organizer/events/${event.id}/changes`,
    },
  });
  await prisma.auditLog.create({ data: { userId: actor.id, action: 'EVENT_RESCHEDULE_REQUESTED', targetType: 'Event', targetId: event.id, details: { changeId: change.id, reason } } });
  return { applied: false, minor: false, change };
}

/** Applies an approved (or minor / no-holder) change and tells everyone. `reviewer` is the admin, if any. */
export async function applyScheduleChange({ changeId, reviewer, comment = '' }) {
  const change = await prisma.eventScheduleChange.findUnique({ where: { id: changeId }, include: { event: { include: { company: true } } } });
  if (!change || change.status !== 'PENDING') throw new LifecycleError(409, 'This date change is no longer waiting for approval.');
  const { event } = change;
  if (['CANCELLED', 'COMPLETED'].includes(event.status)) throw new LifecycleError(409, `The event is ${event.status.toLowerCase()}, so it can’t be moved.`);
  const holders = await prisma.ticket.count({ where: { eventId: event.id, status: { in: LIVE_TICKET_STATUSES } } });
  const giveWindow = holders > 0 && !change.minor;
  const now = new Date();
  const refundWindowEndsAt = giveWindow ? refundWindowFor(change.newStartsAt) : null;
  const slot = { city: change.newCity, venue: change.newVenue, startsAt: change.newStartsAt, endsAt: change.newEndsAt };

  const { updated, paused } = await prisma.$transaction(async (tx) => {
    await lockVenue(tx, slot);
    await assertSlotFree(tx, event.id, slot);
    const moved = await tx.eventScheduleChange.updateMany({
      where: { id: change.id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedBy: reviewer?.email || null, reviewedAt: now, reviewComment: comment || null },
    });
    if (!moved.count) throw new LifecycleError(409, 'Another admin has just reviewed this change.');
    const ev = await tx.event.update({
      where: { id: event.id },
      data: {
        date: change.newDate,
        time: change.newTime,
        startsAt: change.newStartsAt,
        endsAt: change.newEndsAt,
        city: change.newCity,
        venue: change.newVenue,
        latitude: change.newLatitude,
        longitude: change.newLongitude,
        locationAddress: change.newLocationAddress,
        rescheduledAt: now,
        ...(giveWindow ? { refundWindowEndsAt, refundReminderSentAt: null } : {}),
        // A postponed event goes back on sale with its new date
        ...(event.postponedAt ? { postponedAt: null, postponeReason: null, status: 'PUBLISHED' } : {}),
      },
    });
    // Listings were priced for the old date: the seller relists (or takes the refund)
    let listings = [];
    if (giveWindow) {
      listings = await tx.resaleListing.findMany({ where: { ticket: { eventId: event.id }, status: 'ACTIVE' }, select: { id: true, sellerId: true } });
      await tx.resaleListing.updateMany({ where: { id: { in: listings.map((l) => l.id) } }, data: { status: 'PAUSED' } });
    }
    return { updated: ev, paused: listings };
  });

  const was = slotText({ date: change.oldDate, time: change.oldTime, startsAt: change.oldStartsAt, endsAt: change.oldEndsAt, venue: change.oldVenue, city: change.oldCity });
  const now2 = slotText(updated);
  const tickets = await prisma.ticket.findMany({ where: { eventId: event.id, status: { in: LIVE_TICKET_STATUSES } }, select: { userId: true } });
  const holderCounts = new Map();
  tickets.forEach((t) => holderCounts.set(t.userId, (holderCounts.get(t.userId) || 0) + 1));
  const sellers = new Set(paused.map((l) => l.sellerId));
  const notes = [...holderCounts].map(([userId, count]) => ({
    userId,
    type: 'EVENT_RESCHEDULED',
    title: `New ${change.minor ? 'time' : 'date'}: ${event.name}`,
    message:
      `“${event.name}” has moved. Was: ${was}. Now: ${now2}. Reason: ${change.reason} ` +
      `Your ${count} ticket${count === 1 ? ' stays' : 's stay'} valid with the same seat${count === 1 ? '' : 's'} and QR code${count === 1 ? '' : 's'}; you don’t need to do anything to keep ${count === 1 ? 'it' : 'them'}.` +
      (giveWindow ? ` If you can’t make the new ${change.newVenue === change.oldVenue ? 'date' : 'date or venue'}, you can get a full refund until ${deadline(refundWindowEndsAt)}.` : '') +
      (sellers.has(userId) ? ' Your resale listing has been paused: relist it with the new date, or take the refund.' : ''),
    link: giveWindow ? `/events/${event.id}/refund` : `/events/${event.id}`,
  }));
  const followers = await followersOf(event.id, new Set(holderCounts.keys()));
  followers.forEach((userId) =>
    notes.push({ userId, type: 'WISHLIST_EVENT_RESCHEDULED', title: `New date: ${event.name}`, message: `“${event.name}”, which you saved, has moved. Was: ${was}. Now: ${now2}.`, link: `/events/${event.id}` }),
  );
  const staff = await prisma.staffEventAssignment.findMany({ where: { eventId: event.id }, select: { staffId: true } });
  staff.forEach(({ staffId }) =>
    notes.push({ userId: staffId, type: 'STAFF_EVENT_RESCHEDULED', title: `Gate duty moved: ${event.name}`, message: `“${event.name}” has moved. Was: ${was}. Now: ${now2}.`, link: '/staff/events' }),
  );
  notes.push({
    userId: event.company.userId,
    type: reviewer ? 'SCHEDULE_CHANGE_APPROVED' : 'SCHEDULE_CHANGE_APPLIED',
    title: `New ${change.minor ? 'time' : 'date'} is live: ${event.name}`,
    message:
      `“${event.name}” now runs ${now2}.${reviewer ? ' A TicketLedger admin approved the change.' : ''}${comment ? ` Admin note: ${comment}` : ''} ` +
      (holderCounts.size ? `${holderCounts.size} attendee${holderCounts.size === 1 ? ' has' : 's have'} been emailed${giveWindow ? `, and can ask for a refund until ${deadline(refundWindowEndsAt)}` : ''}.` : 'No tickets were sold yet, so nobody needed to be told.'),
    link: `/organizer/events/${event.id}/changes`,
  });
  await prisma.notification.createMany({ data: notes });
  if (reviewer) {
    await notifyAdmins({ type: 'ADMIN_SCHEDULE_CHANGE_APPROVED', title: `Date change approved: ${event.name}`, message: `${reviewer.email} approved moving “${event.name}” from ${was} to ${now2}. ${holderCounts.size} attendee${holderCounts.size === 1 ? '' : 's'} notified.` });
  }
  await prisma.auditLog.create({
    data: { userId: reviewer?.id || change.requestedById, action: 'EVENT_RESCHEDULED', targetType: 'Event', targetId: event.id, details: { changeId: change.id, was, now: now2, minor: change.minor, refundWindowEndsAt } },
  });
  return { event: updated, holders: holderCounts.size, refundWindowEndsAt };
}

export async function rejectScheduleChange({ changeId, reviewer, comment }) {
  const change = await prisma.eventScheduleChange.findUnique({ where: { id: changeId }, include: { event: { include: { company: true } } } });
  if (!change || change.status !== 'PENDING') throw new LifecycleError(409, 'This date change is no longer waiting for approval.');
  await prisma.eventScheduleChange.update({ where: { id: change.id }, data: { status: 'REJECTED', reviewedBy: reviewer.email, reviewedAt: new Date(), reviewComment: comment } });
  await prisma.notification.create({
    data: {
      userId: change.event.company.userId,
      type: 'SCHEDULE_CHANGE_REJECTED',
      title: `Date change not approved: ${change.event.name}`,
      message: `Your request to move “${change.event.name}” was not approved, so the event keeps its current date. Reason: ${comment} Attendees were not told about the request.`,
      link: `/organizer/events/${change.eventId}/changes`,
    },
  });
  await prisma.auditLog.create({ data: { userId: reviewer.id, action: 'EVENT_RESCHEDULE_REJECTED', targetType: 'Event', targetId: change.eventId, details: { changeId, comment } } });
}

// ---------------------------------------------------------------------------------------------------
// Ticket holders: refund options after a reschedule or postponement
// ---------------------------------------------------------------------------------------------------

/** Whether holders can ask for a refund now, and until when. */
export function refundOpen(event, now = new Date()) {
  if (['CANCELLED', 'COMPLETED'].includes(event.status)) return { open: false };
  if (event.postponedAt) return { open: true, reason: 'POSTPONED_OPT_OUT', until: null };
  if (event.refundWindowEndsAt && event.refundWindowEndsAt > now) return { open: true, reason: 'RESCHEDULE_OPT_OUT', until: event.refundWindowEndsAt };
  return { open: false, closedAt: event.refundWindowEndsAt };
}

/** One holder's view: their valid tickets, what each refund would be, their refunds, and the change. */
export async function holderRefundOptions(event, userId) {
  const [tickets, refunds, change] = await Promise.all([
    liveTickets(event.id, prisma, { userId }),
    prisma.refund.findMany({ where: { eventId: event.id, OR: [{ userId }, { ticket: { userId } }] }, include: { ticket: { include: { seat: { select: { section: true, row: true, seatNumber: true } } } } }, orderBy: { createdAt: 'desc' } }),
    prisma.eventScheduleChange.findFirst({ where: { eventId: event.id, status: 'APPROVED', minor: false }, orderBy: { reviewedAt: 'desc' } }),
  ]);
  const withSeats = await prisma.ticket.findMany({ where: { id: { in: tickets.map((t) => t.id) } }, include: { seat: { select: { section: true, row: true, seatNumber: true, tier: { select: { name: true } } } } } });
  const seatOf = new Map(withSeats.map((t) => [t.id, t.seat]));
  const options = [];
  for (const t of tickets) {
    const payer = await payerFor(t);
    options.push({ id: t.id, seat: seatOf.get(t.id), amount: payer.amount, refundToYou: payer.userId === userId, method: payer.method, status: t.status });
  }
  return { window: refundOpen(event), tickets: options, refunds, change };
}

/** A holder gives back some (or all) of their tickets for a full refund while the window is open. */
export async function requestHolderRefund({ event, user, ticketIds }) {
  const window = refundOpen(event);
  if (!window.open) {
    throw new LifecycleError(409, window.closedAt ? `Refunds for the new date closed on ${deadline(window.closedAt)}. You can still resell your ticket.` : 'Refunds aren’t open for this event. You can resell your ticket instead.');
  }
  const ids = Array.isArray(ticketIds) && ticketIds.length ? ticketIds.map(String) : null;
  const tickets = await liveTickets(event.id, prisma, { userId: user.id, status: 'ACTIVE', ...(ids ? { id: { in: ids } } : {}) });
  if (!tickets.length) throw new LifecycleError(400, 'None of these tickets can be refunded (they may be used, refunded or no longer yours).');
  const refunds = await prisma.$transaction((tx) => createRefunds(tx, tickets, window.reason));
  const total = refunds.reduce((n, r) => n + Number(r.amount), 0);
  const toOthers = refunds.filter((r) => r.userId !== user.id);
  await prisma.notification.create({
    data: {
      userId: user.id,
      type: 'REFUND_REQUESTED',
      title: `Refund requested: ${event.name}`,
      message: `You gave back ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} to “${event.name}”; ${tickets.length === 1 ? 'it no longer works' : 'they no longer work'}. ${toOthers.length === refunds.length ? `The refund (${pkr(total)}) goes to the person who paid for ${tickets.length === 1 ? 'it' : 'them'}.` : `We’re refunding ${pkr(total - toOthers.reduce((n, r) => n + Number(r.amount), 0))} to you now.`}`,
      link: '/my-bookings',
    },
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: 'TICKET_REFUND_REQUESTED', targetType: 'Event', targetId: event.id, details: { tickets: tickets.map((t) => t.id), reason: window.reason, total } } });
  await processRefunds(refunds.map((r) => r.id));
  return { refunds: refunds.length, total };
}

// ---------------------------------------------------------------------------------------------------
// Hourly job
// ---------------------------------------------------------------------------------------------------

/** Cancels events postponed for too long, and reminds holders a day or two before their refund window closes. */
export async function runLifecycleJobs() {
  const now = new Date();
  const stale = await prisma.event.findMany({
    where: { status: 'PAUSED', postponedAt: { lt: new Date(now.getTime() - POSTPONE_LIMIT_DAYS * DAY) } },
    include: { company: true },
  });
  const system = (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true, email: true, role: true } })) || { id: null, role: 'SUPER_ADMIN' };
  for (const event of stale) {
    try {
      await cancelEvent({ event, actor: system, reason: `No new date was set within ${POSTPONE_LIMIT_DAYS} days of the postponement.` });
    } catch (e) {
      console.error(`[Lifecycle] auto-cancel ${event.id} failed:`, e.message);
    }
  }

  const closing = await prisma.event.findMany({
    where: { refundWindowEndsAt: { gt: now, lt: new Date(now.getTime() + 2 * DAY) }, refundReminderSentAt: null, status: { in: ['PUBLISHED', 'PAUSED'] } },
  });
  for (const event of closing) {
    const holders = await prisma.ticket.findMany({ where: { eventId: event.id, status: 'ACTIVE' }, distinct: ['userId'], select: { userId: true } });
    if (holders.length) {
      await prisma.notification.createMany({
        data: holders.map(({ userId }) => ({
          userId,
          type: 'REFUND_WINDOW_CLOSING',
          title: `Last chance for a refund: ${event.name}`,
          message: `Can’t make the new date of “${event.name}” (${slotText(event)})? You can get a full refund until ${deadline(event.refundWindowEndsAt)}. After that, you can still resell your ticket. Nothing to do if you’re going.`,
          link: `/events/${event.id}/refund`,
        })),
      });
    }
    await prisma.event.update({ where: { id: event.id }, data: { refundReminderSentAt: now } });
  }
  return { autoCancelled: stale.length, reminded: closing.length };
}
