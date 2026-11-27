/**
 * Step 5 data infrastructure, against a database COPY (name must end in "_verify"):
 * Stripe webhook verification (signatures, test/live separation, idempotency, amounts, refunds, disputes),
 * checkout end reasons, guest-activity linking rules, recommendation experiment logging, search / wishlist
 * tracking, data-source classes, the Step 5 export datasets (checkout abandonment, hourly demand,
 * recommendations, customer behaviour) and model rollback.
 *
 *   DATABASE_URL=postgresql://.../ticketledger_export_verify node --test test_step5.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
process.env.ML_SHADOW_ENABLED = 'false';
const prisma = (await import('./src/config/prisma.js')).default;
const { handleStripeWebhook, stripeConfig } = await import('./src/services/stripeWebhookService.js');
const { recordCheckoutEnd } = await import('./src/services/checkoutOutcome.js');
const { checkoutAbandonmentLabel } = await import('./src/services/ml/labels.js');
const { attachSessionToUser } = await import('./src/services/behaviorService.js');
const { recommend, recordClick, assignVariant } = await import('./src/services/recommendationService.js');
const { expireStaleHolds } = await import('./src/services/venueService.js');
const { buildExport, exportPolicy, pseudo, checkRowsStep5, accountClass, sourceClassOfReason } = await import('./src/services/ml/export.js');
const { recordPaymentEvidence, EVIDENCE_ACTION } = await import('./src/services/paymentEvidence.js');
const { logPredictions } = await import('./src/services/ml/shadow.js');
const { registerModels } = await import('./scripts/ml-register-models.mjs');
test.after(() => prisma.$disconnect());

const H = 3600_000;
const D = 24 * H;
const tag = randomUUID().slice(0, 8);
const dom = `s5${tag}.pk`;
const SECRET = 'whsec_step5_test_secret';
const signer = new Stripe('sk_test_signing_only');
const sign = (obj) => { const payload = JSON.stringify(obj); return { rawBody: Buffer.from(payload), signature: signer.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }; };
const envTest = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET };
const ids = {};
let seatNo = 0;

async function user(key, { role = 'CUSTOMER', domain = dom, createdAt = new Date(Date.now() - 400 * D) } = {}) {
  const u = await prisma.user.create({ data: { email: `${key}-${tag}@${domain}`, passwordHash: 'x', name: key, role, status: 'ACTIVE', createdAt } });
  ids[key] = u.id;
  return u;
}
let co;
async function event(key, { open, start, price = 1000, createdAt }) {
  if (!co) {
    const org = await user('org', { role: 'ORGANIZER' });
    co = await prisma.company.create({ data: { userId: org.id, companyName: `S5 ${tag}`, ownerName: 'Org', phone: '0300', email: org.email, city: 'Lahore', ntnCnic: '1', documentUrl: 'x', status: 'APPROVED' } });
    const old = new Date(Date.now() - 500 * D).toISOString();
    await prisma.$executeRaw`UPDATE "User" SET "updatedAt" = ${old}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${org.id}`;
    await prisma.$executeRaw`UPDATE "Company" SET "updatedAt" = ${old}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${co.id}`;
  }
  const e = await prisma.event.create({
    data: {
      companyId: co.id, name: `${key}-${tag}`, description: 'fixture', type: 'MUSIC_CONCERT', status: 'PUBLISHED', city: 'Karachi', venue: 'Hall',
      date: start, time: '20:00', startsAt: start, endsAt: new Date(start.getTime() + 3 * H), salesOpenAt: open, createdAt: createdAt || new Date(open.getTime() - D),
      tiers: { create: [{ name: 'General', price, totalQuantity: 50, availableQuantity: 50 }] },
    },
    include: { tiers: true },
  });
  await prisma.mlInputChange.deleteMany({ where: { eventId: e.id } });
  ids[key] = e.id;
  return { ...e, ga: e.tiers[0] };
}
async function order(key, { userId, ev, at, status = 'SUCCESSFUL', method = 'STRIPE', livemode = true, n = 1, lockedUntil = null }) {
  const tx = `pi_s5_${randomUUID().replace(/-/g, '')}`;
  const o = await prisma.order.create({ data: { userId, eventId: ev.id, totalAmount: Number(ev.ga.price) * n, status, paymentMethod: method, paymentTxId: status === 'SUCCESSFUL' ? tx : null, paymentRef: tx, createdAt: at } });
  for (let i = 0; i < n; i++) {
    const seat = await prisma.seat.create({ data: { eventId: ev.id, tierId: ev.ga.id, section: 'S', row: '1', seatNumber: `${tag}-${++seatNo}`, status: lockedUntil ? 'LOCKED' : 'SOLD', lockedUntil, lockedByUserId: lockedUntil ? userId : null } });
    await prisma.ticket.create({ data: { orderId: o.id, eventId: ev.id, seatId: seat.id, userId, price: ev.ga.price, createdAt: at } });
  }
  if (status === 'SUCCESSFUL' && livemode !== null) {
    await recordPaymentEvidence({ orderIds: [o.id], userId, paymentMethod: method, verification: { success: true, real: true, transactionId: tx, livemode } });
    await prisma.auditLog.updateMany({ where: { action: EVIDENCE_ACTION, targetId: o.id }, data: { createdAt: at } });
  }
  ids[key] = o.id;
  return { ...o, tx };
}

// ---------------------------------------------------------------------------------------------
test('Stripe configuration: test and live are separate; inconsistent configuration is reported', () => {
  assert.deepEqual(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' }).problems, []);
  assert.match(stripeConfig({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' }).problems.join(), /live but the secret key is a test key/);
  assert.match(stripeConfig({ STRIPE_SECRET_KEY: 'sk_live_1' }).problems.join(), /test but the secret key is a live key/);
  assert.match(stripeConfig({}).problems.join(), /STRIPE_WEBHOOK_SECRET is not set/);
});

test('Stripe webhook: signatures, mode separation, idempotency, amount matching, failures, refunds, disputes', async () => {
  const buyer = await user('whbuyer');
  const ev = await event('WH', { open: new Date(Date.now() - 5 * D), start: new Date(Date.now() + 30 * D) });
  const o = await order('whorder', { userId: buyer.id, ev, at: new Date(), livemode: null });
  const pi = (type, extra = {}, livemode = false) => ({ id: `evt_${randomUUID().slice(0, 12)}`, object: 'event', type, livemode, data: { object: { id: o.tx, object: 'payment_intent', amount: 100000, status: 'succeeded', created: 1, metadata: { orderId: o.id }, ...extra } } });
  // not configured, bad signature, wrong mode
  assert.equal((await handleStripeWebhook({ ...sign(pi('payment_intent.succeeded')), env: {} })).status, 503);
  assert.equal((await handleStripeWebhook({ rawBody: Buffer.from('{}'), signature: 't=1,v1=bad', env: envTest })).status, 400);
  const live = await handleStripeWebhook({ ...sign(pi('payment_intent.succeeded', {}, true)), env: envTest });
  assert.equal(live.status, 400, 'a live event is refused by a test-mode configuration');
  // amount mismatch: nothing recorded
  const bad = await handleStripeWebhook({ ...sign(pi('payment_intent.succeeded', { amount: 5 })), env: envTest });
  assert.equal(bad.body.recorded, null);
  // succeeded (test mode): evidence recorded with livemode false -> never a genuine purchase
  const ok = pi('payment_intent.succeeded');
  assert.equal((await handleStripeWebhook({ ...sign(ok), env: envTest })).body.recorded, 'PAYMENT_SERVER_VERIFIED');
  const ev1 = await prisma.auditLog.findFirst({ where: { action: EVIDENCE_ACTION, targetId: o.id } });
  assert.equal(ev1.details.livemode, false);
  assert.equal(ev1.details.verifiedVia, 'stripe.webhook');
  // re-delivery changes nothing
  assert.equal((await handleStripeWebhook({ ...sign(ok), env: envTest })).body.duplicate, true);
  assert.equal(await prisma.auditLog.count({ where: { action: 'STRIPE_EVENT', targetId: ok.id } }), 1);
  // failure, refund, dispute
  assert.equal((await handleStripeWebhook({ ...sign(pi('payment_intent.payment_failed', { last_payment_error: { code: 'card_declined' } })), env: envTest })).body.recorded, 'PAYMENT_FAILED_VERIFIED');
  const charge = (type, extra) => ({ id: `evt_${randomUUID().slice(0, 12)}`, object: 'event', type, livemode: false, data: { object: { id: `ch_${tag}`, object: 'charge', payment_intent: o.tx, ...extra } } });
  assert.equal((await handleStripeWebhook({ ...sign(charge('charge.refunded', { amount_refunded: 100000, refunded: true })), env: envTest })).body.recorded, 'PAYMENT_REFUND_VERIFIED');
  assert.equal((await handleStripeWebhook({ ...sign(charge('charge.dispute.created', { object: 'dispute', status: 'needs_response', reason: 'fraudulent' })), env: envTest })).body.recorded, 'PAYMENT_DISPUTE');
  // the webhook never changes the order
  assert.equal((await prisma.order.findUnique({ where: { id: o.id } })).status, 'SUCCESSFUL');
});

test('checkout end reasons: a hold that expires is recorded as HOLD_EXPIRED with a checkout_expired event', async () => {
  const c = await user('holder');
  const ev = await event('HOLD', { open: new Date(Date.now() - 5 * D), start: new Date(Date.now() + 20 * D) });
  const o = await order('pending', { userId: c.id, ev, at: new Date(Date.now() - H), status: 'PENDING', lockedUntil: new Date(Date.now() - 30 * 60_000) });
  await expireStaleHolds(ev.id);
  assert.equal((await prisma.order.findUnique({ where: { id: o.id } })).status, 'FAILED');
  const end = await prisma.auditLog.findFirst({ where: { action: 'CHECKOUT_ENDED', targetId: o.id } });
  assert.equal(end.details.reason, 'HOLD_EXPIRED');
  assert.equal(await prisma.behaviorEvent.count({ where: { action: 'checkout_expired', metadata: { path: ['orderId'], equals: o.id } } }), 1);
  await assert.rejects(() => recordCheckoutEnd(prisma, [o], 'NOT_A_REASON'), /unknown checkout end reason/);
});

test('abandonment label: only an expired hold with no payment attempt and nothing bought; cancelled / failed are not abandonment', () => {
  const now = new Date();
  const order = (h, paid = false, status = 'FAILED') => ({ status, paid, createdAt: new Date(now - h * H) });
  const L = (a) => checkoutAbandonmentLabel({ paymentFailed: false, boughtInWindow: false, now, ...a });
  assert.equal(L({ order: order(30), endReason: 'HOLD_EXPIRED' }).label, 1);
  assert.equal(L({ order: order(30), endReason: 'HOLD_EXPIRED', boughtInWindow: true }).label, 0);
  assert.equal(L({ order: order(30, true, 'SUCCESSFUL'), endReason: null }).label, 0);
  assert.equal(L({ order: order(30), endReason: 'CUSTOMER_CANCELLED' }).label, null);
  assert.equal(L({ order: order(30), endReason: 'SUPERSEDED' }).label, null);
  assert.equal(L({ order: order(30), endReason: 'EVENT_CANCELLED' }).label, null);
  assert.equal(L({ order: order(30), endReason: 'HOLD_EXPIRED', paymentFailed: true }).label, null);
  assert.equal(L({ order: order(30), endReason: null }).label, null, 'no recorded reason (legacy) is not guessed');
  assert.equal(L({ order: order(3), endReason: 'HOLD_EXPIRED' }).label, null, 'window not over');
});

test('guest linking: recent anonymous activity only, never a shared session, always audited', async () => {
  const a = await user('ga');
  const b = await user('gb');
  const s1 = `guest-${tag}-1`;
  await prisma.behaviorEvent.createMany({ data: [
    { sessionId: s1, action: 'event_view', createdAt: new Date(Date.now() - 2 * D) },
    { sessionId: s1, action: 'event_view', createdAt: new Date(Date.now() - 45 * D) },
  ] });
  const r = await attachSessionToUser({ sessionId: s1, userId: a.id });
  assert.equal(r.count, 1, 'only the last 30 days');
  assert.equal(await prisma.behaviorEvent.count({ where: { sessionId: s1, userId: null } }), 1);
  assert.equal((await prisma.auditLog.findFirst({ where: { action: 'GUEST_ACTIVITY_LINKED', targetId: a.id } })).details.count, 1);
  const s2 = `guest-${tag}-2`;
  await prisma.behaviorEvent.createMany({ data: [{ sessionId: s2, userId: b.id, action: 'login' }, { sessionId: s2, action: 'event_view' }] });
  assert.equal((await attachSessionToUser({ sessionId: s2, userId: a.id })).count, 0, 'shared device: not linked');
});

test('recommendations: deterministic variant, a non-personalised control, first-time fallback, logged impressions, checked clicks', async () => {
  const keys = Array.from({ length: 400 }, (_, i) => `u:${i}`);
  assert.deepEqual(keys.map((k) => assignVariant(k, 0.5)), keys.map((k) => assignVariant(k, 0.5)));
  const ctl = keys.filter((k) => assignVariant(k, 0.5) === 'CONTROL').length;
  assert.ok(ctl > 150 && ctl < 250, `about half in control (${ctl})`);
  const first = await user('recnew');
  const r = await recommend({ userId: first.id });
  assert.ok(r.experimental);
  assert.equal(r.basis, 'population', 'a visitor with no history never gets invented preferences');
  const imp = await prisma.behaviorEvent.findFirst({ where: { action: 'recommendation_impression', userId: first.id } });
  assert.equal(imp.metadata.listId, r.listId);
  assert.equal(imp.metadata.items.length, r.events.length);
  if (r.events.length) {
    assert.deepEqual(await recordClick({ listId: r.listId, eventId: r.events[0].eventId, userId: first.id }), { recorded: true });
    await assert.rejects(() => recordClick({ listId: r.listId, eventId: r.events[0].eventId, userId: ids.ga }), /not found/, 'another visitor');
  }
  await assert.rejects(() => recordClick({ listId: r.listId, eventId: 'not-in-list', userId: first.id }), /not found/);
  // A control-group visitor is never personalised
  const cu = keys.find((k) => assignVariant(k) === 'CONTROL');
  const ctlUser = await prisma.user.create({ data: { id: randomUUID(), email: `ctl-${tag}@${dom}`, passwordHash: 'x', name: 'ctl', role: 'CUSTOMER' } });
  const v = assignVariant(`u:${ctlUser.id}`);
  const rc = await recommend({ userId: ctlUser.id });
  if (v === 'CONTROL') assert.equal(rc.basis, 'population');
  assert.ok(cu);
});

test('recommendation groups stay the same when a guest logs in (no switching between control and personalised)', async () => {
  const { variantFor } = await import('./src/services/recommendationService.js');
  const u = await user('recstable');
  const mine = assignVariant(`u:${u.id}`);
  // A guest session whose own hash puts it in the OTHER group than the account's hash
  let s = null;
  for (let i = 0; i < 200 && !s; i++) if (assignVariant(`s:guest-${tag}-${i}`) !== mine) s = `guest-${tag}-${i}`;
  assert.ok(s, 'found a session in the other group');
  const guest = await recommend({ sessionId: s });
  assert.notEqual(guest.variant, mine);
  // Logged in on the same device, before or without linking (e.g. a shared device): the guest's group
  assert.equal((await recommend({ userId: u.id, sessionId: s })).variant, guest.variant, 'right after login');
  // After the guest lists are linked to the account: still the same group, on any later visit
  await attachSessionToUser({ sessionId: s, userId: u.id });
  assert.equal((await recommend({ userId: u.id })).variant, guest.variant, 'later, without the session');
  assert.equal((await recommend({ userId: u.id, sessionId: `other-device-${tag}` })).variant, guest.variant, 'on another device');
  assert.equal((await variantFor({ userId: u.id })).assignedBy, 'first-list');
  const lists = await prisma.behaviorEvent.findMany({ where: { action: 'recommendation_impression', OR: [{ userId: u.id }, { sessionId: s }] } });
  assert.ok(lists.length >= 4 && lists.every((l) => l.metadata.variant === guest.variant), 'every list in one group');
  // A brand-new visitor is assigned by hash
  assert.equal((await variantFor({ sessionId: `fresh-${tag}` })).assignedBy, 'hash');
});

test('search and wishlist activity is recorded', async () => {
  const { addToWishlist, removeFromWishlist } = await import('./src/controllers/wishlistController.js');
  const w = await user('wish');
  const ev = await event('WISH', { open: new Date(Date.now() - D), start: new Date(Date.now() + 20 * D) });
  const res = { status() { return this; }, json() { return this; } };
  const req = { user: { id: w.id }, params: { eventId: ev.id }, headers: {} };
  await addToWishlist(req, res);
  await removeFromWishlist(req, res);
  // Tracking is fire-and-forget (it never delays the request), so the two writes land in either order and
  // at an unknown moment: wait until both are there (up to 10 s) instead of a fixed sleep, compare as a set.
  let actions = [];
  for (let i = 0; i < 100 && actions.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 100));
    actions = (await prisma.behaviorEvent.findMany({ where: { userId: w.id } })).map((x) => x.action).sort();
  }
  assert.deepEqual(actions, ['wishlist_added', 'wishlist_removed']);
});

// ---------------------------------------------------------------------------------------------
// The Step 5 export datasets (simulated timeline; snapshots logged by the real logger)
// ---------------------------------------------------------------------------------------------
test('Step 5 export: genuine-customer rows only, verified labels, first-time and returning customers', async () => {
  // Later than test_ml_export.mjs's timeline, so this fixture never moves its "first live payment"
  const NOW = new Date('2026-11-15T00:00:00Z');
  const ago = (ms) => new Date(NOW.getTime() - ms);
  const policy = exportPolicy({}, {});
  // Genuine use begins with the first live-verified payment (ago 60 d)
  const r1 = await user('r1', { createdAt: ago(300 * D) });           // returning: buys at ago 60 d
  const n1 = await user('n1', { createdAt: ago(20 * D) });            // signs up after launch, first-time
  const dev = await user('dev1', { createdAt: ago(300 * D) });        // pre-launch account, never buys: internal test
  const ev = await event('EX', { open: ago(70 * D), start: ago(2 * D), price: 2000, createdAt: ago(71 * D) });
  await order('first', { userId: r1.id, ev, at: ago(60 * D) });
  const later = await event('EX2', { open: ago(30 * D), start: new Date(NOW.getTime() + 10 * D), createdAt: ago(31 * D) });
  // Checkouts with snapshots: r1 expired (abandoned), n1 paid (0), n1 cancelled (excluded), dev account (excluded)
  const feats = (first) => ({ event_type: 'MUSIC_CONCERT', city: 'Karachi', country: 'PK', payment_method: 'STRIPE', tickets_requested: 1, unit_price_rel: 1,
    hours_since_sales_open: 100, days_until_event: 20, account_age_days: 10, customer_prior_orders: first ? 0 : 1, customer_prior_purchases: first ? 0 : 1,
    customer_prior_expired_checkouts: 0, first_time: first ? 1 : 0, visit_event_views: 2, visit_seat_selections: 1 });
  const checkout = async (key, u, at, { status, reason, first }) => {
    const o = await order(key, { userId: u.id, ev: later, at, status, livemode: status === 'SUCCESSFUL' ? true : null });
    if (reason) await prisma.auditLog.create({ data: { userId: u.id, action: 'CHECKOUT_ENDED', targetType: 'Order', targetId: o.id, details: { reason }, createdAt: new Date(at.getTime() + 15 * 60_000) } });
    await logPredictions('checkout_abandonment', [{ subjectType: 'ORDER', subjectId: o.id, eventId: later.id, userId: u.id, asOf: at, referenceAt: null, rule: { score: null }, features: feats(first), context: { unit_price: 1000 } }]);
    return o;
  };
  await checkout('ck1', r1, ago(10 * D), { status: 'FAILED', reason: 'HOLD_EXPIRED', first: false });
  await checkout('ck2', n1, ago(9 * D), { status: 'SUCCESSFUL', first: true });
  await checkout('ck3', n1, ago(8 * D), { status: 'FAILED', reason: 'CUSTOMER_CANCELLED', first: false });
  await checkout('ck4', dev, ago(7 * D), { status: 'FAILED', reason: 'HOLD_EXPIRED', first: true });
  // Recommendations: r1 sees a list and buys the recommended event; an anonymous visitor is never genuine
  await prisma.behaviorEvent.create({ data: { userId: r1.id, sessionId: `s-${tag}`, action: 'recommendation_impression', createdAt: ago(12 * D),
    metadata: { listId: randomUUID(), variant: 'PERSONALISED', basis: 'personal', surface: 'home', items: [{ eventId: later.id, position: 1, popularityRank: 1, exploration: false, isNew: false }] } } });
  await order('recbuy', { userId: r1.id, ev: later, at: ago(11 * D) });
  // r1 on another device, before that device's guest lists were linked: the other group, so left out
  await prisma.behaviorEvent.create({ data: { userId: r1.id, sessionId: `s2-${tag}`, action: 'recommendation_impression', createdAt: ago(11.9 * D),
    metadata: { listId: randomUUID(), variant: 'CONTROL', basis: 'population', surface: 'home', items: [{ eventId: later.id, position: 1, popularityRank: 1, exploration: false, isNew: false }] } } });
  await prisma.behaviorEvent.create({ data: { sessionId: `anon-${tag}`, action: 'recommendation_impression', createdAt: ago(12 * D),
    metadata: { listId: randomUUID(), variant: 'CONTROL', basis: 'population', surface: 'home', items: [{ eventId: later.id, position: 1, popularityRank: 1 }] } } });
  // Hourly demand snapshot for `later` at ago 20 d (sales in the next 24 h: one verified ticket)
  await logPredictions('demand_hourly', [{ subjectType: 'EVENT_HOURLY', subjectId: `${later.id}|h`, eventId: later.id, asOf: ago(20 * D), referenceAt: null, rule: { score: 0 },
    features: { event_type: 'MUSIC_CONCERT', city: 'Karachi', country: 'PK', day_of_week: 'Friday', venue_capacity: 50, tier_count: 1, min_price_rel: 1, avg_price_rel: 1, max_price_rel: 1,
      start_hour: 20, start_month: 10, organizer_past_events: 1, organizer_past_sell_through_48h: 0.02, hours_since_sales_open: 240, days_until_event: 30, sold_so_far: 0, sold_last_24h: 0, sell_through_so_far: 0 },
    context: { organizer_id: co.id, event_start: later.startsAt.toISOString(), captured_at: ago(20 * D).toISOString() } }]);
  await order('hour', { userId: n1.id, ev: later, at: new Date(ago(20 * D).getTime() + 2 * H) });
  await prisma.$executeRaw`UPDATE "MlPrediction" SET "createdAt" = "asOf" + interval '1 minute' WHERE "createdAt" > ${NOW.toISOString()}::timestamptz AT TIME ZONE 'UTC' AND "asOf" < ${NOW.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;

  const { datasetsStep5: d, report } = await buildExport({ policy, now: NOW });
  const mine = (rows, k = 'event_id') => rows.filter((r) => [ids.EX, ids.EX2].map((x) => pseudo('E', x)).includes(r[k]));
  for (const [name, rows] of Object.entries(d)) assert.deepEqual(checkRowsStep5(name, rows), [], name);
  const ck = mine(d.checkout_abandonment);
  const byOrder = Object.fromEntries(ck.map((r) => [r.order_id, r]));
  assert.equal(byOrder[pseudo('O', ids.ck1)].abandoned, 1);
  assert.equal(byOrder[pseudo('O', ids.ck2)].abandoned, 0);
  assert.equal(byOrder[pseudo('O', ids.ck2)].first_time, 1, 'first-time customer kept, with no invented history');
  assert.ok(!byOrder[pseudo('O', ids.ck3)], 'a cancelled checkout is never labelled');
  assert.ok(!byOrder[pseudo('O', ids.ck4)], 'a pre-launch account is internal test data');
  assert.equal(accountClass({ userById: new Map([[dev.id, { ...dev, role: 'CUSTOMER' }]]), policy, evidenceUsers: new Set(), firstLive: ago(60 * D) }, dev.id), 'account from before genuine use began (no live-verified purchase): internal test');
  assert.equal(sourceClassOfReason('account from before genuine use began (no live-verified purchase): internal test'), 'INTERNAL_TEST');
  const rec = mine(d.recommendation_impressions);
  assert.equal(rec.length, 1, 'the anonymous impression and the other-group list are left out');
  assert.equal(rec[0].variant, 'PERSONALISED', "r1's first group");
  assert.ok(report.datasetsStep5.recommendation_impressions.excluded['experiment group changed (lists from another device before login)'] >= 1);
  assert.equal(rec[0].purchased_7d, 1);
  assert.equal(rec[0].first_time, 0);
  assert.ok(report.datasetsStep5.recommendation_impressions.excluded['anonymous visitor never linked to an account (cannot be shown to be genuine)'] >= 1);
  const hr = mine(d.demand_hourly);
  assert.equal(hr.length, 1);
  assert.equal(hr[0].sales_next_24h, 1);
  const beh = d.customer_behaviour.filter((r) => [ids.r1, ids.n1, ids.dev1].map((x) => pseudo('C', x)).includes(r.customer_id));
  assert.deepEqual(beh.map((r) => r.customer_id).sort(), [pseudo('C', ids.r1), pseudo('C', ids.n1)].sort(), 'the pre-launch account is not a customer');
  assert.equal(beh.find((r) => r.customer_id === pseudo('C', ids.r1)).repeat_customer, 1);
  assert.ok(report.excludedBySourceClass.INTERNAL_TEST >= 1);
  assert.equal(report.sourceClass, 'GENUINE_CUSTOMER');
});

test('ML_GENUINE_FROM: an explicit start of genuine use; live payments and accounts before it are internal test', async () => {
  const { genuineFromOf } = await import('./src/services/ml/dataPolicy.js');
  assert.throws(() => genuineFromOf('next tuesday'), /ML_GENUINE_FROM/);
  assert.throws(() => genuineFromOf('2026-13-45'), /ML_GENUINE_FROM/);
  assert.equal(genuineFromOf(''), null);
  assert.equal(genuineFromOf(undefined), null);
  assert.equal(exportPolicy({}, { ML_GENUINE_FROM: '2026-11-01T00:00:00Z' }).genuineFrom.toISOString(), '2026-11-01T00:00:00.000Z');
  const NOW = new Date('2026-11-15T00:00:00Z');
  const base = await buildExport({ policy: exportPolicy({}, {}), now: NOW });
  assert.equal(base.report.genuineUse.source, 'first live-verified payment');
  // Staff tested live payments until 1 Nov; genuine use is declared to start then
  const start = new Date('2026-11-01T00:00:00Z');
  const later = await buildExport({ policy: exportPolicy({ genuineFrom: start.toISOString() }, {}), now: NOW });
  assert.deepEqual(later.report.genuineUse, { start: start.toISOString(), source: 'ML_GENUINE_FROM' });
  assert.ok(later.report.payments.liveVerifiedOrders < base.report.payments.liveVerifiedOrders, 'live payments before the start are no longer evidence');
  const all = { ...later.datasets, ...later.datasetsStep5 };
  for (const name of ['behavior_sequences', 'checkout_abandonment', 'demand_hourly', 'fraud_purchases']) {
    assert.ok(all[name].every((r) => r.ts >= start.toISOString()), `${name}: nothing from before genuine use began`);
  }
  for (const [name, rows] of Object.entries(all)) {
    const before = (base.datasets[name] || base.datasetsStep5[name]).length;
    assert.ok(rows.length <= before, `${name}: a later start can only remove rows`);
  }
  // An account created before the start, with no live purchase after it, is internal test
  const ctx = { userById: new Map([['u1', { id: 'u1', email: 'a@shop.pk', role: 'CUSTOMER', createdAt: new Date('2026-10-01') }], ['u2', { id: 'u2', email: 'b@shop.pk', role: 'CUSTOMER', createdAt: new Date('2026-11-02') }]]), policy: exportPolicy({}, {}), evidenceUsers: new Set(), firstLive: start };
  assert.match(accountClass(ctx, 'u1'), /before genuine use began/);
  assert.equal(accountClass(ctx, 'u2'), null);
});

test('model rollback: a retired shadow model can be restored (still shadow-only)', async () => {
  const name = `rb_${tag}`;
  const m = (sha) => ({ name, version: 'v', sha256: sha.padEnd(64, '0'), file: 'x.joblib', source: 'test', evaluation_status: 'PASSED', evaluation: {}, features: {} });
  await registerModels({ models: [m('a')] });
  await registerModels({ models: [m('b')] });
  const st = async () => Object.fromEntries((await prisma.mlModel.findMany({ where: { name } })).map((x) => [x.sha256[0], x.status]));
  assert.deepEqual(await st(), { a: 'RETIRED', b: 'SHADOW' });
  assert.equal((await registerModels({ models: [m('a')] }))[0].action, 'unchanged', 'no restore without --restore');
  assert.equal((await registerModels({ models: [m('a')] }, { restore: true }))[0].action, 'restored');
  assert.deepEqual(await st(), { a: 'SHADOW', b: 'RETIRED' });
  assert.equal(await prisma.mlModel.count({ where: { name, OR: [{ mayServeDecisions: true }, { status: 'ACTIVE' }] } }), 0);
});
