/**
 * Training-data exporter: the datasets of apps/ml-service/data/README.md (and the Step 5 datasets), built from
 * the app's own tables, for retraining on the client's real data.
 *
 * Rules (each one is counted in the export report):
 *   - Inputs ONLY from EXACT prediction-time snapshots: the features a live prediction logged (MlPrediction,
 *     role RULES) and, in output.context, the raw values read at that moment (prices, capacity, start),
 *     marked exact only when no input of that event changed between the prediction moment and the write
 *     (snapshotIntegrity.js).
 *     Nothing is rebuilt from current values: a row without a usable snapshot is left out, with the reason.
 *     The snapshots come from the same builders the live predictions use (features.js, visits.js, crowd.js).
 *   - Labels only from verified real outcomes: paid orders with server-side LIVE payment evidence
 *     (paymentEvidence.js), admitted gate check-ins, and blind fraud reviews. Anything else is left out.
 *   - Test, seed and internal records are left out (dataPolicy.js), and so is everything before genuine use
 *     began (ML_GENUINE_FROM, else the first live-verified payment): "did not buy" cannot be verified before.
 *   - No future data: only records created before `now`; a row exists only once its label window has closed.
 *   - One row per id (duplicates counted and dropped); ids are pseudonymised.
 *
 * Scale (docs/ml-step5-data-readiness.md section 10):
 *   - Consistent: by default the whole export reads ONE database snapshot (a read-only REPEATABLE READ
 *     transaction), so rows written while it runs are never half-seen. Run it against a restored backup or a
 *     read replica in production (a long snapshot on the primary holds back vacuum).
 *   - Paged: snapshots and other growing tables are read in keyset pages (ML_EXPORT_PAGE_SIZE, default 2000)
 *     in a fully defined order (ending with the unique id); `IN` lists are split into chunks of 5,000.
 *   - Grouped: sales in label windows, customer aggregates and attendance quality are computed by grouped
 *     SQL per batch, not by one query per row.
 *   - Streamed: rows go to a sink as they are produced (the CLI streams CSV files and hashes them while
 *     writing); only ids needed for lookups are kept in memory.
 *   - Deterministic: the output order is the processing order, which every query defines (ORDER BY ... id);
 *     identical data gives identical files and hashes, whatever order the database would return rows in.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma.js';
import { COUNTRY, TIMEZONE, endOf, salesOpenOf, startOf } from './features.js';
import { SOLD, parseVisitId } from './visits.js';
import { SLOTS, crowdReadiness, entriesBySlot, parseSlotSubject } from './crowd.js';
import { effectiveReview } from './fraudReview.js';
import { accountExclusion, dataPolicy, eventExclusion } from './dataPolicy.js';
import { liveEvidence } from '../paymentEvidence.js';
import { INTEGRITY_VERSION } from './snapshotIntegrity.js';
import { ABANDON_OUTCOME_WINDOW_MS, DEMAND_HOURLY_HORIZON_MS, LATE_CHECKIN_MS, REC_ATTRIBUTION_MS, REC_CLICK_WINDOW_MS, checkoutAbandonmentLabel } from './labels.js';

export { accountExclusion, eventExclusion };
const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const CURRENCY = 'PKR';
/** A snapshot read later than this after its prediction moment is not a prediction-time snapshot. */
export const MAX_CAPTURE_LAG_MS = 2 * HOUR;
const RULE_FLAGS = ['SUSPICIOUS', 'CRITICAL_BOT'];
const CHUNK = 5000; // ids per IN list (PostgreSQL allows at most 32,767 bind parameters per query)
const pageSize = () => Math.max(1, Number(process.env.ML_EXPORT_PAGE_SIZE || 2000));
const EVENT_BATCH = 200;
const USER_BATCH = 1000;

export const COLUMNS = {
  behavior_sequences: ['session_id', 'customer_id', 'event_id', 'ts', 'event_type', 'city', 'country', 'event_views', 'seat_selections',
    'checkout_started', 'session_duration_seconds', 'currency', 'ticket_price', 'ticket_price_rel', 'min_price', 'tier_count',
    'hours_since_sales_open', 'days_until_event', 'customer_prior_sessions', 'customer_prior_purchases', 'prior_sessions_this_event',
    'account_age_days', 'purchased_7d', 'checkout_abandoned', 'feature_source'],
  fraud_purchases: ['order_id', 'customer_id', 'event_id', 'ts', 'event_type', 'city', 'country', 'tickets_requested', 'currency',
    'total_amount', 'unit_price_rel', 'payment_method', 'checkout_duration_seconds', 'clicks_per_minute', 'rapid_seat_attempts',
    'time_on_seatmap_seconds', 'device_switches', 'account_age_days', 'customer_prior_orders', 'orders_last_24h', 'failed_payments_30d',
    'prior_resale_listings', 'hours_since_sales_open', 'linked_accounts', 'linked_accounts_confirmed_fraud', 'linked_orders_same_event_24h',
    'is_fraud', 'sample_weight', 'rule_flag', 'rule_score', 'feature_source'],
  event_demand: ['event_id', 'organizer_id', 'ts', 'event_start', 'event_type', 'city', 'country', 'timezone', 'venue_capacity',
    'tier_count', 'currency', 'min_price', 'avg_price', 'max_price', 'min_price_rel', 'avg_price_rel', 'max_price_rel', 'day_of_week',
    'start_hour', 'sales_open_hour', 'lead_days', 'start_month', 'organizer_past_events', 'organizer_past_sell_through_48h', 'sales_48h',
    'feature_source'],
  attendance_no_show: ['ticket_id', 'customer_id', 'event_id', 'ts', 'event_start', 'event_type', 'city', 'country', 'day_of_week',
    'start_hour', 'tier_rank', 'currency', 'ticket_price', 'ticket_price_rel', 'tickets_in_order', 'days_before_event_purchased',
    'is_transferred', 'is_resold', 'customer_prior_tickets', 'customer_prior_attended', 'customer_prior_no_shows', 'event_tickets_sold',
    'sample_weight', 'checked_in', 'feature_source'],
  crowd_flow: ['event_id', 'gate_id', 'ts', 'minutes_from_start', 'event_type', 'city', 'country', 'day_of_week', 'start_hour',
    'tickets_sold', 'gate_count', 'gate_capacity_per_hour', 'scans', 'feature_source'],
};

// Step 5 datasets: checkout abandonment (agreed definition), post-publication hourly demand, recommendation
// impressions (with control group), customer behaviour
export const COLUMNS_STEP5 = {
  checkout_abandonment: ['order_id', 'customer_id', 'event_id', 'ts', 'event_type', 'city', 'country', 'payment_method',
    'tickets_requested', 'unit_price_rel', 'hours_since_sales_open', 'days_until_event', 'account_age_days', 'customer_prior_orders',
    'customer_prior_purchases', 'customer_prior_expired_checkouts', 'first_time', 'visit_event_views', 'visit_seat_selections',
    'abandoned', 'feature_source'],
  demand_hourly: ['event_id', 'organizer_id', 'ts', 'event_type', 'city', 'country', 'day_of_week', 'venue_capacity', 'tier_count',
    'min_price_rel', 'avg_price_rel', 'max_price_rel', 'start_hour', 'start_month', 'organizer_past_events',
    'organizer_past_sell_through_48h', 'hours_since_sales_open', 'days_until_event', 'sold_so_far', 'sold_last_24h',
    'sell_through_so_far', 'rule_next_24h', 'sales_next_24h', 'feature_source'],
  recommendation_impressions: ['list_id', 'customer_id', 'event_id', 'ts', 'variant', 'basis', 'surface', 'position',
    'popularity_rank', 'exploration', 'is_new_event', 'first_time', 'clicked', 'purchased_7d', 'feature_source'],
  customer_behaviour: ['customer_id', 'first_seen', 'last_seen', 'visits', 'events_viewed', 'searches', 'wishlists',
    'verified_orders', 'verified_tickets', 'verified_spend', 'categories_bought', 'top_category', 'repeat_customer',
    'days_first_to_last_purchase', 'recommendation_clicks', 'feature_source'],
};
const STEP5 = new Set(Object.keys(COLUMNS_STEP5));

/** Export policy = the shared data policy (dataPolicy.js). Payments need server evidence, not a setting. */
export const exportPolicy = (opts = {}, env = process.env) => dataPolicy(opts, env);

export const pseudo = (kind, id) => `${kind}${createHash('sha256').update(`ml-export:${kind}:${id}`).digest('hex').slice(0, 16)}`;
const iso = (d) => new Date(d).toISOString();
/** A JS date as a SQL timestamp comparable with the (UTC, without time zone) columns. */
const sqlTs = (d) => Prisma.sql`${new Date(d).toISOString()}::timestamptz AT TIME ZONE 'UTC'`;
const ISO_SQL = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

// ---------------------------------------------------------------------------------------------
// Data access helpers: keyset pages, chunked IN lookups
// ---------------------------------------------------------------------------------------------
/** Keyset pages of `model` in the order `args.orderBy` (which must end with { id: 'asc' }). */
async function* pages(model, args, size = pageSize()) {
  let cursor = null;
  for (;;) {
    const rows = await model.findMany({ ...args, select: { ...args.select, id: true }, take: size, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (rows.length) yield rows;
    if (rows.length < size) return;
    cursor = rows.at(-1).id;
  }
}
/** findMany with `field IN ids`, split into chunks. For lookups only (results go into maps). */
async function findIn(model, field, ids, args = {}) {
  const uniq = [...new Set(ids)];
  const out = [];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    out.push(...await model.findMany({ ...args, where: { ...(args.where || {}), [field]: { in: uniq.slice(i, i + CHUNK) } } }));
  }
  return out;
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const groupBy = (rows, keyOf) => {
  const m = new Map();
  for (const r of rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};
const byTimeThenId = (field) => (a, b) => a[field] - b[field] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const SNAP_SELECT = { subjectId: true, eventId: true, userId: true, features: true, output: true, asOf: true, score: true, decision: true };
const snapWhere = (modelName, subjectType, now, extra = {}) => ({ modelName, role: 'RULES', subjectType, asOf: { lt: now }, createdAt: { lt: now }, ...extra });
const SNAP_ORDER = [{ asOf: 'asc' }, { id: 'asc' }];
/** Pages of a model's RULES snapshots, in prediction-time order. */
const snapPages = (db, modelName, subjectType, now) => pages(db.mlPrediction, { where: snapWhere(modelName, subjectType, now), orderBy: SNAP_ORDER, select: SNAP_SELECT });
/** Ids of the events that have snapshots of this model and subject type, in id order. */
async function snapshotEvents(db, modelName, subjectType, now) {
  const rows = await db.mlPrediction.groupBy({ by: ['eventId'], where: snapWhere(modelName, subjectType, now, { eventId: { not: null } }), orderBy: { eventId: 'asc' } });
  return rows.map((r) => r.eventId);
}
/** All snapshots of one event (bounded by the event's size), in prediction-time order. */
async function eventSnapshots(db, modelName, subjectType, eventId, now) {
  const out = [];
  for await (const page of pages(db.mlPrediction, { where: snapWhere(modelName, subjectType, now, { eventId }), orderBy: SNAP_ORDER, select: SNAP_SELECT })) out.push(...page);
  return out;
}

/**
 * Tickets sold in label windows, grouped by window and order, in one SQL per batch of windows.
 * windows: [{ key, eventId, from, to }] -> Map key -> [{ id (order id), status, n (tickets in the window) }]
 * Same rule as before batching: the event's orders created before `now`, counting their tickets created in
 * [from, to).
 */
async function windowSales(db, windows, now) {
  const out = new Map(windows.map((w) => [w.key, []]));
  for (const part of chunks(windows, 1000)) {
    const values = Prisma.join(part.map((w) => Prisma.sql`(${w.key}, ${w.eventId}, ${sqlTs(w.from)}, ${sqlTs(w.to)})`));
    const rows = await db.$queryRaw`
      SELECT w.k AS key, o.id AS id, o.status::text AS status, count(*)::int AS n
      FROM (VALUES ${values}) AS w(k, event_id, t_from, t_to)
      JOIN "Ticket" t ON t."eventId" = w.event_id AND t."createdAt" >= w.t_from AND t."createdAt" < w.t_to
      JOIN "Order" o ON o.id = t."orderId" AND o."createdAt" < ${sqlTs(now)}
      GROUP BY w.k, o.id, o.status
      ORDER BY w.k, o.id`;
    for (const r of rows) out.get(r.key).push({ id: r.id, status: r.status, n: r.n });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tallies, row checks, sinks
// ---------------------------------------------------------------------------------------------
class Tally {
  constructor() { this.kept = 0; this.excluded = {}; this.sources = {}; this.duplicates = 0; }
  skip(reason, n = 1) { this.excluded[reason] = (this.excluded[reason] || 0) + n; }
  keep(source) { this.kept += 1; this.sources[source] = (this.sources[source] || 0) + 1; }
  toJSON() { return { kept: this.kept, featureSources: this.sources, duplicatesDropped: this.duplicates, excluded: this.excluded }; }
}

const LABEL = { behavior_sequences: ['purchased_7d', 'checkout_abandoned'], fraud_purchases: ['is_fraud'], event_demand: ['sales_48h'], attendance_no_show: ['checked_in'], crowd_flow: ['scans'] };
const NULLABLE = { event_demand: new Set(['organizer_past_sell_through_48h']), fraud_purchases: new Set(['rule_score']) };
const NULLABLE_STEP5 = { demand_hourly: new Set(['organizer_past_sell_through_48h']) };
const COUNT_LABELS = ['sales_48h', 'scans'];
const validLabel = (l, v) => (l === 'checkout_abandoned' ? [-1, 0, 1].includes(v) : COUNT_LABELS.includes(l) ? Number.isInteger(v) && v >= 0 : [0, 1].includes(v));

/** Streaming row checks and label statistics for one dataset (same results as checking the whole array). */
class RowChecker {
  constructor(name) {
    this.step5 = STEP5.has(name);
    this.cols = this.step5 ? COLUMNS_STEP5[name] : COLUMNS[name];
    this.nullable = (this.step5 ? NULLABLE_STEP5 : NULLABLE)[name];
    this.i = 0;
    this.list = [];
    this.bad = {};
    this.labels = Object.fromEntries((this.step5 ? [] : LABEL[name]).map((l) => [l, { rows: 0, positives: 0, total: 0 }]));
  }
  add(r) {
    const i = this.i++;
    const note = (p) => { if (this.list.length < 20) this.list.push(p); };
    for (const c of this.cols) {
      const v = r[c];
      if ((v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) && !this.nullable?.has(c)) note(`row ${i}: ${c} missing`);
    }
    const extra = Object.keys(r).filter((k) => !this.cols.includes(k));
    if (extra.length) note(`row ${i}: unexpected ${extra.join(', ')}`);
    if (this.step5) return;
    if (r.feature_source !== 'snapshot') note(`row ${i}: not from a prediction-time snapshot`);
    for (const [l, s] of Object.entries(this.labels)) {
      const v = r[l];
      if (!validLabel(l, v)) this.bad[l] = (this.bad[l] || 0) + 1;
      if (v === -1) continue;
      s.rows += 1;
      if (COUNT_LABELS.includes(l)) s.total += v; else if (v === 1) s.positives += 1;
    }
  }
  problems() { return [...this.list, ...Object.entries(this.bad).map(([l, n]) => `${n} row(s) with an invalid ${l}`)].slice(0, 20); }
  labelStats() {
    return Object.fromEntries(Object.entries(this.labels).map(([l, s]) => [l, COUNT_LABELS.includes(l)
      ? { rows: s.rows, total: s.total, mean: s.rows ? s.total / s.rows : null }
      : { rows: s.rows, positives: s.positives, rate: s.rows ? s.positives / s.rows : null }]));
  }
}

/** Row checks of a whole array (tests and callers holding rows in memory). */
export function checkRows(name, rows) {
  const c = new RowChecker(name);
  for (const r of rows) c.add(r);
  return c.problems();
}
export const checkRowsStep5 = checkRows;

/** Keeps every row in memory: { name: rows } (tests, small exports). */
export class MemorySink {
  constructor() { this.data = {}; }
  open(name) { this.data[name] = []; }
  write(name, row) { this.data[name].push(row); }
}

/** One dataset's output: de-duplication by id, tally, streaming checks, the sink. */
class Out {
  constructor(name, idOf, sink, ctx) {
    this.name = name; this.idOf = idOf; this.sink = sink; this.ctx = ctx;
    this.tally = new Tally();
    this.seen = new Set();
    this.check = new RowChecker(name);
    sink.open(name, STEP5.has(name) ? COLUMNS_STEP5[name] : COLUMNS[name]);
  }
  async add(row, source = 'snapshot') {
    const id = this.idOf(row);
    if (this.seen.has(id)) { this.tally.duplicates += 1; return; }
    this.seen.add(id);
    const r = { ...row, feature_source: source };
    this.tally.keep(source);
    this.check.add(r);
    if (r.event_id && this.name !== 'customer_behaviour') this.ctx.usedEvents.add(r.event_id);
    await this.sink.write(this.name, r);
  }
}

// ---------------------------------------------------------------------------------------------
// Context: accounts, events, payment evidence, when genuine use began
// ---------------------------------------------------------------------------------------------
async function loadContext(db, now, policy) {
  const userById = new Map();
  for await (const page of pages(db.user, { orderBy: [{ id: 'asc' }], select: { email: true, role: true, createdAt: true } })) {
    for (const u of page) userById.set(u.id, u);
  }
  const ownerOf = new Map();
  for await (const page of pages(db.company, { orderBy: [{ id: 'asc' }], select: { userId: true } })) for (const c of page) ownerOf.set(c.id, userById.get(c.userId));
  const eventById = new Map();
  for await (const page of pages(db.event, {
    where: { createdAt: { lt: now } }, orderBy: [{ id: 'asc' }],
    select: {
      companyId: true, type: true, city: true, date: true, time: true, startsAt: true, endsAt: true, cancelledAt: true,
      salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true,
      gates: { select: { id: true, name: true, active: true, capacityPerHour: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
    },
  })) for (const e of page) eventById.set(e.id, e);
  const evidence = await liveEvidence(db, now);
  const deployed = await db.mlModel.findMany({ where: { status: 'SHADOW' }, orderBy: [{ registeredAt: 'desc' }, { id: 'asc' }], select: { id: true, name: true, sha256: true, version: true, source: true } });
  const deployedModels = {};
  for (const m of deployed) if (!deployedModels[m.name]) deployedModels[m.name] = { sha256: m.sha256, version: m.version, source: m.source, modelId: m.id };
  // When genuine use began: ML_GENUINE_FROM when set, else the first live-verified payment. Live payments before
  // an explicit start (staff test purchases) are not genuine: they are left out of the evidence altogether.
  const genuineFrom = policy?.genuineFrom || null;
  if (genuineFrom) for (const [id, e] of evidence) if (e.at < genuineFrom) evidence.delete(id);
  const firstPayment = [...evidence.values()].reduce((a, e) => (!a || e.at < a ? e.at : a), null);
  const firstLive = genuineFrom || firstPayment;
  const evidenceOrders = await findIn(db.order, 'id', [...evidence.keys()], { select: { userId: true, eventId: true } });
  const evidenceUsers = new Set(evidenceOrders.map((o) => o.userId));
  const evidenceEvents = new Set(evidenceOrders.map((o) => o.eventId));
  const eventTimes = new Map(); // pseudonymised event id -> {sales_open, event_start} (from snapshots where known)
  return { userById, ownerOf, eventById, deployedModels, evidence, evidenceUsers, evidenceEvents, firstLive, genuineFrom, firstPayment, eventTimes, usedEvents: new Set() };
}

/**
 * Why an account's activity is not GENUINE_CUSTOMER data (null = genuine). Beyond the test/internal policy, an
 * account counts only once genuine use has demonstrably begun: it has its own live, server-verified purchase,
 * or it was created after genuine use began. Accounts from before that (developers, testers, demo users with
 * ordinary e-mail domains) are INTERNAL_TEST, whatever their domain.
 */
export function accountClass(ctx, userId) {
  const u = ctx.userById.get(userId);
  const why = accountExclusion(u, ctx.policy);
  if (why) return why;
  if (ctx.evidenceUsers.has(userId)) return null;
  if (ctx.firstLive && u.createdAt >= ctx.firstLive) return null;
  return 'account from before genuine use began (no live-verified purchase): internal test';
}

const verifiedPaid = (ctx, o) => SOLD.includes(o.status) && ctx.evidence.has(o.id);
const paidUnverified = (ctx, o) => SOLD.includes(o.status) && !ctx.evidence.has(o.id);
const realEvent = (ctx, eventId) => {
  const e = ctx.eventById.get(eventId);
  const why = eventExclusion(e, e && ctx.ownerOf.get(e.companyId), ctx.policy);
  if (why) return why;
  // Same rule as accounts: genuine operation of this event must have begun (a live-verified sale, or the
  // event was created after genuine use began)
  if (ctx.evidenceEvents.has(eventId)) return null;
  if (ctx.firstLive && e.createdAt >= ctx.firstLive) return null;
  return 'event from before genuine use began (no live-verified sale): internal test';
};

/**
 * Why a logged prediction cannot serve as a prediction-time snapshot (null = usable). `need` = raw values the
 * training row takes from output.context.
 */
export function snapshotProblem(p, need = []) {
  if (!p.features || typeof p.features !== 'object') return 'no inputs logged (prediction skipped)';
  const c = p.output?.context;
  // Exactness was checked when the snapshot was written (snapshotIntegrity.js); anything else is left out
  if (!c || c.exact === undefined) return 'snapshot integrity not verified (logged before the check existed)';
  if (!(c.integrity?.version >= INTEGRITY_VERSION)) return 'snapshot integrity checked by an older, weaker check';
  if (c.exact !== true) {
    const why = String(c.integrity?.reason || '');
    if (why.startsWith('inputs changed')) return 'not exact: event inputs changed after the prediction moment';
    if (why.startsWith('typical-price inputs changed')) return 'not exact: typical-price inputs changed after the prediction moment (no point-in-time value)';
    return `not exact: ${why.split(/[:(]/)[0].trim() || 'unknown'}`;
  }
  if (!need.length) return null;
  if (!c || need.some((k) => c[k] === undefined || c[k] === null)) return 'snapshot without prediction-time prices / capacity / start (logged before they were stored)';
  if (c.captured_at && new Date(c.captured_at) - p.asOf > MAX_CAPTURE_LAG_MS) return 'snapshot read too long after the prediction moment';
  return null;
}

const noteTimes = (ctx, eventId, c) => {
  const k = pseudo('E', eventId);
  const prev = ctx.eventTimes.get(k) || {};
  ctx.eventTimes.set(k, { sales_open: prev.sales_open || c?.sales_open, event_start: prev.event_start || c?.event_start });
};

// ---------------------------------------------------------------------------------------------
// behavior_sequences (intent + abandonment): logged visit snapshots
// ---------------------------------------------------------------------------------------------
async function exportVisits(db, ctx, now, sink) {
  const out = new Out('behavior_sequences', (r) => r.session_id, sink, ctx);
  const t = out.tally;
  const interventions = { intentRowsWithReminderInWindow: 0, abandonmentRowsWithReminderInWindow: 0 };
  const key = (x) => `${x.userId}|${x.eventId}`;
  for await (const page of snapPages(db, 'intent', 'VISIT', now)) {
    const visits = page.map((p) => parseVisitId(p.subjectId));
    const userIds = visits.map((v) => v.userId);
    const since = new Date(Math.min(...visits.map((v) => v.start.getTime())));
    const orders = groupBy(await findIn(db.order, 'userId', userIds, { where: { createdAt: { gte: since, lt: now } }, select: { id: true, userId: true, eventId: true, status: true, createdAt: true } }), key);
    const reminders = groupBy(await findIn(db.recoveryReminder, 'userId', userIds, { where: { sentAt: { gte: since, lt: now } }, select: { userId: true, eventId: true, sentAt: true } }), key);
    for (const [i, p] of page.entries()) {
      const v = visits[i];
      const why = accountClass(ctx, v.userId) || realEvent(ctx, v.eventId);
      if (why) { t.skip(why); continue; }
      const bad = snapshotProblem(p, ['ticket_price', 'min_price']);
      if (bad) { t.skip(bad); continue; }
      const weekEnd = new Date(v.start.getTime() + 7 * DAY);
      if (weekEnd > now) { t.skip('7-day purchase window not over yet'); continue; }
      if (!ctx.firstLive || v.start < ctx.firstLive) { t.skip('before the first server-verified live payment (a non-purchase cannot be verified)'); continue; }
      const mine = orders.get(key(v)) || [];
      const inWeek = mine.filter((o) => o.createdAt >= v.start && o.createdAt <= weekEnd);
      if (inWeek.some((o) => paidUnverified(ctx, o))) { t.skip('a purchase without live server-side payment evidence'); continue; }
      const f = p.features;
      let abandoned = -1;
      if (f.checkout_started) abandoned = mine.some((o) => o.createdAt >= v.start && o.createdAt <= p.asOf && verifiedPaid(ctx, o)) ? 0 : 1;
      const rem = (reminders.get(key(v)) || []).filter((m) => m.sentAt >= v.start);
      if (rem.some((m) => m.sentAt <= weekEnd)) interventions.intentRowsWithReminderInWindow += 1;
      if (abandoned !== -1 && rem.some((m) => m.sentAt <= p.asOf)) interventions.abandonmentRowsWithReminderInWindow += 1;
      const c = p.output.context;
      await out.add({
        session_id: pseudo('S', p.subjectId), customer_id: pseudo('C', v.userId), event_id: pseudo('E', v.eventId), ts: iso(p.asOf),
        ...f, currency: CURRENCY, ticket_price: c.ticket_price, min_price: c.min_price,
        purchased_7d: inWeek.some((o) => verifiedPaid(ctx, o)) ? 1 : 0, checkout_abandoned: abandoned,
      });
      noteTimes(ctx, v.eventId, null);
    }
  }
  return { out, interventions };
}

// ---------------------------------------------------------------------------------------------
// fraud_purchases: logged checkout snapshots + blind review labels, weighted by the sampling design
// ---------------------------------------------------------------------------------------------
const LINK_INPUTS = ['linked_accounts', 'linked_accounts_confirmed_fraud', 'linked_orders_same_event_24h'];
async function exportFraud(db, ctx, now, sink) {
  const out = new Out('fraud_purchases', (r) => r.order_id, sink, ctx);
  const t = out.tally;
  const blocked = await db.mlPrediction.groupBy({ by: ['decision'], where: snapWhere('fraud', 'CHECKOUT_ATTEMPT', now), _count: { _all: true }, orderBy: { decision: 'asc' } });
  const quality = { blockedCheckouts: 0, blockedByRuleDecision: {}, notSampled: 0, sampledNotSelected: 0, unreviewed: 0, unresolved: 0, exposedOnly: 0, resolved: 0, disputed: 0 };
  for (const b of blocked) {
    quality.blockedCheckouts += b._count._all;
    quality.blockedByRuleDecision[b.decision || 'none'] = (quality.blockedByRuleDecision[b.decision || 'none'] || 0) + b._count._all;
  }
  for await (const page of snapPages(db, 'fraud', 'ORDER', now)) {
    const ids = page.map((p) => p.subjectId);
    const samples = new Map((await findIn(db.fraudSample, 'orderId', ids, {
      select: { orderId: true, selected: true, inclusionProbability: true, reviews: { where: { createdAt: { lt: now } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, decision: true, createdAt: true, blind: true } } },
    })).map((s) => [s.orderId, s]));
    const orders = new Map((await findIn(db.order, 'id', ids, { select: { id: true, userId: true, eventId: true, totalAmount: true, status: true } })).map((o) => [o.id, o]));
    const disputed = new Set((await findIn(db.auditLog, 'targetId', ids, { where: { action: 'PAYMENT_DISPUTE', createdAt: { lt: now } }, select: { targetId: true } })).map((r) => r.targetId));
    for (const p of page) {
      const order = orders.get(p.subjectId);
      if (!order) { t.skip('order deleted'); continue; }
      const why = accountClass(ctx, order.userId) || realEvent(ctx, order.eventId);
      if (why) { t.skip(why); continue; }
      if (!ctx.evidence.has(order.id)) { t.skip('no live server-side payment evidence'); continue; }
      if (disputed.has(order.id)) { quality.disputed += 1; t.skip('payment disputed (kept separate from fraud labels)'); continue; }
      const bad = snapshotProblem(p);
      if (bad) { t.skip(bad); continue; }
      // Snapshots logged before the account-link inputs existed: the values are not reconstructed afterwards
      if (!LINK_INPUTS.every((k) => Number.isFinite(p.features?.[k]))) { t.skip('snapshot taken before account-link inputs'); continue; }
      const s = samples.get(p.subjectId);
      if (!s) { quality.notSampled += 1; t.skip('not yet placed in the review sample'); continue; }
      if (!s.selected) { quality.sampledNotSelected += 1; t.skip('not selected for review (no label)'); continue; }
      const e = effectiveReview(s.reviews);
      if (!e) {
        if (s.reviews.length) { quality.exposedOnly += 1; t.skip('only reviews by admins who had seen detector output'); } else { quality.unreviewed += 1; t.skip('selected, not reviewed yet'); }
        continue;
      }
      if (e.decision === 'UNRESOLVED') { quality.unresolved += 1; t.skip('review unresolved'); continue; }
      quality.resolved += 1;
      await out.add({
        order_id: pseudo('O', order.id), customer_id: pseudo('C', order.userId), event_id: pseudo('E', order.eventId), ts: iso(p.asOf),
        ...p.features, currency: CURRENCY, total_amount: Number(order.totalAmount),
        is_fraud: e.decision === 'CONFIRMED_FRAUD' ? 1 : 0, sample_weight: Math.round((1 / s.inclusionProbability) * 1e6) / 1e6,
        rule_flag: RULE_FLAGS.includes(p.decision) ? 1 : 0, rule_score: p.score,
      });
      noteTimes(ctx, order.eventId, null);
    }
  }
  return { out, quality };
}

// ---------------------------------------------------------------------------------------------
// event_demand: the snapshot read at sales open (or the latest forecast logged before it)
// ---------------------------------------------------------------------------------------------
const DEMAND_CONTEXT = ['min_price', 'avg_price', 'max_price', 'event_start', 'sales_open', 'organizer_id'];
const DEMAND_TYPES = ['EVENT_AT_SALES_OPEN', 'EVENT_FORECAST'];
async function exportDemand(db, ctx, now, sink) {
  const out = new Out('event_demand', (r) => r.event_id, sink, ctx);
  const t = out.tally;
  for (const batch of chunks([...ctx.eventById.values()], EVENT_BATCH)) {
    const real = batch.filter((e) => { const why = realEvent(ctx, e.id); if (why) t.skip(why); return !why; });
    const snaps = groupBy(await findIn(db.mlPrediction, 'eventId', real.map((e) => e.id), {
      where: { modelName: 'demand', role: 'RULES', subjectType: { in: DEMAND_TYPES }, asOf: { lt: now }, createdAt: { lt: now } },
      select: { ...SNAP_SELECT, subjectType: true, id: true },
    }), (p) => p.eventId);
    const candidates = [];
    for (const event of real) {
      // The sales-open snapshot first, then the forecasts, each in prediction-time order
      const list = [...(snaps.get(event.id) || [])].sort((a, b) => DEMAND_TYPES.indexOf(a.subjectType) - DEMAND_TYPES.indexOf(b.subjectType) || byTimeThenId('asOf')(a, b));
      const problems = list.map((p) => snapshotProblem(p, DEMAND_CONTEXT));
      const usable = list.filter((p, i) => !problems[i]);
      // A sales-open snapshot, else the latest forecast logged no later than sales open (as known then)
      const pick = usable.find((p) => p.subjectId === event.id)
        || usable.filter((p) => p.asOf <= new Date(p.output.context.sales_open)).sort((a, b) => b.asOf - a.asOf || (a.id < b.id ? -1 : 1))[0];
      if (!pick) { t.skip(list.length ? problems.find(Boolean) || 'no snapshot at or before sales open' : 'no prediction-time snapshot'); continue; }
      const c = pick.output.context;
      const open = new Date(c.sales_open);
      const end = new Date(open.getTime() + 2 * DAY);
      if (end > now) { t.skip('first 48 hours not over yet'); continue; }
      if (!ctx.firstLive || open < ctx.firstLive) { t.skip('sales opened before the first server-verified live payment'); continue; }
      candidates.push({ event, pick, open, end });
    }
    const sales = await windowSales(db, candidates.map((x) => ({ key: x.event.id, eventId: x.event.id, from: x.open, to: x.end })), now);
    for (const { event, pick, open } of candidates) {
      const orders = sales.get(event.id);
      if (orders.some((o) => paidUnverified(ctx, o))) { t.skip('48-hour sales include payments without live server-side evidence'); continue; }
      const sold = orders.filter((o) => verifiedPaid(ctx, o)).reduce((n, o) => n + o.n, 0);
      const c = pick.output.context;
      await out.add({
        event_id: pseudo('E', event.id), organizer_id: pseudo('G', c.organizer_id), ts: iso(open), event_start: iso(c.event_start),
        timezone: c.timezone || TIMEZONE, currency: CURRENCY, min_price: c.min_price, avg_price: c.avg_price, max_price: c.max_price,
        ...pick.features, sales_48h: sold,
      });
      noteTimes(ctx, event.id, c);
    }
  }
  return { out };
}

// ---------------------------------------------------------------------------------------------
// attendance_no_show: ticket snapshots 24 h before the event, labelled by admitted check-ins
// ---------------------------------------------------------------------------------------------
async function exportAttendance(db, ctx, now, sink) {
  const out = new Out('attendance_no_show', (r) => r.ticket_id, sink, ctx);
  const t = out.tally;
  for (const eventId of await snapshotEvents(db, 'attendance', 'TICKET', now)) {
    const why = realEvent(ctx, eventId);
    if (why) { t.skip(why, await db.mlPrediction.count({ where: snapWhere('attendance', 'TICKET', now, { eventId }) })); continue; }
    const list = await eventSnapshots(db, 'attendance', 'TICKET', eventId, now);
    const bad = list.map((p) => snapshotProblem(p, ['ticket_price', 'event_start', 'holder_id', 'event_tickets_sold'])).find(Boolean);
    if (bad) { t.skip(`event left out: ${bad}`, list.length); continue; }
    const start = new Date(list[0].output.context.event_start);
    const ev = ctx.eventById.get(eventId);
    if (Math.max(endOf(ev).getTime(), start.getTime() + 4 * HOUR) >= now.getTime()) { t.skip('event not finished yet', list.length); continue; }
    const tickets = new Map((await findIn(db.ticket, 'id', list.map((p) => p.subjectId), {
      select: { id: true, status: true, checkedInAt: true, refund: { select: { createdAt: true } }, order: { select: { id: true, status: true } } },
    })).map((x) => [x.id, x]));
    let unusable = null;
    for (const p of list) {
      const x = tickets.get(p.subjectId);
      if (!x) { unusable = 'a ticket was deleted'; break; }
      if (!verifiedPaid(ctx, x.order)) { unusable = 'a ticket without live server-side payment evidence'; break; }
      const holderWhy = accountClass(ctx, p.output.context.holder_id);
      if (holderWhy) { unusable = `a ticket holder is a ${holderWhy}`; break; }
    }
    if (unusable) { t.skip(`event left out: ${unusable}`, list.length); continue; }
    for (const p of list) {
      const x = tickets.get(p.subjectId);
      const c = p.output.context;
      if (x.status === 'CANCELLED') { t.skip('refunded after the prediction time'); continue; }
      await out.add({
        ticket_id: pseudo('T', x.id), customer_id: pseudo('C', c.holder_id), event_id: pseudo('E', eventId), ts: iso(p.asOf),
        event_start: iso(start), currency: CURRENCY, ticket_price: c.ticket_price, ...p.features,
        event_tickets_sold: c.event_tickets_sold, sample_weight: 1, checked_in: x.checkedInAt ? 1 : 0,
      });
    }
    noteTimes(ctx, eventId, { event_start: start.toISOString() });
  }
  return { out };
}

// ---------------------------------------------------------------------------------------------
// crowd_flow: gate x slot snapshots taken before the event
// ---------------------------------------------------------------------------------------------
async function exportCrowd(db, ctx, now, sink) {
  const out = new Out('crowd_flow', (r) => `${r.gate_id}|${r.ts}`, sink, ctx);
  const t = out.tally;
  const withSnaps = await snapshotEvents(db, 'crowd', 'GATE_SLOT', now);
  const has = new Set(withSnaps);
  const readiness = { snapshotted: withSnaps.length, finishedWithoutSnapshot: {} };
  for (const event of ctx.eventById.values()) {
    if (has.has(event.id) || startOf(event).getTime() + DAY > now.getTime() || realEvent(ctx, event.id)) continue;
    const r = crowdReadiness(event.gates);
    const reason = r.ready ? 'not scored before it started' : r.reason === 'NO_ACTIVE_GATES' ? 'no active gates' : 'gate capacity per hour missing';
    readiness.finishedWithoutSnapshot[reason] = (readiness.finishedWithoutSnapshot[reason] || 0) + 1;
    t.skip(`no snapshot: ${reason}`);
  }
  for (const eventId of withSnaps) {
    const why = realEvent(ctx, eventId);
    if (why) { t.skip(why); continue; }
    const list = await eventSnapshots(db, 'crowd', 'GATE_SLOT', eventId, now);
    const bad = list.map((p) => snapshotProblem(p, ['event_start'])).find(Boolean);
    if (bad) { t.skip(bad); continue; }
    const start = new Date(list[0].output.context.event_start);
    if (start.getTime() + DAY > now.getTime()) { t.skip('event not finished yet'); continue; }
    const perGate = new Map();
    for (const p of list) { const { gateId, minutes } = parseSlotSubject(p.subjectId); if (!perGate.has(gateId)) perGate.set(gateId, new Map()); perGate.get(gateId).set(minutes, p); }
    if ([...perGate.values()].some((m) => SLOTS.some((s) => !m.has(s)))) { t.skip('incomplete snapshot (missing slots)'); continue; }
    let sold = 0;
    let unverified = false;
    for await (const page of pages(db.order, { where: { eventId, status: { in: SOLD }, createdAt: { lt: now } }, orderBy: [{ id: 'asc' }], select: { status: true } })) {
      sold += page.length;
      if (page.some((o) => paidUnverified(ctx, o))) { unverified = true; break; }
    }
    if (!sold) { t.skip('no tickets sold'); continue; }
    if (unverified) { t.skip('event has tickets without live server-side payment evidence'); continue; }
    for (const [gateId, slots] of perGate) {
      const counts = await entriesBySlot(eventId, start, gateId, db);
      for (const m of SLOTS) {
        const f = slots.get(m).features;
        await out.add({
          event_id: pseudo('E', eventId), gate_id: pseudo('Q', gateId), ts: iso(start.getTime() + m * 60_000), minutes_from_start: m,
          event_type: f.event_type, city: f.city, country: f.country, day_of_week: f.day_of_week, start_hour: f.start_hour,
          tickets_sold: f.tickets_sold, gate_count: f.gate_count, gate_capacity_per_hour: f.gate_capacity_per_hour, scans: counts[(m + 90) / 5],
        });
      }
    }
    noteTimes(ctx, eventId, { event_start: start.toISOString() });
  }
  return { out, readiness };
}

/** Data-source class of an exclusion reason (everything kept is GENUINE_CUSTOMER). */
export function sourceClassOfReason(reason) {
  if (/internal test|test e-mail|internal e-mail|not a customer|test organizer|internal organizer|excluded (account|event)|MOCK|live (server-side )?payment|live method|live-verified|server-verified|holder is a|before genuine use began/i.test(reason)) return 'INTERNAL_TEST';
  return 'DATA_QUALITY';
}

// ---------------------------------------------------------------------------------------------
// checkout_abandonment: checkout-start snapshots with the agreed label (labels.js)
// ---------------------------------------------------------------------------------------------
async function exportCheckouts(db, ctx, now, sink) {
  const out = new Out('checkout_abandonment', (r) => r.order_id, sink, ctx);
  const t = out.tally;
  const reasons = {};
  for await (const page of snapPages(db, 'checkout_abandonment', 'ORDER', now)) {
    const ids = page.map((p) => p.subjectId);
    const orders = new Map((await findIn(db.order, 'id', ids, { select: { id: true, userId: true, eventId: true, status: true, createdAt: true } })).map((o) => [o.id, o]));
    // The checkout's first recorded end (earliest), and failed payments of these orders
    const ends = new Map();
    const endRows = await findIn(db.auditLog, 'targetId', ids, { where: { action: 'CHECKOUT_ENDED', createdAt: { lt: now } }, select: { id: true, targetId: true, details: true, createdAt: true } });
    for (const r of endRows.sort(byTimeThenId('createdAt'))) if (!ends.has(r.targetId)) ends.set(r.targetId, r);
    const failed = new Set();
    for (const part of chunks([...new Set(ids)], CHUNK)) {
      const rows = await db.$queryRaw`SELECT DISTINCT metadata->>'orderId' AS id FROM "BehaviorEvent" WHERE action = 'payment_failed' AND "createdAt" < ${sqlTs(now)} AND metadata->>'orderId' IN (${Prisma.join(part)})`;
      for (const r of rows) failed.add(r.id);
    }
    // Later orders of the same customer for the same event, within each checkout's outcome window
    const known = [...orders.values()];
    const later = known.length ? groupBy(await findIn(db.order, 'userId', known.map((o) => o.userId), {
      where: { eventId: { in: [...new Set(known.map((o) => o.eventId))] }, createdAt: { gte: new Date(Math.min(...known.map((o) => o.createdAt.getTime()))), lt: now } },
      select: { id: true, userId: true, eventId: true, status: true, createdAt: true },
    }), (o) => `${o.userId}|${o.eventId}`) : new Map();
    for (const p of page) {
      const o = orders.get(p.subjectId);
      if (!o) { t.skip('order deleted'); continue; }
      const why = accountClass(ctx, o.userId) || realEvent(ctx, o.eventId);
      if (why) { t.skip(why); continue; }
      const bad = snapshotProblem(p);
      if (bad) { t.skip(bad); continue; }
      if (!ctx.firstLive || o.createdAt < ctx.firstLive) { t.skip('before the first server-verified live payment (an unpaid checkout cannot be verified)'); continue; }
      if (SOLD.includes(o.status) && !ctx.evidence.has(o.id)) { t.skip('paid without live server-side payment evidence'); continue; }
      const windowEnd = new Date(o.createdAt.getTime() + ABANDON_OUTCOME_WINDOW_MS);
      const inWindow = (later.get(`${o.userId}|${o.eventId}`) || []).filter((x) => x.id !== o.id && x.createdAt >= o.createdAt && x.createdAt <= windowEnd);
      if (inWindow.some((x) => paidUnverified(ctx, x))) { t.skip('a purchase in the window without live server-side evidence'); continue; }
      const { label, reason } = checkoutAbandonmentLabel({
        order: { status: o.status, createdAt: o.createdAt, paid: verifiedPaid(ctx, o) }, endReason: ends.get(o.id)?.details?.reason ?? null,
        paymentFailed: failed.has(o.id), boughtInWindow: inWindow.some((x) => verifiedPaid(ctx, x)), now,
      });
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (label === null) { t.skip(`no abandonment label: ${reason}`); continue; }
      await out.add({ order_id: pseudo('O', o.id), customer_id: pseudo('C', o.userId), event_id: pseudo('E', o.eventId), ts: iso(p.asOf), ...p.features, abandoned: label });
      noteTimes(ctx, o.eventId, null);
    }
  }
  return { out, outcomes: reasons };
}

// ---------------------------------------------------------------------------------------------
// demand_hourly: hourly snapshots while on sale, labelled by verified sales in the next 24 h
// ---------------------------------------------------------------------------------------------
async function exportDemandHourly(db, ctx, now, sink) {
  const out = new Out('demand_hourly', (r) => `${r.event_id}|${r.ts}`, sink, ctx);
  const t = out.tally;
  for await (const page of snapPages(db, 'demand_hourly', 'EVENT_HOURLY', now)) {
    const candidates = [];
    for (const p of page) {
      const why = realEvent(ctx, p.eventId);
      if (why) { t.skip(why); continue; }
      const bad = snapshotProblem(p, ['organizer_id', 'event_start']);
      if (bad) { t.skip(bad); continue; }
      const end = new Date(p.asOf.getTime() + DEMAND_HOURLY_HORIZON_MS);
      if (end > now) { t.skip('24-hour horizon not over yet'); continue; }
      if (!ctx.firstLive || p.asOf < ctx.firstLive) { t.skip('before the first server-verified live payment'); continue; }
      candidates.push({ p, end });
    }
    const sales = await windowSales(db, candidates.map(({ p, end }) => ({ key: p.id, eventId: p.eventId, from: p.asOf, to: end })), now);
    for (const { p } of candidates) {
      const orders = sales.get(p.id);
      if (orders.some((o) => paidUnverified(ctx, o))) { t.skip('sales in the horizon without live server-side evidence'); continue; }
      const sold = orders.filter((o) => verifiedPaid(ctx, o)).reduce((n, o) => n + o.n, 0);
      const f = p.features;
      await out.add({
        event_id: pseudo('E', p.eventId), organizer_id: pseudo('G', p.output.context.organizer_id), ts: iso(p.asOf),
        ...Object.fromEntries(COLUMNS_STEP5.demand_hourly.filter((c) => c in f).map((c) => [c, f[c]])),
        rule_next_24h: p.score ?? f.sold_last_24h, sales_next_24h: sold,
      });
      noteTimes(ctx, p.eventId, p.output.context);
    }
  }
  return { out };
}

// ---------------------------------------------------------------------------------------------
// recommendation_impressions: every list served, clicks within 24 h, verified purchases within 7 days
// ---------------------------------------------------------------------------------------------
async function exportRecommendations(db, ctx, now, sink) {
  const out = new Out('recommendation_impressions', (r) => `${r.list_id}|${r.event_id}`, sink, ctx);
  const t = out.tally;
  // The experiment group a visitor was first assigned (their earliest list): a list shown in the other group
  // (lists on another device before the accounts were linked) would mix the groups, so it is left out
  const firstVariant = new Map();
  for await (const page of pages(db.behaviorEvent, { where: { action: 'recommendation_impression', createdAt: { lt: now } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { userId: true, createdAt: true, metadata: true } })) {
    const listIds = [...new Set(page.map((l) => l.metadata?.listId).filter(Boolean))];
    const clickAt = new Map(); // listId|eventId -> earliest click
    const rendered = new Set(); // Step 6: lists the page reported as on screen
    for (const part of chunks(listIds, CHUNK)) {
      const shown = await db.$queryRawUnsafe(
        `SELECT DISTINCT metadata->>'listId' AS list_id FROM "BehaviorEvent"
         WHERE action = 'recommendation_rendered' AND "createdAt" < ($1::timestamptz AT TIME ZONE 'UTC') AND metadata->>'listId' = ANY($2::text[])`, now.toISOString(), part);
      for (const r of shown) rendered.add(r.list_id);
      const rows = await db.$queryRawUnsafe(
        `SELECT metadata->>'listId' AS list_id, "eventId" AS event_id, to_char(min("createdAt"), ${ISO_SQL}) AS at
         FROM "BehaviorEvent" WHERE action = 'recommendation_click' AND "createdAt" < ($1::timestamptz AT TIME ZONE 'UTC') AND metadata->>'listId' = ANY($2::text[])
         GROUP BY 1, 2`, now.toISOString(), part);
      for (const r of rows) clickAt.set(`${r.list_id}|${r.event_id}`, new Date(r.at));
    }
    const users = [...new Set(page.map((l) => l.userId).filter(Boolean))];
    const ordersOf = groupBy(await findIn(db.order, 'userId', users, { where: { createdAt: { lt: now } }, select: { id: true, userId: true, eventId: true, status: true, createdAt: true } }), (o) => o.userId);
    for (const l of page) {
      const m = l.metadata || {};
      // Step 6: a list served with render tracking counts only if it was actually on screen
      if (m.renderTracked && !rendered.has(m.listId)) { t.skip('served but never shown on screen', (m.items || []).length || 1); continue; }
      if (!l.userId) { t.skip('anonymous visitor never linked to an account (cannot be shown to be genuine)', (m.items || []).length || 1); continue; }
      if (!firstVariant.has(l.userId)) firstVariant.set(l.userId, m.variant);
      const why = accountClass(ctx, l.userId);
      if (why) { t.skip(why, (m.items || []).length || 1); continue; }
      if (m.variant !== firstVariant.get(l.userId)) { t.skip('experiment group changed (lists from another device before login)', (m.items || []).length || 1); continue; }
      const attrEnd = new Date(l.createdAt.getTime() + REC_ATTRIBUTION_MS);
      const done = attrEnd <= now;
      const userOrders = ordersOf.get(l.userId) || [];
      const firstTime = !userOrders.some((o) => o.createdAt < l.createdAt && verifiedPaid(ctx, o));
      for (const it of m.items || []) {
        const ev = realEvent(ctx, it.eventId);
        if (ev) { t.skip(ev); continue; }
        const k = `${m.listId}|${it.eventId}`;
        const clicked = clickAt.has(k) && clickAt.get(k) - l.createdAt <= REC_CLICK_WINDOW_MS ? 1 : 0;
        const inWindow = userOrders.filter((o) => o.eventId === it.eventId && o.createdAt >= l.createdAt && o.createdAt <= attrEnd);
        let bought = -1; // unknown: window open, or no live payments possible yet
        if (done && ctx.firstLive && l.createdAt >= ctx.firstLive && !inWindow.some((o) => paidUnverified(ctx, o))) bought = inWindow.some((o) => verifiedPaid(ctx, o)) ? 1 : 0;
        await out.add({
          list_id: pseudo('L', m.listId), customer_id: pseudo('C', l.userId), event_id: pseudo('E', it.eventId), ts: iso(l.createdAt),
          variant: m.variant, basis: m.basis, surface: m.surface, position: it.position, popularity_rank: it.popularityRank,
          exploration: it.exploration ? 1 : 0, is_new_event: it.isNew ? 1 : 0, first_time: firstTime ? 1 : 0, clicked, purchased_7d: bought,
        }, 'impression-log');
      }
    }
  }
  return { out };
}

// ---------------------------------------------------------------------------------------------
// customer_behaviour: one aggregate row per genuine customer (grouped SQL per batch of customers)
// ---------------------------------------------------------------------------------------------
async function exportCustomerBehaviour(db, ctx, now, sink) {
  const out = new Out('customer_behaviour', (r) => r.customer_id, sink, ctx);
  const t = out.tally;
  const genuine = [];
  for (const [id, u] of ctx.userById) {
    const why = accountClass(ctx, id);
    if (why) { if (u.role === 'CUSTOMER') t.skip(why); continue; }
    genuine.push(id);
  }
  for (const batch of chunks(genuine, USER_BATCH)) {
    const acts = new Map((await db.$queryRawUnsafe(
      `SELECT "userId" AS user_id, count(*)::int AS n,
         to_char(min("createdAt"), ${ISO_SQL}) AS first_seen, to_char(max("createdAt"), ${ISO_SQL}) AS last_seen,
         count(DISTINCT CASE WHEN "eventId" IS NOT NULL THEN "eventId" || '|' || floor(extract(epoch FROM "createdAt") / 1800)::bigint END)::int AS visits,
         count(DISTINCT CASE WHEN action = 'event_view' THEN "eventId" END)::int AS events_viewed,
         count(*) FILTER (WHERE action = 'search')::int AS searches,
         count(*) FILTER (WHERE action = 'wishlist_added')::int AS wishlists,
         count(*) FILTER (WHERE action = 'recommendation_click')::int AS recommendation_clicks
       FROM "BehaviorEvent" WHERE "userId" = ANY($1::text[]) AND "createdAt" < ($2::timestamptz AT TIME ZONE 'UTC')
       GROUP BY "userId"`, batch, now.toISOString())).map((r) => [r.user_id, r]));
    const ordersOf = groupBy(await findIn(db.order, 'userId', batch, { where: { createdAt: { lt: now } }, select: { id: true, userId: true, status: true, eventId: true, totalAmount: true, createdAt: true, _count: { select: { tickets: true } } } }), (o) => o.userId);
    for (const id of batch) {
      const a = acts.get(id);
      const orders = ordersOf.get(id) || [];
      if (!a && !orders.length) { t.skip('no activity'); continue; }
      const paid = orders.filter((o) => verifiedPaid(ctx, o) && !realEvent(ctx, o.eventId));
      const cats = {};
      for (const o of paid) { const e = ctx.eventById.get(o.eventId); if (e) cats[e.type] = (cats[e.type] || 0) + 1; }
      const ot = orders.map((o) => o.createdAt.getTime());
      const pt = paid.map((o) => o.createdAt.getTime()).sort((x, y) => x - y);
      await out.add({
        customer_id: pseudo('C', id),
        first_seen: a ? a.first_seen : iso(Math.min(...ot)), last_seen: a ? a.last_seen : iso(Math.max(...ot)),
        visits: a?.visits ?? 0, events_viewed: a?.events_viewed ?? 0, searches: a?.searches ?? 0, wishlists: a?.wishlists ?? 0,
        verified_orders: paid.length, verified_tickets: paid.reduce((n, o) => n + o._count.tickets, 0),
        verified_spend: Math.round(paid.reduce((n, o) => n + Number(o.totalAmount), 0) * 100) / 100,
        categories_bought: Object.keys(cats).length, top_category: Object.entries(cats).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] || 'NONE',
        repeat_customer: paid.length > 1 ? 1 : 0, days_first_to_last_purchase: pt.length > 1 ? Math.round((pt.at(-1) - pt[0]) / DAY * 10) / 10 : 0,
        recommendation_clicks: a?.recommendation_clicks ?? 0,
      }, 'aggregate');
    }
  }
  return { out };
}

/** Attendance data quality for finished real events: sold, refunded, valid attendance, no-shows, late, corrected. */
const LIVE_STATUSES = ['ACTIVE', 'SCANNED'];
async function attendanceQuality(db, ctx, now) {
  const q = { events: 0, ticketsSold: 0, refundedOrCancelled: 0, attended: 0, noShows: 0, lateCheckIns: 0, correctedCheckIns: 0, exceptionAdmissions: 0 };
  const finished = [...ctx.eventById.values()].filter((e) => !realEvent(ctx, e.id) && endOf(e) < now);
  for (const batch of chunks(finished, 1000)) {
    const values = Prisma.join(batch.map((e) => Prisma.sql`(${e.id}, ${sqlTs(startOf(e))})`));
    const rows = await db.$queryRaw`
      SELECT w.event_id, count(*)::int AS n,
        count(*) FILTER (WHERE t.status::text IN ('ACTIVE', 'SCANNED'))::int AS live,
        count(*) FILTER (WHERE t.status::text IN ('ACTIVE', 'SCANNED') AND t."checkedInAt" IS NOT NULL)::int AS attended,
        count(*) FILTER (WHERE t.status::text IN ('ACTIVE', 'SCANNED') AND t."checkedInAt" > w.start + (${LATE_CHECKIN_MS}::int * interval '1 millisecond'))::int AS late
      FROM (VALUES ${values}) AS w(event_id, start)
      JOIN "Ticket" t ON t."eventId" = w.event_id AND t."createdAt" < ${sqlTs(now)}
      GROUP BY w.event_id`;
    const ids = rows.map((r) => r.event_id);
    for (const r of rows) {
      q.events += 1;
      q.ticketsSold += r.n;
      q.refundedOrCancelled += r.n - r.live;
      q.attended += r.attended;
      q.noShows += r.live - r.attended;
      q.lateCheckIns += r.late;
    }
    if (!ids.length) continue;
    q.correctedCheckIns += await db.checkIn.count({ where: { eventId: { in: ids }, reversedAt: { not: null } } });
    q.exceptionAdmissions += await db.checkIn.count({ where: { eventId: { in: ids }, exceptionId: { not: null } } });
  }
  return q;
}
export { LIVE_STATUSES };

// ---------------------------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------------------------
export const EXPORT_TIMEOUT_MS = () => Number(process.env.ML_EXPORT_TIMEOUT_MS || 3_600_000);

/** Runs fn(tx) in ONE read-only REPEATABLE READ transaction: every read sees the same database snapshot. */
export async function withSnapshot(fn, db = prisma) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return fn(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: EXPORT_TIMEOUT_MS(), maxWait: 60_000 });
}

/**
 * Builds all datasets. `now`: export moment (only records and outcomes before it are used).
 * `sink`: where rows go ({ open(name, columns), write(name, row) }); by default they are kept in memory and
 * returned as { datasets, datasetsStep5 }. `snapshot` (default true with the app's database): one consistent
 * read-only snapshot for the whole export. Returns { datasets?, datasetsStep5?, events, report }.
 */
export async function buildExport({ db = prisma, policy = exportPolicy(), now = new Date(), sink = null, snapshot = true } = {}) {
  if (snapshot && db === prisma) return withSnapshot((tx) => run({ db: tx, policy, now, sink, consistent: true }), db);
  return run({ db, policy, now, sink, consistent: false });
}

async function run({ db, policy, now, sink, consistent }) {
  const memory = sink ? null : new MemorySink();
  const s = sink || memory;
  const ctx = await loadContext(db, now, policy);
  ctx.policy = policy;
  const visits = await exportVisits(db, ctx, now, s);
  const fraud = await exportFraud(db, ctx, now, s);
  const demand = await exportDemand(db, ctx, now, s);
  const attendance = await exportAttendance(db, ctx, now, s);
  const crowd = await exportCrowd(db, ctx, now, s);
  const checkouts = await exportCheckouts(db, ctx, now, s);
  const hourly = await exportDemandHourly(db, ctx, now, s);
  const recs = await exportRecommendations(db, ctx, now, s);
  const behaviour = await exportCustomerBehaviour(db, ctx, now, s);
  const events = [...ctx.eventById.values()].filter((e) => ctx.usedEvents.has(pseudo('E', e.id))).map((e) => {
    const k = pseudo('E', e.id);
    const known = ctx.eventTimes.get(k) || {};
    return { event_id: k, sales_open: iso(known.sales_open || salesOpenOf(e)), event_start: iso(known.event_start || startOf(e)) };
  });
  const main = { behavior_sequences: visits, fraud_purchases: fraud, event_demand: demand, attendance_no_show: attendance, crowd_flow: crowd };
  const step5 = { checkout_abandonment: checkouts, demand_hourly: hourly, recommendation_impressions: recs, customer_behaviour: behaviour };
  const report = {
    exportedAt: now.toISOString(),
    policy: { testDomains: policy.testDomains, internalDomains: policy.internalDomains, excludedUsers: policy.excludeUserIds.size, excludedEvents: policy.excludeEventIds.size, genuineFrom: policy.genuineFrom ? iso(policy.genuineFrom) : null },
    payments: { liveVerifiedOrders: ctx.evidence.size, firstLiveVerifiedPayment: ctx.firstPayment ? iso(ctx.firstPayment) : null },
    genuineUse: { start: ctx.firstLive ? iso(ctx.firstLive) : null, source: ctx.genuineFrom ? 'ML_GENUINE_FROM' : ctx.firstPayment ? 'first live-verified payment' : 'not started' },
    consistentSnapshot: consistent,
    datasets: Object.fromEntries(Object.entries(main).map(([k, v]) => [k, { ...v.out.tally.toJSON(), labels: v.out.check.labelStats(), problems: v.out.check.problems() }])),
    datasetsStep5: Object.fromEntries(Object.entries(step5).map(([k, v]) => [k, { ...v.out.tally.toJSON(), problems: v.out.check.problems() }])),
    checkoutOutcomes: checkouts.outcomes,
    attendanceQuality: await attendanceQuality(db, ctx, now),
    fraudLabels: fraud.quality,
    interventions: visits.interventions,
    crowdReadiness: crowd.readiness,
    deployedModels: ctx.deployedModels,
    country: COUNTRY,
    containsTestData: false,
    sourceClass: 'GENUINE_CUSTOMER',
  };
  // Every row kept is GENUINE_CUSTOMER; every row left out is counted under its data-source class
  const excludedByClass = {};
  for (const d of [...Object.values(report.datasets), ...Object.values(report.datasetsStep5)]) {
    for (const [reason, n] of Object.entries(d.excluded)) {
      const c = sourceClassOfReason(reason);
      excludedByClass[c] = (excludedByClass[c] || 0) + n;
    }
  }
  report.excludedBySourceClass = excludedByClass;
  if (!memory) return { events, report };
  const pick = (names) => Object.fromEntries(names.map((n) => [n, memory.data[n]]));
  return { datasets: pick(Object.keys(COLUMNS)), datasetsStep5: pick(Object.keys(COLUMNS_STEP5)), events, report };
}
