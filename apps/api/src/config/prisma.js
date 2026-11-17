import { PrismaClient } from '@prisma/client';
import { escapeHtml, sendEmailNotification } from '../services/emailService.js';
import { OFFICIAL_EMAIL } from './brand.js';

const FRONTEND = () => process.env.FRONTEND_URL || 'http://localhost:5173';

// Where each notification's email button leads (by notification type prefix); the wallet otherwise
const ACTIONS = [
  [/^EVENT_REVIEW_REQUEST/, 'Review event', '/admin/event-approvals'],
  [/^ADMIN_EVENT/, 'Open event approvals', '/admin/event-approvals'],
  [/^ADMIN_COMPANY_REVIEW_REQUEST/, 'Review organizer', '/admin/companies'],
  [/^ADMIN_COMPANY/, 'Open organizer approvals', '/admin/companies'],
  [/^EVENT_(SUBMITTED|APPROVED|REJECTED|CREATED|UPDATED|SEATING|PRICES)/, 'Open organizer dashboard', '/organizer/dashboard'],
  [/^(ORGANIZER|COMPANY)/, 'Open organizer dashboard', '/organizer/dashboard'],
  [/^(PASSWORD|PROFILE|WALLET|ACCOUNT)/, 'Open your profile', '/profile'],
  [/^RESALE/, 'Open fan resale', '/resale'],
  [/^STAFF/, 'Open my gate events', '/staff/events'],
  [/^ADMIN_(SCHEDULE|REFUND)/, 'Open event approvals', '/admin/event-approvals'],
  [/^ADMIN_MINT/, 'Open ticket issuance', '/admin/event-approvals?tab=issuance'],
  [/^TICKET_ISSU/, 'Open your tickets', '/wallet'],
  [/^(EVENT_CANCELLED|EVENT_POSTPONED|EVENT_RESCHEDULED|REFUND_WINDOW)/, 'See your options', '/my-bookings'],
  [/^REFUND/, 'See your refunds', '/my-bookings'],
  [/^SCHEDULE_CHANGE/, 'Open organizer dashboard', '/organizer/dashboard'],
  [/^SUPPORT_UPDATE/, 'Open your support request', '/support'],
  [/^(SUPPORT_|ADMIN_SUPPORT)/, 'Open the support desk', '/support/desk'],
];
// A notification's own link (e.g. one event's refund page) wins over the type's default page
const actionFor = (type = '', link = null) => {
  const hit = ACTIONS.find(([re]) => re.test(type));
  if (link) return { label: hit?.[1] || 'Open', url: `${FRONTEND()}${link}` };
  return hit ? { label: hit[1], url: `${FRONTEND()}${hit[2]}` } : { label: 'Open your notifications', url: `${FRONTEND()}/notifications` };
};

// About a ticket holder's money, a changed event date, or their own support request: emailed even to users who
// turned email notifications off
const ESSENTIAL = /^(EVENT_CANCELLED|EVENT_POSTPONED|EVENT_RESCHEDULED|REFUND|SUPPORT_UPDATE)/;

let base;

try {
  base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
} catch (err) {
  console.warn('PrismaClient initialization warning:', err.message);
}

/**
 * Every in-app notification is also emailed to its user (when they have email notifications on), so
 * each activity — bookings, resale, transfers, password and profile changes, organizer and admin
 * actions — reaches the inbox without each feature sending mail itself. Sending happens after the
 * response and never fails the request.
 */
// Admin alerts (reviews requested, decisions made) are also copied here, so they reach a monitored inbox
// even when an admin account's own address can't receive mail. Comma-separated; empty turns it off.
const adminInbox = () =>
  (process.env.ADMIN_NOTIFY_EMAILS ?? OFFICIAL_EMAIL)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

function emailNotifications(rows) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter((r) => r?.userId && r.title);
  if (!list.length || !base) return;
  setImmediate(async () => {
    try {
      const users = await base.user.findMany({
        where: { id: { in: [...new Set(list.map((r) => r.userId))] } },
        select: { id: true, email: true, emailNotifications: true, role: true },
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      // One email per address per notification: several admins sharing the inbox get a single copy
      const sent = new Set();
      const send = (to, n) => {
        const key = `${to.toLowerCase()}|${n.type}|${n.title}|${n.message}`;
        if (sent.has(key)) return;
        sent.add(key);
        sendEmailNotification({
          to,
          subject: `[TicketLedger] ${n.title}`,
          type: n.type || 'NOTIFICATION',
          title: escapeHtml(n.title),
          message: escapeHtml(n.message || ''),
          action: actionFor(n.type, n.link),
        }).catch((e) => console.warn(`[Notification email] ${to}: ${e.message}`));
      };
      for (const n of list) {
        const u = byId.get(n.userId);
        if (u?.role === 'SUPER_ADMIN') adminInbox().forEach((to) => send(to, n));
        if (!u?.email || (u.emailNotifications === false && !ESSENTIAL.test(n.type || ''))) continue;
        send(u.email, n);
      }
    } catch (e) {
      console.warn('[Notification email] skipped:', e.message);
    }
  });
}

/**
 * Audit rows belong to an organization when what they are about does: an event, a ticket, a company, a member
 * or invitation, or details.companyId. The actor's organization role at that moment is recorded with it. This
 * makes every action written to the audit log (by any feature) part of the organization's activity history.
 */
async function withOrganization(data) {
  if (!data || data.companyId !== undefined) return data;
  let companyId = null;
  try {
    const { targetType: type, targetId: id } = data;
    if (id && type === 'Event') companyId = (await base.event.findUnique({ where: { id }, select: { companyId: true } }))?.companyId;
    else if (id && type === 'Ticket') companyId = (await base.ticket.findUnique({ where: { id }, select: { event: { select: { companyId: true } } } }))?.event.companyId;
    else if (id && type === 'Company') companyId = (await base.company.findUnique({ where: { id }, select: { id: true } }))?.id;
    else if (id && type === 'OrganizationMember') companyId = (await base.organizationMember.findUnique({ where: { id }, select: { companyId: true } }))?.companyId;
    else if (id && type === 'StaffInvite') companyId = (await base.staffInvite.findUnique({ where: { id }, select: { companyId: true } }))?.companyId;
    if (!companyId && typeof data.details?.companyId === 'string') companyId = (await base.company.findUnique({ where: { id: data.details.companyId }, select: { id: true } }))?.id;
    if (companyId && data.userId && data.actorRole === undefined) {
      const m = await base.organizationMember.findFirst({ where: { companyId, userId: data.userId }, select: { role: true } });
      const u = m ? null : await base.user.findUnique({ where: { id: data.userId }, select: { role: true } });
      data = { ...data, actorRole: m?.role || (u?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : null) };
    }
  } catch {
    // Never block the action being logged
  }
  return companyId ? { ...data, companyId } : data;
}

const prisma = base
  ? base.$extends({
      query: {
        auditLog: {
          async create({ args, query }) {
            return query({ ...args, data: await withOrganization(args.data) });
          },
          async createMany({ args, query }) {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            return query({ ...args, data: await Promise.all(rows.map(withOrganization)) });
          },
        },
        notification: {
          async create({ args, query }) {
            const row = await query(args);
            emailNotifications(row);
            return row;
          },
          async createMany({ args, query }) {
            const result = await query(args);
            emailNotifications(args.data);
            return result;
          },
        },
      },
    })
  : base;

export default prisma;
