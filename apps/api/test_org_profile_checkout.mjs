// Organization profile, documents, payout details and branches; discount codes; checkout retries without
// duplicate orders or payments; abandoned-checkout recovery codes. Runs the API in-process against the database
// with throwaway accounts, a company and an event that are removed at the end.
//   node --test test_org_profile_checkout.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { runAutoRecovery } from './src/services/recoveryService.js';
import { getLastSentEmail } from './src/services/emailService.js';
import { runPayouts, computeEvent } from './src/services/payoutService.js';

const PASSWORD = 'Password@123';

// Card payments through a FAKE Stripe client (no network): JazzCash / EasyPaisa are not integrated, so the
// second payment method these checkout tests switch to is the card. A PaymentIntent is unpaid until pay(id).
const { setStripeClientForTesting } = await import('./src/services/payments/stripeProvider.js');
process.env.STRIPE_SECRET_KEY = `sk_test_${'a1B2c3D4e5'.repeat(3)}`;
process.env.STRIPE_MODE = 'test';
const intents = new Map();
let piSeq = 0;
const fakeStripe = {
  retrieved: [],
  paymentIntents: {
    create: async (p) => {
      const id = `pi_fake${Date.now()}${++piSeq}`;
      const pi = { object: 'payment_intent', id, client_secret: `${id}_secret_x`, status: 'requires_payment_method', amount: p.amount, currency: p.currency, livemode: false, metadata: p.metadata, created: Math.floor(Date.now() / 1000) };
      intents.set(id, pi);
      return pi;
    },
    retrieve: async (id) => {
      fakeStripe.retrieved.push(id);
      const pi = intents.get(id);
      if (!pi) throw Object.assign(new Error('No such payment_intent'), { type: 'StripeInvalidRequestError' });
      return { ...pi, amount_received: pi.status === 'succeeded' ? pi.amount : 0 };
    },
  },
  refunds: { create: async () => ({ id: 're_fake', status: 'succeeded' }) },
};
setStripeClientForTesting(fakeStripe);
const pay = (id) => { intents.get(id).status = 'succeeded'; };

/** A valid Pakistani IBAN for a 16-digit account number (computes the mod-97 check digits). */
function pkIban(bank, account) {
  const numeric = `${bank}${account}PK00`.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return `PK${String(98 - rem).padStart(2, '0')}${bank}${account}`;
}

test('Organization profile, finance, branches, discounts and checkout retries', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const run = `${Date.now()}`;
  const mail = (name) => `opc_${name}_${run}@example.com`;

  const call = async (method, path, token, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
  const login = async (email) => {
    const res = await call('POST', '/auth/login', null, { email, password: PASSWORD });
    assert.equal(res.status, 200, `login ${email}: ${res.body?.message}`);
    return res.body.data.token;
  };

  const hash = await bcrypt.hash(PASSWORD, 10);
  const userIds = [];
  const account = async (name, role = 'CUSTOMER') => {
    const u = await prisma.user.create({ data: { name: `Test ${name}`, email: mail(name), passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };

  const owner = await account('owner', 'ORGANIZER');
  const staffUser = await account('staff');
  const fan = await account('fan');
  const fan2 = await account('fan2');
  const company = await prisma.company.create({ data: { userId: owner.id, companyName: `Profile Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/uploads/test.pdf', status: 'APPROVED' } });
  await prisma.user.update({ where: { id: owner.id }, data: { companyId: company.id } });
  await prisma.organizationMember.create({ data: { companyId: company.id, userId: staffUser.id, role: 'STAFF' } });
  const event = await prisma.event.create({ data: { companyId: company.id, name: `Checkout Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 40 * 86400000), time: '19:00', city: 'Lahore', venue: `Hall ${run}` } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 2000, totalQuantity: 20, availableQuantity: 20 } });
  const seats = [];
  for (let i = 1; i <= 8; i++) seats.push(await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(i) } }));
  /** Holds seats for a customer, the way the seat map does (database lock). */
  const hold = (userId, list) => prisma.seat.updateMany({ where: { id: { in: list.map((s) => s.id) } }, data: { status: 'LOCKED', lockedByUserId: userId, lockedUntil: new Date(Date.now() + 10 * 60 * 1000) } });

  const ownerToken = await login(owner.email);
  const staffToken = await login(staffUser.email);
  const fanToken = await login(fan.email);
  const fan2Token = await login(fan2.email);
  const adminToken = await login('admin@ticketledger.pk');

  t.after(async () => {
    const orders = await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    await prisma.ticketGift.deleteMany({ where: { senderId: { in: userIds } } });
    await prisma.checkoutGroup.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.ticketTransferHistory.deleteMany({ where: { OR: [{ fromUserId: { in: userIds } }, { toUserId: { in: userIds } }] } });
    await prisma.discountRedemption.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.ticket.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: company.id }, { userId: { in: userIds } }, { targetId: { in: orders.map((o) => o.id) } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { type: 'ADMIN_FINANCE_REVIEW_REQUEST', title: { contains: run } } });
    await prisma.behaviorEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.recoveryReminder.deleteMany({ where: { companyId: company.id } });
    await prisma.payout.deleteMany({ where: { companyId: company.id } });
    await prisma.event.deleteMany({ where: { companyId: company.id } });
    await prisma.organizationMember.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  // ── Profile ──────────────────────────────────────────────────────────────────────────────────────────

  await t.test('profile: owners edit the public profile; the verified identity is locked', async () => {
    const res = await call('PATCH', '/org/profile', ownerToken, { description: 'We run concerts.', website: 'https://example.com', supportEmail: 'help@example.com', address: '1 Mall Road' });
    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.data.profile.website, 'https://example.com');
    assert.equal(res.body.data.profile.identityLocked, true);

    const locked = await call('PATCH', '/org/profile', ownerToken, { companyName: 'Another Name' });
    assert.equal(locked.status, 409);

    const bad = await call('PATCH', '/org/profile', ownerToken, { website: 'not a url' });
    assert.equal(bad.status, 400);

    const staffView = await call('GET', '/org/profile', staffToken);
    assert.equal(staffView.status, 200);
    assert.equal(staffView.body.data.profile.description, 'We run concerts.');
    assert.equal(staffView.body.data.profile.ntnCnic, undefined, 'staff do not see the tax number');
    assert.equal((await call('PATCH', '/org/profile', staffToken, { description: 'x' })).status, 403);

    const audit = await prisma.auditLog.findFirst({ where: { companyId: company.id, action: 'ORG_PROFILE_UPDATED' } });
    assert.equal(audit.details.after.website, 'https://example.com');
  });

  // ── Documents ────────────────────────────────────────────────────────────────────────────────────────

  await t.test('documents: upload, list, rename, archive and restore; staff are refused', async () => {
    const form = new FormData();
    form.append('type', 'BUSINESS_LICENSE');
    form.append('title', 'Licence 2026');
    form.append('expiresAt', new Date(Date.now() + 10 * 86400000).toISOString());
    form.append('documents', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'licence.pdf');
    const up = await call('POST', '/org/documents', ownerToken, form);
    assert.equal(up.status, 201, up.body?.message);
    const doc = up.body.data.documents[0];
    assert.equal(doc.type, 'BUSINESS_LICENSE');
    assert.equal(doc.expiresSoon, true);

    const wrongType = new FormData();
    wrongType.append('documents', new Blob(['x'], { type: 'text/plain' }), 'notes.txt');
    assert.equal((await call('POST', '/org/documents', ownerToken, wrongType)).status, 400);

    assert.equal((await call('PATCH', `/org/documents/${doc.id}`, ownerToken, { title: 'Trade licence' })).body.data.document.title, 'Trade licence');
    assert.equal((await call('POST', `/org/documents/${doc.id}/archive`, ownerToken)).status, 200);
    assert.equal((await call('GET', '/org/documents', ownerToken)).body.data.documents.some((d) => d.id === doc.id), false);
    assert.equal((await call('GET', '/org/documents?archived=true', ownerToken)).body.data.documents.some((d) => d.id === doc.id), true);
    assert.equal((await call('POST', `/org/documents/${doc.id}/restore`, ownerToken)).status, 200);
    assert.equal((await call('GET', '/org/documents', staffToken)).status, 403);
  });

  // ── Payout & tax details ─────────────────────────────────────────────────────────────────────────────

  const iban = pkIban('SCBL', '0000001123456702');
  await t.test('finance: password required, IBAN checked, stored encrypted, shown masked', async () => {
    assert.equal((await call('PUT', '/org/finance', ownerToken, { accountTitle: 'Profile Org', bankName: 'SCB', iban })).status, 400, 'no password');
    assert.equal((await call('PUT', '/org/finance', ownerToken, { password: 'wrong', accountTitle: 'Profile Org', bankName: 'SCB', iban })).status, 401);
    assert.equal((await call('PUT', '/org/finance', ownerToken, { password: PASSWORD, accountTitle: 'Profile Org', bankName: 'SCB', iban: 'PK00SCBL0000001123456702' })).status, 400, 'bad checksum');

    const saved = await call('PUT', '/org/finance', ownerToken, { password: PASSWORD, accountTitle: 'Profile Org', bankName: 'SCB', iban, taxNtn: '1234567-8', taxFiler: true });
    assert.equal(saved.status, 200, saved.body?.message);
    assert.equal(saved.body.data.finance.status, 'PENDING');
    assert.equal(saved.body.data.finance.iban, `•••• ${iban.slice(-4)}`);

    const row = await prisma.companyFinancialProfile.findUnique({ where: { companyId: company.id } });
    assert.ok(row.ibanEncrypted.startsWith('v1:'));
    assert.ok(!row.ibanEncrypted.includes(iban.slice(4)), 'the IBAN is not stored in clear');

    const revealed = await call('GET', '/org/finance?reveal=true', ownerToken);
    assert.equal(revealed.body.data.finance.iban, iban);
    assert.ok(await prisma.auditLog.findFirst({ where: { companyId: company.id, action: 'ORG_FINANCE_REVEALED' } }));
    assert.equal((await call('GET', '/org/finance', staffToken)).status, 403, 'staff have no finance.view');

    // Only the tax details change: stays as it was (no new review)
    await call('POST', `/companies/admin/${company.id}/finance/review`, adminToken, { status: 'VERIFIED' });
    const tax = await call('PUT', '/org/finance', ownerToken, { password: PASSWORD, salesTaxNumber: 'STRN-1' });
    assert.equal(tax.body.data.finance.status, 'VERIFIED');
    // A new destination goes back to review
    const moved = await call('PUT', '/org/finance', ownerToken, { password: PASSWORD, iban: pkIban('HABB', '0000001234567890') });
    assert.equal(moved.body.data.finance.status, 'PENDING');
    const pending = await call('GET', '/companies/admin/finance/pending', adminToken);
    assert.ok(pending.body.data.reviews.some((r) => r.company.id === company.id));
    assert.equal((await call('POST', `/companies/admin/${company.id}/finance/review`, adminToken, { status: 'REJECTED' })).status, 400, 'rejection needs a note');
  });

  // ── Branches ─────────────────────────────────────────────────────────────────────────────────────────

  await t.test('branches: create, one head office, assign events, guarded delete', async () => {
    const hq = await call('POST', '/org/branches', ownerToken, { name: 'Lahore HQ', city: 'Lahore', isHeadOffice: true });
    assert.equal(hq.status, 201, hq.body?.message);
    const khi = await call('POST', '/org/branches', ownerToken, { name: 'Karachi', city: 'Karachi', managerUserId: staffUser.id });
    assert.equal(khi.status, 201, khi.body?.message);
    assert.equal(khi.body.data.branch.manager.id, staffUser.id);
    assert.equal((await call('POST', '/org/branches', ownerToken, { name: 'Karachi', city: 'Karachi' })).status, 409, 'duplicate name');
    assert.equal((await call('POST', '/org/branches', ownerToken, { name: 'Outsider', city: 'Lahore', managerUserId: fan.id })).status, 400, 'manager must be a member');

    // Moving the head office
    await call('PATCH', `/org/branches/${khi.body.data.branch.id}`, ownerToken, { isHeadOffice: true });
    assert.equal(await prisma.companyBranch.count({ where: { companyId: company.id, isHeadOffice: true } }), 1);
    assert.equal((await call('PATCH', `/org/branches/${khi.body.data.branch.id}`, ownerToken, { status: 'INACTIVE' })).status, 409, "head office can't be deactivated");

    const assign = await call('PUT', `/org/events/${event.id}/branch`, ownerToken, { branchId: hq.body.data.branch.id });
    assert.equal(assign.status, 200, assign.body?.message);
    assert.equal((await call('DELETE', `/org/branches/${hq.body.data.branch.id}`, ownerToken)).status, 409, 'branch with events');
    const list = await call('GET', '/org/branches', staffToken);
    assert.equal(list.body.data.branches.find((b) => b.id === hq.body.data.branch.id).eventCount, 1);
    assert.equal((await call('POST', '/org/branches', staffToken, { name: 'Nope', city: 'Lahore' })).status, 403);
  });

  // ── Discount codes ───────────────────────────────────────────────────────────────────────────────────

  let codeId;
  await t.test('discounts: organizers create codes; customers quote them', async () => {
    const created = await call('POST', '/org/discounts', ownerToken, { code: 'early20', type: 'PERCENT', value: 20, eventId: event.id, maxRedemptions: 1 });
    assert.equal(created.status, 201, created.body?.message);
    assert.equal(created.body.data.code.code, 'EARLY20');
    codeId = created.body.data.code.id;
    assert.equal((await call('POST', '/org/discounts', ownerToken, { code: 'EARLY20', type: 'PERCENT', value: 10 })).status, 409);
    assert.equal((await call('POST', '/org/discounts', ownerToken, { code: 'FREE', type: 'PERCENT', value: 100 })).status, 400, 'max 90%');
    assert.equal((await call('GET', '/org/discounts', staffToken)).status, 403);

    const q = await call('POST', '/bookings/discount/quote', fanToken, { eventId: event.id, seatIds: [seats[0].id, seats[1].id], code: 'early20' });
    assert.equal(q.status, 200, q.body?.message);
    assert.deepEqual([q.body.data.subtotal, q.body.data.discount, q.body.data.total], [4000, 800, 3200]);
    assert.equal((await call('POST', '/bookings/discount/quote', fanToken, { eventId: event.id, seatIds: [seats[0].id], code: 'NOPE' })).status, 400);
  });

  // ── Checkout retries ─────────────────────────────────────────────────────────────────────────────────

  let order1;
  await t.test('checkout: retries and parallel requests return the same order', async () => {
    const mine = [seats[0], seats[1]];
    await hold(fan.id, mine);
    const body = { eventId: event.id, seatIds: mine.map((s) => s.id), paymentMethod: 'MOCK', discountCode: 'EARLY20' };
    const first = await call('POST', '/bookings/initiate', fanToken, body, { 'Idempotency-Key': `key-${run}-1` });
    assert.equal(first.status, 201, first.body?.message);
    order1 = first.body.data.orderId;
    assert.deepEqual(first.body.data.priceBreakdown, { subtotal: 4000, discount: 800, discountCode: 'EARLY20', discountLabel: '20% off', groupDiscount: 0, serviceFee: 0, tax: 0, taxPercent: 0, taxLabel: 'Sales tax', total: 3200, currency: 'PKR' });
    const ref = first.body.data.paymentParams.paymentRef;

    // Same key again, no key, and three at once (seats reversed): all the same order and payment
    const again = await call('POST', '/bookings/initiate', fanToken, body, { 'Idempotency-Key': `key-${run}-1` });
    assert.equal(again.body.data.orderId, order1);
    assert.equal(again.body.data.paymentParams.paymentRef, ref, 'the same payment is returned');
    const parallel = await Promise.all([1, 2, 3].map(() => call('POST', '/bookings/initiate', fanToken, { ...body, seatIds: [...body.seatIds].reverse() })));
    assert.ok(parallel.every((r) => r.body.data?.orderId === order1), parallel.map((r) => `${r.status} ${r.body?.message}`).join(' | '));
    assert.equal(await prisma.order.count({ where: { userId: fan.id, status: 'PENDING' } }), 1);

    // The key can't be used for other seats
    await hold(fan.id, [seats[2]]);
    const misuse = await call('POST', '/bookings/initiate', fanToken, { ...body, seatIds: [seats[2].id] }, { 'Idempotency-Key': `key-${run}-1` });
    assert.equal(misuse.status, 422);

    // Another payment method keeps the order and its discount, with a new payment
    const switched = await call('POST', '/bookings/initiate', fanToken, { ...body, paymentMethod: 'STRIPE' });
    assert.equal(switched.status, 200, switched.body?.message);
    assert.equal(switched.body.data.orderId, order1);
    assert.equal(switched.body.data.paymentMethod, 'STRIPE');
    assert.match(switched.body.data.paymentParams.paymentIntentId, /^pi_fake/);
    assert.equal(switched.body.data.totalAmount, 3200);
    assert.equal(await prisma.discountRedemption.count({ where: { orderId: order1 } }), 1);
  });

  await t.test('checkout: confirm once; code used up; one payment cannot confirm two orders', async () => {
    const o = await prisma.order.findUnique({ where: { id: order1 } });
    // Not paid at Stripe yet: never confirmed
    const unpaid = await call('POST', '/bookings/confirm', fanToken, { orderId: order1, paymentDetails: {} });
    assert.equal(unpaid.status, 400);
    assert.equal(unpaid.body.code, 'PAYMENT_NOT_COMPLETED');
    pay(o.paymentRef);
    const ok = await call('POST', '/bookings/confirm', fanToken, { orderId: order1, paymentDetails: {} });
    assert.equal(ok.status, 200, ok.body?.message);
    assert.equal(ok.body.data.order.status, 'SUCCESSFUL');
    assert.equal(ok.body.data.priceBreakdown.total, 3200);
    assert.equal((await prisma.discountRedemption.findUnique({ where: { orderId: order1 } })).status, 'REDEEMED');
    assert.equal((await call('POST', '/bookings/confirm', fanToken, { orderId: order1, paymentDetails: {} })).status, 200, 'repeat is harmless');

    // EARLY20 allowed one use
    await hold(fan2.id, [seats[3]]);
    const usedUp = await call('POST', '/bookings/initiate', fan2Token, { eventId: event.id, seatIds: [seats[3].id], paymentMethod: 'STRIPE', discountCode: 'EARLY20' });
    assert.equal(usedUp.status, 400);
    assert.equal(usedUp.body.code, 'DISCOUNT_USED_UP');

    // Without the code: then try to pay it with the first order's (paid) PaymentIntent. The server checks the
    // second order's OWN PaymentIntent, which is unpaid, and never looks at the one the browser sent.
    const second = await call('POST', '/bookings/initiate', fan2Token, { eventId: event.id, seatIds: [seats[3].id], paymentMethod: 'STRIPE' });
    assert.equal(second.status, 201, second.body?.message);
    const before = fakeStripe.retrieved.length;
    const reuse = await call('POST', '/bookings/confirm', fan2Token, { orderId: second.body.data.orderId, paymentDetails: { paymentIntentId: o.paymentRef } });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.body.code, 'PAYMENT_NOT_COMPLETED');
    assert.ok(!fakeStripe.retrieved.slice(before).includes(o.paymentRef), "the other order's payment is never checked for this order");

    const usage = await call('GET', '/org/discounts', ownerToken);
    const early = usage.body.data.codes.find((c) => c.id === codeId);
    assert.equal(early.used, 1);
    assert.equal(early.state, 'USED_UP');
    assert.equal(early.discountGiven, 800);
    // Used codes are turned off, not deleted
    assert.equal((await call('DELETE', `/org/discounts/${codeId}`, ownerToken)).body.data.deactivated, true);
  });

  await t.test('checkout: an expired hold frees the code again', async () => {
    const once = await call('POST', '/org/discounts', ownerToken, { code: `ONCE${run.slice(-5)}`, type: 'FIXED', value: 500, maxRedemptions: 1 });
    await hold(fan.id, [seats[4]]);
    const a = await call('POST', '/bookings/initiate', fanToken, { eventId: event.id, seatIds: [seats[4].id], paymentMethod: 'MOCK', discountCode: once.body.data.code.code });
    assert.equal(a.status, 201, a.body?.message);
    assert.equal(a.body.data.totalAmount, 1500);
    // Reserved by an unpaid order: nobody else can take the last use
    const q = await call('POST', '/bookings/discount/quote', fan2Token, { eventId: event.id, seatIds: [seats[5].id], code: once.body.data.code.code });
    assert.equal(q.status, 400);
    // That order fails: the use is free again
    await prisma.order.update({ where: { id: a.body.data.orderId }, data: { status: 'FAILED' } });
    const q2 = await call('POST', '/bookings/discount/quote', fan2Token, { eventId: event.id, seatIds: [seats[5].id], code: once.body.data.code.code });
    assert.equal(q2.status, 200, q2.body?.message);
  });

  // ── Abandoned checkout recovery ──────────────────────────────────────────────────────────────────────

  await t.test('recovery: personal single-use codes; unknown codes are refused', async () => {
    const sent = await call('POST', '/analytics/abandoned/send-reminder', ownerToken, { targetUserId: fan2.id, eventId: event.id, discountPercent: 15 });
    assert.equal(sent.status, 200, sent.body?.message);
    const code = sent.body.discountCode.code;
    assert.equal(sent.body.discountCode.personal, true);
    const dc = await prisma.discountCode.findUnique({ where: { companyId_code: { companyId: company.id, code } } });
    assert.equal(dc.restrictedToUserId, fan2.id);
    assert.equal(dc.source, 'CART_RECOVERY');
    const note = await prisma.notification.findFirst({ where: { userId: fan2.id, type: 'ABANDONED_CHECKOUT_REMINDER' }, orderBy: { createdAt: 'desc' } });
    assert.ok(note.message.includes(code));

    assert.equal((await call('POST', '/bookings/discount/quote', fanToken, { eventId: event.id, seatIds: [seats[6].id], code })).body.code, 'DISCOUNT_NOT_YOURS');
    const mine = await call('POST', '/bookings/discount/quote', fan2Token, { eventId: event.id, seatIds: [seats[6].id], code });
    assert.equal(mine.body.data.discount, 300);

    const bogus = await call('POST', '/analytics/abandoned/send-reminder', ownerToken, { targetUserId: fan2.id, eventId: event.id, discountCode: 'RECOVER10' });
    assert.equal(bogus.status, 400, 'a code that does not exist is not promised to customers');
  });

  await t.test('recovery: automatic reminders after a lapsed checkout, once per customer and event', async () => {
    assert.equal((await call('PUT', '/org/recovery', staffToken, { recoveryEnabled: true })).status, 403, 'needs attendee.contact');
    assert.equal((await call('PUT', '/org/recovery', ownerToken, { recoveryEnabled: true, recoveryDiscountPercent: 95 })).status, 400);
    const on = await call('PUT', '/org/recovery', ownerToken, { recoveryEnabled: true, recoveryDelayHours: 2, recoveryDiscountPercent: 12 });
    assert.equal(on.status, 200, on.body?.message);

    // fan's checkout lapsed 3 hours ago (the hold-expiry test above failed it)
    const lapsed = await prisma.order.findFirst({ where: { userId: fan.id, eventId: event.id, status: 'FAILED' }, orderBy: { createdAt: 'desc' } });
    await prisma.order.update({ where: { id: lapsed.id }, data: { updatedAt: new Date(Date.now() - 3 * 3600000) } });
    await prisma.recoveryReminder.deleteMany({ where: { eventId: event.id } });
    await runAutoRecovery();
    const sent = await prisma.recoveryReminder.findMany({ where: { eventId: event.id, userId: fan.id } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].source, 'AUTO');
    const code = await prisma.discountCode.findUnique({ where: { id: sent[0].discountCodeId } });
    assert.deepEqual([code.restrictedToUserId, Number(code.value), code.source], [fan.id, 12, 'CART_RECOVERY']);
    const note = await prisma.notification.findFirst({ where: { userId: fan.id, type: 'ABANDONED_CHECKOUT_REMINDER' }, orderBy: { createdAt: 'desc' } });
    assert.equal(note.link, `/events/${event.id}?code=${code.code}`);

    await runAutoRecovery();
    assert.equal(await prisma.recoveryReminder.count({ where: { eventId: event.id, userId: fan.id } }), 1, 'not twice in a week');
    const stats = await call('GET', '/org/recovery', ownerToken);
    assert.ok(stats.body.data.last30Days.automatic >= 1);
    await prisma.recoveryReminder.deleteMany({ where: { companyId: company.id } });
  });

  let fan3;
  let fan3Token;
  await t.test('checkout: group discount, service fee, tax, limit per customer and the invoice', async () => {
    assert.equal((await call('PUT', '/org/checkout/fees', staffToken, { taxPercent: 16 })).status, 403);
    const fees = await call('PUT', '/org/checkout/fees', ownerToken, { serviceFeeType: 'PERCENT', serviceFeeValue: 5, taxPercent: 16, taxLabel: 'Punjab sales tax', taxRegistrationNumber: 'PRA-123' });
    assert.equal(fees.status, 200, fees.body?.message);
    assert.equal((await call('PUT', `/org/events/${event.id}/checkout-rules`, ownerToken, { groupMinTickets: 3 })).status, 400, 'both group fields');
    const rules = await call('PUT', `/org/events/${event.id}/checkout-rules`, ownerToken, { groupMinTickets: 3, groupDiscountPercent: 10, maxTicketsPerCustomer: 3 });
    assert.equal(rules.status, 200, rules.body?.message);

    fan3 = await account('fan3');
    fan3Token = await login(fan3.email);
    const mine = [seats[5], seats[6], seats[7]];
    await hold(fan3.id, mine);
    const q = await call('POST', '/bookings/quote', fan3Token, { eventId: event.id, seatIds: mine.map((x) => x.id) });
    assert.equal(q.status, 200, q.body?.message);
    // 3 × 2000 = 6000 − 10% group = 5400 + 5% fee 270 = 5670 + 16% tax 907.20 = 6577.20
    assert.deepEqual([q.body.data.groupDiscount, q.body.data.serviceFee, q.body.data.tax, q.body.data.total], [600, 270, 907.2, 6577.2]);

    const init = await call('POST', '/bookings/initiate', fan3Token, { eventId: event.id, seatIds: mine.map((x) => x.id), paymentMethod: 'MOCK' });
    assert.equal(init.status, 201, init.body?.message);
    assert.equal(init.body.data.totalAmount, 6577.2);
    assert.equal(init.body.data.priceBreakdown.taxLabel, 'Punjab sales tax');
    const ok = await call('POST', '/bookings/confirm', fan3Token, { orderId: init.body.data.orderId, paymentDetails: { paymentTxId: init.body.data.paymentParams.mockTxId } });
    assert.equal(ok.status, 200, ok.body?.message);
    const paid = await prisma.order.findUnique({ where: { id: init.body.data.orderId } });
    assert.match(paid.invoiceNumber, /^INV-\d{4}-\d{6}$/);

    const pdf = await fetch(`${api}/bookings/${paid.id}/invoice`, { headers: { Authorization: `Bearer ${fan3Token}` } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal((await pdf.arrayBuffer()).byteLength > 1000, true);
    assert.equal((await fetch(`${api}/bookings/${paid.id}/invoice`, { headers: { Authorization: `Bearer ${fanToken}` } })).status, 404, "another customer's invoice");

    // Limit 3 per customer: a fourth ticket is refused
    await hold(fan3.id, [seats[2]]);
    const more = await call('POST', '/bookings/initiate', fan3Token, { eventId: event.id, seatIds: [seats[2].id], paymentMethod: 'MOCK' });
    assert.equal(more.status, 409);
    assert.equal(more.body.code, 'CUSTOMER_LIMIT');
    await call('PUT', `/org/events/${event.id}/checkout-rules`, ownerToken, { groupMinTickets: null, groupDiscountPercent: null, maxTicketsPerCustomer: null });
    await call('PUT', '/org/checkout/fees', ownerToken, { serviceFeeType: 'NONE', taxPercent: 0 });
  });

  await t.test('gifts and group tickets: delivered to accounts, claim links for new people', async () => {
    const mine = await prisma.ticket.findMany({ where: { userId: fan3.id, eventId: event.id, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    assert.equal(mine.length, 3);
    const gift = await call('POST', '/bookings/gifts', fan3Token, { kind: 'GIFT', ticketIds: [mine[0].id], email: fan.email, message: 'Happy birthday!' });
    assert.equal(gift.status, 201, gift.body?.message);
    const moved = await prisma.ticket.findUnique({ where: { id: mine[0].id } });
    assert.equal(moved.userId, fan.id);
    assert.equal(moved.qrVersion, mine[0].qrVersion + 1, 'the old QR stops working');

    const friend = `friend.${run}@gmail.com`;
    const group = await call('POST', '/bookings/gifts', fan3Token, { kind: 'GROUP', recipients: [{ ticketId: mine[1].id, email: friend, name: 'Friend' }] });
    assert.equal(group.body.data.gifts[0].delivered, false);
    const link = getLastSentEmail().actionUrl;
    assert.match(link, /\/gifts\/[\w-]+$/);
    const token = link.split('/gifts/')[1];
    const preview = await call('GET', `/gifts/${token}`);
    assert.equal(preview.body.data.status, 'PENDING');
    assert.equal((await call('POST', '/bookings/gifts', fan3Token, { ticketIds: [mine[1].id], email: fan2.email })).status, 409, 'already waiting');
    assert.equal((await call('POST', `/gifts/${token}/claim`, fanToken)).status, 403, 'only the invited email');

    const newcomer = await prisma.user.create({ data: { name: 'Test Friend', email: friend, passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(newcomer.id);
    const claimed = await call('POST', `/gifts/${token}/claim`, await login(friend));
    assert.equal(claimed.status, 200, claimed.body?.message);
    assert.equal((await prisma.ticket.findUnique({ where: { id: mine[1].id } })).userId, newcomer.id);
    assert.equal((await call('POST', `/gifts/${token}/claim`, await login(friend))).status, 410);
  });

  await t.test('booking changes: move to a free seat of the same type when the event allows it', async () => {
    const t3 = await prisma.ticket.findFirst({ where: { userId: fan3.id, eventId: event.id, status: 'ACTIVE' } });
    assert.equal((await call('GET', `/bookings/tickets/${t3.id}/seat-options`, fan3Token)).status, 409, 'not allowed by default');
    await call('PUT', `/org/events/${event.id}/checkout-rules`, ownerToken, { allowSeatChanges: true, seatChangeCutoffHours: 24 });
    const opts = await call('GET', `/bookings/tickets/${t3.id}/seat-options`, fan3Token);
    assert.equal(opts.status, 200, opts.body?.message);
    const free = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'B', row: 'B', seatNumber: '1' } });
    const ch = await call('POST', `/bookings/tickets/${t3.id}/change-seat`, fan3Token, { seatId: free.id });
    assert.equal(ch.status, 200, ch.body?.message);
    const after = await prisma.ticket.findUnique({ where: { id: t3.id } });
    assert.equal(after.seatId, free.id);
    assert.equal(after.chainSeatId, t3.chainSeatId || t3.seatId, 'the NFT keeps its seat key');
    assert.equal((await prisma.seat.findUnique({ where: { id: t3.seatId } })).status, 'AVAILABLE');
    assert.equal((await call('POST', `/bookings/tickets/${t3.id}/change-seat`, fanToken, { seatId: t3.seatId })).status, 404, "someone else's ticket");
    await call('PUT', `/org/events/${event.id}/checkout-rules`, ownerToken, { allowSeatChanges: false });
  });

  await t.test('cart: several events, one payment; a lapsed reservation is left out', async () => {
    const event2 = await prisma.event.create({ data: { companyId: company.id, name: `Second Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 50 * 86400000), time: '19:00', city: 'Lahore', venue: `Hall Two ${run}` } });
    const tier2 = await prisma.ticketTier.create({ data: { eventId: event2.id, name: 'Standard', price: 1500, totalQuantity: 10, availableQuantity: 10 } });
    const mk = (eventId, tierId, n) => prisma.seat.create({ data: { eventId, tierId, section: 'C', row: 'C', seatNumber: String(n) } });
    const [a1, a2] = [await mk(event.id, tier.id, 1), await mk(event.id, tier.id, 2)];
    const [b1, b2] = [await mk(event2.id, tier2.id, 1), await mk(event2.id, tier2.id, 2)];
    const fan4 = await account('fan4');
    const tok = await login(fan4.email);
    await hold(fan4.id, [a1, b1]);
    const o1 = await call('POST', '/bookings/initiate', tok, { eventId: event.id, seatIds: [a1.id], paymentMethod: 'MOCK', cart: true });
    const o2 = await call('POST', '/bookings/initiate', tok, { eventId: event2.id, seatIds: [b1.id], paymentMethod: 'MOCK', cart: true });
    assert.equal(o1.status, 201, o1.body?.message);
    assert.equal(o1.body.data.paymentParams, undefined, 'no payment per order');
    const co = await call('POST', '/bookings/cart/checkout', tok, { orderIds: [o1.body.data.orderId, o2.body.data.orderId], paymentMethod: 'MOCK' });
    assert.equal(co.status, 201, co.body?.message);
    assert.equal(co.body.data.totalAmount, 3500);
    const again = await call('POST', '/bookings/cart/checkout', tok, { orderIds: [o2.body.data.orderId, o1.body.data.orderId], paymentMethod: 'MOCK' });
    assert.equal(again.body.data.groupId, co.body.data.groupId, 'a retry reuses the checkout');
    assert.equal((await call('POST', '/bookings/confirm', tok, { orderId: o1.body.data.orderId, paymentDetails: {} })).body.code, 'PAY_THROUGH_CART');
    const paid = await call('POST', '/bookings/cart/confirm', tok, { groupId: co.body.data.groupId, paymentDetails: { paymentTxId: co.body.data.paymentParams.mockTxId } });
    assert.equal(paid.status, 200, paid.body?.message);
    assert.equal(paid.body.data.confirmed.length, 2);
    assert.ok(paid.body.data.confirmed.every((c) => /^INV-/.test(c.invoiceNumber)));
    assert.equal((await call('POST', '/bookings/cart/confirm', tok, { groupId: co.body.data.groupId, paymentDetails: {} })).body.message, 'Already paid.');

    // One reservation lapses between checkout and payment
    await hold(fan4.id, [a2, b2]);
    const p1 = await call('POST', '/bookings/initiate', tok, { eventId: event.id, seatIds: [a2.id], paymentMethod: 'MOCK', cart: true });
    const p2 = await call('POST', '/bookings/initiate', tok, { eventId: event2.id, seatIds: [b2.id], paymentMethod: 'MOCK', cart: true });
    const co2 = await call('POST', '/bookings/cart/checkout', tok, { orderIds: [p1.body.data.orderId, p2.body.data.orderId], paymentMethod: 'MOCK' });
    await prisma.order.update({ where: { id: p2.body.data.orderId }, data: { status: 'FAILED' } });
    const part = await call('POST', '/bookings/cart/confirm', tok, { groupId: co2.body.data.groupId, paymentDetails: { paymentTxId: co2.body.data.paymentParams.mockTxId } });
    assert.equal(part.status, 200, part.body?.message);
    assert.deepEqual([part.body.data.confirmed.length, part.body.data.lapsed.length], [1, 1]);
    await prisma.ticket.deleteMany({ where: { eventId: event2.id } });
    await prisma.order.deleteMany({ where: { eventId: event2.id } });
    await prisma.checkoutGroup.deleteMany({ where: { userId: fan4.id } });
  });

  await t.test('payouts: held until verified, scheduled, then paid with a reference', async () => {
    await prisma.event.update({ where: { id: event.id }, data: { endsAt: new Date(Date.now() - 3600000) } });
    await prisma.companyFinancialProfile.update({ where: { companyId: company.id }, data: { status: 'PENDING' } });
    await runPayouts(new Date(), { companyId: company.id });
    let p = await prisma.payout.findUnique({ where: { eventId: event.id } });
    assert.equal(p.status, 'ON_HOLD');
    const sums = await computeEvent(event.id);
    assert.equal(Number(p.netAmount), sums.netAmount);
    assert.equal(sums.netAmount, Math.round((sums.grossSales + sums.serviceFees + sums.taxCollected - sums.refunds - sums.platformFee) * 100) / 100);

    await call('POST', `/companies/admin/${company.id}/finance/review`, adminToken, { status: 'VERIFIED' });
    await runPayouts(new Date(), { companyId: company.id });
    p = await prisma.payout.findUnique({ where: { eventId: event.id } });
    assert.equal(p.status, 'SCHEDULED');
    await prisma.payout.update({ where: { id: p.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await runPayouts(new Date(), { companyId: company.id });
    p = await prisma.payout.findUnique({ where: { eventId: event.id } });
    assert.equal(p.status, 'PROCESSING');
    assert.match(p.destination, /•••• \d{4}/);

    const mine = await call('GET', '/org/payouts', ownerToken);
    assert.equal(mine.status, 200, mine.body?.message);
    assert.ok(mine.body.data.payouts.some((x) => x.id === p.id));
    assert.equal((await call('GET', '/org/payouts', staffToken)).status, 403);
    assert.equal((await call('POST', `/companies/admin/payouts/${p.id}/decide`, adminToken, { action: 'PAID' })).status, 400, 'reference needed');
    const paid = await call('POST', `/companies/admin/payouts/${p.id}/decide`, adminToken, { action: 'PAID', reference: 'IBFT-778899' });
    assert.equal(paid.status, 200, paid.body?.message);
    assert.equal(paid.body.data.payout.status, 'PAID');
    assert.ok(await prisma.notification.findFirst({ where: { userId: owner.id, type: 'ORG_PAYOUT', title: { startsWith: 'Payout sent' } } }));
  });
});
