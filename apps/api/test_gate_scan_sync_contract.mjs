// Contract between the scanner's offline scan store (apps/web/src/lib/gateScanModel.js) and POST /api/checkin/sync:
// the upload items the scanner builds are accepted, every scan is acknowledged by its scan id, and the scanner's
// acknowledgement rules turn the real response into the right sync states. Also the upload limits the scanner
// checks before sending match what the server refuses.
// Runs the API in-process against the database with throwaway data removed at the end.
//   node --test test_gate_scan_sync_contract.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import * as M from '../web/src/lib/gateScanModel.js';

const PASSWORD = 'Password@123';

test('Scanner scan store ↔ /api/checkin/sync contract', async (t) => {
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
    const u = await prisma.user.create({ data: { name: `Contract ${n}`, email: `gsc_${n}_${run}@example.com`, passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };
  let company;
  let event;
  t.after(async () => {
    if (company) {
      await prisma.gateDevice.deleteMany({ where: { companyId: company.id } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: company.id }, { userId: { in: userIds } }] } });
    }
    if (event) {
      await prisma.quarantinedScan.deleteMany({ where: { eventId: event.id } });
      await prisma.scanConflict.deleteMany({ where: { eventId: event.id } });
      await prisma.checkIn.deleteMany({ where: { eventId: event.id } });
      await prisma.staffEventAssignment.deleteMany({ where: { eventId: event.id } });
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
  company = await prisma.company.create({ data: { userId: owner.id, companyName: `Contract Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  await prisma.user.updateMany({ where: { id: { in: [owner.id, staff.id] } }, data: { companyId: company.id } });
  await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: staff.id, role: 'GATE_STAFF' }] });
  event = await prisma.event.create({ data: { companyId: company.id, name: `Contract Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 86400000), time: '19:00', city: 'Lahore', venue: 'Hall' } });
  await prisma.staffEventAssignment.create({ data: { staffId: staff.id, eventId: event.id, assignedById: owner.id } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 1000, totalQuantity: 250, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: event.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
  const code = () => `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const mk = async (n) => {
    const seat = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(n), status: 'SOLD' } });
    return prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, seatId: seat.id, userId: customer.id, price: 1000, manualCode: code() } });
  };
  const [fresh, used] = [await mk(1), await mk(2)];
  await prisma.ticket.update({ where: { id: used.id }, data: { status: 'SCANNED', checkedInAt: new Date(Date.now() - 60000), gate: 'Gate B', isInside: true, entryCount: 1 } });

  const token = (await call('POST', '/auth/login', null, { email: staff.email, password: PASSWORD })).body.data.token;
  const deviceId = `gsc-device-${run}`;
  const enrolled = await call('POST', '/checkin/devices/enroll', token, { eventId: event.id, deviceId });
  assert.equal(enrolled.status, 201, enrolled.body?.message);
  const sync = (scans) => call('POST', '/checkin/sync', token, { eventId: event.id, deviceId, pending: scans.length, scans }, { 'X-Device-Token': enrolled.body.data.token });
  let seq = 0;
  const offline = (c, localResult = 'GREEN', extra = {}) => ({ ...M.newScanRecord({ seq: ++seq, deviceId, eventId: event.id, code: c, gate: 'Gate A', direction: 'ENTRY', localResult, localReason: 'decided on the device', recordedBy: staff.id }), syncState: 'UPLOADING', ...extra });

  await t.test('every uploaded scan is acknowledged by its scan id and lands in the right state', async () => {
    const batch = [offline(fresh.manualCode), offline('TL-ZZZZ-ZZZZ', 'RED'), offline(used.manualCode)];
    assert.ok(batch.every((r) => M.uploadProblem(r) === null));
    const res = await sync(batch.map(M.toUploadItem));
    assert.equal(res.status, 200, res.body?.message);
    const results = res.body.data.results;
    assert.deepEqual(results.map((r) => r.clientId).sort(), batch.map((r) => r.scanId).sort(), 'one acknowledgement per scan id');
    const out = M.applyAcks(batch, results);
    assert.deepEqual(out.map((r) => r.syncState), ['SYNCED', 'SYNCED', 'CONFLICT']);
    assert.equal(out[0].server.result, 'GREEN');
    assert.equal(out[1].server.result, 'RED');
    assert.equal(out[2].server.conflict, true, 'admitted offline but already used: flagged');
    assert.equal((await prisma.ticket.findUnique({ where: { id: fresh.id } })).status, 'SCANNED');
  });

  await t.test('a full batch (BATCH_SIZE scans) is accepted in one request', async () => {
    const batch = Array.from({ length: M.BATCH_SIZE }, () => offline('TL-QQQQ-QQQQ', 'RED'));
    const res = await sync(batch.map(M.toUploadItem));
    assert.equal(res.status, 200, res.body?.message);
    assert.equal(M.applyAcks(batch, res.body.data.results).filter((r) => r.syncState === 'SYNCED').length, M.BATCH_SIZE);
  });

  await t.test('what the scanner refuses to send, the server rejects per scan (kept for review), without failing the batch', async () => {
    const short = offline('abc');
    const fine = offline('TL-QQQQ-QQQQ', 'RED');
    assert.ok(M.uploadProblem(short));
    const res = await sync([M.toUploadItem(short), M.toUploadItem(fine)]);
    assert.equal(res.status, 200, res.body?.message);
    const out = M.applyAcks([short, fine], res.body.data.results);
    assert.deepEqual(out.map((r) => r.syncState), ['FAILED', 'SYNCED']);
    assert.equal(out[0].server.status, 'REJECTED');
    assert.match(out[0].lastError, /kept for review/);
    assert.equal(await prisma.quarantinedScan.count({ where: { eventId: event.id, clientScanId: short.scanId } }), 1);
  });

  await t.test('a repeated upload is acknowledged as already processed and stays SYNCED / CONFLICT', async () => {
    const [again] = [offline(fresh.manualCode)];
    const first = M.applyAcks([again], (await sync([M.toUploadItem(again)])).body.data.results);
    const second = M.applyAcks([again], (await sync([M.toUploadItem(again)])).body.data.results);
    assert.equal(second[0].server.status, 'ALREADY_PROCESSED');
    assert.equal(second[0].syncState, first[0].syncState);
  });
});
