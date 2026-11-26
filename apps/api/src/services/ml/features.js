/**
 * Model inputs built from the app's own tables, AS OF a moment `at`: only records created before `at`
 * count, so a prediction logged now can later be compared fairly with what happened next. These
 * definitions must match the training data (apps/ml-service/data/README.md); the training exporter
 * reuses them.
 *
 * Inputs are never invented: a missing input throws MissingInput and the shadow prediction is skipped
 * (and logged as skipped).
 */
import prisma from '../../config/prisma.js';
import { dataPolicy, organizerExclusion } from './dataPolicy.js';
import { latestInputChange } from './snapshotIntegrity.js';
import { linkFeatures } from './accountLinks.js';

// Single place to change when events get their own country / time zone (the platform is Pakistan-only today)
export const COUNTRY = 'PK';
export const TIMEZONE = 'Asia/Karachi';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export class MissingInput extends Error {
  constructor(message) {
    super(message);
    this.code = 'MISSING_INPUT';
  }
}

/** Local hour / weekday / month / calendar date of a moment, in the venue's time zone. */
export function localParts(date, timeZone = TIMEZONE) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', weekday: 'long' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { hour: Number(p.hour) % 24, weekday: p.weekday, month: Number(p.month), day: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` };
}

/** When tickets went (or go) on sale: sales-open time, else publication, else approval, else creation. */
export const salesOpenOf = (e) => e.salesOpenAt || e.publishAt || e.approvedAt || e.createdAt;

/** Event start as a moment: startsAt, else the date + "HH:MM" time read in the venue's time zone. */
export function startOf(e) {
  if (e.startsAt) return new Date(e.startsAt);
  const d = new Date(e.date);
  const [h, m] = String(e.time || '00:00').split(':').map(Number);
  const offsetMin = tzOffsetMinutes(d, TIMEZONE);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h || 0, m || 0) - offsetMin * 60_000);
}

function tzOffsetMinutes(date, timeZone) {
  const local = new Date(date.toLocaleString('en-US', { timeZone }));
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60_000);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/**
 * Average tier price, as in training: mean of the tier prices rounded to 10, kept within the cheapest and
 * dearest tier (rounding alone can push it above the maximum, e.g. every tier at 7777 -> 7780).
 */
export const avgTierPrice = (tiers) => {
  const prices = tiers.map((t) => Number(t.price));
  const rounded = Math.round(mean(prices) / 10) * 10;
  return Math.min(Math.max(...prices), Math.max(Math.min(...prices), rounded));
};

// The country's typical price: median average tier price of REAL events whose sales opened before `at`
// (test and internal organizers' events are left out: dataPolicy.js).
let refCache = { at: 0, events: null, lastChange: null };
export const clearReferencePriceCache = () => { refCache = { at: 0, events: null, lastChange: null }; };
async function eventsWithPrices() {
  // Rebuilt hourly, and at once when the change log has anything newer than what the cache was built from
  // (database times compared with database times, so clock differences cannot keep a stale cache)
  const latest = await latestInputChange(prisma);
  const newer = latest && (!refCache.lastChange || latest.getTime() > refCache.lastChange.getTime());
  if (!refCache.events || Date.now() - refCache.at > HOUR || newer) {
    const policy = dataPolicy();
    const rows = await prisma.event.findMany({
      where: { tiers: { some: {} } },
      select: {
        id: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true, tiers: { select: { price: true } },
        companyId: true, company: { select: { userId: true, user: { select: { email: true } } } },
      },
    });
    refCache = {
      at: Date.now(),
      lastChange: latest,
      events: rows.filter((e) => !organizerExclusion(e, e.company?.user, policy)).map((e) => ({ id: e.id, open: salesOpenOf(e), created: e.createdAt, avg: avgTierPrice(e.tiers), companyId: e.companyId, ownerId: e.company?.userId })),
    };
  }
  return refCache.events;
}

/**
 * The events the typical price at `at` is computed from: real events that EXISTED at `at` (created before it)
 * and whose sales had opened by then. An event created later with a backdated sales-open date never counts.
 * Their prices are read as they are now: the snapshot check (snapshotIntegrity.js) marks a snapshot not exact
 * if any of these events' prices or details changed after `at`, because the old values are not recorded.
 */
const referenceSet = (events, at) => events.filter((e) => e.open < at && e.created < at);

export async function referencePrice(at, ownAvgPrice) {
  const prior = referenceSet(await eventsWithPrices(), at).map((e) => e.avg);
  return prior.length ? median(prior) : ownAvgPrice; // very first event: its own price (relative price 1.0)
}

/** Ids of the events behind referencePrice(at). */
export async function referenceEventIds(at) {
  return new Set(referenceSet(await eventsWithPrices(), at).map((e) => e.id));
}

/** Everything the typical price at `at` depends on: its events, their organizers' companies and accounts. */
export async function referenceInputs(at) {
  const set = referenceSet(await eventsWithPrices(), at);
  return { eventIds: new Set(set.map((e) => e.id)), companyIds: [...new Set(set.map((e) => e.companyId))], ownerIds: [...new Set(set.map((e) => e.ownerId).filter(Boolean))] };
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------
// Fraud: one checkout attempt (same columns as fraud_purchases.csv)
// ---------------------------------------------------------------------------------------------
const TELEMETRY = {
  checkout_duration_seconds: 'checkoutDurationSeconds',
  clicks_per_minute: 'clicksPerMinute',
  rapid_seat_attempts: 'rapidSeatAttempts',
  time_on_seatmap_seconds: 'timeOnSeatmapSeconds',
  device_switches: 'deviceSwitches',
};

export async function fraudFeatures({ userId, eventId, seatIds, telemetry, paymentMethod, at }) {
  if (!telemetry) throw new MissingInput('no checkout telemetry');
  const missing = Object.values(TELEMETRY).filter((k) => typeof telemetry[k] !== 'number' || !Number.isFinite(telemetry[k]));
  if (missing.length) throw new MissingInput(`telemetry missing: ${missing.join(', ')}`);

  const [event, user, seats, priorOrders, last24h, failed30d, resale] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { type: true, city: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true, tiers: { select: { price: true } } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    prisma.seat.findMany({ where: { id: { in: seatIds } }, select: { tier: { select: { price: true } } } }),
    prisma.order.count({ where: { userId, createdAt: { lt: at } } }),
    prisma.order.count({ where: { userId, createdAt: { gte: new Date(at - DAY), lt: at } } }),
    prisma.order.count({ where: { userId, status: 'FAILED', createdAt: { gte: new Date(at - 30 * DAY), lt: at } } }),
    prisma.resaleListing.count({ where: { sellerId: userId, createdAt: { lt: at } } }),
  ]);
  if (!event || !event.tiers.length) throw new MissingInput('event or its price tiers not found');
  if (!user) throw new MissingInput('user not found');
  if (!seats.length) throw new MissingInput('seats not found');

  const unit = mean(seats.map((s) => Number(s.tier.price)));
  const ref = await referencePrice(at, avgTierPrice(event.tiers));
  const row = {
    event_type: event.type,
    city: event.city,
    country: COUNTRY,
    payment_method: paymentMethod,
    tickets_requested: seatIds.length,
    unit_price_rel: round(unit / ref),
    account_age_days: round(Math.max(0, at - user.createdAt) / DAY, 2),
    customer_prior_orders: priorOrders,
    orders_last_24h: last24h,
    failed_payments_30d: failed30d,
    prior_resale_listings: resale,
    hours_since_sales_open: round(Math.max(0, at - salesOpenOf(event)) / HOUR, 2),
  };
  for (const [col, key] of Object.entries(TELEMETRY)) row[col] = Number(telemetry[key]);
  // Account links (shared phone number or browser) as of the checkout: accountLinks.js
  Object.assign(row, await linkFeatures({ userId, eventId, at: new Date(at) }));
  return row;
}

// ---------------------------------------------------------------------------------------------
// Demand: one event at (or before) sales open (same columns as event_demand.csv)
// ---------------------------------------------------------------------------------------------
const capacityOf = (e) => e.capacityLimit || e.tiers.reduce((a, t) => a + t.totalQuantity, 0);
const SOLD = ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED']; // paid at some point = sold

export async function demandFeatures({ eventId, at }) {
  return (await demandSnapshot({ eventId, at })).features;
}

/**
 * Demand inputs + the raw values a training row needs, read NOW (the prediction moment): prices, capacity
 * and start are never reconstructed later from current values.
 */
export async function demandSnapshot({ eventId, at }) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, companyId: true, type: true, city: true, date: true, time: true, startsAt: true, capacityLimit: true,
      salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true, tiers: { select: { price: true, totalQuantity: true } },
    },
  });
  if (!event || !event.tiers.length) throw new MissingInput('event or its price tiers not found');
  const capacity = capacityOf(event);
  if (!(capacity > 0)) throw new MissingInput('event has no capacity');

  const start = startOf(event);
  const open = salesOpenOf(event);
  const prices = event.tiers.map((t) => Number(t.price));
  const avg = avgTierPrice(event.tiers);
  const refAt = open < at ? open : at;
  const ref = await referencePrice(refAt, avg);
  const ls = localParts(start);
  const lo = localParts(open);

  // Organizer history: their other events whose first 48 hours had ended before `at`
  const past = await prisma.event.findMany({
    where: { companyId: event.companyId, id: { not: event.id } },
    select: { id: true, capacityLimit: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true, tiers: { select: { totalQuantity: true } } },
  });
  const done = past.filter((p) => salesOpenOf(p).getTime() + 2 * DAY <= at.getTime() && capacityOf(p) > 0);
  let sellThrough = null;
  if (done.length) {
    const shares = await Promise.all(done.map(async (p) => {
      const o = salesOpenOf(p);
      const sold = await prisma.ticket.count({
        where: { eventId: p.id, createdAt: { gte: o, lt: new Date(o.getTime() + 2 * DAY) }, order: { status: { in: SOLD } } },
      });
      return sold / capacityOf(p);
    }));
    sellThrough = round(mean(shares), 4);
  }
  const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);

  const features = {
    event_type: event.type,
    city: event.city,
    country: COUNTRY,
    day_of_week: ls.weekday,
    venue_capacity: capacity,
    tier_count: event.tiers.length,
    min_price_rel: round(Math.min(...prices) / ref),
    avg_price_rel: round(avg / ref),
    max_price_rel: round(Math.max(...prices) / ref),
    start_hour: ls.hour,
    sales_open_hour: lo.hour,
    lead_days: Math.round((dayMs(ls.day) - dayMs(lo.day)) / DAY),
    start_month: ls.month,
    organizer_past_events: done.length,
    // Empty for an organizer's first event, exactly as in training (the model handles missing values)
    organizer_past_sell_through_48h: sellThrough,
  };
  return {
    features,
    context: {
      min_price: Math.min(...prices), avg_price: avg, max_price: Math.max(...prices), event_start: start.toISOString(),
      sales_open: open.toISOString(), organizer_id: event.companyId, timezone: TIMEZONE,
      reference_at: refAt.toISOString(), reference_price: ref,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Attendance: one ticket, 24 hours before its event starts (same columns as attendance_no_show.csv)
// ---------------------------------------------------------------------------------------------
export const ATTENDANCE_LEAD_MS = DAY;
export const LIVE_TICKET = ['ACTIVE', 'SCANNED'];
/** When an event is over: endsAt, else start + 4 hours (as in attendanceBaseline.js). */
export const endOf = (e) => (e.endsAt ? new Date(e.endsAt) : new Date(startOf(e).getTime() + 4 * HOUR));

/**
 * Pure core (shared by live scoring and the training exporter). Inputs, all as stored:
 *   ticket {id, price, tierId}, order {userId, createdAt, ticketCount}, event {type, city, tiers:[{id, price}], ...},
 *   transfers [{toUserId, transferType, createdAt}] of this ticket, holderPast [{eventEnd, checkedInAt}] = the
 *   holder's live tickets of OTHER events, refPrice = the country's typical price, at = prediction time.
 * Only facts dated before `at` are used: the holder is whoever held the ticket at `at`.
 */
export function attendanceRow({ ticket, order, event, transfers, holderPast, refPrice, at }) {
  if (!event?.tiers?.length) throw new MissingInput('event or its price tiers not found');
  const start = startOf(event);
  if (order.createdAt >= at) throw new MissingInput('ticket bought after the prediction time');
  const before = transfers.filter((t) => t.createdAt < at).sort((a, b) => a.createdAt - b.createdAt);
  const holder = before.length ? before.at(-1).toUserId : order.userId;
  const sorted = [...event.tiers].sort((a, b) => Number(a.price) - Number(b.price));
  const rank = sorted.findIndex((t) => t.id === ticket.tierId);
  if (rank < 0) throw new MissingInput('ticket tier not found');
  const past = holderPast.filter((p) => p.eventEnd < at);
  const attended = past.filter((p) => p.checkedInAt).length;
  const ls = localParts(start);
  return {
    holderId: holder,
    features: {
      event_type: event.type,
      city: event.city,
      country: COUNTRY,
      day_of_week: ls.weekday,
      start_hour: ls.hour,
      tier_rank: rank,
      ticket_price_rel: round(Number(ticket.price) / refPrice),
      tickets_in_order: order.ticketCount,
      days_before_event_purchased: round((start - order.createdAt) / DAY, 1),
      is_transferred: before.some((t) => t.transferType === 'DIRECT_TRANSFER') ? 1 : 0,
      is_resold: before.some((t) => t.transferType === 'P2P_RESALE') ? 1 : 0,
      customer_prior_tickets: past.length,
      customer_prior_attended: attended,
      customer_prior_no_shows: past.length - attended,
    },
  };
}

/** Live entry point: inputs for one ticket as of `at` (default: 24 h before its event). */
export async function attendanceFeatures({ ticketId, at = null }) {
  return (await attendanceSnapshot({ ticketId, at })).features;
}

/** Attendance inputs + raw values for a training row (price paid, start, holder), read at the prediction moment. */
export async function attendanceSnapshot({ ticketId, at = null }) {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, price: true, seat: { select: { tierId: true } },
      order: { select: { userId: true, createdAt: true, _count: { select: { tickets: true } } } },
      event: { select: { id: true, type: true, city: true, date: true, time: true, startsAt: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true, tiers: { select: { id: true, price: true } } } },
      transferHistory: { select: { toUserId: true, transferType: true, createdAt: true } },
    },
  });
  if (!t) throw new MissingInput('ticket not found');
  const when = at || new Date(startOf(t.event).getTime() - ATTENDANCE_LEAD_MS);
  const holderAt = [...t.transferHistory].filter((x) => x.createdAt < when).sort((a, b) => a.createdAt - b.createdAt).at(-1)?.toUserId ?? t.order.userId;
  const past = await prisma.ticket.findMany({
    where: { userId: holderAt, eventId: { not: t.event.id }, status: { in: LIVE_TICKET } },
    select: { checkedInAt: true, event: { select: { date: true, time: true, startsAt: true, endsAt: true } } },
  });
  const open = salesOpenOf(t.event);
  const refAt = open < when ? open : when;
  const refPrice = await referencePrice(refAt, avgTierPrice(t.event.tiers));
  const r = attendanceRow({
    ticket: { id: t.id, price: t.price, tierId: t.seat.tierId },
    order: { userId: t.order.userId, createdAt: t.order.createdAt, ticketCount: t.order._count.tickets },
    event: t.event, transfers: t.transferHistory,
    holderPast: past.map((p) => ({ eventEnd: endOf(p.event), checkedInAt: p.checkedInAt })), refPrice, at: when,
  });
  return { features: r.features, context: { ticket_price: Number(t.price), event_start: startOf(t.event).toISOString(), holder_id: r.holderId, reference_at: refAt.toISOString(), reference_price: refPrice } };
}

// ---------------------------------------------------------------------------------------------
// Checkout abandonment: one checkout at the moment it starts (order created, seats held)
// ---------------------------------------------------------------------------------------------
/**
 * Only facts known at `at`. A first-time customer has zero history: the counts are 0, `first_time` is 1 and
 * the model relies on the checkout itself (activity in this visit, price, timing, seats) - nothing is guessed.
 */
export async function checkoutSnapshot({ userId, eventId, seatIds, paymentMethod, at }) {
  const db = prisma;
  const [event, user, seats, priorOrders, priorPaid, expired, views, selections] = await Promise.all([
    db.event.findUnique({ where: { id: eventId }, select: { type: true, city: true, date: true, time: true, startsAt: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true, tiers: { select: { price: true } } } }),
    db.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    db.seat.findMany({ where: { id: { in: seatIds } }, select: { tier: { select: { price: true } } } }),
    db.order.count({ where: { userId, createdAt: { lt: at } } }),
    db.order.count({ where: { userId, createdAt: { lt: at }, status: { in: SOLD } } }),
    db.auditLog.count({ where: { userId, action: 'CHECKOUT_ENDED', createdAt: { lt: at }, details: { path: ['reason'], equals: 'HOLD_EXPIRED' } } }),
    db.behaviorEvent.count({ where: { userId, eventId, action: 'event_view', createdAt: { gte: new Date(at - 2 * HOUR), lt: at } } }),
    db.behaviorEvent.count({ where: { userId, eventId, action: { in: ['seat_selected', 'seat_locked'] }, createdAt: { gte: new Date(at - 2 * HOUR), lt: at } } }),
  ]);
  if (!event || !event.tiers.length) throw new MissingInput('event or its price tiers not found');
  if (!user) throw new MissingInput('user not found');
  if (!seats.length) throw new MissingInput('seats not found');
  const unit = mean(seats.map((s) => Number(s.tier.price)));
  const refAt = at;
  const ref = await referencePrice(refAt, avgTierPrice(event.tiers));
  const start = startOf(event);
  const features = {
    event_type: event.type, city: event.city, country: COUNTRY, payment_method: paymentMethod,
    tickets_requested: seatIds.length, unit_price_rel: round(unit / ref),
    hours_since_sales_open: round(Math.max(0, at - salesOpenOf(event)) / HOUR, 2),
    days_until_event: round((start - at) / DAY, 2),
    account_age_days: round(Math.max(0, at - user.createdAt) / DAY, 2),
    customer_prior_orders: priorOrders, customer_prior_purchases: priorPaid, customer_prior_expired_checkouts: expired,
    first_time: priorPaid === 0 ? 1 : 0,
    visit_event_views: views, visit_seat_selections: selections,
  };
  return { features, context: { unit_price: unit, event_start: start.toISOString(), reference_at: refAt.toISOString(), reference_price: ref } };
}

// ---------------------------------------------------------------------------------------------
// Demand after publication: one event at one hour while on sale (sales so far, pace, time left)
// ---------------------------------------------------------------------------------------------
export async function demandHourlySnapshot({ eventId, at }) {
  const { features: base, context } = await demandSnapshot({ eventId, at });
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true, time: true, startsAt: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true } });
  const open = salesOpenOf(event);
  if (at < open) throw new MissingInput('sales not open yet');
  const start = startOf(event);
  if (at >= start) throw new MissingInput('event already started');
  const soldWhere = (from) => ({ eventId, createdAt: { ...(from ? { gte: from } : {}), lt: at }, order: { status: { in: SOLD } } });
  const [soldSoFar, soldLast24h] = await Promise.all([
    prisma.ticket.count({ where: soldWhere(null) }),
    prisma.ticket.count({ where: soldWhere(new Date(at - DAY)) }),
  ]);
  const features = {
    ...base,
    hours_since_sales_open: round((at - open) / HOUR, 2),
    days_until_event: round((start - at) / DAY, 2),
    sold_so_far: soldSoFar,
    sold_last_24h: soldLast24h,
    sell_through_so_far: round(soldSoFar / base.venue_capacity, 4),
  };
  return { features, context: { ...context, as_of_hour: at.toISOString() } };
}
