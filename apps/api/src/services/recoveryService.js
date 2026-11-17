import prisma from '../config/prisma.js';
import { AccessError } from './orgAccess.js';
import { orgAudit } from './orgService.js';
import { createRecoveryCode, MAX_PERCENT } from './discountService.js';
import { dispatchNotification, NOTIFICATION_TYPES } from './notificationService.js';
import { offerText } from './intentAnalyticsService.js';

/*
 * Automatic abandoned-checkout reminders. An organization turns them on and chooses the delay and an optional
 * personal discount. Every 15 minutes (server.js) checkouts that lapsed unpaid (order FAILED: hold expired or
 * the customer cancelled) between RECOVERY_WINDOW_HOURS ago and `delay` ago get one reminder, unless:
 *   - the event is no longer on sale (not published, hidden, or already started),
 *   - the customer has bought tickets for that event since, or has another checkout open for it,
 *   - the customer was already reminded about that event in the last COOLDOWN_DAYS (automatic or by hand).
 * Each reminder is recorded (RecoveryReminder) so recovery can be measured.
 */

export const RECOVERY_WINDOW_HOURS = 72;
export const COOLDOWN_DAYS = 7;
const SETTINGS = ['recoveryEnabled', 'recoveryDelayHours', 'recoveryDiscountPercent', 'recoveryValidHours'];

/** Settings and the last 30 days' results: sent, and how many of those customers then bought tickets. */
export async function getSettings(ctx) {
  const c = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: Object.fromEntries(SETTINGS.map((k) => [k, true])) });
  const since = new Date(Date.now() - 30 * 86400000);
  const sent = await prisma.recoveryReminder.findMany({ where: { companyId: ctx.companyId, sentAt: { gte: since } }, select: { userId: true, eventId: true, sentAt: true, source: true, discountCodeId: true } });
  let recovered = 0;
  let codesUsed = 0;
  for (const r of sent) {
    const bought = await prisma.order.findFirst({ where: { userId: r.userId, eventId: r.eventId, status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] }, createdAt: { gt: r.sentAt } }, select: { id: true } });
    if (bought) recovered++;
    if (r.discountCodeId && (await prisma.discountRedemption.count({ where: { discountCodeId: r.discountCodeId, status: 'REDEEMED' } }))) codesUsed++;
  }
  return {
    settings: c,
    limits: { maxPercent: MAX_PERCENT, windowHours: RECOVERY_WINDOW_HOURS, cooldownDays: COOLDOWN_DAYS },
    last30Days: { sent: sent.length, automatic: sent.filter((r) => r.source === 'AUTO').length, manual: sent.filter((r) => r.source === 'MANUAL').length, recovered, codesUsed, rate: sent.length ? Math.round((recovered / sent.length) * 100) : 0 },
  };
}

export async function updateSettings(req, ctx, input) {
  const data = Object.fromEntries(SETTINGS.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  if (data.recoveryDiscountPercent !== undefined && (data.recoveryDiscountPercent < 0 || data.recoveryDiscountPercent > MAX_PERCENT)) throw new AccessError(400, `The discount must be 0–${MAX_PERCENT}%.`);
  if (data.recoveryDelayHours !== undefined && (data.recoveryDelayHours < 1 || data.recoveryDelayHours > RECOVERY_WINDOW_HOURS - 1)) throw new AccessError(400, `Send between 1 and ${RECOVERY_WINDOW_HOURS - 1} hours after the checkout lapsed.`);
  const before = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: Object.fromEntries(SETTINGS.map((k) => [k, true])) });
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data });
    await orgAudit(tx, { req, ctx, action: 'ORG_RECOVERY_SETTINGS_CHANGED', targetType: 'Company', targetId: ctx.companyId, before, after: data });
  });
  return getSettings(ctx);
}

/** Was this customer reminded about this event recently (automatically or by hand)? */
export const recentlyReminded = async (userId, eventId, now = new Date()) =>
  Boolean(await prisma.recoveryReminder.findFirst({ where: { userId, eventId, sentAt: { gt: new Date(now.getTime() - COOLDOWN_DAYS * 86400000) } }, select: { id: true } }));

/** One pass of the job. Returns how many reminders were sent. */
export async function runAutoRecovery(now = new Date()) {
  const companies = await prisma.company.findMany({ where: { recoveryEnabled: true, status: 'APPROVED' }, select: { id: true, recoveryDelayHours: true, recoveryDiscountPercent: true, recoveryValidHours: true } });
  let sent = 0;
  for (const c of companies) {
    const newest = new Date(now.getTime() - c.recoveryDelayHours * 3600000);
    const oldest = new Date(now.getTime() - RECOVERY_WINDOW_HOURS * 3600000);
    const lapsed = await prisma.order.findMany({
      where: {
        status: 'FAILED',
        updatedAt: { gte: oldest, lte: newest },
        user: { status: 'ACTIVE' },
        event: { companyId: c.id, status: 'PUBLISHED', isHidden: false, OR: [{ startsAt: { gt: now } }, { startsAt: null, date: { gt: now } }] },
      },
      select: { id: true, userId: true, eventId: true, createdAt: true, updatedAt: true, event: { select: { id: true, name: true, city: true } }, user: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const seen = new Set();
    for (const o of lapsed) {
      const key = `${o.userId}:${o.eventId}`;
      if (seen.has(key)) continue; // the latest lapsed checkout per customer and event
      seen.add(key);
      const [boughtOrOpen, reminded] = await Promise.all([
        prisma.order.findFirst({ where: { userId: o.userId, eventId: o.eventId, OR: [{ status: 'PENDING' }, { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] }, createdAt: { gte: o.createdAt } }] }, select: { id: true } }),
        recentlyReminded(o.userId, o.eventId, now),
      ]);
      if (boughtOrOpen || reminded) continue;
      try {
        const dc = c.recoveryDiscountPercent > 0
          ? await createRecoveryCode({ companyId: c.id, eventId: o.eventId, userId: o.userId, percent: c.recoveryDiscountPercent, validHours: c.recoveryValidHours })
          : null;
        await dispatchNotification({
          userId: o.userId,
          type: NOTIFICATION_TYPES.ABANDONED_CHECKOUT_REMINDER,
          title: `Your seats for ${o.event.name} are waiting!`,
          message: `Hi ${(o.user.name || '').split(/\s+/)[0] || 'there'}, you didn't finish booking ${o.event.name} in ${o.event.city}. Seats are selling, so pick yours again soon.${offerText(dc)}`,
          data: { eventId: o.eventId, discountCode: dc?.code || null },
          link: `/events/${o.eventId}${dc ? `?code=${encodeURIComponent(dc.code)}` : ''}`,
          sendPush: false,
        });
        await prisma.recoveryReminder.create({ data: { companyId: c.id, eventId: o.eventId, userId: o.userId, orderId: o.id, discountCodeId: dc?.id || null, source: 'AUTO' } });
        await prisma.auditLog.create({ data: { companyId: c.id, action: 'AUTO_ABANDONED_CART_REMINDER', targetType: 'User', targetId: o.userId, details: { eventId: o.eventId, orderId: o.id, discountCode: dc?.code || null } } });
        sent++;
      } catch (e) {
        console.warn(`[Recovery] reminder for order ${o.id} failed:`, e.message);
      }
    }
  }
  return { sent };
}
