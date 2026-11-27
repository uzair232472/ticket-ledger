import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { reauthorizeUserRooms } from './socketAccess.js';
import { INVITE_TTL_MS } from '../config/auth.js';
import { sha256 } from './tokenService.js';
import { sendOrgInviteEmail } from './emailService.js';
import {
  AccessError,
  ALL_PERMISSIONS,
  EVENT_SCOPED_ROLES,
  OWNER_ONLY_ROLES,
  PERMISSIONS,
  RESERVED_PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  effectivePermissions,
} from './orgAccess.js';

/*
 * Organization membership: invitations, members, ownership and activity. Every function takes the actor's
 * organization context (`ctx`, from loadOrgContext: a member or a Super Admin who named the organization) and
 * scopes everything to ctx.companyId. Sensitive changes run in transactions; the owner check locks the company
 * row so two concurrent changes can't both remove the last owner.
 */

// ── Audit ──────────────────────────────────────────────────────────────────────────────────────────────

/** Organization activity row. `before` / `after` keep the changed values. */
export function orgAudit(db, { req, ctx, action, targetType, targetId, before, after, details }) {
  return db.auditLog.create({
    data: {
      userId: req?.user?.id || null,
      companyId: ctx.companyId,
      actorRole: ctx.role || null,
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent']?.slice(0, 300) || null,
      details: { ...(details || {}), ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) },
    },
  });
}

// ── Shared checks ──────────────────────────────────────────────────────────────────────────────────────

const isOwnerActor = (ctx) => ctx.superAdmin || ctx.role === 'OWNER';

/** Permissions the actor may hand out: their own (Super Admins: all). Reserved ones only to owners/admins. */
function assertGrantable(ctx, role, granted = []) {
  for (const p of granted) {
    if (!PERMISSIONS[p]) throw new AccessError(400, `Unknown permission: ${p}`);
    if (!ctx.superAdmin && !ctx.permissions.has(p)) throw new AccessError(403, `You can't grant a permission you don't have (${p}).`);
    if (RESERVED_PERMISSIONS.includes(p) && !OWNER_ONLY_ROLES.includes(role)) throw new AccessError(400, `${p} is only for owners and organization admins.`);
  }
}
const cleanPermissions = (list) => [...new Set((list || []).filter((p) => PERMISSIONS[p]))];

function assertRoleChangeAllowed(ctx, { fromRole = null, toRole }) {
  if (!ROLES.includes(toRole)) throw new AccessError(400, 'Unknown role.');
  if ((OWNER_ONLY_ROLES.includes(toRole) || OWNER_ONLY_ROLES.includes(fromRole)) && !isOwnerActor(ctx)) {
    throw new AccessError(403, 'Only an owner can make or change owners and organization admins.');
  }
}

/** Events must belong to the organization; event-scoped actors may only hand out their own events. */
async function validEventIds(db, ctx, eventIds = []) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (!ids.length) return [];
  const events = await db.event.findMany({ where: { id: { in: ids }, companyId: ctx.companyId }, select: { id: true } });
  if (events.length !== ids.length) throw new AccessError(404, 'One or more events were not found in your organization.');
  if (ctx.eventScoped && ids.some((id) => !ctx.eventIds.includes(id))) throw new AccessError(403, 'You can only assign events you are assigned to.');
  return ids;
}

/** Locks the company row, then fails if no ACTIVE owner would remain besides `exceptMemberId`. */
async function assertAnotherOwner(tx, companyId, exceptMemberId) {
  await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
  const others = await tx.organizationMember.count({ where: { companyId, role: 'OWNER', status: 'ACTIVE', id: { not: exceptMemberId } } });
  if (!others) throw new AccessError(409, 'An organization must keep at least one active owner. Make someone else an owner first.', 'LAST_OWNER');
}

async function loadMember(db, ctx, memberId) {
  const m = await db.organizationMember.findFirst({ where: { id: memberId, companyId: ctx.companyId }, include: { user: { select: { id: true, name: true, email: true, role: true, status: true } } } });
  if (!m) throw new AccessError(404, 'Member not found.');
  return m;
}

/** A change to this member needs an owner when the member is (or would become) an owner or admin. */
function assertCanManage(ctx, member) {
  if (OWNER_ONLY_ROLES.includes(member.role) && !isOwnerActor(ctx)) throw new AccessError(403, 'Only an owner can change owners and organization admins.');
}

const notifyAccessChange = (userId, companyId, eventIds = []) => {
  const io = getIO();
  if (!io) return;
  io.to(`user_${userId}`).emit('org:access-changed', { companyId });
  // Scanners wipe their offline lists for events they no longer cover
  for (const eventId of eventIds) io.to(`user_${userId}`).emit('staff:access-revoked', { eventId });
  // Live gate rooms follow the new access at once (attendance counters, supervisor exception requests)
  reauthorizeUserRooms(userId);
};

const companyEventAssignments = (db, userId, companyId) =>
  db.staffEventAssignment.findMany({ where: { staffId: userId, event: { companyId } }, select: { eventId: true } });

// ── Serialization ──────────────────────────────────────────────────────────────────────────────────────

export function serializeMember(m, assignments = []) {
  return {
    id: m.id,
    userId: m.userId,
    name: m.user?.name,
    email: m.user?.email,
    accountRole: m.user?.role,
    accountStatus: m.user?.status,
    role: m.role,
    roleLabel: ROLE_LABELS[m.role],
    status: m.status,
    grantedPermissions: m.grantedPermissions,
    revokedPermissions: m.revokedPermissions,
    permissions: effectivePermissions(m.role, m.grantedPermissions, m.revokedPermissions),
    eventScoped: EVENT_SCOPED_ROLES.includes(m.role),
    events: assignments,
    joinedAt: m.joinedAt,
    statusChangedAt: m.statusChangedAt,
    statusReason: m.statusReason,
  };
}

const serializeInvite = ({ tokenHash, ...invite }) => ({ ...invite, roleLabel: ROLE_LABELS[invite.role] });

export const roleCatalog = () => ({
  roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r], permissions: ROLE_PERMISSIONS[r], eventScoped: EVENT_SCOPED_ROLES.includes(r), ownerOnly: OWNER_ONLY_ROLES.includes(r) })),
  permissions: ALL_PERMISSIONS.map((p) => ({ key: p, description: PERMISSIONS[p], reserved: RESERVED_PERMISSIONS.includes(p) })),
});

// ── Members ────────────────────────────────────────────────────────────────────────────────────────────

export async function listMembers(ctx, { status } = {}) {
  const members = await prisma.organizationMember.findMany({
    where: { companyId: ctx.companyId, ...(status ? { status } : { status: { not: 'REMOVED' } }) },
    include: { user: { select: { id: true, name: true, email: true, role: true, status: true } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
  const assignments = await prisma.staffEventAssignment.findMany({
    where: { staffId: { in: members.map((m) => m.userId) }, event: { companyId: ctx.companyId } },
    select: { staffId: true, assignedAt: true, event: { select: { id: true, name: true, date: true } } },
  });
  const byUser = new Map();
  for (const a of assignments) byUser.set(a.staffId, [...(byUser.get(a.staffId) || []), { ...a.event, assignedAt: a.assignedAt }]);
  return members.map((m) => serializeMember(m, byUser.get(m.userId) || []));
}

export async function getMember(ctx, memberId) {
  const m = await loadMember(prisma, ctx, memberId);
  const rows = await prisma.staffEventAssignment.findMany({ where: { staffId: m.userId, event: { companyId: ctx.companyId } }, select: { assignedAt: true, event: { select: { id: true, name: true, date: true } } } });
  return serializeMember(m, rows.map((r) => ({ ...r.event, assignedAt: r.assignedAt })));
}

/** Role and custom permission changes (staff.roles). */
export async function updateMember(req, ctx, memberId, { role, grantedPermissions, revokedPermissions }) {
  const result = await prisma.$transaction(async (tx) => {
    const m = await loadMember(tx, ctx, memberId);
    if (m.status === 'REMOVED') throw new AccessError(409, 'This member was removed.');
    assertCanManage(ctx, m);
    const toRole = role || m.role;
    assertRoleChangeAllowed(ctx, { fromRole: m.role, toRole });
    const granted = grantedPermissions === undefined ? m.grantedPermissions : cleanPermissions(grantedPermissions);
    const revoked = revokedPermissions === undefined ? m.revokedPermissions : cleanPermissions(revokedPermissions);
    if (grantedPermissions !== undefined) assertGrantable(ctx, toRole, granted.filter((p) => !m.grantedPermissions.includes(p)));
    if (m.role === 'OWNER' && toRole !== 'OWNER' && m.status === 'ACTIVE') await assertAnotherOwner(tx, ctx.companyId, m.id);
    const before = { role: m.role, grantedPermissions: m.grantedPermissions, revokedPermissions: m.revokedPermissions };
    const updated = await tx.organizationMember.update({ where: { id: m.id }, data: { role: toRole, grantedPermissions: granted, revokedPermissions: revoked }, include: { user: { select: { id: true, name: true, email: true, role: true, status: true } } } });
    const after = { role: updated.role, grantedPermissions: updated.grantedPermissions, revokedPermissions: updated.revokedPermissions };
    if (before.role !== after.role) await orgAudit(tx, { req, ctx, action: 'ORG_MEMBER_ROLE_CHANGED', targetType: 'OrganizationMember', targetId: m.id, before: { role: before.role }, after: { role: after.role }, details: { userId: m.userId, email: m.user.email } });
    if (JSON.stringify(before.grantedPermissions) !== JSON.stringify(after.grantedPermissions) || JSON.stringify(before.revokedPermissions) !== JSON.stringify(after.revokedPermissions)) {
      await orgAudit(tx, { req, ctx, action: 'ORG_MEMBER_PERMISSIONS_CHANGED', targetType: 'OrganizationMember', targetId: m.id, before: { grantedPermissions: before.grantedPermissions, revokedPermissions: before.revokedPermissions }, after: { grantedPermissions: after.grantedPermissions, revokedPermissions: after.revokedPermissions }, details: { userId: m.userId, email: m.user.email } });
    }
    return updated;
  });
  notifyAccessChange(result.userId, ctx.companyId);
  return getMember(ctx, result.id);
}

/** Replaces the member's event assignments within this organization (staff.manage). */
export async function setMemberEvents(req, ctx, memberId, eventIds) {
  const { m, removed } = await prisma.$transaction(async (tx) => {
    const m = await loadMember(tx, ctx, memberId);
    if (m.status === 'REMOVED') throw new AccessError(409, 'This member was removed.');
    assertCanManage(ctx, m);
    const ids = await validEventIds(tx, ctx, eventIds);
    const current = (await companyEventAssignments(tx, m.userId, ctx.companyId)).map((a) => a.eventId);
    // An event-scoped actor only changes the events they cover themselves
    const manageable = ctx.eventScoped ? current.filter((id) => ctx.eventIds.includes(id)) : current;
    const removed = manageable.filter((id) => !ids.includes(id));
    const added = ids.filter((id) => !current.includes(id));
    if (removed.length) await tx.staffEventAssignment.deleteMany({ where: { staffId: m.userId, eventId: { in: removed } } });
    if (added.length) await tx.staffEventAssignment.createMany({ data: added.map((eventId) => ({ staffId: m.userId, eventId, assignedById: req.user.id })), skipDuplicates: true });
    if (removed.length || added.length) {
      await orgAudit(tx, { req, ctx, action: 'ORG_MEMBER_EVENTS_CHANGED', targetType: 'OrganizationMember', targetId: m.id, before: { eventIds: current }, after: { eventIds: [...current.filter((id) => !removed.includes(id)), ...added] }, details: { userId: m.userId, email: m.user.email, added, removed } });
    }
    return { m, removed };
  });
  notifyAccessChange(m.userId, ctx.companyId, removed);
  return getMember(ctx, m.id);
}

async function changeStatus(req, ctx, memberId, { to, reason, action }) {
  const out = await prisma.$transaction(async (tx) => {
    const m = await loadMember(tx, ctx, memberId);
    if (m.userId === req.user.id && to !== 'ACTIVE') throw new AccessError(409, 'You can’t deactivate or remove yourself. Ask another owner or admin.');
    assertCanManage(ctx, m);
    if (m.status === to) throw new AccessError(409, `This member is already ${to.toLowerCase()}.`);
    if (m.status === 'REMOVED' && to === 'ACTIVE') throw new AccessError(409, 'Removed members rejoin through a new invitation.');
    if (m.role === 'OWNER' && m.status === 'ACTIVE' && to !== 'ACTIVE') await assertAnotherOwner(tx, ctx.companyId, m.id);
    const assigned = (await companyEventAssignments(tx, m.userId, ctx.companyId)).map((a) => a.eventId);
    const updated = await tx.organizationMember.update({
      where: { id: m.id },
      data: { status: to, statusChangedAt: new Date(), statusChangedById: req.user.id, statusReason: reason ? String(reason).slice(0, 500) : null },
    });
    if (to === 'REMOVED') {
      // Current access only: their past actions stay in the audit log and scans
      await tx.staffEventAssignment.deleteMany({ where: { staffId: m.userId, eventId: { in: assigned } } });
      await tx.user.updateMany({ where: { id: m.userId, companyId: ctx.companyId }, data: { companyId: null } });
      // The company's primary contact moves to another active owner
      const company = await tx.company.findUnique({ where: { id: ctx.companyId }, select: { userId: true } });
      if (company.userId === m.userId) {
        const next = await tx.organizationMember.findFirst({ where: { companyId: ctx.companyId, role: 'OWNER', status: 'ACTIVE', id: { not: m.id } }, orderBy: { joinedAt: 'asc' } });
        if (next) await tx.company.update({ where: { id: ctx.companyId }, data: { userId: next.userId } });
      }
    }
    // Legacy gate staff deactivation (before memberships) also set the account to DEACTIVATED; undo only that
    if (to === 'ACTIVE' && m.user.role === 'GATE_STAFF' && m.user.status === 'DEACTIVATED') {
      await tx.user.update({ where: { id: m.userId }, data: { status: 'ACTIVE' } });
    }
    await orgAudit(tx, { req, ctx, action, targetType: 'OrganizationMember', targetId: m.id, before: { status: m.status }, after: { status: to }, details: { userId: m.userId, email: m.user.email, role: m.role, reason: reason || null, ...(to === 'REMOVED' ? { removedEventIds: assigned } : {}) } });
    return { updated, assigned };
  });
  notifyAccessChange(out.updated.userId, ctx.companyId, to === 'ACTIVE' ? [] : out.assigned);
  if (to !== 'ACTIVE') {
    await prisma.notification.create({
      data: {
        userId: out.updated.userId,
        type: to === 'REMOVED' ? 'STAFF_REMOVED' : 'STAFF_DEACTIVATED',
        title: `${to === 'REMOVED' ? 'Removed from' : 'Access paused at'} ${ctx.company.companyName}`,
        message: `${to === 'REMOVED' ? 'You are no longer a member of' : 'Your access to'} ${ctx.company.companyName}${to === 'REMOVED' ? '' : ' has been paused'}. Your TicketLedger account and tickets are not affected.`,
      },
    });
  }
  return to === 'REMOVED' ? { id: out.updated.id, status: 'REMOVED' } : getMember(ctx, out.updated.id);
}

export const deactivateMember = (req, ctx, id, reason) => changeStatus(req, ctx, id, { to: 'DEACTIVATED', reason, action: 'ORG_MEMBER_DEACTIVATED' });
export const reactivateMember = (req, ctx, id) => changeStatus(req, ctx, id, { to: 'ACTIVE', action: 'ORG_MEMBER_REACTIVATED' });
export const removeMember = (req, ctx, id, reason) => changeStatus(req, ctx, id, { to: 'REMOVED', reason, action: 'ORG_MEMBER_REMOVED' });

/**
 * Makes another ACTIVE member an owner (owners only, password re-entered). The new owner also becomes the
 * company's primary contact (Company.userId). `stepDown`: the current owner becomes an Organization Admin.
 */
export async function transferOwnership(req, ctx, { memberId, password, stepDown = true }) {
  if (ctx.role !== 'OWNER') throw new AccessError(403, 'Only an owner can transfer ownership.');
  const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });
  if (!password || !(await bcrypt.compare(String(password), me.passwordHash))) throw new AccessError(401, 'Your password is incorrect.');
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${ctx.companyId} FOR UPDATE`;
    const target = await loadMember(tx, ctx, memberId);
    if (target.status !== 'ACTIVE') throw new AccessError(409, 'Only an active member can become an owner.');
    if (target.userId === req.user.id) throw new AccessError(409, 'You are already an owner.');
    const mine = await tx.organizationMember.findFirst({ where: { companyId: ctx.companyId, userId: req.user.id, status: 'ACTIVE', role: 'OWNER' } });
    if (!mine) throw new AccessError(403, 'Only an active owner can transfer ownership.');
    const company = await tx.company.findUnique({ where: { id: ctx.companyId }, select: { userId: true } });
    await tx.organizationMember.update({ where: { id: target.id }, data: { role: 'OWNER' } });
    if (stepDown) await tx.organizationMember.update({ where: { id: mine.id }, data: { role: 'ADMIN' } });
    await tx.company.update({ where: { id: ctx.companyId }, data: { userId: target.userId } });
    await tx.user.update({ where: { id: target.userId }, data: { companyId: ctx.companyId } });
    await orgAudit(tx, {
      req,
      ctx,
      action: 'ORG_OWNERSHIP_TRANSFERRED',
      targetType: 'OrganizationMember',
      targetId: target.id,
      before: { newOwnerRole: target.role, previousOwnerRole: 'OWNER', primaryContactUserId: company.userId },
      after: { newOwnerRole: 'OWNER', previousOwnerRole: stepDown ? 'ADMIN' : 'OWNER', primaryContactUserId: target.userId },
      details: { fromUserId: req.user.id, toUserId: target.userId, toEmail: target.user.email },
    });
  });
  notifyAccessChange(req.user.id, ctx.companyId);
  return listMembers(ctx);
}

// ── Invitations ────────────────────────────────────────────────────────────────────────────────────────

const INVITE_INCLUDE = { company: { select: { id: true, companyName: true, status: true } }, invitedBy: { select: { id: true, name: true, email: true } }, event: { select: { id: true, name: true, date: true } } };
const newToken = () => {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: sha256(raw), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
};

export const expireStaleInvites = (where = {}) => prisma.staffInvite.updateMany({ where: { ...where, status: 'PENDING', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });

async function eventNames(ids) {
  if (!ids.length) return [];
  return (await prisma.event.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((e) => e.name);
}

/** Whether an email may be invited to this organization (one organization per user). */
async function assertInvitable(db, ctx, email) {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user) return null;
  if (user.role === 'SUPER_ADMIN') throw new AccessError(409, 'TicketLedger administrators can’t join organizations.');
  const open = await db.organizationMember.findFirst({ where: { userId: user.id, status: { not: 'REMOVED' } }, select: { companyId: true } });
  if (open?.companyId === ctx.companyId) throw new AccessError(409, 'This person is already a member of your organization.');
  if (open) throw new AccessError(409, 'This person already belongs to another organization.');
  return user;
}

export async function createInvitation(req, ctx, input) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError(400, 'Invalid email address.');
  const role = input.role || 'STAFF';
  assertRoleChangeAllowed(ctx, { toRole: role });
  const granted = cleanPermissions(input.grantedPermissions);
  const revoked = cleanPermissions(input.revokedPermissions);
  assertGrantable(ctx, role, granted);
  if (ctx.company.status !== 'APPROVED' && !ctx.superAdmin) throw new AccessError(403, 'Your company must be approved before you can invite people.');

  const token = newToken();
  const { invite, existing } = await prisma.$transaction(async (tx) => {
    const ids = await validEventIds(tx, ctx, input.eventIds || []);
    const existing = await assertInvitable(tx, ctx, email);
    // A new invitation replaces any open one to the same email for this organization
    await tx.staffInvite.updateMany({ where: { email, companyId: ctx.companyId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    const invite = await tx.staffInvite.create({
      data: { email, companyId: ctx.companyId, eventId: ids.length === 1 && role === 'GATE_STAFF' ? ids[0] : null, role, eventIds: ids, grantedPermissions: granted, revokedPermissions: revoked, invitedById: req.user.id, tokenHash: token.hash, expiresAt: token.expiresAt },
      include: INVITE_INCLUDE,
    });
    await orgAudit(tx, { req, ctx, action: 'ORG_INVITE_CREATED', targetType: 'StaffInvite', targetId: invite.id, after: { email, role, eventIds: ids, grantedPermissions: granted, revokedPermissions: revoked }, details: { existingAccount: Boolean(existing) } });
    return { invite, existing };
  });
  const delivery = await sendOrgInviteEmail({ to: email, inviteToken: token.raw, companyName: invite.company.companyName, inviterName: req.user.name, roleLabel: ROLE_LABELS[role], eventNames: await eventNames(invite.eventIds), existingAccount: Boolean(existing) });
  return { invite: serializeInvite(invite), emailSent: delivery.success, existingAccount: Boolean(existing) };
}

export async function listInvitations(ctx, { status } = {}) {
  await expireStaleInvites({ companyId: ctx.companyId });
  const invites = await prisma.staffInvite.findMany({ where: { companyId: ctx.companyId, ...(status ? { status } : {}) }, include: INVITE_INCLUDE, orderBy: { createdAt: 'desc' } });
  return invites.map(serializeInvite);
}

async function loadInvite(db, ctx, id) {
  const invite = await db.staffInvite.findFirst({ where: { id, companyId: ctx.companyId }, include: INVITE_INCLUDE });
  if (!invite) throw new AccessError(404, 'Invitation not found.');
  return invite;
}

/** A new link and a fresh expiry; the previous link stops working. */
export async function resendInvitation(req, ctx, id) {
  const token = newToken();
  const invite = await prisma.$transaction(async (tx) => {
    const invite = await loadInvite(tx, ctx, id);
    if (!['PENDING', 'EXPIRED'].includes(invite.status)) throw new AccessError(409, `This invitation was ${invite.status.toLowerCase()} and can't be resent.`);
    assertRoleChangeAllowed(ctx, { toRole: invite.role });
    await assertInvitable(tx, ctx, invite.email);
    const updated = await tx.staffInvite.update({ where: { id }, data: { tokenHash: token.hash, expiresAt: token.expiresAt, status: 'PENDING' }, include: INVITE_INCLUDE });
    await orgAudit(tx, { req, ctx, action: 'ORG_INVITE_RESENT', targetType: 'StaffInvite', targetId: id, before: { status: invite.status, expiresAt: invite.expiresAt }, after: { status: 'PENDING', expiresAt: token.expiresAt }, details: { email: invite.email } });
    return updated;
  });
  const existing = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  const delivery = await sendOrgInviteEmail({ to: invite.email, inviteToken: token.raw, companyName: invite.company.companyName, inviterName: req.user.name, roleLabel: ROLE_LABELS[invite.role], eventNames: await eventNames(invite.eventIds), existingAccount: Boolean(existing) });
  return { invite: serializeInvite(invite), emailSent: delivery.success };
}

export async function revokeInvitation(req, ctx, id) {
  return prisma.$transaction(async (tx) => {
    const invite = await loadInvite(tx, ctx, id);
    const { count } = await tx.staffInvite.updateMany({ where: { id, status: { in: ['PENDING', 'EXPIRED'] } }, data: { status: 'REVOKED', revokedById: req.user.id, respondedAt: new Date() } });
    if (!count) throw new AccessError(409, `This invitation was already ${invite.status.toLowerCase()}.`);
    await orgAudit(tx, { req, ctx, action: 'ORG_INVITE_REVOKED', targetType: 'StaffInvite', targetId: id, before: { status: invite.status }, after: { status: 'REVOKED' }, details: { email: invite.email } });
    return { id, status: 'REVOKED' };
  });
}

// ── Invitation responses (by token; the invitee) ───────────────────────────────────────────────────────

/** The invitation behind a raw token if it can still be used; expired ones are marked EXPIRED. */
export async function usableInvite(rawToken, db = prisma) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const invite = await db.staffInvite.findUnique({ where: { tokenHash: sha256(rawToken) }, include: INVITE_INCLUDE });
  if (!invite || invite.status !== 'PENDING') return null;
  if (invite.expiresAt < new Date()) {
    await db.staffInvite.updateMany({ where: { id: invite.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return null;
  }
  return invite;
}

export async function previewInvitation(rawToken) {
  const invite = await usableInvite(rawToken);
  if (!invite) return null;
  const account = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  return {
    email: invite.email,
    role: invite.role,
    roleLabel: ROLE_LABELS[invite.role],
    companyName: invite.company.companyName,
    invitedBy: invite.invitedBy?.name || null,
    events: await prisma.event.findMany({ where: { id: { in: invite.eventIds } }, select: { id: true, name: true, date: true, venue: true, city: true } }),
    expiresAt: invite.expiresAt,
    existingAccount: Boolean(account),
  };
}

const actorCtxFor = (invite, role) => ({ companyId: invite.companyId, role, company: invite.company });

/**
 * Accepts an invitation, once. Signed in: the account's verified email must be the invited one. Not signed in:
 * creates the account (only when no account uses the email). The claim (PENDING → ACCEPTED) is the first write,
 * so of two simultaneous acceptances exactly one succeeds.
 */
export async function acceptInvitation(req, { token, name, passwordHash }) {
  const hash = sha256(String(token || ''));
  return prisma.$transaction(async (tx) => {
    const invite = await tx.staffInvite.findUnique({ where: { tokenHash: hash }, include: INVITE_INCLUDE });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) throw new AccessError(410, 'This invite link is no longer valid. Ask the organizer to send a new one.', 'INVITE_INVALID');

    let user = null;
    if (req.user) {
      if (req.user.email.toLowerCase() !== invite.email.toLowerCase()) throw new AccessError(403, `This invitation is for ${invite.email}. Sign in with that account to accept it.`, 'INVITE_EMAIL_MISMATCH');
      user = await tx.user.findUnique({ where: { id: req.user.id } });
      if (!user.emailVerifiedAt) throw new AccessError(403, 'Verify your email address before accepting an invitation.', 'EMAIL_NOT_VERIFIED');
      if (user.role === 'SUPER_ADMIN') throw new AccessError(409, 'TicketLedger administrators can’t join organizations.');
    } else if (await tx.user.findUnique({ where: { email: invite.email }, select: { id: true } })) {
      throw new AccessError(409, 'An account already uses this email. Sign in to accept the invitation.', 'SIGN_IN_TO_ACCEPT');
    }

    // Single use: only one request moves the invitation out of PENDING
    const claimed = await tx.staffInvite.updateMany({ where: { id: invite.id, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'ACCEPTED', acceptedAt: new Date(), respondedAt: new Date() } });
    if (!claimed.count) throw new AccessError(410, 'This invite link is no longer valid. Ask the organizer to send a new one.', 'INVITE_INVALID');

    if (!user) {
      if (!name || !passwordHash) throw new AccessError(400, 'Name and password are required to create your account.');
      user = await tx.user.create({
        data: { name, email: invite.email, passwordHash, role: invite.role === 'GATE_STAFF' ? 'GATE_STAFF' : 'CUSTOMER', status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true, companyId: invite.companyId },
      });
    }

    const open = await tx.organizationMember.findFirst({ where: { userId: user.id, status: { not: 'REMOVED' } } });
    if (open) throw new AccessError(409, open.companyId === invite.companyId ? 'You are already a member of this organization.' : 'You already belong to another organization. Leave it before joining a new one.');
    const previous = await tx.organizationMember.findUnique({ where: { companyId_userId: { companyId: invite.companyId, userId: user.id } } });
    const data = { role: invite.role, status: 'ACTIVE', grantedPermissions: invite.grantedPermissions, revokedPermissions: invite.revokedPermissions, invitedById: invite.invitedById, inviteId: invite.id, joinedAt: new Date(), statusChangedAt: previous ? new Date() : null, statusChangedById: null, statusReason: previous ? 'Rejoined by invitation' : null };
    const member = previous
      ? await tx.organizationMember.update({ where: { id: previous.id }, data })
      : await tx.organizationMember.create({ data: { companyId: invite.companyId, userId: user.id, ...data } });
    await tx.user.update({ where: { id: user.id }, data: { companyId: invite.companyId } });
    const events = await tx.event.findMany({ where: { id: { in: invite.eventIds }, companyId: invite.companyId }, select: { id: true } });
    if (events.length) await tx.staffEventAssignment.createMany({ data: events.map((e) => ({ staffId: user.id, eventId: e.id, assignedById: invite.invitedById })), skipDuplicates: true });
    await tx.staffInvite.update({ where: { id: invite.id }, data: { acceptedUserId: user.id } });

    await orgAudit(tx, { req: { ...req, user }, ctx: actorCtxFor(invite, invite.role), action: 'ORG_INVITE_ACCEPTED', targetType: 'StaffInvite', targetId: invite.id, before: { status: 'PENDING' }, after: { status: 'ACCEPTED' }, details: { email: invite.email, memberId: member.id, role: invite.role, newAccount: !req.user, rejoined: Boolean(previous) } });
    return { user, member, invite };
  });
}

export async function rejectInvitation(req, rawToken) {
  return prisma.$transaction(async (tx) => {
    const invite = await usableInvite(rawToken, tx);
    if (!invite) throw new AccessError(410, 'This invite link is no longer valid.', 'INVITE_INVALID');
    if (req.user && req.user.email.toLowerCase() !== invite.email.toLowerCase()) throw new AccessError(403, `This invitation is for ${invite.email}.`, 'INVITE_EMAIL_MISMATCH');
    const { count } = await tx.staffInvite.updateMany({ where: { id: invite.id, status: 'PENDING' }, data: { status: 'REJECTED', respondedAt: new Date() } });
    if (!count) throw new AccessError(410, 'This invite link is no longer valid.', 'INVITE_INVALID');
    await orgAudit(tx, { req, ctx: actorCtxFor(invite, null), action: 'ORG_INVITE_REJECTED', targetType: 'StaffInvite', targetId: invite.id, before: { status: 'PENDING' }, after: { status: 'REJECTED' }, details: { email: invite.email } });
    return { status: 'REJECTED' };
  });
}

// ── Activity ───────────────────────────────────────────────────────────────────────────────────────────

export async function listActivity(ctx, { userId, memberId, action, from, to, page = 1, limit = 50 } = {}) {
  let actorId = userId;
  if (memberId) actorId = (await loadMember(prisma, ctx, memberId)).userId;
  const where = {
    companyId: ctx.companyId,
    ...(actorId ? { userId: actorId } : {}),
    ...(action ? { action: { startsWith: String(action).toUpperCase() } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
  };
  const take = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    total,
    page: Math.max(Number(page) || 1, 1),
    limit: take,
    items: rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, actor: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email } : null, actorRole: r.actorRole, targetType: r.targetType, targetId: r.targetId, details: r.details, ipAddress: r.ipAddress })),
  };
}

export const activityCsv = (items) => {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['time', 'action', 'actor', 'actorEmail', 'actorRole', 'targetType', 'targetId', 'details'];
  return [head.join(','), ...items.map((i) => [i.at.toISOString(), i.action, i.actor?.name, i.actor?.email, i.actorRole, i.targetType, i.targetId, JSON.stringify(i.details || {})].map(cell).join(','))].join('\n');
};
