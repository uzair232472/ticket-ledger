import prisma from '../config/prisma.js';
import paymentService from './paymentService.js';
import { notifyAdmins } from './notificationService.js';

/*
 * Refunds, one per ticket. The money goes back to whoever paid for the ticket last: the fan who bought it
 * on resale gets the resale price back; otherwise the order's buyer gets the face value back (a gifted
 * ticket's refund goes to the person who paid, since money can only go back to the original payment).
 * The organizer is charged the face value (organizerShare); a resale premium (at most 10%) is covered by
 * TicketLedger. Refunds are processed after the database work, retried by the hourly job when they fail,
 * and each person gets one email per event with their total.
 */

export const MAX_REFUND_ATTEMPTS = 5;
export const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;

const METHOD_TEXT = {
  STRIPE: 'the card you paid with (card refunds take 5–10 working days to appear)',
  JAZZCASH: 'your JazzCash account',
  EASYPAISA: 'your Easypaisa account',
  MOCK: 'your original payment method',
};
export const methodText = (method) => METHOD_TEXT[method] || 'your original payment method';

// Tickets that are still someone's valid entry (used ones count too: the event may be cancelled mid-way)
export const LIVE_TICKET_STATUSES = ['ACTIVE', 'SCANNED'];

/** Who paid for this ticket last, how much, and how. `ticket` needs `order`. */
export async function payerFor(ticket, db = prisma) {
  const resale = await db.ticketTransferHistory.findFirst({
    where: { ticketId: ticket.id, transferType: 'P2P_RESALE', price: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  if (resale) {
    const listing = await db.resaleListing.findFirst({
      where: { ticketId: ticket.id, buyerId: resale.toUserId, status: 'SOLD' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return { userId: resale.toUserId, amount: Number(resale.price), orderId: null, resaleListingId: listing?.id || null, method: null, paymentTxId: null };
  }
  return {
    userId: ticket.order.userId,
    amount: Number(ticket.price),
    orderId: ticket.orderId,
    resaleListingId: null,
    method: ticket.order.paymentMethod,
    paymentTxId: ticket.order.paymentTxId,
  };
}

/** Order status after some of its tickets were refunded to its buyer. */
async function syncOrderStatus(tx, orderId) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, _count: { select: { tickets: true } } } });
  if (!order || !['SUCCESSFUL', 'PARTIALLY_REFUNDED'].includes(order.status)) return;
  const refunded = await tx.refund.count({ where: { orderId } });
  if (!refunded) return;
  await tx.order.update({ where: { id: orderId }, data: { status: refunded >= order._count.tickets ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
}

/**
 * Inside a transaction: cancels each ticket, closes its resale listing and creates its Refund (a ticket
 * already refunded is skipped). `tickets` need `order`. Returns the new refunds.
 */
export async function createRefunds(tx, tickets, reason) {
  const created = [];
  for (const ticket of tickets) {
    if (await tx.refund.findUnique({ where: { ticketId: ticket.id }, select: { id: true } })) continue;
    const payer = await payerFor(ticket, tx);
    await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'CANCELLED' } });
    await tx.resaleListing.updateMany({ where: { ticketId: ticket.id, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'CANCELLED' } });
    created.push(
      await tx.refund.create({
        data: {
          ticketId: ticket.id,
          eventId: ticket.eventId,
          userId: payer.userId,
          orderId: payer.orderId,
          resaleListingId: payer.resaleListingId,
          amount: payer.amount,
          organizerShare: Math.min(payer.amount, Number(ticket.price)),
          reason,
          method: payer.method,
          paymentTxId: payer.paymentTxId,
        },
      }),
    );
  }
  for (const orderId of new Set(tickets.map((t) => t.orderId))) await syncOrderStatus(tx, orderId);
  return created;
}

/** Sends the given refunds through the payment gateways; one email per person per event for the ones sent. */
export async function processRefunds(ids) {
  if (!ids?.length) return { sent: 0, failed: 0 };
  const refunds = await prisma.refund.findMany({
    where: { id: { in: ids }, status: { in: ['PENDING', 'FAILED'] } },
    include: { event: { select: { id: true, name: true } } },
  });
  const sent = [];
  const failed = [];
  for (const r of refunds) {
    // Claim it first, so the hourly retry and a request in flight never send the same refund twice
    const claimed = await prisma.refund.updateMany({ where: { id: r.id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    let result;
    try {
      result = await paymentService.refund({ paymentMethod: r.method, paymentTxId: r.paymentTxId, amount: r.amount, reference: r.id });
    } catch (error) {
      result = { success: false, message: error.message };
    }
    if (result.success) {
      await prisma.refund.update({ where: { id: r.id }, data: { status: 'SUCCEEDED', providerRef: result.providerRef || null, failureReason: null, processedAt: new Date() } });
      sent.push({ ...r, providerRef: result.providerRef });
    } else {
      await prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failureReason: result.message || 'The payment provider refused the refund.' } });
      failed.push({ ...r, attempts: r.attempts + 1 });
    }
  }

  // One "refund sent" email per person and event, with the total and the references
  const groups = new Map();
  for (const r of sent) {
    const key = `${r.userId}|${r.eventId}`;
    const g = groups.get(key) || { userId: r.userId, event: r.event, method: r.method, amount: 0, count: 0, refs: [] };
    g.amount += Number(r.amount);
    g.count += 1;
    if (r.providerRef) g.refs.push(r.providerRef);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    await prisma.notification.create({
      data: {
        userId: g.userId,
        type: 'REFUND_SENT',
        title: `Refund sent: ${pkr(g.amount)} for “${g.event.name}”`,
        message: `We’ve refunded ${pkr(g.amount)} for ${g.count} ticket${g.count === 1 ? '' : 's'} to “${g.event.name}” to ${methodText(g.method)}. Reference: ${g.refs.slice(0, 3).join(', ')}${g.refs.length > 3 ? ` and ${g.refs.length - 3} more` : ''}.`,
        link: '/my-bookings',
      },
    });
  }

  // Admins hear about a failure the first time and when retries run out (not on every hourly attempt)
  const alert = failed.filter((r) => r.attempts === 1 || r.attempts >= MAX_REFUND_ATTEMPTS);
  if (alert.length) {
    const total = alert.reduce((n, r) => n + Number(r.amount), 0);
    const gaveUp = alert.some((r) => r.attempts >= MAX_REFUND_ATTEMPTS);
    await notifyAdmins({
      type: 'ADMIN_REFUND_FAILED',
      title: `${alert.length} refund${alert.length === 1 ? '' : 's'} failed (${pkr(total)})`,
      message: `${[...new Set(alert.map((r) => `“${r.event.name}”`))].join(', ')}: ${alert[0].failureReason || 'the payment provider refused the refund'}. ${gaveUp ? 'Automatic retries have stopped; retry them from Event approvals → Refunds.' : 'They will be retried automatically every hour.'}`,
      link: '/admin/event-approvals?tab=refunds',
    });
  }
  return { sent: sent.length, failed: failed.length };
}

/** Runs processRefunds after the response, so a slow gateway never holds up the organizer's request. */
export const processRefundsLater = (ids) => {
  if (!ids?.length) return;
  setImmediate(() => processRefunds(ids).catch((e) => console.error('[Refunds] processing failed:', e)));
};

/** Hourly job: retry failed refunds (until MAX_REFUND_ATTEMPTS) and refunds left pending or stuck mid-way. */
export async function retryRefunds() {
  const now = Date.now();
  // A crash between claiming and finishing leaves PROCESSING; Stripe's idempotency key makes resending safe
  await prisma.refund.updateMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(now - 30 * 60 * 1000) } }, data: { status: 'FAILED', failureReason: 'Interrupted while processing.' } });
  const due = await prisma.refund.findMany({
    where: {
      OR: [
        { status: 'FAILED', attempts: { lt: MAX_REFUND_ATTEMPTS } },
        { status: 'PENDING', createdAt: { lt: new Date(now - 5 * 60 * 1000) } },
      ],
    },
    select: { id: true },
    take: 200,
  });
  return processRefunds(due.map((r) => r.id));
}
