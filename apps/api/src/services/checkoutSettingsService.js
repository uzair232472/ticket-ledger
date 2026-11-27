import prisma from '../config/prisma.js';
import { AccessError } from './orgAccess.js';
import { orgAudit } from './orgService.js';

/*
 * Checkout settings of an organization: service fee and tax (organization-wide, finance.manage) and each event's
 * rules (event.edit): tickets per customer, automatic group discount, seat changes. Prices of orders already
 * placed never change; new settings apply to new checkouts.
 */

const FEE_FIELDS = ['serviceFeeType', 'serviceFeeValue', 'taxPercent', 'taxLabel', 'taxRegistrationNumber'];
const RULE_FIELDS = ['maxTicketsPerCustomer', 'groupMinTickets', 'groupDiscountPercent', 'allowSeatChanges', 'seatChangeCutoffHours'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const num = (v) => (v == null ? v : Number(v));

export async function getSettings(ctx) {
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: Object.fromEntries(FEE_FIELDS.map((k) => [k, true])) });
  const events = await prisma.event.findMany({
    where: { companyId: ctx.companyId, ...(ctx.eventScoped ? { id: { in: ctx.eventIds } } : {}), status: { notIn: ['CANCELLED'] } },
    select: { id: true, name: true, date: true, status: true, ...Object.fromEntries(RULE_FIELDS.map((k) => [k, true])) },
    orderBy: { date: 'asc' },
  });
  return { fees: { ...company, serviceFeeValue: num(company.serviceFeeValue), taxPercent: num(company.taxPercent) }, events };
}

export async function updateFees(req, ctx, input) {
  const data = pick(input, FEE_FIELDS);
  const type = data.serviceFeeType;
  const value = data.serviceFeeValue;
  if (type === 'PERCENT' && !(value >= 0 && value <= 30)) throw new AccessError(400, 'A percentage service fee must be 0–30%.');
  if (type === 'PER_TICKET' && !(value >= 0 && value <= 5000)) throw new AccessError(400, 'A service fee per ticket must be PKR 0–5,000.');
  if (type === 'NONE') data.serviceFeeValue = 0;
  if (data.taxPercent !== undefined && !(data.taxPercent >= 0 && data.taxPercent <= 30)) throw new AccessError(400, 'Tax must be 0–30%.');
  const before = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: Object.fromEntries(FEE_FIELDS.map((k) => [k, true])) });
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data });
    await orgAudit(tx, { req, ctx, action: 'ORG_CHECKOUT_FEES_CHANGED', targetType: 'Company', targetId: ctx.companyId, before: { ...before, serviceFeeValue: num(before.serviceFeeValue), taxPercent: num(before.taxPercent) }, after: data });
  });
  return getSettings(ctx);
}

export async function updateEventRules(req, ctx, eventId, input) {
  const event = await prisma.event.findFirst({ where: { id: eventId, companyId: ctx.companyId }, select: { id: true, name: true, ...Object.fromEntries(RULE_FIELDS.map((k) => [k, true])) } });
  if (!event) throw new AccessError(404, 'Event not found in your organization.');
  if (ctx.eventScoped && !ctx.eventIds.includes(eventId)) throw new AccessError(403, 'You can only change events you are assigned to.');
  const data = pick(input, RULE_FIELDS);
  const min = data.groupMinTickets !== undefined ? data.groupMinTickets : event.groupMinTickets;
  const pct = data.groupDiscountPercent !== undefined ? data.groupDiscountPercent : event.groupDiscountPercent;
  if (Boolean(min) !== Boolean(pct)) throw new AccessError(400, 'A group discount needs both the group size and the percentage (or neither).');
  if (min && !(min >= 2 && min <= 10)) throw new AccessError(400, 'A group is 2–10 tickets (one order holds up to 10).');
  if (pct && !(pct >= 1 && pct <= 50)) throw new AccessError(400, 'A group discount is 1–50%.');
  const max = data.maxTicketsPerCustomer !== undefined ? data.maxTicketsPerCustomer : event.maxTicketsPerCustomer;
  if (max != null && !(max >= 1 && max <= 100)) throw new AccessError(400, 'The limit per customer is 1–100 tickets.');
  if (max && min && min > max) throw new AccessError(400, "The group size can't be more than the limit per customer.");
  if (data.seatChangeCutoffHours !== undefined && !(data.seatChangeCutoffHours >= 0 && data.seatChangeCutoffHours <= 720)) throw new AccessError(400, 'The seat-change cut-off is 0–720 hours before the event.');
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data });
    await orgAudit(tx, { req, ctx, action: 'EVENT_CHECKOUT_RULES_CHANGED', targetType: 'Event', targetId: eventId, before: pick(event, Object.keys(data)), after: data, details: { eventName: event.name } });
  });
  return getSettings(ctx);
}
