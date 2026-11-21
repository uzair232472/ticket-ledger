import crypto from 'crypto';
import prisma from '../config/prisma.js';

export const BEHAVIOR_ACTIONS = {
  EVENT_VIEW: 'event_view',
  CATEGORY_VIEW: 'category_view',
  SEAT_SELECTED: 'seat_selected',
  SEAT_LOCKED: 'seat_locked',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_ABANDONED: 'checkout_abandoned', // legacy rows; new rows use the specific actions below
  CHECKOUT_CANCELLED: 'checkout_cancelled', // the customer cancelled the checkout
  SEAT_HOLD_RELEASED: 'seat_hold_released', // the customer released held seats
  CHECKOUT_EXPIRED: 'checkout_expired', // the seat hold expired unpaid
  SEARCH: 'search',
  WISHLIST_ADDED: 'wishlist_added',
  WISHLIST_REMOVED: 'wishlist_removed',
  RECOMMENDATION_IMPRESSION: 'recommendation_impression',
  RECOMMENDATION_CLICK: 'recommendation_click',
  PAYMENT_COMPLETED: 'payment_completed',
  PAYMENT_FAILED: 'payment_failed',
  TICKET_PURCHASED: 'ticket_purchased',
  TICKET_TRANSFERRED: 'ticket_transferred',
  RESALE_VIEWED: 'resale_viewed',
  RESALE_ATTEMPTED: 'resale_attempted',
  GATE_CHECKED_IN: 'gate_checked_in',
  WALLET_CONNECTED: 'wallet_connected',
  LOGIN: 'login',
};

/**
 * Helper to extract or generate a session ID
 */
export const extractSessionId = (req, userId = null) => {
  if (req?.headers?.['x-session-id']) {
    return req.headers['x-session-id'];
  }
  if (req?.body?.sessionId) {
    return req.body.sessionId;
  }
  if (req?.query?.sessionId) {
    return req.query.sessionId;
  }
  if (userId) {
    return `sess_usr_${userId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}`;
  }
  return `guest_sess_${crypto.randomUUID().slice(0, 12)}`;
};

/**
 * Asynchronously record a behavioral event
 */
export const trackBehavior = async ({
  req,
  userId = null,
  sessionId = null,
  action,
  eventId = null,
  metadata = {},
}) => {
  try {
    const finalUserId = userId || req?.user?.id || null;
    const finalSessionId = sessionId || extractSessionId(req, finalUserId);

    if (!action) {
      console.warn('[BehaviorService] Action type missing in trackBehavior');
      return null;
    }

    const eventRecord = await prisma.behaviorEvent.create({
      data: {
        userId: finalUserId,
        sessionId: finalSessionId,
        action,
        eventId: eventId || null,
        metadata: {
          ...metadata,
          ip: req?.ip || req?.socket?.remoteAddress || null,
          userAgent: req?.headers?.['user-agent'] || null,
          timestamp: new Date().toISOString(),
        },
      },
    });

    return eventRecord;
  } catch (err) {
    // Non-blocking defensive logging: telemetry should never break payment/checkout execution
    console.warn(`[BehaviorService] Telemetry recording failed for action "${action}":`, err.message);
    return null;
  }
};

/**
 * Attach guest session history to authenticated user on login/signup
 */
export const GUEST_LINK_WINDOW_DAYS = 30;
/**
 * Eligibility (no fingerprinting: only the app's own session id is used):
 *   - only anonymous activity of this session from the last GUEST_LINK_WINDOW_DAYS days is linked;
 *   - nothing is linked when the session already holds activity of a DIFFERENT account (a shared device:
 *     the anonymous part cannot be attributed to either person);
 *   - every link is audited (GUEST_ACTIVITY_LINKED: how many rows, which time range, pseudonymous session).
 */
export const attachSessionToUser = async ({ sessionId, userId, now = new Date() }) => {
  if (!sessionId || !userId) return { count: 0 };

  try {
    const others = await prisma.behaviorEvent.count({ where: { sessionId, userId: { not: null, notIn: [userId] } } });
    if (others) return { count: 0, skipped: 'shared session: activity of another account' };
    const since = new Date(now.getTime() - GUEST_LINK_WINDOW_DAYS * 86_400_000);
    const where = { sessionId, userId: null, createdAt: { gte: since, lte: now } };
    const range = await prisma.behaviorEvent.aggregate({ where, _min: { createdAt: true }, _max: { createdAt: true } });
    const result = await prisma.behaviorEvent.updateMany({ where, data: { userId } });
    if (result.count) {
      await prisma.auditLog.create({
        data: {
          userId, action: 'GUEST_ACTIVITY_LINKED', targetType: 'User', targetId: userId,
          details: { session: crypto.createHash('sha256').update(`session:${sessionId}`).digest('hex').slice(0, 16), count: result.count, from: range._min.createdAt, to: range._max.createdAt },
        },
      });
    }
    return result;
  } catch (err) {
    console.warn('[BehaviorService] Session-to-user attribution failed:', err.message);
    return { count: 0 };
  }
};

/**
 * Aggregate behavioral profile, timeline, and ML scores for a user
 */
/**
 * `scope.eventIds`: when given (an organization's view), only behaviour on those events is read and
 * platform-wide data (account status, wallet, logins, other organizers' events, fraud model) is left out.
 */
export const getUserBehavioralProfile = async (userId, sessionId = null, scope = null) => {
  const scopedIds = Array.isArray(scope?.eventIds) ? scope.eventIds : null;
  if (!userId) {
    throw new Error('User ID is required to fetch behavioral profile');
  }

  // Guest activity is linked only at login / sign-up, under the eligibility rules of attachSessionToUser
  // (viewing a profile no longer attaches a session's anonymous activity)

  // 1. Fetch user profile
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      walletAddress: true,
      createdAt: true,
    },
  });

  if (user && scopedIds) {
    delete user.role;
    delete user.status;
    delete user.walletAddress;
  }

  if (!user) {
    throw new Error('User not found');
  }

  // 2. Fetch all user behavior events
  const events = await prisma.behaviorEvent.findMany({
    where: scopedIds
      ? { userId, eventId: { in: scopedIds } }
      : {
          OR: [
            { userId },
            ...(sessionId ? [{ sessionId }] : []),
          ],
        },
    orderBy: { createdAt: 'desc' },
    include: {
      event: {
        select: {
          id: true,
          name: true,
          type: true,
          city: true,
          venue: true,
        },
      },
    },
    take: 100,
  });

  // 3. Count occurrences of each action type
  const counts = {
    eventsViewed: 0,
    categoriesViewed: 0,
    seatsSelected: 0,
    seatsLocked: 0,
    checkoutsStarted: 0,
    abandonedCheckouts: 0,
    paymentsCompleted: 0,
    paymentsFailed: 0,
    ticketsPurchased: 0,
    transfersSent: 0,
    resalesViewed: 0,
    resalesAttempted: 0,
    gateCheckIns: 0,
    walletConnected: 0,
    logins: 0,
  };

  events.forEach((e) => {
    switch (e.action) {
      case BEHAVIOR_ACTIONS.EVENT_VIEW:
        counts.eventsViewed++;
        break;
      case BEHAVIOR_ACTIONS.CATEGORY_VIEW:
        counts.categoriesViewed++;
        break;
      case BEHAVIOR_ACTIONS.SEAT_SELECTED:
        counts.seatsSelected++;
        break;
      case BEHAVIOR_ACTIONS.SEAT_LOCKED:
        counts.seatsLocked++;
        break;
      case BEHAVIOR_ACTIONS.CHECKOUT_STARTED:
        counts.checkoutsStarted++;
        break;
      case BEHAVIOR_ACTIONS.CHECKOUT_ABANDONED:
      case BEHAVIOR_ACTIONS.CHECKOUT_CANCELLED:
      case BEHAVIOR_ACTIONS.SEAT_HOLD_RELEASED:
      case BEHAVIOR_ACTIONS.CHECKOUT_EXPIRED:
        counts.abandonedCheckouts++; // "left checkout" (any reason), as this counter always meant
        break;
      case BEHAVIOR_ACTIONS.PAYMENT_COMPLETED:
        counts.paymentsCompleted++;
        break;
      case BEHAVIOR_ACTIONS.PAYMENT_FAILED:
        counts.paymentsFailed++;
        break;
      case BEHAVIOR_ACTIONS.TICKET_PURCHASED:
        counts.ticketsPurchased++;
        break;
      case BEHAVIOR_ACTIONS.TICKET_TRANSFERRED:
        counts.transfersSent++;
        break;
      case BEHAVIOR_ACTIONS.RESALE_VIEWED:
        counts.resalesViewed++;
        break;
      case BEHAVIOR_ACTIONS.RESALE_ATTEMPTED:
        counts.resalesAttempted++;
        break;
      case BEHAVIOR_ACTIONS.GATE_CHECKED_IN:
        counts.gateCheckIns++;
        break;
      case BEHAVIOR_ACTIONS.WALLET_CONNECTED:
        counts.walletConnected++;
        break;
      case BEHAVIOR_ACTIONS.LOGIN:
        counts.logins++;
        break;
      default:
        break;
    }
  });

  // 4. Intent (rules, per event) and fraud scores
  // Purchase intent, per event and overall (rule-based; documented in computeIntentByEvent below)
  const intentByEvent = await computeIntentByEvent(userId, scopedIds);
  const overall = overallIntent(intentByEvent, counts);
  const intentScore = overall.score;
  const intentClass = overall.tier;
  // No fraud score for a profile. Fraud is assessed only at checkout (by the rules, from that checkout's
  // real telemetry). This used to call mlService.predictFraud, which does not exist, so it always showed a
  // fixed 14 "low risk" (and with it, invented telemetry). That could be mistaken for a genuine ML score, so
  // the profile now says plainly that no score is available.
  const fraudRisk = {
    available: false,
    score: null,
    level: 'UNAVAILABLE',
    isBot: false,
    description: 'Not scored: fraud checks run at checkout only, using that checkout activity',
  };

  const profile = {
    user,
    stats: counts,
    totalEventsTracked: events.length,
    scores: {
      purchaseIntent: {
        score: Math.round(intentScore),
        tier: intentClass,
        description: overall.description,
        basis: 'rules',
        eventsConsidered: intentByEvent.length,
      },
      fraudRisk,
    },
    summary: {
      intentScore: Math.round(intentScore),
      intentLevel: intentClass,
      totalActions: events.length,
      riskLevel: 'UNAVAILABLE',
      // Event categories the user actually interacted with, most active first
      topCategory: categoryAffinity(intentByEvent)[0]?.category || null,
      categoryAffinity: categoryAffinity(intentByEvent),
    },
    // One score per event the user interacted with (most recent first); the overall score above combines them
    intentByEvent,
    timeline: events.map((ev) => ({
      id: ev.id,
      action: ev.action,
      sessionId: ev.sessionId,
      eventId: ev.eventId,
      eventTitle: ev.event?.name || null,
      eventCategory: ev.event?.type || null,
      metadata: ev.metadata,
      createdAt: ev.createdAt,
    })),
  };
  if (scopedIds) {
    // Organization view: the platform fraud model sees behaviour outside this organization
    delete profile.scores.fraudRisk;
    delete profile.summary.riskLevel;
    profile.scope = { kind: 'organization', eventCount: scopedIds.length };
  }
  return profile;
};


const INTENT_ACTIONS = {
  view: [BEHAVIOR_ACTIONS.EVENT_VIEW],
  seat: [BEHAVIOR_ACTIONS.SEAT_SELECTED, BEHAVIOR_ACTIONS.SEAT_LOCKED],
  checkout: [BEHAVIOR_ACTIONS.CHECKOUT_STARTED],
  abandon: [BEHAVIOR_ACTIONS.CHECKOUT_ABANDONED, BEHAVIOR_ACTIONS.CHECKOUT_CANCELLED, BEHAVIOR_ACTIONS.SEAT_HOLD_RELEASED, BEHAVIOR_ACTIONS.CHECKOUT_EXPIRED],
  failed: [BEHAVIOR_ACTIONS.PAYMENT_FAILED],
  bought: [BEHAVIOR_ACTIONS.PAYMENT_COMPLETED, BEHAVIOR_ACTIONS.TICKET_PURCHASED],
};
const intentTier = (score, purchased) => (purchased ? 'PURCHASED' : score >= 70 ? 'HIGH' : score >= 40 ? 'MODERATE' : 'LOW');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Purchase intent for every event the user has interacted with (rule-based, 0–100):
 *   base 10 · +6 per view (max +24) · +20 for holding a seat (+5 more for 3+ seat actions) · +25 for starting
 *   checkout · −10 if every checkout was abandoned · −5 after a failed payment · −10 if the last activity is
 *   over 14 days old. Not-yet-bought events are capped at 95; an event with a paid order scores 100 (PURCHASED).
 * Counts come from all of the user's behaviour rows (not only the latest 100), grouped by event and action.
 */
export async function computeIntentByEvent(userId, eventIds = null) {
  const inScope = eventIds ? { eventId: { in: eventIds } } : {};
  const [grouped, paidOrders] = await Promise.all([
    prisma.behaviorEvent.groupBy({
      by: ['eventId', 'action'],
      where: { userId, eventId: { not: null }, ...inScope },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.order.findMany({ where: { userId, status: 'SUCCESSFUL', ...inScope }, select: { eventId: true } }),
  ]);
  const paid = new Set(paidOrders.map((o) => o.eventId));
  const perEvent = new Map();
  for (const row of grouped) {
    const e = perEvent.get(row.eventId) || { views: 0, seatActions: 0, checkoutsStarted: 0, abandoned: 0, paymentsFailed: 0, boughtSignals: 0, actions: 0, lastActivityAt: null };
    const n = row._count._all;
    if (INTENT_ACTIONS.view.includes(row.action)) e.views += n;
    else if (INTENT_ACTIONS.seat.includes(row.action)) e.seatActions += n;
    else if (INTENT_ACTIONS.checkout.includes(row.action)) e.checkoutsStarted += n;
    else if (INTENT_ACTIONS.abandon.includes(row.action)) e.abandoned += n;
    else if (INTENT_ACTIONS.failed.includes(row.action)) e.paymentsFailed += n;
    else if (INTENT_ACTIONS.bought.includes(row.action)) e.boughtSignals += n;
    e.actions += n;
    const at = row._max.createdAt;
    if (at && (!e.lastActivityAt || at > e.lastActivityAt)) e.lastActivityAt = at;
    perEvent.set(row.eventId, e);
  }
  for (const eventId of paid) if (!perEvent.has(eventId)) perEvent.set(eventId, { views: 0, seatActions: 0, checkoutsStarted: 0, abandoned: 0, paymentsFailed: 0, boughtSignals: 0, actions: 1, lastActivityAt: null });
  if (!perEvent.size) return [];

  const details = await prisma.event.findMany({
    where: { id: { in: [...perEvent.keys()] } },
    select: { id: true, name: true, type: true, city: true, date: true },
  });
  const byId = new Map(details.map((d) => [d.id, d]));

  return [...perEvent.entries()]
    .filter(([eventId]) => byId.has(eventId))
    .map(([eventId, e]) => {
      const purchased = paid.has(eventId);
      let score = 10;
      score += Math.min(24, e.views * 6);
      if (e.seatActions > 0) score += 20 + (e.seatActions >= 3 ? 5 : 0);
      if (e.checkoutsStarted > 0) score += 25;
      if (e.abandoned > 0 && e.abandoned >= e.checkoutsStarted) score -= 10;
      if (e.paymentsFailed > 0) score -= 5;
      if (e.lastActivityAt && Date.now() - new Date(e.lastActivityAt).getTime() > 14 * DAY_MS) score -= 10;
      score = purchased ? 100 : Math.max(0, Math.min(95, score));
      const d = byId.get(eventId);
      return {
        eventId,
        eventName: d.name,
        eventType: d.type,
        city: d.city,
        eventDate: d.date,
        score,
        tier: intentTier(score, purchased),
        purchased,
        actions: e.actions,
        signals: { views: e.views, seatActions: e.seatActions, checkoutsStarted: e.checkoutsStarted, abandoned: e.abandoned, paymentsFailed: e.paymentsFailed },
        lastActivityAt: e.lastActivityAt,
      };
    })
    .sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0));
}

/**
 * Overall intent across all events: the per-event scores averaged, weighted by how much the user did on each
 * event. With no event activity yet, a low score that rises slightly with category browsing.
 */
function overallIntent(perEvent, counts) {
  let score;
  if (perEvent.length) {
    const weight = perEvent.reduce((sum, e) => sum + e.actions, 0) || 1;
    score = Math.round(perEvent.reduce((sum, e) => sum + e.score * e.actions, 0) / weight);
  } else {
    score = Math.min(30, 10 + (counts.categoriesViewed || 0) * 4);
  }
  const tier = intentTier(score, false);
  const bought = perEvent.filter((e) => e.purchased).length;
  const engagement = tier === 'HIGH' ? 'Highly engaged attendee' : tier === 'MODERATE' ? 'Browsing customer' : 'Passive visitor';
  const description = !perEvent.length
    ? 'No event activity yet'
    : bought ? `${engagement} · bought tickets for ${bought} of ${perEvent.length} event${perEvent.length === 1 ? '' : 's'}` : engagement;
  return { score, tier, description };
}

/** Event categories by the user's activity on them, most active first. */
function categoryAffinity(perEvent) {
  const byType = new Map();
  for (const e of perEvent) byType.set(e.eventType, (byType.get(e.eventType) || 0) + e.actions);
  return [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
}

export default {
  BEHAVIOR_ACTIONS,
  extractSessionId,
  trackBehavior,
  attachSessionToUser,
  getUserBehavioralProfile,
};
