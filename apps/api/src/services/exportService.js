import prisma from '../config/prisma.js';

/*
 * Admin data exports as CSV. Each dataset is a query and its columns; `from` / `to` filter by creation date.
 * At most MAX_ROWS rows per file. Every export is written to the audit log (who exported what, which dates).
 */

export const MAX_ROWS = 50000;
const range = (from, to) => (from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {});
const n = (v) => (v == null ? '' : Number(v));

export const DATASETS = {
  users: {
    label: 'User accounts',
    columns: ['id', 'name', 'email', 'phone', 'role', 'status', 'city', 'emailVerified', 'createdAt'],
    rows: async (w) => (await prisma.user.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, select: { id: true, name: true, email: true, phone: true, role: true, status: true, city: true, emailVerifiedAt: true, createdAt: true } })).map((u) => ({ ...u, emailVerified: Boolean(u.emailVerifiedAt) })),
  },
  organizations: {
    label: 'Organizations',
    columns: ['id', 'companyName', 'ownerName', 'email', 'phone', 'city', 'ntnCnic', 'status', 'payoutDetails', 'members', 'events', 'createdAt'],
    rows: async (w) => (await prisma.company.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, include: { financialProfile: { select: { status: true } }, _count: { select: { memberships: true, events: true } } } })).map((c) => ({ ...c, payoutDetails: c.financialProfile?.status || 'NONE', members: c._count.memberships, events: c._count.events })),
  },
  events: {
    label: 'Events',
    columns: ['id', 'name', 'organization', 'type', 'status', 'city', 'venue', 'date', 'ticketsSold', 'createdAt'],
    rows: async (w) => (await prisma.event.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, include: { company: { select: { companyName: true } }, _count: { select: { tickets: { where: { order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] } } } } } } } })).map((e) => ({ ...e, organization: e.company.companyName, ticketsSold: e._count.tickets })),
  },
  orders: {
    label: 'Orders and payments',
    columns: ['id', 'invoiceNumber', 'customerEmail', 'event', 'status', 'paymentMethod', 'paymentTxId', 'subtotal', 'discount', 'groupDiscount', 'serviceFee', 'tax', 'total', 'tickets', 'createdAt'],
    rows: async (w) => (await prisma.order.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, include: { user: { select: { email: true } }, event: { select: { name: true } }, _count: { select: { tickets: true } } } })).map((o) => ({ ...o, customerEmail: o.user.email, event: o.event.name, subtotal: n(o.subtotalAmount ?? o.totalAmount), discount: n(o.discountAmount), groupDiscount: n(o.groupDiscountAmount), serviceFee: n(o.serviceFeeAmount), tax: n(o.taxAmount), total: n(o.totalAmount), tickets: o._count.tickets })),
  },
  refunds: {
    label: 'Refunds',
    columns: ['id', 'event', 'customerEmail', 'reason', 'status', 'amount', 'providerRef', 'createdAt', 'processedAt'],
    rows: async (w) => (await prisma.refund.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, include: { event: { select: { name: true } }, user: { select: { email: true } } } })).map((r) => ({ ...r, event: r.event?.name, customerEmail: r.user?.email, amount: n(r.amount) })),
  },
  payouts: {
    label: 'Payouts',
    columns: ['id', 'organization', 'event', 'status', 'grossSales', 'serviceFees', 'taxCollected', 'refunds', 'platformFee', 'netAmount', 'destination', 'reference', 'scheduledFor', 'paidAt'],
    rows: async (w) => {
      const rows = await prisma.payout.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS });
      const [cos, evs] = await Promise.all([prisma.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, companyName: true } }), prisma.event.findMany({ where: { id: { in: rows.map((r) => r.eventId) } }, select: { id: true, name: true } })]);
      const co = Object.fromEntries(cos.map((c) => [c.id, c.companyName]));
      const ev = Object.fromEntries(evs.map((e) => [e.id, e.name]));
      return rows.map((p) => ({ ...p, organization: co[p.companyId], event: ev[p.eventId], grossSales: n(p.grossSales), serviceFees: n(p.serviceFees), taxCollected: n(p.taxCollected), refunds: n(p.refunds), platformFee: n(p.platformFee), netAmount: n(p.netAmount) }));
    },
  },
  'support-tickets': {
    label: 'Support requests',
    columns: ['reference', 'category', 'subject', 'status', 'priority', 'customerEmail', 'assignee', 'escalationLevel', 'createdAt', 'firstResponseAt', 'resolvedAt'],
    rows: async (w) => (await prisma.supportTicket.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, include: { user: { select: { email: true } }, assignee: { select: { name: true } } } })).map((t) => ({ ...t, customerEmail: t.user.email, assignee: t.assignee?.name || '' })),
  },
  'audit-log': {
    label: 'Audit log',
    columns: ['createdAt', 'action', 'userId', 'actorRole', 'companyId', 'targetType', 'targetId', 'ipAddress', 'details'],
    rows: async (w) => (await prisma.auditLog.findMany({ where: w, orderBy: { createdAt: 'asc' }, take: MAX_ROWS })).map((a) => ({ ...a, details: JSON.stringify(a.details ?? {}) })),
  },
};

const cell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

export async function exportCsv(admin, dataset, { from, to } = {}) {
  const d = DATASETS[dataset];
  if (!d) throw Object.assign(new Error('Unknown dataset.'), { status: 404 });
  const rows = await d.rows(range(from, to));
  await prisma.auditLog.create({ data: { userId: admin.id, action: 'ADMIN_DATA_EXPORTED', targetType: 'Export', targetId: dataset, details: { dataset, from: from || null, to: to || null, rows: rows.length } } });
  return [d.columns.join(','), ...rows.map((r) => d.columns.map((c) => cell(r[c])).join(','))].join('\n');
}
