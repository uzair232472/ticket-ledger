import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import { AccessError } from './orgAccess.js';
import { orgAudit } from './orgService.js';

/*
 * Checkout discount codes. A code belongs to one organization and works on all its events or on one event.
 *
 * Limits (total uses, uses per customer) count a redemption while its order is unpaid (RESERVED on a PENDING
 * order) or paid (REDEEMED). An order that fails, expires or is cancelled stops counting by itself, so a seat
 * hold that lapses never "uses up" a code. Reservation runs inside the checkout transaction with the code row
 * locked, so two parallel checkouts can't both take the last use.
 *
 * A code never makes an order free: percentages go up to 90% and a fixed amount leaves at least PKR 1 to pay
 * (every gateway needs a real payment).
 */

export const MAX_PERCENT = 90;
export const MIN_PAYABLE = 1;

export class DiscountError extends Error {
  constructor(message, code = 'DISCOUNT_INVALID', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const normalizeCode = (code) => String(code || '').trim().toUpperCase().replace(/\s+/g, '');
const money = (n) => Math.round(Number(n) * 100) / 100;

/** The discount on an order of `subtotal` PKR. */
export function discountAmount(code, subtotal) {
  const raw = code.type === 'PERCENT' ? (subtotal * Number(code.value)) / 100 : Number(code.value);
  return money(Math.max(0, Math.min(raw, subtotal - MIN_PAYABLE)));
}

/** Uses that count against the limits: paid, or reserved by an order still waiting for payment. */
const liveUses = (extra = {}) => ({ ...extra, OR: [{ status: 'REDEEMED' }, { status: 'RESERVED', order: { status: 'PENDING' } }] });

/**
 * Checks a code for this customer, event and order size. Returns { code, discount, total }. Throws DiscountError
 * with a message the customer can read. `excludeOrderId` leaves out an order being re-quoted (a retry).
 */
export async function quote(db, { code: rawCode, event, userId, ticketCount, subtotal, excludeOrderId = null, now = new Date() }) {
  const code = normalizeCode(rawCode);
  if (!code) throw new DiscountError('Enter a discount code.');
  const dc = await db.discountCode.findUnique({ where: { companyId_code: { companyId: event.companyId, code } } });
  if (!dc || !dc.active) throw new DiscountError(`"${code}" isn't a valid code for this event.`, 'DISCOUNT_NOT_FOUND');
  if (dc.eventId && dc.eventId !== event.id) throw new DiscountError(`"${code}" isn't a valid code for this event.`, 'DISCOUNT_NOT_FOUND');
  if (dc.restrictedToUserId && dc.restrictedToUserId !== userId) throw new DiscountError(`"${code}" is a personal code for another account.`, 'DISCOUNT_NOT_YOURS');
  if (dc.startsAt && dc.startsAt > now) throw new DiscountError(`"${code}" can be used from ${dc.startsAt.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' })}.`, 'DISCOUNT_NOT_STARTED');
  if (dc.endsAt && dc.endsAt <= now) throw new DiscountError(`"${code}" has expired.`, 'DISCOUNT_EXPIRED');
  if (ticketCount < dc.minTickets) throw new DiscountError(`"${code}" needs at least ${dc.minTickets} tickets in the order.`, 'DISCOUNT_MIN_TICKETS');

  const notThis = excludeOrderId ? { orderId: { not: excludeOrderId } } : {};
  if (dc.maxRedemptions != null) {
    const used = await db.discountRedemption.count({ where: liveUses({ discountCodeId: dc.id, ...notThis }) });
    if (used >= dc.maxRedemptions) throw new DiscountError(`"${code}" has been fully used.`, 'DISCOUNT_USED_UP');
  }
  if (dc.perUserLimit) {
    const mine = await db.discountRedemption.count({ where: liveUses({ discountCodeId: dc.id, userId, ...notThis }) });
    if (mine >= dc.perUserLimit) throw new DiscountError(dc.perUserLimit === 1 ? `You've already used "${code}".` : `You've used "${code}" the maximum ${dc.perUserLimit} times.`, 'DISCOUNT_USER_LIMIT');
  }
  const discount = discountAmount(dc, subtotal);
  if (!(discount > 0)) throw new DiscountError(`"${code}" doesn't reduce this order.`, 'DISCOUNT_NO_EFFECT');
  return { code: dc, discount, total: money(subtotal - discount) };
}

/** Inside the checkout transaction: lock the code, re-check it, and reserve it for the new order. */
export async function reserve(tx, { code, event, userId, ticketCount, subtotal, orderId }) {
  const normalized = normalizeCode(code);
  await tx.$queryRaw`SELECT "id" FROM "DiscountCode" WHERE "companyId" = ${event.companyId} AND "code" = ${normalized} FOR UPDATE`;
  const q = await quote(tx, { code: normalized, event, userId, ticketCount, subtotal, excludeOrderId: orderId });
  await tx.discountRedemption.create({ data: { discountCodeId: q.code.id, orderId, userId, amount: q.discount } });
  return q;
}

/** When the order is paid. */
export const markRedeemed = (tx, orderId) => tx.discountRedemption.updateMany({ where: { orderId, status: 'RESERVED' }, data: { status: 'REDEEMED', redeemedAt: new Date() } });

// ── Organizer management ───────────────────────────────────────────────────────────────────────────────

function serialize(dc, usage = {}) {
  const now = Date.now();
  let state = 'ACTIVE';
  if (!dc.active) state = 'OFF';
  else if (dc.endsAt && dc.endsAt.getTime() <= now) state = 'EXPIRED';
  else if (dc.startsAt && dc.startsAt.getTime() > now) state = 'SCHEDULED';
  else if (dc.maxRedemptions != null && (usage.used || 0) >= dc.maxRedemptions) state = 'USED_UP';
  return {
    id: dc.id,
    code: dc.code,
    description: dc.description,
    type: dc.type,
    value: Number(dc.value),
    eventId: dc.eventId,
    event: dc.event ? { id: dc.event.id, name: dc.event.name } : null,
    maxRedemptions: dc.maxRedemptions,
    perUserLimit: dc.perUserLimit,
    minTickets: dc.minTickets,
    startsAt: dc.startsAt,
    endsAt: dc.endsAt,
    active: dc.active,
    source: dc.source,
    restrictedToUserId: dc.restrictedToUserId,
    state,
    used: usage.used || 0,
    reserved: usage.reserved || 0,
    discountGiven: usage.discountGiven || 0,
    createdAt: dc.createdAt,
  };
}

async function usageFor(ids) {
  if (!ids.length) return {};
  const [paid, pending] = await Promise.all([
    prisma.discountRedemption.groupBy({ by: ['discountCodeId'], where: { discountCodeId: { in: ids }, status: 'REDEEMED' }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.discountRedemption.groupBy({ by: ['discountCodeId'], where: { discountCodeId: { in: ids }, status: 'RESERVED', order: { status: 'PENDING' } }, _count: { _all: true } }),
  ]);
  const out = {};
  for (const r of paid) out[r.discountCodeId] = { used: r._count._all, discountGiven: Number(r._sum.amount || 0), reserved: 0 };
  for (const r of pending) {
    out[r.discountCodeId] = out[r.discountCodeId] || { used: 0, discountGiven: 0 };
    out[r.discountCodeId].reserved = r._count._all;
    out[r.discountCodeId].used += r._count._all;
  }
  return out;
}

/** Event-scoped members see and manage only codes of their own events. */
const scopeWhere = (ctx) => (ctx.eventScoped ? { companyId: ctx.companyId, eventId: { in: ctx.eventIds } } : { companyId: ctx.companyId });

export async function listCodes(ctx, { source, eventId } = {}) {
  const codes = await prisma.discountCode.findMany({
    where: { ...scopeWhere(ctx), ...(source ? { source } : {}), ...(eventId ? { eventId } : {}) },
    include: { event: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const usage = await usageFor(codes.map((c) => c.id));
  return codes.map((c) => serialize(c, usage[c.id]));
}

async function validEvent(ctx, eventId) {
  if (!eventId) {
    if (ctx.eventScoped) throw new AccessError(403, 'Choose one of your events: only owners, admins and organization-wide roles can make codes for every event.');
    return null;
  }
  const e = await prisma.event.findFirst({ where: { id: eventId, companyId: ctx.companyId }, select: { id: true } });
  if (!e) throw new AccessError(404, 'Event not found in your organization.');
  if (ctx.eventScoped && !ctx.eventIds.includes(eventId)) throw new AccessError(403, 'You can only make codes for events you are assigned to.');
  return eventId;
}

function checkValue(type, value) {
  if (type === 'PERCENT' && !(value >= 1 && value <= MAX_PERCENT)) throw new AccessError(400, `A percentage discount must be between 1 and ${MAX_PERCENT}%.`);
  if (type === 'FIXED' && !(value >= 1)) throw new AccessError(400, 'A fixed discount must be at least PKR 1.');
}

const FIELDS = ['description', 'type', 'value', 'maxRedemptions', 'perUserLimit', 'minTickets', 'startsAt', 'endsAt', 'active'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const plain = (dc) => ({ ...pick(dc, ['code', 'eventId', ...FIELDS]), value: Number(dc.value) });

export async function createCode(req, ctx, input) {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new AccessError(400, 'Codes are 3–32 letters, digits, - or _.');
  checkValue(input.type, input.value);
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw new AccessError(400, 'The end must be after the start.');
  const eventId = await validEvent(ctx, input.eventId);
  try {
    const dc = await prisma.$transaction(async (tx) => {
      const created = await tx.discountCode.create({ data: { ...pick(input, FIELDS), code, eventId, companyId: ctx.companyId, createdById: req.user.id, source: 'MANUAL' }, include: { event: { select: { id: true, name: true } } } });
      await orgAudit(tx, { req, ctx, action: 'DISCOUNT_CODE_CREATED', targetType: 'DiscountCode', targetId: created.id, after: plain(created) });
      return created;
    });
    return serialize(dc);
  } catch (e) {
    if (e.code === 'P2002') throw new AccessError(409, `Your organization already has a code "${code}".`);
    throw e;
  }
}

async function loadCode(ctx, id) {
  const dc = await prisma.discountCode.findFirst({ where: { id, ...scopeWhere(ctx) }, include: { event: { select: { id: true, name: true } } } });
  if (!dc) throw new AccessError(404, 'Discount code not found.');
  return dc;
}

/** Codes can be changed; the code text and its event stay fixed once created (orders refer to them). */
export async function updateCode(req, ctx, id, input) {
  const dc = await loadCode(ctx, id);
  const wanted = pick(input, FIELDS);
  checkValue(wanted.type ?? dc.type, wanted.value ?? Number(dc.value));
  const starts = wanted.startsAt !== undefined ? wanted.startsAt : dc.startsAt;
  const ends = wanted.endsAt !== undefined ? wanted.endsAt : dc.endsAt;
  if (starts && ends && ends <= starts) throw new AccessError(400, 'The end must be after the start.');
  const before = plain(dc);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.discountCode.update({ where: { id }, data: wanted, include: { event: { select: { id: true, name: true } } } });
    const after = plain(u);
    const changed = Object.keys(after).filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''));
    if (changed.length) await orgAudit(tx, { req, ctx, action: 'DISCOUNT_CODE_UPDATED', targetType: 'DiscountCode', targetId: id, before: pick(before, changed), after: pick(after, changed), details: { code: u.code } });
    return u;
  });
  return serialize(updated, (await usageFor([id]))[id]);
}

/** Deletes a code nobody has used; a used code is turned off instead (paid orders keep pointing to it). */
export async function deleteCode(req, ctx, id) {
  const dc = await loadCode(ctx, id);
  const uses = await prisma.discountRedemption.count({ where: { discountCodeId: id } });
  if (uses) {
    await updateCode(req, ctx, id, { active: false });
    return { deleted: false, deactivated: true };
  }
  await prisma.$transaction(async (tx) => {
    await tx.discountCode.delete({ where: { id } });
    await orgAudit(tx, { req, ctx, action: 'DISCOUNT_CODE_DELETED', targetType: 'DiscountCode', targetId: id, before: plain(dc) });
  });
  return { deleted: true };
}

/**
 * A personal, single-use code for one customer's abandoned checkout: only they can use it, once, on this
 * event, before it expires. Returns the created code.
 */
export async function createRecoveryCode({ companyId, eventId, userId, percent = 10, validHours = 48, createdById }, db = prisma) {
  const pct = Math.min(MAX_PERCENT, Math.max(1, Math.round(Number(percent) || 10)));
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `BACK${pct}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    try {
      return await db.discountCode.create({
        data: {
          companyId,
          eventId,
          code,
          description: 'Abandoned checkout reminder',
          type: 'PERCENT',
          value: pct,
          maxRedemptions: 1,
          perUserLimit: 1,
          endsAt: new Date(Date.now() + validHours * 3600 * 1000),
          source: 'CART_RECOVERY',
          restrictedToUserId: userId,
          createdById: createdById || null,
        },
      });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
    }
  }
  throw new Error('Could not create a unique recovery code.');
}
