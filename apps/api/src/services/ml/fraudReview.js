/**
 * Blind fraud review.
 *
 * Queue: every selected FraudSample (rule-flagged, ML-only flagged and a random share of unflagged orders),
 * in a fixed pseudo-random order, showing only the order's own facts. Reviewers never see which detector
 * flagged it, whether one did, or any score.
 *
 * Recording a review appends to the history (FraudReview) and the audit log - nothing else. It never
 * changes the order, payment, tickets, account or checkout. Account action stays a separate, manual step.
 *
 * Metrics (super admin only) weight each review by 1 / its sampling rate, so precision, recall and the
 * false-flag rate describe ALL scored orders, and the random sample of unflagged orders estimates fraud
 * that both the rules and the model missed.
 *
 * Blindness. The fraud watchlist, investigations and account actions show detector output (rule scores, bot
 * flags) per account, and the same admins can review. So each review records whether its reviewer had seen
 * detector output for that customer before deciding (exposureFor). Only BLIND reviews are labels; exposed
 * ones stay in the history and are counted separately. Reviewers are never told which reviews were exposed
 * (that would reveal a flag), and the queue shows a customer reference instead of the account id.
 */
import { createHash } from 'node:crypto';
import prisma from '../../config/prisma.js';

export const DECISIONS = ['CONFIRMED_FRAUD', 'LEGITIMATE', 'UNRESOLVED'];
const DAY = 86_400_000;
const shuffleKey = (id) => createHash('sha256').update(`queue:${id}`).digest('hex');

const latest = (reviews) => reviews.reduce((a, r) => (!a || r.createdAt > a.createdAt ? r : a), null);

/** The review that counts: the latest BLIND one (exposed and pre-check reviews never count). */
export const effectiveReview = (reviews) => latest(reviews.filter((r) => r.blind === true));

/** Item status from its reviews: open (needs a blind decision), resolved, unresolved, exposed-only. */
export function reviewState(reviews) {
  const e = effectiveReview(reviews);
  if (e) return e.decision === 'UNRESOLVED' ? 'UNRESOLVED' : 'RESOLVED';
  return reviews.length ? 'EXPOSED_ONLY' : 'UNREVIEWED';
}

/** Stable pseudonym shown to reviewers instead of the account id (so it can't be looked up on the watchlist). */
export const customerRef = (userId) => `C-${createHash('sha256').update(`customer-ref:${userId}`).digest('hex').slice(0, 10)}`;

// Views that list several accounts with their fraud scores (matched on details.userIds): the fraud watchlist
// and the admin fraud alerts
const WATCHLIST_VIEW = 'FRAUD_WATCHLIST_VIEWED';
// Admin actions on ONE account that show its fraud-detector output (AuditLog, targetType User). Other admin
// actions (reminders, support, role changes) show none and leave a reviewer blind.
export const EXPOSING_ACTIONS = ['FRAUD_PROFILE_VIEWED', 'INVESTIGATION_OPENED', 'INVESTIGATION_VIEWED', 'INVESTIGATION_UPDATED',
  'USER_ACCOUNT_FROZEN_BY_ADMIN', 'USER_ACCOUNT_UNFROZEN_BY_ADMIN'];

/**
 * Did `reviewerId` see fraud-detector output for `customerId` before `before`? Sources: a watchlist / fraud
 * alerts view that listed the customer, the customer's admin behaviour profile (fraud score), an
 * investigation of the account, or freezing it from the watchlist. Returns { blind, exposure: [{action, at}] }.
 */
export async function exposureFor({ reviewerId, customerId, before = new Date() }, db = prisma) {
  if (!customerId) return { blind: true, exposure: [] };
  const rows = await db.$queryRaw`
    SELECT "action", "createdAt" FROM "AuditLog"
    WHERE "userId" = ${reviewerId} AND "createdAt" < (${before.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND (("targetType" = 'User' AND "targetId" = ${customerId} AND "action" = ANY(${EXPOSING_ACTIONS}))
        OR ("action" = ${WATCHLIST_VIEW} AND "details"->'userIds' ? ${customerId}))
    ORDER BY "createdAt" DESC LIMIT 20`;
  return { blind: rows.length === 0, exposure: rows.map((r) => ({ action: r.action, at: r.createdAt })) };
}

// Note on raw SQL: timestamps are stored as UTC "timestamp without time zone"; a JS Date passed as a raw
// parameter is converted with the database session's time zone, so it is passed as UTC explicitly.

/** Logs that an admin saw detector output for these accounts (fraud watchlist, fraud alerts). */
export async function recordWatchlistView(adminId, userIds, db = prisma, source = 'watchlist') {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!adminId || !ids.length) return;
  await db.auditLog.create({ data: { userId: adminId, action: WATCHLIST_VIEW, targetType: 'FraudWatchlist', targetId: source, details: { userIds: ids } } });
}

/** Logs that an admin saw one account's fraud score (admin behaviour profile). */
export async function recordProfileView(adminId, userId, db = prisma) {
  if (!adminId || !userId) return;
  await db.auditLog.create({ data: { userId: adminId, action: 'FRAUD_PROFILE_VIEWED', targetType: 'User', targetId: userId, details: {} } });
}

/**
 * Open items: selected samples without a blind decision (no review, UNRESOLVED, or only exposed reviews),
 * minus the ones this reviewer has already decided (an exposed reviewer is not asked again).
 */
export async function reviewQueue({ limit = 25, reviewerId = null } = {}) {
  const samples = await prisma.fraudSample.findMany({
    where: { selected: true },
    select: { id: true, orderId: true, reviews: { select: { decision: true, createdAt: true, blind: true, reviewerId: true } } },
  });
  const isOpen = (s) => ['UNREVIEWED', 'UNRESOLVED', 'EXPOSED_ONLY'].includes(reviewState(s.reviews));
  const mine = (s) => reviewerId && s.reviews.some((r) => r.reviewerId === reviewerId && r.decision !== 'UNRESOLVED');
  const openAll = samples.filter(isOpen);
  const open = openAll
    .filter((s) => !mine(s))
    .sort((a, b) => shuffleKey(a.id).localeCompare(shuffleKey(b.id)))
    .slice(0, Math.min(limit, 100));
  const items = [];
  for (const s of open) {
    const order = await prisma.order.findUnique({
      where: { id: s.orderId },
      select: {
        id: true, status: true, totalAmount: true, paymentMethod: true, createdAt: true, discountCodeId: true, userId: true,
        tickets: { select: { id: true } },
        event: { select: { name: true, city: true, date: true, type: true } },
        user: { select: { createdAt: true } },
      },
    });
    const base = { sampleId: s.id, orderId: s.orderId, previouslyUnresolved: s.reviews.filter((r) => r.decision === 'UNRESOLVED').length };
    if (!order) { items.push({ ...base, orderDeleted: true }); continue; }
    const [orders, failed30d, resale] = await Promise.all([
      prisma.order.count({ where: { userId: order.userId, createdAt: { lt: order.createdAt } } }),
      prisma.order.count({ where: { userId: order.userId, status: 'FAILED', createdAt: { gte: new Date(order.createdAt - 30 * DAY), lt: order.createdAt } } }),
      prisma.resaleListing.count({ where: { sellerId: order.userId } }),
    ]);
    items.push({
      ...base,
      order: {
        createdAt: order.createdAt, status: order.status, totalAmount: Number(order.totalAmount), tickets: order.tickets.length,
        paymentMethod: order.paymentMethod, usedDiscountCode: Boolean(order.discountCodeId),
        event: order.event,
      },
      customer: {
        ref: customerRef(order.userId), accountAgeDays: Math.round((order.createdAt - order.user.createdAt) / DAY),
        earlierOrders: orders, failedPayments30d: failed30d, resaleListings: resale,
      },
    });
  }
  return { items, open: openAll.length };
}

/**
 * Appends a review. Writes FraudReview + AuditLog only. Its blindness is checked and stored, but not
 * returned: telling the reviewer would reveal that the customer had been flagged.
 */
export async function recordReview({ sampleId, decision, note, reviewerId }) {
  if (!DECISIONS.includes(decision)) throw Object.assign(new Error('Invalid decision'), { status: 400 });
  const sample = await prisma.fraudSample.findUnique({ where: { id: sampleId }, select: { id: true, orderId: true, selected: true } });
  if (!sample || !sample.selected) throw Object.assign(new Error('Review item not found'), { status: 404 });
  const order = await prisma.order.findUnique({ where: { id: sample.orderId }, select: { userId: true } });
  const now = new Date();
  const { blind, exposure } = await exposureFor({ reviewerId, customerId: order?.userId, before: now });
  const review = await prisma.fraudReview.create({
    data: { sampleId, orderId: sample.orderId, decision, note: note || null, reviewerId, blind, exposure, createdAt: now },
    select: { id: true, sampleId: true, orderId: true, decision: true, note: true, reviewerId: true, createdAt: true },
  });
  await prisma.auditLog.create({
    data: { userId: reviewerId, action: 'FRAUD_REVIEW_RECORDED', targetType: 'Order', targetId: sample.orderId, details: { decision, sampleId, reviewId: review.id } },
  });
  return review;
}

/** Review history of one item (who decided what, when) - still without the detection source. */
export async function reviewHistory(sampleId) {
  const sample = await prisma.fraudSample.findUnique({ where: { id: sampleId }, select: { id: true, orderId: true, selected: true } });
  if (!sample || !sample.selected) throw Object.assign(new Error('Review item not found'), { status: 404 });
  const reviews = await prisma.fraudReview.findMany({
    where: { sampleId }, orderBy: { createdAt: 'asc' }, select: { id: true, decision: true, note: true, reviewerId: true, createdAt: true },
  });
  return { sampleId, orderId: sample.orderId, reviews };
}

// ---------------------------------------------------------------------------------------------
// Sampling-weighted evaluation
// ---------------------------------------------------------------------------------------------
const CELLS = ['RULE_AND_ML', 'RULE_ONLY', 'ML_ONLY', 'NEITHER'];
export const MIN_RESOLVED_PER_CELL = 30;
// More unresolved than this share of a cell's decided-or-unresolved items makes its estimate unreliable
export const MAX_UNRESOLVED_SHARE = 0.2;

/**
 * Pure estimator (tested directly). cells: { CELL: { population, resolved: [{fraud: 0|1, weight}] } }.
 * Fraud share per cell = weighted mean of resolved reviews (weight = 1 / inclusion probability);
 * estimated frauds in a cell = population x that share.
 */
export function estimate(cells) {
  const est = {};
  for (const c of CELLS) {
    const x = cells[c] || { population: 0, resolved: [] };
    const w = x.resolved.reduce((a, r) => a + r.weight, 0);
    const share = w > 0 ? x.resolved.reduce((a, r) => a + r.weight * r.fraud, 0) / w : null;
    est[c] = { population: x.population, resolved: x.resolved.length, fraudShare: share,
      frauds: share === null ? null : x.population * share, legit: share === null ? null : x.population * (1 - share) };
  }
  const known = (cs) => cs.every((c) => est[c].population === 0 || est[c].fraudShare !== null);
  const sum = (cs, k) => cs.reduce((a, c) => a + (est[c].population ? est[c][k] : 0), 0);
  const pop = (cs) => cs.reduce((a, c) => a + est[c].population, 0);
  const ratio = (a, b) => (b > 0 ? a / b : null);
  const detector = (flagCells) => {
    if (!known(CELLS)) return { precision: null, recall: null, falseFlagRate: null, flagged: pop(flagCells) };
    const totalFraud = sum(CELLS, 'frauds');
    const totalLegit = sum(CELLS, 'legit');
    return {
      flagged: pop(flagCells),
      precision: ratio(sum(flagCells, 'frauds'), pop(flagCells)),
      recall: ratio(sum(flagCells, 'frauds'), totalFraud),
      falseFlagRate: ratio(sum(flagCells, 'legit'), totalLegit),
    };
  };
  return {
    cells: est,
    rules: detector(['RULE_AND_ML', 'RULE_ONLY']),
    model: detector(['RULE_AND_ML', 'ML_ONLY']),
    missedByBoth: known(['NEITHER']) ? est.NEITHER.frauds : null,
    estimatedTotalFraud: known(CELLS) ? sum(CELLS, 'frauds') : null,
  };
}

/** Stratified bootstrap of the estimate (resamples resolved reviews within each cell). */
function bootstrap(cells, B = 500, seed = 1) {
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const keys = ['rules.precision', 'rules.recall', 'rules.falseFlagRate', 'model.precision', 'model.recall', 'model.falseFlagRate', 'missedByBoth'];
  const draws = Object.fromEntries(keys.map((k) => [k, []]));
  for (let b = 0; b < B; b++) {
    const re = {};
    for (const c of CELLS) {
      const x = cells[c] || { population: 0, resolved: [] };
      re[c] = { population: x.population, resolved: x.resolved.map(() => x.resolved[Math.floor(rand() * x.resolved.length)]) };
    }
    const e = estimate(re);
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => o?.[p], e);
      if (v !== null && v !== undefined) draws[k].push(v);
    }
  }
  const q = (xs, p) => { const s2 = [...xs].sort((a, b) => a - b); return s2.length ? s2[Math.min(s2.length - 1, Math.floor(p * s2.length))] : null; };
  return Object.fromEntries(keys.map((k) => [k, draws[k].length ? [q(draws[k], 0.025), q(draws[k], 0.975)] : null]));
}

/**
 * Unresolved cases, reported on their own so the main estimate cannot hide them: per cell counts and share,
 * and the estimate's range if every unresolved case were fraud vs. if every one were legitimate.
 */
export function unresolvedReport(cells) {
  const withAll = (fraud) => Object.fromEntries(CELLS.map((c) => [c, {
    population: cells[c].population,
    resolved: [...cells[c].resolved, ...cells[c].unresolvedWeights.map((weight) => ({ fraud, weight }))],
  }]));
  const pick = (e) => ({ rules: e.rules, model: e.model, missedByBoth: e.missedByBoth });
  const perCell = Object.fromEntries(CELLS.map((c) => {
    const n = cells[c].unresolved;
    const decided = cells[c].resolved.length + n;
    return [c, { unresolved: n, share: decided ? n / decided : null }];
  }));
  const total = CELLS.reduce((a, c) => a + cells[c].unresolved, 0);
  return {
    total,
    perCell,
    tooMany: CELLS.filter((c) => perCell[c].share !== null && perCell[c].share > MAX_UNRESOLVED_SHARE),
    ifAllFraud: total ? pick(estimate(withAll(1))) : null,
    ifAllLegitimate: total ? pick(estimate(withAll(0))) : null,
  };
}

export async function reviewMetrics({ from, to } = {}) {
  const where = { ...(from || to ? { sampledAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}) };
  const samples = await prisma.fraudSample.findMany({
    where, select: { cell: true, selected: true, inclusionProbability: true, reviews: { select: { decision: true, createdAt: true, blind: true } } },
  });
  const cells = Object.fromEntries(CELLS.map((c) => [c, { population: 0, resolved: [], selected: 0, unresolved: 0, unresolvedWeights: [], unreviewed: 0, exposedOnly: 0, exposedReviews: 0 }]));
  for (const s of samples) {
    const c = cells[s.cell];
    c.population += 1;
    if (!s.selected) continue;
    c.selected += 1;
    c.exposedReviews += s.reviews.filter((r) => r.blind !== true).length;
    const state = reviewState(s.reviews);
    const e = effectiveReview(s.reviews);
    if (state === 'UNREVIEWED') c.unreviewed += 1;
    else if (state === 'EXPOSED_ONLY') c.exposedOnly += 1;
    else if (state === 'UNRESOLVED') { c.unresolved += 1; c.unresolvedWeights.push(1 / s.inclusionProbability); }
    else c.resolved.push({ fraud: e.decision === 'CONFIRMED_FRAUD' ? 1 : 0, weight: 1 / s.inclusionProbability });
  }
  const scoredWithoutShadow = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "MlPrediction" r
    LEFT JOIN "MlPrediction" s ON s."modelName" = 'fraud' AND s."role" = 'SHADOW' AND s."subjectType" = 'ORDER' AND s."subjectId" = r."subjectId" AND s."score" IS NOT NULL
    WHERE r."modelName" = 'fraud' AND r."role" = 'RULES' AND r."subjectType" = 'ORDER' AND s."id" IS NULL`;
  const e = estimate(cells);
  const thin = CELLS.filter((c) => cells[c].population > 0 && cells[c].resolved.length < MIN_RESOLVED_PER_CELL);
  const unresolved = unresolvedReport(cells);
  const notes = [];
  if (thin.length) notes.push(`Not enough resolved blind reviews yet in: ${thin.join(', ')} (need ${MIN_RESOLVED_PER_CELL} each). Estimates are unreliable until then.`);
  if (unresolved.tooMany.length) notes.push(`Too many unresolved cases in: ${unresolved.tooMany.join(', ')} (over ${MAX_UNRESOLVED_SHARE * 100}%). See "unresolved" for the range they leave open.`);
  if (!notes.length) notes.push('Estimates weight each blind review by 1 / its sampling rate. Unresolved, exposed-only and unreviewed items are excluded from them and reported separately.');
  return {
    ...e,
    interval95: bootstrap(cells),
    unresolved,
    reviewProgress: Object.fromEntries(CELLS.map((c) => [c, {
      population: cells[c].population, selected: cells[c].selected, resolved: cells[c].resolved.length,
      unresolved: cells[c].unresolved, unreviewed: cells[c].unreviewed, exposedOnly: cells[c].exposedOnly, exposedReviews: cells[c].exposedReviews,
    }])),
    ordersWithoutShadowScore: scoredWithoutShadow[0]?.n ?? 0,
    sufficient: thin.length === 0 && unresolved.tooMany.length === 0,
    note: notes.join(' '),
  };
}

/**
 * Reviewed cases for the AI monitor (SUPER_ADMIN; reviewers never call this). Only samples whose blind review is
 * RESOLVED, so nothing about an open queue item is shown: the rule decision, the shadow model's probability and
 * its top reasons (logged with the shadow row), next to the reviewer's decision. For reading model behaviour,
 * not for deciding: the order, payment, tickets and account are not changed by anything here.
 */
export async function reviewedCases({ limit = 30 } = {}, db = prisma) {
  const samples = await db.fraudSample.findMany({
    where: { selected: true, reviews: { some: { blind: true, decision: { in: ['CONFIRMED_FRAUD', 'LEGITIMATE'] } } } },
    orderBy: { sampledAt: 'desc' }, take: Math.min(100, Math.max(1, limit)),
    select: { id: true, orderId: true, cell: true, inclusionProbability: true, ruleDecision: true, ruleScore: true, mlProbability: true, mlWouldFlag: true, shadowPredictionId: true, sampledAt: true,
      reviews: { select: { decision: true, createdAt: true, blind: true } } },
  });
  const ids = samples.map((s) => s.shadowPredictionId).filter(Boolean);
  const shadow = new Map((ids.length ? await db.mlPrediction.findMany({ where: { id: { in: ids } }, select: { id: true, output: true } }) : []).map((p) => [p.id, p.output]));
  return samples.map((s) => {
    const e = effectiveReview(s.reviews);
    if (!e || e.decision === 'UNRESOLVED') return null;
    const out = shadow.get(s.shadowPredictionId);
    return {
      sampleId: s.id, cell: s.cell, samplingRate: s.inclusionProbability, sampledAt: s.sampledAt,
      rule: { decision: s.ruleDecision, score: s.ruleScore },
      model: { probability: s.mlProbability, wouldFlag: s.mlWouldFlag, reasons: Array.isArray(out?.reasons) ? out.reasons : null },
      review: { decision: e.decision, at: e.createdAt },
      agreement: (s.mlWouldFlag ? 'CONFIRMED_FRAUD' : 'LEGITIMATE') === e.decision ? 'model matched the review' : 'model did not match the review',
    };
  }).filter(Boolean);
}
