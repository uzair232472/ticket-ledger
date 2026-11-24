// The behaviour report is counted in SQL (services/behaviourReport.js). This checks it gives the same numbers as
// the earlier version, which loaded every behaviour row into memory (kept below, unchanged except that rows are
// read in time order so "last event" is defined). Read-only: runs against whatever the development database holds.
import assert from 'node:assert/strict';
import test from 'node:test';

const prisma = (await import('./src/config/prisma.js')).default;
const { behaviourReport, STEP_ACTIONS } = await import('./src/services/behaviourReport.js');
test.after(() => prisma.$disconnect());

const DAY = 86_400_000;
const PAID = ['SUCCESSFUL', 'PARTIALLY_REFUNDED'];
const SYSTEM = /EVALUATION|^AI_/;

// ── Reference: the earlier in-memory version ──────────────────────────────────────────────────────────────
const who = (b) => b.userId || b.sessionId;

async function inMemoryReport({ days = 30, eventId = null, scope = 'customers', now = new Date() } = {}) {
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
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

// ── Comparison ───────────────────────────────────────────────────────────────────────────────────────────
// Ties in the sort orders were unordered before; compare as sets keyed by id, and the lists' order by their keys.
const byKey = (list, key) => Object.fromEntries(list.map((x) => [x[key], x]));
const strip = (r) => ({ ...r, activity: byKey(r.activity, 'action'), byEvent: byKey(r.byEvent, 'eventId'), customers: byKey(r.customers, 'userId'), events: byKey(r.events, 'id') });

const now = new Date();
const anyEvent = await prisma.behaviorEvent.findFirst({ where: { eventId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { eventId: true } });
const cases = [
  { days: 30 }, { days: 7 }, { days: 365 }, { days: 365, scope: 'all' }, { days: 1 },
  ...(anyEvent ? [{ days: 365, eventId: anyEvent.eventId }, { days: 365, eventId: anyEvent.eventId, scope: 'all' }] : []),
];

for (const c of cases) {
  test(`SQL report = in-memory report (${JSON.stringify(c)})`, async () => {
    const [sql, mem] = await Promise.all([behaviourReport({ ...c, now }), inMemoryReport({ ...c, now })]);
    // Top-50 / top-100 lists can differ only where ties sit on the cut; this database is smaller than both caps
    if (mem.byEvent.length < 50 && mem.customers.length < 100) assert.deepEqual(strip(sql), strip(mem));
    else assert.deepEqual(sql.summary, mem.summary);
    for (const list of ['byEvent', 'customers']) {
      const keys = (r) => r[list].map((x) => (list === 'byEvent' ? [x.viewers, x.bought] : [+x.lastActive]).join());
      assert.deepEqual(keys(sql), keys(mem), `${list} order`);
    }
  });
}

test('the report never loads behaviour rows (no findMany on BehaviorEvent)', async () => {
  const real = prisma.behaviorEvent.findMany;
  prisma.behaviorEvent.findMany = () => { throw new Error('findMany called'); };
  try {
    await behaviourReport({ days: 365, scope: 'all', now });
  } finally {
    prisma.behaviorEvent.findMany = real;
  }
});
