import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import fs from 'node:fs';
import path from 'node:path';
import { uploadPrivateFile, privateFileAccess } from '../utils/storage.js';
import { notifyAdmins } from './notificationService.js';
import { EVENT_SCOPED_ROLES, effectivePermissions, memberContext } from './orgAccess.js';

/*
 * Helpdesk. Customers open support tickets (category, subject, message, attachments) and get a reference number;
 * they follow the status and reply. Support agents (User.isSupportAgent, and every Super Admin) see all tickets,
 * assign them, reply, write internal notes, change status and priority, and resolve. Super Admins also escalate.
 * Every change is a SYSTEM message in the ticket, so the thread is the full communication history; internal
 * notes are never shown to the customer.
 *
 * Unresolved tickets escalate on their own (escalateOverdue, hourly): no agent answer within FIRST_RESPONSE_HOURS
 * of opening, or a customer reply waiting longer than REPLY_HOURS.
 */

export const CATEGORIES = {
  BOOKING: 'Tickets and bookings',
  PAYMENT: 'Payments',
  REFUND: 'Refunds',
  TICKET_ACCESS: "Can't open or use my ticket",
  EVENT: 'An event (changes, venue, organizer)',
  ACCOUNT: 'My account',
  ORGANIZER: 'Hosting events (organizers)',
  TECHNICAL: 'Something is not working',
  OTHER: 'Something else',
};
export const STATUS_LABELS = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting for your reply',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const OPEN_STATES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED'];
export const FIRST_RESPONSE_HOURS = 24;
export const REPLY_HOURS = 48;
// A resolved ticket can be reopened by a customer reply within this many days; after that it closes
export const REOPEN_DAYS = 14;
export const MAX_ATTACHMENTS = 5;

export class SupportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const isAgent = (user) => user?.role === 'SUPER_ADMIN' || Boolean(user?.isSupportAgent);

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
function newReference() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const tail = Array.from(crypto.randomBytes(4), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
  return `SUP-${ymd}-${tail}`;
}

/** Attachments go to private storage (never a public /uploads link). */
async function storeAttachments(files = []) {
  const out = [];
  for (const f of files.slice(0, MAX_ATTACHMENTS)) {
    const { key } = await uploadPrivateFile(f, 'support');
    out.push({ storageKey: key, fileName: (f.originalname || 'attachment').slice(0, 160), mimeType: f.mimetype, sizeBytes: f.size });
  }
  return out;
}

// ── Attachment links ───────────────────────────────────────────────────────────────────────────────────
// A viewer who may see a message gets links to its files signed for LINK_TTL_MS. The link works without the
// Authorization header (so <img> and downloads work) but only for that file and only until it expires.
const LINK_TTL_MS = 60 * 60 * 1000;
const linkKey = () => crypto.createHash('sha256').update(`support-attachments:${process.env.JWT_SECRET || 'dev'}`).digest();
const signLink = (id, exp) => crypto.createHmac('sha256', linkKey()).update(`${id}.${exp}`).digest('base64url');
export function attachmentLink(id, now = Date.now()) {
  const exp = now + LINK_TTL_MS;
  return `/api/support/attachments/${id}?exp=${exp}&sig=${signLink(id, exp)}`;
}

/** The file behind a signed link: { path } or { url } plus its name and type. Throws 404 / 410 / 403. */
export async function openAttachment(id, { exp, sig }) {
  const e = Number(exp);
  if (!e || !sig) throw new SupportError(403, 'This link is not valid.');
  if (e < Date.now()) throw new SupportError(410, 'This link has expired. Reopen the support request to get a new one.');
  const expected = Buffer.from(signLink(id, e));
  const given = Buffer.from(String(sig));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw new SupportError(403, 'This link is not valid.');
  const a = await prisma.supportAttachment.findUnique({ where: { id } });
  if (!a) throw new SupportError(404, 'File not found.');
  let access = privateFileAccess(a.storageKey);
  // Files from before private storage: read from the (now closed) public folder
  if (!access && a.url?.startsWith('/uploads/support/')) {
    const base = path.resolve('uploads', 'support');
    const full = path.resolve(base, path.basename(a.url));
    if (full.startsWith(base + path.sep) && fs.existsSync(full)) access = { path: full };
  }
  if (!access) throw new SupportError(404, 'File not found.');
  return { ...access, fileName: a.fileName, mimeType: a.mimeType };
}

// History line in the thread. internal: staff only (who it is assigned to, priority, escalation reasons)
const systemNote = (tx, ticketId, body, authorId = null, internal = false) => tx.supportMessage.create({ data: { ticketId, authorId, authorType: 'SYSTEM', body, internal } });

/** In-app notice (emailed too, see config/prisma.js) to the customer, linking to their ticket. */
const tellCustomer = (db, t, title, message) => db.notification.create({ data: { userId: t.userId, type: 'SUPPORT_UPDATE', title, message, link: `/support/${t.reference}` } });

const PEOPLE = { select: { id: true, name: true, email: true, role: true, isSupportAgent: true } };
const firstName = (n, fallback) => (n || '').split(/\s+/)[0] || fallback;

// ── Viewers ────────────────────────────────────────────────────────────────────────────────────────────
// customer: the person who opened it · agent: TicketLedger support · organizer: a member of the organization
// running the event the request is about, with support.respond (event-scoped roles: their assigned events only)

/** Organization context of a user who may answer requests about `eventId` of `companyId`, else null. */
async function responderContext(user, companyId, eventId) {
  if (!companyId || !user) return null;
  const ctx = await memberContext(user);
  if (!ctx || ctx.companyId !== companyId || !ctx.permissions.has('support.respond')) return null;
  if (ctx.eventScoped && (!eventId || !ctx.eventIds.includes(eventId))) return null;
  return ctx;
}

async function viewerOf(user, t) {
  if (t.userId === user.id) return 'customer';
  if (isAgent(user)) return 'agent';
  if (await responderContext(user, t.companyId, t.eventId)) return 'organizer';
  return null;
}

/** Members of the event's organization who answer support requests about it. */
async function orgResponderIds(companyId, eventId) {
  if (!companyId) return [];
  const members = await prisma.organizationMember.findMany({ where: { companyId, status: 'ACTIVE' }, select: { userId: true, role: true, grantedPermissions: true, revokedPermissions: true } });
  const ids = [];
  for (const m of members) {
    if (!effectivePermissions(m.role, m.grantedPermissions, m.revokedPermissions).includes('support.respond')) continue;
    if (EVENT_SCOPED_ROLES.includes(m.role)) {
      if (!eventId || !(await prisma.staffEventAssignment.findUnique({ where: { staffId_eventId: { staffId: m.userId, eventId } }, select: { staffId: true } }))) continue;
    }
    ids.push(m.userId);
  }
  return ids;
}
const notifyOrg = async (t, { type, title, message }) => {
  const ids = (await orgResponderIds(t.companyId, t.eventId)).filter((id) => id !== t.userId);
  if (ids.length) await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, type, title, message, link: `/organizer/support/${t.reference}` })) });
};

function serializeTicket(t, { viewer }) {
  const agent = viewer === 'agent';
  return {
    id: t.id,
    reference: t.reference,
    category: t.category,
    categoryLabel: CATEGORIES[t.category],
    subject: t.subject,
    status: t.status,
    statusLabel: STATUS_LABELS[t.status],
    priority: t.priority,
    orderId: t.orderId,
    eventId: t.eventId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    viewer,
    // Customers and organizers see a first name only for who handles it at TicketLedger
    assignee: t.assignee ? (agent ? { id: t.assignee.id, name: t.assignee.name, email: t.assignee.email } : { name: firstName(t.assignee.name, 'Support') }) : null,
    ...(viewer !== 'customer' ? { customer: t.user ? { id: t.user.id, name: t.user.name, email: t.user.email } : undefined } : {}),
    ...(agent ? {
      companyId: t.companyId,
      escalationLevel: t.escalationLevel,
      escalatedAt: t.escalatedAt,
      escalationReason: t.escalationReason,
      firstResponseAt: t.firstResponseAt,
      lastCustomerReplyAt: t.lastCustomerReplyAt,
      lastAgentReplyAt: t.lastAgentReplyAt,
      waitingOnAgent: OPEN_STATES.includes(t.status) && t.status !== 'WAITING_ON_CUSTOMER' && (!t.lastAgentReplyAt || (t.lastCustomerReplyAt && t.lastCustomerReplyAt > t.lastAgentReplyAt)),
    } : {}),
    ...(viewer === 'organizer' ? { waitingForReply: OPEN_STATES.includes(t.status) && t.status !== 'WAITING_ON_CUSTOMER' && (!t.lastAgentReplyAt || (t.lastCustomerReplyAt && t.lastCustomerReplyAt > t.lastAgentReplyAt)) } : {}),
    canReopen: t.status === 'RESOLVED' && t.resolvedAt && Date.now() - new Date(t.resolvedAt).getTime() < REOPEN_DAYS * 86400000,
  };
}

function serializeMessage(m, { viewer, companies = {} }) {
  let author = null;
  if (m.authorType !== 'SYSTEM' && m.author) {
    const full = viewer === 'agent' || m.authorType === 'CUSTOMER' || (m.authorType === 'ORGANIZER' && viewer === 'organizer');
    author = { id: m.author.id, name: full ? m.author.name : firstName(m.author.name, 'Support') };
  }
  return {
    id: m.id,
    authorType: m.authorType,
    author,
    organization: m.authorType === 'ORGANIZER' ? companies[m.companyId] || 'Organizer' : undefined,
    body: m.body,
    internal: m.internal,
    createdAt: m.createdAt,
    attachments: (m.attachments || []).map(({ id, fileName, mimeType, sizeBytes }) => ({ id, url: attachmentLink(id), fileName, mimeType, sizeBytes })),
  };
}

async function loadTicket(user, reference, db = prisma) {
  const t = await db.supportTicket.findUnique({ where: { reference }, include: { user: PEOPLE, assignee: PEOPLE } });
  const viewer = t && (await viewerOf(user, t));
  if (!viewer) throw new SupportError(404, 'Support ticket not found.');
  t.viewer = viewer;
  return t;
}

/** The order / event the customer refers to must be theirs (an event: one they have tickets for, or any public one). */
async function validLinks(userId, { orderId, eventId }) {
  let ev = eventId || null;
  if (orderId) {
    const o = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true, eventId: true } });
    if (!o) throw new SupportError(400, 'That booking was not found in your account.');
    ev = ev || o.eventId;
  }
  let companyId = null;
  if (ev) {
    const e = await prisma.event.findUnique({ where: { id: ev }, select: { id: true, companyId: true } });
    if (!e) throw new SupportError(400, 'That event was not found.');
    companyId = e.companyId;
  }
  return { orderId: orderId || null, eventId: ev, companyId };
}

// ── Customer ───────────────────────────────────────────────────────────────────────────────────────────

export async function createTicket(user, { category, subject, message, orderId, eventId }, files) {
  const links = await validLinks(user.id, { orderId, eventId });
  const attachments = await storeAttachments(files);
  // A booking or payment problem close to the event is urgent for the customer
  const priority = ['TICKET_ACCESS'].includes(category) ? 'HIGH' : 'NORMAL';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const t = await prisma.$transaction(async (tx) => {
        const ticket = await tx.supportTicket.create({
          data: { reference: newReference(), userId: user.id, category, subject, priority, ...links, lastCustomerReplyAt: new Date() },
        });
        await tx.supportMessage.create({ data: { ticketId: ticket.id, authorId: user.id, authorType: 'CUSTOMER', body: message, attachments: { create: attachments } } });
        await tellCustomer(tx, ticket, `Support request ${ticket.reference} received`, `We received your request "${subject}". Your reference is ${ticket.reference}. We usually answer within one working day.`);
        await tx.auditLog.create({ data: { userId: user.id, action: 'SUPPORT_TICKET_CREATED', targetType: 'SupportTicket', targetId: ticket.id, details: { reference: ticket.reference, category, companyId: links.companyId } } });
        return ticket;
      });
      await notifyAgents({ type: 'SUPPORT_NEW_TICKET', title: `New support request ${t.reference}`, message: `${user.name}: ${subject} (${CATEGORIES[category]})`, link: `/support/desk/${t.reference}` });
      await notifyOrg(t, { type: 'SUPPORT_ORG_NEW_TICKET', title: `Customer request about your event: ${t.reference}`, message: `${user.name}: ${subject} (${CATEGORIES[category]})` });
      return getTicket(user, t.reference);
    } catch (e) {
      if (e.code !== 'P2002') throw e; // reference collision: try another
    }
  }
  throw new Error('Could not create a unique reference.');
}

export async function listMyTickets(user, { status } = {}) {
  const rows = await prisma.supportTicket.findMany({
    where: { userId: user.id, ...(status === 'open' ? { status: { in: OPEN_STATES } } : status === 'closed' ? { status: { in: ['RESOLVED', 'CLOSED'] } } : {}) },
    include: { assignee: PEOPLE, _count: { select: { messages: { where: { internal: false, authorType: { not: 'SYSTEM' } } } } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  return rows.map((t) => ({ ...serializeTicket(t, { viewer: 'customer' }), messageCount: t._count.messages }));
}

/** Requests about the events of the caller's organization (support.respond; scoped roles: their events). */
export async function listOrgTickets(user, { status, q } = {}) {
  const ctx = await memberContext(user);
  if (!ctx || !ctx.permissions.has('support.respond')) throw new SupportError(403, "You don't have permission to answer support requests (support.respond).");
  const where = { companyId: ctx.companyId, ...(ctx.eventScoped ? { eventId: { in: ctx.eventIds } } : {}) };
  if (status === 'open') where.status = { in: OPEN_STATES };
  else if (status === 'closed') where.status = { in: ['RESOLVED', 'CLOSED'] };
  if (q) where.OR = [{ reference: { contains: q.toUpperCase() } }, { subject: { contains: q, mode: 'insensitive' } }];
  const rows = await prisma.supportTicket.findMany({ where, include: { user: PEOPLE, assignee: PEOPLE }, orderBy: { updatedAt: 'desc' }, take: 200 });
  const events = await prisma.event.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.eventId).filter(Boolean))] } }, select: { id: true, name: true } });
  const eventName = Object.fromEntries(events.map((e) => [e.id, e.name]));
  return rows.map((t) => ({ ...serializeTicket(t, { viewer: 'organizer' }), eventName: eventName[t.eventId] || null }));
}

/** One ticket with its thread. Customers and organizers never get internal notes. */
export async function getTicket(user, reference) {
  const t = await loadTicket(user, reference);
  const viewer = t.viewer;
  const agent = viewer === 'agent';
  const messages = await prisma.supportMessage.findMany({
    where: { ticketId: t.id, ...(agent ? {} : { internal: false }) },
    include: { attachments: true },
    orderBy: { createdAt: 'asc' },
  });
  const authorIds = [...new Set(messages.map((m) => m.authorId).filter(Boolean))];
  const authors = authorIds.length ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const byId = Object.fromEntries(authors.map((a) => [a.id, a]));
  const companyIds = [...new Set([...messages.map((m) => m.companyId), t.companyId].filter(Boolean))];
  const companies = Object.fromEntries((companyIds.length ? await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, companyName: true } }) : []).map((c) => [c.id, c.companyName]));
  let context = null;
  if (viewer !== 'customer' && (t.orderId || t.eventId)) {
    const [order, event] = await Promise.all([
      t.orderId ? prisma.order.findUnique({ where: { id: t.orderId }, select: { id: true, status: true, totalAmount: true, paymentMethod: true, createdAt: true, _count: { select: { tickets: true } } } }) : null,
      t.eventId ? prisma.event.findUnique({ where: { id: t.eventId }, select: { id: true, name: true, date: true, status: true, company: { select: { companyName: true } } } }) : null,
    ]);
    context = { order: order && { ...order, totalAmount: Number(order.totalAmount), tickets: order._count.tickets }, event };
  }
  return {
    ticket: { ...serializeTicket(t, { viewer }), organization: t.companyId ? companies[t.companyId] || null : null },
    messages: messages.map((m) => serializeMessage({ ...m, author: byId[m.authorId] }, { viewer, companies })),
    context,
  };
}

/**
 * A reply in the thread. Customer: reopens a resolved ticket (within REOPEN_DAYS) and puts a ticket waiting on
 * them back in the queue. Agent: `internal` makes a staff-only note; a public reply can set the next status.
 * Organizer: a public reply only (status, assignment and notes stay with TicketLedger support).
 */
export async function reply(user, reference, { body, internal = false, status }, files) {
  const t = await loadTicket(user, reference);
  const viewer = t.viewer;
  if (t.status === 'CLOSED') throw new SupportError(409, 'This ticket is closed. Open a new request if you still need help.');
  const canReopen = t.status === 'RESOLVED' && t.resolvedAt && Date.now() - t.resolvedAt.getTime() < REOPEN_DAYS * 86400000;
  if (t.status === 'RESOLVED' && viewer !== 'agent' && !canReopen) throw new SupportError(409, `This ticket was resolved more than ${REOPEN_DAYS} days ago. Open a new request if you still need help.`);
  if (t.status === 'RESOLVED' && viewer === 'organizer') throw new SupportError(409, 'This request was resolved by TicketLedger support.');
  const asAgent = viewer === 'agent';
  const asOrg = viewer === 'organizer';
  if (internal && !asAgent) throw new SupportError(403, 'Only TicketLedger support staff can write internal notes.');
  if (status && !asAgent) throw new SupportError(403, 'Only TicketLedger support staff can change the status.');
  if (status && !['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED'].includes(status)) throw new SupportError(400, 'Reply with status In progress, Waiting on customer or Resolved.');
  const attachments = await storeAttachments(files);
  const now = new Date();
  const orgName = asOrg ? (await prisma.company.findUnique({ where: { id: t.companyId }, select: { companyName: true } }))?.companyName || 'The organizer' : null;

  await prisma.$transaction(async (tx) => {
    await tx.supportMessage.create({ data: { ticketId: t.id, authorId: user.id, authorType: asAgent ? 'AGENT' : asOrg ? 'ORGANIZER' : 'CUSTOMER', companyId: asOrg ? t.companyId : null, body, internal, attachments: { create: attachments } } });
    if (internal) return; // a note changes nothing the customer sees
    const data = {};
    if (asAgent || asOrg) {
      Object.assign(data, { lastAgentReplyAt: now, ...(t.firstResponseAt ? {} : { firstResponseAt: now }) });
      // Answering takes the ticket: unassigned tickets go to the support agent who replies
      if (asAgent && !t.assigneeId) data.assigneeId = user.id;
      const next = status || (t.status === 'ESCALATED' ? 'ESCALATED' : 'WAITING_ON_CUSTOMER');
      if (next !== t.status) {
        Object.assign(data, { status: next }, next === 'RESOLVED' ? { resolvedAt: now } : {});
        await systemNote(tx, t.id, `Status changed to ${STATUS_LABELS[next]}.`, user.id);
      }
      const who = asOrg ? `${orgName} (the event organizer)` : `${firstName(user.name, 'Support')} from TicketLedger support`;
      await tellCustomer(tx, t, `Reply on ${t.reference}`, `${who} replied to "${t.subject}".${next === 'RESOLVED' ? ' We marked it resolved; reply within 14 days if you still need help.' : ''}`);
    } else {
      data.lastCustomerReplyAt = now;
      if (t.status === 'RESOLVED') {
        Object.assign(data, { status: 'OPEN', resolvedAt: null });
        await systemNote(tx, t.id, 'Reopened by the customer.', user.id);
      } else if (t.status === 'WAITING_ON_CUSTOMER') {
        data.status = 'IN_PROGRESS';
      }
    }
    await tx.supportTicket.update({ where: { id: t.id }, data });
  });
  if (viewer === 'customer') {
    // The assigned agent hears about it; nobody assigned (or the assignee is no longer an active agent): every agent
    const note = { type: 'SUPPORT_CUSTOMER_REPLY', title: `Customer replied on ${t.reference}`, message: `${user.name}: ${body.slice(0, 140)}`, link: `/support/desk/${t.reference}` };
    const assignee = t.assigneeId && await prisma.user.findFirst({ where: { id: t.assigneeId, status: 'ACTIVE', OR: [{ role: 'SUPER_ADMIN' }, { isSupportAgent: true }] }, select: { id: true } });
    if (assignee) await prisma.notification.create({ data: { userId: assignee.id, ...note } });
    else await notifyAgents(note);
    await notifyOrg(t, { type: 'SUPPORT_ORG_CUSTOMER_REPLY', title: note.title, message: note.message });
  } else if (asOrg && !internal && t.assigneeId) {
    await prisma.notification.create({ data: { userId: t.assigneeId, type: 'SUPPORT_ORG_REPLY', title: `${orgName} replied on ${t.reference}`, message: body.slice(0, 160), link: `/support/desk/${t.reference}` } });
  }
  return getTicket(user, reference);
}

/** Customer closes their own ticket (problem solved). */
export async function closeOwn(user, reference) {
  const t = await loadTicket(user, reference);
  if (t.viewer !== 'customer') throw new SupportError(403, 'Only the customer can close their ticket here.');
  if (t.status === 'CLOSED') return getTicket(user, reference);
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await systemNote(tx, t.id, 'Closed by the customer.', user.id);
  });
  return getTicket(user, reference);
}

// ── Agents ─────────────────────────────────────────────────────────────────────────────────────────────

const assertAgent = (user) => {
  if (!isAgent(user)) throw new SupportError(403, 'Support staff only.');
};

async function notifyAgents({ type, title, message, link }) {
  const agents = await prisma.user.findMany({ where: { status: 'ACTIVE', OR: [{ role: 'SUPER_ADMIN' }, { isSupportAgent: true }] }, select: { id: true } });
  if (agents.length) await prisma.notification.createMany({ data: agents.map((a) => ({ userId: a.id, type, title, message, link })) });
}

/** The support queue with filters. `queue`: mine | unassigned | escalated | waiting (on an agent) | all. */
export async function listQueue(user, { queue = 'all', status, category, priority, q, page = 1, limit = 50 } = {}) {
  assertAgent(user);
  const where = {};
  if (status) where.status = status;
  else if (queue !== 'closed') where.status = { in: OPEN_STATES };
  else where.status = { in: ['RESOLVED', 'CLOSED'] };
  if (queue === 'mine') where.assigneeId = user.id;
  if (queue === 'unassigned') where.assigneeId = null;
  if (queue === 'escalated') where.status = 'ESCALATED';
  if (category) where.category = category;
  if (priority) where.priority = priority;
  if (q) where.OR = [{ reference: { contains: q.toUpperCase() } }, { subject: { contains: q, mode: 'insensitive' } }, { user: { email: { contains: q.toLowerCase() } } }];
  const take = Math.min(100, Math.max(1, Number(limit) || 50));
  const [rows, total, counts] = await Promise.all([
    prisma.supportTicket.findMany({ where, include: { user: PEOPLE, assignee: PEOPLE }, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }], skip: (Math.max(1, Number(page)) - 1) * take, take }),
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  let items = rows.map((t) => serializeTicket(t, { viewer: 'agent' }));
  if (queue === 'waiting') items = items.filter((t) => t.waitingOnAgent);
  return { items, total, page: Number(page), limit: take, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
}

export async function listAgents(user) {
  assertAgent(user);
  const agents = await prisma.user.findMany({ where: { status: 'ACTIVE', OR: [{ role: 'SUPER_ADMIN' }, { isSupportAgent: true }] }, select: { id: true, name: true, email: true, role: true, isSupportAgent: true }, orderBy: { name: 'asc' } });
  const load = await prisma.supportTicket.groupBy({ by: ['assigneeId'], where: { status: { in: OPEN_STATES }, assigneeId: { in: agents.map((a) => a.id) } }, _count: { _all: true } });
  const open = Object.fromEntries(load.map((l) => [l.assigneeId, l._count._all]));
  return agents.map((a) => ({ ...a, isAdmin: a.role === 'SUPER_ADMIN', openTickets: open[a.id] || 0 }));
}

/** Assign to an agent (or unassign with null), change status or priority. Each change is noted in the thread. */
export async function updateTicket(user, reference, { assigneeId, status, priority }) {
  assertAgent(user);
  const t = await loadTicket(user, reference);
  const notes = [];
  const data = {};
  if (assigneeId !== undefined && assigneeId !== t.assigneeId) {
    if (assigneeId) {
      const a = await prisma.user.findFirst({ where: { id: assigneeId, status: 'ACTIVE', OR: [{ role: 'SUPER_ADMIN' }, { isSupportAgent: true }] }, select: { id: true, name: true } });
      if (!a) throw new SupportError(400, 'Assign the ticket to an active support agent.');
      notes.push(`Assigned to ${a.name}.`);
    } else notes.push('Unassigned.');
    data.assigneeId = assigneeId || null;
  }
  if (status && status !== t.status) {
    if (status === 'ESCALATED') throw new SupportError(400, 'Use Escalate to escalate a ticket.');
    if (t.status === 'CLOSED') throw new SupportError(409, 'A closed ticket cannot change status.');
    if (t.status === 'ESCALATED' && user.role !== 'SUPER_ADMIN' && status !== 'RESOLVED') throw new SupportError(403, 'Only an admin can take a ticket out of escalation (or resolve it).');
    Object.assign(data, { status }, status === 'RESOLVED' ? { resolvedAt: new Date() } : {}, status === 'CLOSED' ? { closedAt: new Date() } : {}, ['OPEN', 'IN_PROGRESS'].includes(status) ? { resolvedAt: null } : {});
    notes.push(`Status changed to ${STATUS_LABELS[status]}.`);
  }
  if (priority && priority !== t.priority) {
    data.priority = priority;
    notes.push(`Priority changed to ${priority.toLowerCase()}.`);
  }
  if (!notes.length) return getTicket(user, reference);
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: t.id }, data });
    // Customers see status changes; who handles it and the priority stay with the staff
    for (const n of notes) await systemNote(tx, t.id, n, user.id, !n.startsWith('Status changed'));
    await tx.auditLog.create({ data: { userId: user.id, action: 'SUPPORT_TICKET_UPDATED', targetType: 'SupportTicket', targetId: t.id, details: { reference, before: { assigneeId: t.assigneeId, status: t.status, priority: t.priority }, after: data } } });
    if (data.status === 'RESOLVED') await tellCustomer(tx, t, `${t.reference} resolved`, `We marked "${t.subject}" as resolved. Reply within ${REOPEN_DAYS} days if you still need help.`);
    if (data.status === 'CLOSED') await tellCustomer(tx, t, `${t.reference} closed`, `Your support request "${t.subject}" was closed.`);
  });
  if (data.assigneeId && data.assigneeId !== user.id) {
    await prisma.notification.create({ data: { userId: data.assigneeId, type: 'SUPPORT_ASSIGNED', title: `${t.reference} assigned to you`, message: t.subject, link: `/support/desk/${t.reference}` } });
  }
  return getTicket(user, reference);
}

/**
 * Escalate an unresolved ticket (admins, or the hourly job with `auto`): status ESCALATED, level +1, priority at
 * least HIGH, the admins are told. `deescalate` (admins) puts it back in progress.
 */
export async function escalate(user, reference, { reason, assigneeId } = {}, { auto = false } = {}) {
  if (!auto && user?.role !== 'SUPER_ADMIN') throw new SupportError(403, 'Only an admin can escalate tickets.');
  const t = auto ? await prisma.supportTicket.findUnique({ where: { reference } }) : await loadTicket(user, reference);
  if (!t || !OPEN_STATES.includes(t.status)) throw new SupportError(409, 'Only unresolved tickets can be escalated.');
  if (!reason) throw new SupportError(400, 'Say why the ticket is escalated.');
  if (assigneeId) {
    const a = await prisma.user.findFirst({ where: { id: assigneeId, status: 'ACTIVE', OR: [{ role: 'SUPER_ADMIN' }, { isSupportAgent: true }] }, select: { id: true } });
    if (!a) throw new SupportError(400, 'Assign the ticket to an active support agent.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({
      where: { id: t.id },
      data: { status: 'ESCALATED', escalationLevel: { increment: 1 }, escalatedAt: new Date(), escalationReason: reason, priority: ['URGENT', 'HIGH'].includes(t.priority) ? t.priority : 'HIGH', ...(assigneeId ? { assigneeId } : {}) },
    });
    await systemNote(tx, t.id, `Escalated (level ${t.escalationLevel + 1})${auto ? ' automatically' : ''}: ${reason}`, user?.id || null, true);
    await systemNote(tx, t.id, 'Your request was passed to a senior member of the support team.', user?.id || null);
    await tx.auditLog.create({ data: { userId: user?.id || null, action: auto ? 'SUPPORT_TICKET_AUTO_ESCALATED' : 'SUPPORT_TICKET_ESCALATED', targetType: 'SupportTicket', targetId: t.id, details: { reference, reason, level: t.escalationLevel + 1 } } });
    await notifyAdmins({ type: 'ADMIN_SUPPORT_ESCALATED', title: `Support ${t.reference} escalated`, message: `${t.subject} — ${reason}`, link: `/support/desk/${t.reference}` }, tx);
  });
  return auto ? null : getTicket(user, reference);
}

export async function deescalate(user, reference, { note } = {}) {
  if (user?.role !== 'SUPER_ADMIN') throw new SupportError(403, 'Only an admin can take a ticket out of escalation.');
  const t = await loadTicket(user, reference);
  if (t.status !== 'ESCALATED') throw new SupportError(409, 'This ticket is not escalated.');
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    await systemNote(tx, t.id, `Escalation handled${note ? `: ${note}` : ''}. Back in progress.`, user.id, true);
    await systemNote(tx, t.id, 'Status changed to In progress.', user.id);
  });
  return getTicket(user, reference);
}

/** Hourly: escalate tickets nobody answered in time, and close tickets resolved more than REOPEN_DAYS ago. */
export async function escalateOverdue(now = new Date()) {
  const firstDue = new Date(now.getTime() - FIRST_RESPONSE_HOURS * 3600000);
  const replyDue = new Date(now.getTime() - REPLY_HOURS * 3600000);
  const candidates = await prisma.supportTicket.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      OR: [
        { firstResponseAt: null, createdAt: { lt: firstDue } },
        { lastCustomerReplyAt: { lt: replyDue }, lastAgentReplyAt: { not: null } },
      ],
    },
    select: { reference: true, firstResponseAt: true, lastCustomerReplyAt: true, lastAgentReplyAt: true },
    take: 200,
  });
  let escalated = 0;
  for (const c of candidates) {
    // Only when the customer's message is still unanswered
    if (c.firstResponseAt && !(c.lastCustomerReplyAt > c.lastAgentReplyAt)) continue;
    const reason = c.firstResponseAt ? `Customer waiting more than ${REPLY_HOURS} hours for a reply` : `No answer within ${FIRST_RESPONSE_HOURS} hours`;
    await escalate(null, c.reference, { reason }, { auto: true }).then(() => escalated++).catch(() => {});
  }
  const closeBefore = new Date(now.getTime() - REOPEN_DAYS * 86400000);
  const stale = await prisma.supportTicket.findMany({ where: { status: 'RESOLVED', resolvedAt: { lt: closeBefore } }, select: { id: true } });
  for (const s of stale) {
    await prisma.$transaction([prisma.supportTicket.update({ where: { id: s.id }, data: { status: 'CLOSED', closedAt: now } }), prisma.supportMessage.create({ data: { ticketId: s.id, authorType: 'SYSTEM', body: `Closed automatically ${REOPEN_DAYS} days after it was resolved.` } })]);
  }
  return { escalated, closed: stale.length };
}

/** Admin: make an account a support agent (or stop). */
export async function setAgent(admin, { email, userId, agent }) {
  if (admin?.role !== 'SUPER_ADMIN') throw new SupportError(403, 'Only an admin can manage support agents.');
  const u = await prisma.user.findFirst({ where: userId ? { id: userId } : { email: String(email || '').trim().toLowerCase() }, select: { id: true, name: true, email: true, role: true, status: true } });
  if (!u) throw new SupportError(404, 'No account with this email.');
  if (u.role === 'SUPER_ADMIN') throw new SupportError(409, 'Admins are always support agents.');
  if (agent && u.status !== 'ACTIVE') throw new SupportError(409, 'Only an active account can be a support agent.');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { isSupportAgent: Boolean(agent) } });
    if (!agent) await tx.supportTicket.updateMany({ where: { assigneeId: u.id, status: { in: OPEN_STATES } }, data: { assigneeId: null } });
    await tx.auditLog.create({ data: { userId: admin.id, action: agent ? 'SUPPORT_AGENT_ADDED' : 'SUPPORT_AGENT_REMOVED', targetType: 'User', targetId: u.id, details: { email: u.email } } });
  });
  return { id: u.id, name: u.name, email: u.email, isSupportAgent: Boolean(agent) };
}
