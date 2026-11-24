// Purchase intent and Abandoned checkouts are counted in SQL (services/intentAnalyticsService.js). This checks they
// give the same results as the earlier version that loaded every behaviour row into memory
// (test_fixtures/intentAnalytics.inmemory.js). Read-only: runs against whatever the development database holds.
import assert from 'node:assert/strict';
import test from 'node:test';

const prisma = (await import('./src/config/prisma.js')).default;
const sql = await import('./src/services/intentAnalyticsService.js');
const mem = await import('./test_fixtures/intentAnalytics.inmemory.js');
test.after(() => prisma.$disconnect());

const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
const busiest = await prisma.behaviorEvent.groupBy({ by: ['eventId'], where: { eventId: { not: null } }, _count: true, orderBy: { _count: { eventId: 'desc' } }, take: 6 });
const eventIds = busiest.map((b) => b.eventId);

// Lists were sorted with ties in whatever order the rows came back; compare as sets keyed by id, plus the order of
// the sort keys
const keyed = (list, key) => Object.fromEntries(list.map((x) => [x[key], x]));

test('setup: the database has a super admin and events with behaviour', () => {
  assert.ok(admin, 'no SUPER_ADMIN account');
  assert.ok(eventIds.length > 0, 'no behaviour rows with an event');
});

for (const id of eventIds) {
  test(`Purchase intent: SQL = in-memory (event ${id.slice(0, 8)})`, async () => {
    const [a, b] = await Promise.all([sql.getEventIntentAnalytics(id, admin), mem.getEventIntentAnalytics(id, admin)]);
    assert.deepEqual({ ...a, usersLikelyToBuy: keyed(a.usersLikelyToBuy, 'identifier'), abandonedUsers: keyed(a.abandonedUsers, 'identifier') },
      { ...b, usersLikelyToBuy: keyed(b.usersLikelyToBuy, 'identifier'), abandonedUsers: keyed(b.abandonedUsers, 'identifier') });
    for (const list of ['usersLikelyToBuy', 'abandonedUsers']) assert.deepEqual(a[list].map((x) => x.intentScore), b[list].map((x) => x.intentScore));
  });
}

const dashCases = [
  {}, { eventId: eventIds[0] }, { minScore: 70 }, { reason: 'PAYMENT_FAILED' }, { reason: 'HOLD_EXPIRED' }, { reason: 'LEFT_AT_CHECKOUT' }, { limit: 5 },
];
for (const c of dashCases) {
  test(`Abandoned checkouts: SQL = in-memory (${JSON.stringify(c)})`, async () => {
    const [a, b] = await Promise.all([
      sql.getAbandonedIntentDashboard({ ...c, requesterUser: admin }), mem.getAbandonedIntentDashboard({ ...c, requesterUser: admin }),
    ]);
    if (c.limit) {
      assert.deepEqual(a.summary, b.summary);
      assert.deepEqual(a.abandonedUsers.map((x) => +new Date(x.lastActionTime)), b.abandonedUsers.map((x) => +new Date(x.lastActionTime)));
      return;
    }
    assert.deepEqual({ ...a, abandonedUsers: keyed(a.abandonedUsers, 'id') }, { ...b, abandonedUsers: keyed(b.abandonedUsers, 'id') });
    assert.deepEqual(a.abandonedUsers.map((x) => +new Date(x.lastActionTime)), b.abandonedUsers.map((x) => +new Date(x.lastActionTime)));
  });
}

test('neither page loads behaviour rows (no findMany on BehaviorEvent)', async () => {
  const real = prisma.behaviorEvent.findMany;
  prisma.behaviorEvent.findMany = () => { throw new Error('findMany called'); };
  try {
    await sql.getEventIntentAnalytics(eventIds[0], admin);
    await sql.getAbandonedIntentDashboard({ requesterUser: admin });
  } finally {
    prisma.behaviorEvent.findMany = real;
  }
});

// ── Edge cases on a fixture event (removed afterwards): metadata shapes, guests, buyers, every reason ────────
test('fixture event: both pages equal the in-memory version on every edge case', async (t) => {
  const run = Math.random().toString(36).slice(2, 8);
  const ids = [];
  const mk = async (n) => {
    const u = await prisma.user.create({ data: { name: `Intent ${n}`, email: `isql_${n}_${run}@example.com`, passwordHash: 'x', role: n === 'org' ? 'ORGANIZER' : 'CUSTOMER', status: 'ACTIVE', isVerified: true } });
    ids.push(u.id);
    return u;
  };
  const org = await mk('org');
  const company = await prisma.company.create({ data: { userId: org.id, companyName: `Intent Org ${run}`, ownerName: org.name, phone: '+923001112223', email: org.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  const start = new Date(Date.now() + 7 * 86400000);
  const ev = await prisma.event.create({ data: { companyId: company.id, name: `Intent Event ${run}`, description: 't', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: start, startsAt: start, time: '19:00', city: 'Karachi', venue: 'Hall' } });
  t.after(async () => {
    await prisma.behaviorEvent.deleteMany({ where: { eventId: ev.id } });
    await prisma.ticket.deleteMany({ where: { eventId: ev.id } });
    await prisma.order.deleteMany({ where: { eventId: ev.id } });
    await prisma.event.delete({ where: { id: ev.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });
  const tier = await prisma.ticketTier.create({ data: { eventId: ev.id, name: 'GA', price: 1500, totalQuantity: 10, availableQuantity: 10 } });
  await prisma.ticketTier.create({ data: { eventId: ev.id, name: 'VIP', price: 5000, totalQuantity: 10, availableQuantity: 10 } });

  const users = {};
  for (const n of ['str', 'nul', 'zero', 'bool', 'paid', 'ticket', 'hold', 'removed', 'pay', 'seatonly', 'views', 'refunded']) users[n] = await mk(n);
  const T0 = Date.now() - 3600000;
  let k = 0;
  const rows = [];
  const add = (who, action, metadata) => rows.push({ userId: who.userId ?? null, sessionId: 'sessionId' in who ? who.sessionId : `s_${who.userId}`, eventId: ev.id, action, metadata, createdAt: new Date(T0 + ++k * 1000) });
  const U = (n) => ({ userId: users[n].id });
  add(U('str'), 'event_view'); add(U('str'), 'seat_selected', { price: '2000' }); add(U('str'), 'checkout_started', { cartValue: ' 3500.50 ' });
  add(U('nul'), 'seat_locked', { price: 1800 }); add(U('nul'), 'checkout_started', { cartValue: null, totalAmount: 4200 });
  add(U('zero'), 'seat_locked', { price: 900 }); add(U('zero'), 'checkout_started', { cartValue: 0, totalAmount: 9999 }); add(U('zero'), 'checkout_abandoned', { reason: 'user_discarded_tickets' });
  add(U('bool'), 'checkout_started', { cartValue: true }); add(U('bool'), 'checkout_expired');
  add(U('paid'), 'checkout_started', { cartValue: 1500 }); add(U('paid'), 'payment_completed'); add(U('paid'), 'ticket_purchased');
  add(U('ticket'), 'seat_selected', { price: 1500 }); add(U('ticket'), 'checkout_started');
  add(U('hold'), 'seat_locked', { price: 'abc' }); add(U('hold'), 'seat_hold_released', { reason: 'HOLD_EXPIRED' });
  add(U('removed'), 'seat_selected'); add(U('removed'), 'checkout_cancelled', { reason: 'CUSTOMER_CANCELLED' });
  add(U('pay'), 'checkout_started', { totalAmount: '7000' }); add(U('pay'), 'payment_failed', { reason: 'card_declined' });
  add(U('seatonly'), 'event_view'); add(U('seatonly'), 'event_view'); add(U('seatonly'), 'event_view'); add(U('seatonly'), 'seat_selected', ['not', 'an', 'object']);
  add(U('views'), 'event_view'); add(U('views'), 'event_view');
  add(U('refunded'), 'checkout_started', { cartValue: 2500 });
  // Guests: one abandons with a reason, one only views, one more. (Two rows at the same instant are left out: which
  // is "last" was never defined, the old version took the database's order, the SQL version the higher row id.)
  add({ sessionId: `g1_${run}` }, 'seat_selected', { price: 1500 }); add({ sessionId: `g1_${run}` }, 'checkout_started', { cartValue: '1500' }); add({ sessionId: `g1_${run}` }, 'payment_failed');
  add({ sessionId: `g2_${run}` }, 'event_view');
  add({ sessionId: `g3_${run}` }, 'seat_locked', { price: 5000 }); add({ sessionId: `g3_${run}` }, 'checkout_started', 'just a string');
  add({ userId: null, sessionId: '' }, 'checkout_started'); // no account and no session: nobody to count
  await prisma.behaviorEvent.createMany({ data: rows });

  // A paid order (excluded), a live ticket without a paid order (excluded), a refunded-only order (still listed)
  const paidOrder = await prisma.order.create({ data: { userId: users.paid.id, eventId: ev.id, totalAmount: 1500, status: 'SUCCESSFUL' } });
  const seat = await prisma.seat.create({ data: { eventId: ev.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: '1', status: 'SOLD' } });
  await prisma.ticket.create({ data: { orderId: paidOrder.id, eventId: ev.id, seatId: seat.id, userId: users.paid.id, price: 1500, manualCode: `TL-${run.slice(0, 4).toUpperCase()}-AAAA` } });
  const pending = await prisma.order.create({ data: { userId: users.ticket.id, eventId: ev.id, totalAmount: 1500, status: 'PENDING' } });
  const seat2 = await prisma.seat.create({ data: { eventId: ev.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: '2', status: 'SOLD' } });
  await prisma.ticket.create({ data: { orderId: pending.id, eventId: ev.id, seatId: seat2.id, userId: users.ticket.id, price: 1500, manualCode: `TL-${run.slice(0, 4).toUpperCase()}-BBBB` } });
  await prisma.order.create({ data: { userId: users.refunded.id, eventId: ev.id, totalAmount: 2500, status: 'REFUNDED' } });

  const [ia, ib] = await Promise.all([sql.getEventIntentAnalytics(ev.id, admin), mem.getEventIntentAnalytics(ev.id, admin)]);
  assert.deepEqual({ ...ia, usersLikelyToBuy: keyed(ia.usersLikelyToBuy, 'identifier'), abandonedUsers: keyed(ia.abandonedUsers, 'identifier') },
    { ...ib, usersLikelyToBuy: keyed(ib.usersLikelyToBuy, 'identifier'), abandonedUsers: keyed(ib.abandonedUsers, 'identifier') });
  assert.equal(ia.summary.buyersCount, 1);

  for (const c of [{}, { reason: 'HOLD_EXPIRED' }, { minScore: 60 }]) {
    const [a, b] = await Promise.all([
      sql.getAbandonedIntentDashboard({ ...c, eventId: ev.id, requesterUser: admin }), mem.getAbandonedIntentDashboard({ ...c, eventId: ev.id, requesterUser: admin }),
    ]);
    assert.deepEqual({ ...a, abandonedUsers: keyed(a.abandonedUsers, 'id') }, { ...b, abandonedUsers: keyed(b.abandonedUsers, 'id') }, JSON.stringify(c));
  }
  const all = await sql.getAbandonedIntentDashboard({ eventId: ev.id, requesterUser: admin, limit: 100 });
  const by = Object.fromEntries(all.abandonedUsers.map((x) => [x.user.name || x.sessionId, x]));
  // Spot checks of what the fixture is meant to exercise
  assert.equal(by['Intent str'].cartValue, 3500.5);
  assert.equal(by['Intent nul'].cartValue, 4200);
  assert.deepEqual([by['Intent zero'].cartValue, by['Intent zero'].cartValueSource, by['Intent zero'].likelyReason], [900, 'seat_price', 'REMOVED_TICKETS']);
  assert.equal(by['Intent bool'].cartValue, 1);
  assert.equal(by['Intent hold'].likelyReason, 'HOLD_EXPIRED');
  assert.equal(by['Intent hold'].cartValueSource, 'cheapest_tier');
  assert.equal(by['Intent pay'].likelyReason, 'PAYMENT_FAILED');
  assert.ok(!by['Intent paid'] && !by['Intent ticket'] && !by['Intent views'], 'buyers, ticket holders and viewers are not listed');
  assert.ok(by['Intent refunded'], 'a refunded-only customer has not bought');
  assert.equal(all.abandonedUsers.filter((x) => !x.user.isRegistered).length, 2);
});
