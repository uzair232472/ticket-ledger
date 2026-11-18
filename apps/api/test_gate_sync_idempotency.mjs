// Idempotent gate synchronization: scan ids processed once per device (repeated, interrupted and simultaneous
// uploads), per-scan acknowledgements and partial batches, sequence ordering and device clocks, quarantine of
// unreadable scans and of evidence from revoked devices, reversible GateScan history, race-free exception
// decisions, and a large offline queue.
// Runs the API in-process against the database with throwaway data removed at the end.
//   node --test test_gate_sync_idempotency.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';

const PASSWORD = 'Password@123';
process.env.GATE_DEVICE_AUTH = 'enforce';
process.env.GATE_DEVICE_AUTH_DEADLINE = '2999-01-01T00:00:00Z';

test('Idempotent gate synchronization', async (t) => {
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
    const u = await prisma.user.create({ data: { name: `Idem ${n}`, email: `gsi_${n}_${run}@example.com`, passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };
  let company;
  let event;
  t.after(async () => {
    if (event) {
      await prisma.quarantinedScan.deleteMany({ where: { eventId: event.id } });
      await prisma.scanConflict.deleteMany({ where: { eventId: event.id } });
      await prisma.gateException.deleteMany({ where: { eventId: event.id } });
      await prisma.checkIn.deleteMany({ where: { eventId: event.id } });
      await prisma.staffEventAssignment.deleteMany({ where: { eventId: event.id } });
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
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  const customer = await account('cust', 'CUSTOMER');
  const owner = await account('owner', 'ORGANIZER');
  const staff = await account('staff', 'GATE_STAFF');
  const leaver = await account('leaver', 'GATE_STAFF');
  const stranger = await account('stranger', 'CUSTOMER');
  company = await prisma.company.create({ data: { userId: owner.id, companyName: `Idem Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  await prisma.user.updateMany({ where: { id: { in: [owner.id, staff.id, leaver.id] } }, data: { companyId: company.id } });
  await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: staff.id, role: 'GATE_STAFF' }, { companyId: company.id, userId: leaver.id, role: 'GATE_STAFF' }] });
  event = await prisma.event.create({ data: { companyId: company.id, name: `Idem Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 86400000), time: '19:00', city: 'Lahore', venue: 'Hall' } });
  await prisma.staffEventAssignment.createMany({ data: [{ staffId: staff.id, eventId: event.id, assignedById: owner.id }, { staffId: leaver.id, eventId: event.id, assignedById: owner.id }] });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 1000, totalQuantity: 200, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: event.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
  const code = () => `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  let seatNo = 0;
  const mkTicket = async () => {
    const seat = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(++seatNo), status: 'SOLD' } });
    return prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, seatId: seat.id, userId: customer.id, price: 1000, manualCode: code() } });
  };
  const tickets = async (n) => Promise.all(Array.from({ length: n }, mkTicket));

  const tok = {
    staff: (await call('POST', '/auth/login', null, { email: staff.email, password: PASSWORD })).body.data.token,
    owner: (await call('POST', '/auth/login', null, { email: owner.email, password: PASSWORD })).body.data.token,
    leaver: (await call('POST', '/auth/login', null, { email: leaver.email, password: PASSWORD })).body.data.token,
    stranger: (await call('POST', '/auth/login', null, { email: stranger.email, password: PASSWORD })).body.data.token,
  };
  const devices = {};
  const enroll = async (name, jwt = tok.staff) => {
    const key = `gsi-${name}-${run}`;
    const r = await call('POST', '/checkin/devices/enroll', jwt, { eventId: event.id, deviceId: key });
    assert.equal(r.status, 201, r.body?.message);
    devices[name] = { key, token: r.body.data.token, id: r.body.data.device.id, seq: 0, jwt };
    return devices[name];
  };
  const sync = (d, scans) => call('POST', '/checkin/sync', d.jwt, { eventId: event.id, deviceId: d.key, scans }, { 'X-Device-Token': d.token });
  const online = (d, codeText, extra = {}) => call('POST', '/checkin/scan', d.jwt, { eventId: event.id, deviceId: d.key, code: codeText, gate: 'Main', ...extra }, { 'X-Device-Token': d.token });
  const item = (d, ticket, extra = {}) => ({ clientId: crypto.randomUUID(), seq: ++d.seq, code: ticket.manualCode || ticket, gate: 'Main', direction: 'ENTRY', scannedAt: new Date().toISOString(), localResult: 'GREEN', localReason: 'Entry allowed', ...extra });
  const checkIns = (where) => prisma.checkIn.findMany({ where: { eventId: event.id, ...where } });

  const A = await enroll('A');
  const B = await enroll('B');

  await t.test('the same scan uploaded twice is processed once; the repeat gets the first result', async () => {
    const [tk] = await tickets(1);
    const s = item(A, tk);
    const first = await sync(A, [s]);
    assert.equal(first.status, 200, first.body?.message);
    assert.deepEqual([first.body.data.results[0].status, first.body.data.results[0].result], ['ACCEPTED', 'GREEN']);
    const again = await sync(A, [s]);
    const r = again.body.data.results[0];
    assert.deepEqual([r.status, r.result, r.clientId, r.conflict], ['ALREADY_PROCESSED', 'GREEN', s.clientId, false]);
    assert.equal(r.checkInId, first.body.data.results[0].checkInId);
    assert.equal((await checkIns({ ticketId: tk.id })).length, 1);
    assert.equal(await prisma.gateScan.count({ where: { ticketId: tk.id } }), 1);
    const t1 = await prisma.ticket.findUnique({ where: { id: tk.id } });
    assert.deepEqual([t1.status, t1.entryCount], ['SCANNED', 1]);
    const row = (await checkIns({ ticketId: tk.id }))[0];
    assert.deepEqual([row.clientScanId, row.deviceRecordId, row.deviceSeq, row.localResult], [s.clientId, A.id, s.seq, 'GREEN']);
  });

  await t.test('an interrupted upload resumes safely: what was processed is acknowledged, the rest is processed', async () => {
    const tks = await tickets(6);
    const batch = tks.map((tk) => item(A, tk));
    await sync(A, batch.slice(0, 3)); // the connection dropped after the server processed these
    const resumed = await sync(A, batch);
    const st = Object.fromEntries(resumed.body.data.results.map((r) => [r.clientId, r.status]));
    assert.deepEqual(batch.map((s) => st[s.clientId]), ['ALREADY_PROCESSED', 'ALREADY_PROCESSED', 'ALREADY_PROCESSED', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    assert.equal(resumed.body.data.lastAckedSeq, batch[5].seq);
    assert.equal((await prisma.gateDevice.findUnique({ where: { id: A.id } })).lastSeqAcked, batch[5].seq);
    for (const tk of tks) assert.equal((await checkIns({ ticketId: tk.id })).length, 1);
  });

  await t.test('simultaneous uploads of the same scans admit each ticket once', async () => {
    const tks = await tickets(15);
    const batch = tks.map((tk) => item(A, tk));
    const responses = await Promise.all(Array.from({ length: 5 }, () => sync(A, batch)));
    assert.ok(responses.every((r) => r.status === 200), JSON.stringify(responses.map((r) => r.status)));
    for (const r of responses) assert.equal(r.body.data.results.length, batch.length, 'every request acknowledges every scan');
    const accepted = responses.flatMap((r) => r.body.data.results).filter((x) => x.status === 'ACCEPTED');
    assert.equal(accepted.length, batch.length, 'each scan accepted exactly once across all requests');
    for (const tk of tks) {
      assert.equal((await checkIns({ ticketId: tk.id })).length, 1, 'one check-in per scan');
      const t1 = await prisma.ticket.findUnique({ where: { id: tk.id } });
      assert.equal(t1.entryCount, 1);
    }
    assert.ok(responses.flatMap((r) => r.body.data.results).every((x) => x.result === 'GREEN' && !x.conflict), 'no false duplicate-admission conflicts');
  });

  await t.test('two devices syncing at the same time: separate scans, one admission, the second flagged', async () => {
    const [tk] = await tickets(1);
    const [ra, rb] = await Promise.all([sync(A, [item(A, tk)]), sync(B, [item(B, tk)])]);
    const both = [ra.body.data.results[0], rb.body.data.results[0]];
    assert.deepEqual(both.map((r) => r.status), ['ACCEPTED', 'ACCEPTED'], 'different devices: different scans');
    assert.equal(both.filter((r) => r.result === 'GREEN').length, 1);
    assert.equal(both.filter((r) => r.conflict).length, 1);
    assert.equal((await checkIns({ ticketId: tk.id })).length, 2, 'both scan events preserved');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).entryCount, 1, 'attendance counted once');
  });

  await t.test('the same scan id from another device is a different scan, not a repeat', async () => {
    const [tk] = await tickets(1);
    const s = item(A, tk);
    await sync(A, [s]);
    const fromB = await sync(B, [{ ...s, seq: ++B.seq }]);
    assert.equal(fromB.body.data.results[0].status, 'ACCEPTED');
    assert.equal(fromB.body.data.results[0].conflict, true);
    assert.equal((await checkIns({ ticketId: tk.id })).length, 2);
  });

  await t.test('an online scan whose response was lost: the retry and the offline record get the first result', async () => {
    const [tk] = await tickets(1);
    const scanId = crypto.randomUUID();
    const first = await online(A, tk.manualCode, { clientScanId: scanId });
    assert.equal(first.body.data.result, 'GREEN');
    const retry = await online(A, tk.manualCode, { clientScanId: scanId });
    assert.deepEqual([retry.body.data.result, retry.body.data.replayed, retry.body.data.checkInId], ['GREEN', true, first.body.data.checkInId]);
    const fallback = await sync(A, [item(A, tk, { clientId: scanId })]);
    const r = fallback.body.data.results[0];
    assert.deepEqual([r.status, r.result, r.conflict], ['ALREADY_PROCESSED', 'GREEN', false], 'no false duplicate admission');
    assert.equal((await checkIns({ ticketId: tk.id })).length, 1);
    assert.equal(await prisma.gateScan.count({ where: { ticketId: tk.id } }), 1);
  });

  await t.test('partial batch: an unreadable scan is rejected and quarantined; the others are processed', async () => {
    const tks = await tickets(2);
    const bad = { clientId: crypto.randomUUID(), seq: ++A.seq, code: 'x', scannedAt: 'yesterday-ish', localResult: 'GREEN' };
    const batch = [item(A, tks[0]), bad, item(A, tks[1]), 'not even an object'];
    const res = await sync(A, batch);
    assert.equal(res.status, 200, res.body?.message);
    const st = res.body.data.results.map((r) => r.status);
    assert.equal(st.filter((x) => x === 'ACCEPTED').length, 2);
    assert.equal(st.filter((x) => x === 'REJECTED').length, 2);
    assert.equal(res.body.data.rejected, 2);
    const q = await prisma.quarantinedScan.findMany({ where: { eventId: event.id, reason: 'INVALID' } });
    assert.equal(q.length, 2);
    assert.ok(q.find((x) => x.clientScanId === bad.clientId).payload.code === 'x', 'kept exactly as submitted');
    assert.equal((await sync(A, [bad])).body.data.results[0].status, 'REJECTED');
    assert.equal(await prisma.quarantinedScan.count({ where: { eventId: event.id, reason: 'INVALID' } }), 2, 'resending stores nothing new');
  });

  await t.test('the device sequence decides the order, not the device clock', async () => {
    await prisma.event.update({ where: { id: event.id }, data: { reentryPolicy: 'UNLIMITED' } });
    const [tk] = await tickets(1);
    const later = new Date(Date.now() - 60000).toISOString();
    const earlier = new Date(Date.now() - 120000).toISOString();
    // The clock went backwards between the entry (seq n) and the exit (seq n+1)
    const entry = item(A, tk, { scannedAt: later });
    const exit = item(A, tk, { direction: 'EXIT', scannedAt: earlier, localReason: 'Exit recorded' });
    const res = await sync(A, [exit, entry]);
    const byId = Object.fromEntries(res.body.data.results.map((r) => [r.clientId, r]));
    assert.equal(byId[entry.clientId].result, 'GREEN');
    assert.equal(byId[exit.clientId].result, 'GREEN', 'exit processed after the entry');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).isInside, false);
  });

  await t.test('device clocks are evidence: a future time is not trusted, and a recorded check-in is never rewritten', async () => {
    const [tk, tk2] = await tickets(2);
    const future = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const before = Date.now();
    await sync(A, [item(A, tk, { scannedAt: future })]);
    const row = (await checkIns({ ticketId: tk.id }))[0];
    assert.equal(row.deviceScannedAt, future, 'device reading kept as sent');
    assert.ok(row.scannedAt.getTime() <= Date.now() && row.scannedAt.getTime() >= before - 1000, 'record time is the receipt time');

    const live = await online(B, tk2.manualCode);
    assert.equal(live.body.data.result, 'GREEN');
    const recorded = (await prisma.ticket.findUnique({ where: { id: tk2.id } })).checkedInAt;
    const off = await sync(A, [item(A, tk2, { scannedAt: new Date(Date.now() - 3600 * 1000).toISOString() })]);
    assert.equal(off.body.data.results[0].conflict, true);
    const after = await prisma.ticket.findUnique({ where: { id: tk2.id } });
    assert.equal(after.checkedInAt.getTime(), recorded.getTime(), 'the earlier device time does not take over the check-in');
    assert.equal(after.entryCount, 1);
  });

  await t.test('revoked devices hand in their scans as evidence: quarantined, never admitted', async () => {
    const R = await enroll('R');
    const [tk] = await tickets(1);
    await call('PATCH', `/checkin/manage/events/${event.id}/devices/${R.id}`, tok.owner, { status: 'REVOKED', reason: 'Lost at gate 2' });
    const held = [item(R, tk), item(R, tk, { direction: 'EXIT' })];
    assert.equal((await sync(R, held)).status, 403, 'no upload as admissions');
    const ev = await call('POST', '/checkin/evidence', tok.staff, { eventId: event.id, deviceId: R.key, scans: held });
    assert.equal(ev.status, 201, ev.body?.message);
    assert.deepEqual([ev.body.data.reason, ev.body.data.stored], ['DEVICE_REVOKED', 2]);
    assert.ok(ev.body.data.results.every((r) => r.status === 'QUARANTINED'));
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).status, 'ACTIVE');
    assert.equal((await checkIns({ ticketId: tk.id })).length, 0);
    assert.equal((await call('POST', '/checkin/evidence', tok.staff, { eventId: event.id, deviceId: R.key, scans: held })).body.data.stored, 0, 'idempotent');
    assert.ok(await prisma.auditLog.findFirst({ where: { companyId: company.id, action: 'GATE_SCANS_QUARANTINED' } }));
    assert.equal((await call('POST', '/checkin/evidence', tok.stranger, { eventId: event.id, deviceId: R.key, scans: held })).status, 403, 'unrelated account');
    assert.equal((await call('POST', '/checkin/evidence', tok.staff, { eventId: event.id, deviceId: A.key, scans: held })).body.code, 'USE_SYNC', 'a working device syncs normally');
  });

  await t.test('staff who lost the event hand in what their device holds (ACCESS_REMOVED)', async () => {
    const L = await enroll('L', tok.leaver);
    const [tk] = await tickets(1);
    await call('DELETE', `/staff/${leaver.id}/events/${event.id}`, tok.owner);
    const held = [item(L, tk)];
    assert.equal((await sync(L, held)).status, 403);
    const ev = await call('POST', '/checkin/evidence', tok.leaver, { eventId: event.id, deviceId: L.key, scans: held });
    assert.equal(ev.status, 201, ev.body?.message);
    assert.equal(ev.body.data.reason, 'ACCESS_REMOVED');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).status, 'ACTIVE');
  });

  await t.test('reversal keeps the GateScan history and takes it out of the admitted count', async () => {
    const [tk] = await tickets(1);
    const s = await online(A, tk.manualCode);
    const before = (await call('GET', `/gate/stats/${event.id}`, tok.owner)).body.data.admittedAttendees;
    const rev = await call('POST', `/checkin/manage/events/${event.id}/checkins/${s.body.data.checkInId}/reverse`, tok.owner, { reason: 'Scanned the wrong phone' });
    assert.equal(rev.status, 200, rev.body?.message);
    const rows = await prisma.gateScan.findMany({ where: { ticketId: tk.id } });
    assert.equal(rows.length, 1, 'not deleted');
    assert.ok(rows[0].reversedAt);
    assert.deepEqual([rows[0].reversedById, rows[0].reversalReason, rows[0].checkInId], [owner.id, 'Scanned the wrong phone', s.body.data.checkInId]);
    const stats = await call('GET', `/gate/stats/${event.id}`, tok.owner);
    assert.equal(stats.body.data.admittedAttendees, before - 1);
    assert.equal(stats.body.data.audit.validEntries, before - 1, 'reversed admission not counted');
  });

  await t.test('two supervisors approving one exception at once: one admission', async () => {
    const [tk] = await tickets(1);
    const ex = await call('POST', '/checkin/exceptions', tok.staff, { eventId: event.id, code: tk.manualCode, gate: 'Main', scanResult: 'RED: test', reason: 'Guest shows matching ID', deviceId: A.key }, { 'X-Device-Token': A.token });
    assert.equal(ex.status, 201, ex.body?.message);
    const decide = () => call('POST', `/checkin/manage/events/${event.id}/exceptions/${ex.body.data.exception.id}/decide`, tok.owner, { approve: true, note: 'ID checked at the desk' });
    const answers = await Promise.all([decide(), decide(), decide()]);
    assert.equal(answers.filter((a) => a.status === 200).length, 1, JSON.stringify(answers.map((a) => [a.status, a.body?.message])));
    assert.ok(answers.filter((a) => a.status !== 200).every((a) => a.status === 409));
    assert.equal((await checkIns({ ticketId: tk.id, exceptionId: { not: null } })).length, 1);
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).entryCount, 1);
  });

  await t.test('a large offline queue (1,000 scans in batches of 200) syncs with one record per scan, twice', async () => {
    const tks = await tickets(40);
    const L1 = await enroll('big');
    const scans = Array.from({ length: 1000 }, (_, i) => (i < 40 ? item(L1, tks[i]) : item(L1, 'TL-0000-0000', { localResult: 'RED', localReason: 'No ticket has this code' })));
    const started = Date.now();
    for (const pass of [1, 2]) {
      for (let i = 0; i < scans.length; i += 200) {
        const r = await sync(L1, scans.slice(i, i + 200));
        assert.equal(r.status, 200, r.body?.message);
        assert.equal(r.body.data.results.length, 200);
        assert.ok(r.body.data.results.every((x) => x.status === (pass === 1 ? 'ACCEPTED' : 'ALREADY_PROCESSED')), `pass ${pass}`);
      }
    }
    assert.equal(await prisma.checkIn.count({ where: { deviceRecordId: L1.id } }), 1000);
    assert.equal(await prisma.ticket.count({ where: { id: { in: tks.map((x) => x.id) }, status: 'SCANNED', entryCount: 1 } }), 40);
    assert.equal((await prisma.gateDevice.findUnique({ where: { id: L1.id } })).lastSeqAcked, 1000);
    t.diagnostic(`1,000 scans uploaded twice in ${Date.now() - started} ms`);
  });
});
