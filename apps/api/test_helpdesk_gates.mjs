// Helpdesk (tickets, replies, internal notes, assignment, resolve / reopen, escalation, auto-escalation) and gate
// management (gates and types, ticket-type gates, re-entry policies, gate staff, exceptions, reversals, devices,
// sync status, reports). Runs the API in-process against the database with throwaway data removed at the end.
//   node --test test_helpdesk_gates.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { escalateOverdue } from './src/services/supportService.js';

const PASSWORD = 'Password@123';
// This suite drives scanners that never enrolled a device token (as deployed before device enrollment), so it pins
// the migration mode; enrolled devices, enforcement and the deadline are covered in test_gate_device_auth.mjs.
process.env.GATE_DEVICE_AUTH = 'warn';
process.env.GATE_DEVICE_AUTH_DEADLINE = '2999-01-01T00:00:00Z';

test('Helpdesk and gate management', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const run = `${Date.now()}`;
  const mail = (n) => `hg_${n}_${run}@example.com`;
  const call = async (method, path, token, body) => {
    const isForm = body instanceof FormData;
    const res = await fetch(`${api}${path}`, { method, headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const text = await res.text();
    let json = text;
    try { json = text ? JSON.parse(text) : null; } catch { /* csv */ }
    return { status: res.status, body: json };
  };
  const login = async (email) => {
    const r = await call('POST', '/auth/login', null, { email, password: PASSWORD });
    assert.equal(r.status, 200, `login ${email}: ${r.body?.message}`);
    return r.body.data.token;
  };
  const hash = await bcrypt.hash(PASSWORD, 10);
  const userIds = [];
  const account = async (n, role = 'CUSTOMER') => {
    const u = await prisma.user.create({ data: { name: `Test ${n}`, email: mail(n), passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };

  const customer = await account('cust');
  const other = await account('other');
  const agentUser = await account('agent');
  const owner = await account('owner', 'ORGANIZER');
  const gateUser = await account('gate', 'GATE_STAFF');
  const company = await prisma.company.create({ data: { userId: owner.id, companyName: `Gate Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  await prisma.user.update({ where: { id: owner.id }, data: { companyId: company.id } });
  await prisma.user.update({ where: { id: gateUser.id }, data: { companyId: company.id } });
  await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: gateUser.id, role: 'GATE_STAFF' }] });
  const event = await prisma.event.create({ data: { companyId: company.id, name: `Gate Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 86400000), time: '19:00', city: 'Lahore', venue: 'Hall' } });
  await prisma.staffEventAssignment.create({ data: { staffId: gateUser.id, eventId: event.id, assignedById: owner.id } });
  const vip = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'VIP', price: 5000, totalQuantity: 5, availableQuantity: 0 } });
  const std = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 1000, totalQuantity: 5, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: event.id, totalAmount: 12000, status: 'SUCCESSFUL' } });
  const code = () => `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const tickets = {};
  for (const [key, tier, n] of [['vip', vip, 1], ['std1', std, 2], ['std2', std, 3], ['std3', std, 4]]) {
    const seat = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(n), status: 'SOLD' } });
    tickets[key] = await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, seatId: seat.id, userId: customer.id, price: tier.price, manualCode: code() } });
  }

  const custToken = await login(customer.email);
  const otherToken = await login(other.email);
  const agentToken0 = await login(agentUser.email);
  const ownerToken = await login(owner.email);
  const gateToken = await login(gateUser.email);
  const adminToken = await login('admin@ticketledger.pk');

  t.after(async () => {
    const sts = await prisma.supportTicket.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const files = await prisma.supportAttachment.findMany({ where: { message: { ticketId: { in: sts.map((x) => x.id) } } }, select: { storageKey: true } });
    const { rm } = await import('node:fs/promises');
    for (const f of files) if (f.storageKey?.startsWith('local:')) await rm(`private_uploads/${f.storageKey.slice(6)}`, { force: true });
    await prisma.auditLog.deleteMany({ where: { targetType: 'SupportTicket', targetId: { in: sts.map((x) => x.id) } } });
    await prisma.supportTicket.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gateDevice.deleteMany({ where: { companyId: company.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: company.id }, { userId: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { OR: [{ title: { contains: run } }, { message: { contains: run } }] } });
    await prisma.checkIn.deleteMany({ where: { eventId: event.id } });
    await prisma.gateScan.deleteMany({ where: { staffId: { in: userIds } } });
    await prisma.staffEventAssignment.deleteMany({ where: { eventId: event.id } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.event.deleteMany({ where: { companyId: company.id } });
    await prisma.organizationMember.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  // ── Helpdesk ─────────────────────────────────────────────────────────────────────────────────────────

  let ref;
  await t.test('helpdesk: a customer opens a ticket with a screenshot and gets a reference', async () => {
    const form = new FormData();
    form.append('category', 'REFUND');
    form.append('subject', `Refund missing ${run}`);
    form.append('message', 'My refund for the cancelled show has not arrived.');
    form.append('orderId', order.id);
    form.append('attachments', new Blob(['fake png'], { type: 'image/png' }), 'screenshot.png');
    const r = await call('POST', '/support/tickets', custToken, form);
    assert.equal(r.status, 201, r.body?.message);
    ref = r.body.data.ticket.reference;
    assert.match(ref, /^SUP-\d{6}-[A-Z2-9]{4}$/);
    assert.equal(r.body.data.messages[0].attachments[0].fileName, 'screenshot.png');
    // Private file: only through a signed, expiring link; never from the public folder
    const link = r.body.data.messages[0].attachments[0].url;
    assert.match(link, /^\/api\/support\/attachments\/[\w-]+\?exp=\d+&sig=/);
    const origin = api.replace(/\/api$/, '');
    const file = await fetch(`${origin}${link}`);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), 'fake png');
    assert.equal((await fetch(`${origin}${link.replace(/sig=[^&]+/, 'sig=forged')}`)).status, 403);
    const id = link.split('/').pop().split('?')[0];
    const past = Date.now() - 1000;
    assert.equal((await fetch(`${origin}/api/support/attachments/${id}?exp=${past}&sig=x`)).status, 410);
    const stored = await prisma.supportAttachment.findUnique({ where: { id } });
    assert.ok(stored.storageKey.startsWith('local:support/') || stored.storageKey.startsWith('cld:'));
    assert.equal(stored.url, null);
    assert.equal((await fetch(`${origin}/uploads/support/anything.png`)).status, 404);
    assert.equal(r.body.data.ticket.status, 'OPEN');

    assert.equal((await call('GET', `/support/tickets/${ref}`, otherToken)).status, 404, "other customers can't see it");
    const notMine = new FormData();
    notMine.append('category', 'BOOKING'); notMine.append('subject', 'Someone else'); notMine.append('message', 'Not my order at all'); notMine.append('orderId', order.id);
    assert.equal((await call('POST', '/support/tickets', otherToken, notMine)).status, 400, "can't link another customer's booking");
    assert.equal((await call('GET', '/support/desk/tickets', custToken)).status, 403);
    assert.equal((await call('GET', '/support/tickets', custToken)).body.data.tickets[0].reference, ref);
  });

  let agentToken;
  await t.test('helpdesk: admins make support agents', async () => {
    assert.equal((await call('POST', '/support/desk/agents', agentToken0, { email: agentUser.email, agent: true })).status, 403);
    const r = await call('POST', '/support/desk/agents', adminToken, { email: agentUser.email, agent: true });
    assert.equal(r.status, 200, r.body?.message);
    agentToken = agentToken0; // isSupportAgent is read on every request
    const agents = await call('GET', '/support/desk/agents', agentToken);
    assert.ok(agents.body.data.agents.some((a) => a.id === agentUser.id));
    const me = await call('GET', '/auth/me', agentToken);
    assert.equal(me.body.data.user.isSupportAgent, true);
  });

  await t.test('helpdesk: internal notes stay internal; replies move the status; history is kept', async () => {
    const note = new FormData();
    note.append('body', 'Checked the payment gateway: refund pending.'); note.append('internal', 'true');
    assert.equal((await call('POST', `/support/tickets/${ref}/replies`, agentToken, note)).status, 200);
    const custNote = new FormData();
    custNote.append('body', 'sneaky'); custNote.append('internal', 'true');
    assert.equal((await call('POST', `/support/tickets/${ref}/replies`, custToken, custNote)).status, 403);

    const ans = new FormData();
    ans.append('body', 'Your refund is on its way; it takes 3-5 days.');
    const a = await call('POST', `/support/tickets/${ref}/replies`, agentToken, ans);
    assert.equal(a.body.data.ticket.status, 'WAITING_ON_CUSTOMER');
    assert.equal(a.body.data.ticket.assignee.id, agentUser.id, 'replying takes the ticket');

    const view = await call('GET', `/support/tickets/${ref}`, custToken);
    assert.equal(view.body.data.messages.some((m) => m.internal), false);
    assert.equal(view.body.data.ticket.assignee.email, undefined, 'customers see the first name only');
    const back = new FormData();
    back.append('body', 'Thanks, I will wait.');
    assert.equal((await call('POST', `/support/tickets/${ref}/replies`, custToken, back)).body.data.ticket.status, 'IN_PROGRESS');

    const resolved = await call('PATCH', `/support/desk/tickets/${ref}`, agentToken, { status: 'RESOLVED' });
    assert.equal(resolved.body.data.ticket.status, 'RESOLVED');
    const reopen = new FormData();
    reopen.append('body', 'Still nothing after a week.');
    assert.equal((await call('POST', `/support/tickets/${ref}/replies`, custToken, reopen)).body.data.ticket.status, 'OPEN', 'a reply reopens it');

    const full = await call('GET', `/support/tickets/${ref}`, agentToken);
    const system = full.body.data.messages.filter((m) => m.authorType === 'SYSTEM').map((m) => m.body);
    assert.ok(system.some((b) => b.includes('Resolved')) && system.some((b) => b.includes('Reopened')));
    assert.ok(full.body.data.context.order, 'agents see the linked booking');
    assert.ok(await prisma.notification.findFirst({ where: { userId: customer.id, type: 'SUPPORT_UPDATE', link: `/support/${ref}` } }));
  });

  await t.test('helpdesk: the event organizer reads and answers; status stays with support', async () => {
    const list = await call('GET', '/support/org/tickets', ownerToken);
    assert.equal(list.status, 200, list.body?.message);
    assert.ok(list.body.data.tickets.some((x) => x.reference === ref), 'the request is about their event');
    assert.equal((await call('GET', '/support/org/tickets', gateToken)).status, 403, 'gate staff have no support.respond');
    assert.equal((await call('GET', `/support/tickets/${ref}`, gateToken)).status, 404);

    const view = await call('GET', `/support/tickets/${ref}`, ownerToken);
    assert.equal(view.body.data.ticket.viewer, 'organizer');
    assert.equal(view.body.data.messages.some((m) => m.internal), false, 'no internal notes for organizers');
    assert.equal(view.body.data.ticket.customer.email, customer.email);

    const ans = new FormData();
    ans.append('body', 'We will refund you at the venue box office too.');
    const r = await call('POST', `/support/tickets/${ref}/replies`, ownerToken, ans);
    assert.equal(r.status, 200, r.body?.message);
    const mine = r.body.data.messages.filter((m) => m.authorType !== 'SYSTEM').at(-1);
    assert.equal(mine.authorType, 'ORGANIZER');
    assert.equal(mine.organization, company.companyName);
    const noteForm = new FormData();
    noteForm.append('body', 'secret'); noteForm.append('internal', 'true');
    assert.equal((await call('POST', `/support/tickets/${ref}/replies`, ownerToken, noteForm)).status, 403);
    assert.equal((await call('PATCH', `/support/desk/tickets/${ref}`, ownerToken, { status: 'RESOLVED' })).status, 403);
    const cust = await call('GET', `/support/tickets/${ref}`, custToken);
    assert.equal(cust.body.data.messages.filter((m) => m.authorType === 'ORGANIZER').at(-1).organization, company.companyName);
    assert.ok(await prisma.notification.findFirst({ where: { userId: customer.id, type: 'SUPPORT_UPDATE', message: { contains: '(the event organizer) replied' } } }));
    assert.ok(await prisma.notification.findFirst({ where: { userId: owner.id, type: 'SUPPORT_ORG_NEW_TICKET' } }), 'organizer told about the new request');
  });

  await t.test('helpdesk: admins escalate; overdue tickets escalate by themselves', async () => {
    assert.equal((await call('POST', `/support/desk/tickets/${ref}/escalate`, agentToken, { reason: 'Refund stuck' })).status, 403, 'agents cannot escalate');
    const e = await call('POST', `/support/desk/tickets/${ref}/escalate`, adminToken, { reason: 'Refund stuck at the bank' });
    assert.equal(e.status, 200, e.body?.message);
    assert.equal(e.body.data.ticket.status, 'ESCALATED');
    assert.equal(e.body.data.ticket.priority, 'HIGH');
    assert.equal((await call('PATCH', `/support/desk/tickets/${ref}`, agentToken, { status: 'IN_PROGRESS' })).status, 403);
    assert.equal((await call('POST', `/support/desk/tickets/${ref}/deescalate`, adminToken, { note: 'Bank confirmed' })).body.data.ticket.status, 'IN_PROGRESS');
    // Customers see that it was escalated, not why, and not who it is assigned to
    const custView = (await call('GET', `/support/tickets/${ref}`, custToken)).body.data.messages.map((m) => m.body).join(' | ');
    assert.ok(!custView.includes('Refund stuck at the bank') && !custView.includes('Assigned to') && !custView.includes('Bank confirmed'), custView);
    assert.ok(custView.includes('passed to a senior member'));
    const staffView = (await call('GET', `/support/tickets/${ref}`, agentToken)).body.data.messages.map((m) => m.body).join(' | ');
    assert.ok(staffView.includes('Refund stuck at the bank'));

    const form = new FormData();
    form.append('category', 'TECHNICAL'); form.append('subject', `App broken ${run}`); form.append('message', 'The wallet page does not load.');
    const late = await call('POST', '/support/tickets', otherToken, form);
    await prisma.supportTicket.update({ where: { reference: late.body.data.ticket.reference }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
    await escalateOverdue();
    const after = await prisma.supportTicket.findUnique({ where: { reference: late.body.data.ticket.reference } });
    assert.equal(after.status, 'ESCALATED');
    assert.equal(after.escalationLevel, 1);

    // A reply on an unassigned request reaches every agent
    const r2 = new FormData();
    r2.append('body', `Any news? ${run}`);
    await call('POST', `/support/tickets/${late.body.data.ticket.reference}/replies`, otherToken, r2);
    assert.ok(await prisma.notification.findFirst({ where: { userId: agentUser.id, type: 'SUPPORT_CUSTOMER_REPLY', link: `/support/desk/${late.body.data.ticket.reference}` } }));
    const q = await call('GET', '/support/desk/tickets?queue=escalated', agentToken);
    assert.ok(q.body.data.items.some((i) => i.reference === late.body.data.ticket.reference));
    assert.equal((await call('POST', `/support/tickets/${ref}/close`, custToken)).body.data.ticket.status, 'CLOSED');
    const closed = new FormData();
    closed.append('body', 'one more thing');
    assert.equal((await call('POST', `/support/tickets/${ref}/replies`, custToken, closed)).status, 409);
  });

  // ── Gates ────────────────────────────────────────────────────────────────────────────────────────────

  const ids = {};
  const scan = (token, codeText, extra = {}) => call('POST', '/checkin/scan', token, { eventId: event.id, code: codeText, deviceId: 'gate-device-test-1', ...extra });

  await t.test('gates: supervisors set up gates; gate staff cannot', async () => {
    assert.equal((await call('GET', `/checkin/manage/events/${event.id}`, gateToken)).status, 403);
    const main = await call('POST', `/checkin/manage/events/${event.id}/gates`, ownerToken, { name: 'Main', type: 'ENTRY_EXIT', capacityPerHour: 4 });
    assert.equal(main.status, 201, main.body?.message);
    ids.main = main.body.data.gate.id;
    ids.vip = (await call('POST', `/checkin/manage/events/${event.id}/gates`, ownerToken, { name: 'VIP', type: 'ENTRY', allowedTierIds: [vip.id] })).body.data.gate.id;
    ids.exit = (await call('POST', `/checkin/manage/events/${event.id}/gates`, ownerToken, { name: 'Exit North', type: 'EXIT' })).body.data.gate.id;
    assert.equal((await call('POST', `/checkin/manage/events/${event.id}/gates`, ownerToken, { name: 'Main' })).status, 409);
    const o = await call('GET', `/checkin/manage/events/${event.id}`, ownerToken);
    assert.equal(o.body.data.gates.length, 3);
    assert.ok(o.body.data.scanners.some((s) => s.id === gateUser.id));
  });

  await t.test('gates: gate required, ticket types and directions enforced', async () => {
    assert.equal((await scan(gateToken, tickets.std1.manualCode)).body.code, 'GATE_REQUIRED');
    const wrong = await scan(gateToken, tickets.std1.manualCode, { gateId: ids.vip });
    assert.equal(wrong.body.data.result, 'RED');
    assert.equal(wrong.body.data.code, 'WRONG_GATE');
    assert.match(wrong.body.data.reason, /Standard tickets enter at Main/);
    assert.equal((await scan(gateToken, tickets.vip.manualCode, { gateId: ids.vip })).body.data.result, 'GREEN');
    assert.equal((await scan(gateToken, tickets.vip.manualCode, { gateId: ids.vip, direction: 'EXIT' })).body.code, 'GATE_DIRECTION');
    assert.equal((await scan(gateToken, tickets.std2.manualCode, { gateId: ids.exit, direction: 'EXIT' })).body.data.result, 'RED', "can't exit before entering");
  });

  await t.test('gates: exits and re-entry policies', async () => {
    assert.equal((await scan(gateToken, tickets.std1.manualCode, { gateId: ids.main })).body.data.result, 'GREEN');
    const out = await scan(gateToken, tickets.std1.manualCode, { gateId: ids.exit, direction: 'EXIT' });
    assert.equal(out.body.data.result, 'GREEN');
    assert.match(out.body.data.reason, /No re-entry/);
    assert.equal((await scan(gateToken, tickets.std1.manualCode, { gateId: ids.main })).body.data.result, 'YELLOW', 'policy NONE');

    assert.equal((await call('PUT', `/checkin/manage/events/${event.id}/policy`, ownerToken, { reentryPolicy: 'LIMITED' })).status, 400, 'limit required');
    await call('PUT', `/checkin/manage/events/${event.id}/policy`, ownerToken, { reentryPolicy: 'LIMITED', maxReentries: 1 });
    const back = await scan(gateToken, tickets.std1.manualCode, { gateId: ids.main });
    assert.equal(back.body.data.result, 'GREEN');
    assert.equal(back.body.data.reentry, true);
    ids.reentryCheckIn = back.body.data.checkInId;
    await scan(gateToken, tickets.std1.manualCode, { gateId: ids.main, direction: 'EXIT' });
    const limit = await scan(gateToken, tickets.std1.manualCode, { gateId: ids.main });
    assert.equal(limit.body.data.result, 'YELLOW');
    assert.match(limit.body.data.reason, /limit reached/);
    const t1 = await prisma.ticket.findUnique({ where: { id: tickets.std1.id } });
    assert.deepEqual([t1.entryCount, t1.isInside], [2, false]);
  });

  await t.test('gates: staff limited to their gates; supervisors anywhere', async () => {
    const r = await call('PUT', `/checkin/manage/events/${event.id}/staff/${gateUser.id}/gates`, ownerToken, { gateIds: [ids.main, ids.exit] });
    assert.equal(r.status, 200, r.body?.message);
    const refused = await scan(gateToken, tickets.vip.manualCode, { gateId: ids.vip });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'GATE_NOT_ASSIGNED');
    const pack = await call('GET', `/checkin/events/${event.id}/pack?deviceId=gate-device-test-1`, gateToken);
    assert.deepEqual(pack.body.data.myGateIds.sort(), [ids.main, ids.exit].sort());
    assert.equal(pack.body.data.gates.length, 3);
    assert.equal(pack.body.data.event.reentryPolicy, 'LIMITED');
  });

  await t.test('gates: exception requests are approved with a note and audited', async () => {
    const turned = await scan(gateToken, tickets.std2.manualCode, { gateId: ids.main, direction: 'ENTRY' });
    assert.equal(turned.body.data.result, 'GREEN');
    // A guest whose ticket shows "already scanned" (e.g. friend used the screenshot): supervisor lets them in
    const dup = await scan(gateToken, tickets.std2.manualCode, { gateId: ids.main });
    const req1 = await call('POST', '/checkin/exceptions', gateToken, { eventId: event.id, code: tickets.std2.manualCode, gateId: ids.main, gate: 'Main', scanResult: `${dup.body.data.result}: ${dup.body.data.reason}`, reason: 'Guest shows ID matching the ticket holder' });
    assert.equal(req1.status, 201, req1.body?.message);
    const pending = await call('GET', `/checkin/manage/events/${event.id}/exceptions?status=PENDING`, ownerToken);
    assert.equal(pending.body.data.exceptions.length, 1);
    assert.equal((await call('POST', `/checkin/manage/events/${event.id}/exceptions/${req1.body.data.exception.id}/decide`, gateToken, { approve: true, note: 'x'.repeat(5) })).status, 403);
    const ok = await call('POST', `/checkin/manage/events/${event.id}/exceptions/${req1.body.data.exception.id}/decide`, ownerToken, { approve: true, note: 'Checked ID at the desk' });
    assert.equal(ok.status, 200, ok.body?.message);
    assert.equal(ok.body.data.exception.status, 'APPROVED');
    assert.ok(await prisma.auditLog.findFirst({ where: { companyId: company.id, action: 'GATE_EXCEPTION_APPROVED' } }));
    // Unknown code: can't be approved
    const ghost = await call('POST', '/checkin/exceptions', gateToken, { eventId: event.id, code: 'TL-ZZZZ-ZZZZ', gateId: ids.main, scanResult: 'RED: No ticket has this code', reason: 'Says they bought at the door' });
    assert.equal((await call('POST', `/checkin/manage/events/${event.id}/exceptions/${ghost.body.data.exception.id}/decide`, ownerToken, { approve: true, note: 'trying' })).status, 409);
    assert.equal((await call('POST', `/checkin/manage/events/${event.id}/exceptions/${ghost.body.data.exception.id}/decide`, ownerToken, { approve: false, note: 'No ticket' })).body.data.exception.status, 'DENIED');
  });

  await t.test('gates: supervisors reverse a check-in; the ticket is valid again', async () => {
    const first = await scan(gateToken, tickets.std3.manualCode, { gateId: ids.main });
    const id = first.body.data.checkInId;
    assert.equal((await call('POST', `/checkin/manage/events/${event.id}/checkins/${id}/reverse`, gateToken, { reason: 'mistake made' })).status, 403);
    const rev = await call('POST', `/checkin/manage/events/${event.id}/checkins/${id}/reverse`, ownerToken, { reason: 'Scanned the wrong phone' });
    assert.equal(rev.status, 200, rev.body?.message);
    assert.equal(rev.body.data.ticketValidAgain, true);
    assert.equal((await prisma.ticket.findUnique({ where: { id: tickets.std3.id } })).status, 'ACTIVE');
    assert.equal((await call('POST', `/checkin/manage/events/${event.id}/checkins/${id}/reverse`, ownerToken, { reason: 'again again' })).status, 409);
    assert.equal((await scan(gateToken, tickets.std3.manualCode, { gateId: ids.main })).body.data.result, 'GREEN');
    // An earlier admission of a ticket scanned since can't be reversed
    assert.equal((await call('POST', `/checkin/manage/events/${event.id}/checkins/${ids.reentryCheckIn}/reverse`, ownerToken, { reason: 'old one here' })).status, 409);
  });

  await t.test('gates: devices register, report sync status and can be revoked', async () => {
    await call('POST', '/checkin/heartbeat', gateToken, { eventId: event.id, deviceId: 'gate-device-test-1', gate: 'Main', pending: 3, online: true });
    let list = await call('GET', `/checkin/manage/events/${event.id}/devices`, ownerToken);
    const d = list.body.data.devices.find((x) => x.lastUser === gateUser.name);
    assert.ok(d, 'registered on first use');
    assert.equal(d.sync, 'UPLOADING');
    assert.equal(d.pendingScans, 3);
    assert.equal((await call('PATCH', `/checkin/manage/events/${event.id}/devices/${d.id}`, ownerToken, { status: 'REVOKED' })).status, 400, 'reason required');
    await call('PATCH', `/checkin/manage/events/${event.id}/devices/${d.id}`, ownerToken, { status: 'REVOKED', reason: 'Phone lost' });
    const blocked = await scan(gateToken, tickets.vip.manualCode, { gateId: ids.main });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'DEVICE_REVOKED');
    assert.equal((await call('GET', `/checkin/events/${event.id}/pack?deviceId=gate-device-test-1`, gateToken)).status, 403);
    await call('PATCH', `/checkin/manage/events/${event.id}/devices/${d.id}`, ownerToken, { status: 'ACTIVE' });
    list = await call('GET', `/checkin/manage/events/${event.id}/devices`, ownerToken);
    assert.equal(list.body.data.devices.find((x) => x.id === d.id).status, 'ACTIVE');
  });

  await t.test('gates: offline exits sync; live load and per-gate report', async () => {
    const sync = await call('POST', '/checkin/sync', gateToken, { eventId: event.id, deviceId: 'gate-device-test-1', scans: [{ clientId: 'c1', code: tickets.std3.manualCode, gateId: ids.exit, gate: 'Exit North', direction: 'EXIT', scannedAt: new Date().toISOString(), localResult: 'GREEN' }] });
    assert.equal(sync.status, 200, sync.body?.message);
    assert.equal(sync.body.data.results[0].result, 'GREEN');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tickets.std3.id } })).isInside, false);

    const stats = await call('GET', `/checkin/events/${event.id}/stats`, ownerToken);
    const main = stats.body.data.gates.find((g) => g.gate === 'Main');
    assert.ok(main.last15 >= 3);
    assert.equal(main.overloaded, true, 'capacity 4/hour is exceeded');

    const report = await call('GET', `/checkin/manage/events/${event.id}/report`, ownerToken);
    const rMain = report.body.data.gates.find((g) => g.gate === 'Main');
    assert.ok(rMain.entries >= 2 && rMain.reentries === 2 && rMain.exceptions === 1 && rMain.reversed === 1, JSON.stringify(rMain));
    assert.equal(report.body.data.gates.find((g) => g.gate === 'VIP').turnedAway, 1);
    const csv = await call('GET', `/checkin/manage/events/${event.id}/report?format=csv`, ownerToken);
    assert.match(csv.body, /^Gate,Type,Entries/);
    assert.ok(await prisma.auditLog.findFirst({ where: { companyId: company.id, action: 'GATE_CHECKIN_REVERSED' } }));
  });
});
