// Admin console (admin roles, system settings with confirmation and undo, account actions recorded and undoable,
// investigations, platform messages, exports, finance overview, admins) and event tools (duplicate with venue plan
// and tickets, dates and sessions, sales window, capacity, terms, sale phases, scheduled publication,
// announcements, staff, history, report). Runs the API in-process; throwaway data is removed at the end.
//   node --test test_admin_events.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { applyPhases, runScheduledPublishing } from './src/services/eventToolsService.js';
import { invalidateConfig } from './src/services/systemConfig.js';

const PASSWORD = 'Password@123';

test('Admin console and event tools', async (t) => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const run = `${Date.now()}`;
  const city = `Testabad${run.slice(-6)}`;
  const mail = (n) => `ae_${n}_${run}@example.com`;
  const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
    const u = await prisma.user.create({ data: { name: `Test ${n}`, email: mail(n), passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true, city } });
    userIds.push(u.id);
    return u;
  };

  const owner = await account('owner', 'ORGANIZER');
  const fan = await account('fan');
  const fan2 = await account('fan2');
  const suspect = await account('suspect');
  const financeUser = await account('finance');
  const company = await prisma.company.create({ data: { userId: owner.id, companyName: `Tools Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  await prisma.user.update({ where: { id: owner.id }, data: { companyId: company.id } });
  await prisma.organizationMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } });
  // Event times are whole minutes (like real schedules)
  const day = (n) => {
    const d = new Date(Date.now() + n * 86400000);
    d.setUTCSeconds(0, 0);
    return d;
  };
  const pkt = (d) => new Date(d.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  const event = await prisma.event.create({ data: { companyId: company.id, name: `Tools Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', approvedAt: new Date(), date: day(30), time: '19:00', startsAt: day(30), endsAt: new Date(day(30).getTime() + 3 * 3600000), city: 'Lahore', venue: `Tools Hall ${run}` } });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 1000, totalQuantity: 10, availableQuantity: 10 } });
  await prisma.venueLayout.create({ data: { eventId: event.id, status: 'PUBLISHED', version: 1, template: 'custom', data: { version: 1, sections: [{ id: 's1', name: 'Main', tierId: tier.id }] }, publishedAt: new Date() } });
  await prisma.eventGate.create({ data: { eventId: event.id, name: 'North', allowedTierIds: [tier.id] } });
  const seats = [];
  for (let i = 1; i <= 6; i++) seats.push(await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(i) } }));
  const hold = (userId, list) => prisma.seat.updateMany({ where: { id: { in: list.map((s) => s.id) } }, data: { status: 'LOCKED', lockedByUserId: userId, lockedUntil: new Date(Date.now() + 600000) } });

  const adminToken = await login('admin@ticketledger.pk');
  const ownerToken = await login(owner.email);
  const fanToken = await login(fan.email);
  const fan2Token = await login(fan2.email);
  const created = { events: [event.id], series: [] };
  const feeBefore = await prisma.systemSetting.findUnique({ where: { key: 'platformFeePercent' } });

  t.after(async () => {
    if (feeBefore) await prisma.systemSetting.update({ where: { key: 'platformFeePercent' }, data: { value: feeBefore.value } });
    else await prisma.systemSetting.deleteMany({ where: { key: { in: ['platformFeePercent', 'siteBanner'] } } });
    await prisma.systemSetting.deleteMany({ where: { key: 'siteBanner' } });
    invalidateConfig();
    await prisma.adminAction.deleteMany({ where: { OR: [{ targetId: { in: [...userIds, 'platformFeePercent', 'siteBanner'] } }, { adminId: { in: userIds } }] } });
    await prisma.investigation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.broadcast.deleteMany({ where: { title: { contains: run } } });
    const evs = await prisma.event.findMany({ where: { companyId: company.id }, select: { id: true } });
    const ids = evs.map((e) => e.id);
    await prisma.checkIn.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.staffEventAssignment.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.event.deleteMany({ where: { id: { in: ids } } });
    await prisma.eventSeries.deleteMany({ where: { companyId: company.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: company.id }, { userId: { in: userIds } }, { targetId: { in: [...userIds, ...ids, 'platformFeePercent', 'siteBanner'] } }] } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { title: { contains: run } }] } });
    await prisma.organizationMember.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  // ── Admin console ────────────────────────────────────────────────────────────────────────────────────

  let financeToken;
  await t.test('admins: roles limit what each admin can do; adding one needs password and typed email', async () => {
    const me = await call('GET', '/admin/me', adminToken);
    assert.equal(me.body.data.role, 'OWNER');
    assert.equal((await call('POST', '/admin/admins', adminToken, { email: financeUser.email, role: 'FINANCE', password: PASSWORD })).status, 428);
    assert.equal((await call('POST', '/admin/admins', adminToken, { email: financeUser.email, role: 'FINANCE', password: 'wrong', confirm: financeUser.email })).status, 401);
    const add = await call('POST', '/admin/admins', adminToken, { email: financeUser.email, role: 'FINANCE', password: PASSWORD, confirm: financeUser.email });
    assert.equal(add.status, 201, add.body?.message);
    financeToken = await login(financeUser.email);
    assert.equal((await call('GET', '/admin/finance', financeToken)).status, 200);
    assert.equal((await call('PUT', '/admin/config/platformFeePercent', financeToken, { value: 9, confirm: 'CHANGE' })).status, 403);
    assert.equal((await call('GET', '/admin/fraud-alerts', financeToken)).status, 403);
    assert.equal((await call('GET', '/companies/admin/payouts', financeToken)).status, 200);
    const meF = await call('GET', '/auth/me', financeToken);
    assert.ok(meF.body.data.user.adminPermissions.includes('admin.finance'));
    assert.ok(!meF.body.data.user.adminPermissions.includes('admin.config'));
  });

  await t.test('settings: confirmed changes, used at once, and undoable', async () => {
    assert.equal((await call('PUT', '/admin/config/platformFeePercent', adminToken, { value: 7 })).status, 428);
    assert.equal((await call('PUT', '/admin/config/platformFeePercent', adminToken, { value: 70, confirm: 'CHANGE' })).status, 400, 'limits');
    const before = (await call('GET', '/admin/config', adminToken)).body.data.settings.find((s) => s.key === 'platformFeePercent').value;
    const set = await call('PUT', '/admin/config/platformFeePercent', adminToken, { value: 7, confirm: 'CHANGE' });
    assert.equal(set.status, 200, set.body?.message);
    assert.equal((await call('GET', '/admin/finance', adminToken)).body.data.platformFeePercent, 7);
    await call('PUT', '/admin/config/siteBanner', adminToken, { value: { active: true, message: `Maintenance tonight ${run}`, tone: 'warn' } });
    assert.equal((await call('GET', '/site-config')).body.data.banner.message, `Maintenance tonight ${run}`);
    const actions = await call('GET', '/admin/actions?reversible=true', adminToken);
    const feeAction = actions.body.data.items.find((a) => a.targetId === 'platformFeePercent');
    assert.ok(feeAction.canUndo);
    assert.equal((await call('POST', `/admin/actions/${feeAction.id}/undo`, adminToken)).status, 200);
    invalidateConfig();
    assert.equal((await call('GET', '/admin/finance', adminToken)).body.data.platformFeePercent, before);
    assert.equal((await call('POST', `/admin/actions/${feeAction.id}/undo`, adminToken)).status, 409, 'once only');
  });

  await t.test('investigations: account actions are confirmed, noted on the case and undoable', async () => {
    const open = await call('POST', '/admin/investigations', adminToken, { userId: suspect.id, title: 'Bulk buying from many cards', riskLevel: 'HIGH', note: 'Flagged by the watchlist' });
    assert.equal(open.status, 201, open.body?.message);
    const caseId = open.body.data.case.id;
    const noConfirm = await call('PUT', `/admin/users/${suspect.id}/status`, adminToken, { status: 'SUSPENDED', reason: 'Investigating' });
    assert.equal(noConfirm.status, 428);
    assert.equal(noConfirm.body.confirmPhrase, suspect.email);
    assert.equal((await call('PUT', `/admin/users/${suspect.id}/status`, adminToken, { status: 'SUSPENDED', reason: 'Investigating', confirm: suspect.email })).status, 200);
    const c = await call('GET', `/admin/investigations/${caseId}`, adminToken);
    assert.ok(c.body.data.case.notes.some((n) => n.kind === 'ACTION' && /suspended/.test(n.body)));
    await call('POST', `/admin/investigations/${caseId}/notes`, adminToken, { kind: 'EVIDENCE', body: 'Same device used by 4 accounts' });
    assert.equal((await call('PATCH', `/admin/investigations/${caseId}`, adminToken, { status: 'CLOSED' })).status, 400, 'outcome needed');
    const action = (await call('GET', '/admin/actions?reversible=true', adminToken)).body.data.items.find((a) => a.targetId === suspect.id);
    assert.equal((await call('POST', `/admin/actions/${action.id}/undo`, adminToken)).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: suspect.id } })).status, 'ACTIVE');
    assert.equal((await call('PATCH', `/admin/investigations/${caseId}`, adminToken, { status: 'CLOSED', outcome: 'Family sharing a card; no fraud.' })).body.data.case.status, 'CLOSED');
    assert.equal((await call('POST', '/admin/investigations', financeToken, { userId: suspect.id, title: 'x x x' })).status, 403, 'finance admins have no fraud access');
  });

  await t.test('platform messages: audience, city, scheduling; everyone needs confirmation', async () => {
    const count = await call('GET', `/admin/broadcasts/audience?audience=CUSTOMERS&city=${city}`, adminToken);
    assert.equal(count.body.data.recipients, 3, 'fan, fan2, suspect');
    const sent = await call('POST', '/admin/broadcasts', adminToken, { title: `Gates open early ${run}`, message: 'All Lahore events open gates 30 minutes earlier this weekend.', audience: 'CUSTOMERS', city, sendEmail: false });
    assert.equal(sent.status, 201, sent.body?.message);
    assert.equal(sent.body.data.broadcast.recipientCount, 3);
    assert.ok(await prisma.notification.findFirst({ where: { userId: fan.id, type: 'PLATFORM_BROADCAST_INAPP', title: { contains: run } } }));
    assert.equal((await call('POST', '/admin/broadcasts', adminToken, { title: `To all ${run}`, message: 'Hello everyone out there', audience: 'ALL' })).status, 428);
    const later = await call('POST', '/admin/broadcasts', adminToken, { title: `Later ${run}`, message: 'A scheduled message for later', audience: 'ADMINS', scheduledFor: day(1).toISOString() });
    assert.equal(later.body.data.broadcast.status, 'SCHEDULED');
    assert.equal((await call('POST', `/admin/broadcasts/${later.body.data.broadcast.id}/cancel`, adminToken)).status, 200);
  });

  await t.test('exports: CSV per dataset, recorded', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const csv = await call('GET', `/admin/exports/users?from=${today}`, adminToken);
    assert.equal(csv.status, 200);
    assert.match(csv.body, /^id,name,email/);
    assert.ok(csv.body.includes(fan.email));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ADMIN_DATA_EXPORTED', targetId: 'users' }, orderBy: { createdAt: 'desc' } }));
    assert.equal((await call('GET', '/admin/exports/users', financeToken)).status, 200, 'finance may export');
    assert.equal((await call('GET', '/admin/exports/nope', adminToken)).status, 404);
  });

  await t.test('admins: removing one needs the typed email', async () => {
    assert.equal((await call('DELETE', `/admin/admins/${financeUser.id}`, adminToken, {})).status, 428);
    assert.equal((await call('DELETE', `/admin/admins/${financeUser.id}`, adminToken, { confirm: financeUser.email })).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: financeUser.id } })).role, 'CUSTOMER');
  });

  // ── Event tools ──────────────────────────────────────────────────────────────────────────────────────

  await t.test('duplicate: new event with new ticket types, venue plan and gates', async () => {
    const d = day(60);
    const r = await call('POST', `/org/events/${event.id}/duplicate`, ownerToken, { date: pkt(d), time: '19:00', endDate: pkt(d), endTime: '22:00', name: `Tools Event copy ${run}` });
    assert.equal(r.status, 201, r.body?.message);
    const copy = r.body.data.event;
    created.events.push(copy.id);
    assert.equal(copy.status, 'DRAFT');
    assert.equal(copy.clonedFromId, event.id);
    assert.equal(copy.tiers.length, 1);
    assert.notEqual(copy.tiers[0].id, tier.id);
    const layout = await prisma.venueLayout.findFirst({ where: { eventId: copy.id } });
    assert.equal(layout.status, 'DRAFT');
    assert.equal(layout.data.sections[0].tierId, copy.tiers[0].id, 'plan points at the new ticket type');
    const gate = await prisma.eventGate.findFirst({ where: { eventId: copy.id } });
    assert.deepEqual(gate.allowedTierIds, [copy.tiers[0].id]);
  });

  await t.test('dates and sessions: weekly repeats in one series', async () => {
    const r = await call('POST', `/org/events/${event.id}/dates`, ownerToken, { recurrence: { frequency: 'WEEKLY', count: 2 }, label: 'Opening night' });
    assert.equal(r.status, 201, r.body?.message);
    assert.equal(r.body.data.created.length, 2);
    const series = await prisma.event.findMany({ where: { seriesId: r.body.data.seriesId }, orderBy: { startsAt: 'asc' } });
    assert.equal(series.length, 3);
    assert.equal(series[1].startsAt.getTime() - series[0].startsAt.getTime(), 7 * 86400000);
    const extras = await call('GET', `/events/${event.id}/extras`);
    assert.equal(extras.body.data.sessionLabel, 'Opening night');
  });

  await t.test('sales window, terms and capacity apply at checkout', async () => {
    await call('PUT', `/org/events/${event.id}/settings`, ownerToken, { salesOpenAt: day(2).toISOString() });
    await hold(fan.id, [seats[0]]);
    const closed = await call('POST', '/bookings/initiate', fanToken, { eventId: event.id, seatIds: [seats[0].id], paymentMethod: 'MOCK' });
    assert.equal(closed.body.code, 'SALES_NOT_OPEN');
    await call('PUT', `/org/events/${event.id}/settings`, ownerToken, { salesOpenAt: null, terms: 'No outside food. Bags are searched.', capacityLimit: 1 });
    const noTerms = await call('POST', '/bookings/initiate', fanToken, { eventId: event.id, seatIds: [seats[0].id], paymentMethod: 'MOCK' });
    assert.equal(noTerms.body.code, 'TERMS_REQUIRED');
    const ok = await call('POST', '/bookings/initiate', fanToken, { eventId: event.id, seatIds: [seats[0].id], paymentMethod: 'MOCK', acceptTerms: true });
    assert.equal(ok.status, 201, ok.body?.message);
    const o = await prisma.order.findUnique({ where: { id: ok.body.data.orderId } });
    assert.equal(o.termsVersion, 2);
    await call('POST', '/bookings/confirm', fanToken, { orderId: o.id, paymentDetails: { paymentTxId: ok.body.data.paymentParams.mockTxId } });
    await hold(fan2.id, [seats[1]]);
    const full = await call('POST', '/bookings/initiate', fan2Token, { eventId: event.id, seatIds: [seats[1].id], paymentMethod: 'MOCK', acceptTerms: true });
    assert.equal(full.body.code, 'CAPACITY_REACHED');
    await call('PUT', `/org/events/${event.id}/settings`, ownerToken, { capacityLimit: null });
  });

  await t.test('sale phases: price follows the current phase (date or quantity)', async () => {
    const r = await call('PUT', `/org/events/${event.id}/tiers/${tier.id}/phases`, ownerToken, { phases: [{ name: 'Early bird', price: 500, quantity: 1 }, { name: 'Regular', price: 900 }] });
    assert.equal(r.status, 200, r.body?.message);
    assert.equal(Number((await prisma.ticketTier.findUnique({ where: { id: tier.id } })).price), 500);
    await hold(fan2.id, [seats[1]]);
    const buy = await call('POST', '/bookings/initiate', fan2Token, { eventId: event.id, seatIds: [seats[1].id], paymentMethod: 'MOCK', acceptTerms: true });
    assert.equal(buy.body.data.totalAmount, 500);
    await call('POST', '/bookings/confirm', fan2Token, { orderId: buy.body.data.orderId, paymentDetails: { paymentTxId: buy.body.data.paymentParams.mockTxId } });
    await applyPhases(event.id);
    const t2 = await prisma.ticketTier.findUnique({ where: { id: tier.id } });
    assert.equal(Number(t2.price), 900, 'early bird sold its 1 ticket');
  });

  await t.test('scheduled publication, announcements, staff, history and report', async () => {
    const copy = await prisma.event.findFirst({ where: { clonedFromId: event.id, seriesId: null } });
    await prisma.event.update({ where: { id: copy.id }, data: { status: 'PUBLISHED', approvedAt: new Date(), isHidden: true, publishAt: new Date(Date.now() - 1000) } });
    await runScheduledPublishing();
    assert.equal((await prisma.event.findUnique({ where: { id: copy.id } })).isHidden, false);

    const a = await call('POST', `/org/events/${event.id}/announcements`, ownerToken, { title: 'Doors at 6:30', body: 'Doors open half an hour earlier. See you there!' });
    assert.equal(a.status, 201, a.body?.message);
    assert.equal(a.body.data.announcement.recipientCount, 2);
    assert.ok(await prisma.notification.findFirst({ where: { userId: fan.id, type: 'EVENT_ANNOUNCEMENT' } }));
    assert.equal((await call('GET', `/events/${event.id}/extras`)).body.data.announcements[0].title, 'Doors at 6:30');

    const staff = await call('GET', `/org/events/${event.id}/staff`, ownerToken);
    assert.ok(staff.body.data.staff.some((s) => s.userId === owner.id && s.assigned));

    const hist = await call('GET', `/org/events/${event.id}/history`, ownerToken);
    const change = hist.body.data.history.find((h) => h.action === 'EVENT_SETTINGS_CHANGED' && h.after?.terms);
    assert.equal(change.after.terms, 'No outside food. Bags are searched.');
    assert.ok(hist.body.data.history.some((h) => h.action === 'EVENT_SALE_PHASES_CHANGED'));

    const rep = await call('GET', `/org/events/${event.id}/report`, ownerToken);
    assert.equal(rep.body.data.totals.ticketsSold, 2);
    assert.equal(rep.body.data.totals.collected, 1500);
    const csv = await call('GET', `/org/events/${event.id}/report?format=csv`, ownerToken);
    assert.match(csv.body, /^Event,/);
  });
});
