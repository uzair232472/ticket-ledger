// Gate security checks (Phase 7): signed scan records (tamper evidence) and the client/server canonical text,
// signing-key registration, rotation and revocation, offline gate permissions, suspicious upload logging, and a
// server failure on one scan in the middle of a batch (RETRY, then processed once).
// Runs the API in-process against the database with throwaway data removed at the end.
//   node --test test_gate_security.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { canonicalScan as serverCanonical } from './src/services/scanSignature.js';
import * as M from '../web/src/lib/gateScanModel.js';

const PASSWORD = 'Password@123';
process.env.GATE_DEVICE_AUTH = 'enforce';
process.env.GATE_DEVICE_AUTH_DEADLINE = '2999-01-01T00:00:00Z';
const subtle = globalThis.crypto.subtle;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** A scanner's signing key as the browser makes it (non-extractable private key, exportable public JWK). */
async function deviceKeyPair() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const j = await subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y } };
}
const signRecord = async (pair, record) => b64url(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(M.canonicalScan(record))));

test('unit: the scanner and the server build the same canonical text for every upload', () => {
  const cases = [
    { gate: 'Main', gateId: 'g1', direction: 'EXIT', localResult: 'YELLOW' },
    { gate: null, gateId: null, direction: 'ENTRY', localResult: 'GREEN' },
    { gate: 'VIP | North', gateId: 'g|2', direction: 'ENTRY', localResult: 'RED' },
  ];
  for (const c of cases) {
    const r = M.newScanRecord({ seq: 42, deviceId: 'd', eventId: 'event-1', code: 'TL1.a.b.1.sig', ...c });
    assert.equal(serverCanonical('event-1', JSON.parse(JSON.stringify(M.toUploadItem(r)))), M.canonicalScan(r));
  }
});

test('Gate security', async (t) => {
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
    const u = await prisma.user.create({ data: { name: `Sec ${n}`, email: `gsec_${n}_${run}@example.com`, passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };
  let company;
  let event;
  t.after(async () => {
    if (event) for (const m of ['gateSyncBatch', 'scanConflict', 'quarantinedScan', 'checkIn', 'staffEventAssignment', 'gateAssignment', 'eventGate']) await prisma[m].deleteMany({ where: { eventId: event.id } });
    if (company) {
      await prisma.gateDevice.deleteMany({ where: { companyId: company.id } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: company.id }, { userId: { in: userIds } }] } });
    }
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gateScan.deleteMany({ where: { staffId: { in: userIds } } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    if (company) {
      await prisma.event.deleteMany({ where: { companyId: company.id } });
      await prisma.organizationMember.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  const customer = await account('cust', 'CUSTOMER');
  const owner = await account('owner', 'ORGANIZER');
  const staff = await account('staff', 'GATE_STAFF');
  company = await prisma.company.create({ data: { userId: owner.id, companyName: `Sec Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  await prisma.user.updateMany({ where: { id: { in: [owner.id, staff.id] } }, data: { companyId: company.id } });
  await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: staff.id, role: 'GATE_STAFF' }] });
  event = await prisma.event.create({ data: { companyId: company.id, name: `Sec Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 86400000), time: '19:00', city: 'Lahore', venue: 'Hall' } });
  await prisma.staffEventAssignment.create({ data: { staffId: staff.id, eventId: event.id, assignedById: owner.id } });
  const north = await prisma.eventGate.create({ data: { eventId: event.id, name: 'North', type: 'ENTRY_EXIT' } });
  const south = await prisma.eventGate.create({ data: { eventId: event.id, name: 'South', type: 'ENTRY_EXIT' } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 1000, totalQuantity: 50, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: event.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
  let n = 0;
  const ticket = async () => {
    const seat = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(++n), status: 'SOLD' } });
    return prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, seatId: seat.id, userId: customer.id, price: 1000, manualCode: `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` } });
  };
  const login = async (u) => (await call('POST', '/auth/login', null, { email: u.email, password: PASSWORD })).body.data.token;
  const tok = { owner: await login(owner), staff: await login(staff) };
  const ev = event.id;
  const enroll = async (name, { jwt = tok.staff, signingKey, current } = {}) => {
    const key = `gsec-${name}-${run}`;
    return { key, r: await call('POST', '/checkin/devices/enroll', jwt, { eventId: ev, deviceId: key, ...(signingKey ? { signingKey } : {}) }, current ? { 'X-Device-Token': current } : {}) };
  };
  const device = async (name, opts = {}) => {
    const kp = opts.unsigned ? null : await deviceKeyPair();
    const { key, r } = await enroll(name, { ...opts, signingKey: kp?.jwk });
    assert.equal(r.status, 201, r.body?.message);
    return { key, token: r.body.data.token, id: r.body.data.device.id, kp, seq: 0, jwt: opts.jwt || tok.staff };
  };
  const record = (d, code, extra = {}) => M.newScanRecord({ seq: ++d.seq, deviceId: d.key, eventId: ev, code, gate: 'North', gateId: north.id, direction: 'ENTRY', localResult: 'GREEN', localReason: 'Entry allowed', ...extra });
  const signed = async (d, r) => ({ ...M.toUploadItem(r), sig: await signRecord(d.kp.pair, r) });
  const sync = (d, scans) => call('POST', '/checkin/sync', d.jwt, { eventId: ev, deviceId: d.key, scans }, { 'X-Device-Token': d.token });
  const suspicious = (d) => prisma.auditLog.findMany({ where: { action: 'GATE_SYNC_SUSPICIOUS', targetId: d.id } });

  await t.test('enrollment stores only a valid public signing key', async () => {
    const d = await device('A');
    const row = await prisma.gateDevice.findUnique({ where: { id: d.id } });
    assert.deepEqual(Object.keys(row.signingKey).sort(), ['crv', 'kty', 'x', 'y']);
    assert.ok(row.signingKeyAt);
    const priv = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const withD = await subtle.exportKey('jwk', priv.privateKey);
    assert.equal((await enroll('B1', { signingKey: { kty: 'EC', crv: 'P-256', x: withD.x, y: withD.y, d: withD.d } })).r.status, 400, 'a private key is refused');
    assert.equal((await enroll('B2', { signingKey: { kty: 'EC', crv: 'P-256', x: 'AAAA', y: 'BBBB' } })).r.body.code, 'BAD_SIGNING_KEY');
    assert.equal((await enroll('B3', { signingKey: { kty: 'RSA', n: 'x', e: 'AQAB' } })).r.status, 400);
  });

  await t.test('signed scans are accepted and marked as signed', async () => {
    const d = await device('S');
    const tk = await ticket();
    const res = await sync(d, [await signed(d, record(d, tk.manualCode))]);
    assert.equal(res.body.data.results[0].status, 'ACCEPTED', JSON.stringify(res.body));
    const row = await prisma.checkIn.findFirst({ where: { ticketId: tk.id } });
    assert.equal(row.deviceSigned, true);
    assert.equal((await suspicious(d)).length, 0);
  });

  await t.test('a record changed after it was signed is quarantined as TAMPERED, never processed, and flagged', async () => {
    const d = await device('T');
    const [t1, t2] = [await ticket(), await ticket()];
    const turnedAway = record(d, t1.manualCode, { localResult: 'RED', localReason: 'Not valid' });
    const item = await signed(d, turnedAway);
    const forged = { ...item, localResult: 'GREEN', localReason: 'Entry allowed' }; // someone edits the stored verdict
    const otherCode = { ...(await signed(d, record(d, t2.manualCode))), code: t1.manualCode }; // or swaps the code
    const res = await sync(d, [forged, otherCode]);
    assert.ok(res.body.data.results.every((r) => r.status === 'REJECTED' && /changed after it was made/.test(r.reason)), JSON.stringify(res.body.data.results));
    assert.equal(await prisma.quarantinedScan.count({ where: { deviceId: d.id, reason: 'TAMPERED' } }), 2);
    assert.equal(await prisma.checkIn.count({ where: { ticketId: { in: [t1.id, t2.id] } } }), 0);
    assert.equal((await prisma.ticket.findUnique({ where: { id: t1.id } })).status, 'ACTIVE');
    const flags = await suspicious(d);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].details.tampered, 2);
  });

  await t.test('unsigned scans from a signing device are accepted but reported; a device without a key is not flagged', async () => {
    const d = await device('U');
    const res = await sync(d, [M.toUploadItem(record(d, (await ticket()).manualCode))]);
    assert.equal(res.body.data.results[0].status, 'ACCEPTED');
    assert.equal((await prisma.checkIn.findFirst({ where: { deviceRecordId: d.id } })).deviceSigned, false);
    assert.equal((await suspicious(d))[0].details.unsigned, 1);
    const plain = await device('P', { unsigned: true });
    await sync(plain, [M.toUploadItem(record(plain, (await ticket()).manualCode))]);
    assert.equal((await suspicious(plain)).length, 0, 'older scanners without a key are not suspicious');
  });

  await t.test('rotating the key with the current token replaces it; revocation and reset delete it', async () => {
    const d = await device('R');
    const next = await deviceKeyPair();
    const rot = await enroll('R', { signingKey: next.jwk, current: d.token });
    assert.equal(rot.r.status, 201, rot.r.body?.message);
    const old = d.kp;
    d.token = rot.r.body.data.token;
    const r1 = record(d, (await ticket()).manualCode);
    const stale = await sync(d, [{ ...M.toUploadItem(r1), sig: await signRecord(old.pair, r1) }]);
    assert.equal(stale.body.data.results[0].status, 'REJECTED', 'old key no longer valid');
    d.kp = next;
    assert.equal((await sync(d, [await signed(d, record(d, (await ticket()).manualCode))])).body.data.results[0].status, 'ACCEPTED');
    await call('PATCH', `/checkin/manage/events/${ev}/devices/${d.id}`, tok.owner, { resetEnrollment: true, reason: 'Phone reset by IT' });
    const row = await prisma.gateDevice.findUnique({ where: { id: d.id } });
    assert.deepEqual([row.tokenHash, row.signingKey], [null, null]);
    const r2 = await device('V');
    await call('PATCH', `/checkin/manage/events/${ev}/devices/${r2.id}`, tok.owner, { status: 'REVOKED', reason: 'Lost' });
    assert.equal((await prisma.gateDevice.findUnique({ where: { id: r2.id } })).signingKey, null);
  });

  await t.test('offline scans respect gate assignments: not admitted at another gate, flagged for a supervisor', async () => {
    await call('PUT', `/checkin/manage/events/${ev}/staff/${staff.id}/gates`, tok.owner, { gateIds: [north.id] });
    const d = await device('G');
    const tk = await ticket();
    const res = await sync(d, [await signed(d, record(d, tk.manualCode, { gate: 'South', gateId: south.id }))]);
    const r = res.body.data.results[0];
    assert.deepEqual([r.status, r.result, r.conflictType], ['ACCEPTED', 'RED', 'RULE_MISMATCH']);
    assert.match(r.reason, /not assigned/);
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).status, 'ACTIVE');
    assert.equal((await sync(d, [await signed(d, record(d, tk.manualCode))])).body.data.results[0].result, 'GREEN', 'at the assigned gate');
    // Supervisors may scan at any gate
    const sup = await device('Gs', { jwt: tok.owner });
    const tk2 = await ticket();
    assert.equal((await sync(sup, [await signed(sup, record(sup, tk2.manualCode, { gate: 'South', gateId: south.id }))])).body.data.results[0].result, 'GREEN');
    await call('PUT', `/checkin/manage/events/${ev}/staff/${staff.id}/gates`, tok.owner, { gateIds: [] });
  });

  await t.test('new scans numbered below the acknowledged sequence are reported (storage replaced or edited)', async () => {
    const d = await device('Q');
    d.seq = 50;
    await sync(d, [await signed(d, record(d, (await ticket()).manualCode))]);
    d.seq = 0;
    const tks = await Promise.all(Array.from({ length: 5 }, ticket));
    const res = await sync(d, await Promise.all(tks.map(async (tk) => signed(d, record(d, tk.manualCode)))));
    assert.ok(res.body.data.results.every((r) => r.status === 'ACCEPTED'));
    const flags = await suspicious(d);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].details.regressions, 5);
  });

  await t.test('a server failure on one scan of a batch: that scan RETRY, the others processed; the retry is processed once', async () => {
    const d = await device('F');
    const tks = await Promise.all(Array.from({ length: 3 }, ticket));
    const batch = await Promise.all(tks.map(async (tk) => signed(d, record(d, tk.manualCode))));
    const original = prisma.$transaction;
    let calls = 0;
    prisma.$transaction = function patched(arg, ...rest) {
      if (typeof arg === 'function' && ++calls === 2) return Promise.reject(new Error('simulated database outage'));
      return original.call(this, arg, ...rest);
    };
    let first;
    try {
      first = await sync(d, batch);
    } finally {
      prisma.$transaction = original;
    }
    assert.equal(first.status, 200, first.body?.message);
    assert.deepEqual(first.body.data.results.map((r) => r.status), ['ACCEPTED', 'RETRY', 'ACCEPTED']);
    assert.equal(await prisma.checkIn.count({ where: { ticketId: tks[1].id } }), 0, 'the failed scan rolled back completely');
    const out = M.applyAcks(batch.map((b) => ({ ...M.newScanRecord({ scanId: b.clientId, seq: b.seq, code: b.code, eventId: ev }), syncState: 'UPLOADING' })), first.body.data.results);
    assert.deepEqual(out.map((r) => r.syncState), ['SYNCED', 'PENDING', 'SYNCED'], 'the scanner keeps the failed one for retry');
    const second = await sync(d, batch);
    assert.deepEqual(second.body.data.results.map((r) => r.status), ['ALREADY_PROCESSED', 'ACCEPTED', 'ALREADY_PROCESSED']);
    for (const tk of tks) assert.equal(await prisma.checkIn.count({ where: { ticketId: tk.id } }), 1);
    const log = await prisma.gateSyncBatch.findMany({ where: { deviceId: d.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(log.map((b) => b.retry), [1, 0]);
  });
});
