import prisma from '../config/prisma.js';

/*
 * Organization access. Two separate things decide what a person may do:
 *   - the global User.role (CUSTOMER, ORGANIZER, GATE_STAFF, SUPER_ADMIN): what kind of TicketLedger account it is
 *   - an OrganizationMember row: their role and permissions inside ONE organization (company)
 * Organization data is reached only through an ACTIVE membership (or as a Super Admin). A deactivated or
 * removed member keeps their TicketLedger account but loses the organization at their next request.
 */

export const PERMISSIONS = {
  'event.view': 'See events and their settings',
  'event.create': 'Create events and prebook dates',
  'event.edit': 'Edit event details, media, tiers, seating and venue plans',
  'event.submit': 'Send events for TicketLedger review and answer reviewers',
  'event.pricing': 'See demand forecasts, change prices and publish',
  'event.lifecycle': 'Postpone, reschedule, pause or change an event’s status',
  'event.promote': 'Request and withdraw promotions',
  'event.delete': 'Delete events that have no sales',
  'booking.view': 'See bookings and sales for events',
  'attendee.view': 'See attendees, their purchase intent and behaviour on this organization’s events',
  'attendee.contact': 'Send reminders to attendees and prospects',
  'gate.scan': 'Scan tickets at the gate',
  'gate.stats': 'See gate entry statistics and recent scans',
  'finance.view': 'See revenue, payouts and refund figures',
  'finance.refunds': 'Cancel events with refunds and manage refunds',
  'finance.manage': 'Change payout and tax details (needs your password; TicketLedger re-checks them)',
  'discount.manage': 'Create, change and turn off discount codes',
  'staff.view': 'See members, invitations and gate staff',
  'staff.invite': 'Invite people and resend or revoke invitations',
  'staff.manage': 'Assign events, deactivate, reactivate and remove members',
  'staff.roles': 'Change members’ roles and custom permissions',
  'org.settings': 'Change the organization profile and branches',
  'org.documents': 'See, upload and archive organization documents',
  'audit.view': 'See the organization’s activity history',
};
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

export const ROLES = ['OWNER', 'ADMIN', 'EVENT_MANAGER', 'FINANCE_MANAGER', 'STAFF', 'GATE_STAFF'];
export const ROLE_LABELS = {
  OWNER: 'Owner',
  ADMIN: 'Organization Admin',
  EVENT_MANAGER: 'Event Manager',
  FINANCE_MANAGER: 'Finance Manager',
  STAFF: 'Staff',
  GATE_STAFF: 'Gate Staff',
};

export const ROLE_PERMISSIONS = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
  EVENT_MANAGER: ['event.view', 'event.create', 'event.edit', 'event.submit', 'event.pricing', 'event.lifecycle', 'event.promote', 'booking.view', 'attendee.view', 'attendee.contact', 'gate.scan', 'gate.stats', 'staff.view', 'discount.manage'],
  FINANCE_MANAGER: ['event.view', 'booking.view', 'finance.view', 'finance.refunds', 'finance.manage', 'org.documents', 'audit.view'],
  STAFF: ['event.view', 'booking.view', 'attendee.view', 'gate.stats'],
  GATE_STAFF: ['gate.scan', 'gate.stats'],
};

// These roles see only the events they are assigned to (StaffEventAssignment)
export const EVENT_SCOPED_ROLES = ['EVENT_MANAGER', 'STAFF', 'GATE_STAFF'];
// Only an owner may create, change or remove these
export const OWNER_ONLY_ROLES = ['OWNER', 'ADMIN'];
// Permissions no custom grant can add: they belong to owners and admins only
export const RESERVED_PERMISSIONS = ['staff.roles', 'org.settings'];

export class AccessError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The effective permission list of a role with a member's own grants and revocations. */
export function effectivePermissions(role, granted = [], revoked = []) {
  const set = new Set(ROLE_PERMISSIONS[role] || []);
  for (const p of granted) if (PERMISSIONS[p] && (!RESERVED_PERMISSIONS.includes(p) || OWNER_ONLY_ROLES.includes(role))) set.add(p);
  for (const p of revoked) set.delete(p);
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}

const MEMBER_COMPANY = { company: { select: { id: true, companyName: true, status: true, userId: true, email: true } } };

/**
 * The user's open membership (ACTIVE or DEACTIVATED), with the company. A company created without one (seed
 * data, older code paths) gets its registering account as OWNER the first time, but only when that account has
 * never had a membership of the company: an owner who was removed does not come back this way.
 */
export async function findMembership(userId, db = prisma) {
  const m = await db.organizationMember.findFirst({ where: { userId, status: { not: 'REMOVED' } }, include: MEMBER_COMPANY });
  if (m) return m;
  const owned = await db.company.findUnique({ where: { userId }, select: { id: true } });
  if (!owned) return null;
  if (await db.organizationMember.findUnique({ where: { companyId_userId: { companyId: owned.id, userId } }, select: { id: true } })) return null;
  try {
    return await db.organizationMember.create({ data: { companyId: owned.id, userId, role: 'OWNER', status: 'ACTIVE' }, include: MEMBER_COMPANY });
  } catch {
    // Created concurrently, or the user already has another open membership
    return db.organizationMember.findFirst({ where: { userId, status: { not: 'REMOVED' } }, include: MEMBER_COMPANY });
  }
}

/**
 * The organization context of a user: null when they have no ACTIVE membership.
 * { memberId, companyId, company, role, permissions: Set, eventScoped, eventIds (assigned, when scoped) }
 */
export async function memberContext(user, db = prisma) {
  if (!user?.id) return null;
  const m = await findMembership(user.id, db);
  if (!m || m.status !== 'ACTIVE') return null;
  const permissions = new Set(effectivePermissions(m.role, m.grantedPermissions, m.revokedPermissions));
  const eventScoped = EVENT_SCOPED_ROLES.includes(m.role);
  let eventIds = null;
  if (eventScoped) {
    const rows = await db.staffEventAssignment.findMany({ where: { staffId: user.id, event: { companyId: m.companyId } }, select: { eventId: true } });
    eventIds = rows.map((r) => r.eventId);
  }
  return { memberId: m.id, companyId: m.companyId, company: m.company, role: m.role, permissions, eventScoped, eventIds };
}

/** Cached per request. */
export async function requestContext(req) {
  if (req._orgContext === undefined) req._orgContext = req.user ? await memberContext(req.user) : null;
  return req._orgContext;
}

export const hasPermission = (ctx, permission) => Boolean(ctx && ctx.permissions.has(permission));

/** May this context act on this event with this permission? (Super Admins are handled by the caller.) */
export function contextCoversEvent(ctx, event, permission) {
  if (!ctx || !event) return false;
  if (event.companyId !== ctx.companyId) return false;
  if (permission && !ctx.permissions.has(permission)) return false;
  return !ctx.eventScoped || ctx.eventIds.includes(event.id);
}

/**
 * Event access for a user: Super Admins always; members of the event's organization when they hold
 * `permission` and (for event-scoped roles) are assigned to the event. `requireApproved` also needs the
 * organization to still be APPROVED.
 */
export async function canAccessEvent(user, event, { permission = 'event.edit', requireApproved = false, req = null } = {}) {
  if (!user || !event) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const ctx = req ? await requestContext(req) : await memberContext(user);
  if (!contextCoversEvent(ctx, event, permission)) return false;
  return !requireApproved || ctx.company.status === 'APPROVED';
}

/**
 * Event ids a user may use `permission` on: null = no restriction (Super Admin), [] = none.
 */
export async function scopedEventIds(user, permission) {
  if (!user) return [];
  if (user.role === 'SUPER_ADMIN') return null;
  const ctx = await memberContext(user);
  if (!hasPermission(ctx, permission)) return [];
  if (ctx.eventScoped) return ctx.eventIds;
  const events = await prisma.event.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
  return events.map((e) => e.id);
}

/** Prisma `where` fragment limiting events to what the context may see with `permission`. */
export function eventWhereFor(ctx, permission) {
  if (!hasPermission(ctx, permission)) return { id: { in: [] } };
  return ctx.eventScoped ? { companyId: ctx.companyId, id: { in: ctx.eventIds } } : { companyId: ctx.companyId };
}
