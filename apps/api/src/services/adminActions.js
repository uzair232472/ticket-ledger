import prisma from '../config/prisma.js';
import { invalidateConfig } from './systemConfig.js';

/*
 * Admin actions: every important admin decision is recorded with its before / after state. Reversible ones
 * (user and company status, payout-detail checks, payout holds, system settings) can be undone within
 * UNDO_DAYS, as long as nothing changed the target since; the undo is recorded too.
 *
 * Destructive actions need a typed confirmation: the request carries `confirm` equal to a phrase the admin
 * types (the user's email, the company name…). assertConfirmed() refuses with 428 and the phrase to type.
 */

export const UNDO_DAYS = 30;

export class ConfirmationRequired extends Error {
  constructor(phrase, what) {
    super(`Type "${phrase}" to confirm ${what}.`);
    this.status = 428;
    this.code = 'CONFIRMATION_REQUIRED';
    this.phrase = phrase;
  }
}
export function assertConfirmed(given, phrase, what) {
  if (String(given || '').trim().toLowerCase() !== String(phrase).trim().toLowerCase()) throw new ConfirmationRequired(phrase, what);
}

export const recordAdminAction = (db, { admin, action, targetType, targetId, summary, before, after, reversible = true }) =>
  db.adminAction.create({ data: { adminId: admin.id, action, targetType, targetId, summary, before: before ?? undefined, after: after ?? undefined, reversible } });

/** How to put each reversible action back: compares the current state, then restores `before`. */
const REVERSERS = {
  USER_STATUS: {
    current: async (a) => (await prisma.user.findUnique({ where: { id: a.targetId }, select: { status: true } }))?.status,
    expected: (a) => a.after.status,
    apply: (tx, a) => tx.user.update({ where: { id: a.targetId }, data: { status: a.before.status } }),
  },
  COMPANY_STATUS: {
    current: async (a) => (await prisma.company.findUnique({ where: { id: a.targetId }, select: { status: true } }))?.status,
    expected: (a) => a.after.status,
    apply: (tx, a) => tx.company.update({ where: { id: a.targetId }, data: { status: a.before.status, rejectionReason: a.before.rejectionReason ?? null } }),
  },
  FINANCE_REVIEW: {
    current: async (a) => (await prisma.companyFinancialProfile.findUnique({ where: { companyId: a.targetId }, select: { status: true } }))?.status,
    expected: (a) => a.after.status,
    apply: (tx, a) => tx.companyFinancialProfile.update({ where: { companyId: a.targetId }, data: { status: a.before.status, reviewNote: null } }),
  },
  PAYOUT_HOLD: {
    current: async (a) => (await prisma.payout.findUnique({ where: { id: a.targetId }, select: { status: true } }))?.status,
    expected: (a) => a.after.status,
    apply: (tx, a) => tx.payout.update({ where: { id: a.targetId }, data: { status: a.before.status, holdReason: a.before.holdReason ?? null } }),
  },
  SYSTEM_SETTING: {
    current: async (a) => JSON.stringify((await prisma.systemSetting.findUnique({ where: { key: a.targetId } }))?.value ?? null),
    expected: (a) => JSON.stringify(a.after.value ?? null),
    apply: async (tx, a) => {
      if (a.before.value === undefined || a.before.value === null) await tx.systemSetting.deleteMany({ where: { key: a.targetId } });
      else await tx.systemSetting.upsert({ where: { key: a.targetId }, update: { value: a.before.value }, create: { key: a.targetId, value: a.before.value } });
      invalidateConfig();
    },
  },
};

export async function listActions({ page = 1, limit = 50, reversibleOnly = false } = {}) {
  const where = reversibleOnly ? { reversible: true, reversedAt: null, createdAt: { gte: new Date(Date.now() - UNDO_DAYS * 86400000) } } : {};
  const take = Math.min(100, Number(limit) || 50);
  const [rows, total] = await Promise.all([prisma.adminAction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (Math.max(1, Number(page)) - 1) * take, take }), prisma.adminAction.count({ where })]);
  const ids = [...new Set(rows.flatMap((r) => [r.adminId, r.reversedById]).filter(Boolean))];
  const admins = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = Object.fromEntries(admins.map((a) => [a.id, a.name]));
  const undoUntil = (r) => new Date(r.createdAt.getTime() + UNDO_DAYS * 86400000);
  return {
    total,
    items: rows.map((r) => ({ ...r, admin: name[r.adminId] || null, reversedBy: r.reversedById ? name[r.reversedById] || null : null, canUndo: r.reversible && !r.reversedAt && undoUntil(r) > new Date() && Boolean(REVERSERS[r.action]), undoUntil: undoUntil(r) })),
  };
}

export async function undo(admin, actionId) {
  const a = await prisma.adminAction.findUnique({ where: { id: actionId } });
  if (!a) throw Object.assign(new Error('Action not found.'), { status: 404 });
  const r = REVERSERS[a.action];
  if (!a.reversible || !r) throw Object.assign(new Error('This action cannot be undone.'), { status: 409 });
  if (a.reversedAt) throw Object.assign(new Error('This action was already undone.'), { status: 409 });
  if (Date.now() - a.createdAt.getTime() > UNDO_DAYS * 86400000) throw Object.assign(new Error(`Actions can be undone for ${UNDO_DAYS} days.`), { status: 409 });
  if ((await r.current(a)) !== r.expected(a)) throw Object.assign(new Error('It has changed since, so undoing it could overwrite a newer decision.'), { status: 409 });
  await prisma.$transaction(async (tx) => {
    await r.apply(tx, a);
    await tx.adminAction.update({ where: { id: a.id }, data: { reversedAt: new Date(), reversedById: admin.id } });
    await tx.adminAction.create({ data: { adminId: admin.id, action: `${a.action}_UNDONE`, targetType: a.targetType, targetId: a.targetId, summary: `Undid: ${a.summary}`, before: a.after, after: a.before, reversible: false } });
    await tx.auditLog.create({ data: { userId: admin.id, action: 'ADMIN_ACTION_UNDONE', targetType: a.targetType, targetId: a.targetId, details: { actionId: a.id, action: a.action, summary: a.summary } } });
  });
  return { undone: true };
}
