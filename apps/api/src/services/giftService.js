import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import { eventTiming, moveRefusal, TIMING_SELECT } from './eventTiming.js';
import { sha256 } from './tokenService.js';
import { sendEmailNotification } from './emailService.js';

/*
 * Gift tickets and group bookings. The buyer sends one or more of their paid tickets to someone by email:
 *   - GIFT: tickets for a friend (optionally with a message)
 *   - GROUP: each ticket of a group booking to its own group member, so everyone has their own pass
 * If an account with that email exists, the ticket moves to it at once. Otherwise the recipient gets an email
 * with a one-time claim link (/gifts/<token>); they sign in or sign up with that email and claim it. Until then
 * the buyer keeps the ticket and can cancel the gift. Moving a ticket works like a direct transfer: the old QR
 * and manual code stop working, the move is in the ticket's transfer history.
 */

export class GiftError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FRONTEND = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Moves one ticket to `recipient` (inside a transaction). */
async function moveTicket(tx, ticket, recipient, fromUserId) {
  const newNonce = crypto.randomUUID();
  await tx.resaleListing.updateMany({ where: { ticketId: ticket.id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
  await tx.ticket.update({
    where: { id: ticket.id },
    data: { userId: recipient.id, ownerWallet: recipient.walletAddress || ticket.ownerWallet, qrNonce: newNonce, qrIssuedAt: new Date(), qrVersion: { increment: 1 }, manualCode: null },
  });
  await tx.ticketTransferHistory.create({ data: { ticketId: ticket.id, fromUserId, toUserId: recipient.id, transferType: 'DIRECT_TRANSFER', price: 0, oldNonce: ticket.qrNonce, newNonce, txHash: ticket.txHash } });
}

async function claimInTx(tx, gift, recipient) {
  const ticket = await tx.ticket.findUnique({ where: { id: gift.ticketId }, include: { event: { select: TIMING_SELECT } } });
  if (!ticket || ticket.userId !== gift.senderId || ticket.status !== 'ACTIVE') throw new GiftError(409, 'This ticket can no longer be given (it was used, refunded or moved).');
  // A gift sent before the event can be claimed until it ends (e.g. a group member at the gate), never after
  if (ticket.event.status === 'CANCELLED' || eventTiming(ticket.event).ended) throw new GiftError(410, `${ticket.event.name} has ended or was cancelled, so this ticket can no longer be claimed.`);
  await moveTicket(tx, ticket, recipient, gift.senderId);
  await tx.ticketGift.update({ where: { id: gift.id }, data: { status: 'CLAIMED', claimedById: recipient.id, claimedAt: new Date() } });
}

/**
 * Send tickets. `recipients` is [{ ticketId, email, name? }] (a group booking) or one email for every ticket
 * (a gift). Returns each gift with whether it was delivered at once.
 */
export async function sendGifts(user, { ticketIds, recipients, email, name, message, kind = 'GIFT' }) {
  const plan = recipients?.length ? recipients : ticketIds.map((ticketId) => ({ ticketId, email, name }));
  if (!plan.length) throw new GiftError(400, 'Choose at least one ticket.');
  const ids = [...new Set(plan.map((p) => p.ticketId))];
  if (ids.length !== plan.length) throw new GiftError(400, 'Each ticket can go to one person only.');
  const tickets = await prisma.ticket.findMany({ where: { id: { in: ids } }, include: { order: { select: { status: true, userId: true } }, event: { select: { id: true, name: true, startsAt: true, endsAt: true, date: true, time: true, status: true } }, seat: { include: { tier: true } } } });
  if (tickets.length !== ids.length) throw new GiftError(404, 'Ticket not found.');
  for (const t of tickets) {
    if (t.userId !== user.id) throw new GiftError(403, 'You can only send tickets you hold.');
    if (t.status !== 'ACTIVE' || !['SUCCESSFUL', 'PARTIALLY_REFUNDED'].includes(t.order.status)) throw new GiftError(409, 'Only paid, unused tickets can be sent.');
    const timing = moveRefusal(t.event, 'sent');
    if (timing) throw new GiftError(409, timing);
  }
  const pending = await prisma.ticketGift.findFirst({ where: { ticketId: { in: ids }, status: 'PENDING' }, select: { id: true } });
  if (pending) throw new GiftError(409, 'One of these tickets is already waiting to be claimed. Cancel that gift first.');
  for (const p of plan) {
    p.email = String(p.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new GiftError(400, `"${p.email}" is not an email address.`);
    if (p.email === user.email.toLowerCase()) throw new GiftError(400, 'You already hold these tickets.');
  }

  const out = [];
  for (const p of plan) {
    const ticket = tickets.find((t) => t.id === p.ticketId);
    const raw = crypto.randomBytes(24).toString('base64url');
    const recipient = await prisma.user.findUnique({ where: { email: p.email }, select: { id: true, name: true, email: true, walletAddress: true, status: true } });
    const gift = await prisma.$transaction(async (tx) => {
      const g = await tx.ticketGift.create({ data: { ticketId: ticket.id, orderId: ticket.orderId, senderId: user.id, recipientEmail: p.email, recipientName: p.name || null, message: message || null, kind, tokenHash: sha256(raw) } });
      if (recipient?.status === 'ACTIVE') {
        await claimInTx(tx, g, recipient);
        await tx.notification.create({ data: { userId: recipient.id, type: 'TICKET_RECEIVED', title: kind === 'GROUP' ? `${user.name} added you to their group` : `🎁 ${user.name} sent you a ticket`, message: `${ticket.event.name} · ${ticket.seat?.tier?.name || 'Ticket'}. It's in your ticket wallet now${message ? `. "${message}"` : ''}.`, link: '/wallet' } });
      }
      await tx.auditLog.create({ data: { userId: user.id, action: kind === 'GROUP' ? 'TICKET_GROUP_ASSIGNED' : 'TICKET_GIFTED', targetType: 'Ticket', targetId: ticket.id, details: { recipientEmail: p.email, delivered: Boolean(recipient) } } });
      return g;
    });
    if (!recipient || recipient.status !== 'ACTIVE') {
      // No account yet: an email with the claim link (this is the only way they can get the ticket)
      await sendEmailNotification({
        to: p.email,
        subject: `[TicketLedger] ${user.name} sent you a ticket for ${ticket.event.name}`,
        type: 'TICKET_GIFT',
        title: kind === 'GROUP' ? `You're in ${user.name}'s group for ${ticket.event.name}` : `${user.name} sent you a ticket`,
        message: `${ticket.event.name} · ${ticket.seat?.tier?.name || 'Ticket'}.${message ? ` "${message}"` : ''} Sign in or create a TicketLedger account with this email address (${p.email}) to claim it.`,
        action: { label: 'Claim your ticket', url: `${FRONTEND()}/gifts/${raw}` },
      }).catch((e) => console.warn('[Gift email]', e.message));
    }
    out.push({ id: gift.id, ticketId: ticket.id, email: p.email, delivered: Boolean(recipient && recipient.status === 'ACTIVE') });
  }
  return out;
}

/** What a claim link offers (no sign-in needed to look). */
export async function previewGift(rawToken) {
  const g = await prisma.ticketGift.findUnique({ where: { tokenHash: sha256(String(rawToken || '')) } });
  if (!g) throw new GiftError(404, 'This gift link is not valid.');
  const [sender, ticket] = await Promise.all([
    prisma.user.findUnique({ where: { id: g.senderId }, select: { name: true } }),
    prisma.ticket.findUnique({ where: { id: g.ticketId }, select: { event: { select: { id: true, name: true, venue: true, city: true, date: true, startsAt: true } }, seat: { select: { section: true, row: true, seatNumber: true, tier: { select: { name: true } } } } } }),
  ]);
  return { status: g.status, kind: g.kind, recipientEmail: g.recipientEmail, message: g.message, sender: sender?.name, event: ticket?.event, ticketType: ticket?.seat?.tier?.name, seat: ticket?.seat };
}

/** Claim with the link, signed in with the email it was sent to. */
export async function claimGift(user, rawToken) {
  const g = await prisma.ticketGift.findUnique({ where: { tokenHash: sha256(String(rawToken || '')) } });
  if (!g) throw new GiftError(404, 'This gift link is not valid.');
  if (g.status === 'CLAIMED') throw new GiftError(410, 'This ticket was already claimed.');
  if (g.status === 'CANCELLED') throw new GiftError(410, 'The sender cancelled this gift.');
  if (user.email.toLowerCase() !== g.recipientEmail) throw new GiftError(403, `This ticket was sent to ${g.recipientEmail}. Sign in with that email to claim it.`);
  const recipient = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, walletAddress: true } });
  await prisma.$transaction(async (tx) => {
    // The row is re-read under the transaction: two claims can't both succeed
    const fresh = await tx.ticketGift.updateMany({ where: { id: g.id, status: 'PENDING' }, data: { status: 'PENDING' } });
    if (!fresh.count) throw new GiftError(410, 'This ticket was already claimed.');
    await claimInTx(tx, g, recipient);
    await tx.notification.create({ data: { userId: g.senderId, type: 'TICKET_GIFT_CLAIMED', title: 'Your gift was claimed', message: `${user.name} (${user.email}) claimed the ticket you sent.`, link: '/my-bookings' } });
  });
  return { claimed: true, ticketId: g.ticketId };
}

export async function cancelGift(user, giftId) {
  const { count } = await prisma.ticketGift.updateMany({ where: { id: giftId, senderId: user.id, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  if (!count) throw new GiftError(409, 'Only a gift that has not been claimed yet can be cancelled.');
  return { cancelled: true };
}

/** Gifts I sent (with their status) and gifts waiting for me. */
export async function myGifts(user) {
  const [sent, waiting] = await Promise.all([
    prisma.ticketGift.findMany({ where: { senderId: user.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.ticketGift.findMany({ where: { recipientEmail: user.email.toLowerCase(), status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
  ]);
  return { sent: sent.map(({ tokenHash, ...g }) => g), waitingForMe: waiting.map(({ tokenHash, ...g }) => g) };
}

/** Claim a gift that is waiting for my email (from my account, without the link). */
export async function claimWaiting(user, giftId) {
  const g = await prisma.ticketGift.findUnique({ where: { id: giftId } });
  if (!g || g.recipientEmail !== user.email.toLowerCase()) throw new GiftError(404, 'Gift not found.');
  if (g.status !== 'PENDING') throw new GiftError(410, g.status === 'CLAIMED' ? 'This ticket was already claimed.' : 'The sender cancelled this gift.');
  const recipient = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, walletAddress: true } });
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.ticketGift.updateMany({ where: { id: g.id, status: 'PENDING' }, data: { status: 'PENDING' } });
    if (!fresh.count) throw new GiftError(410, 'This ticket was already claimed.');
    await claimInTx(tx, g, recipient);
    await tx.notification.create({ data: { userId: g.senderId, type: 'TICKET_GIFT_CLAIMED', title: 'Your gift was claimed', message: `${user.name} (${user.email}) claimed the ticket you sent.`, link: '/my-bookings' } });
  });
  return { claimed: true, ticketId: g.ticketId };
}
