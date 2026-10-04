import { PrismaClient } from '@prisma/client';
import { escapeHtml, sendEmailNotification } from '../services/emailService.js';

const FRONTEND = () => process.env.FRONTEND_URL || 'http://localhost:5173';

// Where each notification's email button leads (by notification type prefix); the wallet otherwise
const ACTIONS = [
  [/^EVENT_REVIEW_REQUEST/, 'Review event', '/admin/event-approvals'],
  [/^EVENT_(SUBMITTED|APPROVED|REJECTED|CREATED|UPDATED|SEATING|PRICES)/, 'Open organizer dashboard', '/organizer/dashboard'],
  [/^(ORGANIZER|COMPANY)/, 'Open organizer dashboard', '/organizer/dashboard'],
  [/^(PASSWORD|PROFILE|WALLET|ACCOUNT)/, 'Open your profile', '/profile'],
  [/^RESALE/, 'Open fan resale', '/resale'],
  [/^STAFF/, 'Open my gate events', '/staff/events'],
];
const actionFor = (type = '') => {
  const hit = ACTIONS.find(([re]) => re.test(type));
  return hit ? { label: hit[1], url: `${FRONTEND()}${hit[2]}` } : { label: 'Open your notifications', url: `${FRONTEND()}/notifications` };
};

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
function emailNotifications(rows) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter((r) => r?.userId && r.title);
  if (!list.length || !base) return;
  setImmediate(async () => {
    try {
      const users = await base.user.findMany({
        where: { id: { in: [...new Set(list.map((r) => r.userId))] } },
        select: { id: true, email: true, emailNotifications: true },
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const n of list) {
        const u = byId.get(n.userId);
        if (!u?.email || u.emailNotifications === false) continue;
        sendEmailNotification({
          to: u.email,
          subject: `[TicketLedger] ${n.title}`,
          type: n.type || 'NOTIFICATION',
          title: escapeHtml(n.title),
          message: escapeHtml(n.message || ''),
          action: actionFor(n.type),
        }).catch((e) => console.warn(`[Notification email] ${u.email}: ${e.message}`));
      }
    } catch (e) {
      console.warn('[Notification email] skipped:', e.message);
    }
  });
}

const prisma = base
  ? base.$extends({
      query: {
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
