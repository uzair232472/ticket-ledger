// Multi-device offline conflicts: detection (duplicate admission across devices, invalidated tickets, exit ordering,
// re-entry limits), preserved evidence, no automatic winner and no ticket change, supervisor review and audited
// resolution with a mandatory reason, idempotent re-uploads, access control and CSV export.
// Runs the API in-process against the database with throwaway data removed at the end.
//   node --test test_gate_conflicts.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { signPass } from './src/services/qrPassService.js';

const PASSWORD = 'Password@123';
process.env.GATE_DEVICE_AUTH = 'enforce';
process.env.GATE_DEVICE_AUTH_DEADLINE = '2999-01-01T00:00:00Z';

test('Offline scan conflicts', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
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
  const companies = [];
  const events = [];
  const account = async (n, role) => {
    const u = await prisma.user.create({ data: { name: `Conflict ${n}`, email: `gcf_${n}_${run}@example.com`, passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };
  t.after(async () => {
    await prisma.scanConflict.deleteMany({ where: { eventId: { in: events } } });
    await prisma.quarantinedScan.deleteMany({ where: { eventId: { in: events } } });
    await prisma.checkIn.deleteMany({ where: { eventId: { in: events } } });
    await prisma.staffEventAssignment.deleteMany({ where: { eventId: { in: events } } });
    await prisma.gateDevice.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: { in: companies } }, { userId: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gateScan.deleteMany({ where: { staffId: { in: userIds } } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.event.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.organizationMember.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  const org = async (n) => {
    const owner = await account(`${n}owner`, 'ORGANIZER');
    const staff = await account(`${n}staff`, 'GATE_STAFF');
    const company = await prisma.company.create({ data: { userId: owner.id, companyName: `Conflict Org ${n} ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
    companies.push(company.id);
    await prisma.user.updateMany({ where: { id: { in: [owner.id, staff.id] } }, data: { companyId: company.id } });
    await prisma.organizationMember.createMany({ data: [{ companyId: company.id, userId: owner.id, role: 'OWNER' }, { companyId: company.id, userId: staff.id, role: 'GATE_STAFF' }] });
    const event = await prisma.event.create({ data: { companyId: company.id, name: `Conflict Event ${n} ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 3600000), startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 4 * 3600000), time: '19:00' /* event day: gates are open (eventTiming.js) */, city: 'Lahore', venue: 'Hall' } });
    events.push(event.id);
    await prisma.staffEventAssignment.create({ data: { staffId: staff.id, eventId: event.id, assignedById: owner.id } });
    const login = async (u) => (await call('POST', '/auth/login', null, { email: u.email, password: PASSWORD })).body.data.token;
    return { owner, staff, company, event, ownerToken: await login(owner), staffToken: await login(staff) };
  };
  const O = await org('a');
  const X = await org('x'); // another organization
  const customer = await account('cust', 'CUSTOMER');
  const tier = await prisma.ticketTier.create({ data: { eventId: O.event.id, name: 'Standard', price: 1000, totalQuantity: 50, availableQuantity: 0 } });
  const order = await prisma.order.create({ data: { userId: customer.id, eventId: O.event.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
  let n = 0;
  const ticket = async () => {
    const seat = await prisma.seat.create({ data: { eventId: O.event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(++n), status: 'SOLD' } });
    return prisma.ticket.create({ data: { orderId: order.id, eventId: O.event.id, seatId: seat.id, userId: customer.id, price: 1000, manualCode: `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` } });
  };

  const ev = O.event.id;
  const device = async (name) => {
    const key = `gcf-${name}-${run}`;
    const r = await call('POST', '/checkin/devices/enroll', O.staffToken, { eventId: ev, deviceId: key });
    assert.equal(r.status, 201, r.body?.message);
    return { key, token: r.body.data.token, id: r.body.data.device.id, seq: 0 };
  };
  const [A, B, C] = [await device('A'), await device('B'), await device('C')];
  const scanItem = (d, code, extra = {}) => ({ clientId: crypto.randomUUID(), seq: ++d.seq, code, gate: `Gate ${d === A ? 'A' : d === B ? 'B' : 'C'}`, direction: 'ENTRY', scannedAt: new Date(Date.now() - 600000).toISOString(), localResult: 'GREEN', localReason: 'Entry allowed', ...extra });
  const sync = (d, scans) => call('POST', '/checkin/sync', O.staffToken, { eventId: ev, deviceId: d.key, scans }, { 'X-Device-Token': d.token });
  const online = (d, code, extra = {}) => call('POST', '/checkin/scan', O.staffToken, { eventId: ev, deviceId: d.key, code, gate: 'Main', ...extra }, { 'X-Device-Token': d.token });
  const manage = (path, token = O.ownerToken, method = 'GET', body) => call(method, `/checkin/manage/events/${ev}${path}`, token, body);
  const conflictsOf = (ticketId) => prisma.scanConflict.findMany({ where: { eventId: ev, ticketId }, orderBy: { createdAt: 'asc' } });
  const snapshot = async (id) => {
    const x = await prisma.ticket.findUnique({ where: { id } });
    return { status: x.status, checkedInAt: x.checkedInAt?.toISOString() || null, gate: x.gate, isInside: x.isInside, entryCount: x.entryCount, lastExitAt: x.lastExitAt?.toISOString() || null, qrVersion: x.qrVersion };
  };

  let dup;
  let dupTicket;

  await t.test('two devices admit one ticket offline: both scans kept, attendance once, a DUPLICATE_ADMISSION conflict', async () => {
    dupTicket = await ticket();
    const ra = await sync(A, [scanItem(A, dupTicket.manualCode)]);
    const rb = await sync(B, [scanItem(B, dupTicket.manualCode)]);
    assert.deepEqual([ra.body.data.results[0].result, ra.body.data.results[0].conflict], ['GREEN', false]);
    const b = rb.body.data.results[0];
    assert.deepEqual([b.status, b.result, b.conflict, b.conflictType], ['ACCEPTED', 'YELLOW', true, 'DUPLICATE_ADMISSION']);
    const list = await conflictsOf(dupTicket.id);
    assert.equal(list.length, 1);
    dup = list[0];
    assert.equal(b.conflictId, dup.id);
    assert.deepEqual([dup.status, dup.type, dup.resolution], ['OPEN', 'DUPLICATE_ADMISSION', null], 'no automatic winner');
    const scans = await prisma.checkIn.findMany({ where: { conflictId: dup.id }, orderBy: { scannedAt: 'asc' } });
    assert.equal(scans.length, 2, 'the earlier admission and the conflicting scan');
    assert.deepEqual(scans.map((s) => s.deviceRecordId).sort(), [A.id, B.id].sort());
    assert.equal(dup.evidence.priorAdmission.checkInId, ra.body.data.results[0].checkInId);
    assert.equal(dup.evidence.priorAdmission.deviceRecordId, A.id);
    assert.equal(dup.evidence.device.result, 'GREEN');
    assert.equal(dup.evidence.server.code, 'ALREADY_USED');
    assert.equal((await prisma.ticket.findUnique({ where: { id: dupTicket.id } })).entryCount, 1, 'duplicate attendance prevented');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'GATE_CONFLICT_DETECTED', targetId: dup.id } }));
  });

  await t.test('a third device joins the open conflict instead of opening another', async () => {
    const r = await sync(C, [scanItem(C, dupTicket.manualCode)]);
    assert.equal(r.body.data.results[0].conflictId, dup.id);
    assert.equal((await conflictsOf(dupTicket.id)).length, 1);
    assert.equal(await prisma.checkIn.count({ where: { conflictId: dup.id } }), 3);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'GATE_CONFLICT_SCAN_ADDED', targetId: dup.id } }));
  });

  await t.test('re-uploading a conflicting scan is a repeat: no new scan, no new conflict', async () => {
    const tk = await ticket();
    await online(A, tk.manualCode);
    const s = scanItem(B, tk.manualCode);
    await sync(B, [s]);
    const again = await sync(B, [s]);
    assert.deepEqual([again.body.data.results[0].status, again.body.data.results[0].conflict], ['ALREADY_PROCESSED', true]);
    assert.equal((await conflictsOf(tk.id)).length, 1);
    assert.equal(await prisma.checkIn.count({ where: { ticketId: tk.id } }), 2);
  });

  await t.test('a ticket refunded before the offline scan synced: TICKET_INVALIDATED, the ticket stays refunded', async () => {
    const tk = await ticket();
    await prisma.ticket.update({ where: { id: tk.id }, data: { status: 'CANCELLED' } });
    const before = await snapshot(tk.id);
    const r = await sync(A, [scanItem(A, tk.manualCode)]);
    assert.deepEqual([r.body.data.results[0].result, r.body.data.results[0].conflictType], ['RED', 'TICKET_INVALIDATED']);
    assert.match(r.body.data.results[0].reason, /Admitted offline, but the ticket is not valid/);
    assert.deepEqual(await snapshot(tk.id), before, 'server state not overwritten');
    assert.equal((await conflictsOf(tk.id))[0].evidence.ticketAtDetection.status, 'CANCELLED');
  });

  await t.test('a ticket transferred before sync (old QR admitted offline): TICKET_INVALIDATED', async () => {
    const tk = await ticket();
    const oldPass = signPass(tk);
    await prisma.ticket.update({ where: { id: tk.id }, data: { qrVersion: { increment: 1 } } });
    const r = await sync(A, [scanItem(A, oldPass)]);
    assert.equal(r.body.data.results[0].conflictType, 'TICKET_INVALIDATED');
    assert.equal((await conflictsOf(tk.id))[0].evidence.server.code, 'OLD_QR');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).status, 'ACTIVE');
  });

  await t.test('an offline exit the server cannot place: ORDERING, presence unchanged', async () => {
    const tk = await ticket();
    const r = await sync(A, [scanItem(A, tk.manualCode, { direction: 'EXIT', localReason: 'Exit recorded' })]);
    assert.equal(r.body.data.results[0].conflictType, 'ORDERING');
    const t1 = await prisma.ticket.findUnique({ where: { id: tk.id } });
    assert.deepEqual([t1.status, t1.isInside], ['ACTIVE', false]);
    const tk2 = await ticket();
    await online(A, tk2.manualCode);
    await online(A, tk2.manualCode, { direction: 'EXIT' });
    const r2 = await sync(B, [scanItem(B, tk2.manualCode, { direction: 'EXIT', localReason: 'Exit recorded' })]);
    assert.equal(r2.body.data.results[0].conflictType, 'ORDERING', 'already outside');
  });

  await t.test('re-admitted offline beyond the re-entry policy: REENTRY_LIMIT', async () => {
    const tk = await ticket();
    await online(A, tk.manualCode);
    await online(A, tk.manualCode, { direction: 'EXIT' });
    const r = await sync(B, [scanItem(B, tk.manualCode, { localReason: 'Re-entry allowed' })]);
    assert.equal(r.body.data.results[0].conflictType, 'REENTRY_LIMIT');
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).entryCount, 1);
  });

  await t.test('a scan the device turned away is not a conflict and admits no one', async () => {
    const tk = await ticket();
    const r = await sync(A, [scanItem(A, tk.manualCode, { localResult: 'RED', localReason: 'Not in this event’s list' })]);
    assert.deepEqual([r.body.data.results[0].result, r.body.data.results[0].conflict], ['RED', false]);
    assert.equal((await conflictsOf(tk.id)).length, 0);
    assert.equal((await prisma.ticket.findUnique({ where: { id: tk.id } })).status, 'ACTIVE');
  });

  await t.test('supervisors see each conflict with its scans, devices, gates, times, evidence and history', async () => {
    assert.equal((await manage('/conflicts', O.staffToken)).status, 403, 'gate staff cannot review conflicts');
    const r = await manage('/conflicts?status=OPEN');
    assert.equal(r.status, 200, r.body?.message);
    assert.ok(r.body.data.open >= 7);
    const c = r.body.data.conflicts.find((x) => x.id === dup.id);
    assert.equal(c.scans.length, 3);
    for (const s of c.scans) {
      assert.ok(s.device?.name && s.gate && s.deviceScannedAt && s.receivedAt && s.recordedAt && s.staff, JSON.stringify(s));
      assert.ok(Number.isInteger(s.deviceSeq));
    }
    assert.deepEqual(c.allowedResolutions, ['CONFIRMED_SINGLE_ENTRY', 'CONFIRMED_MULTIPLE_ENTRY', 'DEVICE_ERROR', 'DISMISSED']);
    assert.equal(c.ticket.code, dupTicket.manualCode);
    assert.equal(c.ticket.entryCount, 1);
    assert.deepEqual(c.history.map((h) => h.action), ['GATE_CONFLICT_DETECTED', 'GATE_CONFLICT_SCAN_ADDED']);
    const stats = await call('GET', `/checkin/events/${ev}/stats`, O.ownerToken);
    assert.equal(stats.body.data.openConflicts, r.body.data.open);
  });

  await t.test('resolution needs an allowed decision and a reason; it is audited and changes no ticket', async () => {
    const before = await snapshot(dupTicket.id);
    assert.equal((await manage(`/conflicts/${dup.id}/resolve`, O.staffToken, 'POST', { resolution: 'CONFIRMED_SINGLE_ENTRY', reason: 'Same guest scanned three times' })).status, 403);
    assert.equal((await manage(`/conflicts/${dup.id}/resolve`, O.ownerToken, 'POST', { resolution: 'CONFIRMED_SINGLE_ENTRY', reason: 'ok' })).status, 400, 'reason required');
    const wrong = await manage(`/conflicts/${dup.id}/resolve`, O.ownerToken, 'POST', { resolution: 'ADMISSION_ACCEPTED', reason: 'Not a valid choice for duplicates' });
    assert.deepEqual([wrong.status, wrong.body.code], [400, 'RESOLUTION_NOT_ALLOWED']);
    const ok = await manage(`/conflicts/${dup.id}/resolve`, O.ownerToken, 'POST', { resolution: 'CONFIRMED_SINGLE_ENTRY', reason: 'Gate B and C re-scanned the guest already inside (CCTV checked)' });
    assert.equal(ok.status, 200, ok.body?.message);
    const c = ok.body.data.conflict;
    assert.deepEqual([c.status, c.resolution, c.resolvedBy], ['RESOLVED', 'CONFIRMED_SINGLE_ENTRY', O.owner.name]);
    assert.equal(c.history.at(-1).action, 'GATE_CONFLICT_RESOLVED');
    assert.equal(c.history.at(-1).by, O.owner.name);
    const log = await prisma.auditLog.findFirst({ where: { action: 'GATE_CONFLICT_RESOLVED', targetId: dup.id } });
    assert.equal(log.userId, O.owner.id);
    assert.deepEqual([log.details.resolution, log.details.ticketChanged, log.details.checkInIds.length], ['CONFIRMED_SINGLE_ENTRY', false, 3]);
    assert.deepEqual(await snapshot(dupTicket.id), before);
    assert.equal(await prisma.checkIn.count({ where: { conflictId: dup.id } }), 3, 'no scan deleted');
    assert.equal((await manage(`/conflicts/${dup.id}/resolve`, O.ownerToken, 'POST', { resolution: 'DISMISSED', reason: 'second decision attempt' })).status, 409);
  });

  await t.test('two supervisors resolving at once: one decision', async () => {
    const open = (await manage('/conflicts?status=OPEN')).body.data.conflicts.find((c) => c.type === 'TICKET_INVALIDATED');
    const answers = await Promise.all(['ADMISSION_REJECTED', 'ADMISSION_ACCEPTED', 'DISMISSED'].map((resolution) => manage(`/conflicts/${open.id}/resolve`, O.ownerToken, 'POST', { resolution, reason: 'Decided at the supervisor desk' })));
    assert.equal(answers.filter((a) => a.status === 200).length, 1, JSON.stringify(answers.map((a) => a.status)));
    assert.equal(await prisma.auditLog.count({ where: { action: 'GATE_CONFLICT_RESOLVED', targetId: open.id } }), 1);
  });

  await t.test('after a resolution, a new disagreeing scan opens a new conflict', async () => {
    const r = await sync(A, [scanItem(A, dupTicket.manualCode)]);
    assert.equal(r.body.data.results[0].conflictType, 'DUPLICATE_ADMISSION');
    assert.notEqual(r.body.data.results[0].conflictId, dup.id);
    const list = await conflictsOf(dupTicket.id);
    assert.deepEqual(list.map((c) => c.status), ['RESOLVED', 'OPEN']);
  });

  await t.test('another organization cannot see or resolve these conflicts', async () => {
    assert.equal((await call('GET', `/checkin/manage/events/${ev}/conflicts`, X.ownerToken)).status, 403);
    assert.equal((await call('POST', `/checkin/manage/events/${ev}/conflicts/${dup.id}/resolve`, X.ownerToken, { resolution: 'DISMISSED', reason: 'not my event at all' })).status, 403);
    assert.equal((await call('GET', `/checkin/manage/events/${X.event.id}/conflicts/${dup.id}`, X.ownerToken)).status, 404, 'not found under another event');
  });

  await t.test('unresolved conflicts export as CSV', async () => {
    const r = await manage('/conflicts?status=OPEN&format=csv');
    assert.equal(r.status, 200);
    const lines = r.body.trim().split('\n');
    assert.match(lines[0], /^Conflict,Status,Type,Detected,Ticket,Holder/);
    assert.ok(lines.length >= 2);
    assert.ok(lines.slice(1).every((l) => l.includes(',OPEN,')));
  });
});
