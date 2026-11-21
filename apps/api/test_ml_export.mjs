/**
 * Training-data exporter, against a database COPY (name must end in "_verify"). Builds a small fixture world
 * in time order and lets the REAL live snapshot jobs log the predictions at the moments they would run
 * (sales open, end of a visit, 25 h and 24 h before the event). Then checks the export: only snapshot rows,
 * only server-verified live payments, blind fraud labels, test/internal data left out, prices and capacity
 * as they were (never current values), and nothing dated after the export moment matters.
 *
 *   DATABASE_URL=postgresql://.../ticketledger_export_verify node --test test_ml_export.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
process.env.ML_SHADOW_ENABLED = 'false'; // snapshots only: no ML service needed
const prisma = (await import('./src/config/prisma.js')).default;
const { buildExport, exportPolicy, pseudo, accountExclusion, checkRows, COLUMNS } = await import('./src/services/ml/export.js');
const { referencePrice, clearReferencePriceCache } = await import('./src/services/ml/features.js');
const jobs = await import('./src/services/ml/jobs.js');
const { visitId } = await import('./src/services/ml/visits.js');
const { recordPaymentEvidence, EVIDENCE_ACTION } = await import('./src/services/paymentEvidence.js');
const { logPredictions } = await import('./src/services/ml/shadow.js');
// Retire the fixture organizers afterwards (test domain): their events then never enter a later run's typical prices
test.after(async () => {
  for (const id of [ids.org].filter(Boolean)) await prisma.user.update({ where: { id }, data: { email: `retired-${id}@example.com` } }).catch(() => {});
  await prisma.$disconnect();
});

const H = 3600_000;
const D = 24 * H;
const M = 60_000;
const NOW = new Date('2026-11-01T00:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);
const plus = (d, ms) => new Date(d.getTime() + ms);
const tag = randomUUID().slice(0, 8);
const dom = `fx${tag}.pk`;
const policy = exportPolicy({}, {});
const ids = {};

async function user(key, role = 'CUSTOMER', domain = dom, createdAt = ago(400 * D)) {
  const u = await prisma.user.create({ data: { email: `${key}-${tag}@${domain}`, passwordHash: 'x', name: key, role, status: 'ACTIVE', createdAt } });
  ids[key] = u.id;
  return u;
}
async function company(owner) {
  const c = await prisma.company.create({ data: { userId: owner.id, companyName: `Fx ${tag} ${owner.name}`, ownerName: 'Org', phone: '0300', email: owner.email, city: 'Lahore', ntnCnic: '1', documentUrl: 'x', status: 'APPROVED' } });
  // Simulated timeline: the account and company were last changed long before any prediction
  const old = ago(400 * D).toISOString();
  await prisma.$executeRaw`UPDATE "User" SET "updatedAt" = ${old}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${owner.id}`;
  await prisma.$executeRaw`UPDATE "Company" SET "updatedAt" = ${old}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${c.id}`;
  return c;
}
async function event(key, { companyId, open, start, gates = [], price = 1000 }) {
  const e = await prisma.event.create({
    data: {
      companyId, name: `${key}-${tag}`, description: 'fixture', type: 'CRICKET_MATCH', status: 'PUBLISHED', city: 'Lahore', venue: 'Fixture Ground',
      date: start, time: '19:00', startsAt: start, endsAt: plus(start, 3 * H), salesOpenAt: open, createdAt: plus(open, -D),
      tiers: { create: [{ name: 'General', price, totalQuantity: 100, availableQuantity: 90 }, { name: 'VIP', price: price * 3, totalQuantity: 20, availableQuantity: 18 }] },
    },
    include: { tiers: true },
  });
  for (const [i, g] of gates.entries()) await prisma.eventGate.create({ data: { eventId: e.id, name: `G${i + 1}`, capacityPerHour: g, sortOrder: i } });
  // Creating the event is not a change after any prediction: in the simulated timeline it happened at createdAt
  await prisma.mlInputChange.deleteMany({ where: { eventId: e.id } });
  ids[key] = e.id;
  return { ...e, ga: e.tiers.find((t) => t.name === 'General'), vip: e.tiers.find((t) => t.name === 'VIP') };
}
let seatNo = 0;
/** livemode true/false = server-side evidence with that provider mode; null = no evidence (MOCK, simulated gateways). */
async function order(key, { userId, ev, tier, n = 1, at, method = 'STRIPE', livemode = true, status = 'SUCCESSFUL' }) {
  const tx = method === 'STRIPE' ? `pi_fx_${randomUUID().replace(/-/g, '')}` : `${method}_TX_${randomUUID()}`;
  const o = await prisma.order.create({ data: { userId, eventId: ev.id, totalAmount: Number(tier.price) * n, status, paymentMethod: method, paymentTxId: tx, createdAt: at } });
  const tickets = [];
  for (let i = 0; i < n; i++) {
    const seat = await prisma.seat.create({ data: { eventId: ev.id, tierId: tier.id, section: 'A', row: '1', seatNumber: String(++seatNo), status: 'SOLD' } });
    tickets.push(await prisma.ticket.create({ data: { orderId: o.id, eventId: ev.id, seatId: seat.id, userId, price: tier.price, createdAt: at } }));
  }
  if (livemode !== null) {
    await recordPaymentEvidence({ orderIds: [o.id], userId, paymentMethod: method, verification: { success: true, real: true, transactionId: tx, livemode, verifiedVia: 'test' } });
    await prisma.auditLog.updateMany({ where: { action: EVIDENCE_ACTION, targetId: o.id }, data: { createdAt: at } });
  }
  ids[key] = o.id;
  return { ...o, tickets };
}
const checkIn = async (ticket, ev, gateName, at) => {
  const gate = await prisma.eventGate.findFirst({ where: { eventId: ev.id, name: gateName } });
  await prisma.checkIn.create({ data: { ticketId: ticket.id, eventId: ev.id, staffId: ids.staff, result: 'GREEN', reason: 'ok', gateId: gate.id, gate: gateName, scannedAt: at } });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { checkedInAt: at, status: 'SCANNED' } });
};
const behave = (userId, eventId, action, at, metadata) => prisma.behaviorEvent.create({ data: { userId, eventId, action, sessionId: `fx-${tag}`, createdAt: at, metadata } });
const FRAUD_FEATURES = { event_type: 'CRICKET_MATCH', city: 'Lahore', country: 'PK', payment_method: 'STRIPE', tickets_requested: 2, unit_price_rel: 1, checkout_duration_seconds: 40, clicks_per_minute: 20, rapid_seat_attempts: 0, time_on_seatmap_seconds: 30, device_switches: 0, account_age_days: 300, customer_prior_orders: 1, orders_last_24h: 0, failed_payments_30d: 0, prior_resale_listings: 0, hours_since_sales_open: 100 };
/** The checkout's fraud prediction, logged by the real logger at the time of the order (in fixture order). */
const fraudLog = (o, decision) => logPredictions('fraud', [{ subjectType: 'ORDER', subjectId: o.id, eventId: o.eventId, userId: o.userId, asOf: o.createdAt, rule: { score: decision === 'SUSPICIOUS' ? 60 : 10, decision }, features: FRAUD_FEATURES }]);
async function fraudCase(o, { decision, cell, p, reviews }) {
  const s = await prisma.fraudSample.create({ data: { orderId: o.id, cell, selected: true, inclusionProbability: p, ruleDecision: decision, mlWouldFlag: false } });
  for (const r of reviews) await prisma.fraudReview.create({ data: { sampleId: s.id, orderId: o.id, reviewerId: 'rev', ...r } });
}

let first;
let w;
test('fixture world, with snapshots logged by the live jobs at the time they would run', async () => {
  const org = await user('org', 'ORGANIZER');
  const tOrg = await user('torg', 'ORGANIZER', 'example.com');
  await user('staff', 'GATE_STAFF');
  const c1 = await user('c1');
  const c2 = await user('c2');
  // c3 signs up after genuine use began (the first live-verified payment, 80 days ago) and receives a ticket
  const c3 = await user('c3', 'CUSTOMER', dom, ago(70 * D));
  const tst = await user('tst', 'CUSTOMER', 'example.com');
  const co = await company(org);
  const tCo = await company(tOrg);

  // P: an earlier event (c1 attends). Its payment is the first live-verified one.
  const P = await event('P', { companyId: co.id, open: ago(90 * D), start: ago(60 * D), gates: [800] });
  await jobs.snapshotDemand({ now: plus(P.salesOpenAt, 10 * M) });
  const oP = await order('oP', { userId: c1.id, ev: P, tier: P.ga, at: ago(80 * D) });
  await checkIn(oP.tickets[0], P, 'G1', ago(60 * D - 10 * M));
  // A: the main event
  const A = await event('A', { companyId: co.id, open: ago(40 * D), start: ago(10 * D), gates: [600, 900] });
  await jobs.snapshotDemand({ now: plus(A.salesOpenAt, 10 * M) });
  const o2 = await order('o2', { userId: c2.id, ev: A, tier: A.vip, at: plus(A.salesOpenAt, 2 * H) });
  await fraudLog(o2, 'NORMAL');
  // c2 browses A without buying
  const v2 = ago(38 * D);
  await behave(c2.id, A.id, 'event_view', v2);
  await jobs.scoreVisits({ now: plus(v2, 40 * M) });
  // c1 buys 2 GA during a visit
  const v1 = ago(35 * D);
  await behave(c1.id, A.id, 'event_view', v1);
  await behave(c1.id, A.id, 'seat_selected', plus(v1, 2 * M), { price: 1000 });
  await behave(c1.id, A.id, 'checkout_started', plus(v1, 3 * M));
  const o1 = await order('o1', { userId: c1.id, ev: A, tier: A.ga, n: 2, at: plus(v1, 4 * M) });
  await fraudLog(o1, 'SUSPICIOUS');
  await behave(c1.id, A.id, 'checkout_started', plus(v1, 5 * M));
  await jobs.scoreVisits({ now: plus(v1, 40 * M) });
  // A test account browses A (snapshot logged, never exported)
  const vt = ago(36 * D);
  await behave(tst.id, A.id, 'event_view', vt);
  await jobs.scoreVisits({ now: plus(vt, 40 * M) });
  const o4 = await order('o4', { userId: c2.id, ev: A, tier: A.ga, at: ago(30 * D) });
  await fraudLog(o4, 'NORMAL');
  // B: sold through MOCK (never real); D: a Stripe TEST-mode payment (livemode false)
  const B = await event('B', { companyId: co.id, open: ago(30 * D), start: ago(5 * D), gates: [600, null] });
  await jobs.snapshotDemand({ now: plus(B.salesOpenAt, 10 * M) });
  await order('oB', { userId: c2.id, ev: B, tier: B.ga, at: plus(B.salesOpenAt, H), method: 'MOCK', livemode: null });
  const Dv = await event('D', { companyId: co.id, open: ago(20 * D), start: ago(3 * D), gates: [600] });
  await jobs.snapshotDemand({ now: plus(Dv.salesOpenAt, 10 * M) });
  const oD = await order('oD', { userId: c2.id, ev: Dv, tier: Dv.ga, at: plus(Dv.salesOpenAt, H), livemode: false });
  await fraudLog(oD, 'NORMAL');
  // V: c1 visits V, and V's price is changed during the visit, before the visit job reads the inputs.
  // V is created after A's sales opened, so it is not behind A's typical price (which refers to that open).
  const V = await event('V', { companyId: co.id, open: ago(38.5 * D), start: ago(8 * D), gates: [600] });
  const vv = ago(33 * D);
  await behave(c1.id, V.id, 'event_view', vv);
  await prisma.mlInputChange.create({ data: { eventId: V.id, source: 'TicketTier', changedAt: plus(vv, 60_000) } });
  await jobs.scoreVisits({ now: plus(vv, 40 * M) });
  // N: a real event nobody snapshotted (server down at sales open); T: a test organizer's event
  await event('N', { companyId: co.id, open: ago(25 * D), start: ago(4 * D), gates: [600] });
  await event('T', { companyId: tCo.id, open: ago(95 * D), start: ago(70 * D), price: 900000 });
  // c1's 2nd ticket moves to c3 before the prediction time (24 h before A)
  await prisma.ticket.update({ where: { id: o1.tickets[1].id }, data: { userId: c3.id } });
  await prisma.ticketTransferHistory.create({ data: { ticketId: o1.tickets[1].id, fromUserId: c1.id, toUserId: c3.id, transferType: 'DIRECT_TRANSFER', createdAt: ago(12 * D) } });
  // Crowd 25 h and attendance 24 h before A
  await jobs.scoreCrowd({ now: plus(A.startsAt, -25 * H) });
  await jobs.snapshotAttendance({ now: plus(A.startsAt, -24 * H + 10 * M) });
  // After the prediction time: o4 refunded; check-ins (c1 G1 -20 min, c2 G2 +5 min; c3 no-show)
  await prisma.ticket.update({ where: { id: o4.tickets[0].id }, data: { status: 'CANCELLED' } });
  await prisma.refund.create({ data: { ticketId: o4.tickets[0].id, eventId: A.id, userId: c2.id, amount: 1000, organizerShare: 0, reason: 'ADMIN', createdAt: ago(10.5 * D) } });
  await checkIn(o1.tickets[0], A, 'G1', plus(A.startsAt, -20 * M));
  await checkIn(o2.tickets[0], A, 'G2', plus(A.startsAt, 5 * M));
  // C: on sale now (its 48 hours are not over)
  const C = await event('C', { companyId: co.id, open: ago(1 * D), start: plus(NOW, 20 * D), gates: [600] });
  await jobs.snapshotDemand({ now: plus(C.salesOpenAt, 10 * M) });
  const o5 = await order('o5', { userId: c2.id, ev: C, tier: C.ga, at: ago(20 * H) });
  await fraudLog(o5, 'NORMAL');
  // Fraud: o1 blind CONFIRMED (p=1, after an exposed review); o5 blind LEGITIMATE (p=0.02); o2 exposed only;
  // o4 latest blind UNRESOLVED; oD (test-mode payment) blind CONFIRMED; one blocked checkout
  await fraudCase(o1, { decision: 'SUSPICIOUS', cell: 'RULE_ONLY', p: 1, reviews: [{ decision: 'LEGITIMATE', blind: false, createdAt: ago(30 * D) }, { decision: 'CONFIRMED_FRAUD', blind: true, createdAt: ago(29 * D) }] });
  await fraudCase(o5, { decision: 'NORMAL', cell: 'NEITHER', p: 0.02, reviews: [{ decision: 'LEGITIMATE', blind: true, createdAt: ago(10 * H) }] });
  await fraudCase(o2, { decision: 'NORMAL', cell: 'NEITHER', p: 0.02, reviews: [{ decision: 'CONFIRMED_FRAUD', blind: false, createdAt: ago(20 * D) }] });
  await fraudCase(o4, { decision: 'NORMAL', cell: 'NEITHER', p: 0.02, reviews: [{ decision: 'LEGITIMATE', blind: true, createdAt: ago(28 * D) }, { decision: 'UNRESOLVED', blind: true, createdAt: ago(27 * D) }] });
  await fraudCase(oD, { decision: 'NORMAL', cell: 'NEITHER', p: 0.02, reviews: [{ decision: 'CONFIRMED_FRAUD', blind: true, createdAt: ago(15 * D) }] });
  await prisma.mlPrediction.create({ data: { modelName: 'fraud', role: 'RULES', subjectType: 'CHECKOUT_ATTEMPT', subjectId: randomUUID(), eventId: A.id, userId: c1.id, asOf: ago(20 * D), createdAt: ago(20 * D), score: 90, decision: 'CRITICAL_BOT', features: FRAUD_FEATURES } });
  // The jobs ran in the simulated past: give their rows the write time they would have had
  await prisma.$executeRaw`UPDATE "MlPrediction" SET "createdAt" = "asOf" + interval '1 minute' WHERE "createdAt" > ${NOW.toISOString()}::timestamptz AT TIME ZONE 'UTC' AND "asOf" < ${NOW.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;
  w = { A, B, C, P, Dv, v1, v2 };
  first = await buildExport({ policy, now: NOW });
});

const fx = () => ['A', 'B', 'C', 'P', 'D', 'N', 'T', 'V'].map((k) => pseudo('E', ids[k]));
const mine = (rows) => rows.filter((r) => fx().includes(r.event_id));
const pick = (name) => mine(first.datasets[name]);

test('policy: test accounts, internal domains, non-customers', () => {
  assert.equal(accountExclusion({ id: 'x', email: 'a@example.com', role: 'CUSTOMER' }, policy), 'test e-mail domain');
  assert.equal(accountExclusion({ id: 'x', email: 'a@ticketledger.pk', role: 'CUSTOMER' }, policy), 'internal e-mail domain');
  assert.equal(accountExclusion({ id: 'x', email: 'a@shop.pk', role: 'ORGANIZER' }, policy), 'not a customer account');
  assert.equal(accountExclusion({ id: 'x', email: 'a@shop.pk', role: 'CUSTOMER' }, policy), null);
});

test('every row passes the row checks and comes from a prediction-time snapshot', () => {
  for (const [name, rows] of Object.entries(first.datasets)) {
    assert.deepEqual(checkRows(name, rows), [], name);
    assert.ok(rows.every((r) => r.feature_source === 'snapshot'), name);
  }
  assert.equal(first.report.containsTestData, false);
});

test('visits: verified labels from snapshots; test accounts left out', () => {
  const rows = pick('behavior_sequences');
  const c1 = rows.find((r) => r.session_id === pseudo('S', visitId(ids.c1, { eventId: ids.A, start: w.v1 })));
  assert.ok(c1, 'c1 visit exported');
  assert.equal(c1.purchased_7d, 1);
  assert.equal(c1.checkout_abandoned, 0, 'paid during the visit');
  assert.equal(c1.seat_selections, 1);
  assert.equal(c1.ticket_price, 1000);
  const c2 = rows.find((r) => r.session_id === pseudo('S', visitId(ids.c2, { eventId: ids.A, start: w.v2 })));
  assert.equal(c2.purchased_7d, 0);
  assert.equal(c2.checkout_abandoned, -1);
  assert.ok(!rows.some((r) => r.customer_id === pseudo('C', ids.tst)), 'test account');
  assert.ok(first.report.datasets.behavior_sequences.excluded['test e-mail domain'] >= 1);
  assert.ok(!rows.some((r) => r.event_id === pseudo('E', ids.V)), 'price changed between the visit and the capture');
  assert.ok(first.report.datasets.behavior_sequences.excluded['not exact: event inputs changed after the prediction moment'] >= 1);
});

test('fraud: only blind resolved reviews of live-verified orders, weighted by the sampling design', () => {
  const rows = pick('fraud_purchases');
  assert.deepEqual(rows.map((r) => r.order_id).sort(), [pseudo('O', ids.o1), pseudo('O', ids.o5)].sort());
  const o1 = rows.find((r) => r.order_id === pseudo('O', ids.o1));
  assert.equal(o1.is_fraud, 1);
  assert.equal(o1.sample_weight, 1);
  assert.equal(o1.rule_flag, 1);
  assert.equal(rows.find((r) => r.order_id === pseudo('O', ids.o5)).sample_weight, 50);
  assert.ok(first.report.datasets.fraud_purchases.excluded['no live server-side payment evidence'] >= 1, 'test-mode Stripe payment');
  const q = first.report.fraudLabels;
  assert.ok(q.exposedOnly >= 1 && q.unresolved >= 1 && q.blockedCheckouts >= 1);
});

test('demand: the sales-open snapshot; MOCK, test-mode, unsnapshotted, early and test events left out', () => {
  const rows = pick('event_demand');
  assert.deepEqual(rows.map((r) => r.event_id), [pseudo('E', ids.A)], 'only A');
  const a = rows[0];
  assert.equal(a.sales_48h, 1);
  assert.equal(a.venue_capacity, 120);
  assert.equal(a.min_price, 1000);
  const ex = first.report.datasets.event_demand.excluded;
  assert.ok(ex['48-hour sales include payments without live server-side evidence'] >= 2, 'B (MOCK) and D (test mode)');
  assert.ok(ex['no prediction-time snapshot'] >= 1, 'N');
  assert.ok(ex['sales opened before the first server-verified live payment'] >= 1, 'P');
  assert.ok(ex['test organizer'] >= 1, 'T');
  assert.ok(ex['first 48 hours not over yet'] >= 1, 'C');
});

test('attendance: 24 h snapshot; holder at that time; refund after it left out', () => {
  const rows = pick('attendance_no_show').filter((r) => r.event_id === pseudo('E', ids.A));
  assert.equal(rows.length, 3, 'two c1 tickets (one moved to c3) + c2 VIP; the refunded one is left out');
  const c1 = rows.find((r) => r.customer_id === pseudo('C', ids.c1));
  assert.equal(c1.checked_in, 1);
  assert.equal(c1.customer_prior_tickets, 1);
  assert.equal(c1.customer_prior_attended, 1);
  assert.equal(c1.tickets_in_order, 2);
  const c3 = rows.find((r) => r.customer_id === pseudo('C', ids.c3));
  assert.equal(c3.is_transferred, 1);
  assert.equal(c3.checked_in, 0);
  assert.equal(rows.find((r) => r.customer_id === pseudo('C', ids.c2)).tier_rank, 1);
  assert.ok(rows.every((r) => r.event_tickets_sold === 4), 'tickets live at the prediction time');
  assert.ok(first.report.datasets.attendance_no_show.excluded['refunded after the prediction time'] >= 1);
});

test('crowd: snapshot gate x slot rows with counted entries; no snapshot without gate capacity', () => {
  const rows = pick('crowd_flow').filter((r) => r.event_id === pseudo('E', ids.A));
  assert.equal(rows.length, 60);
  assert.equal(rows.reduce((a, r) => a + r.scans, 0), 2);
  assert.equal(rows.find((r) => r.scans === 1 && r.gate_capacity_per_hour === 600).minutes_from_start, -20);
  assert.ok(!pick('crowd_flow').some((r) => r.event_id === pseudo('E', ids.B)));
  assert.ok(first.report.crowdReadiness.finishedWithoutSnapshot['gate capacity per hour missing'] >= 1, 'B');
});

test("typical price leaves out test and internal organizers' events", async () => {
  clearReferencePriceCache();
  const at = ago(39 * D);
  const before = await referencePrice(at, 1);
  await event('T2', { companyId: (await prisma.company.findFirst({ where: { userId: ids.torg } })).id, open: ago(100 * D), start: ago(98 * D), price: 5_000_000 });
  clearReferencePriceCache();
  assert.equal(await referencePrice(at, 1), before);
});

test('no current values and no future data: later edits and records change nothing', async () => {
  const later = plus(NOW, 2 * H);
  const { A } = w;
  // Current values change: prices, capacity, gates, start time
  await prisma.ticketTier.updateMany({ where: { eventId: A.id }, data: { price: 7777, totalQuantity: 999 } });
  await prisma.eventGate.updateMany({ where: { eventId: A.id }, data: { capacityPerHour: 50 } });
  await prisma.event.update({ where: { id: A.id }, data: { startsAt: plus(A.startsAt, 2 * H) } });
  // Records after the export moment
  await order('late1', { userId: ids.c2, ev: A, tier: A.ga, at: later, method: 'MOCK', livemode: null });
  await order('late2', { userId: ids.c1, ev: w.P, tier: w.P.ga, at: later });
  await behave(ids.c2, A.id, 'event_view', later);
  await prisma.fraudReview.create({ data: { sampleId: (await prisma.fraudSample.findUnique({ where: { orderId: ids.o4 } })).id, orderId: ids.o4, reviewerId: 'rev', decision: 'CONFIRMED_FRAUD', blind: true, createdAt: later } });
  const again = await buildExport({ policy, now: NOW });
  for (const name of Object.keys(COLUMNS)) assert.deepEqual(mine(again.datasets[name]), mine(first.datasets[name]), name);
});

test('the export does not depend on the order the database returns rows in', async () => {
  // PostgreSQL returns rows without ORDER BY in whatever order its plan and storage give (it changes after
  // updates, vacuum, concurrent writes). Every findMany is answered here in REVERSED order: identical data
  // must still give identical rows in identical order (and so identical CSV files and hashes).
  const reversedFindMany = (model) => new Proxy(model, {
    get: (m, k) => (k === 'findMany' ? async (...a) => (await m.findMany(...a)).reverse() : typeof m[k] === 'function' ? m[k].bind(m) : m[k]),
  });
  const db = new Proxy(prisma, {
    get: (t, k) => {
      const v = t[k];
      if (v && typeof v === 'object' && typeof v.findMany === 'function') return reversedFindMany(v);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const normal = await buildExport({ policy, now: NOW });
  const reversed = await buildExport({ db, policy, now: NOW });
  for (const name of Object.keys(COLUMNS)) assert.deepEqual(reversed.datasets[name], normal.datasets[name], name);
  for (const name of Object.keys(normal.datasetsStep5)) assert.deepEqual(reversed.datasetsStep5[name], normal.datasetsStep5[name], name);
});
