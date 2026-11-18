// Scanner diagnostics and operational recovery: device health from heartbeats and the upload log, connection test,
// pending-scan manifests, supervisor actions delivered to the scanner, the operations dashboard, evidence review,
// and the gate operations reports.
// Runs the API in-process (with Socket.io) against the database with throwaway data removed at the end.
//   node --test test_gate_diagnostics.mjs
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
import { deviceHealth } from './src/services/gateDiagnosticsService.js';

const PASSWORD = 'Password@123';
process.env.GATE_DEVICE_AUTH = 'enforce';
process.env.GATE_DEVICE_AUTH_DEADLINE = '2999-01-01T00:00:00Z';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('unit: device health rules', () => {
  const now = Date.parse('2026-11-18T20:00:00Z');
  const fine = { status: 'ACTIVE', tokenHash: 'h', lastSeenAt: new Date(now - 10000), online: true, packAt: new Date(now - 60000), pendingScans: 0, failedScans: 0, stuckScans: 0, storagePersisted: true, clockSkewMs: 1000 };
  assert.deepEqual(deviceHealth(fine, { now }), { connection: 'ONLINE', health: 'HEALTHY', syncHealth: 'OK', reasons: [] });
  assert.equal(deviceHealth({ ...fine, pendingScans: 3 }, { now }).syncHealth, 'BEHIND');
  const att = deviceHealth({ ...fine, failedScans: 2, clockSkewMs: -7 * 60000, storagePersisted: false }, { now });
  assert.deepEqual([att.health, att.syncHealth], ['ATTENTION', 'FAILING']);
  assert.deepEqual(att.reasons.map((r) => r.code).sort(), ['CLOCK_SKEW', 'FAILED_SCANS', 'STORAGE_NOT_PERSISTENT']);
  assert.equal(deviceHealth({ ...fine, stuckScans: 1 }, { now }).health, 'CRITICAL');
  const lost = deviceHealth({ ...fine, pendingScans: 4, lastSeenAt: new Date(now - 11 * 60000) }, { now });
  assert.deepEqual([lost.connection, lost.health, lost.reasons[0].code], ['NOT_SEEN', 'CRITICAL', 'OFFLINE_WITH_SCANS']);
  assert.equal(deviceHealth({ ...fine, lastSeenAt: new Date(now - 11 * 60000) }, { now }).health, 'HEALTHY', 'away without scans is not a problem');
  assert.equal(deviceHealth({ ...fine, online: false }, { now }).connection, 'OFFLINE');
  assert.equal(deviceHealth({ ...fine, tokenHash: null }, { now, authMode: 'warn' }).health, 'ATTENTION');
  assert.equal(deviceHealth({ ...fine, tokenHash: null }, { now, authMode: 'enforce' }).health, 'CRITICAL');
  assert.equal(deviceHealth(fine, { now, openConflicts: 2 }).reasons[0].code, 'CONFLICTS');
  const rev = deviceHealth({ ...fine, status: 'REVOKED', pendingScans: 2 }, { now });
  assert.deepEqual([rev.health, rev.connection, rev.reasons[0].code], ['REVOKED', 'REVOKED', 'REVOKED_WITH_SCANS']);
});

test('Gate diagnostics and recovery', async (t) => {
  const server = http.createServer(app);
  const io = new Server(server);
  setIO(io);
  installSocketAuth(io);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = `${base}/api`;
  const run = `${Date.now()}`;
  const call = async (method, path, token, body, headers = {}) => {
    const res = await fetch(`${api}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = text;
    try { json = text ? JSON.parse(text) : null; } catch { /* csv */ }
    return { status: res.status, body: json };
  };
  const hash = await bcrypt.hash(PASSWORD, 10);
  const userIds = [];
  const account = async (n, role) => {
    const u = await prisma.user.create({ data: { name: `Diag ${n}`, email: `gdg_${n}_${run}@example.com`, passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };
  let company;
  let event;
  const sockets = [];
  t.after(async () => {
    for (const s of sockets) s.disconnect();
    if (event) {
      for (const m of ['gateSyncBatch', 'scanConflict', 'quarantinedScan', 'checkIn', 'staffEventAssignment']) await prisma[m].deleteMany({ where: { eventId: event.id } });
    }
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
    io.close();
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  const customer = await account('cust', 'CUSTOMER');
  const owner = await account('owner', 'ORGANIZER');
  const staff = await account('staff', 'GATE_STAFF');
  company = await prisma.company.create({ data: { userId: owner.id, companyName: `Diag Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  await prisma.user.updateMany({ where: { id: { in: [owner.id, staff.id] } }, data: { companyId: company.id } });
  await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: staff.id, role: 'GATE_STAFF' }] });
  event = await prisma.event.create({ data: { companyId: company.id, name: `Diag Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 86400000), time: '19:00', city: 'Lahore', venue: 'Hall' } });
  await prisma.staffEventAssignment.create({ data: { staffId: staff.id, eventId: event.id, assignedById: owner.id } });
  await prisma.eventGate.create({ data: { eventId: event.id, name: 'Main', type: 'ENTRY_EXIT', capacityPerHour: 600 } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 1000, totalQuantity: 20, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: event.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
  let n = 0;
  const ticket = async () => {
    const seat = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(++n), status: 'SOLD' } });
    return prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, seatId: seat.id, userId: customer.id, price: 1000, manualCode: `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` } });
  };
  const login = async (u) => (await call('POST', '/auth/login', null, { email: u.email, password: PASSWORD })).body.data.token;
  const tok = { owner: await login(owner), staff: await login(staff) };
  const ev = event.id;
  const enroll = async (name) => {
    const key = `gdg-${name}-${run}`;
    const r = await call('POST', '/checkin/devices/enroll', tok.staff, { eventId: ev, deviceId: key });
    assert.equal(r.status, 201, r.body?.message);
    return { key, token: r.body.data.token, id: r.body.data.device.id, seq: 0 };
  };
  const hdr = (d) => ({ 'X-Device-Token': d.token });
  const beat = (d, extra = {}) => call('POST', '/checkin/heartbeat', tok.staff, { eventId: ev, deviceId: d.key, gate: 'Main', pending: 0, packAt: new Date().toISOString(), ...extra }, hdr(d));
  const sync = (d, scans) => call('POST', '/checkin/sync', tok.staff, { eventId: ev, deviceId: d.key, scans }, hdr(d));
  const item = (d, code, extra = {}) => ({ clientId: crypto.randomUUID(), seq: ++d.seq, code, gate: 'Main', direction: 'ENTRY', scannedAt: new Date().toISOString(), localResult: 'GREEN', ...extra });
  const manage = (path, method = 'GET', body, token = tok.owner) => call(method, `/checkin/manage/events/${ev}${path}`, token, body);
  const listed = async (d) => (await manage('/devices')).body.data.devices.find((x) => x.id === d.id);

  const A = await enroll('A');
  const B = await enroll('B');
  const C = await enroll('C');
  // The scanner's own pack download (the ticket list is fresh)
  for (const d of [A, B, C]) await call('GET', `/checkin/events/${ev}/pack?deviceId=${d.key}`, tok.staff, null, hdr(d));

  await t.test('heartbeat diagnostics are stored and turned into health', async () => {
    const ahead = new Date(Date.now() + 8 * 60000).toISOString();
    const r = await beat(A, { pending: 3, failed: 2, conflicts: 1, stuck: 0, oldestPendingAt: new Date(Date.now() - 120000).toISOString(), lastScanAt: new Date().toISOString(), persisted: false, appVersion: 'web-2.0.0', clientTime: ahead, lastSyncError: 'No connection to the server' });
    assert.equal(r.status, 200, r.body?.message);
    const d = await prisma.gateDevice.findUnique({ where: { id: A.id } });
    assert.deepEqual([d.pendingScans, d.failedScans, d.deviceConflicts, d.appVersion, d.storagePersisted, d.lastSyncError], [3, 2, 1, 'web-2.0.0', false, 'No connection to the server']);
    assert.ok(d.clockSkewMs > 7 * 60000 && d.clockSkewMs < 9 * 60000, String(d.clockSkewMs));
    const l = await listed(A);
    assert.deepEqual([l.health, l.connection, l.syncHealth], ['ATTENTION', 'ONLINE', 'FAILING']);
    assert.ok(['FAILED_SCANS', 'CONFLICTS', 'SYNC_ERROR', 'STORAGE_NOT_PERSISTENT', 'CLOCK_SKEW'].every((c) => l.reasons.some((x) => x.code === c)), JSON.stringify(l.reasons));
    assert.ok(!('tokenHash' in l) && !('pendingManifest' in l));
    await beat(B, { failed: 0, stuck: 0, persisted: true, clientTime: new Date().toISOString() });
    assert.equal((await listed(B)).health, 'HEALTHY');
  });

  await t.test('stuck scans, and a device gone quiet with scans, are critical', async () => {
    await beat(C, { pending: 4, stuck: 2, persisted: true });
    assert.equal((await listed(C)).health, 'CRITICAL');
    await beat(C, { pending: 4, stuck: 0, persisted: true });
    await prisma.gateDevice.update({ where: { id: C.id }, data: { lastSeenAt: new Date(Date.now() - 12 * 60000) } });
    const l = await listed(C);
    assert.deepEqual([l.connection, l.health], ['NOT_SEEN', 'CRITICAL']);
    assert.match(l.reasons[0].message, /Not seen for 12 min with 4 scans/);
  });

  await t.test('every upload is logged; problems become the last sync error, a clean upload clears it', async () => {
    const [tk] = await Promise.all([ticket()]);
    const res = await sync(B, [item(B, tk.manualCode), { clientId: crypto.randomUUID(), seq: ++B.seq, code: 'x', scannedAt: 'now' }]);
    assert.equal(res.status, 200);
    const batches = await prisma.gateSyncBatch.findMany({ where: { deviceId: B.id }, orderBy: { createdAt: 'asc' } });
    assert.equal(batches.length, 1);
    assert.deepEqual([batches[0].kind, batches[0].received, batches[0].accepted, batches[0].rejected, batches[0].quarantined, batches[0].lastAckedSeq], ['SYNC', 2, 1, 1, 1, B.seq - 1]);
    assert.match((await prisma.gateDevice.findUnique({ where: { id: B.id } })).lastSyncError, /could not be read/);
    await sync(B, [item(B, (await ticket()).manualCode)]);
    assert.equal((await prisma.gateDevice.findUnique({ where: { id: B.id } })).lastSyncError, null);
    assert.equal(await prisma.gateSyncBatch.count({ where: { deviceId: B.id } }), 2);
  });

  await t.test('connection test (ping) is device-authenticated and reports server time and credential state', async () => {
    const r = await call('GET', `/checkin/ping?eventId=${ev}&deviceId=${B.key}`, tok.staff, null, hdr(B));
    assert.equal(r.status, 200, r.body?.message);
    assert.ok(Math.abs(Date.parse(r.body.data.serverTime) - Date.now()) < 5000);
    assert.deepEqual([r.body.data.device.enrolled, r.body.data.auth.via], [true, 'token']);
    assert.equal((await call('GET', `/checkin/ping?eventId=${ev}&deviceId=${B.key}`, tok.staff)).body.code, 'DEVICE_TOKEN_REQUIRED');
  });

  await t.test('a scanner reports its pending scans when asked; ticket codes are never stored', async () => {
    const scans = [{ scanId: 's1', seq: 7, state: 'FAILED', direction: 'ENTRY', gate: 'Main', deviceScannedAt: new Date().toISOString(), localResult: 'GREEN', attempts: 6, lastError: 'Invalid request', code: 'TL-SECR-ET00' }];
    const r = await call('POST', '/checkin/devices/manifest', tok.staff, { eventId: ev, deviceId: A.key, scans }, hdr(A));
    assert.deepEqual([r.status, r.body.data.stored], [200, 1]);
    const det = await manage(`/devices/${A.id}`);
    assert.equal(det.status, 200, det.body?.message);
    assert.equal(det.body.data.pendingScans.scans[0].seq, 7);
    assert.ok(!JSON.stringify(det.body).includes('TL-SECR-ET00'));
    assert.ok(!JSON.stringify(det.body).includes(A.key), 'device key not exposed');
  });

  await t.test('device details: health, history of uploads, recent errors, activity and actions', async () => {
    const d = (await manage(`/devices/${B.id}`)).body.data;
    assert.equal(d.syncHistory.length, 2);
    assert.equal(d.recentErrors.length, 1);
    assert.equal(d.activity.GREEN, 2);
    assert.ok(d.actions.some((a) => a.action === 'GATE_DEVICE_ENROLLED'));
    assert.equal((await manage(`/devices/${B.id}`, 'GET', null, tok.staff)).status, 403, 'gate staff cannot');
  });

  await t.test('supervisor actions reach the connected scanner and are audited; offline or revoked devices are reported', async () => {
    const s = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token: tok.staff } });
    sockets.push(s);
    await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
    const got = [];
    s.on('gate:device-action', (p) => got.push(p));
    await wait(100);
    for (const action of ['PING', 'SYNC', 'RETRY_FAILED', 'SEND_PENDING']) {
      const r = await manage(`/devices/${A.id}/actions`, 'POST', { action });
      assert.equal(r.status, 200, r.body?.message);
      assert.equal(r.body.data.delivered, true);
    }
    await wait(300);
    assert.deepEqual(got.map((g) => g.action), ['PING', 'SYNC', 'RETRY_FAILED', 'SEND_PENDING']);
    assert.ok(got.every((g) => g.deviceKey === A.key && g.eventId === ev && g.requestedBy === owner.name));
    assert.equal(await prisma.auditLog.count({ where: { action: 'GATE_DEVICE_ACTION_REQUESTED', targetId: A.id } }), 4);
    assert.equal((await manage(`/devices/${A.id}/actions`, 'POST', { action: 'WIPE' })).status, 400);
    assert.equal((await manage(`/devices/${A.id}/actions`, 'POST', { action: 'SYNC' }, tok.staff)).status, 403);
    s.disconnect();
    await wait(200);
    assert.equal((await manage(`/devices/${A.id}/actions`, 'POST', { action: 'SYNC' })).body.data.delivered, false);
    await manage(`/devices/${C.id}`, 'PATCH', { status: 'REVOKED', reason: 'Lost at the north gate' });
    assert.equal((await manage(`/devices/${C.id}/actions`, 'POST', { action: 'SYNC' })).status, 409);
  });

  await t.test('evidence from a revoked device is logged, listed and reviewed with a note; never admitted', async () => {
    const tk = await ticket();
    const ev1 = await call('POST', '/checkin/evidence', tok.staff, { eventId: ev, deviceId: C.key, scans: [item(C, tk.manualCode), item(C, tk.manualCode, { direction: 'EXIT' })] });
    assert.equal(ev1.status, 201, ev1.body?.message);
    assert.ok(!('device' in ev1.body.data), 'device row not returned');
    assert.equal((await prisma.gateSyncBatch.findFirst({ where: { deviceId: C.id, kind: 'EVIDENCE' } })).quarantined, 2);
    const list = await manage('/quarantine?status=PENDING_REVIEW');
    const mine = list.body.data.scans.filter((q) => q.deviceId === C.id);
    assert.equal(mine.length, 2);
    assert.ok(mine.every((q) => q.reason === 'DEVICE_REVOKED' && q.device && q.deviceKey.length === 6));
    assert.equal((await manage('/quarantine/review', 'POST', { ids: mine.map((q) => q.id), note: 'short' })).status, 400);
    const ok = await manage('/quarantine/review', 'POST', { ids: mine.map((q) => q.id), note: 'Phone was found; scans match the gate log' });
    assert.deepEqual([ok.status, ok.body.data.reviewed], [200, 2]);
    assert.equal((await manage('/quarantine/review', 'POST', { ids: mine.map((q) => q.id), note: 'Second review attempt here' })).status, 409);
    const log = await prisma.auditLog.findFirst({ where: { action: 'GATE_QUARANTINE_REVIEWED', companyId: company.id } });
    assert.equal(log.details.admitted, 0);
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).status, 'ACTIVE');
  });

  await t.test('operations dashboard: devices, uploads, conflicts, evidence, attendance and capacity', async () => {
    const tk = await ticket();
    await call('POST', '/checkin/scan', tok.staff, { eventId: ev, deviceId: B.key, code: tk.manualCode, gate: 'Main' }, hdr(B));
    await sync(A, [item(A, tk.manualCode)]); // A admitted it offline too: a conflict
    const r = await manage('/operations');
    assert.equal(r.status, 200, r.body?.message);
    const o = r.body.data;
    assert.deepEqual([o.devices.registered, o.devices.revoked], [2, 1]);
    assert.ok(o.devices.online >= 1 && o.devices.notSeen === 0, JSON.stringify(o.devices));
    assert.ok(o.devices.needingAttention >= 2, JSON.stringify(o.devices));
    assert.equal(o.scans.failed, 2);
    assert.ok(o.scans.failedUploadsLastHour >= 1);
    assert.equal(o.conflicts.open, 1);
    assert.equal(o.attendance.entered, 3);
    assert.equal(o.capacity.perHour, 600);
    assert.ok(o.attention.some((a) => a.id === A.id));
    assert.equal((await manage('/operations', 'GET', null, tok.staff)).status, 403);
  });

  await t.test('reports: device sync, device activity, failed scans and recovery history (JSON and CSV)', async () => {
    const sync24 = (await manage('/reports/device-sync')).body.data.rows;
    assert.equal(sync24.find((x) => x.deviceId === B.id).uploads24h, 2, 'two uploads (the online scan is not an upload)');
    const act = (await manage('/reports/device-activity')).body.data.rows;
    assert.ok(act.find((x) => x.deviceId === B.id).admitted >= 3);
    const failed = (await manage('/reports/failed-scans')).body.data.rows;
    assert.ok(failed.some((x) => x.source === 'Server quarantine' && x.reason === 'INVALID'));
    assert.ok(failed.some((x) => x.source === 'Held on device' && x.seq === 7));
    const hist = (await manage('/reports/recovery-history')).body.data.rows.map((x) => x.action);
    for (const a of ['GATE_DEVICE_REVOKED', 'GATE_DEVICE_ACTION_REQUESTED', 'GATE_SCANS_QUARANTINED', 'GATE_QUARANTINE_REVIEWED', 'GATE_CONFLICT_DETECTED', 'GATE_DEVICE_ENROLLED']) assert.ok(hist.includes(a), a);
    for (const [kind, head] of [['device-sync', /^device,status,enrolled,health/], ['device-activity', /^Device,Scans/], ['failed-scans', /^Source,Device/], ['recovery-history', /^At,Action,By/]]) {
      const csv = await manage(`/reports/${kind}?format=csv`);
      assert.equal(csv.status, 200);
      assert.match(csv.body, head, kind);
    }
    assert.equal((await manage('/reports/everything')).status, 400);
  });
});
