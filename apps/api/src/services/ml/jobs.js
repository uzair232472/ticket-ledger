/**
 * Background ML jobs (every 15 minutes, server.js). All are idempotent: the database allows one
 * prediction per (model, role, subject) and one fraud sample per order, so re-runs and several API
 * servers running at once add nothing twice. None of them changes orders, tickets, payments, accounts
 * or gate admission.
 *
 *   scoreVisits        intent (every finished visit) + abandonment (visits that reached checkout)
 *   scoreCrowd         gate x 5-minute slots, once per event, 30 min - 26 h before it starts
 *   snapshotDemand     every event's demand inputs within an hour after its sales open
 *   snapshotAttendance every live ticket's attendance inputs ~24 h before its event
 * Every row stores its exact inputs and, in output.context, the raw values training needs (captured_at = when
 * they were read), so training never rebuilds them from current values.
 *   sampleFraudOrders  places every scored order in a detector cell and picks the blind review sample
 *   attachOutcomes     writes the real outcome onto predictions once it is known (outcome learning)
 */
import { createHash } from 'node:crypto';
import prisma from '../../config/prisma.js';
import { ATTENDANCE_LEAD_MS, LIVE_TICKET, MissingInput, attendanceSnapshot, demandHourlySnapshot, demandSnapshot, endOf, salesOpenOf, startOf } from './features.js';
import { logPredictions, snapshotsEnabled } from './shadow.js';
import { finishedVisits, intentRule, parseVisitId, SOLD, visitFeatures, visitId, visitPrice } from './visits.js';
import { showRate } from './attendanceBaseline.js';
import { ABANDON_OUTCOME_WINDOW_MS, DEMAND_HOURLY_HORIZON_MS, checkoutAbandonmentLabel } from './labels.js';
import { arrivalHistory, crowdRows, entriesBySlot, parseSlotSubject, slotSubject } from './crowd.js';
import { effectiveReview } from './fraudReview.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const count = (map, key) => { map[key] = (map[key] || 0) + 1; };

// ---------------------------------------------------------------------------------------------
export async function scoreVisits({ now = new Date(), lookbackHours = 48 } = {}) {
  const found = await finishedVisits({ now, lookbackHours });
  const ids = found.map((f) => visitId(f.userId, f.visit));
  const done = new Set((await prisma.mlPrediction.findMany({
    where: { modelName: 'intent', role: 'RULES', subjectType: 'VISIT', subjectId: { in: ids } }, select: { subjectId: true },
  })).map((r) => r.subjectId));
  const events = new Map();
  const getEvent = async (id) => {
    if (!events.has(id)) {
      events.set(id, await prisma.event.findUnique({
        where: { id }, select: { id: true, type: true, city: true, date: true, time: true, startsAt: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true, tiers: { select: { price: true } } },
      }));
    }
    return events.get(id);
  };
  const intent = [];
  const abandonment = [];
  const skipped = {};
  for (const f of found) {
    const id = visitId(f.userId, f.visit);
    if (done.has(id)) continue;
    let features;
    try {
      features = await visitFeatures({ ...f, event: await getEvent(f.visit.eventId) });
    } catch (e) {
      if (!(e instanceof MissingInput)) throw e;
      count(skipped, e.message);
      continue; // e.g. browsing after the event started: not a prediction the models make
    }
    const rule = intentRule(features);
    const orderIds = f.orders.filter((o) => o.eventId === f.visit.eventId && o.createdAt >= f.visit.start && o.createdAt <= f.visit.end).map((o) => o.id);
    const base = { subjectType: 'VISIT', subjectId: id, eventId: f.visit.eventId, userId: f.userId, asOf: f.visit.end };
    const { price, minPrice } = visitPrice(f.visit, await getEvent(f.visit.eventId));
    const context = { ticket_price: price, min_price: minPrice, captured_at: now.toISOString() };
    // Reference moment for the integrity check: the visit's start (the prices the customer saw)
    // Reference moments: the visit's start (prices the customer saw) and its end (typical price as of then)
    intent.push({ ...base, rule: { score: rule.score, decision: rule.decision, output: { orderIds } }, features, context, windowStart: f.visit.start, referenceAt: f.visit.end });
    if (features.checkout_started) {
      const { checkout_started: _c, ...af } = features;
      abandonment.push({ ...base, rule: { score: 100 - rule.score, decision: null, output: { orderIds } }, features: af, context, windowStart: f.visit.start, referenceAt: f.visit.end });
    }
  }
  return {
    visits: found.length, alreadyScored: done.size, skipped,
    intent: await logPredictions('intent', intent), abandonment: await logPredictions('abandonment', abandonment),
  };
}

// ---------------------------------------------------------------------------------------------
export async function scoreCrowd({ now = new Date() } = {}) {
  const events = (await prisma.event.findMany({
    where: { status: 'PUBLISHED', cancelledAt: null }, select: { id: true, date: true, time: true, startsAt: true },
  })).filter((e) => {
    const s = startOf(e).getTime();
    return s > now.getTime() + 30 * 60_000 && s <= now.getTime() + 26 * HOUR;
  });
  const scored = new Set((await prisma.mlPrediction.findMany({
    where: { modelName: 'crowd', role: 'RULES', eventId: { in: events.map((e) => e.id) } }, select: { eventId: true }, distinct: ['eventId'],
  })).map((r) => r.eventId));
  const todo = events.filter((e) => !scored.has(e.id));
  const skipped = {};
  const items = [];
  if (todo.length) {
    const history = await arrivalHistory(now);
    for (const e of todo) {
      let rows;
      try {
        rows = await crowdRows({ eventId: e.id, at: now, history });
      } catch (err) {
        if (!(err instanceof MissingInput)) throw err;
        count(skipped, err.message);
        continue;
      }
      for (const r of rows) {
        items.push({
          subjectType: 'GATE_SLOT', subjectId: slotSubject(r.gateId, r.minutes), eventId: e.id, asOf: now,
          rule: { score: r.baseline, decision: null, output: { basis: r.basis } }, features: r.features,
          context: { event_start: r.start.toISOString(), captured_at: now.toISOString() },
          referenceAt: null, // crowd inputs have no price-relative features
        });
      }
    }
  }
  return { upcoming: events.length, alreadyScored: scored.size, skipped, crowd: await logPredictions('crowd', items) };
}

// ---------------------------------------------------------------------------------------------
// Demand at sales open: inputs read within an hour after sales open (organizer history as of the open)
export async function snapshotDemand({ now = new Date(), windowMs = HOUR } = {}) {
  const events = (await prisma.event.findMany({
    where: { cancelledAt: null, tiers: { some: {} } },
    select: { id: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true },
  })).filter((e) => { const o = salesOpenOf(e).getTime(); return o <= now.getTime() && o > now.getTime() - windowMs; });
  const done = new Set((await prisma.mlPrediction.findMany({
    where: { modelName: 'demand', role: 'RULES', subjectType: 'EVENT_AT_SALES_OPEN', subjectId: { in: events.map((e) => e.id) } }, select: { subjectId: true },
  })).map((r) => r.subjectId));
  const skipped = {};
  const items = [];
  for (const e of events.filter((x) => !done.has(x.id))) {
    try {
      const { features, context } = await demandSnapshot({ eventId: e.id, at: salesOpenOf(e) });
      // Reference moment: sales open (prices and capacity must be unchanged since then)
      items.push({ subjectType: 'EVENT_AT_SALES_OPEN', subjectId: e.id, eventId: e.id, asOf: now, windowStart: salesOpenOf(e), rule: { score: null, decision: null, output: { trigger: 'sales_open' } }, features, context: { ...context, captured_at: now.toISOString() } });
    } catch (err) {
      if (!(err instanceof MissingInput)) throw err;
      count(skipped, err.message);
    }
  }
  return { opened: events.length, alreadyLogged: done.size, skipped, demand: await logPredictions('demand', items) };
}

// Demand after publication: one snapshot per event per hour while on sale (sales so far, pace, time left)
export async function snapshotDemandHourly({ now = new Date() } = {}) {
  const hour = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const events = (await prisma.event.findMany({
    where: { status: 'PUBLISHED', cancelledAt: null, tiers: { some: {} } },
    select: { id: true, date: true, time: true, startsAt: true, salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true },
  })).filter((e) => salesOpenOf(e) <= now && startOf(e) > now);
  const ids = events.map((e) => `${e.id}|${hour.toISOString()}`);
  const done = new Set((await prisma.mlPrediction.findMany({ where: { modelName: 'demand_hourly', role: 'RULES', subjectType: 'EVENT_HOURLY', subjectId: { in: ids } }, select: { subjectId: true } })).map((r) => r.subjectId));
  const skipped = {};
  const items = [];
  for (const e of events) {
    const subjectId = `${e.id}|${hour.toISOString()}`;
    if (done.has(subjectId)) continue;
    try {
      const { features, context } = await demandHourlySnapshot({ eventId: e.id, at: now });
      // Rule shown today: the last 24 hours' pace continues (naive persistence)
      items.push({ subjectType: 'EVENT_HOURLY', subjectId, eventId: e.id, asOf: now, rule: { score: features.sold_last_24h, decision: null, output: { basis: 'last-24h pace' } }, features, context: { ...context, captured_at: now.toISOString() } });
    } catch (err) {
      if (!(err instanceof MissingInput)) throw err;
      count(skipped, err.message);
    }
  }
  return { onSale: events.length, alreadyLogged: done.size, skipped, demandHourly: await logPredictions('demand_hourly', items) };
}

// Attendance ~24 h before the start: every live ticket of events starting 22-24 h from now
export async function snapshotAttendance({ now = new Date() } = {}) {
  const events = (await prisma.event.findMany({
    where: { cancelledAt: null }, select: { id: true, type: true, city: true, date: true, time: true, startsAt: true },
  })).filter((e) => { const s = startOf(e).getTime() - ATTENDANCE_LEAD_MS; return s <= now.getTime() && s > now.getTime() - 2 * HOUR; });
  const skipped = {};
  let logged = { rules: 0, shadow: 0, skipped: 0, errors: 0 };
  for (const e of events) {
    if (await prisma.mlPrediction.count({ where: { modelName: 'attendance', role: 'RULES', subjectType: 'TICKET', eventId: e.id } })) continue;
    const tickets = await prisma.ticket.findMany({ where: { eventId: e.id, status: { in: LIVE_TICKET }, createdAt: { lt: now } }, select: { id: true, userId: true } });
    const rate = await showRate(e, now);
    const items = [];
    for (const t of tickets) {
      try {
        const { features, context } = await attendanceSnapshot({ ticketId: t.id, at: now });
        items.push({
          subjectType: 'TICKET', subjectId: t.id, eventId: e.id, userId: context.holder_id, asOf: now,
          rule: { score: rate.rate / 100, decision: null, output: { basis: rate.basis } }, features,
          context: { ...context, event_tickets_sold: tickets.length, captured_at: now.toISOString() },
        });
      } catch (err) {
        if (!(err instanceof MissingInput)) throw err;
        count(skipped, err.message);
      }
    }
    const r = await logPredictions('attendance', items);
    logged = Object.fromEntries(Object.entries(logged).map(([k, v]) => [k, v + r[k]]));
  }
  return { events: events.length, skipped, attendance: logged };
}

// ---------------------------------------------------------------------------------------------
// Blind fraud review sampling
// ---------------------------------------------------------------------------------------------
export const reviewRates = () => ({
  RULE_AND_ML: Number(process.env.ML_REVIEW_RATE_RULE ?? 1),
  RULE_ONLY: Number(process.env.ML_REVIEW_RATE_RULE ?? 1),
  ML_ONLY: Number(process.env.ML_REVIEW_RATE_ML ?? 1),
  NEITHER: Number(process.env.ML_REVIEW_RATE_RANDOM ?? 0.02),
});
const RULE_FLAGS = ['SUSPICIOUS', 'CRITICAL_BOT'];

/** Deterministic uniform number in [0,1) from an id: the same order always gets the same draw. */
export const uniformFromId = (id) => parseInt(createHash('sha256').update(`fraud-sample:${id}`).digest('hex').slice(0, 12), 16) / 2 ** 48;

export function cellOf(ruleDecision, shadowDecision) {
  const r = RULE_FLAGS.includes(ruleDecision);
  const m = shadowDecision === 'WOULD_FLAG';
  return r && m ? 'RULE_AND_ML' : r ? 'RULE_ONLY' : m ? 'ML_ONLY' : 'NEITHER';
}

export async function sampleFraudOrders({ now = new Date(), settleMs = HOUR } = {}) {
  const cut = new Date(now - settleMs);
  const rows = await prisma.$queryRaw`
    SELECT r."subjectId" AS "orderId", r."id" AS "ruleId", r."score" AS "ruleScore", r."decision" AS "ruleDecision",
           s."id" AS "shadowId", s."score" AS "prob", s."decision" AS "shadowDecision", s."modelId" AS "modelId"
    FROM "MlPrediction" r
    JOIN "MlPrediction" s ON s."modelName" = 'fraud' AND s."role" = 'SHADOW' AND s."subjectType" = 'ORDER' AND s."subjectId" = r."subjectId"
    LEFT JOIN "FraudSample" f ON f."orderId" = r."subjectId"
    WHERE r."modelName" = 'fraud' AND r."role" = 'RULES' AND r."subjectType" = 'ORDER' AND r."asOf" < (${cut.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND f."id" IS NULL AND s."score" IS NOT NULL
    ORDER BY r."asOf" LIMIT 5000`;
  const rates = reviewRates();
  const data = rows.map((x) => {
    const cell = cellOf(x.ruleDecision, x.shadowDecision);
    const p = Math.min(1, Math.max(0, rates[cell]));
    return {
      orderId: x.orderId, cell, selected: uniformFromId(x.orderId) < p, inclusionProbability: p,
      ruleDecision: x.ruleDecision, ruleScore: x.ruleScore, mlProbability: x.prob, mlWouldFlag: x.shadowDecision === 'WOULD_FLAG',
      modelId: x.modelId, rulePredictionId: x.ruleId, shadowPredictionId: x.shadowId,
    };
  });
  const res = await prisma.fraudSample.createMany({ data, skipDuplicates: true });
  return { considered: rows.length, sampled: res.count, selected: data.filter((d) => d.selected).length };
}

// ---------------------------------------------------------------------------------------------
// Outcome learning: attach the real outcome to both the RULES and the SHADOW row of a subject
// ---------------------------------------------------------------------------------------------
// settled: the outcome is final even without a label (e.g. a cancelled checkout is never an abandonment)
async function setOutcome(modelName, subjectType, subjectId, label, outcome, now, settled = false) {
  await prisma.mlPrediction.updateMany({
    where: { modelName, subjectType, subjectId },
    data: { outcomeLabel: label, outcome: outcome ?? undefined, outcomeAt: label === null && !settled ? null : now },
  });
}

const pending = (modelName, subjectType, before, take = 500) => prisma.mlPrediction.findMany({
  where: { modelName, role: 'RULES', subjectType, outcomeAt: null, asOf: { lt: before } },
  select: { subjectId: true, eventId: true, asOf: true }, orderBy: { asOf: 'asc' }, take,
});

export async function attachOutcomes({ now = new Date() } = {}) {
  const done = { intent: 0, abandonment: 0, demand: 0, attendance: 0, crowd: 0, fraud: 0 };

  // Intent: a paid order for that event within 7 days of the visit start
  for (const p of await pending('intent', 'VISIT', new Date(now - 7 * DAY))) {
    const v = parseVisitId(p.subjectId);
    const until = new Date(v.start.getTime() + 7 * DAY);
    const bought = await prisma.order.count({ where: { userId: v.userId, eventId: v.eventId, status: { in: SOLD }, createdAt: { gte: v.start, lte: until } } });
    await setOutcome('intent', 'VISIT', p.subjectId, bought ? 1 : 0, { source: 'orders', window: [v.start, until] }, now);
    done.intent += 1;
  }

  // Abandonment: the checkout started in the visit did not end in a paid order (checked a day later)
  for (const p of await pending('abandonment', 'VISIT', new Date(now - DAY))) {
    const v = parseVisitId(p.subjectId);
    const paid = await prisma.order.count({ where: { userId: v.userId, eventId: v.eventId, status: { in: SOLD }, createdAt: { gte: v.start, lte: p.asOf } } });
    await setOutcome('abandonment', 'VISIT', p.subjectId, paid ? 0 : 1, { source: 'orders', window: [v.start, p.asOf] }, now);
    done.abandonment += 1;
  }

  // Demand: tickets sold in the first 48 hours after sales opened (forecast views and sales-open snapshots)
  for (const subjectType of ['EVENT_FORECAST', 'EVENT_AT_SALES_OPEN']) {
    for (const p of await pending('demand', subjectType, now)) {
      const e = await prisma.event.findUnique({ where: { id: p.eventId }, select: { salesOpenAt: true, publishAt: true, approvedAt: true, createdAt: true } });
      if (!e) continue;
      const open = salesOpenOf(e);
      const end = new Date(open.getTime() + 2 * DAY);
      if (end > now) continue;
      const sold = await prisma.ticket.count({ where: { eventId: p.eventId, createdAt: { gte: open, lt: end }, order: { status: { in: SOLD } } } });
      await setOutcome('demand', subjectType, p.subjectId, sold, { source: 'tickets', window: [open, end] }, now);
      done.demand += 1;
    }
  }

  // Checkout abandonment (labels.js, the same definition the exporter uses)
  for (const p of await pending('checkout_abandonment', 'ORDER', new Date(now - ABANDON_OUTCOME_WINDOW_MS))) {
    const o = await prisma.order.findUnique({ where: { id: p.subjectId }, select: { status: true, createdAt: true, userId: true, eventId: true } });
    if (!o) continue;
    const end = await prisma.auditLog.findFirst({ where: { action: 'CHECKOUT_ENDED', targetType: 'Order', targetId: p.subjectId }, select: { details: true } });
    const failedAttempt = await prisma.behaviorEvent.count({ where: { action: 'payment_failed', metadata: { path: ['orderId'], equals: p.subjectId } } });
    const bought = await prisma.order.count({ where: { userId: o.userId, eventId: o.eventId, id: { not: p.subjectId }, status: { in: SOLD }, createdAt: { gte: o.createdAt, lte: new Date(o.createdAt.getTime() + ABANDON_OUTCOME_WINDOW_MS) } } });
    const { label, reason } = checkoutAbandonmentLabel({ order: { status: o.status, createdAt: o.createdAt, paid: SOLD.includes(o.status) }, endReason: end?.details?.reason ?? null, paymentFailed: failedAttempt > 0, boughtInWindow: bought > 0, now });
    if (label === null && reason === 'checkout still open') continue;
    await setOutcome('checkout_abandonment', 'ORDER', p.subjectId, label, { source: 'checkout end', reason }, now, true);
    done.checkoutAbandonment = (done.checkoutAbandonment || 0) + 1;
  }

  // Demand after publication: tickets sold in the 24 hours after each hourly snapshot
  for (const p of await pending('demand_hourly', 'EVENT_HOURLY', new Date(now - DEMAND_HOURLY_HORIZON_MS))) {
    const sold = await prisma.ticket.count({ where: { eventId: p.eventId, createdAt: { gte: p.asOf, lt: new Date(p.asOf.getTime() + DEMAND_HOURLY_HORIZON_MS) }, order: { status: { in: SOLD } } } });
    await setOutcome('demand_hourly', 'EVENT_HOURLY', p.subjectId, sold, { source: 'tickets', horizonHours: 24 }, now);
    done.demandHourly = (done.demandHourly || 0) + 1;
  }

  // Attendance: was the ticket checked in (once the event has ended)
  const att = await pending('attendance', 'TICKET', now, 3000);
  const ended = new Map();
  for (const p of att) {
    if (!ended.has(p.eventId)) {
      const e = await prisma.event.findUnique({ where: { id: p.eventId }, select: { date: true, time: true, startsAt: true, endsAt: true } });
      ended.set(p.eventId, Boolean(e) && endOf(e) <= now);
    }
    if (!ended.get(p.eventId)) continue;
    const t = await prisma.ticket.findUnique({ where: { id: p.subjectId }, select: { checkedInAt: true } });
    if (!t) continue;
    await setOutcome('attendance', 'TICKET', p.subjectId, t.checkedInAt ? 1 : 0, { source: 'check-ins' }, now);
    done.attendance = (done.attendance || 0) + 1;
  }

  // Crowd: admitted first entries at that gate in that slot (a day after the event)
  const crowd = await pending('crowd', 'GATE_SLOT', now, 3000);
  const byEvent = new Map();
  for (const p of crowd) {
    if (!byEvent.has(p.eventId)) byEvent.set(p.eventId, []);
    byEvent.get(p.eventId).push(p);
  }
  for (const [eventId, list] of byEvent) {
    const e = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true, time: true, startsAt: true } });
    if (!e) continue;
    const start = startOf(e);
    if (start.getTime() + DAY > now.getTime()) continue;
    const perGate = new Map();
    for (const p of list) {
      const { gateId, minutes } = parseSlotSubject(p.subjectId);
      if (!perGate.has(gateId)) perGate.set(gateId, await entriesBySlot(eventId, start, gateId));
      await setOutcome('crowd', 'GATE_SLOT', p.subjectId, perGate.get(gateId)[(minutes + 90) / 5], { source: 'check-ins' }, now);
      done.crowd += 1;
    }
  }

  // Fraud: only reviewer-verified outcomes from the latest BLIND review (UNRESOLVED clears the label;
  // reviews by an admin who had seen detector output for that customer never count)
  const samples = await prisma.fraudSample.findMany({
    where: { reviews: { some: {} } },
    select: { orderId: true, reviews: { select: { decision: true, id: true, createdAt: true, blind: true } } },
  });
  for (const s of samples) {
    const r = effectiveReview(s.reviews);
    const label = r?.decision === 'CONFIRMED_FRAUD' ? 1 : r?.decision === 'LEGITIMATE' ? 0 : null;
    const reviewId = r?.id ?? null;
    const current = await prisma.mlPrediction.findFirst({ where: { modelName: 'fraud', subjectType: 'ORDER', subjectId: s.orderId, role: 'RULES' }, select: { outcome: true, outcomeLabel: true } });
    if (current && (current.outcome?.reviewId ?? null) === reviewId && (reviewId !== null || current.outcomeLabel === null)) continue;
    await setOutcome('fraud', 'ORDER', s.orderId, label, r
      ? { source: 'fraud review', reviewId, decision: r.decision, reviewedAt: r.createdAt, blind: true }
      : { source: 'fraud review', reviewId: null, decision: 'NO_BLIND_REVIEW' }, now);
    done.fraud += 1;
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
export async function runMlJobs({ now = new Date() } = {}) {
  const result = {};
  const step = async (name, fn) => {
    try { result[name] = await fn(); } catch (e) { result[name] = { error: e.message }; console.error(`[ML jobs] ${name} failed:`, e.message); }
  };
  // Snapshots (and, when ML_SHADOW_ENABLED, shadow scores) - never decisions
  if (snapshotsEnabled()) {
    await step('visits', () => scoreVisits({ now }));
    await step('crowd', () => scoreCrowd({ now }));
    await step('demandAtOpen', () => snapshotDemand({ now }));
    await step('demandHourly', () => snapshotDemandHourly({ now }));
    await step('attendance', () => snapshotAttendance({ now }));
  }
  await step('fraudSampling', () => sampleFraudOrders({ now }));
  await step('outcomes', () => attachOutcomes({ now }));
  return result;
}
