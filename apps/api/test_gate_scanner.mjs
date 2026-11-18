// MODULE 10 - Gate scanner validation through the supported check-in flow (POST /api/checkin/scan with an enrolled
// device). The old turnstile endpoint POST /api/gate/scan is retired (410): it admitted tickets without device
// authentication, gate rules or the re-entry policy. The rotating wallet QR (GET /api/gate/dynamic-qr) and the
// read-only gate stats / recent-scan routes are still served and covered here.
// Runs the API in-process against the database with throwaway data removed at the end.
//   node --test test_gate_scanner.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { signPass } from './src/services/qrPassService.js';
import { createDynamicQRPayload, verifyOfflineHMAC } from './src/services/qrTicketService.js';

const PASSWORD = 'Password@123';

test('MODULE 10 - Gate scanner validation (supported check-in flow)', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const run = `${Date.now()}`;
  const call = async (method, path, token, body, headers = {}) => {
    const res = await fetch(`${api}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const hash = await bcrypt.hash(PASSWORD, 10);
  const userIds = [];
  const account = async (n, role) => {
    const u = await prisma.user.create({ data: { name: `Scanner ${n}`, email: `gs_${n}_${run}@example.com`, passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };
  const login = async (u) => (await call('POST', '/auth/login', null, { email: u.email, password: PASSWORD })).body.data.token;

  const customer = await account('cust', 'CUSTOMER');
  const owner = await account('owner', 'ORGANIZER');
  const staff = await account('staff', 'GATE_STAFF');
  const company = await prisma.company.create({ data: { userId: owner.id, companyName: `Scanner Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  await prisma.user.updateMany({ where: { id: { in: [owner.id, staff.id] } }, data: { companyId: company.id } });
  await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: staff.id, role: 'GATE_STAFF' }] });
  const event = await prisma.event.create({ data: { companyId: company.id, name: `Scanner Event ${run}`, description: 'test', type: 'CRICKET_MATCH', status: 'PUBLISHED', date: new Date(Date.now() + 86400000), time: '19:00', city: 'Lahore', venue: 'Gaddafi Stadium' } });
  await prisma.staffEventAssignment.create({ data: { staffId: staff.id, eventId: event.id, assignedById: owner.id } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'First Class', price: 3000, totalQuantity: 2, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: event.id, totalAmount: 6000, status: 'SUCCESSFUL' } });
  const mk = async (n) => {
    const seat = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'Pavilion', row: 'A', seatNumber: String(n), status: 'SOLD' } });
    return prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, seatId: seat.id, userId: customer.id, price: 3000, manualCode: `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` }, include: { event: true, seat: { include: { tier: true } } } });
  };
  const ticket = await mk(1);
  const moved = await mk(2);

  const customerToken = await login(customer);
  const staffToken = await login(staff);
  const deviceId = `gs-device-${run}`;
  let deviceToken;
  const scan = (code, gate = 'Gate 3') => call('POST', '/checkin/scan', staffToken, { eventId: event.id, code, gate, deviceId }, { 'X-Device-Token': deviceToken });

  t.after(async () => {
    await prisma.gateDevice.deleteMany({ where: { companyId: company.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: company.id }, { userId: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
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

  let dynamicPayload;

  await t.test('1. Holder fetches the rotating wallet QR (30 s window)', async () => {
    const r = await call('GET', `/gate/dynamic-qr/${ticket.id}`, customerToken);
    assert.equal(r.status, 200);
    dynamicPayload = r.body.data.payload;
    assert.equal(dynamicPayload.ticketId, ticket.id);
    assert.ok(dynamicPayload.timeStep > 0);
    assert.ok(dynamicPayload.expiresAt > Date.now());
    assert.equal(r.body.data.windowSeconds, 30);
    assert.ok(r.body.data.qrCodeDataUrl.startsWith('data:image/png;base64,'));
    assert.equal(verifyOfflineHMAC(dynamicPayload).valid, true);
  });

  await t.test('2. The retired turnstile endpoint refuses to admit (410)', async () => {
    const r = await call('POST', '/gate/scan', staffToken, { payload: dynamicPayload, gateNumber: 'Gate 3' });
    assert.equal(r.status, 410);
    assert.equal(r.body.code, 'GATE_SCAN_RETIRED');
    assert.equal((await prisma.ticket.findUnique({ where: { id: ticket.id } })).status, 'ACTIVE');
  });

  await t.test('3. The scanner device enrolls and scans a valid signed pass: entry allowed, ticket SCANNED', async () => {
    const e = await call('POST', '/checkin/devices/enroll', staffToken, { eventId: event.id, deviceId });
    assert.equal(e.status, 201, e.body?.message);
    deviceToken = e.body.data.token;
    const r = await scan(signPass(ticket));
    assert.equal(r.status, 200, r.body?.message);
    assert.equal(r.body.data.result, 'GREEN');
    assert.equal(r.body.data.ticket.holderName, customer.name);
    assert.equal((await prisma.ticket.findUnique({ where: { id: ticket.id } })).status, 'SCANNED');
  });

  await t.test('4. Double entry is refused at another gate (yellow, first entry shown)', async () => {
    const r = await scan(signPass(ticket), 'Gate 1');
    assert.equal(r.body.data.result, 'YELLOW');
    assert.match(r.body.data.reason, /Already scanned/);
    assert.equal(r.body.data.firstScan.gate, 'Gate 3');
  });

  await t.test('5. An old QR (before a transfer) is refused', async () => {
    const oldPass = signPass(moved);
    await prisma.ticket.update({ where: { id: moved.id }, data: { qrVersion: { increment: 1 } } });
    const r = await scan(oldPass);
    assert.equal(r.body.data.result, 'RED');
    assert.match(r.body.data.reason, /Old QR/);
    assert.equal((await prisma.ticket.findUnique({ where: { id: moved.id } })).status, 'ACTIVE');
  });

  await t.test('6. A tampered pass signature is refused', async () => {
    const parts = signPass(moved).split('.');
    parts[4] = Buffer.alloc(64).toString('base64url');
    const r = await scan(parts.join('.'));
    assert.equal(r.body.data.result, 'RED');
    assert.equal((await prisma.ticket.findUnique({ where: { id: moved.id } })).status, 'ACTIVE');
  });

  await t.test('7. Entry statistics count admissions and refused double entries', async () => {
    const r = await call('GET', `/checkin/events/${event.id}/stats`, staffToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.entered, 1);
    assert.equal(r.body.data.scans.YELLOW, 1);
    assert.equal(r.body.data.scans.RED, 2);
    const legacy = await call('GET', `/gate/stats/${event.id}`, staffToken);
    assert.equal(legacy.status, 200, 'read-only legacy stats still served');
    assert.equal(legacy.body.data.admittedAttendees, 1);
  });

  await t.test('8. Gate staff see the recent scans feed', async () => {
    const r = await call('GET', `/checkin/events/${event.id}/recent?limit=10`, staffToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.scans.length, 4);
    assert.ok(r.body.data.scans.every((s) => s.gate && s.staff === staff.name));
  });
});
