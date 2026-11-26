#!/usr/bin/env node
/**
 * Demo traffic simulator for the AI pages (development and demos only). It plays realistic activity through the
 * app's own ML code paths, so the AI monitor, model cards, drift check, fraud reviews, account graph and the crowd
 * 3D view all have something to show:
 *
 *   - ordinary customers browse an event (visits), some start checkout, most buy;
 *   - a bot ring: accounts that share two phone numbers and one browser, many orders, half at machine speed
 *     (the rules catch those) and half at human speed (only account links and history give them away);
 *   - a family sharing a phone (a legitimate link);
 *   - every checkout is scored by the rules and, in shadow, by the fraud model (real feature builder, real ML
 *     service); the review sample is drawn; a demo reviewer records blind reviews (bot ring = fraud);
 *   - finished visits are scored (purchase intent, abandonment);
 *   - with --setup-gates / --with-tickets: five past demo events with gate scans (the rule's arrival curve; skip
 *     with --no-history), three demo gates and sold tickets, then the crowd-flow rule and model are logged as of
 *     2 hours before the start, so the chart and the 3D gate view light up.
 *
 * It never decides anything and changes no real record. Everything it writes is marked as demo:
 *   - accounts use the @demo.test domain: a TEST domain (dataPolicy.js), so nothing reaches a training export;
 *   - orders are MOCK payments (no server-verified payment evidence: also excluded from exports);
 *   - prediction rows carry output.demo = "simulator"; gates are named "Demo gate …".
 * --reset removes all of it (seats go back to AVAILABLE).
 *
 *   node scripts/ml-demo-simulate.mjs [--event <id>] [--customers 100] [--ring 6] [--setup-gates] [--with-tickets 2000] [--no-history] [--yes]
 *   node scripts/ml-demo-simulate.mjs --reset [--yes]
 *
 * Needs the ML service (ML_SERVICE_URL / ML_SERVICE_TOKEN) with the registered models. Refuses to run when
 * NODE_ENV or ML_ENV is "production"; on a database whose name does not end in "_verify" it needs --yes.
 */
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const has = (name) => process.argv.includes(`--${name}`);

if (process.env.NODE_ENV === 'production' || process.env.ML_ENV === 'production') {
  console.error('Refusing: the demo simulator never runs in production.');
  process.exit(2);
}
const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify') && !has('yes')) {
  console.error(`This writes demo data into "${dbName}". Re-run with --yes to confirm (remove it later with --reset).`);
  process.exit(2);
}

const prisma = (await import('../src/config/prisma.js')).default;
const { logPredictions } = await import('../src/services/ml/shadow.js');
const { fraudFeatures, startOf } = await import('../src/services/ml/features.js');
const { evaluateCheckoutBotRules } = await import('../src/services/security/checkoutBotRules.js');
const { sampleFraudOrders, scoreVisits } = await import('../src/services/ml/jobs.js');
const { arrivalHistory, crowdRows, slotSubject } = await import('../src/services/ml/crowd.js');
const { recordReview } = await import('../src/services/ml/fraudReview.js');

const DOMAIN = 'demo.test';
const HISTORY_PREFIX = 'Demo history event';
const TAG = 'simulator';
const H = 3600_000, MIN = 60_000;
const now = new Date();

// Deterministic randomness, so two runs tell the same story
let seed = 20261126;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const between = (a, b) => a + (b - a) * rnd();

// ---------------------------------------------------------------------------------------------
async function reset() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const rules = await prisma.mlPrediction.findMany({ where: { role: 'RULES', OR: [{ userId: { in: ids } }, { output: { path: ['demo'], equals: TAG } }] }, select: { modelName: true, subjectType: true, subjectId: true } });
  let preds = 0;
  for (let i = 0; i < rules.length; i += 500) {
    const chunk = rules.slice(i, i + 500);
    preds += (await prisma.mlPrediction.deleteMany({ where: { OR: chunk.map((r) => ({ modelName: r.modelName, subjectType: r.subjectType, subjectId: r.subjectId })) } })).count;
  }
  const history = await prisma.event.findMany({ where: { name: { startsWith: HISTORY_PREFIX } }, select: { id: true } });
  const historyIds = history.map((e) => e.id);
  const scans = (await prisma.checkIn.deleteMany({ where: { OR: [{ eventId: { in: historyIds } }, { staffId: { in: ids } }] } })).count;
  const orders = await prisma.order.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  const tickets = await prisma.ticket.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, seatId: true } });
  const out = await prisma.$transaction([
    prisma.fraudReview.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.fraudSample.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.ticket.deleteMany({ where: { id: { in: tickets.map((t) => t.id) } } }),
    prisma.seat.updateMany({ where: { id: { in: tickets.map((t) => t.seatId) } }, data: { status: 'AVAILABLE', lockedByUserId: null } }),
    prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
    prisma.behaviorEvent.deleteMany({ where: { userId: { in: ids } } }),
    prisma.auditLog.deleteMany({ where: { userId: { in: ids } } }),
    prisma.eventGate.deleteMany({ where: { name: { startsWith: 'Demo gate ' } } }),
    prisma.seat.deleteMany({ where: { eventId: { in: historyIds } } }),
    prisma.ticketTier.deleteMany({ where: { eventId: { in: historyIds } } }),
    prisma.event.deleteMany({ where: { id: { in: historyIds } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`Removed demo data: ${ids.length} accounts, ${orderIds.length} orders, ${tickets.length} tickets (seats freed), ${preds} prediction rows, ${out[7].count} demo gates, ${historyIds.length} past demo events with ${scans} gate scans.`);
}

// ---------------------------------------------------------------------------------------------
async function chooseEvent() {
  const id = arg('event', null);
  const where = id ? { id } : { status: 'PUBLISHED', cancelledAt: null, tiers: { some: {} }, seats: { some: { status: 'AVAILABLE' } } };
  const events = await prisma.event.findMany({ where, select: { id: true, name: true, date: true, time: true, startsAt: true, companyId: true, gates: { select: { id: true, name: true } }, tiers: { select: { id: true, price: true } } } });
  const upcoming = events.filter((e) => startOf(e) > new Date(now.getTime() + 3 * 24 * H));
  if (!upcoming.length) throw new Error(id ? 'That event is not at least 3 days away (visits after the start are not scored).' : 'No published event with seats starting in 3+ days. Pass --event <id>.');
  // Most available seats first (the 3D view needs a seat plan)
  const counts = await Promise.all(upcoming.map((e) => prisma.seat.count({ where: { eventId: e.id, status: 'AVAILABLE' } })));
  return upcoming.map((e, i) => ({ ...e, available: counts[i] })).sort((a, b) => b.available - a.available)[0];
}

/**
 * Past demo events with real gate scans, so the crowd rule has an arrival curve to learn (crowd.js arrivalHistory
 * needs >= 5 finished events of the same type with entry scans). Hidden from listings, named "Demo history event …",
 * one MOCK order of demo tickets each; the scans follow a realistic arrival curve (a rush 20 minutes before the
 * start, a tail after it) with a show rate around 85%. They have no prediction snapshots, so no training export
 * ever uses them; --reset deletes them.
 */
async function createHistory(event, buyer, staff, { count = 5, tickets = 300 } = {}) {
  const base = await prisma.event.findUnique({ where: { id: event.id }, select: { type: true, companyId: true, city: true, venue: true } });
  const slots = Array.from({ length: 30 }, (_, i) => -90 + 5 * i);
  let scans = 0;
  for (let k = 0; k < count; k++) {
    const start = new Date(now.getTime() - (9 + 4 * k) * 24 * H);
    start.setUTCHours(14, 0, 0, 0); // 19:00 in Pakistan
    const ev = await prisma.event.create({ data: {
      companyId: base.companyId, name: `${HISTORY_PREFIX} ${k + 1}`, description: 'Demo simulator: a past event whose gate scans teach the crowd-flow rule its arrival curve. Removed by --reset.',
      type: base.type, date: start, time: '19:00', startsAt: start, city: base.city, venue: base.venue, status: 'COMPLETED', isHidden: true,
      createdAt: new Date(start.getTime() - 30 * 24 * H),
    }, select: { id: true } });
    const tier = await prisma.ticketTier.create({ data: { eventId: ev.id, name: 'General', price: 1000, totalQuantity: tickets, availableQuantity: 0 }, select: { id: true } });
    await prisma.seat.createMany({ data: Array.from({ length: tickets }, (_, i) => ({ eventId: ev.id, tierId: tier.id, section: 'Demo', row: String(Math.floor(i / 20) + 1), seatNumber: String((i % 20) + 1), status: 'SOLD' })) });
    const seatRows = await prisma.seat.findMany({ where: { eventId: ev.id }, select: { id: true } });
    const order = await prisma.order.create({ data: { userId: buyer.id, eventId: ev.id, totalAmount: tickets * 1000, status: 'SUCCESSFUL', paymentMethod: 'MOCK', createdAt: new Date(start.getTime() - 7 * 24 * H) } });
    await prisma.ticket.createMany({ data: seatRows.map((st) => ({ orderId: order.id, eventId: ev.id, seatId: st.id, userId: buyer.id, price: 1000 })) });
    const ticketRows = await prisma.ticket.findMany({ where: { eventId: ev.id }, select: { id: true } });
    // Arrival curve: a rush peaking ~20 min before the start (shifted a little per event) and a tail after it
    const peak = -20 + Math.round(between(-6, 6));
    const w = slots.map((m) => Math.exp(-(((m - peak) / 24) ** 2)) + 0.12 * Math.exp(-(((m - 20) / 25) ** 2)));
    const cum = []; w.reduce((a, x, i) => (cum[i] = a + x), 0);
    const totalW = cum.at(-1);
    const show = between(0.8, 0.9);
    const data = [];
    for (const t of ticketRows) {
      if (rnd() > show) continue;
      const r = rnd() * totalW;
      const i = cum.findIndex((c) => c >= r);
      data.push({ ticketId: t.id, eventId: ev.id, staffId: staff.id, result: 'GREEN', reason: 'demo history', direction: 'ENTRY', scannedAt: new Date(start.getTime() + (slots[i] + rnd() * 5) * MIN) });
    }
    await prisma.checkIn.createMany({ data });
    scans += data.length;
  }
  return { events: count, scans };
}

const mkUser = (name, phone, ageDays) => prisma.user.create({
  data: { email: `${name}-${randomUUID().slice(0, 8)}@${DOMAIN}`, passwordHash: 'demo-not-a-login', name, role: 'CUSTOMER', status: 'ACTIVE', phone, createdAt: new Date(now - ageDays * 24 * H) },
  select: { id: true, name: true, createdAt: true },
});
const human = () => ({ checkoutDurationSeconds: between(25, 90), clicksPerMinute: between(12, 45), rapidSeatAttempts: Math.floor(between(0, 2)), timeOnSeatmapSeconds: between(15, 60), deviceSwitches: rnd() < 0.9 ? 0 : 1 });
const machine = () => ({ checkoutDurationSeconds: between(0.5, 3.5), clicksPerMinute: between(150, 400), rapidSeatAttempts: Math.floor(between(5, 15)), timeOnSeatmapSeconds: between(0.4, 2.5), deviceSwitches: Math.floor(between(2, 6)) });

async function simulate() {
  // A second run on top of the first would mix old and new data (gates and crowd estimates are kept once made)
  const existing = await prisma.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } });
  if (existing) {
    console.error(`Demo data from an earlier run is still here (${existing} demo accounts). Remove it first:
  node scripts/ml-demo-simulate.mjs --reset${dbName.endsWith('_verify') ? '' : ' --yes'}
then run this again.`);
    process.exitCode = 2;
    return;
  }
  const event = await chooseEvent();
  const nCustomers = Number(arg('customers', 100));
  const nRing = Number(arg('ring', 6));
  console.log(`Event: ${event.name} (${event.id}), starts ${startOf(event).toISOString()}, ${event.available} seats available.`);
  const seats = await prisma.seat.findMany({ where: { eventId: event.id, status: 'AVAILABLE' }, select: { id: true, tierId: true }, take: 2000 });
  const price = new Map(event.tiers.map((t) => [t.id, Number(t.price)]));

  // 1. Accounts: customers, one family sharing a phone, and the bot ring (2 phones + 1 browser among them)
  const customers = [];
  for (let i = 0; i < nCustomers; i++) customers.push(await mkUser(`Demo customer ${i + 1}`, `0300${String(1000000 + i * 7919).slice(-7)}`, between(20, 700)));
  const family = [await mkUser('Demo family A', '03211234567', 400), await mkUser('Demo family B', '+92 321 1234567', 30)];
  const ringPhones = ['03459990001', '03459990002'];
  const ring = [];
  for (let i = 0; i < nRing; i++) ring.push(await mkUser(`Demo ring ${i + 1}`, ringPhones[i % 2], between(0.2, 3)));
  const ringBrowser = `sess_demo_ring_${randomUUID().slice(0, 8)}`;
  await prisma.behaviorEvent.createMany({ data: ring.map((u, i) => ({ userId: u.id, sessionId: ringBrowser, action: 'event_view', eventId: event.id, createdAt: new Date(now - (60 - i) * H) })) });

  // 2. Visits (last 2 days, ended over 30 minutes ago): views, seat picks, checkout starts
  const visitRows = [];
  const visitOf = new Map();
  for (const u of [...customers, ...family]) {
    const start = new Date(now - between(2, 44) * H);
    const sid = `sess_demo_${randomUUID().slice(0, 12)}`;
    const views = 1 + Math.floor(between(0, 5));
    const picks = rnd() < 0.6 ? 1 + Math.floor(between(0, 3)) : 0;
    const checkout = picks > 0 && rnd() < 0.75;
    let t = start.getTime();
    const add = (action) => { visitRows.push({ userId: u.id, sessionId: sid, action, eventId: event.id, createdAt: new Date(t) }); t += between(40, 240) * 1000; };
    for (let k = 0; k < views; k++) add('event_view');
    for (let k = 0; k < picks; k++) add('seat_selected');
    if (checkout) add('checkout_started');
    visitOf.set(u.id, { checkout, end: new Date(t) });
  }
  await prisma.behaviorEvent.createMany({ data: visitRows });

  // 3. Checkouts: customers who started one (most pay), the family, and the ring (many orders, two speeds)
  const attempts = [];
  // Returning customers: about half bought once before in the last two weeks (gives them order history)
  for (const u of customers) {
    if (rnd() < 0.5) attempts.push({ user: u, at: new Date(now - between(3, 13) * 24 * H), telemetry: human(), status: 'SUCCESSFUL', fraud: false, seats: 1 + Math.floor(between(0, 3)) });
  }
  for (const u of [...customers, ...family]) {
    const v = visitOf.get(u.id);
    if (!v?.checkout) continue;
    attempts.push({ user: u, at: new Date(v.end.getTime() - 30_000), telemetry: human(), status: rnd() < 0.85 ? 'SUCCESSFUL' : 'FAILED', fraud: false, seats: 1 + Math.floor(between(0, 3)) });
  }
  ring.forEach((u, i) => {
    for (let k = 0; k < 3 + Math.floor(between(0, 3)); k++) {
      attempts.push({ user: u, at: new Date(now - between(2, 40) * H), telemetry: i % 2 === 0 ? machine() : human(), status: 'SUCCESSFUL', fraud: true, seats: 4 + Math.floor(between(0, 5)) });
    }
  });
  attempts.sort((a, b) => a.at - b.at);
  const items = [];
  let s = 0;
  for (const a of attempts) {
    const picked = seats.slice(s, s + a.seats); s += a.seats;
    if (picked.length < a.seats) break;
    const total = picked.reduce((x, p) => x + (price.get(p.tierId) || 0), 0);
    const order = await prisma.order.create({ data: { userId: a.user.id, eventId: event.id, totalAmount: total, status: a.status, paymentMethod: 'MOCK', createdAt: a.at } });
    a.order = order;
    const rule = evaluateCheckoutBotRules(a.telemetry);
    let features = null, skipped = null;
    try { features = await fraudFeatures({ userId: a.user.id, eventId: event.id, seatIds: picked.map((p) => p.id), telemetry: a.telemetry, paymentMethod: 'MOCK', at: a.at }); } catch (e) { skipped = `missing input: ${e.message}`; }
    items.push({ subjectType: 'ORDER', subjectId: order.id, eventId: event.id, userId: a.user.id, asOf: a.at, features, skipped,
      rule: { score: rule.fraud_score, decision: rule.risk_level, output: { classification: rule.classification, demo: TAG } } });
  }
  const fraudCounts = await logPredictions('fraud', items);
  console.log(`Checkouts: ${items.length} (${attempts.filter((a) => a.fraud && a.order).length} by the bot ring). Fraud rows:`, fraudCounts);

  // 4. Review sample, then a demo reviewer's blind reviews (ground truth: the ring is fraud)
  const sampled = await sampleFraudOrders({ now });
  const reviewer = await mkUser('Demo reviewer', null, 900);
  await prisma.user.update({ where: { id: reviewer.id }, data: { role: 'SUPER_ADMIN' } });
  const truth = new Map(attempts.filter((a) => a.order).map((a) => [a.order.id, a.fraud]));
  const selected = await prisma.fraudSample.findMany({ where: { orderId: { in: [...truth.keys()] }, selected: true }, select: { id: true, orderId: true } });
  let reviewed = 0;
  for (const smp of selected) {
    const decision = truth.get(smp.orderId) ? 'CONFIRMED_FRAUD' : rnd() < 0.08 ? 'UNRESOLVED' : 'LEGITIMATE';
    await recordReview({ sampleId: smp.id, decision, reviewerId: reviewer.id, note: 'demo simulator' });
    reviewed += 1;
  }
  console.log(`Review sample: ${sampled.sampled} placed, ${selected.length} demo orders selected, ${reviewed} blind reviews recorded.`);

  // 5. Finished visits -> purchase intent + abandonment (rules + shadow)
  const visits = await scoreVisits({ now, lookbackHours: 48 });
  console.log('Visits:', { found: visits.visits, intent: visits.intent, abandonment: visits.abandonment, skipped: visits.skipped });

  // 6. Crowd flow (optional): demo gates, sold tickets, then the rule and the model as of 2 h before the start
  if (has('setup-gates') || arg('with-tickets', null)) {
    // Past events with gate scans (unless --no-history), so the rule learns when people arrive
    if (!has('no-history') && !(await prisma.event.count({ where: { name: { startsWith: HISTORY_PREFIX } } }))) {
      const h = await createHistory(event, customers[0], reviewer);
      console.log(`Added ${h.events} past demo events with ${h.scans} gate scans (the rule's arrival curve).`);
    }
    let gates = await prisma.eventGate.findMany({ where: { eventId: event.id, active: true } });
    const n = Number(arg('with-tickets', 0)) || 0;
    if (n > 0) {
      const free = seats.slice(s, s + n);
      const buyer = customers[0];
      const order = await prisma.order.create({ data: { userId: buyer.id, eventId: event.id, totalAmount: free.reduce((x, p) => x + (price.get(p.tierId) || 0), 0), status: 'SUCCESSFUL', paymentMethod: 'MOCK', createdAt: new Date(now - 24 * H) } });
      await prisma.ticket.createMany({ data: free.map((p) => ({ orderId: order.id, eventId: event.id, seatId: p.id, userId: buyer.id, price: price.get(p.tierId) || 0 })) });
      await prisma.seat.updateMany({ where: { id: { in: free.map((p) => p.id) } }, data: { status: 'SOLD' } });
      console.log(`Sold ${free.length} demo tickets (one MOCK order).`);
    }
    if (has('setup-gates') && !gates.length) {
      // Sized from the tickets sold. Without past scans the rule spreads 85% of ticket holders evenly over the 2.5 h
      // window (0.34 x tickets per hour); 15% above that the rule reads "busy" and the model's peak goes over
      // capacity before the start, then eases off. The rule shares people by capacity, so all gates load alike.
      const sold = await prisma.ticket.count({ where: { eventId: event.id } });
      // With a learned arrival curve: the busiest 5 minutes at ~115% of capacity (comfortable earlier and after)
      const learned = (await arrivalHistory(new Date(startOf(event).getTime() - 2 * H)))((await prisma.event.findUnique({ where: { id: event.id }, select: { type: true } })).type);
      const peakPerHour = sold * learned.show * Math.max(...learned.curve) * 12;
      const total = Math.max(60, Math.round(learned.basis === 'default' ? sold * 0.39 : peakPerHour / 1.15));
      const shares = [0.45, 0.35, 0.2];
      for (const [i, sh] of shares.entries()) await prisma.eventGate.create({ data: { eventId: event.id, name: `Demo gate ${'ABC'[i]}`, capacityPerHour: Math.max(20, Math.round(total * sh)), sortOrder: i } });
      gates = await prisma.eventGate.findMany({ where: { eventId: event.id, active: true } });
      console.log(`Added ${gates.length} demo gates (${gates.map((g) => g.capacityPerHour).join(' / ')} people per hour for ${sold} tickets).`);
    } else if (has('setup-gates')) console.log('The event already has gates: left as they are.');
    if (gates.some((g) => g.capacityPerHour)) {
      const at = new Date(startOf(event).getTime() - 2 * H);
      try {
        const rows = await crowdRows({ eventId: event.id, at });
        const crowdItems = rows.map((r) => ({
          subjectType: 'GATE_SLOT', subjectId: slotSubject(r.gateId, r.minutes), eventId: event.id, asOf: at,
          rule: { score: r.baseline, decision: null, output: { basis: r.basis, demo: TAG } }, features: r.features,
          context: { event_start: r.start.toISOString(), captured_at: now.toISOString(), demo: TAG }, referenceAt: null,
        }));
        console.log('Crowd rows (as of 2 h before the start):', await logPredictions('crowd', crowdItems));
      } catch (e) { console.log(`Crowd flow skipped: ${e.message}`); }
    } else console.log('Crowd flow skipped: no gate with a capacity per hour (use --setup-gates on an event without gates).');
  }
  const ringEmail = (await prisma.user.findUnique({ where: { id: ring[0].id }, select: { email: true } })).email;
  console.log(`\nDone. Open /admin/ai-monitor, /admin/ai-models?model=fraud, /admin/ai-readiness and /organizer/gates?event=${event.id} (Live tab).`);
  console.log(`Account graph: /admin/investigations -> open a case for ${ringEmail} -> "Show linked accounts".`);
  console.log('Remove everything with: node scripts/ml-demo-simulate.mjs --reset' + (dbName.endsWith('_verify') ? '' : ' --yes'));
}

try {
  if (has('reset')) await reset(); else await simulate();
} catch (e) {
  console.error(`Simulator failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
