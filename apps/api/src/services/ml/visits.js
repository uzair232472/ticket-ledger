/**
 * Visits: the unit the purchase-intent and abandoned-checkout models were trained on
 * (apps/ml-service/data/README.md, behavior_sequences.csv: "one row per visitor session for one event").
 *
 * The app's x-session-id is per device and lasts for months, so it cannot be used as a visit. A visit here:
 *   - one signed-in customer's activity on one event (event_view, seat_selected / seat_locked,
 *     checkout_started), split wherever 30 minutes pass without activity;
 *   - duplicate rows of the same action within 10 seconds count once (the app records views and
 *     checkout starts from both the browser and the server);
 *   - scored only after it has ended (30 minutes of quiet), with inputs as of its last action.
 * Guest visits are not scored: purchases need an account, so their outcome could never be verified.
 */
import prisma from '../../config/prisma.js';
import { COUNTRY, MissingInput, avgTierPrice, referencePrice, salesOpenOf, startOf } from './features.js';

export const VISIT_GAP_MS = 30 * 60_000;
export const DEDUPE_MS = 10_000;
export const VISIT_ACTIONS = ['event_view', 'seat_selected', 'seat_locked', 'checkout_started'];
export const SOLD = ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Splits one customer's rows (any events) into visits per event. rows: {eventId, action, createdAt, metadata}. */
export function sessionize(rows) {
  const byEvent = new Map();
  for (const r of [...rows].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, []);
    byEvent.get(r.eventId).push(r);
  }
  const visits = [];
  for (const [eventId, list] of byEvent) {
    let cur = null;
    for (const r of list) {
      if (!cur || r.createdAt - cur.end > VISIT_GAP_MS) {
        cur = { eventId, start: r.createdAt, end: r.createdAt, rows: [] };
        visits.push(cur);
      }
      cur.rows.push(r);
      cur.end = r.createdAt;
    }
  }
  return visits.sort((a, b) => a.start - b.start);
}

/** Counts actions, merging repeats of the same kind within DEDUPE_MS (seat_selected + seat_locked are one kind). */
function countDistinct(rows, kinds) {
  let n = 0;
  let last = -Infinity;
  for (const r of rows) {
    if (!kinds.includes(r.action)) continue;
    if (r.createdAt - last > DEDUPE_MS) n += 1;
    last = r.createdAt;
  }
  return n;
}

export const visitId = (userId, v) => `${userId}|${v.eventId}|${v.start.toISOString()}`;
export function parseVisitId(id) {
  const [userId, eventId, start] = id.split('|');
  return { userId, eventId, start: new Date(start) };
}

/** Rule score the app uses today (intentAnalyticsService), applied to one visit. */
export function intentRule(f) {
  const s = 40 + (f.event_views >= 3 ? 15 : 0) + (f.seat_selections >= 1 ? 20 : 0) + (f.checkout_started ? 25 : 0);
  const score = Math.min(99, Math.max(10, s));
  return { score, decision: score >= 75 ? 'HIGH' : score >= 55 ? 'MODERATE' : 'LOW' };
}

/** Price the customer looked at: the last held seat's price if recorded, else the cheapest tier. */
export function visitPrice(visit, event) {
  const minPrice = Math.min(...event.tiers.map((t) => Number(t.price)));
  const held = [...visit.rows].reverse().find((r) => ['seat_selected', 'seat_locked'].includes(r.action) && Number(r.metadata?.price) > 0);
  return { price: held ? Number(held.metadata.price) : minPrice, minPrice };
}

/**
 * Inputs for one visit, as of its last action. `history` = all visits of this customer (sessionized),
 * `orders` = the customer's orders, `user` = {createdAt}, `event` with tiers.
 */
export async function visitFeatures({ visit, history, orders, user, event }) {
  if (!event?.tiers?.length) throw new MissingInput('event or its price tiers not found');
  const start = startOf(event);
  if (visit.start >= start) throw new MissingInput('visit after the event started');
  const at = visit.end;
  const { price } = visitPrice(visit, event);
  const ref = await referencePrice(at, avgTierPrice(event.tiers));
  const before = history.filter((h) => h.start < visit.start);
  return {
    event_type: event.type,
    city: event.city,
    country: COUNTRY,
    event_views: Math.max(1, countDistinct(visit.rows, ['event_view'])),
    seat_selections: countDistinct(visit.rows, ['seat_selected', 'seat_locked']),
    checkout_started: visit.rows.some((r) => r.action === 'checkout_started') ? 1 : 0,
    session_duration_seconds: Math.max(5, Math.round((visit.end - visit.start) / 1000)),
    ticket_price_rel: round(price / ref),
    tier_count: event.tiers.length,
    hours_since_sales_open: round(Math.max(0, visit.start - salesOpenOf(event)) / HOUR, 1),
    days_until_event: round((start - visit.start) / DAY, 2),
    customer_prior_sessions: before.length,
    customer_prior_purchases: orders.filter((o) => SOLD.includes(o.status) && o.createdAt < visit.start).length,
    prior_sessions_this_event: before.filter((h) => h.eventId === visit.eventId).length,
    account_age_days: round(Math.max(0, at - user.createdAt) / DAY, 1),
  };
}

/**
 * Scores every finished visit (ended >= 30 min ago) that started in the last `lookbackHours`.
 * Intent for every visit; abandonment for visits that reached checkout. Returns counts.
 */
export async function finishedVisits({ now = new Date(), lookbackHours = 48 } = {}) {
  const from = new Date(now - lookbackHours * HOUR);
  const recent = await prisma.behaviorEvent.findMany({
    where: { createdAt: { gte: new Date(from - 6 * HOUR), lt: now }, action: { in: VISIT_ACTIONS }, eventId: { not: null }, userId: { not: null } },
    select: { userId: true },
    distinct: ['userId'],
  });
  const out = [];
  for (const { userId } of recent) {
    const [rows, orders, user] = await Promise.all([
      prisma.behaviorEvent.findMany({
        where: { userId, action: { in: VISIT_ACTIONS }, eventId: { not: null }, createdAt: { lt: now } },
        select: { eventId: true, action: true, createdAt: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.order.findMany({ where: { userId, createdAt: { lt: now } }, select: { id: true, eventId: true, status: true, createdAt: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    ]);
    if (!user) continue;
    const history = sessionize(rows);
    for (const v of history) {
      if (v.start < from || now - v.end < VISIT_GAP_MS) continue; // outside the window, or possibly still going on
      out.push({ userId, visit: v, history, orders, user });
    }
  }
  return out;
}
