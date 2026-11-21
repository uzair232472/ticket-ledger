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
  add(row) {
    const id = this.idOf(row);
    if (this.map.has(id)) { this.tally.duplicates += 1; return; }
    this.map.set(id, { ...row, feature_source: 'snapshot' });
    this.tally.keep('snapshot');
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
  if (c.exact !== true) {
    const why = String(c.integrity?.reason || '');
    return why.startsWith('inputs changed') ? 'not exact: event inputs changed after the prediction moment' : `not exact: ${why.split(':')[0] || 'unknown'}`;
  }
  if (!need.length) return null;
  if (!c || need.some((k) => c[k] === undefined || c[k] === null)) return 'snapshot without prediction-time prices / capacity / start (logged before they were stored)';
  if (c.captured_at && new Date(c.captured_at) - p.asOf > MAX_CAPTURE_LAG_MS) return 'snapshot read too long after the prediction moment';
  return null;
}

// ---------------------------------------------------------------------------------------------
async function loadContext(db, now) {
  const [users, companies, events, evidence] = await Promise.all([
    db.user.findMany({ select: { id: true, email: true, role: true } }),
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
  const eventTimes = new Map(); // pseudonymised event id -> {sales_open, event_start} (from snapshots where known)
  return { userById, ownerOf, eventById, deployedModels, evidence, firstLive, eventTimes };
}

const verifiedPaid = (ctx, o) => SOLD.includes(o.status) && ctx.evidence.has(o.id);
const paidUnverified = (ctx, o) => SOLD.includes(o.status) && !ctx.evidence.has(o.id);
const realEvent = (ctx, eventId) => { const e = ctx.eventById.get(eventId); return eventExclusion(e, e && ctx.ownerOf.get(e.companyId), ctx.policy); };
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
    const why = accountExclusion(ctx.userById.get(v.userId), ctx.policy) || realEvent(ctx, v.eventId);
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
  const quality = { blockedCheckouts: blocked.length, blockedByRuleDecision: {}, notSampled: 0, sampledNotSelected: 0, unreviewed: 0, unresolved: 0, exposedOnly: 0, resolved: 0 };
  for (const b of blocked) quality.blockedByRuleDecision[b.decision || 'none'] = (quality.blockedByRuleDecision[b.decision || 'none'] || 0) + 1;
  for (const p of orderPreds) {
    const order = orders.get(p.subjectId);
    if (!order) { t.skip('order deleted'); continue; }
    const why = accountExclusion(ctx.userById.get(order.userId), ctx.policy) || realEvent(ctx, order.eventId);
    if (why) { t.skip(why); continue; }
    if (!ctx.evidence.has(order.id)) { t.skip('no live server-side payment evidence'); continue; }
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
    const why = eventExclusion(event, ctx.ownerOf.get(event.companyId), ctx.policy);
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
      const holderWhy = accountExclusion(ctx.userById.get(p.output.context.holder_id), ctx.policy);
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
    if (byEvent.has(event.id) || startOf(event).getTime() + DAY > now.getTime() || eventExclusion(event, ctx.ownerOf.get(event.companyId), ctx.policy)) continue;
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
  const datasets = { behavior_sequences: visits.rows, fraud_purchases: fraud.rows, event_demand: demand.rows, attendance_no_show: attendance.rows, crowd_flow: crowd.rows };
  const used = new Set(Object.values(datasets).flatMap((rows) => rows.map((r) => r.event_id)));
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
    fraudLabels: fraud.quality,
    interventions: visits.interventions,
    crowdReadiness: crowd.readiness,
    deployedModels: ctx.deployedModels,
    country: COUNTRY,
    containsTestData: false,
  };
  return { datasets, events, report };
}
