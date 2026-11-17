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

const PASSWORD = 'Password@123';

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
    await prisma.discountRedemption.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.ticket.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: company.id }, { userId: { in: userIds } }, { targetId: { in: orders.map((o) => o.id) } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { type: 'ADMIN_FINANCE_REVIEW_REQUEST', title: { contains: run } } });
    await prisma.behaviorEvent.deleteMany({ where: { userId: { in: userIds } } });
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
    assert.deepEqual(first.body.data.priceBreakdown, { subtotal: 4000, discount: 800, discountCode: 'EARLY20', discountLabel: '20% off', serviceFee: 0, total: 3200, currency: 'PKR' });
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
    const switched = await call('POST', '/bookings/initiate', fanToken, { ...body, paymentMethod: 'JAZZCASH' });
    assert.equal(switched.body.data.orderId, order1);
    assert.equal(switched.body.data.paymentMethod, 'JAZZCASH');
    assert.equal(switched.body.data.totalAmount, 3200);
    assert.equal(await prisma.discountRedemption.count({ where: { orderId: order1 } }), 1);
  });

  await t.test('checkout: confirm once; code used up; one payment cannot confirm two orders', async () => {
    const o = await prisma.order.findUnique({ where: { id: order1 } });
    const ok = await call('POST', '/bookings/confirm', fanToken, { orderId: order1, paymentDetails: { otpCode: '123456', ppTxnRefNo: o.paymentRef } });
    assert.equal(ok.status, 200, ok.body?.message);
    assert.equal(ok.body.data.order.status, 'SUCCESSFUL');
    assert.equal(ok.body.data.priceBreakdown.total, 3200);
    assert.equal((await prisma.discountRedemption.findUnique({ where: { orderId: order1 } })).status, 'REDEEMED');
    assert.equal((await call('POST', '/bookings/confirm', fanToken, { orderId: order1, paymentDetails: {} })).status, 200, 'repeat is harmless');

    // EARLY20 allowed one use
    await hold(fan2.id, [seats[3]]);
    const usedUp = await call('POST', '/bookings/initiate', fan2Token, { eventId: event.id, seatIds: [seats[3].id], paymentMethod: 'JAZZCASH', discountCode: 'EARLY20' });
    assert.equal(usedUp.status, 400);
    assert.equal(usedUp.body.code, 'DISCOUNT_USED_UP');

    // Without the code: then try to pay it with the first order's JazzCash reference
    const second = await call('POST', '/bookings/initiate', fan2Token, { eventId: event.id, seatIds: [seats[3].id], paymentMethod: 'JAZZCASH' });
    assert.equal(second.status, 201, second.body?.message);
    const reuse = await call('POST', '/bookings/confirm', fan2Token, { orderId: second.body.data.orderId, paymentDetails: { otpCode: '123456', ppTxnRefNo: o.paymentRef } });
    assert.equal(reuse.status, 409);
    assert.equal(reuse.body.code, 'PAYMENT_ALREADY_USED');

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
});
