import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { sendStaffInviteEmail } from '../services/emailService.js';
import { sha256, revokeAllRefreshTokens } from '../services/tokenService.js';
import { getOwnedCompanyId, getScopedEventIds } from '../services/accessService.js';
import { INVITE_TTL_MS, MESSAGES } from '../config/auth.js';

const NOT_OWN_STAFF = "You can only manage your own company's staff.";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  eventId: z.string().min(1, 'Event is required'),
});

const listSchema = z.object({
  eventId: z.string().optional(),
  companyId: z.string().optional(),
  status: z.enum(['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED']).optional(),
});

const INVITE_INCLUDE = {
  event: { select: { id: true, name: true, date: true } },
  company: { select: { id: true, companyName: true } },
  invitedBy: { select: { id: true, name: true, email: true, role: true } },
};

// Never expose the token hash
const serializeInvite = ({ tokenHash, ...invite }) => invite;

const handleError = (res, error, context) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Validation error' });
  }
  console.error(`${context} error:`, error);
  return res.status(500).json({ success: false, message: `Server error while trying to ${context.toLowerCase()}` });
};

/**
 * Company scope for the current user: null = all companies (Super Admin), otherwise the owned company id.
 * Organizers without a company get an empty string, which matches nothing.
 */
const resolveCompanyScope = async (user) => {
  if (user.role === 'SUPER_ADMIN') return null;
  return (await getOwnedCompanyId(user.id)) || '';
};

const canManageCompany = (scope, companyId) => scope === null || scope === companyId;

const newInviteToken = () => {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: sha256(raw), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
};

const sendInvite = async (invite, rawToken, inviter) =>
  sendStaffInviteEmail({
    to: invite.email,
    inviteToken: rawToken,
    eventName: invite.event.name,
    companyName: invite.company.companyName,
    inviterName: inviter.name,
  });

// Marks PENDING invites past their expiry as EXPIRED so lists show the real state
const expireStaleInvites = (where) =>
  prisma.staffInvite.updateMany({
    where: { ...where, status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
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

    // Ownership is checked against the organizer's own company, never against client input
    const scope = await resolveCompanyScope(req.user);
    if (!canManageCompany(scope, event.companyId)) {
      return res.status(403).json({ success: false, message: MESSAGES.INVITE_NOT_OWN_EVENT });
    }
    if (req.user.role === 'ORGANIZER' && event.company.status !== 'APPROVED') {
      return res.status(403).json({ success: false, message: MESSAGES.COMPANY_NOT_APPROVED });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== 'GATE_STAFF') {
        return res.status(409).json({ success: false, message: MESSAGES.INVITE_EMAIL_TAKEN });
      }
      if (existing.companyId !== event.companyId) {
        return res.status(409).json({ success: false, message: 'This staff member belongs to another company.' });
      }
      if (existing.status === 'DEACTIVATED') {
        return res.status(409).json({ success: false, message: 'This staff member is deactivated. Reactivate them in your staff list first.' });
      }
      if (existing.status !== 'ACTIVE') {
        return res.status(409).json({ success: false, message: 'This staff account is blocked by TicketLedger. Contact support.' });
      }

      // Same company: assign the existing account to this event, no new invite needed
      const assignment = await prisma.staffEventAssignment.upsert({
        where: { staffId_eventId: { staffId: existing.id, eventId } },
        update: {},
        create: { staffId: existing.id, eventId, assignedById: req.user.id },
      });
      return res.status(200).json({
        success: true,
        message: `${existing.name} already has a staff account and is now assigned to ${event.name}.`,
        data: { assignment, assignedExisting: true },
      });
    }

    const token = newInviteToken();
    const invite = await prisma.$transaction(async (tx) => {
      // A new invite replaces any open one for the same email and event; the old link stops working
      await tx.staffInvite.updateMany({
        where: { email, eventId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      return tx.staffInvite.create({
        data: {
          email,
          companyId: event.companyId,
          eventId,
          invitedById: req.user.id,
          tokenHash: token.hash,
          expiresAt: token.expiresAt,
        },
        include: INVITE_INCLUDE,
      });
    });

    const delivery = await sendInvite(invite, token.raw, req.user);
    return res.status(201).json({
      success: true,
      message: delivery.success ? `Invite sent to ${email}.` : `Invite created, but the email to ${email} could not be sent. Try resending.`,
      data: { invite: serializeInvite(invite), emailSent: delivery.success },
    });
  } catch (error) {
    return handleError(res, error, 'Send invite');
  }
};

/**
 * GET /api/staff — staff accounts and invites, scoped to the organizer's company
 */
export const listStaff = async (req, res) => {
  try {
    const filters = listSchema.parse(req.query);
    const scope = await resolveCompanyScope(req.user);
    const companyId = scope === null ? filters.companyId : scope;

    const inviteWhere = {
      ...(companyId !== undefined ? { companyId } : {}),
      ...(filters.eventId ? { eventId: filters.eventId } : {}),
    };
    await expireStaleInvites(inviteWhere);

    const [invites, staff] = await Promise.all([
      prisma.staffInvite.findMany({
        where: { ...inviteWhere, ...(filters.status ? { status: filters.status } : {}) },
        include: INVITE_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.findMany({
        where: {
          role: 'GATE_STAFF',
          ...(companyId !== undefined ? { companyId } : {}),
          ...(filters.eventId ? { staffAssignments: { some: { eventId: filters.eventId } } } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          createdAt: true,
          companyId: true,
          memberOfCompany: { select: { id: true, companyName: true } },
          staffAssignments: {
            select: { assignedAt: true, event: { select: { id: true, name: true, date: true } } },
            orderBy: { assignedAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: { staff, invites: invites.map(serializeInvite) },
    });
  } catch (error) {
    return handleError(res, error, 'Load staff');
  }
};

/**
 * GET /api/staff/events — events the current user may invite staff for (with companies for the admin filter)
 */
export const listInvitableEvents = async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req.user);
    const companyFilter = scope === null ? req.query.companyId : scope;

    const events = await prisma.event.findMany({
      where: companyFilter !== undefined ? { companyId: companyFilter } : {},
      select: {
        id: true,
        name: true,
        date: true,
        city: true,
        status: true,
        company: { select: { id: true, companyName: true } },
      },
      orderBy: { date: 'asc' },
    });

    const companies = scope === null
      ? await prisma.company.findMany({
          where: { events: { some: {} } },
          select: { id: true, companyName: true },
          orderBy: { companyName: 'asc' },
        })
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

    const scope = await resolveCompanyScope(req.user);
    if (!canManageCompany(scope, invite.companyId)) {
      return res.status(403).json({ success: false, message: NOT_OWN_STAFF });
    }
    if (!['PENDING', 'EXPIRED'].includes(invite.status)) {
      return res.status(409).json({ success: false, message: `This invite was ${invite.status.toLowerCase()} and cannot be resent.` });
    }
    if (await prisma.user.findUnique({ where: { email: invite.email } })) {
      return res.status(409).json({ success: false, message: MESSAGES.INVITE_EMAIL_TAKEN });
    }

    const token = newInviteToken();
    const updated = await prisma.staffInvite.update({
      where: { id: invite.id },
      data: { tokenHash: token.hash, expiresAt: token.expiresAt, status: 'PENDING' },
      include: INVITE_INCLUDE,
    });

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

    const scope = await resolveCompanyScope(req.user);
    if (!canManageCompany(scope, invite.companyId)) {
      return res.status(403).json({ success: false, message: NOT_OWN_STAFF });
    }
    if (invite.status === 'ACCEPTED') {
      return res.status(409).json({ success: false, message: 'This invite was already accepted. Deactivate the staff account instead.' });
    }

    await prisma.staffInvite.update({ where: { id: invite.id }, data: { status: 'CANCELLED' } });
    return res.status(204).end();
  } catch (error) {
    return handleError(res, error, 'Cancel invite');
  }
};

/**
 * PATCH /api/staff/:id/deactivate — blocks login and revokes every session of the staff member
 */
export const deactivateStaff = async (req, res) => {
  try {
    const staff = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!staff || staff.role !== 'GATE_STAFF') {
      return res.status(404).json({ success: false, message: 'Staff member not found.' });
    }

    const scope = await resolveCompanyScope(req.user);
    if (!canManageCompany(scope, staff.companyId)) {
      return res.status(403).json({ success: false, message: NOT_OWN_STAFF });
    }

    const updated = await prisma.user.update({
      where: { id: staff.id },
      data: { status: 'DEACTIVATED' },
      select: { id: true, name: true, email: true, status: true, companyId: true },
    });
    await revokeAllRefreshTokens(staff.id);

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STAFF_DEACTIVATED',
        targetType: 'User',
        targetId: staff.id,
        details: { email: staff.email, companyId: staff.companyId },
      },
    });

    return res.status(200).json({ success: true, message: `${staff.name} has been deactivated.`, data: { staff: updated } });
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
    const staff = await prisma.user.findUnique({ where: { id: staffId } });
    if (!staff || staff.role !== 'GATE_STAFF') {
      return res.status(404).json({ success: false, message: 'Staff member not found.' });
    }
    const scope = await resolveCompanyScope(req.user);
    if (!canManageCompany(scope, staff.companyId)) {
      return res.status(403).json({ success: false, message: NOT_OWN_STAFF });
    }
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, companyId: true } });
    if (!event || !canManageCompany(scope, event.companyId)) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const { count } = await prisma.staffEventAssignment.deleteMany({ where: { staffId, eventId } });
    if (!count) {
      return res.status(200).json({ success: true, message: `${staff.name} wasn’t assigned to ${event.name}.` });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STAFF_EVENT_ACCESS_REVOKED',
        targetType: 'User',
        targetId: staffId,
        details: { email: staff.email, eventId, eventName: event.name },
      },
    });
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
 * PATCH /api/staff/:id/reactivate — lets a staff member the organizer deactivated sign in again. Only undoes
 * the organizer's own deactivation: accounts suspended or banned by TicketLedger stay blocked.
 */
export const reactivateStaff = async (req, res) => {
  try {
    const staff = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!staff || staff.role !== 'GATE_STAFF') {
      return res.status(404).json({ success: false, message: 'Staff member not found.' });
    }

    const scope = await resolveCompanyScope(req.user);
    if (!canManageCompany(scope, staff.companyId)) {
      return res.status(403).json({ success: false, message: NOT_OWN_STAFF });
    }
    if (staff.status === 'ACTIVE') {
      return res.status(200).json({ success: true, message: `${staff.name} is already active.`, data: { staff } });
    }
    if (staff.status !== 'DEACTIVATED' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(409).json({ success: false, message: 'This account was blocked by TicketLedger and can only be restored by support.' });
    }

    const updated = await prisma.user.update({
      where: { id: staff.id },
      data: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true, status: true, companyId: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STAFF_REACTIVATED',
        targetType: 'User',
        targetId: staff.id,
        details: { email: staff.email, companyId: staff.companyId },
      },
    });
    await prisma.notification.create({
      data: {
        userId: staff.id,
        type: 'STAFF_REACTIVATED',
        title: 'Your gate staff account is active again',
        message: 'You can sign in to TicketLedger and scan tickets for your assigned events.',
      },
    });

    return res.status(200).json({ success: true, message: `${staff.name} has been reactivated.`, data: { staff: updated } });
  } catch (error) {
    return handleError(res, error, 'Reactivate staff');
  }
};

/**
 * GET /api/staff/my-events — events the current user can scan at (gate staff: their assignments)
 */
export const getMyGateEvents = async (req, res) => {
  try {
    const scopedIds = await getScopedEventIds(req.user);
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
