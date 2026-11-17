import prisma from '../config/prisma.js';

/*
 * Suspicious account investigations. A case is opened on one account (from the fraud watchlist or a user's
 * page) and keeps, in time order: notes, evidence, the actions admins took on the account (status changes are
 * added automatically while a case is open), and status changes of the case itself. Closing needs an outcome.
 */

export const RISK = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

async function names(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  const users = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

export async function listCases({ status, userId } = {}) {
  const rows = await prisma.investigation.findMany({ where: { ...(status ? { status } : {}), ...(userId ? { userId } : {}) }, orderBy: { updatedAt: 'desc' }, take: 200, include: { _count: { select: { notes: true } } } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, email: true, status: true } });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const who = await names(rows.map((r) => r.openedById));
  return rows.map((r) => ({ ...r, user: byId[r.userId] || null, openedBy: who[r.openedById] || null, notes: r._count.notes }));
}

export async function getCase(id) {
  const c = await prisma.investigation.findUnique({ where: { id }, include: { notes: { orderBy: { createdAt: 'asc' } } } });
  if (!c) throw Object.assign(new Error('Investigation not found.'), { status: 404 });
  const [user, orders, recentAudit, behavior] = await Promise.all([
    prisma.user.findUnique({ where: { id: c.userId }, select: { id: true, name: true, email: true, phone: true, role: true, status: true, city: true, createdAt: true, walletAddress: true } }),
    prisma.order.groupBy({ by: ['status'], where: { userId: c.userId }, _count: { _all: true } }),
    prisma.auditLog.findMany({ where: { OR: [{ userId: c.userId }, { targetId: c.userId }] }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, action: true, createdAt: true, ipAddress: true, details: true } }),
    prisma.behaviorEvent.count({ where: { userId: c.userId, action: 'CHECKOUT_BOT_EVALUATION' } }).catch(() => 0),
  ]);
  const who = await names([c.openedById, c.closedById, ...c.notes.map((n) => n.authorId)]);
  return {
    ...c,
    openedBy: who[c.openedById] || null,
    closedBy: c.closedById ? who[c.closedById] || null : null,
    notes: c.notes.map((n) => ({ ...n, author: n.authorId ? who[n.authorId] || null : 'System' })),
    account: user,
    signals: { orders: Object.fromEntries(orders.map((o) => [o.status, o._count._all])), botChecks: behavior, recentActivity: recentAudit },
  };
}

export async function openCase(admin, { userId, title, riskLevel = 'MEDIUM', note }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw Object.assign(new Error('Account not found.'), { status: 404 });
  if (await prisma.investigation.findFirst({ where: { userId, status: { not: 'CLOSED' } }, select: { id: true } })) throw Object.assign(new Error('This account already has an open investigation.'), { status: 409 });
  const c = await prisma.investigation.create({ data: { userId, title, riskLevel, openedById: admin.id, notes: { create: [{ authorId: admin.id, kind: 'STATUS', body: `Investigation opened (${riskLevel.toLowerCase()} risk).` }, ...(note ? [{ authorId: admin.id, kind: 'NOTE', body: note }] : [])] } } });
  await prisma.auditLog.create({ data: { userId: admin.id, action: 'INVESTIGATION_OPENED', targetType: 'User', targetId: userId, details: { investigationId: c.id, title, riskLevel } } });
  return getCase(c.id);
}

export async function addNote(admin, id, { kind = 'NOTE', body }) {
  const c = await prisma.investigation.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!c) throw Object.assign(new Error('Investigation not found.'), { status: 404 });
  if (c.status === 'CLOSED') throw Object.assign(new Error('Reopen the investigation to add to it.'), { status: 409 });
  await prisma.$transaction([prisma.investigationNote.create({ data: { investigationId: id, authorId: admin.id, kind, body } }), prisma.investigation.update({ where: { id }, data: { updatedAt: new Date() } })]);
  return getCase(id);
}

export async function updateCase(admin, id, { status, riskLevel, outcome }) {
  const c = await prisma.investigation.findUnique({ where: { id } });
  if (!c) throw Object.assign(new Error('Investigation not found.'), { status: 404 });
  if (status === 'CLOSED' && !outcome) throw Object.assign(new Error('Write the outcome to close the investigation.'), { status: 400 });
  const data = {};
  const lines = [];
  if (status && status !== c.status) {
    Object.assign(data, { status }, status === 'CLOSED' ? { closedAt: new Date(), closedById: admin.id, outcome } : { closedAt: null, closedById: null });
    lines.push(status === 'CLOSED' ? `Closed: ${outcome}` : `Status changed to ${status.toLowerCase()}.`);
  }
  if (riskLevel && riskLevel !== c.riskLevel) {
    data.riskLevel = riskLevel;
    lines.push(`Risk changed to ${riskLevel.toLowerCase()}.`);
  }
  if (!lines.length) return getCase(id);
  await prisma.$transaction([prisma.investigation.update({ where: { id }, data }), ...lines.map((body) => prisma.investigationNote.create({ data: { investigationId: id, authorId: admin.id, kind: 'STATUS', body } }))]);
  await prisma.auditLog.create({ data: { userId: admin.id, action: 'INVESTIGATION_UPDATED', targetType: 'User', targetId: c.userId, details: { investigationId: id, ...data } } });
  return getCase(id);
}

/** Called when an admin changes an account: noted on its open investigation, if any. */
export async function noteAccountAction(db, { userId, adminId, body, data }) {
  const open = await db.investigation.findFirst({ where: { userId, status: { not: 'CLOSED' } }, select: { id: true } });
  if (open) await db.investigationNote.create({ data: { investigationId: open.id, authorId: adminId, kind: 'ACTION', body, data } });
}
