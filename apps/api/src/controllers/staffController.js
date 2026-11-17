import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { sendStaffInviteEmail } from '../services/emailService.js';
import { sha256 } from '../services/tokenService.js';
import { getScopedEventIds } from '../services/accessService.js';
import { ALL_PERMISSIONS, AccessError, canAccessEvent, requestContext } from '../services/orgAccess.js';
import { deactivateMember, expireStaleInvites, orgAudit, reactivateMember } from '../services/orgService.js';
import { INVITE_TTL_MS, MESSAGES } from '../config/auth.js';

/*
 * Gate staff (scanner) management: the Gate Staff tab of the Team page and the event pages. Gate staff are
 * organization members with the GATE_STAFF role, assigned to events. Scope always comes from the caller's ACTIVE
 * membership (staff.* permissions); Super Admins act across organizations, audited with the organization id.
 */

const NOT_OWN_STAFF = "You can only manage your own company's staff.";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  eventId: z.string().min(1, 'Event is required'),
});

const listSchema = z.object({
  eventId: z.string().optional(),
  companyId: z.string().optional(),
  status: z.enum(['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'REVOKED']).optional(),
});

const INVITE_INCLUDE = {
  event: { select: { id: true, name: true, date: true } },
  company: { select: { id: true, companyName: true } },
  invitedBy: { select: { id: true, name: true, email: true, role: true } },
};

// Never expose the token hash
const serializeInvite = ({ tokenHash, ...invite }) => invite;

const handleError = (res, error, context) => {
  if (error instanceof AccessError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Validation error' });
  }
  console.error(`${context} error:`, error);
  return res.status(500).json({ success: false, message: `Server error while trying to ${context.toLowerCase()}` });
};

/**
 * Organization scope: null = all organizations (Super Admin), otherwise the caller's organization when they hold
 * `permission`. Members without it get an empty string, which matches nothing.
 */
const resolveCompanyScope = async (req, permission) => {
  if (req.user.role === 'SUPER_ADMIN') return null;
  const ctx = await requestContext(req);
  return ctx && ctx.permissions.has(permission) ? ctx.companyId : '';
};
const canManageCompany = (scope, companyId) => scope === null || (scope !== '' && scope === companyId);

/** The organization context used for a membership change: the caller's own, or a Super Admin's for that company. */
async function contextFor(req, companyId) {
  if (req.user.role !== 'SUPER_ADMIN') return requestContext(req);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, companyName: true, status: true, userId: true, email: true } });
  return { superAdmin: true, companyId, company, role: 'SUPER_ADMIN', permissions: new Set(ALL_PERMISSIONS), eventScoped: false, eventIds: null };
}

/** The gate staff membership of a user, within the caller's scope. */
async function findStaffMembership(req, userId, permission) {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: 'GATE_STAFF', status: { not: 'REMOVED' } },
    include: { user: { select: { id: true, name: true, email: true, status: true, companyId: true } } },
  });
  if (!membership) return { error: [404, 'Staff member not found.'] };
  const scope = await resolveCompanyScope(req, permission);
  if (!canManageCompany(scope, membership.companyId)) return { error: [403, NOT_OWN_STAFF] };
  return { membership };
}

const newInviteToken = () => {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: sha256(raw), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
};

const sendInvite = async (invite, rawToken, inviter) =>
  sendStaffInviteEmail({
    to: invite.email,
    inviteToken: rawToken,
    eventName: invite.event?.name || 'your events',
    companyName: invite.company.companyName,
    inviterName: inviter.name,
  });

/**
 * POST /api/staff/invites — invite gate staff to an event (or assign an existing staff member)
 */
export const createInvite = async (req, res) => {
  try {
    const { email, eventId } = inviteSchema.parse(req.body);

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { company: { select: { id: true, companyName: true, status: true } } },
    });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    // Ownership is checked against the caller's own membership (and event scope), never against client input
    if (!(await canAccessEvent(req.user, event, { permission: 'staff.invite', req }))) {
      return res.status(403).json({ success: false, message: MESSAGES.INVITE_NOT_OWN_EVENT });
    }
    if (req.user.role !== 'SUPER_ADMIN' && event.company.status !== 'APPROVED') {
      return res.status(403).json({ success: false, message: MESSAGES.COMPANY_NOT_APPROVED });
    }
    const ctx = await contextFor(req, event.companyId);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === 'SUPER_ADMIN') {
        return res.status(409).json({ success: false, message: MESSAGES.INVITE_EMAIL_TAKEN });
      }
      const membership = await prisma.organizationMember.findFirst({ where: { userId: existing.id, status: { not: 'REMOVED' } } });
      if (membership && membership.companyId !== event.companyId) {
        return res.status(409).json({ success: false, message: 'This staff member belongs to another company.' });
      }
      if (membership?.status === 'DEACTIVATED') {
        return res.status(409).json({ success: false, message: 'This staff member is deactivated. Reactivate them in your staff list first.' });
      }
      if (membership && existing.status !== 'ACTIVE') {
        return res.status(409).json({ success: false, message: 'This staff account is blocked by TicketLedger. Contact support.' });
      }
      if (membership) {
        // Same organization: assign the existing member to this event, no new invite needed
        const assignment = await prisma.staffEventAssignment.upsert({
          where: { staffId_eventId: { staffId: existing.id, eventId } },
          update: {},
          create: { staffId: existing.id, eventId, assignedById: req.user.id },
        });
        await orgAudit(prisma, { req, ctx, action: 'ORG_MEMBER_EVENTS_CHANGED', targetType: 'OrganizationMember', targetId: membership.id, after: { added: [eventId] }, details: { userId: existing.id, email } });
        return res.status(200).json({
          success: true,
          message: `${existing.name} already has a staff account and is now assigned to ${event.name}.`,
          data: { assignment, assignedExisting: true },
        });
      }
      // An existing TicketLedger account without an organization: invited like anyone else, accepts by signing in
    }

    const token = newInviteToken();
    const invite = await prisma.$transaction(async (tx) => {
      // A new invite replaces any open one for the same email and event; the old link stops working
      await tx.staffInvite.updateMany({
        where: { email, eventId, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
      const created = await tx.staffInvite.create({
        data: { email, companyId: event.companyId, eventId, role: 'GATE_STAFF', eventIds: [eventId], invitedById: req.user.id, tokenHash: token.hash, expiresAt: token.expiresAt },
        include: INVITE_INCLUDE,
      });
      await orgAudit(tx, { req, ctx, action: 'ORG_INVITE_CREATED', targetType: 'StaffInvite', targetId: created.id, after: { email, role: 'GATE_STAFF', eventIds: [eventId] }, details: { existingAccount: Boolean(existing) } });
      return created;
    });

    const delivery = await sendInvite(invite, token.raw, req.user);
    return res.status(201).json({
      success: true,
      message: delivery.success ? `Invite sent to ${email}.` : `Invite created, but the email to ${email} could not be sent. Try resending.`,
      data: { invite: serializeInvite(invite), emailSent: delivery.success, existingAccount: Boolean(existing) },
    });
  } catch (error) {
    return handleError(res, error, 'Send invite');
  }
};

/**
 * GET /api/staff — gate staff members and their invites, scoped to the caller's organization
 */
export const listStaff = async (req, res) => {
  try {
    const filters = listSchema.parse(req.query);
    const scope = await resolveCompanyScope(req, 'staff.view');
    const companyId = scope === null ? filters.companyId : scope;

    const inviteWhere = {
      role: 'GATE_STAFF',
      ...(companyId !== undefined ? { companyId } : {}),
      ...(filters.eventId ? { eventIds: { has: filters.eventId } } : {}),
    };
    await expireStaleInvites(companyId !== undefined ? { companyId } : {});

    const [invites, members] = await Promise.all([
      prisma.staffInvite.findMany({
        where: { ...inviteWhere, ...(filters.status ? { status: filters.status } : {}) },
        include: INVITE_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organizationMember.findMany({
        where: {
          role: 'GATE_STAFF',
          status: { not: 'REMOVED' },
          ...(companyId !== undefined ? { companyId } : {}),
          ...(filters.eventId ? { user: { staffAssignments: { some: { eventId: filters.eventId } } } } : {}),
        },
        include: {
          company: { select: { id: true, companyName: true } },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              status: true,
              createdAt: true,
              staffAssignments: { select: { assignedAt: true, event: { select: { id: true, name: true, date: true, companyId: true } } }, orderBy: { assignedAt: 'desc' } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const staff = members.map((m) => ({
      id: m.user.id,
      memberId: m.id,
      name: m.user.name,
      email: m.user.email,
      // Organization access; accountStatus is the TicketLedger account itself
      status: m.status === 'ACTIVE' && m.user.status !== 'ACTIVE' ? m.user.status : m.status,
      accountStatus: m.user.status,
      createdAt: m.user.createdAt,
      companyId: m.companyId,
      memberOfCompany: m.company,
      staffAssignments: m.user.staffAssignments.filter((a) => a.event.companyId === m.companyId).map(({ event: { companyId: _c, ...event }, ...a }) => ({ ...a, event })),
    }));

    return res.status(200).json({ success: true, data: { staff, invites: invites.map(serializeInvite) } });
  } catch (error) {
    return handleError(res, error, 'Load staff');
  }
};

/**
 * GET /api/staff/events — events the caller may invite staff for (with companies for the admin filter)
 */
export const listInvitableEvents = async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req, 'staff.invite');
    const companyFilter = scope === null ? req.query.companyId : scope;
    const ctx = scope === null ? null : await requestContext(req);

    const events = await prisma.event.findMany({
      where: {
        ...(companyFilter !== undefined ? { companyId: companyFilter } : {}),
        ...(ctx?.eventScoped ? { id: { in: ctx.eventIds } } : {}),
      },
      select: { id: true, name: true, date: true, city: true, status: true, company: { select: { id: true, companyName: true } } },
      orderBy: { date: 'asc' },
    });

    const companies = scope === null
      ? await prisma.company.findMany({ where: { events: { some: {} } }, select: { id: true, companyName: true }, orderBy: { companyName: 'asc' } })
      : [];

    return res.status(200).json({ success: true, data: { events, companies } });
  } catch (error) {
    return handleError(res, error, 'Load events');
  }
};

/**
 * POST /api/staff/invites/:id/resend — new link and a fresh 72 h expiry; the previous link stops working
 */
export const resendInvite = async (req, res) => {
  try {
    const invite = await prisma.staffInvite.findUnique({ where: { id: req.params.id } });
    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found.' });

    const scope = await resolveCompanyScope(req, 'staff.invite');
    if (!canManageCompany(scope, invite.companyId)) {
      return res.status(403).json({ success: false, message: NOT_OWN_STAFF });
    }
    if (!['PENDING', 'EXPIRED'].includes(invite.status)) {
      return res.status(409).json({ success: false, message: `This invite was ${invite.status.toLowerCase()} and cannot be resent.` });
    }
    const existing = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    if (existing && (await prisma.organizationMember.findFirst({ where: { userId: existing.id, status: { not: 'REMOVED' } }, select: { id: true } }))) {
      return res.status(409).json({ success: false, message: 'This person already belongs to an organization.' });
    }

    const token = newInviteToken();
    const updated = await prisma.staffInvite.update({
      where: { id: invite.id },
      data: { tokenHash: token.hash, expiresAt: token.expiresAt, status: 'PENDING' },
      include: INVITE_INCLUDE,
    });
    await orgAudit(prisma, { req, ctx: await contextFor(req, invite.companyId), action: 'ORG_INVITE_RESENT', targetType: 'StaffInvite', targetId: invite.id, before: { status: invite.status, expiresAt: invite.expiresAt }, after: { status: 'PENDING', expiresAt: token.expiresAt }, details: { email: invite.email } });

    const delivery = await sendInvite(updated, token.raw, req.user);
    return res.status(200).json({
      success: true,
      message: delivery.success ? `Invite resent to ${updated.email}.` : 'The email could not be sent. Please try again.',
      data: { invite: serializeInvite(updated), emailSent: delivery.success },
    });
  } catch (error) {
    return handleError(res, error, 'Resend invite');
  }
};

/**
 * DELETE /api/staff/invites/:id — cancels the invite; its link stops working immediately
 */
export const cancelInvite = async (req, res) => {
  try {
    const invite = await prisma.staffInvite.findUnique({ where: { id: req.params.id } });
    if (!invite) return res.status(404).json({ success: false, message: 'Invite not found.' });

    const scope = await resolveCompanyScope(req, 'staff.invite');
    if (!canManageCompany(scope, invite.companyId)) {
      return res.status(403).json({ success: false, message: NOT_OWN_STAFF });
    }
    if (invite.status === 'ACCEPTED') {
      return res.status(409).json({ success: false, message: 'This invite was already accepted. Deactivate the staff account instead.' });
    }

    await prisma.staffInvite.update({ where: { id: invite.id }, data: { status: 'CANCELLED', revokedById: req.user.id, respondedAt: new Date() } });
    await orgAudit(prisma, { req, ctx: await contextFor(req, invite.companyId), action: 'ORG_INVITE_REVOKED', targetType: 'StaffInvite', targetId: invite.id, before: { status: invite.status }, after: { status: 'CANCELLED' }, details: { email: invite.email } });
    return res.status(204).end();
  } catch (error) {
    return handleError(res, error, 'Cancel invite');
  }
};

/**
 * PATCH /api/staff/:id/deactivate — takes away the member's organization access at once (scanning, offline
 * packs). Their TicketLedger account stays active; scanners are told to wipe their offline lists.
 */
export const deactivateStaff = async (req, res) => {
  try {
    const { membership, error } = await findStaffMembership(req, req.params.id, 'staff.manage');
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    const ctx = await contextFor(req, membership.companyId);
    await deactivateMember(req, ctx, membership.id, req.body?.reason);
    const staff = { id: membership.user.id, name: membership.user.name, email: membership.user.email, status: 'DEACTIVATED', accountStatus: membership.user.status, companyId: membership.companyId };
    return res.status(200).json({ success: true, message: `${membership.user.name} has been deactivated.`, data: { staff } });
  } catch (error) {
    return handleError(res, error, 'Deactivate staff');
  }
};

/**
 * DELETE /api/staff/:id/events/:eventId — takes one event away from a gate staff member. The API stops
 * accepting their scans, offline packs and offline uploads for that event at once, and any scanner they
 * have open is told to wipe its offline list (a device that is offline learns at its next connection).
 */
export const revokeEventAccess = async (req, res) => {
  try {
    const { id: staffId, eventId } = req.params;
    const { membership, error } = await findStaffMembership(req, staffId, 'staff.manage');
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    const staff = membership.user;
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, companyId: true } });
    if (!event || event.companyId !== membership.companyId || !(await canAccessEvent(req.user, event, { permission: 'staff.manage', req }))) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const { count } = await prisma.staffEventAssignment.deleteMany({ where: { staffId, eventId } });
    if (!count) {
      return res.status(200).json({ success: true, message: `${staff.name} wasn’t assigned to ${event.name}.` });
    }

    await orgAudit(prisma, { req, ctx: await contextFor(req, membership.companyId), action: 'STAFF_EVENT_ACCESS_REVOKED', targetType: 'OrganizationMember', targetId: membership.id, before: { eventIds: [eventId] }, after: { eventIds: [] }, details: { userId: staffId, email: staff.email, eventId, eventName: event.name } });
    await prisma.notification.create({
      data: {
        userId: staffId,
        type: 'STAFF_ACCESS_REVOKED',
        title: `Scanner access removed: ${event.name}`,
        message: `You can no longer scan tickets for ${event.name}. Contact your organizer if this is a mistake.`,
      },
    });
    getIO()?.to(`user_${staffId}`).emit('staff:access-revoked', { eventId });

    return res.status(200).json({ success: true, message: `${staff.name} can no longer scan tickets for ${event.name}.` });
  } catch (error) {
    return handleError(res, error, 'Revoke event access');
  }
};

/**
 * PATCH /api/staff/:id/reactivate — gives a deactivated gate staff member their organization access back.
 * Accounts suspended or banned by TicketLedger stay blocked (only support restores those).
 */
export const reactivateStaff = async (req, res) => {
  try {
    const { membership, error } = await findStaffMembership(req, req.params.id, 'staff.manage');
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    const staff = membership.user;
    if (membership.status === 'ACTIVE') {
      return res.status(200).json({ success: true, message: `${staff.name} is already active.`, data: { staff: { ...staff, status: 'ACTIVE' } } });
    }
    if (!['ACTIVE', 'DEACTIVATED'].includes(staff.status) && req.user.role !== 'SUPER_ADMIN') {
      return res.status(409).json({ success: false, message: 'This account was blocked by TicketLedger and can only be restored by support.' });
    }
    await reactivateMember(req, await contextFor(req, membership.companyId), membership.id);
    await prisma.notification.create({
      data: {
        userId: staff.id,
        type: 'STAFF_REACTIVATED',
        title: 'Your gate staff access is active again',
        message: 'You can scan tickets for your assigned events again.',
      },
    });
    const updated = await prisma.user.findUnique({ where: { id: staff.id }, select: { id: true, name: true, email: true, status: true, companyId: true } });
    return res.status(200).json({ success: true, message: `${staff.name} has been reactivated.`, data: { staff: { ...updated, status: 'ACTIVE', accountStatus: updated.status } } });
  } catch (error) {
    return handleError(res, error, 'Reactivate staff');
  }
};

/**
 * GET /api/staff/my-events — events the current user can scan at (gate staff: their assignments)
 */
export const getMyGateEvents = async (req, res) => {
  try {
    const scopedIds = await getScopedEventIds(req.user, 'gate.scan');
    const events = await prisma.event.findMany({
      where: scopedIds === null ? {} : { id: { in: scopedIds } },
      select: {
        id: true,
        name: true,
        date: true,
        time: true,
        venue: true,
        city: true,
        status: true,
        type: true,
        bannerUrl: true,
        cardImageUrl: true,
        company: { select: { companyName: true } },
      },
      orderBy: { date: 'asc' },
    });
    return res.status(200).json({ success: true, data: { events } });
  } catch (error) {
    return handleError(res, error, 'Load assigned events');
  }
};
