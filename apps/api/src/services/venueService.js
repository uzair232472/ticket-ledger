import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { buildTemplate, layoutInventory, suggestTemplate, validateLayout } from '../../../venue-core/src/index.js';

/** Existing reservation length (10 minutes) and per-booking ticket limit, unchanged. */
export const HOLD_SECONDS = 600;
export const MAX_TICKETS_PER_BOOKING = 10;
/** A checkout whose holds lapsed keeps its seats this much longer, so an in-flight payment can finish. */
export const PAYMENT_GRACE_SECONDS = 120;

export class VenueError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// "Free" = available, or a lapsed hold that no checkout (ticket) still references
export const FREE_SQL = Prisma.sql`(s.status = 'AVAILABLE' OR (s.status = 'LOCKED' AND s."lockedUntil" < (now() AT TIME ZONE 'UTC') AND NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."seatId" = s.id)))`;

export function emitSeatChanges(eventId, seats) {
  const io = getIO();
  if (!io || !seats.length) return;
  io.emit('seat:status_batch', {
    eventId,
    seats: seats.map((s) => ({
      seatId: s.id,
      key: s.layoutKey ?? s.key ?? null,
      sectionKey: s.sectionKey ?? null,
      status: s.status,
      lockedUntil: s.lockedUntil ?? null,
      lockedByUserId: s.lockedByUserId ?? null,
    })),
  });
}

/**
 * Releases what has lapsed for an event:
 * 1. checkouts (PENDING orders) whose holds ended more than PAYMENT_GRACE_SECONDS ago are failed,
 *    their placeholder tickets removed and tier counts restored;
 * 2. lapsed holds that no checkout references go back to AVAILABLE.
 * The order transition is conditional (PENDING → FAILED), so it can never race a confirmation.
 */
export async function expireStaleHolds(eventId) {
  const graceCutoff = new Date(Date.now() - PAYMENT_GRACE_SECONDS * 1000);
  const stale = await prisma.order.findMany({
    where: {
      eventId,
      status: 'PENDING',
      tickets: { some: { seat: { OR: [{ lockedUntil: { lt: graceCutoff } }, { status: { not: 'LOCKED' } }] } } },
    },
    include: { tickets: { include: { seat: true } } },
  });
  const changed = [];
  for (const order of stale) {
    await prisma.$transaction(async (tx) => {
      const flipped = await tx.order.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      if (!flipped.count) return; // confirmed or cancelled meanwhile
      await tx.ticket.deleteMany({ where: { orderId: order.id } });
      const tierCounts = {};
      for (const t of order.tickets) tierCounts[t.seat.tierId] = (tierCounts[t.seat.tierId] || 0) + 1;
      for (const [tierId, count] of Object.entries(tierCounts)) {
        await tx.ticketTier.update({ where: { id: tierId }, data: { availableQuantity: { increment: count } } });
      }
      const seatIds = order.tickets.map((t) => t.seatId);
      await tx.seat.updateMany({
        where: { id: { in: seatIds }, status: 'LOCKED', lockedByUserId: order.userId },
        data: { status: 'AVAILABLE', lockedUntil: null, lockedByUserId: null },
      });
      changed.push(...order.tickets.map((t) => ({ ...t.seat, status: 'AVAILABLE', lockedUntil: null, lockedByUserId: null })));
    });
  }

  const freed = await prisma.$queryRaw`
    UPDATE "Seat" s SET status = 'AVAILABLE', "lockedUntil" = NULL, "lockedByUserId" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE s."eventId" = ${eventId} AND s.status = 'LOCKED' AND s."lockedUntil" < (now() AT TIME ZONE 'UTC')
      AND NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."seatId" = s.id)
    RETURNING s.id, s."layoutKey", s."sectionKey", s.status`;
  changed.push(...freed);
  emitSeatChanges(eventId, changed);
  return changed.length;
}

async function myOpenHoldCount(eventId, userId) {
  return prisma.seat.count({
    where: { eventId, status: 'LOCKED', lockedByUserId: userId, lockedUntil: { gt: new Date() }, ticket: { is: null } },
  });
}

async function assertRoom(eventId, userId, adding) {
  const current = await myOpenHoldCount(eventId, userId);
  if (current + adding > MAX_TICKETS_PER_BOOKING) {
    throw new VenueError(409, `You can hold at most ${MAX_TICKETS_PER_BOOKING} tickets at a time (you already hold ${current}).`);
  }
}

async function assertBookable(eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, status: true } });
  if (!event) throw new VenueError(404, 'Event not found');
  if (event.status !== 'PUBLISHED') throw new VenueError(400, 'This event is not currently accepting bookings.');
  const layout = await prisma.venueLayout.findFirst({ where: { eventId, status: 'PUBLISHED' }, select: { id: true } });
  if (!layout) throw new VenueError(400, 'This event has no published venue plan.');
}

const holdView = (s) => ({
  id: s.id,
  key: s.layoutKey,
  sectionId: s.sectionKey,
  section: s.section,
  row: s.row,
  seatNumber: s.seatNumber,
  kind: s.kind,
  tableKey: s.tableKey,
  wholeTable: s.wholeTable,
  lockedUntil: s.lockedUntil,
  tier: s.tier ? { id: s.tier.id, name: s.tier.name, price: s.tier.price } : undefined,
});

function explainUnavailable(seat, userId) {
  if (!seat) return new VenueError(404, 'This seat is not part of the published plan.');
  if (seat.status === 'SOLD') return new VenueError(409, 'This seat has just been sold.');
  if (seat.status === 'BLOCKED') return new VenueError(409, 'This seat is not on sale.');
  if (seat.status === 'LOCKED' && seat.lockedByUserId !== userId) return new VenueError(409, 'Someone else is holding this seat right now.');
  return new VenueError(409, 'This seat is in another checkout.');
}

/** Hold one assigned seat (or one chair at an individually-booked table) by its layout key. */
export async function holdSeat(eventId, key, userId) {
  await assertBookable(eventId);
  await expireStaleHolds(eventId);
  const seat = await prisma.seat.findUnique({ where: { eventId_layoutKey: { eventId, layoutKey: key } }, include: { tier: true } });
  if (!seat) throw explainUnavailable(null);
  if (seat.kind === 'GA_SLOT') throw new VenueError(400, 'General admission is booked by quantity.');
  if (seat.wholeTable) throw new VenueError(400, 'This table is booked as a whole table.');
  // Already mine: report the existing hold without restarting its timer
  if (seat.status === 'LOCKED' && seat.lockedByUserId === userId && seat.lockedUntil > new Date()) return [holdView(seat)];
  await assertRoom(eventId, userId, 1);

  const rows = await prisma.$queryRaw`
    UPDATE "Seat" s SET status = 'LOCKED', "lockedByUserId" = ${userId},
      "lockedUntil" = (now() AT TIME ZONE 'UTC') + (${HOLD_SECONDS} * interval '1 second'), "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE s.id = ${seat.id} AND ${FREE_SQL}
    RETURNING s.id`;
  if (!rows.length) throw explainUnavailable(await prisma.seat.findUnique({ where: { id: seat.id } }), userId);
  const held = await prisma.seat.findUnique({ where: { id: seat.id }, include: { tier: true } });
  emitSeatChanges(eventId, [held]);
  return [holdView(held)];
}

/** Hold every seat at a whole-booking table, all or nothing. */
export async function holdTable(eventId, tableKey, userId) {
  await assertBookable(eventId);
  await expireStaleHolds(eventId);
  const chairs = await prisma.seat.findMany({ where: { eventId, tableKey }, include: { tier: true } });
  if (!chairs.length) throw new VenueError(404, 'This table is not part of the published plan.');
  if (!chairs[0].wholeTable) throw new VenueError(400, 'Seats at this table are booked individually.');
  if (chairs.every((c) => c.status === 'LOCKED' && c.lockedByUserId === userId && c.lockedUntil > new Date())) return chairs.map(holdView);
  await assertRoom(eventId, userId, chairs.length);

  const held = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      UPDATE "Seat" s SET status = 'LOCKED', "lockedByUserId" = ${userId},
        "lockedUntil" = (now() AT TIME ZONE 'UTC') + (${HOLD_SECONDS} * interval '1 second'), "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE s."eventId" = ${eventId} AND s."tableKey" = ${tableKey} AND ${FREE_SQL}
      RETURNING s.id`;
    if (rows.length !== chairs.length) throw new VenueError(409, 'Part of this table was just taken. Please choose another table.');
    return tx.seat.findMany({ where: { eventId, tableKey }, include: { tier: true } });
  });
  emitSeatChanges(eventId, held);
  return held.map(holdView);
}

/**
 * Sets how many general-admission places this user holds in a section: holds more (any free places,
 * atomically, skipping rows another request is locking) or releases the surplus.
 */
export async function setGaQuantity(eventId, sectionKey, quantity, userId) {
  await assertBookable(eventId);
  await expireStaleHolds(eventId);
  const sample = await prisma.seat.findFirst({ where: { eventId, sectionKey, kind: 'GA_SLOT' }, select: { id: true } });
  if (!sample) throw new VenueError(404, 'This zone is not part of the published plan.');
  const mine = await prisma.seat.findMany({
    where: { eventId, sectionKey, kind: 'GA_SLOT', status: 'LOCKED', lockedByUserId: userId, lockedUntil: { gt: new Date() }, ticket: { is: null } },
    orderBy: { lockedUntil: 'desc' },
  });
  const diff = quantity - mine.length;
  if (diff > 0) {
    await assertRoom(eventId, userId, diff);
    const added = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        UPDATE "Seat" s SET status = 'LOCKED', "lockedByUserId" = ${userId},
          "lockedUntil" = (now() AT TIME ZONE 'UTC') + (${HOLD_SECONDS} * interval '1 second'), "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE s.id IN (
          SELECT s.id FROM "Seat" s
          WHERE s."eventId" = ${eventId} AND s."sectionKey" = ${sectionKey} AND s.kind = 'GA_SLOT' AND ${FREE_SQL}
          ORDER BY s.id LIMIT ${diff} FOR UPDATE SKIP LOCKED)
        RETURNING s.id, s."layoutKey", s."sectionKey", s.status, s."lockedUntil", s."lockedByUserId"`;
      if (rows.length < diff) {
        throw new VenueError(409, rows.length ? `Only ${rows.length + mine.length} place(s) are left in this zone right now.` : 'This zone has just sold out.');
      }
      return rows;
    });
    emitSeatChanges(eventId, added);
  } else if (diff < 0) {
    const release = mine.slice(0, -diff).map((s) => s.id);
    await prisma.seat.updateMany({
      where: { id: { in: release }, lockedByUserId: userId, status: 'LOCKED', ticket: { is: null } },
      data: { status: 'AVAILABLE', lockedUntil: null, lockedByUserId: null },
    });
    emitSeatChanges(eventId, mine.slice(0, -diff).map((s) => ({ ...s, status: 'AVAILABLE', lockedUntil: null, lockedByUserId: null })));
  }
  const now = await prisma.seat.findMany({
    where: { eventId, sectionKey, kind: 'GA_SLOT', status: 'LOCKED', lockedByUserId: userId, ticket: { is: null } },
    include: { tier: true },
  });
  return now.map(holdView);
}

/** Releases this user's holds by layout key (whole tables release together). Never touches checkouts. */
export async function releaseHolds(eventId, keys, userId) {
  const seats = await prisma.seat.findMany({ where: { eventId, layoutKey: { in: keys } } });
  const tableKeys = [...new Set(seats.filter((s) => s.wholeTable).map((s) => s.tableKey))];
  const where = {
    eventId,
    status: 'LOCKED',
    lockedByUserId: userId,
    ticket: { is: null },
    OR: [{ layoutKey: { in: keys } }, ...(tableKeys.length ? [{ tableKey: { in: tableKeys } }] : [])],
  };
  const releasing = await prisma.seat.findMany({ where });
  if (releasing.length) {
    await prisma.seat.updateMany({ where: { id: { in: releasing.map((s) => s.id) }, ...where }, data: { status: 'AVAILABLE', lockedUntil: null, lockedByUserId: null } });
    emitSeatChanges(eventId, releasing.map((s) => ({ ...s, status: 'AVAILABLE', lockedUntil: null, lockedByUserId: null })));
  }
  const inCheckout = await prisma.seat.count({ where: { eventId, layoutKey: { in: keys }, lockedByUserId: userId, ticket: { isNot: null } } });
  return { released: releasing.length, inCheckout };
}

/**
 * Automatically provisions and publishes a venue layout for an event based on its event type
 * and ticket tiers if no published layout exists.
 */
export async function autoProvisionVenueLayout(eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { tiers: true },
  });
  if (!event || !event.tiers || event.tiers.length === 0) return null;

  const templateKey = suggestTemplate(event.type);
  const layoutData = buildTemplate(templateKey, { tiers: event.tiers });
  const check = validateLayout(layoutData, { tierIds: event.tiers.map((t) => t.id), requireTiers: true });
  if (check.errors.length) return null;

  const inventory = layoutInventory(layoutData);

  const existingTickets = await prisma.ticket.findMany({
    where: { eventId },
    include: { seat: true },
  });

  await prisma.venueLayout.updateMany({
    where: { eventId, status: 'PUBLISHED' },
    data: { status: 'ARCHIVED' },
  });

  const layout = await prisma.venueLayout.create({
    data: {
      eventId,
      status: 'PUBLISHED',
      version: 1,
      template: templateKey,
      data: layoutData,
      publishedAt: new Date(),
    },
  });

  await prisma.seat.deleteMany({
    where: { eventId, ticket: { is: null } },
  });

  const rows = inventory.map((w) => ({
    eventId,
    tierId: w.tierId,
    section: w.sectionName,
    row: w.row,
    seatNumber: w.number,
    status: w.blocked ? 'BLOCKED' : 'AVAILABLE',
    layoutKey: w.key,
    sectionKey: w.sectionId,
    kind: w.kind,
    tableKey: w.tableKey,
    wholeTable: w.wholeTable,
  }));

  for (let i = 0; i < rows.length; i += 5000) {
    await prisma.seat.createMany({ data: rows.slice(i, i + 5000) });
  }

  if (existingTickets.length > 0) {
    const createdSeats = await prisma.seat.findMany({
      where: { eventId, layoutKey: { not: null }, kind: 'SEAT' },
      take: existingTickets.length * 2,
    });
    for (let i = 0; i < existingTickets.length; i++) {
      const ticket = existingTickets[i];
      const targetSeat = createdSeats[i];
      if (targetSeat) {
        const oldSeatId = ticket.seatId;
        await prisma.seat.update({
          where: { id: targetSeat.id },
          data: { status: 'SOLD' },
        });
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { seatId: targetSeat.id },
        });
        if (oldSeatId && oldSeatId !== targetSeat.id) {
          await prisma.seat.delete({ where: { id: oldSeatId } }).catch(() => {});
        }
      }
    }
  }

  for (const tier of event.tiers) {
    const total = await prisma.seat.count({ where: { eventId, tierId: tier.id, status: { not: 'BLOCKED' } } });
    const taken = await prisma.seat.count({ where: { eventId, tierId: tier.id, ticket: { isNot: null } } });
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { totalQuantity: total, availableQuantity: Math.max(0, total - taken) },
    });
  }

  return layout;
}

/** Published plan plus live availability. Only non-free seats are listed (by key) to keep it small. */
export async function getAvailability(eventId, userId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, venue: true, city: true, date: true, time: true, status: true, type: true, bannerUrl: true, cardImageUrl: true, tiers: { select: { id: true, name: true, price: true } } },
  });
  if (!event) throw new VenueError(404, 'Event not found');
  const layout = await prisma.venueLayout.findFirst({ where: { eventId, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
  if (!layout) return { event, layout: null };
  await expireStaleHolds(eventId);

  const seats = await prisma.seat.findMany({
    where: { eventId, layoutKey: { not: null } },
    select: { id: true, layoutKey: true, sectionKey: true, kind: true, status: true, lockedByUserId: true, lockedUntil: true },
  });
  const sections = {};
  const unavailable = {};
  const now = new Date();
  for (const s of seats) {
    const sec = (sections[s.sectionKey] ||= { total: 0, available: 0, held: 0, sold: 0, blocked: 0 });
    sec.total++;
    if (s.status === 'AVAILABLE') sec.available++;
    else if (s.status === 'SOLD') sec.sold++;
    else if (s.status === 'BLOCKED') sec.blocked++;
    else sec.held++;
    if (s.kind === 'GA_SLOT' || s.status === 'AVAILABLE') continue;
    if (s.status === 'LOCKED' && s.lockedByUserId === userId && userId) continue; // listed under `mine`
    unavailable[s.layoutKey] = s.status === 'SOLD' ? 'S' : s.status === 'BLOCKED' ? 'B' : 'H';
  }
  const mine = userId
    ? await prisma.seat.findMany({
        where: { eventId, layoutKey: { not: null }, status: 'LOCKED', lockedByUserId: userId, OR: [{ lockedUntil: { gt: now } }, { ticket: { isNot: null } }] },
        include: { tier: true, ticket: { select: { orderId: true } } },
      })
    : [];
  return {
    event,
    layout: { id: layout.id, version: layout.version, publishedAt: layout.publishedAt, data: layout.data },
    sections,
    unavailable,
    mine: mine.map((s) => ({ ...holdView(s), inCheckout: Boolean(s.ticket), orderId: s.ticket?.orderId || null })),
    holdSeconds: HOLD_SECONDS,
    serverTime: now,
  };
}

/**
 * The caller's live seat holds across every event, grouped per event with the earliest expiry
 * and seat details (drives the cart, checkout link, and site-wide "My tickets" countdown).
 */
export async function activeHoldsForUser(userId) {
  const now = new Date();
  const seats = await prisma.seat.findMany({
    where: { status: 'LOCKED', lockedByUserId: userId, lockedUntil: { gt: now } },
    select: {
      id: true,
      layoutKey: true,
      section: true,
      row: true,
      seatNumber: true,
      eventId: true,
      lockedUntil: true,
      event: { select: { id: true, name: true, city: true, venue: true, bannerUrl: true, date: true, time: true } },
      tier: { select: { id: true, name: true, price: true } },
    },
    orderBy: { lockedUntil: 'asc' },
  });
  const byEvent = new Map();
  for (const s of seats) {
    const h = byEvent.get(s.eventId) || {
      eventId: s.eventId,
      eventName: s.event?.name || 'Your event',
      venue: s.event?.venue,
      city: s.event?.city,
      bannerUrl: s.event?.bannerUrl,
      date: s.event?.date,
      time: s.event?.time,
      count: 0,
      totalPrice: 0,
      seats: [],
      keys: [],
      expiresAt: s.lockedUntil,
    };
    h.count++;
    h.totalPrice += Number(s.tier?.price || 0);
    h.seats.push({
      id: s.id,
      key: s.layoutKey,
      section: s.section,
      row: s.row,
      seatNumber: s.seatNumber,
      tierName: s.tier?.name,
      price: s.tier?.price,
    });
    if (s.layoutKey) h.keys.push(s.layoutKey);
    if (s.lockedUntil < h.expiresAt) h.expiresAt = s.lockedUntil;
    byEvent.set(s.eventId, h);
  }
  return { holds: [...byEvent.values()].sort((a, b) => a.expiresAt - b.expiresAt), serverTime: now };
}

/**
 * Publishes the event's draft. Inside one transaction the event row and all its seats are locked
 * (holds and checkouts wait), the draft is validated, and Seat rows are synced: new positions are
 * created, free positions that changed or disappeared are replaced, and anything held, in a checkout
 * or sold must keep its section, row, number, tier and table — otherwise publishing is refused.
 */
export async function publishDraft(eventId, userId) {
  const draft = await prisma.venueLayout.findFirst({ where: { eventId, status: 'DRAFT' }, orderBy: { updatedAt: 'desc' } });
  if (!draft) throw new VenueError(400, 'There are no unpublished changes to publish.');
  const tiers = await prisma.ticketTier.findMany({ where: { eventId } });
  const check = validateLayout(draft.data, { tierIds: tiers.map((t) => t.id), requireTiers: true });
  if (check.errors.length) throw new VenueError(400, 'The plan has problems to fix before publishing.', { errors: check.errors });
  const desired = new Map(layoutInventory(draft.data).map((s) => [s.key, s]));

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
      const existing = await tx.$queryRaw`
        SELECT s.id, s."layoutKey", s."sectionKey", s.section, s.row, s."seatNumber", s."tierId", s.kind::text AS kind, s."tableKey",
               s."wholeTable", s.status::text AS status, s."lockedUntil",
               EXISTS (SELECT 1 FROM "Ticket" t WHERE t."seatId" = s.id) AS ticketed
        FROM "Seat" s WHERE s."eventId" = ${eventId} FOR UPDATE`;
      const now = Date.now();
      const isProtected = (s) => s.ticketed || s.status === 'SOLD' || (s.status === 'LOCKED' && s.lockedUntil && new Date(s.lockedUntil).getTime() > now);
      const conflicts = [];
      const legacy = existing.filter((s) => !s.layoutKey);
      const legacyProtected = legacy.filter(isProtected);
      if (legacyProtected.length) {
        throw new VenueError(409, `This event already has ${legacyProtected.length} booked or held seat(s) from its earlier seat grid, so a venue plan can't replace it.`);
      }
      const toDelete = legacy.map((s) => s.id);
      const toCreate = [];
      const updates = [];
      const seen = new Set();
      const label = (s) => `${s.section} · Row ${s.row} · ${s.seatNumber}`;

      for (const s of existing.filter((e) => e.layoutKey)) {
        const want = desired.get(s.layoutKey);
        const prot = isProtected(s);
        if (!want) {
          if (prot) conflicts.push(`${label(s)} is ${s.status === 'SOLD' || s.ticketed ? 'booked' : 'held'} but was removed from the plan.`);
          else toDelete.push(s.id);
          continue;
        }
        seen.add(s.layoutKey);
        const identityChanged = s.section !== want.sectionName || s.row !== want.row || s.seatNumber !== want.number || s.kind !== want.kind || s.tableKey !== want.tableKey || s.wholeTable !== want.wholeTable;
        const tierChanged = s.tierId !== want.tierId;
        if (prot && (identityChanged || tierChanged || want.blocked)) {
          conflicts.push(`${label(s)} is ${s.status === 'SOLD' || s.ticketed ? 'booked' : 'held'}; its section, row, number, price tier and availability can't change.`);
          continue;
        }
        if (identityChanged) {
          toDelete.push(s.id);
          toCreate.push(want);
          continue;
        }
        const status = want.blocked ? 'BLOCKED' : s.status === 'BLOCKED' ? 'AVAILABLE' : null;
        if (tierChanged || status || s.sectionKey !== want.sectionId) updates.push({ id: s.id, tierId: want.tierId, sectionKey: want.sectionId, ...(status ? { status, lockedUntil: null, lockedByUserId: null } : {}) });
      }
      if (conflicts.length) throw new VenueError(409, 'Publishing would change seats that are already held or booked.', { conflicts: conflicts.slice(0, 50), conflictCount: conflicts.length });
      for (const [key, want] of desired) if (!seen.has(key)) toCreate.push(want);

      for (let i = 0; i < toDelete.length; i += 5000) await tx.seat.deleteMany({ where: { id: { in: toDelete.slice(i, i + 5000) } } });
      for (const u of updates) {
        const { id, ...data } = u;
        await tx.seat.update({ where: { id }, data });
      }
      const rows = toCreate.map((w) => ({
        eventId,
        tierId: w.tierId,
        section: w.sectionName,
        row: w.row,
        seatNumber: w.number,
        status: w.blocked ? 'BLOCKED' : 'AVAILABLE',
        layoutKey: w.key,
        sectionKey: w.sectionId,
        kind: w.kind,
        tableKey: w.tableKey,
        wholeTable: w.wholeTable,
      }));
      for (let i = 0; i < rows.length; i += 5000) await tx.seat.createMany({ data: rows.slice(i, i + 5000) });

      // Tier inventory now comes from the plan: sellable seats, minus those in checkouts or sold
      for (const tier of tiers) {
        const total = await tx.seat.count({ where: { eventId, tierId: tier.id, status: { not: 'BLOCKED' } } });
        const taken = await tx.seat.count({ where: { eventId, tierId: tier.id, ticket: { isNot: null } } });
        await tx.ticketTier.update({ where: { id: tier.id }, data: { totalQuantity: total, availableQuantity: Math.max(0, total - taken) } });
      }

      const last = await tx.venueLayout.findFirst({ where: { eventId, status: { in: ['PUBLISHED', 'ARCHIVED'] } }, orderBy: { version: 'desc' } });
      await tx.venueLayout.updateMany({ where: { eventId, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
      const published = await tx.venueLayout.update({
        where: { id: draft.id },
        data: { status: 'PUBLISHED', version: (last?.version || 0) + 1, publishedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'VENUE_LAYOUT_PUBLISHED',
          targetType: 'Event',
          targetId: eventId,
          details: { layoutId: published.id, version: published.version, created: rows.length, removed: toDelete.length, updated: updates.length, totals: check.totals },
        },
      });
      return { layout: published, created: rows.length, removed: toDelete.length, updated: updates.length };
    },
    { timeout: 60000, maxWait: 10000 }
  );

  getIO()?.emit('venue:published', { eventId, version: result.layout.version });
  return { ...result, totals: check.totals, warnings: check.warnings };
}

/** Keys the editor must not break: held, in a checkout or sold. */
export async function protectedKeys(eventId) {
  const seats = await prisma.seat.findMany({
    where: {
      eventId,
      layoutKey: { not: null },
      OR: [{ status: 'SOLD' }, { ticket: { isNot: null } }, { status: 'LOCKED', lockedUntil: { gt: new Date() } }],
    },
    select: { layoutKey: true, status: true, ticket: { select: { id: true } } },
  });
  return seats.map((s) => ({ key: s.layoutKey, state: s.status === 'SOLD' || s.ticket ? 'booked' : 'held' }));
}
