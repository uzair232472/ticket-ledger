/**
 * Training-data exporter: the five datasets of apps/ml-service/data/README.md, built from the app's own
 * tables, for retraining on the client's real data.
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
 *   - Test, seed and internal records are left out (dataPolicy.js), and so is everything before the first
 *     live-verified payment ("did not buy" cannot be verified while no live payments were possible).
 *   - No future data: only records created before `now`; a row exists only once its label window has closed.
 *   - One row per id (duplicates counted and dropped); ids are pseudonymised.
 */
import { createHash } from 'node:crypto';
import prisma from '../../config/prisma.js';
import { COUNTRY, TIMEZONE, endOf, salesOpenOf, startOf } from './features.js';
import { SOLD, parseVisitId } from './visits.js';
import { SLOTS, crowdReadiness, entriesBySlot, parseSlotSubject } from './crowd.js';
import { effectiveReview } from './fraudReview.js';
import { accountExclusion, dataPolicy, eventExclusion } from './dataPolicy.js';
import { liveEvidence } from '../paymentEvidence.js';
import { INTEGRITY_VERSION } from './snapshotIntegrity.js';

export { accountExclusion, eventExclusion };
const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const CURRENCY = 'PKR';
/** A snapshot read later than this after its prediction moment is not a prediction-time snapshot. */
export const MAX_CAPTURE_LAG_MS = 2 * HOUR;
const RULE_FLAGS = ['SUSPICIOUS', 'CRITICAL_BOT'];

export const COLUMNS = {
  behavior_sequences: ['session_id', 'customer_id', 'event_id', 'ts', 'event_type', 'city', 'country', 'event_views', 'seat_selections',
    'checkout_started', 'session_duration_seconds', 'currency', 'ticket_price', 'ticket_price_rel', 'min_price', 'tier_count',
    'hours_since_sales_open', 'days_until_event', 'customer_prior_sessions', 'customer_prior_purchases', 'prior_sessions_this_event',
    'account_age_days', 'purchased_7d', 'checkout_abandoned', 'feature_source'],
  fraud_purchases: ['order_id', 'customer_id', 'event_id', 'ts', 'event_type', 'city', 'country', 'tickets_requested', 'currency',
    'total_amount', 'unit_price_rel', 'payment_method', 'checkout_duration_seconds', 'clicks_per_minute', 'rapid_seat_attempts',
    'time_on_seatmap_seconds', 'device_switches', 'account_age_days', 'customer_prior_orders', 'orders_last_24h', 'failed_payments_30d',
    'prior_resale_listings', 'hours_since_sales_open', 'is_fraud', 'sample_weight', 'rule_flag', 'rule_score', 'feature_source'],
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

/** Export policy = the shared data policy (dataPolicy.js). Payments need server evidence, not a setting. */
export const exportPolicy = (opts = {}, env = process.env) => dataPolicy(opts, env);

export const pseudo = (kind, id) => `${kind}${createHash('sha256').update(`ml-export:${kind}:${id}`).digest('hex').slice(0, 16)}`;
const iso = (d) => new Date(d).toISOString();

// ---------------------------------------------------------------------------------------------
class Tally {
  constructor() { this.kept = 0; this.excluded = {}; this.sources = {}; this.duplicates = 0; }
  skip(reason, n = 1) { this.excluded[reason] = (this.excluded[reason] || 0) + n; }
  keep(source) { this.kept += 1; this.sources[source] = (this.sources[source] || 0) + 1; }
  toJSON() { return { kept: this.kept, featureSources: this.sources, duplicatesDropped: this.duplicates, excluded: this.excluded }; }
}

class Rows {
  constructor(idOf, tally) { this.map = new Map(); this.idOf = idOf; this.tally = tally; }
  add(row, source = 'snapshot') {
    const id = this.idOf(row);
    if (this.map.has(id)) { this.tally.duplicates += 1; return; }
    this.map.set(id, { ...row, feature_source: source });
    this.tally.keep(source);
  }
  get rows() { return [...this.map.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)); }
}

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

// ---------------------------------------------------------------------------------------------
async function loadContext(db, now) {
  const [users, companies, events, evidence] = await Promise.all([
    db.user.findMany({ select: { id: true, email: true, role: true, createdAt: true } }),
    db.company.findMany({ select: { id: true, userId: true } }),
    db.event.findMany({
      select: {
        id: true, companyId: true, type: true, city: true, date: true, time: true, startsAt: true, endsAt: true, cancelledAt: true,
        salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true,
        gates: { select: { id: true, name: true, active: true, capacityPerHour: true } },
      },
    }),
    liveEvidence(db, now),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const ownerOf = new Map(companies.map((c) => [c.id, userById.get(c.userId)]));
  const eventById = new Map(events.filter((e) => e.createdAt < now).map((e) => [e.id, e]));
  const deployed = await db.mlModel.findMany({ where: { status: 'SHADOW' }, orderBy: { registeredAt: 'desc' }, select: { id: true, name: true, sha256: true, version: true, source: true } });
  const deployedModels = {};
  for (const m of deployed) if (!deployedModels[m.name]) deployedModels[m.name] = { sha256: m.sha256, version: m.version, source: m.source, modelId: m.id };
  const firstLive = [...evidence.values()].reduce((a, e) => (!a || e.at < a ? e.at : a), null);
  const evidenceOrders = await db.order.findMany({ where: { id: { in: [...evidence.keys()] } }, select: { userId: true, eventId: true } });
  const evidenceUsers = new Set(evidenceOrders.map((o) => o.userId));
  const evidenceEvents = new Set(evidenceOrders.map((o) => o.eventId));
  const eventTimes = new Map(); // pseudonymised event id -> {sales_open, event_start} (from snapshots where known)
  return { userById, ownerOf, eventById, deployedModels, evidence, evidenceUsers, evidenceEvents, firstLive, eventTimes };
}

/**
 * Why an account's activity is not GENUINE_CUSTOMER data (null = genuine). Beyond the test/internal policy, an
 * account counts only once genuine use has demonstrably begun: it has its own live, server-verified purchase,
 * or it was created after the platform's first live-verified payment. Accounts from before that (developers,
 * testers, demo users with ordinary e-mail domains) are INTERNAL_TEST, whatever their domain.
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
  // event was created after the platform's first live-verified payment)
  if (ctx.evidenceEvents.has(eventId)) return null;
  if (ctx.firstLive && e.createdAt >= ctx.firstLive) return null;
  return 'event from before genuine use began (no live-verified sale): internal test';
};
const snaps = (db, modelName, subjectType, now) => db.mlPrediction.findMany({
  where: { modelName, role: 'RULES', subjectType, asOf: { lt: now }, createdAt: { lt: now } },
  select: { subjectId: true, eventId: true, userId: true, features: true, output: true, asOf: true, score: true, decision: true },
});
const noteTimes = (ctx, eventId, c) => {
  const k = pseudo('E', eventId);
  const prev = ctx.eventTimes.get(k) || {};
  ctx.eventTimes.set(k, { sales_open: prev.sales_open || c?.sales_open, event_start: prev.event_start || c?.event_start });
};

// ---------------------------------------------------------------------------------------------
// behavior_sequences (intent + abandonment): logged visit snapshots
// ---------------------------------------------------------------------------------------------
async function exportVisits(db, ctx, now) {
  const t = new Tally();
  const out = new Rows((r) => r.session_id, t);
  const preds = await snaps(db, 'intent', 'VISIT', now);
  const userIds = [...new Set(preds.map((p) => parseVisitId(p.subjectId).userId))];
  const orders = await db.order.findMany({ where: { userId: { in: userIds }, createdAt: { lt: now } }, select: { id: true, userId: true, eventId: true, status: true, createdAt: true } });
  const reminders = await db.recoveryReminder.findMany({ where: { sentAt: { lt: now }, userId: { in: userIds } }, select: { userId: true, eventId: true, sentAt: true } });
  const interventions = { intentRowsWithReminderInWindow: 0, abandonmentRowsWithReminderInWindow: 0 };
  for (const p of preds) {
    const v = parseVisitId(p.subjectId);
    const why = accountClass(ctx, v.userId) || realEvent(ctx, v.eventId);
    if (why) { t.skip(why); continue; }
    const bad = snapshotProblem(p, ['ticket_price', 'min_price']);
    if (bad) { t.skip(bad); continue; }
    const weekEnd = new Date(v.start.getTime() + 7 * DAY);
    if (weekEnd > now) { t.skip('7-day purchase window not over yet'); continue; }
    if (!ctx.firstLive || v.start < ctx.firstLive) { t.skip('before the first server-verified live payment (a non-purchase cannot be verified)'); continue; }
    const mine = orders.filter((o) => o.userId === v.userId && o.eventId === v.eventId);
    const inWeek = mine.filter((o) => o.createdAt >= v.start && o.createdAt <= weekEnd);
    if (inWeek.some((o) => paidUnverified(ctx, o))) { t.skip('a purchase without live server-side payment evidence'); continue; }
    const f = p.features;
    let abandoned = -1;
    if (f.checkout_started) abandoned = mine.some((o) => o.createdAt >= v.start && o.createdAt <= p.asOf && verifiedPaid(ctx, o)) ? 0 : 1;
    const rem = reminders.filter((m) => m.userId === v.userId && m.eventId === v.eventId && m.sentAt >= v.start);
    if (rem.some((m) => m.sentAt <= weekEnd)) interventions.intentRowsWithReminderInWindow += 1;
    if (abandoned !== -1 && rem.some((m) => m.sentAt <= p.asOf)) interventions.abandonmentRowsWithReminderInWindow += 1;
    const c = p.output.context;
    out.add({
      session_id: pseudo('S', p.subjectId), customer_id: pseudo('C', v.userId), event_id: pseudo('E', v.eventId), ts: iso(p.asOf),
      ...f, currency: CURRENCY, ticket_price: c.ticket_price, min_price: c.min_price,
      purchased_7d: inWeek.some((o) => verifiedPaid(ctx, o)) ? 1 : 0, checkout_abandoned: abandoned,
    });
    noteTimes(ctx, v.eventId, null);
  }
  return { rows: out.rows, tally: t, interventions };
}

// ---------------------------------------------------------------------------------------------
// fraud_purchases: logged checkout snapshots + blind review labels, weighted by the sampling design
// ---------------------------------------------------------------------------------------------
async function exportFraud(db, ctx, now) {
  const t = new Tally();
  const out = new Rows((r) => r.order_id, t);
  const preds = await db.mlPrediction.findMany({
    where: { modelName: 'fraud', role: 'RULES', asOf: { lt: now }, createdAt: { lt: now } },
    select: { subjectType: true, subjectId: true, features: true, output: true, asOf: true, score: true, decision: true },
  });
  const blocked = preds.filter((p) => p.subjectType === 'CHECKOUT_ATTEMPT');
  const orderPreds = preds.filter((p) => p.subjectType === 'ORDER');
  const samples = new Map((await db.fraudSample.findMany({
    where: { orderId: { in: orderPreds.map((p) => p.subjectId) } },
    select: { orderId: true, selected: true, inclusionProbability: true, reviews: { where: { createdAt: { lt: now } }, select: { id: true, decision: true, createdAt: true, blind: true } } },
  })).map((s) => [s.orderId, s]));
  const orders = new Map((await db.order.findMany({
    where: { id: { in: orderPreds.map((p) => p.subjectId) } }, select: { id: true, userId: true, eventId: true, totalAmount: true, status: true },
  })).map((o) => [o.id, o]));
  const quality = { blockedCheckouts: blocked.length, blockedByRuleDecision: {}, notSampled: 0, sampledNotSelected: 0, unreviewed: 0, unresolved: 0, exposedOnly: 0, resolved: 0, disputed: 0 };
  const disputed = new Set((await db.auditLog.findMany({ where: { action: 'PAYMENT_DISPUTE', createdAt: { lt: now } }, select: { targetId: true } })).map((r) => r.targetId));
  for (const b of blocked) quality.blockedByRuleDecision[b.decision || 'none'] = (quality.blockedByRuleDecision[b.decision || 'none'] || 0) + 1;
  for (const p of orderPreds) {
    const order = orders.get(p.subjectId);
    if (!order) { t.skip('order deleted'); continue; }
    const why = accountClass(ctx, order.userId) || realEvent(ctx, order.eventId);
    if (why) { t.skip(why); continue; }
    if (!ctx.evidence.has(order.id)) { t.skip('no live server-side payment evidence'); continue; }
    if (disputed.has(order.id)) { quality.disputed += 1; t.skip('payment disputed (kept separate from fraud labels)'); continue; }
    const bad = snapshotProblem(p);
    if (bad) { t.skip(bad); continue; }
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
    out.add({
      order_id: pseudo('O', order.id), customer_id: pseudo('C', order.userId), event_id: pseudo('E', order.eventId), ts: iso(p.asOf),
      ...p.features, currency: CURRENCY, total_amount: Number(order.totalAmount),
      is_fraud: e.decision === 'CONFIRMED_FRAUD' ? 1 : 0, sample_weight: Math.round((1 / s.inclusionProbability) * 1e6) / 1e6,
      rule_flag: RULE_FLAGS.includes(p.decision) ? 1 : 0, rule_score: p.score,
    });
    noteTimes(ctx, order.eventId, null);
  }
  return { rows: out.rows, tally: t, quality };
}

// ---------------------------------------------------------------------------------------------
// event_demand: the snapshot read at sales open (or the latest forecast logged before it)
// ---------------------------------------------------------------------------------------------
const DEMAND_CONTEXT = ['min_price', 'avg_price', 'max_price', 'event_start', 'sales_open', 'organizer_id'];

async function exportDemand(db, ctx, now) {
  const t = new Tally();
  const out = new Rows((r) => r.event_id, t);
  const preds = [...await snaps(db, 'demand', 'EVENT_AT_SALES_OPEN', now), ...await snaps(db, 'demand', 'EVENT_FORECAST', now)];
  const byEvent = new Map();
  for (const p of preds) { if (!byEvent.has(p.eventId)) byEvent.set(p.eventId, []); byEvent.get(p.eventId).push(p); }
  for (const event of ctx.eventById.values()) {
    const why = realEvent(ctx, event.id);
    if (why) { t.skip(why); continue; }
    const list = byEvent.get(event.id) || [];
    const problems = list.map((p) => snapshotProblem(p, DEMAND_CONTEXT));
    const usable = list.filter((p, i) => !problems[i]);
    // A sales-open snapshot, else the latest forecast logged no later than sales open (as known then)
    const pick = usable.find((p) => p.subjectId === event.id)
      || usable.filter((p) => p.asOf <= new Date(p.output.context.sales_open)).sort((a, b) => b.asOf - a.asOf)[0];
    if (!pick) { t.skip(list.length ? problems.find(Boolean) || 'no snapshot at or before sales open' : 'no prediction-time snapshot'); continue; }
    const c = pick.output.context;
    const open = new Date(c.sales_open);
    const end = new Date(open.getTime() + 2 * DAY);
    if (end > now) { t.skip('first 48 hours not over yet'); continue; }
    if (!ctx.firstLive || open < ctx.firstLive) { t.skip('sales opened before the first server-verified live payment'); continue; }
    const orders = await db.order.findMany({ where: { eventId: event.id, createdAt: { lt: now }, tickets: { some: { createdAt: { gte: open, lt: end } } } }, select: { id: true, status: true, _count: { select: { tickets: true } } } });
    if (orders.some((o) => paidUnverified(ctx, o))) { t.skip('48-hour sales include payments without live server-side evidence'); continue; }
    const sold = await db.ticket.count({ where: { eventId: event.id, createdAt: { gte: open, lt: end }, orderId: { in: orders.filter((o) => verifiedPaid(ctx, o)).map((o) => o.id) } } });
    out.add({
      event_id: pseudo('E', event.id), organizer_id: pseudo('G', c.organizer_id), ts: iso(open), event_start: iso(c.event_start),
      timezone: c.timezone || TIMEZONE, currency: CURRENCY, min_price: c.min_price, avg_price: c.avg_price, max_price: c.max_price,
      ...pick.features, sales_48h: sold,
    });
    noteTimes(ctx, event.id, c);
  }
  return { rows: out.rows, tally: t };
}

// ---------------------------------------------------------------------------------------------
// attendance_no_show: ticket snapshots taken ~24 h before the start
// ---------------------------------------------------------------------------------------------
async function exportAttendance(db, ctx, now) {
  const t = new Tally();
  const out = new Rows((r) => r.ticket_id, t);
  const preds = await snaps(db, 'attendance', 'TICKET', now);
  const byEvent = new Map();
  for (const p of preds) { if (!byEvent.has(p.eventId)) byEvent.set(p.eventId, []); byEvent.get(p.eventId).push(p); }
  for (const [eventId, list] of byEvent) {
    const why = realEvent(ctx, eventId);
    if (why) { t.skip(why, list.length); continue; }
    const bad = list.map((p) => snapshotProblem(p, ['ticket_price', 'event_start', 'holder_id', 'event_tickets_sold'])).find(Boolean);
    if (bad) { t.skip(`event left out: ${bad}`, list.length); continue; }
    const start = new Date(list[0].output.context.event_start);
    const ev = ctx.eventById.get(eventId);
    if (Math.max(endOf(ev).getTime(), start.getTime() + 4 * HOUR) >= now.getTime()) { t.skip('event not finished yet', list.length); continue; }
    const tickets = new Map((await db.ticket.findMany({
      where: { id: { in: list.map((p) => p.subjectId) } },
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
      out.add({
        ticket_id: pseudo('T', x.id), customer_id: pseudo('C', c.holder_id), event_id: pseudo('E', eventId), ts: iso(p.asOf),
        event_start: iso(start), currency: CURRENCY, ticket_price: c.ticket_price, ...p.features,
        event_tickets_sold: c.event_tickets_sold, sample_weight: 1, checked_in: x.checkedInAt ? 1 : 0,
      });
    }
    noteTimes(ctx, eventId, { event_start: start.toISOString() });
  }
  return { rows: out.rows, tally: t };
}

// ---------------------------------------------------------------------------------------------
// crowd_flow: gate x slot snapshots taken before the event
// ---------------------------------------------------------------------------------------------
async function exportCrowd(db, ctx, now) {
  const t = new Tally();
  const out = new Rows((r) => `${r.gate_id}|${r.ts}`, t);
  const preds = await snaps(db, 'crowd', 'GATE_SLOT', now);
  const byEvent = new Map();
  for (const p of preds) { if (!byEvent.has(p.eventId)) byEvent.set(p.eventId, []); byEvent.get(p.eventId).push(p); }
  const readiness = { snapshotted: byEvent.size, finishedWithoutSnapshot: {} };
  for (const event of ctx.eventById.values()) {
    if (byEvent.has(event.id) || startOf(event).getTime() + DAY > now.getTime() || realEvent(ctx, event.id)) continue;
    const r = crowdReadiness(event.gates);
    const reason = r.ready ? 'not scored before it started' : r.reason === 'NO_ACTIVE_GATES' ? 'no active gates' : 'gate capacity per hour missing';
    readiness.finishedWithoutSnapshot[reason] = (readiness.finishedWithoutSnapshot[reason] || 0) + 1;
    t.skip(`no snapshot: ${reason}`);
  }
  for (const [eventId, list] of byEvent) {
    const why = realEvent(ctx, eventId);
    if (why) { t.skip(why); continue; }
    const bad = list.map((p) => snapshotProblem(p, ['event_start'])).find(Boolean);
    if (bad) { t.skip(bad); continue; }
    const start = new Date(list[0].output.context.event_start);
    if (start.getTime() + DAY > now.getTime()) { t.skip('event not finished yet'); continue; }
    const perGate = new Map();
    for (const p of list) { const { gateId, minutes } = parseSlotSubject(p.subjectId); if (!perGate.has(gateId)) perGate.set(gateId, new Map()); perGate.get(gateId).set(minutes, p); }
    if ([...perGate.values()].some((m) => SLOTS.some((s) => !m.has(s)))) { t.skip('incomplete snapshot (missing slots)'); continue; }
    const orders = await db.order.findMany({ where: { eventId, status: { in: SOLD }, createdAt: { lt: now } }, select: { id: true, status: true } });
    if (!orders.length) { t.skip('no tickets sold'); continue; }
    if (orders.some((o) => paidUnverified(ctx, o))) { t.skip('event has tickets without live server-side payment evidence'); continue; }
    for (const [gateId, slots] of perGate) {
      const counts = await entriesBySlot(eventId, start, gateId);
      for (const m of SLOTS) {
        const f = slots.get(m).features;
        out.add({
          event_id: pseudo('E', eventId), gate_id: pseudo('Q', gateId), ts: iso(start.getTime() + m * 60_000), minutes_from_start: m,
          event_type: f.event_type, city: f.city, country: f.country, day_of_week: f.day_of_week, start_hour: f.start_hour,
          tickets_sold: f.tickets_sold, gate_count: f.gate_count, gate_capacity_per_hour: f.gate_capacity_per_hour, scans: counts[(m + 90) / 5],
        });
      }
    }
    noteTimes(ctx, eventId, { event_start: start.toISOString() });
  }
  return { rows: out.rows, tally: t, readiness };
}

// ---------------------------------------------------------------------------------------------
const LABEL = { behavior_sequences: ['purchased_7d', 'checkout_abandoned'], fraud_purchases: ['is_fraud'], event_demand: ['sales_48h'], attendance_no_show: ['checked_in'], crowd_flow: ['scans'] };
const NULLABLE = { event_demand: new Set(['organizer_past_sell_through_48h']), fraud_purchases: new Set(['rule_score']) };

export function checkRows(name, rows) {
  const problems = [];
  const cols = COLUMNS[name];
  rows.forEach((r, i) => {
    for (const c of cols) {
      const v = r[c];
      if ((v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) && !NULLABLE[name]?.has(c)) problems.push(`row ${i}: ${c} missing`);
    }
    const extra = Object.keys(r).filter((k) => !cols.includes(k));
    if (extra.length) problems.push(`row ${i}: unexpected ${extra.join(', ')}`);
    if (r.feature_source !== 'snapshot') problems.push(`row ${i}: not from a prediction-time snapshot`);
  });
  for (const l of LABEL[name]) {
    const bad = rows.filter((r) => (l === 'checkout_abandoned' ? ![-1, 0, 1].includes(r[l]) : ['sales_48h', 'scans'].includes(l) ? !(Number.isInteger(r[l]) && r[l] >= 0) : ![0, 1].includes(r[l])));
    if (bad.length) problems.push(`${bad.length} row(s) with an invalid ${l}`);
  }
  return problems.slice(0, 20);
}

function labelStats(name, rows) {
  const s = {};
  for (const l of LABEL[name]) {
    const vals = rows.map((r) => r[l]).filter((v) => v !== -1);
    if (['sales_48h', 'scans'].includes(l)) s[l] = { rows: vals.length, total: vals.reduce((a, b) => a + b, 0), mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
    else s[l] = { rows: vals.length, positives: vals.filter((v) => v === 1).length, rate: vals.length ? vals.filter((v) => v === 1).length / vals.length : null };
  }
  return s;
}

/**
 * Builds all five datasets. Returns { datasets: {name: rows}, events: [...], report } - nothing is written.
 * `now`: export moment (only records and outcomes before it are used).
 */
export async function buildExport({ db = prisma, policy = exportPolicy(), now = new Date() } = {}) {
  const ctx = await loadContext(db, now);
  ctx.policy = policy;
  const visits = await exportVisits(db, ctx, now);
  const fraud = await exportFraud(db, ctx, now);
  const demand = await exportDemand(db, ctx, now);
  const attendance = await exportAttendance(db, ctx, now);
  const crowd = await exportCrowd(db, ctx, now);
  const checkouts = await exportCheckouts(db, ctx, now);
  const hourly = await exportDemandHourly(db, ctx, now);
  const recs = await exportRecommendations(db, ctx, now);
  const behaviour = await exportCustomerBehaviour(db, ctx, now);
  const datasets = { behavior_sequences: visits.rows, fraud_purchases: fraud.rows, event_demand: demand.rows, attendance_no_show: attendance.rows, crowd_flow: crowd.rows };
  const datasetsStep5 = { checkout_abandonment: checkouts.rows, demand_hourly: hourly.rows, recommendation_impressions: recs.rows, customer_behaviour: behaviour.rows };
  const used = new Set([...Object.values(datasets), checkouts.rows, hourly.rows, recs.rows].flatMap((rows) => rows.map((r) => r.event_id)));
  const events = [...ctx.eventById.values()].filter((e) => used.has(pseudo('E', e.id))).map((e) => {
    const k = pseudo('E', e.id);
    const known = ctx.eventTimes.get(k) || {};
    return { event_id: k, sales_open: iso(known.sales_open || salesOpenOf(e)), event_start: iso(known.event_start || startOf(e)) };
  });
  const report = {
    exportedAt: now.toISOString(),
    policy: { testDomains: policy.testDomains, internalDomains: policy.internalDomains, excludedUsers: policy.excludeUserIds.size, excludedEvents: policy.excludeEventIds.size },
    payments: { liveVerifiedOrders: ctx.evidence.size, firstLiveVerifiedPayment: ctx.firstLive ? iso(ctx.firstLive) : null },
    datasets: Object.fromEntries(Object.entries({ behavior_sequences: visits, fraud_purchases: fraud, event_demand: demand, attendance_no_show: attendance, crowd_flow: crowd })
      .map(([k, v]) => [k, { ...v.tally.toJSON(), labels: labelStats(k, v.rows), problems: checkRows(k, v.rows) }])),
    datasetsStep5: Object.fromEntries(Object.entries({ checkout_abandonment: checkouts, demand_hourly: hourly, recommendation_impressions: recs, customer_behaviour: behaviour })
      .map(([k, v]) => [k, { ...v.tally.toJSON(), problems: checkRowsStep5(k, v.rows) }])),
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
  return { datasets, datasetsStep5, events, report };
}

// =============================================================================================
// Step 5 datasets: checkout abandonment (agreed definition), post-publication hourly demand,
// recommendation impressions (with control group), customer behaviour, attendance quality
// =============================================================================================
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
// Columns that may be empty
const NULLABLE_STEP5 = { demand_hourly: new Set(['organizer_past_sell_through_48h']) };

/** Data-source class of an exclusion reason (everything kept is GENUINE_CUSTOMER). */
export function sourceClassOfReason(reason) {
  if (/internal test|test e-mail|internal e-mail|not a customer|test organizer|internal organizer|excluded (account|event)|MOCK|live (server-side )?payment|live method|live-verified|server-verified|holder is a|before genuine use began/i.test(reason)) return 'INTERNAL_TEST';
  return 'DATA_QUALITY';
}

async function auditMap(db, action, now) {
  const rows = await db.auditLog.findMany({ where: { action, createdAt: { lt: now } }, select: { targetId: true, details: true, createdAt: true } });
  const m = new Map();
  for (const r of rows) if (!m.has(r.targetId)) m.set(r.targetId, r);
  return m;
}

async function exportCheckouts(db, ctx, now) {
  const { checkoutAbandonmentLabel, ABANDON_OUTCOME_WINDOW_MS } = await import('./labels.js');
  const t = new Tally();
  const out = new Rows((r) => r.order_id, t);
  const preds = await snaps(db, 'checkout_abandonment', 'ORDER', now);
  const ends = await auditMap(db, 'CHECKOUT_ENDED', now);
  const orders = new Map((await db.order.findMany({ where: { id: { in: preds.map((p) => p.subjectId) } }, select: { id: true, userId: true, eventId: true, status: true, createdAt: true } })).map((o) => [o.id, o]));
  const failed = new Set((await db.behaviorEvent.findMany({ where: { action: 'payment_failed', createdAt: { lt: now } }, select: { metadata: true } })).map((b) => b.metadata?.orderId).filter(Boolean));
  const reasons = {};
  for (const p of preds) {
    const o = orders.get(p.subjectId);
    if (!o) { t.skip('order deleted'); continue; }
    const why = accountClass(ctx, o.userId) || realEvent(ctx, o.eventId);
    if (why) { t.skip(why); continue; }
    const bad = snapshotProblem(p);
    if (bad) { t.skip(bad); continue; }
    if (!ctx.firstLive || o.createdAt < ctx.firstLive) { t.skip('before the first server-verified live payment (an unpaid checkout cannot be verified)'); continue; }
    if (SOLD.includes(o.status) && !ctx.evidence.has(o.id)) { t.skip('paid without live server-side payment evidence'); continue; }
    const windowEnd = new Date(o.createdAt.getTime() + ABANDON_OUTCOME_WINDOW_MS);
    const later = await db.order.findMany({ where: { userId: o.userId, eventId: o.eventId, id: { not: o.id }, createdAt: { gte: o.createdAt, lte: windowEnd, lt: now } }, select: { id: true, status: true } });
    if (later.some((x) => paidUnverified(ctx, x))) { t.skip('a purchase in the window without live server-side evidence'); continue; }
    const { label, reason } = checkoutAbandonmentLabel({
      order: { status: o.status, createdAt: o.createdAt, paid: verifiedPaid(ctx, o) }, endReason: ends.get(o.id)?.details?.reason ?? null,
      paymentFailed: failed.has(o.id), boughtInWindow: later.some((x) => verifiedPaid(ctx, x)), now,
    });
    reasons[reason] = (reasons[reason] || 0) + 1;
    if (label === null) { t.skip(`no abandonment label: ${reason}`); continue; }
    out.add({ order_id: pseudo('O', o.id), customer_id: pseudo('C', o.userId), event_id: pseudo('E', o.eventId), ts: iso(p.asOf), ...p.features, abandoned: label });
    noteTimes(ctx, o.eventId, null);
  }
  return { rows: out.rows, tally: t, outcomes: reasons };
}

async function exportDemandHourly(db, ctx, now) {
  const { DEMAND_HOURLY_HORIZON_MS } = await import('./labels.js');
  const t = new Tally();
  const out = new Rows((r) => `${r.event_id}|${r.ts}`, t);
  const preds = await snaps(db, 'demand_hourly', 'EVENT_HOURLY', now);
  for (const p of preds) {
    const why = realEvent(ctx, p.eventId);
    if (why) { t.skip(why); continue; }
    const bad = snapshotProblem(p, ['organizer_id', 'event_start']);
    if (bad) { t.skip(bad); continue; }
    const end = new Date(p.asOf.getTime() + DEMAND_HOURLY_HORIZON_MS);
    if (end > now) { t.skip('24-hour horizon not over yet'); continue; }
    if (!ctx.firstLive || p.asOf < ctx.firstLive) { t.skip('before the first server-verified live payment'); continue; }
    const orders = await db.order.findMany({ where: { eventId: p.eventId, createdAt: { lt: now }, tickets: { some: { createdAt: { gte: p.asOf, lt: end } } } }, select: { id: true, status: true } });
    if (orders.some((o) => paidUnverified(ctx, o))) { t.skip('sales in the horizon without live server-side evidence'); continue; }
    const sold = await db.ticket.count({ where: { eventId: p.eventId, createdAt: { gte: p.asOf, lt: end }, orderId: { in: orders.filter((o) => verifiedPaid(ctx, o)).map((o) => o.id) } } });
    const f = p.features;
    out.add({
      event_id: pseudo('E', p.eventId), organizer_id: pseudo('G', p.output.context.organizer_id), ts: iso(p.asOf),
      ...Object.fromEntries(COLUMNS_STEP5.demand_hourly.filter((c) => c in f).map((c) => [c, f[c]])),
      rule_next_24h: p.score ?? f.sold_last_24h, sales_next_24h: sold,
    });
    noteTimes(ctx, p.eventId, p.output.context);
  }
  return { rows: out.rows, tally: t };
}

async function exportRecommendations(db, ctx, now) {
  const { REC_ATTRIBUTION_MS, REC_CLICK_WINDOW_MS } = await import('./labels.js');
  const t = new Tally();
  const out = new Rows((r) => `${r.list_id}|${r.event_id}`, t);
  const lists = await db.behaviorEvent.findMany({ where: { action: 'recommendation_impression', createdAt: { lt: now } }, select: { userId: true, createdAt: true, metadata: true } });
  const clicks = await db.behaviorEvent.findMany({ where: { action: 'recommendation_click', createdAt: { lt: now } }, select: { eventId: true, createdAt: true, metadata: true } });
  const clickKey = new Set(clicks.map((c) => `${c.metadata?.listId}|${c.eventId}`));
  const clickAt = new Map(clicks.map((c) => [`${c.metadata?.listId}|${c.eventId}`, c.createdAt]));
  const purchased = new Map();
  for (const l of lists) {
    const m = l.metadata || {};
    if (!l.userId) { t.skip('anonymous visitor never linked to an account (cannot be shown to be genuine)', (m.items || []).length || 1); continue; }
    const why = accountClass(ctx, l.userId);
    if (why) { t.skip(why, (m.items || []).length || 1); continue; }
    const attrEnd = new Date(l.createdAt.getTime() + REC_ATTRIBUTION_MS);
    const done = attrEnd <= now;
    if (!purchased.has(l.userId)) purchased.set(l.userId, await db.order.findMany({ where: { userId: l.userId, createdAt: { lt: now } }, select: { id: true, eventId: true, status: true, createdAt: true } }));
    const userOrders = purchased.get(l.userId);
    const firstTime = !userOrders.some((o) => o.createdAt < l.createdAt && verifiedPaid(ctx, o));
    for (const it of m.items || []) {
      const ev = realEvent(ctx, it.eventId);
      if (ev) { t.skip(ev); continue; }
      const k = `${m.listId}|${it.eventId}`;
      const clicked = clickKey.has(k) && clickAt.get(k) - l.createdAt <= REC_CLICK_WINDOW_MS ? 1 : 0;
      const inWindow = userOrders.filter((o) => o.eventId === it.eventId && o.createdAt >= l.createdAt && o.createdAt <= attrEnd);
      let bought = -1; // unknown: window open, or no live payments possible yet
      if (done && ctx.firstLive && l.createdAt >= ctx.firstLive && !inWindow.some((o) => paidUnverified(ctx, o))) bought = inWindow.some((o) => verifiedPaid(ctx, o)) ? 1 : 0;
      out.add({
        list_id: pseudo('L', m.listId), customer_id: pseudo('C', l.userId), event_id: pseudo('E', it.eventId), ts: iso(l.createdAt),
        variant: m.variant, basis: m.basis, surface: m.surface, position: it.position, popularity_rank: it.popularityRank,
        exploration: it.exploration ? 1 : 0, is_new_event: it.isNew ? 1 : 0, first_time: firstTime ? 1 : 0, clicked, purchased_7d: bought,
      }, 'impression-log');
    }
  }
  return { rows: out.rows, tally: t };
}

async function exportCustomerBehaviour(db, ctx, now) {
  const t = new Tally();
  const out = new Rows((r) => r.customer_id, t);
  const users = [...ctx.userById.values()];
  for (const u of users) {
    const why = accountClass(ctx, u.id);
    if (why) { if (u.role === 'CUSTOMER') t.skip(why); continue; }
    const [acts, orders] = await Promise.all([
      db.behaviorEvent.findMany({ where: { userId: u.id, createdAt: { lt: now } }, select: { action: true, eventId: true, createdAt: true } }),
      db.order.findMany({ where: { userId: u.id, createdAt: { lt: now } }, select: { id: true, status: true, eventId: true, totalAmount: true, createdAt: true, _count: { select: { tickets: true } } } }),
    ]);
    if (!acts.length && !orders.length) { t.skip('no activity'); continue; }
    const paid = orders.filter((o) => verifiedPaid(ctx, o) && !realEvent(ctx, o.eventId));
    const cats = {};
    for (const o of paid) { const e = ctx.eventById.get(o.eventId); if (e) cats[e.type] = (cats[e.type] || 0) + 1; }
    const times = acts.map((a) => a.createdAt).sort((a, b) => a - b);
    const sessions = new Set(acts.filter((a) => a.eventId).map((a) => `${a.eventId}|${Math.floor(a.createdAt / (30 * 60_000))}`)).size;
    const pt = paid.map((o) => o.createdAt).sort((a, b) => a - b);
    out.add({
      customer_id: pseudo('C', u.id), first_seen: times.length ? iso(times[0]) : iso(orders[0].createdAt), last_seen: times.length ? iso(times.at(-1)) : iso(orders.at(-1).createdAt),
      visits: sessions, events_viewed: new Set(acts.filter((a) => a.action === 'event_view').map((a) => a.eventId)).size,
      searches: acts.filter((a) => a.action === 'search').length, wishlists: acts.filter((a) => a.action === 'wishlist_added').length,
      verified_orders: paid.length, verified_tickets: paid.reduce((n, o) => n + o._count.tickets, 0),
      verified_spend: Math.round(paid.reduce((n, o) => n + Number(o.totalAmount), 0) * 100) / 100,
      categories_bought: Object.keys(cats).length, top_category: Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NONE',
      repeat_customer: paid.length > 1 ? 1 : 0, days_first_to_last_purchase: pt.length > 1 ? Math.round((pt.at(-1) - pt[0]) / DAY * 10) / 10 : 0,
      recommendation_clicks: acts.filter((a) => a.action === 'recommendation_click').length,
    }, 'aggregate');
  }
  return { rows: out.rows, tally: t };
}

/** Attendance data quality for finished real events: sold, refunded, valid attendance, no-shows, late, corrected. */
async function attendanceQuality(db, ctx, now) {
  const { LATE_CHECKIN_MS } = await import('./labels.js');
  const q = { events: 0, ticketsSold: 0, refundedOrCancelled: 0, attended: 0, noShows: 0, lateCheckIns: 0, correctedCheckIns: 0, exceptionAdmissions: 0 };
  for (const e of ctx.eventById.values()) {
    if (realEvent(ctx, e.id) || endOf(e) >= now) continue;
    const tickets = await db.ticket.findMany({ where: { eventId: e.id, createdAt: { lt: now } }, select: { status: true, checkedInAt: true } });
    if (!tickets.length) continue;
    q.events += 1;
    q.ticketsSold += tickets.length;
    const live = tickets.filter((x) => LIVE_STATUSES.includes(x.status));
    q.refundedOrCancelled += tickets.length - live.length;
    q.attended += live.filter((x) => x.checkedInAt).length;
    q.noShows += live.filter((x) => !x.checkedInAt).length;
    q.lateCheckIns += live.filter((x) => x.checkedInAt && x.checkedInAt - startOf(e) > LATE_CHECKIN_MS).length;
    q.correctedCheckIns += await db.checkIn.count({ where: { eventId: e.id, reversedAt: { not: null } } });
    q.exceptionAdmissions += await db.checkIn.count({ where: { eventId: e.id, exceptionId: { not: null } } });
  }
  return q;
}
const LIVE_STATUSES = ['ACTIVE', 'SCANNED'];

export function checkRowsStep5(name, rows) {
  const cols = COLUMNS_STEP5[name];
  const problems = [];
  rows.forEach((r, i) => {
    for (const c of cols) {
      const v = r[c];
      if ((v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) && !NULLABLE_STEP5[name]?.has(c)) problems.push(`row ${i}: ${c} missing`);
    }
    const extra = Object.keys(r).filter((k) => !cols.includes(k));
    if (extra.length) problems.push(`row ${i}: unexpected ${extra.join(', ')}`);
  });
  return problems.slice(0, 20);
}
