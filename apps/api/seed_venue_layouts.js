import prisma from './src/config/prisma.js';
import { buildTemplate, suggestTemplate, validateLayout, layoutInventory } from '../venue-core/src/index.js';

export async function publishLayoutForEvent(eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { tiers: true, venueLayouts: true },
  });
  if (!event || !event.tiers || event.tiers.length === 0) {
    console.log(`Skipping event ${eventId}: no event or tiers`);
    return null;
  }

  const existingPub = event.venueLayouts.find((l) => l.status === 'PUBLISHED');
  if (existingPub) {
    console.log(`Event ${event.name} already has published layout ${existingPub.id}`);
    return existingPub;
  }

  const templateKey = suggestTemplate(event.type);
  console.log(`Building template "${templateKey}" for event "${event.name}" (${event.type})...`);
  const layoutData = buildTemplate(templateKey, { tiers: event.tiers });
  const check = validateLayout(layoutData, { tierIds: event.tiers.map((t) => t.id), requireTiers: true });
  if (check.errors.length) {
    console.error(`Validation errors for ${event.name}:`, check.errors);
    return null;
  }

  const inventory = layoutInventory(layoutData);
  console.log(`Layout generated ${inventory.length} seats. Syncing seats...`);

  // Check if any existing tickets exist for this event
  const existingTickets = await prisma.ticket.findMany({
    where: { eventId },
    include: { seat: true },
  });

  // Archive any existing layouts
  await prisma.venueLayout.updateMany({
    where: { eventId, status: 'PUBLISHED' },
    data: { status: 'ARCHIVED' },
  });

  // Create published layout
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

  // Remove unticketed legacy seats
  await prisma.seat.deleteMany({
    where: { eventId, ticket: { is: null } },
  });

  // Create new layout seats
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

  // Fetch newly created seats to remap any existing tickets
  if (existingTickets.length > 0) {
    const createdSeats = await prisma.seat.findMany({
      where: { eventId, layoutKey: { not: null }, kind: 'SEAT' },
      take: existingTickets.length * 2,
    });

    for (let i = 0; i < existingTickets.length; i++) {
      const ticket = existingTickets[i];
      const targetSeat = createdSeats[i];
      if (targetSeat) {
        // Delete old seat if it had no layoutKey
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
    console.log(`Remapped ${existingTickets.length} tickets to new layout seats.`);
  }

  // Update tier counts
  for (const tier of event.tiers) {
    const total = await prisma.seat.count({ where: { eventId, tierId: tier.id, status: { not: 'BLOCKED' } } });
    const taken = await prisma.seat.count({ where: { eventId, tierId: tier.id, ticket: { isNot: null } } });
    await prisma.ticketTier.update({
      where: { id: tier.id },
      data: { totalQuantity: total, availableQuantity: Math.max(0, total - taken) },
    });
  }

  console.log(`✓ Published layout for "${event.name}" with ${inventory.length} seats.`);
  return layout;
}

export async function publishAllLayouts() {
  const events = await prisma.event.findMany({
    select: { id: true, name: true },
  });
  console.log(`Checking venue layouts for ${events.length} events...`);
  for (const ev of events) {
    await publishLayoutForEvent(ev.id);
  }
}

if (process.argv[1]?.endsWith('seed_venue_layouts.js')) {
  publishAllLayouts()
    .then(() => {
      console.log('All event venue layouts published successfully!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed venue layouts:', err);
      process.exit(1);
    });
}
