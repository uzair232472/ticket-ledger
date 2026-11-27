import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';

/*
 * Booking changes: moving a paid ticket to another free seat of the same ticket type, when the event allows it
 * (Event.allowSeatChanges) and it is earlier than seatChangeCutoffHours before the start. Free of charge; at
 * most MAX_CHANGES per ticket. The old seat goes back on sale; the ticket gets a new QR and manual code.
 * The ticket's NFT stays valid: it keeps the old seat's chain key (chainSeatId), and the next buyer of the
 * freed seat gets a fresh key (bookingController.chainSeatFor), so the two never clash on-chain.
 */

export const MAX_CHANGES = 3;

export class SeatChangeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const startOf = (e) => new Date(e.startsAt || e.date);

async function loadChangeable(user, ticketId) {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { order: { select: { status: true } }, seat: { include: { tier: true } }, event: { select: { id: true, name: true, status: true, startsAt: true, date: true, allowSeatChanges: true, seatChangeCutoffHours: true } } },
  });
  if (!t || t.userId !== user.id) throw new SeatChangeError(404, 'Ticket not found.');
  const e = t.event;
  if (!e.allowSeatChanges) throw new SeatChangeError(409, "The organizer doesn't allow seat changes for this event.");
  if (e.status !== 'PUBLISHED') throw new SeatChangeError(409, 'Seats can only be changed while the event is on sale.');
  if (startOf(e).getTime() - Date.now() < e.seatChangeCutoffHours * 3600000) throw new SeatChangeError(409, `Seat changes close ${e.seatChangeCutoffHours} hours before the event.`);
  if (t.status !== 'ACTIVE' || !['SUCCESSFUL', 'PARTIALLY_REFUNDED'].includes(t.order.status)) throw new SeatChangeError(409, 'Only paid, unused tickets can change seats.');
  if (t.seatChanges >= MAX_CHANGES) throw new SeatChangeError(409, `This ticket has already changed seats ${MAX_CHANGES} times.`);
  if (await prisma.ticketGift.findFirst({ where: { ticketId, status: 'PENDING' }, select: { id: true } })) throw new SeatChangeError(409, 'This ticket is waiting to be claimed as a gift. Cancel the gift first.');
  if (await prisma.resaleListing.findFirst({ where: { ticketId, status: 'ACTIVE' }, select: { id: true } })) throw new SeatChangeError(409, 'This ticket is listed for resale. Take it off resale first.');
  return t;
}

/** Free seats of the same ticket type the ticket may move to. */
export async function options(user, ticketId) {
  const t = await loadChangeable(user, ticketId);
  const now = new Date();
  const seats = await prisma.seat.findMany({
    where: { eventId: t.eventId, tierId: t.seat.tierId, id: { not: t.seatId }, status: 'AVAILABLE', ticket: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }], kind: { not: 'GA_SLOT' } },
    select: { id: true, section: true, row: true, seatNumber: true, kind: true, wholeTable: true },
    orderBy: [{ section: 'asc' }, { row: 'asc' }, { seatNumber: 'asc' }],
    take: 500,
  });
  return {
    ticket: { id: t.id, tier: t.seat.tier.name, seat: { section: t.seat.section, row: t.seat.row, seatNumber: t.seat.seatNumber }, changesLeft: MAX_CHANGES - t.seatChanges },
    cutoffAt: new Date(startOf(t.event).getTime() - t.event.seatChangeCutoffHours * 3600000),
    seats: seats.filter((s) => !s.wholeTable),
  };
}

export async function changeSeat(user, ticketId, newSeatId) {
  const t = await loadChangeable(user, ticketId);
  if (t.seat.kind === 'GA_SLOT') throw new SeatChangeError(409, 'General admission tickets have no seat to change.');
  const result = await prisma.$transaction(async (tx) => {
    // Both seats locked: two customers can't take the same free seat, nor can a hold slip in between
    await tx.$queryRaw`SELECT "id" FROM "Seat" WHERE "id" IN (${t.seatId}, ${newSeatId}) FOR UPDATE`;
    const target = await tx.seat.findUnique({ where: { id: newSeatId }, include: { ticket: { select: { id: true } } } });
    const now = new Date();
    if (!target || target.eventId !== t.eventId || target.tierId !== t.seat.tierId) throw new SeatChangeError(400, 'Choose a free seat of the same ticket type.');
    if (target.status !== 'AVAILABLE' || target.ticket || (target.lockedUntil && target.lockedUntil > now) || target.wholeTable || target.kind === 'GA_SLOT') throw new SeatChangeError(409, 'That seat was just taken. Choose another.');
    await tx.seat.update({ where: { id: newSeatId }, data: { status: 'SOLD', lockedUntil: null, lockedByUserId: null } });
    await tx.seat.update({ where: { id: t.seatId }, data: { status: 'AVAILABLE', lockedUntil: null, lockedByUserId: null } });
    const updated = await tx.ticket.update({
      where: { id: t.id },
      data: { seatId: newSeatId, chainSeatId: t.chainSeatId || t.seatId, seatChanges: { increment: 1 }, qrVersion: { increment: 1 }, qrNonce: crypto.randomUUID(), qrIssuedAt: now, manualCode: null },
      include: { seat: true },
    });
    await tx.auditLog.create({ data: { userId: user.id, action: 'TICKET_SEAT_CHANGED', targetType: 'Ticket', targetId: t.id, details: { eventId: t.eventId, from: { seatId: t.seatId, section: t.seat.section, row: t.seat.row, seatNumber: t.seat.seatNumber }, to: { seatId: newSeatId, section: target.section, row: target.row, seatNumber: target.seatNumber } } } });
    await tx.notification.create({ data: { userId: user.id, type: 'TICKET_SEAT_CHANGED', title: 'Seat changed', message: `Your ${t.event.name} ticket is now ${[target.section, target.row && `Row ${target.row}`, target.seatNumber && `Seat ${target.seatNumber}`].filter(Boolean).join(' · ')}. Your old QR no longer works; use the new one in your wallet.`, link: '/wallet' } });
    return { old: t.seat, now: updated.seat };
  });
  const io = getIO();
  if (io) {
    for (const [seat, status] of [[result.old, 'AVAILABLE'], [result.now, 'SOLD']]) {
      io.emit('seat:status_change', { eventId: t.eventId, seatId: seat.id, key: seat.layoutKey, sectionKey: seat.sectionKey, section: seat.section, row: seat.row, seatNumber: seat.seatNumber, status, lockedUntil: null, lockedByUserId: null });
    }
  }
  return { ticketId: t.id, seat: { id: result.now.id, section: result.now.section, row: result.now.row, seatNumber: result.now.seatNumber } };
}
