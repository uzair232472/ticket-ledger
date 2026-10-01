/**
 * One-off migration: gives events that still use the older seat grid (Seat.layoutKey is null) a published
 * venue plan, so they book through the same section → seat → checkout flow as new events.
 *
 * The plan mirrors each legacy grid exactly — one section per legacy section, the same row labels, seat
 * numbers, tiers and blocked positions — and the existing Seat rows are linked to it in place
 * (layoutKey / sectionKey). No seat is deleted or recreated, so sold seats, issued tickets, checkouts and
 * holds are untouched. (publishDraft can't do this: it refuses to replace a grid that already has bookings.)
 *
 * Tier totals are then recounted from the seats, exactly as publishing a plan does.
 *
 * Usage (from apps/api):
 *   node scripts/migrate-legacy-venues.mjs            # dry run: prints what would change
 *   node scripts/migrate-legacy-venues.mjs --apply    # writes the plans
 */
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { LAYOUT_VERSION, generateSection, layoutInventory, validateLayout } from '../../venue-core/src/index.js';

dotenv.config();
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const SEAT_SPACING = 16;
const ROW_SPACING = 18;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
const STADIUM_TYPES = new Set(['CRICKET_MATCH', 'FOOTBALL_MATCH', 'HOCKEY_MATCH', 'KABADDI', 'BOXING']);

/** Row geometry for a legacy section: its labels, the widest row and blocked positions (0-based, from the left). */
function rowsFor(sectionSeats) {
  const byRow = new Map();
  for (const s of sectionSeats) (byRow.get(s.row) || byRow.set(s.row, []).get(s.row)).push(s);
  const labels = [...byRow.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const numbers = (row) => byRow.get(row).map((s) => Number(s.seatNumber)).sort((a, b) => a - b);
  const blocked = [];
  labels.forEach((row, i) => byRow.get(row).forEach((s) => s.status === 'BLOCKED' && blocked.push(`${i}:${Number(s.seatNumber) - 1}`)));
  const perRow = {};
  const widest = Math.max(...labels.map((r) => numbers(r).length));
  labels.forEach((r, i) => numbers(r).length !== widest && (perRow[i] = numbers(r).length));
  return {
    labels,
    widest,
    rows: { count: labels.length, seatsPerRow: widest, perRow, labelStyle: /^\d+$/.test(labels[0]) ? 'numbers' : 'letters', labelStart: labels[0], numbering: 'ltr', seatStart: 1, seatSpacing: SEAT_SPACING, rowSpacing: ROW_SPACING, aisles: [], blocked, inset: 6 },
  };
}

/** A legacy grid is mappable when every row is numbered 1..n and row labels are consecutive. */
function mappable(labels, sectionSeats) {
  const style = /^\d+$/.test(labels[0]) ? 'numbers' : 'letters';
  return labels.every((r, i) => {
    const expected = style === 'numbers' ? String(Number(labels[0]) + i) : String.fromCharCode(labels[0].charCodeAt(0) + i);
    if (r !== expected) return false;
    const nums = sectionSeats.filter((s) => s.row === r).map((s) => Number(s.seatNumber)).sort((a, b) => a - b);
    return nums.every((n, k) => n === k + 1);
  });
}

/**
 * Places the sections. Sports grounds: sections ring the field, priciest on the main side.
 * Everything else: rows of blocks facing a stage, priciest closest.
 */
function buildLayout(event, sections) {
  const ordered = [...sections].sort((a, b) => b.price - a.price);
  if (STADIUM_TYPES.has(event.type)) {
    const c = 420;
    const kind = { CRICKET_MATCH: 'cricket', FOOTBALL_MATCH: 'football', HOCKEY_MATCH: 'hockey', KABADDI: 'court', BOXING: 'ring' }[event.type];
    const span = 360 / ordered.length;
    return {
      coordinate: { width: 2 * c, height: 2 * c },
      feature: { kind, x: c, y: c, w: 300, h: 280, rotation: 0, label: kind === 'cricket' ? 'Ground' : kind === 'football' || kind === 'hockey' ? 'Pitch' : kind === 'ring' ? 'Ring' : 'Court' },
      sections: ordered.map((s, k) => {
        const depth = s.rows.count * ROW_SPACING + 24;
        const mid = 90 + k * span; // first (priciest) section at the bottom, nearest the viewer
        return { id: s.id, name: s.name, booking: 'seats', tierId: s.tierId, level: 1, shape: { type: 'arc', cx: c, cy: c, r0: 190, r1: 190 + depth, a0: mid - span / 2 + 2, a1: mid + span / 2 - 2 }, rows: s.rows };
      }),
    };
  }
  const width = 900;
  let y = 170;
  const out = [];
  for (const s of ordered) {
    const w = Math.max(220, s.widest * SEAT_SPACING + 60);
    const h = s.rows.count * ROW_SPACING + 30;
    out.push({ id: s.id, name: s.name, booking: 'seats', tierId: s.tierId, level: 1, shape: { type: 'rect', x: width / 2, y: y + h / 2, w, h, rotation: 0 }, rows: s.rows });
    y += h + 40;
  }
  return {
    coordinate: { width, height: y + 40 },
    feature: { kind: 'stage', x: width / 2, y: 80, w: 360, h: 80, rotation: 0, label: 'Stage' },
    sections: out,
  };
}

async function planFor(event) {
  const seats = await prisma.seat.findMany({ where: { eventId: event.id }, include: { tier: true } });
  if (!seats.length) return { skip: 'no seats' };
  if (seats.some((s) => s.layoutKey)) return { skip: 'already on a venue plan' };

  const bySection = new Map();
  for (const s of seats) (bySection.get(s.section) || bySection.set(s.section, []).get(s.section)).push(s);
  const sections = [];
  for (const [name, list] of bySection) {
    const tierIds = new Set(list.map((s) => s.tierId));
    if (tierIds.size !== 1) return { skip: `section "${name}" mixes price tiers` };
    const { labels, widest, rows } = rowsFor(list);
    if (!mappable(labels, list)) return { skip: `section "${name}" has gaps in its rows or seat numbers` };
    sections.push({ id: `sec_legacy_${slug(name)}`, name, tierId: list[0].tierId, price: Number(list[0].tier.price), widest, rows, seats: list });
  }

  const base = buildLayout(event, sections);
  const layout = { version: LAYOUT_VERSION, template: 'custom', background: null, ...base };
  const tiers = await prisma.ticketTier.findMany({ where: { eventId: event.id }, select: { id: true } });
  const check = validateLayout(layout, { tierIds: tiers.map((t) => t.id), requireTiers: true });
  if (check.errors.length) return { skip: `plan invalid: ${check.errors.map((e) => e.message || e).join('; ')}` };
  for (const sec of layout.sections) {
    const issues = generateSection(sec).issues.filter((i) => i.level === 'error');
    if (issues.length) return { skip: `section "${sec.name}": ${issues[0].message}` };
  }

  // Every legacy seat must land on exactly one plan position with the same identity and availability
  const inventory = new Map(layoutInventory(layout).map((p) => [`${p.sectionName}|${p.row}|${p.number}`, p]));
  if (inventory.size !== seats.length) return { skip: `plan has ${inventory.size} positions for ${seats.length} seats` };
  const links = [];
  for (const s of seats) {
    const p = inventory.get(`${s.section}|${s.row}|${s.seatNumber}`);
    if (!p || p.tierId !== s.tierId || p.blocked !== (s.status === 'BLOCKED')) return { skip: `seat ${s.section} ${s.row}-${s.seatNumber} has no matching plan position` };
    links.push({ id: s.id, layoutKey: p.key, sectionKey: p.sectionId });
  }
  return { layout, links, totals: check.totals };
}

async function main() {
  const events = await prisma.event.findMany({
    where: { venueLayouts: { none: { status: 'PUBLISHED' } }, seats: { some: { layoutKey: null } } },
    select: { id: true, name: true, type: true, company: { select: { userId: true } } },
  });
  if (!events.length) console.log('No legacy seat grids left to migrate.');

  for (const event of events) {
    const plan = await planFor(event);
    if (plan.skip) {
      console.log(`SKIP  ${event.name} (${event.id}): ${plan.skip}`);
      continue;
    }
    console.log(`${APPLY ? 'MIGRATE' : 'WOULD MIGRATE'}  ${event.name}: ${plan.layout.sections.length} sections, ${plan.links.length} seats linked`);
    if (!APPLY) continue;

    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${event.id} FOR UPDATE`;
        // Re-check inside the lock: nothing may have been linked in the meantime
        if (await tx.seat.count({ where: { eventId: event.id, layoutKey: { not: null } } })) throw new Error('seats changed during migration');
        for (const l of plan.links) await tx.seat.update({ where: { id: l.id }, data: { layoutKey: l.layoutKey, sectionKey: l.sectionKey, kind: 'SEAT' } });
        for (const tier of await tx.ticketTier.findMany({ where: { eventId: event.id } })) {
          const total = await tx.seat.count({ where: { eventId: event.id, tierId: tier.id, status: { not: 'BLOCKED' } } });
          const taken = await tx.seat.count({ where: { eventId: event.id, tierId: tier.id, ticket: { isNot: null } } });
          await tx.ticketTier.update({ where: { id: tier.id }, data: { totalQuantity: total, availableQuantity: Math.max(0, total - taken) } });
        }
        const layout = await tx.venueLayout.create({
          data: { eventId: event.id, status: 'PUBLISHED', version: 1, template: 'custom', data: plan.layout, createdById: event.company.userId, publishedAt: new Date() },
        });
        await tx.auditLog.create({
          data: { userId: event.company.userId, action: 'VENUE_LAYOUT_MIGRATED', targetType: 'Event', targetId: event.id, details: { layoutId: layout.id, linked: plan.links.length, totals: plan.totals } },
        });
      },
      { timeout: 60000 }
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
