import prisma from '../config/prisma.js';
import { getSetting } from './systemConfig.js';

/*
 * The admin finance overview for a period: money in (paid orders by line), refunds, the platform's fee, what is
 * owed to organizations (payouts by status), money waiting for checks, daily sales and the top organizations.
 */

const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const PAID = ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'];

export async function overview({ from, to } = {}) {
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86400000);
  const period = { gte: start, lte: end };
  const feePercent = Number(await getSetting('platformFeePercent'));
  const rate = feePercent / 100;
  const [orders, refunds, failedRefunds, payouts, financeChecks, byMethod] = await Promise.all([
    prisma.order.findMany({ where: { status: { in: PAID }, createdAt: period }, select: { createdAt: true, totalAmount: true, subtotalAmount: true, discountAmount: true, groupDiscountAmount: true, serviceFeeAmount: true, taxAmount: true, event: { select: { companyId: true } } } }),
    prisma.refund.aggregate({ where: { status: 'SUCCEEDED', processedAt: period }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.refund.count({ where: { status: 'FAILED' } }),
    prisma.payout.groupBy({ by: ['status'], _sum: { netAmount: true }, _count: { _all: true } }),
    prisma.companyFinancialProfile.count({ where: { status: 'PENDING' } }),
    prisma.order.groupBy({ by: ['paymentMethod'], where: { status: { in: PAID }, createdAt: period }, _sum: { totalAmount: true }, _count: { _all: true } }),
  ]);
  let gross = 0;
  let tickets = 0;
  let discounts = 0;
  let fees = 0;
  let tax = 0;
  const daily = {};
  const perCompany = {};
  for (const o of orders) {
    const sub = Number(o.subtotalAmount ?? o.totalAmount);
    const disc = Number(o.discountAmount || 0) + Number(o.groupDiscountAmount || 0);
    gross += Number(o.totalAmount);
    tickets += sub - disc;
    discounts += disc;
    fees += Number(o.serviceFeeAmount || 0);
    tax += Number(o.taxAmount || 0);
    const day = o.createdAt.toISOString().slice(0, 10);
    daily[day] = (daily[day] || 0) + Number(o.totalAmount);
    perCompany[o.event.companyId] = (perCompany[o.event.companyId] || 0) + Number(o.totalAmount);
  }
  const top = Object.entries(perCompany).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const companies = await prisma.company.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, companyName: true } });
  const nameOf = Object.fromEntries(companies.map((c) => [c.id, c.companyName]));
  const payoutBy = Object.fromEntries(payouts.map((p) => [p.status, { count: p._count._all, amount: money(p._sum.netAmount) }]));
  return {
    period: { from: start, to: end },
    platformFeePercent: feePercent,
    totals: {
      orders: orders.length,
      collected: money(gross),
      ticketSales: money(tickets),
      discounts: money(discounts),
      serviceFees: money(fees),
      taxCollected: money(tax),
      refunded: money(refunds._sum.amount),
      refundsCount: refunds._count._all,
      platformFee: money(tickets * rate),
    },
    payouts: payoutBy,
    attention: { failedRefunds, payoutDetailsToCheck: financeChecks, payoutsReady: payoutBy.PROCESSING?.count || 0, payoutsOnHold: payoutBy.ON_HOLD?.count || 0 },
    byMethod: byMethod.map((m) => ({ method: m.paymentMethod, orders: m._count._all, amount: money(m._sum.totalAmount) })),
    daily: Object.entries(daily).sort().map(([day, amount]) => ({ day, amount: money(amount) })),
    topOrganizations: top.map(([id, amount]) => ({ id, name: nameOf[id] || id, amount: money(amount) })),
  };
}
