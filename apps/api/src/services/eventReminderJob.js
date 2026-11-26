import prisma from '../config/prisma.js';
import { NOTIFICATION_TYPES } from './notificationService.js';

/*
 * Event reminder emails (run from server.js every 30 minutes).
 *
 * Ticket holders: 15, 7, 5 and 3 days before the event, and on the event day.
 * Earlier buyers of the same organizer who have no ticket for this event: the same days, only while tickets
 * are still available.
 *
 * Each reminder is an in-app notification (type EVENT_REMINDER); the notification hook in config/prisma.js
 * emails it to people who have email notifications on. EventReminderDelivery records every reminder sent
 * (unique per event, person and reminder), so nobody gets the same one twice, even with several servers.
 * Days are counted in Pakistan time, and reminders go out between 9:00 and 21:00 PKT.
 */

const OFFSETS = [15, 7, 5, 3, 0];
const PKT_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 21;
const MAX_PER_RUN = 2000; // per event and reminder; the rest go on the next run

const pktDay = (d) => Math.floor((new Date(d).getTime() + PKT_MS) / DAY_MS);
const pktHour = (d) => new Date(new Date(d).getTime() + PKT_MS).getUTCHours();
const dateText = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });

let missingTableWarned = false;

/** Records the reminder for this person; false when it was already sent (unique row exists). */
async function claim(eventId, userId, kind) {
  try {
    await prisma.eventReminderDelivery.create({ data: { eventId, userId, kind } });
    return true;
  } catch (err) {
    if (err.code === 'P2002') return false; // already sent
    throw err;
  }
}

async function send(event, userIds, kind, build) {
  if (!userIds.length) return 0;
  const already = await prisma.eventReminderDelivery.findMany({ where: { eventId: event.id, kind, userId: { in: userIds } }, select: { userId: true } });
  const done = new Set(already.map((r) => r.userId));
  let sent = 0;
  for (const userId of userIds.filter((id) => !done.has(id)).slice(0, MAX_PER_RUN)) {
    if (!(await claim(event.id, userId, kind))) continue;
    const { title, message, link } = build();
    await prisma.notification.create({ data: { userId, type: NOTIFICATION_TYPES.EVENT_REMINDER, title, message, link } });
    sent += 1;
  }
  return sent;
}

export async function runEventReminders(now = new Date()) {
  // Prisma client not regenerated yet after adding the table (npx prisma generate)
  if (!prisma.eventReminderDelivery) return { skipped: 'prisma client not generated' };
  const hour = pktHour(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return { skipped: 'outside sending hours' };

  const today = pktDay(now);
  const events = await prisma.event.findMany({
    where: {
      status: 'PUBLISHED',
      isHidden: false,
      date: { gte: new Date(now.getTime() - 2 * DAY_MS), lte: new Date(now.getTime() + 17 * DAY_MS) },
    },
    select: {
      id: true, name: true, date: true, time: true, startsAt: true, venue: true, city: true, companyId: true,
      company: { select: { companyName: true } },
      tiers: { select: { availableQuantity: true } },
    },
  });

  const result = { events: 0, holders: 0, winback: 0 };
  try {
    for (const event of events) {
      const start = event.startsAt || event.date;
      const days = pktDay(start) - today;
      if (!OFFSETS.includes(days)) continue;
      if (days === 0 && event.startsAt && new Date(event.startsAt) <= now) continue; // already started
      result.events += 1;
      const when = `${dateText(start)}${event.time ? ` at ${event.time}` : ''}`;
      const where = [event.venue, event.city].filter(Boolean).join(', ');

      // 1. Ticket holders (valid tickets, active accounts)
      const holderRows = await prisma.ticket.findMany({
        where: { eventId: event.id, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { userId: true },
        distinct: ['userId'],
      });
      const holders = holderRows.map((r) => r.userId);
      result.holders += await send(event, holders, `HOLDER_${days}`, () => ({
        title: days === 0 ? `Today: ${event.name}` : `${event.name} is in ${days} days`,
        message: `${when} · ${where}. ${days === 0 ? 'Have your ticket QR ready at the gate.' : 'Your tickets are in your wallet.'}`,
        link: '/wallet',
      }));

      // 2. Earlier buyers of this organizer with no ticket for this event, while tickets are available
      const available = event.tiers.reduce((n, t) => n + (t.availableQuantity || 0), 0);
      if (available <= 0) continue;
      const pastBuyers = await prisma.order.findMany({
        where: {
          status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] },
          eventId: { not: event.id },
          event: { companyId: event.companyId, date: { lt: now } },
          user: { status: 'ACTIVE' },
        },
        select: { userId: true },
        distinct: ['userId'],
      });
      const boughtThis = await prisma.order.findMany({
        where: { eventId: event.id, status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'PENDING'] } },
        select: { userId: true },
        distinct: ['userId'],
      });
      const exclude = new Set([...holders, ...boughtThis.map((r) => r.userId)]);
      const winback = pastBuyers.map((r) => r.userId).filter((id) => !exclude.has(id));
      const organizer = event.company?.companyName || 'this organizer';
      result.winback += await send(event, winback, `WINBACK_${days}`, () => ({
        title: days === 0 ? `${event.name} is today: tickets still available` : `${event.name}: ${days} days to go, tickets still available`,
        message: `You've been to ${organizer} events before. ${when} · ${where}. Get your tickets before they're gone.`,
        link: `/events/${event.id}`,
      }));
    }
  } catch (err) {
    // Table not created yet (migration not applied): say so once instead of failing every run
    if (err.code === 'P2021') {
      if (!missingTableWarned) console.warn('[Event reminders] waiting for migration 20261126120000_event_reminders (npx prisma migrate deploy)');
      missingTableWarned = true;
      return { skipped: 'migration not applied' };
    }
    throw err;
  }
  return result;
}

export default { runEventReminders };
