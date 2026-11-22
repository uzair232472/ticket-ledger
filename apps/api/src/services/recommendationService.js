/**
 * Event recommendations: data collection with a measurable control group (Step 5 infrastructure only).
 *
 * Rules, not a model. Each visitor (account, else the app's session id; no fingerprinting) is assigned
 * deterministically to a variant:
 *   CONTROL       non-personalised: the most popular upcoming events (tickets sold in the last 30 days), then soonest
 *   PERSONALISED  the visitor's own category / city interest from verified activity; a first-time visitor with no
 *                 history gets the population ranking (basis "population"), never invented preferences
 * Both variants reserve the last slot for an under-exposed event (new or little shown), so exposure of new and
 * less popular events is measured the same way in both.
 *
 * Every list served is logged (behaviour event recommendation_impression: list id, variant, positions,
 * popularity ranks) and a click is only accepted for an event that was in that list for that visitor.
 * Purchases are attributed later from verified orders (export, attribution window). Nothing here changes
 * prices, availability, checkout or any decision.
 *
 * Step 6: shown in the app only when ML_REC_DISPLAY is on (off by default), identically for both groups. A list
 * served from Step 6 on is marked `renderTracked`; it counts as an impression only once the page reports it was
 * actually on screen (POST .../rendered, recordRendered below); the exporter leaves out lists never shown.
 */
import { createHash, randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { startOf } from './ml/features.js';

export const EXPERIMENT = 'rec-v1';
export const LIST_SIZE = 6;
const DAY = 86_400_000;
const PUBLIC = ['PUBLISHED'];

export const controlShare = () => Math.min(1, Math.max(0, Number(process.env.ML_REC_CONTROL_SHARE ?? 0.5)));

/** Deterministic first assignment for a visitor key ("u:<userId>" or "s:<sessionId>"). */
export function assignVariant(key, share = controlShare()) {
  const u = parseInt(createHash('sha256').update(`${EXPERIMENT}:${key}`).digest('hex').slice(0, 12), 16) / 2 ** 48;
  return u < share ? 'CONTROL' : 'PERSONALISED';
}

async function candidates(db, now) {
  const events = (await db.event.findMany({
    where: { status: { in: PUBLIC }, isHidden: false, cancelledAt: null },
    select: { id: true, type: true, city: true, date: true, time: true, startsAt: true, createdAt: true },
  })).filter((e) => startOf(e) > now);
  const since = new Date(now.getTime() - 30 * DAY);
  const sold = await db.ticket.groupBy({ by: ['eventId'], where: { eventId: { in: events.map((e) => e.id) }, createdAt: { gte: since, lt: now }, order: { status: 'SUCCESSFUL' } }, _count: { _all: true } });
  const soldBy = Object.fromEntries(sold.map((s) => [s.eventId, s._count._all]));
  const shown = await db.behaviorEvent.findMany({ where: { action: 'recommendation_impression', createdAt: { gte: since, lt: now } }, select: { metadata: true } });
  const exposure = {};
  for (const r of shown) for (const it of r.metadata?.items || []) exposure[it.eventId] = (exposure[it.eventId] || 0) + 1;
  const ranked = events.map((e) => ({ ...e, start: startOf(e), sold30: soldBy[e.id] || 0, exposure: exposure[e.id] || 0 }))
    .sort((a, b) => b.sold30 - a.sold30 || a.start - b.start);
  ranked.forEach((e, i) => { e.popularityRank = i + 1; });
  return ranked;
}

/** The visitor's interests from verified activity: category and city counts of views, wishlists and purchases. */
async function interests(db, userId, now) {
  if (!userId) return null;
  const [views, orders] = await Promise.all([
    db.behaviorEvent.findMany({ where: { userId, action: { in: ['event_view', 'wishlist_added'] }, eventId: { not: null }, createdAt: { lt: now } }, select: { event: { select: { type: true, city: true } } }, take: 500, orderBy: { createdAt: 'desc' } }),
    db.order.findMany({ where: { userId, status: 'SUCCESSFUL', createdAt: { lt: now } }, select: { event: { select: { type: true, city: true } } } }),
  ]);
  if (!views.length && !orders.length) return null;
  const score = { type: {}, city: {} };
  const add = (e, w) => { if (!e) return; score.type[e.type] = (score.type[e.type] || 0) + w; score.city[e.city] = (score.city[e.city] || 0) + w; };
  views.forEach((v) => add(v.event, 1));
  orders.forEach((o) => add(o.event, 5));
  return score;
}

/**
 * Builds and logs one recommendation list. Returns { listId, variant, basis, experimental, events: [{eventId, position}] }.
 * `subject`: { userId?, sessionId? } (at least one).
 */
/**
 * The visitor's group, stable across login: the group of their FIRST list in this experiment. For a signed-in
 * visitor that is their account's earliest list (guest lists linked at login count), else this session's
 * earliest guest list (a visitor who just logged in keeps the group they had as a guest); only a visitor with no
 * list yet is assigned by hash. Lists a visitor saw in another group on another device before the accounts were
 * linked are left out of the comparison by the exporter.
 */
export async function variantFor({ userId = null, sessionId = null, db = prisma }) {
  const first = (where) => db.behaviorEvent.findFirst({
    where: { action: 'recommendation_impression', ...where, metadata: { path: ['experiment'], equals: EXPERIMENT } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { metadata: true },
  });
  const prior = (userId && await first({ userId })) || (sessionId && await first({ sessionId, userId: null })) || null;
  const v = prior?.metadata?.variant;
  if (v === 'CONTROL' || v === 'PERSONALISED') return { variant: v, assignedBy: 'first-list' };
  return { variant: assignVariant(userId ? `u:${userId}` : `s:${sessionId}`), assignedBy: 'hash' };
}

export async function recommend({ userId = null, sessionId = null, surface = 'home', now = new Date(), db = prisma } = {}) {
  if (!userId && !sessionId) throw Object.assign(new Error('A signed-in user or a session id is needed'), { status: 400 });
  const { variant, assignedBy } = await variantFor({ userId, sessionId, db });
  const pool = await candidates(db, now);
  let basis = 'population';
  let ordered = pool;
  if (variant === 'PERSONALISED') {
    const s = await interests(db, userId, now);
    if (s) {
      basis = 'personal';
      ordered = [...pool].sort((a, b) => ((s.type[b.type] || 0) * 2 + (s.city[b.city] || 0)) - ((s.type[a.type] || 0) * 2 + (s.city[a.city] || 0)) || a.popularityRank - b.popularityRank);
    }
  }
  const head = ordered.slice(0, LIST_SIZE - 1);
  // Exploration slot (both variants): the least-shown event not already listed, newest first
  const explore = pool.filter((e) => !head.includes(e)).sort((a, b) => a.exposure - b.exposure || b.createdAt - a.createdAt)[0];
  const list = explore ? [...head, explore] : head;
  const listId = randomUUID();
  const items = list.map((e, i) => ({ eventId: e.id, position: i + 1, popularityRank: e.popularityRank, exploration: e === explore, isNew: now - e.createdAt < 14 * DAY }));
  await db.behaviorEvent.create({
    data: {
      userId, sessionId: sessionId || `user:${userId}`, action: 'recommendation_impression', eventId: null,
      metadata: { experiment: EXPERIMENT, listId, variant, assignedBy, basis, surface, items, candidates: pool.length, renderTracked: true },
    },
  });
  return { listId, variant, basis, experimental: true, events: items.map(({ eventId, position }) => ({ eventId, position })) };
}

/** The served list, only for the visitor it was served to (else 404). */
async function servedList(db, listId, userId, sessionId) {
  const imp = await db.behaviorEvent.findFirst({
    where: { action: 'recommendation_impression', metadata: { path: ['listId'], equals: listId } },
    select: { userId: true, sessionId: true, metadata: true, createdAt: true },
  });
  const sameVisitor = imp && ((userId && imp.userId === userId) || (sessionId && imp.sessionId === sessionId));
  if (!imp || !sameVisitor) throw Object.assign(new Error('Recommendation not found'), { status: 404 });
  return imp;
}

/**
 * The page reports the list was on screen (at least half visible for a second). Recorded once per list: a repeat
 * report changes nothing. Returns { recorded, alreadyRecorded }.
 */
export async function recordRendered({ listId, userId = null, sessionId = null, db = prisma }) {
  const imp = await servedList(db, listId, userId, sessionId);
  const seen = await db.behaviorEvent.findFirst({ where: { action: 'recommendation_rendered', metadata: { path: ['listId'], equals: listId } }, select: { id: true } });
  if (seen) return { recorded: false, alreadyRecorded: true };
  await db.behaviorEvent.create({
    data: { userId: userId || imp.userId, sessionId: sessionId || imp.sessionId, action: 'recommendation_rendered', eventId: null, metadata: { experiment: EXPERIMENT, listId, variant: imp.metadata.variant, surface: imp.metadata.surface } },
  });
  return { recorded: true, alreadyRecorded: false };
}

/** Records a click, only for an event that was in that list, shown to the same visitor. */
export async function recordClick({ listId, eventId, userId = null, sessionId = null, db = prisma }) {
  const imp = await servedList(db, listId, userId, sessionId);
  const item = imp.metadata?.items?.find((it) => it.eventId === eventId);
  if (!item) throw Object.assign(new Error('Recommendation not found'), { status: 404 });
  await db.behaviorEvent.create({
    data: { userId: userId || imp.userId, sessionId: sessionId || imp.sessionId, action: 'recommendation_click', eventId, metadata: { experiment: EXPERIMENT, listId, variant: imp.metadata.variant, position: item.position } },
  });
  return { recorded: true };
}
