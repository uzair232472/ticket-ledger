import prisma from '../config/prisma.js';
import { AccessError } from './orgAccess.js';
import { notifyAdmins } from './notificationService.js';
import { masked } from './financeCrypto.js';
import { getSetting } from './systemConfig.js';
import { recordAdminAction } from './adminActions.js';

/*
 * Organizer payouts. After an event ends, TicketLedger owes its organization the money collected for it:
 *
 *   ticket sales (after discounts) + service fees + tax collected − refunds paid − platform fee (5% of ticket sales)
 *
 * The hourly job (server.js) creates one Payout per ended event, scheduled by the organization's payout schedule
 * (after each event: 3 days after it ends · weekly: the Monday after · monthly: the 1st of the next month).
 * A payout is ON_HOLD while the payout details aren't verified, becomes PROCESSING when due (amounts recalculated
 * then, so late refunds are included), and an admin marks it PAID with the bank / wallet reference once the
 * transfer is made (or FAILED with a reason). Owners are told at each step. TicketLedger has no bank API, so
 * the transfer itself is made by the finance team outside the app.
 */

export const PLATFORM_FEE_RATE = 0.05;
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const DAY = 86400000;

export const eventEnd = (e) => e.endsAt || (e.startsAt ? new Date(e.startsAt.getTime() + 3 * 3600000) : new Date(new Date(e.date).getTime() + DAY));

/** When a payout for an event that ended at `end` is due, by schedule. */
export function dueDate(end, schedule = 'AFTER_EVENT') {
  const d = new Date(end);
  if (schedule === 'WEEKLY') {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    while (next.getUTCDay() !== 1) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (schedule === 'MONTHLY') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return new Date(d.getTime() + 3 * DAY);
}

/** The money of one event, from its paid orders and refunds. */
export async function computeEvent(eventId) {
  const [orders, refunds] = await Promise.all([
    prisma.order.findMany({ where: { eventId, status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, select: { totalAmount: true, subtotalAmount: true, discountAmount: true, groupDiscountAmount: true, serviceFeeAmount: true, taxAmount: true } }),
    prisma.refund.aggregate({ where: { eventId, status: 'SUCCEEDED' }, _sum: { amount: true } }),
  ]);
  let ticketSales = 0;
  let serviceFees = 0;
  let tax = 0;
  for (const o of orders) {
    ticketSales += Number(o.subtotalAmount ?? o.totalAmount) - Number(o.discountAmount || 0) - Number(o.groupDiscountAmount || 0);
    serviceFees += Number(o.serviceFeeAmount || 0);
    tax += Number(o.taxAmount || 0);
  }
  const refunded = Number(refunds._sum.amount || 0);
  const platformFee = money((ticketSales * Number(await getSetting('platformFeePercent'))) / 100);
  return {
    orders: orders.length,
    grossSales: money(ticketSales),
    serviceFees: money(serviceFees),
    taxCollected: money(tax),
    refunds: money(refunded),
    platformFee,
    netAmount: money(Math.max(0, ticketSales + serviceFees + tax - refunded - platformFee)),
  };
}

const destinationOf = (f) => (f ? (f.payoutMethod === 'BANK_TRANSFER' ? `${f.bankName || 'Bank'} ${masked(f.ibanLast4)}` : `${f.payoutMethod === 'JAZZCASH' ? 'JazzCash' : 'EasyPaisa'} ${masked(f.walletLast4)}`) : null);

async function tellOwners(companyId, { title, message }) {
  const owners = await prisma.organizationMember.findMany({ where: { companyId, status: 'ACTIVE', role: { in: ['OWNER', 'FINANCE_MANAGER'] } }, select: { userId: true } });
  if (owners.length) await prisma.notification.createMany({ data: owners.map((o) => ({ userId: o.userId, type: 'ORG_PAYOUT', title, message, link: '/organizer/organization?tab=payouts' })) });
}

/** The hourly job: create payouts for ended events, release holds, and make due payouts ready to pay. */
export async function runPayouts(now = new Date(), { companyId } = {}) {
  const only = companyId ? { companyId } : {};
  let created = 0;
  let due = 0;
  // 1. Events that ended and have sales but no payout yet
  const ended = await prisma.event.findMany({
    where: { ...only, OR: [{ endsAt: { lt: now } }, { endsAt: null, date: { lt: new Date(now.getTime() - DAY) } }], orders: { some: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } } },
    select: { id: true, name: true, companyId: true, endsAt: true, startsAt: true, date: true },
    take: 200,
  });
  const existing = new Set((await prisma.payout.findMany({ where: { eventId: { in: ended.map((e) => e.id) } }, select: { eventId: true } })).map((p) => p.eventId));
  for (const e of ended.filter((x) => !existing.has(x.id))) {
    const fin = await prisma.companyFinancialProfile.findUnique({ where: { companyId: e.companyId } });
    const { orders: _orders, ...sums } = await computeEvent(e.id);
    if (!sums.netAmount) continue; // nothing owed (e.g. a cancelled event refunded in full)
    const verified = fin?.status === 'VERIFIED';
    try {
      await prisma.payout.create({
        data: {
          companyId: e.companyId,
          eventId: e.id,
          periodEnd: now,
          ...sums,
          status: verified ? 'SCHEDULED' : 'ON_HOLD',
          holdReason: verified ? null : 'Payout details are not verified yet.',
          payoutMethod: fin?.payoutMethod || null,
          destination: destinationOf(fin),
          scheduledFor: dueDate(eventEnd(e), fin?.payoutSchedule),
        },
      });
      created++;
      await tellOwners(e.companyId, { title: `Payout for ${e.name}`, message: verified ? `PKR ${sums.netAmount.toLocaleString()} is scheduled for ${dueDate(eventEnd(e), fin?.payoutSchedule).toDateString()}.` : `PKR ${sums.netAmount.toLocaleString()} is on hold until TicketLedger verifies your payout details (Organization → Payouts & tax).` });
    } catch (err) {
      if (err.code !== 'P2002') throw err; // created by a parallel run
    }
  }
  // 2. Holds waiting only for verification
  const held = await prisma.payout.findMany({ where: { ...only, status: 'ON_HOLD', holdReason: 'Payout details are not verified yet.' }, select: { id: true, companyId: true } });
  for (const h of held) {
    const fin = await prisma.companyFinancialProfile.findUnique({ where: { companyId: h.companyId } });
    if (fin?.status === 'VERIFIED') await prisma.payout.update({ where: { id: h.id }, data: { status: 'SCHEDULED', holdReason: null, payoutMethod: fin.payoutMethod, destination: destinationOf(fin) } });
  }
  // 3. Due payouts: recalculate (late refunds), then ready for the finance team to pay
  const ready = await prisma.payout.findMany({ where: { ...only, status: 'SCHEDULED', scheduledFor: { lte: now } } });
  for (const p of ready) {
    const fin = await prisma.companyFinancialProfile.findUnique({ where: { companyId: p.companyId } });
    if (fin?.status !== 'VERIFIED') {
      await prisma.payout.update({ where: { id: p.id }, data: { status: 'ON_HOLD', holdReason: 'Payout details are not verified yet.' } });
      continue;
    }
    const sums = await computeEvent(p.eventId);
    const { orders, ...amounts } = sums;
    await prisma.payout.update({ where: { id: p.id }, data: { ...amounts, periodEnd: now, status: 'PROCESSING', payoutMethod: fin.payoutMethod, destination: destinationOf(fin) } });
    due++;
  }
  if (due) await notifyAdmins({ type: 'ADMIN_PAYOUT_DUE', title: `${due} payout${due === 1 ? '' : 's'} ready to pay`, message: 'Make the transfers, then mark them paid with the bank or wallet reference (Admin → Payouts).', link: '/admin/payouts' });
  return { created, due };
}

const PAYOUT_VIEW = (p, events = {}, companies = {}) => ({
  ...p,
  grossSales: Number(p.grossSales),
  refunds: Number(p.refunds),
  platformFee: Number(p.platformFee),
  serviceFees: Number(p.serviceFees),
  taxCollected: Number(p.taxCollected),
  netAmount: Number(p.netAmount),
  event: events[p.eventId] || null,
  company: companies[p.companyId] || undefined,
});

async function withNames(rows, { companies = false } = {}) {
  const ev = await prisma.event.findMany({ where: { id: { in: rows.map((r) => r.eventId) } }, select: { id: true, name: true, date: true, endsAt: true } });
  const co = companies ? await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, companyName: true } }) : [];
  return rows.map((r) => PAYOUT_VIEW(r, Object.fromEntries(ev.map((e) => [e.id, e])), Object.fromEntries(co.map((c) => [c.id, c]))));
}

/** The organization's payouts, and what is still to come for events that haven't ended. */
export async function orgPayouts(ctx) {
  const rows = await prisma.payout.findMany({ where: { companyId: ctx.companyId }, orderBy: { scheduledFor: 'desc' }, take: 200 });
  const upcomingEvents = await prisma.event.findMany({ where: { companyId: ctx.companyId, OR: [{ endsAt: { gte: new Date() } }, { endsAt: null, date: { gte: new Date() } }], orders: { some: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] } } } }, select: { id: true, name: true, date: true, endsAt: true, startsAt: true }, orderBy: { date: 'asc' }, take: 50 });
  const fin = await prisma.companyFinancialProfile.findUnique({ where: { companyId: ctx.companyId }, select: { payoutSchedule: true, status: true } });
  const upcoming = [];
  for (const e of upcomingEvents) upcoming.push({ event: { id: e.id, name: e.name, date: e.date }, estimate: await computeEvent(e.id), expectedOn: dueDate(eventEnd(e), fin?.payoutSchedule) });
  const payouts = await withNames(rows);
  const total = (st) => money(payouts.filter((p) => st.includes(p.status)).reduce((n, p) => n + p.netAmount, 0));
  return { payouts, upcoming, totals: { paid: total(['PAID']), onTheWay: total(['SCHEDULED', 'PROCESSING']), onHold: total(['ON_HOLD']) }, financeStatus: fin?.status || 'UNVERIFIED', platformFeeRate: Number(await getSetting('platformFeePercent')) / 100 };
}

// ── Admin ──────────────────────────────────────────────────────────────────────────────────────────────

export async function adminPayouts({ status } = {}) {
  const rows = await prisma.payout.findMany({ where: status ? { status } : {}, orderBy: [{ status: 'asc' }, { scheduledFor: 'asc' }], take: 300 });
  return withNames(rows, { companies: true });
}

const audit = (db, adminId, p, action, details) => db.auditLog.create({ data: { userId: adminId, companyId: p.companyId, action, targetType: 'Payout', targetId: p.id, details: { eventId: p.eventId, netAmount: Number(p.netAmount), ...details } } });

/** Admin decisions: PAID (reference required), FAILED (reason), ON_HOLD (reason) or release a hold. */
export async function decide(admin, payoutId, { action, reference, reason }) {
  const p = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!p) throw new AccessError(404, 'Payout not found.');
  const event = await prisma.event.findUnique({ where: { id: p.eventId }, select: { name: true } });
  let data;
  let note;
  if (action === 'PAID') {
    if (!['PROCESSING', 'SCHEDULED', 'FAILED'].includes(p.status)) throw new AccessError(409, `A ${p.status.toLowerCase()} payout can't be marked paid.`);
    if (!reference) throw new AccessError(400, 'Enter the bank or wallet transfer reference.');
    const fin = await prisma.companyFinancialProfile.findUnique({ where: { companyId: p.companyId }, select: { status: true } });
    if (fin?.status !== 'VERIFIED') throw new AccessError(409, "The organization's payout details aren't verified.");
    data = { status: 'PAID', reference, paidAt: new Date(), processedById: admin.id, failureReason: null };
    note = { title: `Payout sent: ${event?.name}`, message: `PKR ${Number(p.netAmount).toLocaleString()} was paid to ${p.destination || 'your account'} (reference ${reference}).` };
  } else if (action === 'FAILED') {
    if (p.status !== 'PROCESSING') throw new AccessError(409, 'Only a payout being processed can fail.');
    if (!reason) throw new AccessError(400, 'Say why the transfer failed.');
    data = { status: 'FAILED', failureReason: reason, processedById: admin.id };
    note = { title: `Payout failed: ${event?.name}`, message: `The transfer of PKR ${Number(p.netAmount).toLocaleString()} failed: ${reason}. Check your payout details.` };
  } else if (action === 'HOLD') {
    if (!['SCHEDULED', 'PROCESSING', 'FAILED'].includes(p.status)) throw new AccessError(409, 'This payout cannot be put on hold.');
    if (!reason) throw new AccessError(400, 'Say why the payout is held.');
    data = { status: 'ON_HOLD', holdReason: reason };
    note = { title: `Payout on hold: ${event?.name}`, message: `TicketLedger put this payout on hold: ${reason}` };
  } else if (action === 'RELEASE') {
    if (p.status !== 'ON_HOLD') throw new AccessError(409, 'This payout is not on hold.');
    data = { status: 'SCHEDULED', holdReason: null };
  } else if (action === 'RETRY') {
    if (p.status !== 'FAILED') throw new AccessError(409, 'Only a failed payout can be tried again.');
    data = { status: 'PROCESSING', failureReason: null };
  } else throw new AccessError(400, 'Unknown action.');
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.payout.update({ where: { id: p.id }, data });
    await audit(tx, admin.id, p, `PAYOUT_${action}`, { reference: reference || null, reason: reason || null });
    if (action === 'HOLD') await recordAdminAction(tx, { admin, action: 'PAYOUT_HOLD', targetType: 'Payout', targetId: p.id, summary: `Held the payout for ${event?.name}: ${reason}`, before: { status: p.status, holdReason: p.holdReason }, after: { status: 'ON_HOLD' } });
    else await recordAdminAction(tx, { admin, action: `PAYOUT_${action}`, targetType: 'Payout', targetId: p.id, summary: `Payout for ${event?.name}: ${action.toLowerCase()}${reference ? ` (ref ${reference})` : ''}`, before: { status: p.status }, after: { status: data.status }, reversible: false });
    return u;
  });
  if (note) await tellOwners(p.companyId, note);
  return (await withNames([updated], { companies: true }))[0];
}
