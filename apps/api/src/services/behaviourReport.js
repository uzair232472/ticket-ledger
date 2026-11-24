/**
 * Customer behaviour report for super admins (Admin console → Behavior). Rules and counts only: no model and
 * no score. Answers three questions:
 *   1. what happened (activity by step) in the chosen period,
 *   2. on WHICH EVENT (per-event funnel: viewers → seat → checkout → bought),
 *   3. by WHICH CUSTOMER (per-person summary, and one person's timeline on request).
 *
 * scope 'customers' (default) counts CUSTOMER accounts and guest sessions only; 'all' adds staff, organizer
 * and admin accounts (and the test scripts' accounts), which otherwise inflate every number.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';

const DAY = 86_400_000;
const PAID = ['SUCCESSFUL', 'PARTIALLY_REFUNDED'];
// Steps of a purchase, in order. Sign-ins and system evaluations are not customer behaviour on an event.
export const STEP_ACTIONS = {
  event_view: 'Viewed event',
  seat_selected: 'Chose a seat',
  seat_locked: 'Held a seat',
  checkout_started: 'Started checkout',
  checkout_abandoned: 'Left checkout',
  payment_failed: 'Payment failed',
  payment_completed: 'Paid',
  ticket_purchased: 'Got tickets',
  resale_viewed: 'Viewed resale',
  resale_attempted: 'Tried resale',
  ticket_transferred: 'Transferred a ticket',
  category_view: 'Browsed a category',
  wallet_connected: 'Connected a wallet',
  gate_checked_in: 'Checked in at the gate',
};
const SYSTEM = /EVALUATION|^AI_/;

// Postgres regex with the same meaning as SYSTEM (case-sensitive)
const SYSTEM_SQL = 'EVALUATION|^AI_';
const SEAT = ['seat_selected', 'seat_locked'];
const LEFT = ['checkout_abandoned', 'payment_failed'];
const int = (x) => Number(x || 0);

/**
 * Counted in the database (GROUP BY / COUNT DISTINCT), never by loading the behaviour log into memory. The
 * numbers are the same as the earlier in-memory version (test_behaviour_report_sql.mjs checks both agree).
 */
export async function behaviourReport({ days = 30, eventId = null, scope = 'customers', now = new Date() } = {}) {
  const span = Math.min(365, Math.max(1, Number(days) || 30));
  const since = new Date(now.getTime() - span * DAY);
  const customersOnly = scope !== 'all';
  const userFilter = customersOnly ? { OR: [{ userId: null }, { user: { role: 'CUSTOMER' } }] } : {};

  // Behaviour rows of the period (b, with its account u): same filter as before, written once
  // Columns are UTC timestamps without a zone: compare with UTC values, whatever the session time zone is
  const utc = (d) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const bWhere = Prisma.sql`b."createdAt" >= ${utc(since)} AND b."createdAt" < ${utc(now)}
    ${eventId ? Prisma.sql`AND b."eventId" = ${eventId}` : Prisma.empty}
    ${customersOnly ? Prisma.sql`AND (b."userId" IS NULL OR u."role"::text = 'CUSTOMER')` : Prisma.empty}`;
  const bFrom = Prisma.sql`"BehaviorEvent" b LEFT JOIN "User" u ON u."id" = b."userId"`;
  // Paid orders of the period (o, with its customer ou)
  const oWhere = Prisma.sql`o."status"::text IN (${Prisma.join(PAID)}) AND o."createdAt" >= ${utc(since)} AND o."createdAt" < ${utc(now)}
    ${eventId ? Prisma.sql`AND o."eventId" = ${eventId}` : Prisma.empty}
    ${customersOnly ? Prisma.sql`AND ou."role"::text = 'CUSTOMER'` : Prisma.empty}`;
  const oFrom = Prisma.sql`"Order" o JOIN "User" ou ON ou."id" = o."userId"`;
  // The person behind a row: the account, else the browser session (guests)
  const who = Prisma.sql`COALESCE(b."userId", NULLIF(b."sessionId", ''))`;

  const [actionRows, eventRows, eventOrderRows, [orderSum], [guestRow], personRows] = await Promise.all([
    // 1. Activity by step
    prisma.$queryRaw`SELECT b."action", COUNT(*)::int AS n FROM ${bFrom} WHERE ${bWhere} GROUP BY b."action"`,
    // 2. Per event: distinct people at each step
    prisma.$queryRaw`
      SELECT b."eventId", e."name", e."city", e."type"::text AS "type",
        COUNT(*) FILTER (WHERE b."action" = 'event_view')::int AS views,
        COUNT(DISTINCT ${who}) FILTER (WHERE b."action" IN ('event_view', ${Prisma.join(SEAT)}, 'checkout_started'))::int AS viewers,
        COUNT(DISTINCT ${who}) FILTER (WHERE b."action" IN (${Prisma.join(SEAT)}))::int AS seat,
        COUNT(DISTINCT ${who}) FILTER (WHERE b."action" = 'checkout_started')::int AS checkout,
        COUNT(DISTINCT ${who}) FILTER (WHERE b."action" IN (${Prisma.join(LEFT)}))::int AS "left"
      FROM ${bFrom} LEFT JOIN "Event" e ON e."id" = b."eventId"
      WHERE ${bWhere} AND b."eventId" IS NOT NULL AND ${who} IS NOT NULL
      GROUP BY b."eventId", e."name", e."city", e."type"`,
    //    …and buyers / revenue from paid orders
    prisma.$queryRaw`
      SELECT o."eventId", e."name", e."city", COUNT(DISTINCT o."userId")::int AS buyers, COALESCE(SUM(o."totalAmount"), 0) AS revenue
      FROM ${oFrom} LEFT JOIN "Event" e ON e."id" = o."eventId" WHERE ${oWhere} GROUP BY o."eventId", e."name", e."city"`,
    // Orders, buyers, returning buyers (a paid order before the period, on any event)
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS orders, COUNT(DISTINCT o."userId")::int AS buyers, COALESCE(SUM(o."totalAmount"), 0) AS revenue,
        COUNT(DISTINCT o."userId") FILTER (WHERE EXISTS (
          SELECT 1 FROM "Order" p WHERE p."userId" = o."userId" AND p."status"::text IN (${Prisma.join(PAID)}) AND p."createdAt" < ${utc(since)}
        ))::int AS returning
      FROM ${oFrom} WHERE ${oWhere}`,
    // Guest sessions (no account)
    prisma.$queryRaw`SELECT COUNT(DISTINCT b."sessionId")::int AS n FROM ${bFrom} WHERE ${bWhere} AND b."userId" IS NULL AND b."sessionId" <> '' AND b."action" <> 'login'`,
    // 3. Per signed-in person: the 100 most recently active, and how many there are in all
    prisma.$queryRaw`
      WITH acts AS (
        SELECT b."userId", b."eventId", b."action", b."createdAt", e."name" AS ename
        FROM ${bFrom} LEFT JOIN "Event" e ON e."id" = b."eventId"
        WHERE ${bWhere} AND b."userId" IS NOT NULL AND b."action" <> 'login' AND b."action" !~ ${SYSTEM_SQL}
      ), per AS (
        SELECT "userId",
          COUNT(*) FILTER (WHERE "action" = 'event_view')::int AS views,
          COUNT(*) FILTER (WHERE "action" IN (${Prisma.join(SEAT)}))::int AS seats,
          COUNT(*) FILTER (WHERE "action" = 'checkout_started')::int AS checkouts,
          COUNT(*) FILTER (WHERE "action" IN (${Prisma.join(LEFT)}))::int AS "left",
          MAX("createdAt") AS "lastActive"
        FROM acts GROUP BY "userId"
      ), last_ev AS (
        SELECT DISTINCT ON ("userId") "userId", ename FROM acts WHERE ename IS NOT NULL ORDER BY "userId", "createdAt" DESC
      ), ord AS (
        SELECT o."userId", COUNT(*)::int AS orders, SUM(o."totalAmount") AS spent FROM ${oFrom} WHERE ${oWhere} GROUP BY o."userId"
      ), evs AS (
        SELECT "userId", COUNT(DISTINCT eid)::int AS events FROM (
          SELECT "userId", "eventId" AS eid FROM acts WHERE "eventId" IS NOT NULL
          UNION SELECT o."userId", o."eventId" FROM ${oFrom} WHERE ${oWhere}
        ) x GROUP BY "userId"
      )
      SELECT per.*, pu."name", pu."email", pu."role"::text AS "role", COALESCE(evs.events, 0) AS events,
        COALESCE(ord.orders, 0) AS orders, COALESCE(ord.spent, 0) AS spent, last_ev.ename AS "lastEvent", COUNT(*) OVER ()::int AS total
      FROM per
      LEFT JOIN "User" pu ON pu."id" = per."userId"
      LEFT JOIN ord ON ord."userId" = per."userId"
      LEFT JOIN evs ON evs."userId" = per."userId"
      LEFT JOIN last_ev ON last_ev."userId" = per."userId"
      ORDER BY per."lastActive" DESC, per."userId"
      LIMIT 100`,
  ]);

  const activity = {};
  let signIns = 0;
  for (const r of actionRows) {
    if (r.action === 'login') { signIns += r.n; continue; }
    if (SYSTEM.test(r.action)) continue;
    activity[r.action] = r.n;
  }

  const events = new Map();
  for (const r of eventRows) {
    events.set(r.eventId, { eventId: r.eventId, name: r.name || 'Event', city: r.city || null, type: r.type || null, views: r.views, viewers: r.viewers, choseSeat: r.seat, startedCheckout: r.checkout, leftCheckout: r.left, bought: 0, revenue: 0 });
  }
  for (const r of eventOrderRows) {
    if (!events.has(r.eventId)) events.set(r.eventId, { eventId: r.eventId, name: r.name || 'Event', city: r.city || null, type: null, views: 0, viewers: 0, choseSeat: 0, startedCheckout: 0, leftCheckout: 0, bought: 0, revenue: 0 });
    const e = events.get(r.eventId);
    e.bought = r.buyers;
    e.revenue = Number(r.revenue);
  }
  const byEvent = [...events.values()].map(({ revenue, ...e }) => ({
    ...e, revenuePkr: Math.round(revenue), conversionPct: e.viewers ? Math.round((e.bought / e.viewers) * 100) : null,
  })).sort((a, b) => b.viewers - a.viewers || b.bought - a.bought || a.name.localeCompare(b.name) || a.eventId.localeCompare(b.eventId));

  const signedIn = personRows[0]?.total || 0;
  const customers = personRows.map((p) => ({
    userId: p.userId, name: p.name || '—', email: p.email || null, role: p.role || null, events: int(p.events),
    views: p.views, seats: p.seats, checkouts: p.checkouts, left: p.left, orders: int(p.orders),
    spentPkr: Math.round(Number(p.spent || 0)), lastActive: p.lastActive, lastEvent: p.lastEvent || null,
  }));
  const guests = guestRow.n;

  // Events with activity (for the event filter), whatever the current event filter is
  let eventOptions = byEvent.map((e) => ({ id: e.eventId, name: e.name, city: e.city }));
  if (eventId) {
    const ids = await prisma.behaviorEvent.groupBy({ by: ['eventId'], where: { createdAt: { gte: since, lt: now }, eventId: { not: null }, ...userFilter } });
    const list = await prisma.event.findMany({ where: { id: { in: ids.map((x) => x.eventId) } }, select: { id: true, name: true, city: true } });
    eventOptions = list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    period: { days: span, from: since, to: now },
    scope: customersOnly ? 'customers' : 'all',
    eventId,
    summary: {
      activePeople: signedIn + guests,
      signedInPeople: signedIn,
      guestSessions: guests,
      signIns,
      eventViews: activity.event_view || 0,
      buyers: orderSum.buyers,
      firstTimeBuyers: orderSum.buyers - orderSum.returning,
      returningBuyers: orderSum.returning,
      orders: orderSum.orders,
      revenuePkr: Math.round(Number(orderSum.revenue)),
    },
    activity: Object.entries(activity).sort((a, b) => b[1] - a[1]).map(([action, count]) => ({ action, label: STEP_ACTIONS[action] || action.replace(/_/g, ' '), count })),
    byEvent: byEvent.slice(0, 50),
    customers,
    events: eventOptions,
  };
}

/** One person's timeline (newest first), optionally on one event. */
export async function customerTimeline({ userId, eventId = null, limit = 200 }) {
  const [user, rows, orders] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, city: true, createdAt: true } }),
    prisma.behaviorEvent.findMany({
      where: { userId, action: { not: 'login' }, ...(eventId ? { eventId } : {}) },
      select: { action: true, createdAt: true, eventId: true, event: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Number(limit) || 200),
    }),
    prisma.order.findMany({
      where: { userId, ...(eventId ? { eventId } : {}) },
      select: { status: true, totalAmount: true, createdAt: true, event: { select: { name: true } }, _count: { select: { tickets: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  return {
    user,
    timeline: rows.filter((r) => !SYSTEM.test(r.action)).map((r) => ({ at: r.createdAt, action: r.action, label: STEP_ACTIONS[r.action] || r.action.replace(/_/g, ' '), event: r.event?.name || null, eventId: r.eventId })),
    orders: orders.map((o) => ({ at: o.createdAt, status: o.status, amountPkr: Math.round(Number(o.totalAmount || 0)), tickets: o._count.tickets, event: o.event?.name || null })),
  };
}
