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

const who = (b) => b.userId || b.sessionId;

export async function behaviourReport({ days = 30, eventId = null, scope = 'customers', now = new Date() } = {}) {
  const span = Math.min(365, Math.max(1, Number(days) || 30));
  const since = new Date(now.getTime() - span * DAY);
  const customersOnly = scope !== 'all';
  const userFilter = customersOnly ? { OR: [{ userId: null }, { user: { role: 'CUSTOMER' } }] } : {};

  const rows = await prisma.behaviorEvent.findMany({
    where: { createdAt: { gte: since, lt: now }, ...(eventId ? { eventId } : {}), ...userFilter },
    select: {
      userId: true, sessionId: true, eventId: true, action: true, createdAt: true,
      user: { select: { name: true, email: true, role: true } },
      event: { select: { name: true, city: true, type: true } },
    },
  });
  const orders = await prisma.order.findMany({
    where: { status: { in: PAID }, createdAt: { gte: since, lt: now }, ...(eventId ? { eventId } : {}), ...(customersOnly ? { user: { role: 'CUSTOMER' } } : {}) },
    select: { userId: true, eventId: true, totalAmount: true, createdAt: true, event: { select: { name: true, city: true } } },
  });

  // 1. Activity by step (sign-ins counted apart; system evaluations left out)
  const activity = {};
  let signIns = 0;
  for (const r of rows) {
    if (r.action === 'login') { signIns += 1; continue; }
    if (SYSTEM.test(r.action)) continue;
    activity[r.action] = (activity[r.action] || 0) + 1;
  }

  // 2. Per event: distinct people at each step, buyers from paid orders
  const events = new Map();
  const ev = (id, meta) => {
    if (!events.has(id)) events.set(id, { eventId: id, name: meta?.name || 'Event', city: meta?.city || null, type: meta?.type || null, views: 0, viewers: new Set(), seat: new Set(), checkout: new Set(), left: new Set(), buyers: new Set(), revenue: 0 });
    return events.get(id);
  };
  for (const r of rows) {
    if (!r.eventId || !who(r)) continue;
    const e = ev(r.eventId, r.event);
    if (r.action === 'event_view') { e.views += 1; e.viewers.add(who(r)); }
    if (r.action === 'seat_selected' || r.action === 'seat_locked') e.seat.add(who(r));
    if (r.action === 'checkout_started') e.checkout.add(who(r));
    if (r.action === 'checkout_abandoned' || r.action === 'payment_failed') e.left.add(who(r));
  }
  for (const o of orders) {
    const e = ev(o.eventId, o.event);
    e.buyers.add(o.userId);
    e.revenue += Number(o.totalAmount || 0);
  }
  const byEvent = [...events.values()].map((e) => {
    const viewers = new Set([...e.viewers, ...e.seat, ...e.checkout]).size;
    return {
      eventId: e.eventId, name: e.name, city: e.city, type: e.type, views: e.views, viewers,
      choseSeat: e.seat.size, startedCheckout: e.checkout.size, leftCheckout: e.left.size, bought: e.buyers.size,
      revenuePkr: Math.round(e.revenue), conversionPct: viewers ? Math.round((e.buyers.size / viewers) * 100) : null,
    };
  }).sort((a, b) => b.viewers - a.viewers || b.bought - a.bought);

  // 3. Per signed-in person (guests have no identity to list; they are counted in the totals)
  const people = new Map();
  for (const r of rows) {
    if (!r.userId || r.action === 'login' || SYSTEM.test(r.action)) continue;
    if (!people.has(r.userId)) people.set(r.userId, { userId: r.userId, name: r.user?.name || '—', email: r.user?.email || null, role: r.user?.role || null, events: new Set(), views: 0, seats: 0, checkouts: 0, left: 0, orders: 0, spentPkr: 0, lastActive: r.createdAt, lastEvent: null });
    const p = people.get(r.userId);
    if (r.eventId) p.events.add(r.eventId);
    if (r.action === 'event_view') p.views += 1;
    if (r.action === 'seat_selected' || r.action === 'seat_locked') p.seats += 1;
    if (r.action === 'checkout_started') p.checkouts += 1;
    if (r.action === 'checkout_abandoned' || r.action === 'payment_failed') p.left += 1;
    if (r.createdAt >= p.lastActive) { p.lastActive = r.createdAt; if (r.event?.name) p.lastEvent = r.event.name; }
  }
  for (const o of orders) {
    const p = people.get(o.userId);
    if (!p) continue;
    p.orders += 1;
    p.spentPkr += Number(o.totalAmount || 0);
    p.events.add(o.eventId);
  }
  const customers = [...people.values()]
    .map((p) => ({ ...p, events: p.events.size, spentPkr: Math.round(p.spentPkr) }))
    .sort((a, b) => b.lastActive - a.lastActive);

  // Buyers: first-time = their first paid order on the platform falls in this period
  const buyerIds = [...new Set(orders.map((o) => o.userId))];
  const earlier = buyerIds.length
    ? await prisma.order.findMany({ where: { userId: { in: buyerIds }, status: { in: PAID }, createdAt: { lt: since } }, select: { userId: true }, distinct: ['userId'] })
    : [];
  const guests = new Set(rows.filter((r) => !r.userId && r.sessionId && r.action !== 'login').map((r) => r.sessionId)).size;

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
      activePeople: customers.length + guests,
      signedInPeople: customers.length,
      guestSessions: guests,
      signIns,
      eventViews: activity.event_view || 0,
      buyers: buyerIds.length,
      firstTimeBuyers: buyerIds.length - earlier.length,
      returningBuyers: earlier.length,
      orders: orders.length,
      revenuePkr: Math.round(orders.reduce((a, o) => a + Number(o.totalAmount || 0), 0)),
    },
    activity: Object.entries(activity).sort((a, b) => b[1] - a[1]).map(([action, count]) => ({ action, label: STEP_ACTIONS[action] || action.replace(/_/g, ' '), count })),
    byEvent: byEvent.slice(0, 50),
    customers: customers.slice(0, 100),
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
