// Organization membership: invitations, roles and permissions, organization isolation, member lifecycle,
// last-owner protection, ownership transfer and activity history. Runs the API in-process against the database
// with throwaway companies, events and accounts that are removed at the end. No real email is sent under
// node --test (emailService uses its in-memory transport).
//   node --test test_org_membership.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { getLastSentEmail } from './src/services/emailService.js';

const PASSWORD = 'Password@123';

test('Organization & staff management', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const run = `${Date.now()}`;
  const mail = (name) => `org_${name}_${run}@example.com`;

  const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
  const login = async (email) => {
    const res = await call('POST', '/auth/login', null, { email, password: PASSWORD });
    assert.equal(res.status, 200, `login ${email}: ${res.body?.message}`);
    return res.body.data.token;
  };
  const hash = await bcrypt.hash(PASSWORD, 10);
  const createdUsers = [];
  const account = async (name, role = 'CUSTOMER') => {
    const u = await prisma.user.create({ data: { name: `Test ${name}`, email: mail(name), passwordHash: hash, role, status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    createdUsers.push(u.id);
    return u;
  };
  const company = async (owner, label) => {
    const c = await prisma.company.create({ data: { userId: owner.id, companyName: `Org ${label} ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/uploads/test.pdf', status: 'APPROVED' } });
    await prisma.user.update({ where: { id: owner.id }, data: { companyId: c.id } });
    return c;
  };
  const event = (companyId, label) =>
    prisma.event.create({ data: { companyId, name: `Event ${label} ${run}`, description: 'Org test event', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: new Date(Date.now() + 40 * 86400000), time: '19:00', city: 'Lahore', venue: `Hall ${label} ${run}` } });

  // Two organizations, created the way older code and the seed do (no membership row): the owner's membership
  // must appear on first use.
  const ownerA = await account('ownera', 'ORGANIZER');
  const ownerB = await account('ownerb', 'ORGANIZER');
  const companyA = await company(ownerA, 'A');
  const companyB = await company(ownerB, 'B');
  const [a1, a2, b1] = await Promise.all([event(companyA.id, 'A1'), event(companyA.id, 'A2'), event(companyB.id, 'B1')]);
  const ownerAToken = await login(ownerA.email);
  const ownerBToken = await login(ownerB.email);
  const adminToken = await login('admin@ticketledger.pk');

  /** Invites `email` to company A as `role` and returns the raw token from the outgoing email. */
  const invite = async (email, role, extra = {}, token = ownerAToken) => {
    const res = await call('POST', '/org/invitations', token, { email, role, ...extra });
    assert.equal(res.status, 201, res.body?.message);
    assert.equal(res.body.data.invite.tokenHash, undefined, 'token hash never leaves the API');
    return { id: res.body.data.invite.id, token: getLastSentEmail().inviteToken, res };
  };
  /** Invites and accepts as a new account; returns { token, userId, memberId }. */
  const join = async (name, role, eventIds = []) => {
    const inv = await invite(mail(name), role, { eventIds });
    const res = await call('POST', '/auth/accept-invite', null, { token: inv.token, name: `Test ${name}`, password: PASSWORD });
    assert.equal(res.status, 201, res.body?.message);
    createdUsers.push(res.body.data.user.id);
    const m = await prisma.organizationMember.findFirst({ where: { userId: res.body.data.user.id } });
    return { token: res.body.data.token, userId: res.body.data.user.id, memberId: m.id, user: res.body.data.user };
  };

  const people = {};

  await t.test('owners get their membership and every permission', async () => {
    const me = await call('GET', '/org/me', ownerAToken);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.role, 'OWNER');
    assert.equal(me.body.data.organization.id, companyA.id);
    assert.ok(me.body.data.permissions.includes('staff.roles'));
    const auth = await call('GET', '/auth/me', ownerAToken);
    assert.equal(auth.body.data.user.organization.role, 'OWNER');
  });

  await t.test('invitation: new account accepts once; token cannot be reused', async () => {
    const inv = await invite(mail('em'), 'EVENT_MANAGER', { eventIds: [a1.id] });
    const preview = await call('GET', `/auth/invite/${inv.token}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.role, 'EVENT_MANAGER');
    assert.equal(preview.body.data.existingAccount, false);
    assert.deepEqual(preview.body.data.events.map((e) => e.id), [a1.id]);
    const stored = await prisma.staffInvite.findUnique({ where: { id: inv.id } });
    assert.notEqual(stored.tokenHash, inv.token, 'only the hash is stored');

    const res = await call('POST', '/auth/accept-invite', null, { token: inv.token, name: 'Test Em', password: PASSWORD });
    assert.equal(res.status, 201, res.body?.message);
    assert.equal(res.body.data.user.role, 'CUSTOMER', 'global role stays separate from the organization role');
    assert.equal(res.body.data.user.organization.role, 'EVENT_MANAGER');
    createdUsers.push(res.body.data.user.id);
    people.em = { token: res.body.data.token, userId: res.body.data.user.id, memberId: res.body.data.user.organization.memberId };

    const reuse = await call('POST', '/auth/accept-invite', null, { token: inv.token, name: 'Again', password: PASSWORD });
    assert.equal(reuse.status, 410);
  });

  await t.test('invitation: events of another organization are refused', async () => {
    const res = await call('POST', '/org/invitations', ownerAToken, { email: mail('x1'), role: 'STAFF', eventIds: [b1.id] });
    assert.equal(res.status, 404);
  });

  await t.test('invitation: two simultaneous acceptances, exactly one wins', async () => {
    const inv = await invite(mail('race'), 'STAFF', { eventIds: [a1.id] });
    const results = await Promise.all([1, 2, 3].map((n) => call('POST', '/auth/accept-invite', null, { token: inv.token, name: `Race ${['A', 'B', 'C'][n - 1]}`, password: PASSWORD })));
    const ok = results.filter((r) => r.status === 201);
    assert.equal(ok.length, 1, `statuses: ${results.map((r) => r.status).join(',')}`);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => [409, 410].includes(r.status)));
    createdUsers.push(ok[0].body.data.user.id);
    assert.equal(await prisma.user.count({ where: { email: mail('race') } }), 1);
    assert.equal(await prisma.organizationMember.count({ where: { user: { email: mail('race') } } }), 1);
    people.staff = { token: ok[0].body.data.token, userId: ok[0].body.data.user.id, memberId: ok[0].body.data.user.organization.memberId };
  });

  await t.test('invitation: expired, revoked and rejected links stop working', async () => {
    const expired = await invite(mail('exp'), 'STAFF');
    await prisma.staffInvite.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await call('GET', `/auth/invite/${expired.token}`)).status, 410);
    assert.equal((await call('POST', '/auth/accept-invite', null, { token: expired.token, name: 'Late Person', password: PASSWORD })).status, 410);
    assert.equal((await prisma.staffInvite.findUnique({ where: { id: expired.id } })).status, 'EXPIRED');
    const resent = await call('POST', `/org/invitations/${expired.id}/resend`, ownerAToken);
    assert.equal(resent.status, 200, resent.body?.message);
    const fresh = getLastSentEmail().inviteToken;
    assert.equal((await call('GET', `/auth/invite/${fresh}`)).status, 200);
    assert.equal((await call('GET', `/auth/invite/${expired.token}`)).status, 410, 'old link dead after resend');

    const revoked = await invite(mail('rev'), 'STAFF');
    assert.equal((await call('DELETE', `/org/invitations/${revoked.id}`, ownerBToken)).status, 404, 'other organizations cannot revoke it');
    assert.equal((await call('DELETE', `/org/invitations/${revoked.id}`, ownerAToken)).status, 200);
    assert.equal((await call('POST', '/auth/accept-invite', null, { token: revoked.token, name: 'Revoked Person', password: PASSWORD })).status, 410);

    const rejected = await invite(mail('rej'), 'STAFF');
    assert.equal((await call('POST', `/auth/invite/${rejected.token}/reject`)).status, 200);
    assert.equal((await prisma.staffInvite.findUnique({ where: { id: rejected.id } })).status, 'REJECTED');
    assert.equal((await call('POST', `/auth/invite/${rejected.token}/reject`)).status, 410);
    assert.equal((await call('POST', '/auth/accept-invite', null, { token: rejected.token, name: 'Rejected Person', password: PASSWORD })).status, 410);
  });

  await t.test('invitation: existing customer accounts join with a matching, verified email', async () => {
    const customer = await account('fin');
    const other = await account('other');
    const inv = await invite(customer.email, 'FINANCE_MANAGER');
    assert.equal(inv.res.body.data.existingAccount, true);
    assert.equal((await call('POST', '/auth/accept-invite', null, { token: inv.token, name: 'X Y', password: PASSWORD })).body.code, 'SIGN_IN_TO_ACCEPT');
    const wrong = await call('POST', '/auth/accept-invite', await login(other.email), { token: inv.token });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'INVITE_EMAIL_MISMATCH');
    const custToken = await login(customer.email);
    const ok = await call('POST', '/auth/accept-invite', custToken, { token: inv.token });
    assert.equal(ok.status, 200, ok.body?.message);
    assert.equal(ok.body.data.user.role, 'CUSTOMER');
    assert.equal(ok.body.data.user.organization.role, 'FINANCE_MANAGER');
    people.fin = { token: ok.body.data.token, userId: customer.id, memberId: ok.body.data.user.organization.memberId };

    // An unverified account cannot accept
    const unverified = await account('unver');
    await prisma.user.update({ where: { id: unverified.id }, data: { emailVerifiedAt: null } });
    const inv2 = await invite(unverified.email, 'STAFF');
    const unvToken = await login(unverified.email).catch(() => null);
    if (unvToken) assert.equal((await call('POST', '/auth/accept-invite', unvToken, { token: inv2.token })).body.code, 'EMAIL_NOT_VERIFIED');
  });

  await t.test('one organization per user', async () => {
    const res = await call('POST', '/org/invitations', ownerBToken, { email: mail('fin'), role: 'STAFF' });
    assert.equal(res.status, 409);
    const own = await call('POST', '/org/invitations', ownerAToken, { email: mail('ownerb'), role: 'STAFF' });
    assert.equal(own.status, 409, 'owners of another company cannot be invited');
    const admin = await call('POST', '/org/invitations', ownerAToken, { email: 'admin@ticketledger.pk', role: 'STAFF' });
    assert.equal(admin.status, 409);
  });

  await t.test('remaining roles join', async () => {
    people.admin = await join('adm', 'ADMIN');
    people.gate = await join('gate', 'GATE_STAFF', [a1.id]);
    assert.equal(people.gate.user.role, 'GATE_STAFF', 'gate staff accounts keep the GATE_STAFF account role');
    people.owner = { token: ownerAToken };
  });

  await t.test('permission matrix (backend enforcement)', async () => {
    const A1 = a1.id;
    const A2 = a2.id;
    // [description, method, path, expected status per role]
    const matrix = [
      ['org members', 'GET', '/org/members', { owner: 200, admin: 200, em: 200, fin: 403, staff: 403, gate: 403 }],
      ['org invitations (create)', 'POST', '/org/invitations', { owner: 400, admin: 400, em: 403, fin: 403, staff: 403, gate: 403 }],
      ['org activity', 'GET', '/org/activity', { owner: 200, admin: 200, em: 403, fin: 200, staff: 403, gate: 403 }],
      ['my events', 'GET', '/events/organizer/my-events', { owner: 200, admin: 200, em: 200, fin: 200, staff: 200, gate: 403 }],
      ['manage A1', 'GET', `/events/${A1}/manage`, { owner: 200, admin: 200, em: 200, fin: 200, staff: 200, gate: 403 }],
      ['manage A2 (not assigned)', 'GET', `/events/${A2}/manage`, { owner: 200, admin: 200, em: 403, fin: 200, staff: 403, gate: 403 }],
      ['lifecycle A1', 'GET', `/events/${A1}/lifecycle`, { owner: 200, admin: 200, em: 200, fin: 403, staff: 403, gate: 403 }],
      ['lifecycle A2', 'GET', `/events/${A2}/lifecycle`, { owner: 200, admin: 200, em: 403, fin: 403, staff: 403, gate: 403 }],
      ['cancel A1 (refunds)', 'POST', `/events/${A1}/cancel`, { owner: 400, admin: 400, em: 403, fin: 403, staff: 403, gate: 403 }],
      ['dashboard', 'GET', '/admin/organizer-dashboard', { owner: 200, admin: 200, em: 200, fin: 200, staff: 200, gate: 403 }],
      ['abandoned intents', 'GET', '/analytics/abandoned', { owner: 200, admin: 200, em: 200, fin: 403, staff: 200, gate: 403 }],
      ['intent A2', 'GET', `/analytics/intent/${A2}`, { owner: 200, admin: 200, em: 403, fin: 403, staff: 403, gate: 403 }],
      ['scanner events', 'GET', '/checkin/events', { owner: 200, admin: 200, em: 200, fin: 403, staff: 403, gate: 200 }],
      ['gate staff list', 'GET', '/staff', { owner: 200, admin: 200, em: 200, fin: 403, staff: 403, gate: 403 }],
      ['delete A2', 'DELETE', `/events/${A2}`, { owner: null, admin: null, em: 403, fin: 403, staff: 403, gate: 403 }],
    ];
    const failures = [];
    for (const [label, method, path, expected] of matrix) {
      for (const [who, status] of Object.entries(expected)) {
        if (status === null) continue;
        const res = await call(method, path, people[who].token, method === 'GET' || method === 'DELETE' ? undefined : {});
        if (res.status !== status) failures.push(`${label} as ${who}: expected ${status}, got ${res.status} (${res.body?.message})`);
      }
    }
    assert.deepEqual(failures, []);

    // Event scope in lists
    const emEvents = await call('GET', '/events/organizer/my-events', people.em.token);
    assert.deepEqual(emEvents.body.data.events.map((e) => e.id), [A1]);
    const gateEvents = await call('GET', '/checkin/events', people.gate.token);
    assert.deepEqual(gateEvents.body.data.events.map((e) => e.id), [A1]);
    // Money figures only with finance.view
    const emDash = await call('GET', '/admin/organizer-dashboard', people.em.token);
    assert.equal(emDash.body.data.access.finance, false);
    assert.equal(emDash.body.data.metrics.totalRevenuePkr, undefined);
    const finDash = await call('GET', '/admin/organizer-dashboard', people.fin.token);
    assert.equal(typeof finDash.body.data.metrics.totalRevenuePkr, 'number');
    // Dashboard for an event outside the member's scope
    assert.equal((await call('GET', `/admin/organizer-dashboard?eventId=${A2}`, people.em.token)).status, 403);
  });

  await t.test('organization isolation: other organizations and unscoped Super Admins', async () => {
    const memberOfA = people.staff.memberId;
    assert.equal((await call('GET', `/events/${a1.id}/manage`, ownerBToken)).status, 403);
    assert.equal((await call('GET', `/org/members/${memberOfA}`, ownerBToken)).status, 404);
    assert.equal((await call('PATCH', `/org/members/${memberOfA}`, ownerBToken, { role: 'ADMIN' })).status, 404);
    assert.equal((await call('POST', `/org/members/${memberOfA}/deactivate`, ownerBToken, {})).status, 404);
    assert.equal((await call('PUT', `/org/members/${memberOfA}/events`, ownerBToken, { eventIds: [b1.id] })).status, 404);
    assert.equal((await call('GET', `/analytics/intent/${a1.id}`, ownerBToken)).status, 403);
    assert.equal((await call('GET', `/admin/organizer-dashboard?eventId=${a1.id}`, ownerBToken)).status, 403);
    assert.equal((await call('GET', `/events/${a1.id}/lifecycle`, ownerBToken)).status, 403);
    // B's member list never contains A's people
    const bMembers = await call('GET', '/org/members', ownerBToken);
    assert.ok(bMembers.body.data.members.every((m) => m.userId === ownerB.id));
    // A member can't hand out another organization's events
    assert.equal((await call('PUT', `/org/members/${memberOfA}/events`, ownerAToken, { eventIds: [b1.id] })).status, 404);

    // Super Admin: refused without naming the organization, allowed and audited with ?companyId=
    const unscoped = await call('GET', '/org/members', adminToken);
    assert.equal(unscoped.status, 403);
    const scoped = await call('GET', `/org/members?companyId=${companyA.id}`, adminToken);
    assert.equal(scoped.status, 200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'SUPER_ADMIN_ORG_ACCESS', companyId: companyA.id }, orderBy: { createdAt: 'desc' } });
    assert.ok(audit, 'Super Admin access to an organization is audited');
    assert.equal(audit.details.path, '/api/org/members');
    assert.equal((await call('GET', '/org/members?companyId=nope', adminToken)).status, 404);
  });

  await t.test('behaviour profiles: only attendees of the member’s events, only that behaviour', async () => {
    const fan = await account('fan');
    await prisma.order.create({ data: { userId: fan.id, eventId: a1.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
    await prisma.behaviorEvent.createMany({ data: [{ userId: fan.id, sessionId: 's1', action: 'event_view', eventId: a1.id }, { userId: fan.id, sessionId: 's1', action: 'event_view', eventId: b1.id }, { userId: fan.id, sessionId: 's1', action: 'login' }] });
    const asA = await call('GET', `/behavior/user/${fan.id}`, ownerAToken);
    assert.equal(asA.status, 200, asA.body?.message);
    assert.ok(asA.body.data.timeline.every((e) => e.eventId === a1.id), 'no behaviour on other organizations’ events or logins');
    assert.equal(asA.body.data.user.walletAddress, undefined);
    assert.equal(asA.body.data.user.status, undefined);
    assert.equal(asA.body.data.scores.fraudRisk, undefined);
    assert.ok(asA.body.data.intentByEvent.every((e) => e.eventId === a1.id));
    assert.equal((await call('GET', `/behavior/user/${fan.id}`, ownerBToken)).status, 404, 'B never sold to this person');
    assert.equal((await call('GET', `/behavior/user/${fan.id}`, people.fin.token)).status, 403, 'needs attendee.view');
    const asAdmin = await call('GET', `/behavior/user/${fan.id}`, adminToken);
    assert.equal(asAdmin.status, 200);
    assert.ok(asAdmin.body.data.timeline.length >= 3, 'Super Admin sees the platform-wide profile');
    await prisma.behaviorEvent.deleteMany({ where: { userId: fan.id } });
    await prisma.order.deleteMany({ where: { userId: fan.id } });
  });

  await t.test('no privilege escalation', async () => {
    const adm = people.admin.token;
    assert.equal((await call('PATCH', `/org/members/${people.staff.memberId}`, adm, { role: 'OWNER' })).status, 403, 'admins cannot create owners');
    assert.equal((await call('PATCH', `/org/members/${people.staff.memberId}`, adm, { role: 'ADMIN' })).status, 403, 'admins cannot create admins');
    assert.equal((await call('POST', '/org/invitations', adm, { email: mail('newadm'), role: 'ADMIN' })).status, 403);
    assert.equal((await call('PATCH', `/org/members/${people.staff.memberId}`, adm, { grantedPermissions: ['org.settings'] })).status, 400, 'reserved permissions');
    assert.equal((await call('PATCH', `/org/members/${people.staff.memberId}`, people.em.token, { role: 'ADMIN' })).status, 403, 'no staff.roles');
    assert.equal((await call('PATCH', `/org/members/${people.admin.memberId}`, adm, { role: 'STAFF' })).status, 403, 'admins cannot demote admins');
    assert.equal((await call('POST', `/org/members/${people.staff.memberId}/deactivate`, people.em.token, {})).status, 403, 'no staff.manage');
  });

  await t.test('custom permissions change access at once', async () => {
    const st = people.staff;
    assert.equal((await call('GET', '/admin/organizer-dashboard', st.token)).body.data.access.finance, false);
    const grant = await call('PATCH', `/org/members/${st.memberId}`, ownerAToken, { grantedPermissions: ['finance.view'], revokedPermissions: ['attendee.view'] });
    assert.equal(grant.status, 200, grant.body?.message);
    assert.ok(grant.body.data.member.permissions.includes('finance.view'));
    assert.equal((await call('GET', '/admin/organizer-dashboard', st.token)).body.data.access.finance, true);
    assert.equal((await call('GET', '/analytics/abandoned', st.token)).status, 403);
    const log = await prisma.auditLog.findFirst({ where: { action: 'ORG_MEMBER_PERMISSIONS_CHANGED', targetId: st.memberId } });
    assert.deepEqual(log.details.before, { grantedPermissions: [], revokedPermissions: [] });
    assert.deepEqual(log.details.after, { grantedPermissions: ['finance.view'], revokedPermissions: ['attendee.view'] });
    await call('PATCH', `/org/members/${st.memberId}`, ownerAToken, { grantedPermissions: [], revokedPermissions: [] });
  });

  await t.test('deactivation removes organization access immediately; the account stays active', async () => {
    const em = people.em;
    assert.equal((await call('POST', `/org/members/${em.memberId}/deactivate`, ownerAToken, { reason: 'Contract paused' })).status, 200);
    const blocked = await call('GET', '/events/organizer/my-events', em.token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'NO_ORGANIZATION');
    assert.equal((await call('GET', `/events/${a1.id}/lifecycle`, em.token)).status, 403);
    assert.equal((await call('GET', '/auth/me', em.token)).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: em.userId } })).status, 'ACTIVE');
    assert.equal((await call('POST', `/org/members/${em.memberId}/reactivate`, ownerAToken, {})).status, 200);
    assert.equal((await call('GET', '/events/organizer/my-events', em.token)).status, 200);
  });

  await t.test('last active owner cannot be demoted, deactivated or removed', async () => {
    const mine = (await call('GET', '/org/me', ownerAToken)).body.data.memberId;
    const demote = await call('PATCH', `/org/members/${mine}`, ownerAToken, { role: 'ADMIN' });
    assert.equal(demote.status, 409);
    assert.equal(demote.body.code, 'LAST_OWNER');
    assert.equal((await call('POST', `/org/members/${mine}/deactivate`, ownerAToken, {})).status, 409);
    assert.equal((await call('DELETE', `/org/members/${mine}`, people.admin.token)).status, 403, 'admins cannot remove owners');
    // A Super Admin can't remove the last owner either
    const sa = await call('DELETE', `/org/members/${mine}?companyId=${companyA.id}`, adminToken);
    assert.equal(sa.status, 409);
    assert.equal(sa.body.code, 'LAST_OWNER');
  });

  await t.test('two owners demoting each other at the same time: one owner always remains', async () => {
    const mine = (await call('GET', '/org/me', ownerAToken)).body.data.memberId;
    assert.equal((await call('PATCH', `/org/members/${people.admin.memberId}`, ownerAToken, { role: 'OWNER' })).status, 200);
    const results = await Promise.all([
      call('PATCH', `/org/members/${people.admin.memberId}`, ownerAToken, { role: 'ADMIN' }),
      call('PATCH', `/org/members/${mine}`, people.admin.token, { role: 'ADMIN' }),
    ]);
    const owners = await prisma.organizationMember.count({ where: { companyId: companyA.id, role: 'OWNER', status: 'ACTIVE' } });
    assert.equal(owners, 1, `statuses ${results.map((r) => r.status).join(',')}`);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    // Restore: ownerA owner, admin back to ADMIN
    const ownerNow = await prisma.organizationMember.findFirst({ where: { companyId: companyA.id, role: 'OWNER', status: 'ACTIVE' } });
    if (ownerNow.userId !== ownerA.id) {
      await prisma.organizationMember.update({ where: { id: mine }, data: { role: 'OWNER' } });
      await prisma.organizationMember.update({ where: { id: people.admin.memberId }, data: { role: 'ADMIN' } });
    }
  });

  await t.test('ownership transfer: password required, roles and primary contact move, audited', async () => {
    const wrong = await call('POST', '/org/ownership/transfer', ownerAToken, { memberId: people.admin.memberId, password: 'Wrong@1234' });
    assert.equal(wrong.status, 401);
    assert.equal((await call('POST', '/org/ownership/transfer', people.admin.token, { memberId: people.admin.memberId, password: PASSWORD })).status, 403, 'only owners transfer');
    const ok = await call('POST', '/org/ownership/transfer', ownerAToken, { memberId: people.admin.memberId, password: PASSWORD });
    assert.equal(ok.status, 200, ok.body?.message);
    const roles = Object.fromEntries((await prisma.organizationMember.findMany({ where: { companyId: companyA.id, userId: { in: [ownerA.id, people.admin.userId] } } })).map((m) => [m.userId, m.role]));
    assert.equal(roles[people.admin.userId], 'OWNER');
    assert.equal(roles[ownerA.id], 'ADMIN');
    assert.equal((await prisma.company.findUnique({ where: { id: companyA.id } })).userId, people.admin.userId);
    const log = await prisma.auditLog.findFirst({ where: { action: 'ORG_OWNERSHIP_TRANSFERRED', companyId: companyA.id } });
    assert.equal(log.details.after.primaryContactUserId, people.admin.userId);
    // The former owner (now admin) still reaches the organization; transfer back for the remaining tests
    assert.equal((await call('GET', '/org/members', ownerAToken)).status, 200);
    const back = await call('POST', '/org/ownership/transfer', people.admin.token, { memberId: (await prisma.organizationMember.findFirst({ where: { companyId: companyA.id, userId: ownerA.id } })).id, password: PASSWORD });
    assert.equal(back.status, 200, back.body?.message);
  });

  await t.test('removal keeps history; a removed member can rejoin by invitation', async () => {
    const st = people.staff;
    const before = await prisma.auditLog.count({ where: { OR: [{ userId: st.userId }, { targetId: st.memberId }] } });
    assert.equal((await call('POST', `/org/members/${st.memberId}/deactivate`, st.token, {})).status, 403, 'no staff.manage');
    const res = await call('DELETE', `/org/members/${st.memberId}`, ownerAToken, { reason: 'Left the company' });
    assert.equal(res.status, 200, res.body?.message);
    const m = await prisma.organizationMember.findUnique({ where: { id: st.memberId } });
    assert.equal(m.status, 'REMOVED', 'membership row is kept');
    assert.equal(await prisma.staffEventAssignment.count({ where: { staffId: st.userId } }), 0);
    assert.ok((await prisma.auditLog.count({ where: { OR: [{ userId: st.userId }, { targetId: st.memberId }] } })) > before);
    assert.equal((await call('GET', '/events/organizer/my-events', st.token)).status, 403);
    assert.equal((await call('GET', '/auth/me', st.token)).status, 200);

    const again = await invite(mail('race'), 'STAFF', { eventIds: [a2.id] });
    const ok = await call('POST', '/auth/accept-invite', st.token, { token: again.token });
    assert.equal(ok.status, 200, ok.body?.message);
    assert.equal((await prisma.organizationMember.findUnique({ where: { id: st.memberId } })).status, 'ACTIVE', 'same row reactivated');
    const evs = await call('GET', '/events/organizer/my-events', st.token);
    assert.deepEqual(evs.body.data.events.map((e) => e.id), [a2.id]);
  });

  await t.test('activity history: organization-scoped, with actors, roles and before/after values', async () => {
    const res = await call('GET', '/org/activity?limit=200', ownerAToken);
    assert.equal(res.status, 200);
    const actions = new Set(res.body.data.items.map((i) => i.action));
    for (const a of ['ORG_INVITE_CREATED', 'ORG_INVITE_ACCEPTED', 'ORG_INVITE_REVOKED', 'ORG_INVITE_REJECTED', 'ORG_INVITE_RESENT', 'ORG_MEMBER_ROLE_CHANGED', 'ORG_MEMBER_PERMISSIONS_CHANGED', 'ORG_MEMBER_DEACTIVATED', 'ORG_MEMBER_REACTIVATED', 'ORG_MEMBER_REMOVED', 'ORG_OWNERSHIP_TRANSFERRED', 'SUPER_ADMIN_ORG_ACCESS']) {
      assert.ok(actions.has(a), `missing ${a}`);
    }
    const roleChange = res.body.data.items.find((i) => i.action === 'ORG_MEMBER_ROLE_CHANGED');
    assert.ok(roleChange.details.before.role && roleChange.details.after.role);
    assert.ok(res.body.data.items.every((i) => i.action !== 'ORG_INVITE_CREATED' || i.actor));
    // B sees none of A's history
    const b = await call('GET', '/org/activity?limit=200', ownerBToken);
    assert.ok(b.body.data.items.every((i) => !String(i.targetId).includes(people.staff.memberId)));
    // Actions logged by any feature are attributed to the organization and the actor's role
    await prisma.auditLog.create({ data: { userId: people.em.userId, action: 'EVENT_TEST_ACTION', targetType: 'Event', targetId: a1.id, details: { before: { x: 1 }, after: { x: 2 } } } });
    const row = await prisma.auditLog.findFirst({ where: { action: 'EVENT_TEST_ACTION', targetId: a1.id } });
    assert.equal(row.companyId, companyA.id);
    assert.equal(row.actorRole, 'EVENT_MANAGER');
    const csv = await fetch(`${api}/org/activity?format=csv`, { headers: { Authorization: `Bearer ${ownerAToken}` } });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    // Member-level history
    const mine = await call('GET', `/org/members/${people.em.memberId}/activity`, ownerAToken);
    assert.ok(mine.body.data.items.every((i) => i.actor?.id === people.em.userId));
  });

  await t.test('registering a company is refused for members of another organization', async () => {
    const res = await call('POST', '/companies/register', people.fin.token, {});
    assert.equal(res.status, 403, 'customers cannot register companies at all');
    const orgUser = await account('orgjoiner', 'ORGANIZER');
    const inv = await invite(orgUser.email, 'STAFF');
    assert.equal((await call('POST', '/auth/accept-invite', await login(orgUser.email), { token: inv.token })).status, 200);
    const reg = await call('POST', '/companies/register', await login(orgUser.email), { companyName: 'Second', ownerName: 'Test Orgjoiner', phone: '+923001112223', email: orgUser.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: 'https://example.com/a.pdf' });
    assert.equal(reg.status, 409, reg.body?.message);
  });

  // Clean up everything this test created
  const companyIds = [companyA.id, companyB.id];
  const userIds = [...new Set(createdUsers)];
  await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { userId: { in: userIds } }] } });
  await prisma.staffEventAssignment.deleteMany({ where: { OR: [{ staffId: { in: userIds } }, { event: { companyId: { in: companyIds } } }] } });
  await prisma.staffInvite.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.organizationMember.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { userId: { in: userIds } }] } });
  await prisma.behaviorEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.event.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await new Promise((resolve) => server.close(resolve));
});
