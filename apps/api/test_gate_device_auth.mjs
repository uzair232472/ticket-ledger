// Gate device identity and socket access: server-issued device tokens (hash-only storage, rotation, reset,
// revocation), the GATE_DEVICE_AUTH migration modes and deadline, the retired /api/gate/scan route, and Socket.io
// room authorization (user rooms, event rooms, supervisor-only exception notices, eviction on access loss).
// Runs the API in-process against the database with throwaway data removed at the end.
//   node --test test_gate_device_auth.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { setIO } from './src/config/socket.js';
import { installSocketAuth } from './src/services/socketAccess.js';
import { dispatchNotification, NOTIFICATION_TYPES } from './src/services/notificationService.js';

const PASSWORD = 'Password@123';
const FUTURE = '2999-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';
const setMode = (mode, deadline = FUTURE) => {
  process.env.GATE_DEVICE_AUTH = mode;
  process.env.GATE_DEVICE_AUTH_DEADLINE = deadline;
};
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Gate device authentication and socket access', async (t) => {
  const savedEnv = { mode: process.env.GATE_DEVICE_AUTH, deadline: process.env.GATE_DEVICE_AUTH_DEADLINE };
  setMode('warn');
  const server = http.createServer(app);
  const io = new Server(server);
  setIO(io);
  installSocketAuth(io);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = `${base}/api`;
  const run = `${Date.now()}`;
  const mail = (n) => `gda_${n}_${run}@example.com`;
  const call = async (method, path, token, body, headers = {}) => {
    const res = await fetch(`${api}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = text;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
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
  const companies = [];
  const org = async (n) => {
    const owner = await account(`${n}owner`, 'ORGANIZER');
    const gate = await account(`${n}gate`, 'GATE_STAFF');
    const company = await prisma.company.create({ data: { userId: owner.id, companyName: `Device Org ${n} ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
    companies.push(company.id);
    await prisma.user.updateMany({ where: { id: { in: [owner.id, gate.id] } }, data: { companyId: company.id } });
    await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: gate.id, role: 'GATE_STAFF' }] });
    const event = await prisma.event.create({ data: { companyId: company.id, name: `Device Event ${n} ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 86400000), time: '19:00', city: 'Lahore', venue: 'Hall' } });
    await prisma.staffEventAssignment.create({ data: { staffId: gate.id, eventId: event.id, assignedById: owner.id } });
    return { owner, gate, company, event };
  };

  const A = await org('a');
  const B = await org('b');
  const customer = await account('cust');
  const other = await account('other');
  const tier = await prisma.ticketTier.create({ data: { eventId: A.event.id, name: 'Standard', price: 1000, totalQuantity: 10, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: A.event.id, totalAmount: 6000, status: 'SUCCESSFUL' } });
  const code = () => `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const tickets = [];
  for (let n = 1; n <= 6; n++) {
    const seat = await prisma.seat.create({ data: { eventId: A.event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(n), status: 'SOLD' } });
    tickets.push(await prisma.ticket.create({ data: { orderId: order.id, eventId: A.event.id, seatId: seat.id, userId: customer.id, price: 1000, manualCode: code() } }));
  }

  const tok = {
    aGate: await login(A.gate.email),
    aOwner: await login(A.owner.email),
    bGate: await login(B.gate.email),
    cust: await login(customer.email),
    other: await login(other.email),
  };

  const sockets = [];
  t.after(async () => {
    for (const s of sockets) s.disconnect();
    process.env.GATE_DEVICE_AUTH = savedEnv.mode;
    process.env.GATE_DEVICE_AUTH_DEADLINE = savedEnv.deadline;
    if (savedEnv.mode === undefined) delete process.env.GATE_DEVICE_AUTH;
    if (savedEnv.deadline === undefined) delete process.env.GATE_DEVICE_AUTH_DEADLINE;
    const eventIds = [A.event.id, B.event.id];
    await prisma.gateDevice.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.gateException.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: { in: companies } }, { userId: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.checkIn.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.gateScan.deleteMany({ where: { staffId: { in: userIds } } });
    await prisma.staffEventAssignment.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.event.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.organizationMember.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    io.close();
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  const ev = A.event.id;
  const dev = (key, token) => (token ? { 'X-Device-Token': token } : {});
  const enroll = (jwt, deviceId, current, eventId = ev) => call('POST', '/checkin/devices/enroll', jwt, { eventId, deviceId }, dev(null, current));
  const scan = (deviceId, token, codeText, extra = {}) => call('POST', '/checkin/scan', tok.aGate, { eventId: ev, code: codeText, deviceId, gate: 'Main', ...extra }, dev(deviceId, token));
  const sync = (deviceId, token, scans) => call('POST', '/checkin/sync', tok.aGate, { eventId: ev, deviceId, scans }, dev(deviceId, token));
  const pack = (deviceId, token) => call('GET', `/checkin/events/${ev}/pack?deviceId=${encodeURIComponent(deviceId)}`, tok.aGate, null, dev(deviceId, token));
  const beat = (deviceId, token) => call('POST', '/checkin/heartbeat', tok.aGate, { eventId: ev, deviceId, pending: 0 }, dev(deviceId, token));
  const row = (key, companyId = A.company.id) => prisma.gateDevice.findUnique({ where: { companyId_deviceKey: { companyId, deviceKey: key } } });
  const manage = (path, jwt = tok.aOwner, method = 'GET', body) => call(method, `/checkin/manage/events/${ev}${path}`, jwt, body);

  let tokenA;

  await t.test('enrollment issues a token and stores only its SHA-256', async () => {
    const r = await enroll(tok.aGate, 'gda-dev-A');
    assert.equal(r.status, 201, r.body?.message);
    tokenA = r.body.data.token;
    assert.match(tokenA, /^tld_[A-Za-z0-9_-]{40,}$/);
    assert.equal(r.body.data.companyId, A.company.id);
    const d = await row('gda-dev-A');
    assert.equal(d.tokenHash, sha256(tokenA));
    assert.ok(!JSON.stringify(d).includes(tokenA), 'raw token never stored');
    assert.equal(d.enrolledById, A.gate.id);
    assert.ok(await prisma.auditLog.findFirst({ where: { companyId: A.company.id, action: 'GATE_DEVICE_ENROLLED', targetId: d.id } }));
    // The devices list never exposes the hash
    const list = await manage('/devices');
    const listed = list.body.data.devices.find((x) => x.id === d.id);
    assert.equal(listed.enrolled, true);
    assert.ok(!JSON.stringify(list.body).includes(d.tokenHash));
  });

  await t.test('an enrolled device authenticates scan, sync, pack and heartbeat with its token', async () => {
    const h = await beat('gda-dev-A', tokenA);
    assert.equal(h.status, 200, h.body?.message);
    assert.equal(h.body.data.auth.via, 'token');
    assert.equal(h.body.data.device.enrolled, true);
    assert.equal((await pack('gda-dev-A', tokenA)).status, 200);
    const s = await scan('gda-dev-A', tokenA, tickets[0].manualCode);
    assert.equal(s.status, 200, s.body?.message);
    assert.equal(s.body.data.result, 'GREEN');
    const y = await sync('gda-dev-A', tokenA, [{ clientId: `c-${run}-1`, code: tickets[1].manualCode, gate: 'Main', direction: 'ENTRY', scannedAt: new Date().toISOString(), localResult: 'GREEN' }]);
    assert.equal(y.status, 200, y.body?.message);
    assert.equal(y.body.data.results[0].result, 'GREEN');
  });

  await t.test('every scanner endpoint requires a device id', async () => {
    const noDevice = { 'X-Device-Token': tokenA };
    const s = await call('POST', '/checkin/scan', tok.aGate, { eventId: ev, code: tickets[2].manualCode, gate: 'Main' }, noDevice);
    assert.equal(s.status, 400);
    assert.equal(s.body.code, 'DEVICE_REQUIRED');
    const y = await call('POST', '/checkin/sync', tok.aGate, { eventId: ev, scans: [{ code: tickets[2].manualCode, scannedAt: new Date().toISOString(), localResult: 'GREEN' }] }, noDevice);
    assert.equal(y.body.code, 'DEVICE_REQUIRED');
    const p = await call('GET', `/checkin/events/${ev}/pack`, tok.aGate, null, noDevice);
    assert.equal(p.body.code, 'DEVICE_REQUIRED');
    assert.equal((await call('POST', '/checkin/heartbeat', tok.aGate, { eventId: ev }, noDevice)).status, 400);
    assert.equal((await prisma.ticket.findUnique({ where: { id: tickets[2].id } })).status, 'ACTIVE', 'nothing admitted');
  });

  await t.test('an enrolled device without its token, or with a wrong one, is refused and counted', async () => {
    const before = (await row('gda-dev-A')).authFailures;
    const missing = await scan('gda-dev-A', null, tickets[2].manualCode);
    assert.equal(missing.status, 401);
    assert.equal(missing.body.code, 'DEVICE_TOKEN_REQUIRED');
    const wrong = await scan('gda-dev-A', `tld_${crypto.randomBytes(32).toString('base64url')}`, tickets[2].manualCode);
    assert.equal(wrong.body.code, 'DEVICE_TOKEN_INVALID');
    const garbage = await sync('gda-dev-A', 'not-a-token', [{ code: tickets[2].manualCode, scannedAt: new Date().toISOString(), localResult: 'GREEN' }]);
    assert.equal(garbage.body.code, 'DEVICE_TOKEN_INVALID');
    assert.equal((await pack('gda-dev-A', 'tld_short')).body.code, 'DEVICE_TOKEN_INVALID');
    assert.equal((await row('gda-dev-A')).authFailures, before + 4);
    assert.equal((await prisma.ticket.findUnique({ where: { id: tickets[2].id } })).status, 'ACTIVE', 'nothing admitted');
    // Logged, but at most once per 5 minutes per device
    assert.equal(await prisma.auditLog.count({ where: { companyId: A.company.id, action: 'GATE_DEVICE_AUTH_FAILED' } }), 1);
  });

  await t.test('re-enrolling needs the current token; rotation invalidates the old token', async () => {
    const taken = await enroll(tok.aGate, 'gda-dev-A');
    assert.equal(taken.status, 409);
    assert.equal(taken.body.code, 'DEVICE_ALREADY_ENROLLED');
    assert.equal(taken.body.companyId, A.company.id, 'lets the scanner find the token it holds');
    const rotated = await enroll(tok.aGate, 'gda-dev-A', tokenA);
    assert.equal(rotated.status, 201, rotated.body?.message);
    const old = tokenA;
    tokenA = rotated.body.data.token;
    assert.notEqual(tokenA, old);
    assert.equal((await beat('gda-dev-A', old)).body.code, 'DEVICE_TOKEN_INVALID');
    assert.equal((await beat('gda-dev-A', tokenA)).status, 200);
    assert.ok(await prisma.auditLog.findFirst({ where: { companyId: A.company.id, action: 'GATE_DEVICE_TOKEN_ROTATED' } }));
  });

  await t.test('concurrent enrollments of one new device: exactly one token is issued', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => enroll(tok.aGate, 'gda-dev-race')));
    const won = results.filter((r) => r.status === 201);
    assert.equal(won.length, 1, JSON.stringify(results.map((r) => [r.status, r.body?.code])));
    assert.ok(results.every((r) => r.status === 201 || r.status === 409));
    assert.equal((await row('gda-dev-race')).tokenHash, sha256(won[0].body.data.token));
  });

  await t.test('warn mode: a device that never enrolled still works and is counted until it enrolls', async () => {
    setMode('warn');
    const s = await scan('gda-dev-legacy', null, tickets[2].manualCode);
    assert.equal(s.status, 200, s.body?.message);
    assert.equal(s.body.data.result, 'GREEN');
    const h = await beat('gda-dev-legacy', null);
    assert.equal(h.body.data.auth.via, 'legacy');
    assert.equal(h.body.data.device.enrolled, false);
    const d = await row('gda-dev-legacy');
    assert.equal(d.legacyRequests, 2);
    assert.ok(d.lastLegacyAt);
    const e = await enroll(tok.aGate, 'gda-dev-legacy');
    assert.equal(e.status, 201);
    const log = await prisma.auditLog.findFirst({ where: { companyId: A.company.id, action: 'GATE_DEVICE_ENROLLED', targetId: d.id } });
    assert.equal(log.details.previouslyLegacy, true);
    // Once enrolled, the id alone is no longer enough
    assert.equal((await beat('gda-dev-legacy', null)).body.code, 'DEVICE_TOKEN_REQUIRED');
  });

  await t.test('enforce mode refuses devices that never enrolled; enrolled ones keep working', async () => {
    setMode('enforce');
    const r = await scan('gda-dev-new', null, tickets[3].manualCode);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'DEVICE_ENROLLMENT_REQUIRED');
    assert.equal(await row('gda-dev-new'), null, 'no device row is created without enrollment');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tickets[3].id } })).status, 'ACTIVE');
    assert.equal((await beat('gda-dev-A', tokenA)).status, 200);
    assert.equal((await enroll(tok.aGate, 'gda-dev-new')).status, 201, 'enrollment itself stays open');
  });

  await t.test('after the deadline, warn, off and unknown modes all behave as enforce', async () => {
    for (const mode of ['warn', 'off']) {
      setMode(mode, PAST);
      const r = await beat('gda-dev-late', null);
      assert.equal(r.body.code, 'DEVICE_ENROLLMENT_REQUIRED', mode);
    }
    setMode('sometimes');
    assert.equal((await beat('gda-dev-late', null)).body.code, 'DEVICE_ENROLLMENT_REQUIRED');
    const list = await manage('/devices');
    assert.equal(list.body.data.auth.mode, 'enforce');
    setMode('warn');
  });

  await t.test('off mode (rollback switch) ignores tokens but still needs a device id and refuses revoked devices', async () => {
    setMode('off');
    assert.equal((await beat('gda-dev-A', null)).status, 200, 'enrolled device works without its token');
    assert.equal((await beat('gda-dev-off', null)).status, 200);
    assert.equal((await call('POST', '/checkin/scan', tok.aGate, { eventId: ev, code: tickets[3].manualCode, gate: 'Main' })).body.code, 'DEVICE_REQUIRED');
    setMode('warn');
  });

  await t.test('revoking deletes the credential: the device cannot scan, upload, download or re-enroll', async () => {
    const d = await row('gda-dev-A');
    const r = await manage(`/devices/${d.id}`, tok.aOwner, 'PATCH', { status: 'REVOKED', reason: 'Phone lost' });
    assert.equal(r.status, 200, r.body?.message);
    assert.equal(r.body.data.device.tokenHash, undefined, 'no hash in responses');
    assert.equal((await row('gda-dev-A')).tokenHash, null);
    for (const res of [await scan('gda-dev-A', tokenA, tickets[3].manualCode), await sync('gda-dev-A', tokenA, [{ code: tickets[3].manualCode, scannedAt: new Date().toISOString(), localResult: 'GREEN' }]), await pack('gda-dev-A', tokenA), await beat('gda-dev-A', tokenA), await enroll(tok.aGate, 'gda-dev-A', tokenA)]) {
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'DEVICE_REVOKED');
    }
    setMode('off');
    assert.equal((await beat('gda-dev-A', null)).body.code, 'DEVICE_REVOKED', 'also with device auth switched off');
    setMode('warn');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tickets[3].id } })).status, 'ACTIVE');
    const log = await prisma.auditLog.findFirst({ where: { companyId: A.company.id, action: 'GATE_DEVICE_REVOKED', targetId: d.id } });
    assert.equal(log.details.credentialInvalidated, true);
    // Restored: it enrolls afresh (the old token stays dead)
    await manage(`/devices/${d.id}`, tok.aOwner, 'PATCH', { status: 'ACTIVE' });
    assert.equal((await beat('gda-dev-A', tokenA)).body.code, 'DEVICE_TOKEN_INVALID');
    const again = await enroll(tok.aGate, 'gda-dev-A');
    assert.equal(again.status, 201);
    tokenA = again.body.data.token;
  });

  await t.test('supervisors reset an enrollment with a reason; gate staff cannot', async () => {
    const d = await row('gda-dev-A');
    assert.equal((await manage(`/devices/${d.id}`, tok.aGate, 'PATCH', { resetEnrollment: true, reason: 'cleared data' })).status, 403);
    assert.equal((await manage(`/devices/${d.id}`, tok.aOwner, 'PATCH', { resetEnrollment: true })).status, 400, 'reason required');
    const r = await manage(`/devices/${d.id}`, tok.aOwner, 'PATCH', { resetEnrollment: true, reason: 'Browser data was cleared' });
    assert.equal(r.status, 200, r.body?.message);
    assert.equal(r.body.data.device.enrolled, false);
    assert.ok(await prisma.auditLog.findFirst({ where: { companyId: A.company.id, action: 'GATE_DEVICE_ENROLLMENT_RESET', targetId: d.id } }));
    assert.equal((await beat('gda-dev-A', tokenA)).body.code, 'DEVICE_TOKEN_INVALID');
    const again = await enroll(tok.aGate, 'gda-dev-A');
    assert.equal(again.status, 201);
    tokenA = again.body.data.token;
  });

  await t.test("a token only works for its own device and organization", async () => {
    const b = await enroll(tok.bGate, 'gda-dev-B', null, B.event.id);
    assert.equal(b.status, 201);
    const bBeat = (deviceId, token) => call('POST', '/checkin/heartbeat', tok.bGate, { eventId: B.event.id, deviceId }, dev(deviceId, token));
    assert.equal((await bBeat('gda-dev-B', b.body.data.token)).status, 200);
    assert.equal((await bBeat('gda-dev-B', tokenA)).body.code, 'DEVICE_TOKEN_INVALID', "A's token on B's device");
    assert.equal((await bBeat('gda-dev-A', tokenA)).body.code, 'DEVICE_TOKEN_INVALID', "A's device id + token at B's event");
    assert.equal((await beat('gda-dev-race', tokenA)).body.code, 'DEVICE_TOKEN_INVALID', 'token of another device of the same org');
    // Staff of another organization can't enroll for this event
    assert.equal((await enroll(tok.bGate, 'gda-dev-B', null, ev)).status, 403);
  });

  await t.test('the retired POST /api/gate/scan answers 410 and admits nothing', async () => {
    const { createDynamicQRPayload } = await import('./src/services/qrTicketService.js');
    const t4 = await prisma.ticket.findUnique({ where: { id: tickets[4].id }, include: { event: true, seat: { include: { tier: true } } } });
    const r = await call('POST', '/gate/scan', tok.aGate, { payload: createDynamicQRPayload(t4), gateNumber: 'Main' });
    assert.equal(r.status, 410);
    assert.equal(r.body.code, 'GATE_SCAN_RETIRED');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tickets[4].id } })).status, 'ACTIVE');
  });

  // ── Sockets ──────────────────────────────────────────────────────────────────────────────────────────

  const connect = async (token) => {
    const s = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false, auth: token ? { token } : {} });
    sockets.push(s);
    await new Promise((resolve, reject) => {
      s.once('connect', resolve);
      s.once('connect_error', reject);
    });
    return s;
  };
  const ask = (s, event, arg) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 3000);
    s.emit(event, arg, (res) => { clearTimeout(timer); resolve(res); });
  });
  // Collects what a socket receives, to assert both deliveries and non-deliveries
  const inbox = (s, ...events) => {
    const got = Object.fromEntries(events.map((e) => [e, []]));
    for (const e of events) s.on(e, (p) => got[e].push(p));
    return got;
  };

  await t.test('sockets: anonymous and invalid-token connections only get public broadcasts', async () => {
    const anon = await connect(null);
    assert.equal((await ask(anon, 'join_user_room', customer.id)).ok, false);
    const r = await ask(anon, 'join_event_room', ev);
    assert.deepEqual([r.ok, r.reason], [false, 'SIGN_IN_REQUIRED']);
    const bad = await connect('not.a.jwt');
    assert.equal((await ask(bad, 'join_user_room', customer.id)).ok, false);
  });

  await t.test("sockets: users join only their own room; notifications reach only that user", async () => {
    const mine = await connect(tok.cust);
    const theirs = await connect(tok.other);
    assert.equal((await ask(theirs, 'join_user_room', customer.id)).ok, false, "can't join someone else's room");
    assert.equal((await ask(mine, 'join_user_room', customer.id)).ok, true);
    const anon = await connect(null);
    const boxes = [inbox(mine, 'notification', `notification_${customer.id}`), inbox(theirs, 'notification', `notification_${customer.id}`), inbox(anon, 'notification', `notification_${customer.id}`)];
    await dispatchNotification({ userId: customer.id, type: Object.values(NOTIFICATION_TYPES)[0], title: `Private ${run}`, message: 'For the customer only', sendEmail: false, sendPush: false });
    await wait(300);
    assert.equal(boxes[0].notification.length, 1);
    assert.equal(boxes[0][`notification_${customer.id}`].length, 1, 'older event name, same room');
    for (const b of boxes.slice(1)) assert.equal(b.notification.length + b[`notification_${customer.id}`].length, 0, 'no leak to other sockets');
    assert.equal((await ask(mine, 'join_event_room', ev)).reason, 'NO_EVENT_ACCESS');
  });

  await t.test('sockets: event rooms need gate access; exception requests reach supervisors only; access loss evicts', async () => {
    const staff = await connect(tok.aGate);
    const sup = await connect(tok.aOwner);
    const outsider = await connect(tok.bGate);
    const s1 = await ask(staff, 'join_event_room', ev);
    assert.deepEqual([s1.ok, s1.supervise], [true, false]);
    const s2 = await ask(sup, 'join_event_room', ev);
    assert.deepEqual([s2.ok, s2.supervise], [true, true]);
    assert.equal((await ask(outsider, 'join_event_room', ev)).reason, 'NO_EVENT_ACCESS');
    const boxes = { staff: inbox(staff, 'gate:exception', 'checkin:stats'), sup: inbox(sup, 'gate:exception', 'checkin:stats'), outsider: inbox(outsider, 'gate:exception', 'checkin:stats') };

    const ex = await call('POST', '/checkin/exceptions', tok.aGate, { eventId: ev, code: tickets[0].manualCode, gate: 'Main', scanResult: 'YELLOW: Already scanned', reason: 'Guest shows matching ID', deviceId: 'gda-dev-A' }, dev('gda-dev-A', tokenA));
    assert.equal(ex.status, 201, ex.body?.message);
    const live = await scan('gda-dev-A', tokenA, tickets[5].manualCode);
    assert.equal(live.body.data.result, 'GREEN');
    await wait(400);
    assert.equal(boxes.sup['gate:exception'].length, 1);
    assert.equal(boxes.staff['gate:exception'].length, 0, 'gate staff do not receive exception requests');
    assert.ok(boxes.staff['checkin:stats'].length >= 1 && boxes.sup['checkin:stats'].length >= 1);
    assert.equal(boxes.outsider['gate:exception'].length + boxes.outsider['checkin:stats'].length, 0);

    // The staff member loses the event: their sockets leave its room at once and can't join again
    const off = await call('DELETE', `/staff/${A.gate.id}/events/${ev}`, tok.aOwner);
    assert.equal(off.status, 200, off.body?.message);
    await wait(200);
    const n = boxes.staff['checkin:stats'].length;
    await call('POST', '/checkin/scan', tok.aOwner, { eventId: ev, code: tickets[5].manualCode, gate: 'Main', direction: 'EXIT', deviceId: 'gda-dev-owner' });
    await wait(400);
    assert.equal(boxes.staff['checkin:stats'].length, n, 'evicted from the event room');
    assert.ok(boxes.sup['checkin:stats'].length >= 2, 'supervisor still receives');
    assert.equal((await ask(staff, 'join_event_room', ev)).reason, 'NO_EVENT_ACCESS');
  });
});
