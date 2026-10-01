import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { getLastSentEmail } from './src/services/emailService.js';
import { createDynamicQRPayload } from './src/services/qrTicketService.js';

test('Gate staff invites, ownership checks and staff access', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const run = Date.now();

  const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  const login = async (email, password = 'Password@123') => {
    const res = await call('POST', '/auth/login', null, { email, password });
    assert.strictEqual(res.status, 200, `login ${email}: ${res.body?.message}`);
    return res.body.data.token;
  };

  // Company A: the seeded approved organizer. Company B: a second approved organizer created for this test.
  const orgAToken = await login('organizer@ticketledger.pk');
  const adminToken = await login('admin@ticketledger.pk');
  const orgA = await prisma.user.findUnique({ where: { email: 'organizer@ticketledger.pk' }, include: { company: true } });
  const companyAEvents = await prisma.event.findMany({ where: { companyId: orgA.company.id }, orderBy: { date: 'asc' } });
  assert.ok(companyAEvents.length >= 2, 'Seeded company needs at least 2 events');

  // A ticket from one company A event, and an invite for a different company A event
  const ticket = await prisma.ticket.findFirst({ where: { eventId: { in: companyAEvents.map((e) => e.id) } } });
  const inviteEvent = companyAEvents.find((e) => e.id !== ticket?.eventId) || companyAEvents[0];

  const orgBEmail = `org_b_${run}@example.com`;
  const orgB = await prisma.user.create({
    data: {
      name: 'Org B Owner',
      email: orgBEmail,
      passwordHash: await bcrypt.hash('Password@123', 10),
      role: 'ORGANIZER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const companyB = await prisma.company.create({
    data: {
      userId: orgB.id,
      companyName: `Company B ${run}`,
      ownerName: 'Org B Owner',
      phone: '+923001112223',
      email: orgBEmail,
      city: 'Karachi',
      ntnCnic: '1111111-1',
      documentUrl: '/uploads/test.pdf',
      status: 'APPROVED',
    },
  });
  await prisma.user.update({ where: { id: orgB.id }, data: { companyId: companyB.id } });
  const eventB = await prisma.event.create({
    data: {
      companyId: companyB.id,
      name: `Company B Event ${run}`,
      description: 'Test event',
      type: 'MUSIC_CONCERT',
      date: new Date(Date.now() + 30 * 86400000),
      time: '19:00',
      city: 'Karachi',
      venue: 'Test Arena',
    },
  });
  const orgBToken = await login(orgBEmail);

  const staffEmail = `gate_${run}@example.com`;
  let inviteToken = '';
  let staffToken = '';
  let staffCookie = '';
  let staffId = '';

  await t.test('1. Organizer invites gate staff for their own event', async () => {
    const res = await call('POST', '/staff/invites', orgAToken, { email: staffEmail, eventId: inviteEvent.id });
    assert.strictEqual(res.status, 201, res.body?.message);
    assert.strictEqual(res.body.data.invite.status, 'PENDING');
    assert.strictEqual(res.body.data.invite.invitedBy.id, orgA.id, 'invited_by is recorded');
    assert.strictEqual(res.body.data.invite.tokenHash, undefined, 'Token hash is never exposed');
    assert.strictEqual(getLastSentEmail().type, 'STAFF_INVITE');
    inviteToken = getLastSentEmail().inviteToken;
    assert.ok(inviteToken);
  });

  await t.test("2. Organizer cannot invite for another company's event, even by editing eventId", async () => {
    const res = await call('POST', '/staff/invites', orgAToken, { email: `x_${run}@example.com`, eventId: eventB.id });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'You can only invite staff for your own events.');
  });

  await t.test('3. Inviting an email that has a customer account is rejected', async () => {
    const res = await call('POST', '/staff/invites', orgAToken, { email: 'customer@ticketledger.pk', eventId: inviteEvent.id });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.message, 'This email is already registered with another account type.');
  });

  await t.test('4. Customers and gate staff cannot use staff management', async () => {
    const customerToken = await login('customer@ticketledger.pk');
    const res = await call('POST', '/staff/invites', customerToken, { email: `y_${run}@example.com`, eventId: inviteEvent.id });
    assert.strictEqual(res.status, 403);
  });

  await t.test('5. Invite link shows the invited email and event', async () => {
    const res = await call('GET', `/auth/invite/${inviteToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.email, staffEmail);
    assert.strictEqual(res.body.data.eventName, inviteEvent.name);
  });

  await t.test('6. Accepting the invite creates a GATE_STAFF account linked to the company', async () => {
    const res = await call('POST', '/auth/accept-invite', null, { token: inviteToken, name: 'Gate Tester', password: 'Password123' });
    assert.strictEqual(res.status, 201, res.body?.message);
    assert.strictEqual(res.body.data.user.role, 'GATE_STAFF');
    assert.strictEqual(res.body.data.user.companyId, orgA.company.id);
    staffToken = res.body.data.token;
    staffId = res.body.data.user.id;
    staffCookie = (res.headers.get('set-cookie') || '').match(/tl_refresh=[^;]*/)?.[0];

    const reuse = await call('POST', '/auth/accept-invite', null, { token: inviteToken, name: 'Again', password: 'Password123' });
    assert.strictEqual(reuse.status, 410, 'A used link cannot be reused');
    assert.strictEqual(reuse.body.message, 'This invite link is no longer valid. Ask the organizer to send a new one.');
  });

  await t.test('7. Gate staff see only their assigned events', async () => {
    const res = await call('GET', '/staff/my-events', staffToken);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.data.events.map((e) => e.id), [inviteEvent.id]);
  });

  await t.test('8. Gate staff cannot open customer, organizer or admin routes', async () => {
    assert.strictEqual((await call('GET', '/auth/role-test/customer', staffToken)).status, 403);
    assert.strictEqual((await call('GET', '/auth/role-test/organizer', staffToken)).status, 403);
    assert.strictEqual((await call('GET', '/auth/role-test/admin', staffToken)).status, 403);
    assert.strictEqual((await call('GET', '/staff', staffToken)).status, 403);
  });

  await t.test('9. Gate staff cannot scan tickets for events they are not assigned to', async (st) => {
    if (!ticket) return st.skip('No seeded ticket to scan');
    const res = await call('POST', '/gate/scan', staffToken, { payload: createDynamicQRPayload(ticket) });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /not assigned/);

    const stats = await call('GET', `/gate/stats/${ticket.eventId}`, staffToken);
    assert.strictEqual(stats.status, 403);
  });

  await t.test('10. Inviting existing staff of the same company assigns them without a new account', async () => {
    const otherEvent = companyAEvents.find((e) => e.id !== inviteEvent.id);
    const res = await call('POST', '/staff/invites', orgAToken, { email: staffEmail, eventId: otherEvent.id });
    assert.strictEqual(res.status, 200, res.body?.message);
    assert.strictEqual(res.body.data.assignedExisting, true);
    const events = await call('GET', '/staff/my-events', staffToken);
    assert.strictEqual(events.body.data.events.length, 2);
  });

  await t.test("11. Organizers see only their own company's staff; Super Admin sees all", async () => {
    const a = await call('GET', '/staff', orgAToken);
    const b = await call('GET', '/staff', orgBToken);
    const admin = await call('GET', '/staff', adminToken);
    assert.ok(a.body.data.staff.some((s) => s.id === staffId));
    assert.ok(!b.body.data.staff.some((s) => s.id === staffId));
    assert.ok(!b.body.data.invites.some((i) => i.email === staffEmail));
    assert.ok(admin.body.data.staff.some((s) => s.id === staffId));
  });

  await t.test('12. Super Admin can invite staff for any event', async () => {
    const res = await call('POST', '/staff/invites', adminToken, { email: `admin_inv_${run}@example.com`, eventId: eventB.id });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.invite.companyId, companyB.id);
  });

  await t.test('13. A cancelled invite link stops working; other companies cannot cancel it', async () => {
    const created = await call('POST', '/staff/invites', orgAToken, { email: `cancel_${run}@example.com`, eventId: inviteEvent.id });
    const token = getLastSentEmail().inviteToken;
    const id = created.body.data.invite.id;

    assert.strictEqual((await call('DELETE', `/staff/invites/${id}`, orgBToken)).status, 403);
    assert.strictEqual((await call('DELETE', `/staff/invites/${id}`, orgAToken)).status, 204);
    assert.strictEqual((await call('GET', `/auth/invite/${token}`)).status, 410);
  });

  await t.test('14. An expired invite link stops working; resend issues a fresh link', async () => {
    const created = await call('POST', '/staff/invites', orgAToken, { email: `expire_${run}@example.com`, eventId: inviteEvent.id });
    const oldToken = getLastSentEmail().inviteToken;
    const id = created.body.data.invite.id;
    await prisma.staffInvite.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    assert.strictEqual((await call('GET', `/auth/invite/${oldToken}`)).status, 410);

    const resent = await call('POST', `/staff/invites/${id}/resend`, orgAToken);
    assert.strictEqual(resent.status, 200, resent.body?.message);
    const newToken = getLastSentEmail().inviteToken;
    assert.notStrictEqual(newToken, oldToken);
    assert.strictEqual((await call('GET', `/auth/invite/${newToken}`)).status, 200);
    assert.strictEqual((await call('GET', `/auth/invite/${oldToken}`)).status, 410);
  });

  await t.test('15. Deactivated staff cannot log in and their sessions are revoked', async () => {
    assert.strictEqual((await call('PATCH', `/staff/${staffId}/deactivate`, orgBToken)).status, 403);
    const res = await call('PATCH', `/staff/${staffId}/deactivate`, orgAToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.staff.status, 'DEACTIVATED');

    const relogin = await call('POST', '/auth/login', null, { email: staffEmail, password: 'Password123' });
    assert.strictEqual(relogin.status, 403);
    assert.strictEqual(relogin.body.message, 'Your account has been suspended. Contact support.');

    assert.strictEqual((await call('GET', '/auth/me', staffToken)).status, 403);
    const refresh = await fetch(`${api}/auth/refresh`, { method: 'POST', headers: { Cookie: staffCookie } });
    assert.strictEqual(refresh.status, 401);
  });

  await t.test('16. Organizer with a PENDING company cannot create events', async () => {
    await prisma.company.update({ where: { id: companyB.id }, data: { status: 'PENDING' } });
    const res = await call('POST', '/events', orgBToken, { name: 'Should fail' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Your company must be approved before you can create events.');
  });

  // Clean up
  await prisma.staffInvite.deleteMany({ where: { OR: [{ companyId: companyB.id }, { email: { contains: `_${run}@example.com` } }] } });
  await prisma.auditLog.deleteMany({ where: { targetId: staffId } });
  await prisma.behaviorEvent.deleteMany({ where: { user: { email: { in: [staffEmail, orgBEmail] } } } });
  await prisma.user.deleteMany({ where: { email: staffEmail } });
  await prisma.event.delete({ where: { id: eventB.id } });
  await prisma.company.delete({ where: { id: companyB.id } });
  await prisma.user.delete({ where: { id: orgB.id } });

  await new Promise((resolve) => server.close(resolve));
});
