// Reference copy of services/intentAnalyticsService.js BEFORE its counts moved into SQL (2026-11-24): it loads
// every behaviour row into memory. Used only by test_intent_analytics_sql.mjs to check the SQL version gives the
// same results. Not used by the app.
import { canAccessEvent, eventWhereFor, memberContext } from '../src/services/orgAccess.js';
import { LEFT_CHECKOUT_ACTIONS } from '../src/services/checkoutOutcome.js';
import prisma from '../src/config/prisma.js';
import { dispatchNotification, NOTIFICATION_TYPES } from '../src/services/notificationService.js';
import { createRecoveryCode, normalizeCode, MAX_PERCENT } from '../src/services/discountService.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * The discount a recovery reminder carries:
 *   - discountCode: an existing code of the organization that works on this event (shared by everyone reminded)
 *   - discountPercent: a new personal, single-use code for this customer (valid `validHours`, default 48)
 *   - neither: no discount, just the reminder
 */
async function recoveryDiscount({ event, targetUserId, discountCode, discountPercent, validHours, requesterUser }) {
  const code = normalizeCode(discountCode);
  if (code) {
    const dc = await prisma.discountCode.findUnique({ where: { companyId_code: { companyId: event.companyId, code } } });
    if (!dc || !dc.active || (dc.eventId && dc.eventId !== event.id)) throw httpError(400, `"${code}" is not an active discount code for this event. Create it under Discount codes first, or send a personal code instead.`);
    if (dc.endsAt && dc.endsAt <= new Date()) throw httpError(400, `"${code}" has expired.`);
    if (dc.restrictedToUserId && dc.restrictedToUserId !== targetUserId) throw httpError(400, `"${code}" is a personal code for another customer.`);
    return dc;
  }
  if (discountPercent) {
    const pct = Number(discountPercent);
    if (!(pct >= 1 && pct <= MAX_PERCENT)) throw httpError(400, `The discount must be between 1 and ${MAX_PERCENT}%.`);
    return createRecoveryCode({ companyId: event.companyId, eventId: event.id, userId: targetUserId, percent: pct, validHours: validHours || 48, createdById: requesterUser.id });
  }
  return null;
}

export const offerText = (dc) => {
  if (!dc) return '';
  const amount = dc.type === 'PERCENT' ? `${Number(dc.value)}% off` : `PKR ${Number(dc.value).toLocaleString()} off`;
  const until = dc.endsAt ? ` before ${dc.endsAt.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' })}` : '';
  return ` Use code ${dc.code} at checkout for ${amount}${until}.`;
};

/**
 * The one intent rule both pages use (Purchase intent and Abandoned checkouts): 40 base, +15 for 3+ views,
 * +20 seat chosen, +25 checkout started, −10 left a checkout, 95 once bought; kept within 10..99.
 * HIGH = 75+, MODERATE = 55+, else LOW.
 */
export function intentRuleScore({ views = 0, seatChosen = false, checkoutStarted = false, leftCheckout = false, bought = false }) {
  let score = 40;
  if (views >= 3) score += 15;
  if (seatChosen) score += 20;
  if (checkoutStarted) score += 25;
  if (leftCheckout) score -= 10;
  if (bought) score = 95;
  score = Math.min(99, Math.max(10, score));
  return { score, level: score >= 75 ? 'HIGH' : score >= 55 ? 'MODERATE' : 'LOW' };
}

/**
 * Service to aggregate purchase intent analytics, conversion funnels, and attendee engagement for an event
 */
export const getEventIntentAnalytics = async (eventId, requesterUser) => {
  // 1. Fetch event details with company info
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      company: {
        select: { id: true, userId: true, companyName: true },
      },
      tiers: {
        select: { id: true, name: true, price: true, totalQuantity: true, availableQuantity: true },
      },
    },
  });

  if (!event) {
    throw new Error('Event not found');
  }

  // 2. Validate organizer access
  if (!(await canAccessEvent(requesterUser, event, { permission: 'attendee.view' }))) {
    const error = new Error('Access denied: You can only view analytics for your own events');
    error.status = 403;
    throw error;
  }

  // 3. Fetch all behavior events recorded for this event
  const rawBehaviorEvents = await prisma.behaviorEvent.findMany({
    where: { eventId },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, city: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Also fetch orders for this event to verify completed payments and tickets
  const orders = await prisma.order.findMany({
    where: { eventId },
    include: {
      tickets: true,
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  // 4. Calculate Conversion Funnel Stages
  // Stages: Viewed -> Seat Selected -> Checkout Started -> Payment Completed -> Ticket Issued
  const viewers = new Set();
  const seatSelectors = new Set();
  const checkoutStarters = new Set();
  const paymentCompleters = new Set();
  const ticketHolders = new Set();

  // Track session/user behavior maps
  const userSessionMap = new Map();

  for (const b of rawBehaviorEvents) {
    const identifier = b.userId || b.sessionId;
    if (!identifier) continue;

    if (!userSessionMap.has(identifier)) {
      userSessionMap.set(identifier, {
        userId: b.userId,
        sessionId: b.sessionId,
        user: b.user,
        views: 0,
        seatSelections: 0,
        checkoutStarts: 0,
        checkoutAbandons: 0,
        payments: 0,
        tickets: 0,
        lastActive: b.createdAt,
        latestMetadata: b.metadata || {},
      });
    }

    const entry = userSessionMap.get(identifier);
    if (b.createdAt > entry.lastActive) {
      entry.lastActive = b.createdAt;
    }

    switch (b.action) {
      case 'event_view':
        viewers.add(identifier);
        entry.views += 1;
        break;
      case 'seat_selected':
      case 'seat_locked':
        viewers.add(identifier);
        seatSelectors.add(identifier);
        entry.seatSelections += 1;
        break;
      case 'checkout_started':
        viewers.add(identifier);
        seatSelectors.add(identifier);
        checkoutStarters.add(identifier);
        entry.checkoutStarts += 1;
        break;
      case 'checkout_abandoned':
      case 'checkout_cancelled':
      case 'seat_hold_released':
      case 'checkout_expired':
        entry.checkoutAbandons += 1; // "left checkout", any reason (reasons kept apart for ML)
        break;
      case 'payment_completed':
        paymentCompleters.add(identifier);
        entry.payments += 1;
        break;
      case 'ticket_purchased':
        ticketHolders.add(identifier);
        entry.tickets += 1;
        break;
      default:
        break;
    }
  }

  // Completed orders are the truth for who paid: a signed-in person's payments and tickets come from their
  // orders (the payment_completed / ticket_purchased events are the same purchases, so they are not added again)
  const paidByUser = new Map();
  for (const ord of orders) {
    if (ord.status !== 'SUCCESSFUL' && ord.status !== 'PARTIALLY_REFUNDED') continue;
    paymentCompleters.add(ord.userId);
    if (ord.tickets && ord.tickets.length > 0) ticketHolders.add(ord.userId);
    const p = paidByUser.get(ord.userId) || { orders: 0, tickets: 0 };
    p.orders += 1;
    p.tickets += ord.tickets?.length || 0;
    paidByUser.set(ord.userId, p);
  }
  for (const u of userSessionMap.values()) {
    if (!u.userId) continue;
    const p = paidByUser.get(u.userId);
    u.payments = p?.orders || 0;
    u.tickets = p?.tickets || 0;
  }

  // If synthetic/low event behavior count in early stage, ensure baseline realism
  const viewedCount = Math.max(viewers.size, 1);
  const seatSelectedCount = seatSelectors.size;
  const checkoutCount = checkoutStarters.size;
  const paymentCount = paymentCompleters.size;
  const ticketIssuedCount = ticketHolders.size;

  const funnel = [
    { stage: 'Viewed Event', key: 'viewed', count: viewedCount, percent: 100 },
    {
      stage: 'Seat Selected',
      key: 'seat_selected',
      count: seatSelectedCount,
      percent: Math.min(100, Math.round((seatSelectedCount / viewedCount) * 100)),
      dropoff: Math.max(0, viewedCount - seatSelectedCount),
    },
    {
      stage: 'Checkout Started',
      key: 'checkout_started',
      count: checkoutCount,
      percent: Math.min(100, Math.round((checkoutCount / viewedCount) * 100)),
      dropoff: Math.max(0, seatSelectedCount - checkoutCount),
    },
    {
      stage: 'Payment Completed',
      key: 'payment_completed',
      count: paymentCount,
      percent: Math.min(100, Math.round((paymentCount / viewedCount) * 100)),
      dropoff: Math.max(0, checkoutCount - paymentCount),
    },
    {
      stage: 'Ticket Issued',
      key: 'ticket_issued',
      count: ticketIssuedCount,
      percent: Math.min(100, Math.round((ticketIssuedCount / viewedCount) * 100)),
      dropoff: Math.max(0, paymentCount - ticketIssuedCount),
    },
  ];

  // 5. Evaluate Individual Purchase Intent Scores & Classify Users
  const avgTicketPrice = event.tiers.length > 0 
    ? Number(event.tiers[0].price) 
    : 2500;

  const usersLikelyToBuy = [];
  const abandonedUsers = [];
  let totalIntentScoreSum = 0;
  let scoredProspectCount = 0;
  let highIntentCount = 0;
  let buyersCount = 0;
  let abandonedCheckouts = 0; // checkout attempts that did not end in a payment (also by people who bought later)
  let abandonedCheckoutPeople = 0;
  let signedInWatchers = 0;

  for (const [identifier, profile] of userSessionMap.entries()) {
    const hasBought = profile.tickets > 0 || profile.payments > 0;
    // Every checkout start that did not end in a paid order counts as one abandoned checkout
    const leftCheckouts = Math.max(profile.checkoutAbandons, profile.checkoutStarts - profile.payments, 0);
    abandonedCheckouts += leftCheckouts;
    if (leftCheckouts > 0) abandonedCheckoutPeople += 1;
    if (hasBought) buyersCount += 1;
    if (profile.userId) signedInWatchers += 1;

    // Rule-based intent score (fixed points per signal; no model). Step 6: labelled score_source 'rules'.
    const { score: intentScore } = intentRuleScore({
      views: profile.views, seatChosen: profile.seatSelections >= 1, checkoutStarted: profile.checkoutStarts >= 1,
      leftCheckout: profile.checkoutAbandons >= 1, bought: hasBought,
    });
    // The average describes people who have NOT bought yet (buyers are fixed at 95 and would inflate it)
    if (!hasBought) {
      totalIntentScoreSum += intentScore;
      scoredProspectCount += 1;
    }

    let intentLevel = 'LOW';
    let recommendedAction = 'PASSIVE_RETENTION';
    if (intentScore >= 75.0) {
      intentLevel = 'HIGH';
      recommendedAction = 'SEND_LIMITED_OFFER_REMINDER';
    } else if (intentScore >= 55.0) {
      intentLevel = 'MODERATE';
      recommendedAction = 'DISPATCH_EVENT_REMINDER';
    } else {
      recommendedAction = 'TARGET_SOCIAL_PROMOTION';
    }

    const prospectData = {
      identifier,
      userId: profile.userId,
      userName: profile.user?.name || 'Guest Attendee',
      userEmail: profile.user?.email || null,
      userPhone: profile.user?.phone || null,
      isRegistered: Boolean(profile.userId),
      views: profile.views,
      seatSelections: profile.seatSelections,
      checkoutStarts: profile.checkoutStarts,
      abandonedCheckouts: leftCheckouts,
      ordersPaid: profile.payments,
      hasPurchased: hasBought,
      intentScore: Math.round(intentScore),
      intentLevel,
      recommendedAction,
      lastActive: profile.lastActive,
    };

    // Users likely to buy: people who have NOT bought yet with a score of 55+ (reminding a buyer makes no sense)
    if (intentScore >= 55.0 && !hasBought) {
      usersLikelyToBuy.push(prospectData);
      if (intentLevel === 'HIGH') highIntentCount += 1;
    }

    // To recover: people who chose seats or started checkout and have NOT bought
    if (!hasBought && (profile.checkoutAbandons > 0 || profile.checkoutStarts > 0 || profile.seatSelections > 0)) {
      abandonedUsers.push({
        ...prospectData,
        abandonmentStage: profile.checkoutStarts > 0 
          ? 'CHECKOUT_STAGE' 
          : profile.seatSelections > 0 
          ? 'SEAT_SELECTION_STAGE' 
          : 'VIEW_STAGE',
        recommendedRecoveryAction: profile.checkoutStarts > 0 
          ? 'DISPATCH_ABANDONED_CART_DISCOUNT' 
          : 'SEND_SEAT_RELEASE_NOTIFICATION',
      });
    }
  }

  // Sort by intent score descending
  usersLikelyToBuy.sort((a, b) => b.intentScore - a.intentScore);
  abandonedUsers.sort((a, b) => b.intentScore - a.intentScore);

  const avgIntentScore = scoredProspectCount > 0 
    ? Math.round(totalIntentScoreSum / scoredProspectCount) 
    : 0; // no prospects: no score (was a made-up 65)

  return {
    score_source: 'rules',
    eventId: event.id,
    eventName: event.name,
    eventType: event.type,
    city: event.city,
    venue: event.venue,
    eventDate: event.date,
    companyName: event.company.companyName,
    summary: {
      totalWatchers: viewers.size,
      signedInWatchers,
      guestWatchers: Math.max(0, userSessionMap.size - signedInWatchers),
      usersLikelyToBuyCount: usersLikelyToBuy.length,
      highIntentCount,
      moderateIntentCount: usersLikelyToBuy.length - highIntentCount,
      buyersCount,
      abandonedUsersCount: abandonedUsers.length,
      abandonedCheckouts,
      abandonedCheckoutPeople,
      ticketsIssuedCount: ticketIssuedCount,
      overallConversionRate: viewers.size ? Math.min(100, Math.round((ticketIssuedCount / viewers.size) * 100)) : 0,
      avgIntentScore,
    },
    funnel,
    usersLikelyToBuy,
    abandonedUsers,
  };
};

/**
 * Dispatch targeted purchase intent reminder to a specific user
 */
export const sendAttendeeReminder = async ({
  eventId,
  targetUserId,
  reminderType = 'ABANDONED_CHECKOUT_REMINDER',
  customMessage = null,
  requesterUser,
}) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { company: true },
  });

  if (!event) {
    throw new Error('Event not found');
  }

  // Permission check
  if (!(await canAccessEvent(requesterUser, event, { permission: 'attendee.contact' }))) {
    const error = new Error('Access denied: You cannot send reminders for this event');
    error.status = 403;
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
  });

  if (!user) {
    throw new Error('Target user not found');
  }

  const title = `Reminder: Complete your booking for ${event.name}!`;
  const message = customMessage || `Hi ${user.name}, you recently checked seats for ${event.name} in ${event.city}. Tickets are selling out fast — secure your NFT pass before sales close!`;

  // Dispatch via Multi-Channel Notification Engine (Module 12)
  const notificationRes = await dispatchNotification({
    userId: targetUserId,
    type: reminderType,
    title,
    message,
    data: {
      eventId: event.id,
      eventName: event.name,
      city: event.city,
      venue: event.venue,
      actionUrl: `/events/${event.id}`,
    },
  });

  // Log in AuditLog
  await prisma.auditLog.create({
    data: {
      userId: requesterUser.id,
      action: 'ORGANIZER_SENT_INTENT_REMINDER',
      targetType: 'User',
      targetId: targetUserId,
      details: {
        eventId: event.id,
        eventName: event.name,
        targetEmail: user.email,
        reminderType,
      },
    },
  });

  return {
    success: true,
    message: `Reminder successfully sent to ${user.name} (${user.email})`,
    notification: {
      id: notificationRes.notification?.id,
      userId: targetUserId,
      type: reminderType,
      title,
      message,
    },
  };
};

/**
 * Batch dispatch reminders to all high-intent or abandoned users
 */
export const sendBatchAttendeeReminders = async ({
  eventId,
  targetAudience = 'HIGH_INTENT', // 'HIGH_INTENT' or 'ABANDONED'
  requesterUser,
}) => {
  const analytics = await getEventIntentAnalytics(eventId, requesterUser);
  const targetList = targetAudience === 'ABANDONED' 
    ? analytics.abandonedUsers 
    : analytics.usersLikelyToBuy;

  // Filter only registered users with valid userIds
  const eligibleUsers = targetList.filter((u) => u.userId);

  let sentCount = 0;
  for (const recipient of eligibleUsers) {
    try {
      await sendAttendeeReminder({
        eventId,
        targetUserId: recipient.userId,
        reminderType: targetAudience === 'ABANDONED' 
          ? NOTIFICATION_TYPES.ABANDONED_CHECKOUT_REMINDER 
          : NOTIFICATION_TYPES.EVENT_REMINDER,
        requesterUser,
      });
      sentCount += 1;
    } catch (err) {
      console.warn(`Failed to dispatch reminder to user ${recipient.userId}:`, err.message);
    }
  }

  return {
    success: true,
    dispatchedCount: sentCount,
    totalEligible: eligibleUsers.length,
    targetAudience,
    message: `Successfully dispatched ${sentCount} reminders to ${targetAudience} audience.`,
  };
};

/**
 * Cart value from what was recorded: the newest checkout amount (cartValue / totalAmount), else the newest
 * held seat's price, else the event's cheapest tier (an estimate, labelled as such). Never a made-up figure.
 */
function cartValueOf(item, event) {
  const newest = [...item.allActions].sort((x, y) => y.time - x.time);
  for (const a of newest) {
    const v = Number(a.metadata?.cartValue ?? a.metadata?.totalAmount);
    if (v > 0) return { cartValue: v, cartValueSource: 'recorded' };
  }
  for (const a of newest) {
    const v = Number(a.metadata?.price);
    if ((a.action === 'seat_locked' || a.action === 'seat_selected') && v > 0) return { cartValue: v, cartValueSource: 'seat_price' };
  }
  const prices = (event?.tiers || []).map((t) => Number(t.price)).filter((x) => x > 0);
  return { cartValue: prices.length ? Math.min(...prices) : 0, cartValueSource: prices.length ? 'cheapest_tier' : 'unknown' };
}

/**
 * Why the person left: a RECORDED reason when the app logged one (payment failed, removed tickets, seat hold ran
 * out), otherwise only what the steps show (labelled as not recorded). No reason is invented.
 */
function abandonReason(item) {
  const acts = item.allActions;
  const reasons = new Set(acts.map((a) => a.metadata?.reason).filter(Boolean));
  const did = (name) => acts.some((a) => a.action === name);
  if (did('payment_failed') || reasons.has('payment_failure') || reasons.has('payment_hesitation')) {
    return { likelyReason: 'PAYMENT_FAILED', reasonSource: 'recorded', reasonDetail: 'A payment attempt failed or was not completed at the payment step.', recommendedAction: 'OFFER_PAYMENT_HELP' };
  }
  if (did('checkout_cancelled') || reasons.has('user_discarded_tickets') || reasons.has('CUSTOMER_CANCELLED')) {
    return { likelyReason: 'REMOVED_TICKETS', reasonSource: 'recorded', reasonDetail: 'They removed the tickets from their cart themselves.', recommendedAction: 'SEND_REMINDER_WITH_DISCOUNT' };
  }
  if (did('checkout_expired') || did('seat_hold_released') || reasons.has('seat_hold_released') || reasons.has('HOLD_EXPIRED')) {
    return { likelyReason: 'HOLD_EXPIRED', reasonSource: 'recorded', reasonDetail: 'The 10-minute seat hold ran out before they paid.', recommendedAction: 'SEND_REMINDER' };
  }
  if (item.startedCheckout) {
    return { likelyReason: 'LEFT_AT_CHECKOUT', reasonSource: 'steps', reasonDetail: 'Opened checkout and left without paying. No reason was recorded.', recommendedAction: 'SEND_REMINDER' };
  }
  return { likelyReason: 'LEFT_AFTER_SEAT', reasonSource: 'steps', reasonDetail: 'Chose a seat but never opened checkout. No reason was recorded.', recommendedAction: 'SEND_REMINDER' };
}

/**
 * MODULE 18: Global Abandoned Intent Dashboard
 * Evaluates attendees who:
 * - viewed event,
 * - selected seat,
 * - started checkout,
 * - abandoned checkout,
 * - did not buy.
 */
export const getAbandonedIntentDashboard = async ({
  eventId,
  minScore,
  reason,
  limit = 50,
  requesterUser,
}) => {
  // 1. Determine events accessible by the requester
  let eventWhere = {};
  if (requesterUser.role !== 'SUPER_ADMIN') {
    const ctx = await memberContext(requesterUser);
    if (!ctx || !ctx.permissions.has('attendee.view')) {
      return {
        summary: {
          totalAbandonedUsers: 0,
          recoverableRevenuePkr: 0,
          avgIntentScore: 0,
          topReason: 'NONE',
          registeredDropouts: 0,
        },
        abandonedUsers: [],
      };
    }
    eventWhere = eventWhereFor(ctx, 'attendee.view');
  }

  if (eventId) {
    eventWhere = { AND: [eventWhere, { id: eventId }] };
  }

  const accessibleEvents = await prisma.event.findMany({
    where: eventWhere,
    include: {
      tiers: { select: { id: true, name: true, price: true } },
    },
  });

  const accessibleEventIds = accessibleEvents.map((e) => e.id);
  const eventMap = new Map(accessibleEvents.map((e) => [e.id, e]));

  if (accessibleEventIds.length === 0) {
    return {
      score_source: 'rules',
      summary: {
        totalAbandonedUsers: 0,
        recoverableRevenuePkr: 0,
        avgIntentScore: 0,
        topReason: 'NONE',
        registeredDropouts: 0,
      },
      abandonedUsers: [],
    };
  }

  // 2. Fetch all behavior events for these events
  const behaviorEvents = await prisma.behaviorEvent.findMany({
    where: {
      eventId: { in: accessibleEventIds },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, city: true },
      },
      event: {
        select: { id: true, name: true, city: true, venue: true, date: true, type: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 3. Fetch completed orders/tickets for these events to exclude purchasers
  const orders = await prisma.order.findMany({
    where: {
      eventId: { in: accessibleEventIds },
      status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] },
    },
    select: { userId: true, eventId: true },
  });

  const purchasedSet = new Set();
  for (const o of orders) {
    purchasedSet.add(`${o.userId}_${o.eventId}`);
  }

  // Also check ticket records directly
  const tickets = await prisma.ticket.findMany({
    where: {
      eventId: { in: accessibleEventIds },
      status: { in: ['ACTIVE', 'SCANNED'] },
    },
    select: { userId: true, eventId: true },
  });
  for (const t of tickets) {
    purchasedSet.add(`${t.userId}_${t.eventId}`);
  }

  // 4. Group behavior by User/Session per Event
  const groupMap = new Map();

  for (const b of behaviorEvents) {
    const userOrSess = b.userId || b.sessionId;
    const evId = b.eventId;
    if (!userOrSess || !evId) continue;

    const groupKey = `${userOrSess}_${evId}`;

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        userId: b.userId,
        sessionId: b.sessionId,
        user: b.user,
        event: b.event || eventMap.get(evId),
        eventId: evId,
        views: 0,
        selectedSeat: false,
        startedCheckout: false,
        abandonedCheckout: false,
        lastAction: b.action,
        lastActionTime: b.createdAt,
        latestMetadata: b.metadata || {},
        allActions: [],
      });
    }

    const item = groupMap.get(groupKey);
    item.allActions.push({ action: b.action, time: b.createdAt, metadata: b.metadata });

    if (b.action === 'event_view') item.views += 1;
    if (b.action === 'seat_selected' || b.action === 'seat_locked') item.selectedSeat = true;
    if (b.action === 'checkout_started') item.startedCheckout = true;
    if (LEFT_CHECKOUT_ACTIONS.includes(b.action)) item.abandonedCheckout = true;

    if (b.createdAt > item.lastActionTime) {
      item.lastAction = b.action;
      item.lastActionTime = b.createdAt;
      item.latestMetadata = b.metadata || {};
    }
  }

  // 5. Filter for users who engaged/abandoned and DID NOT buy
  const abandonedList = [];
  const reasonCounts = {};
  let totalRevenuePkr = 0;
  let totalScoreSum = 0;

  for (const [key, item] of groupMap.entries()) {
    // Check if user has purchased this event
    const hasBought = item.userId ? purchasedSet.has(`${item.userId}_${item.eventId}`) : false;
    if (hasBought) continue;

    // Must have abandoned checkout OR (started checkout and dropped off) OR (selected seat and dropped off)
    const isAbandoned = item.abandonedCheckout || item.startedCheckout || item.selectedSeat;
    if (!isAbandoned) continue;

    // Same intent rule as the Purchase intent page
    const { score, level } = intentRuleScore({
      views: item.views, seatChosen: item.selectedSeat, checkoutStarted: item.startedCheckout, leftCheckout: item.abandonedCheckout,
    });
    if (minScore && score < Number(minScore)) continue;

    const { cartValue, cartValueSource } = cartValueOf(item, eventMap.get(item.eventId));
    const { likelyReason, reasonDetail, recommendedAction, reasonSource } = abandonReason(item);

    if (reason && reason !== 'ALL' && likelyReason !== reason) {
      continue;
    }

    reasonCounts[likelyReason] = (reasonCounts[likelyReason] || 0) + 1;
    totalRevenuePkr += cartValue;
    totalScoreSum += score;

    abandonedList.push({
      id: key,
      user: {
        id: item.userId,
        name: item.user?.name || 'Guest Attendee',
        email: item.user?.email || null,
        phone: item.user?.phone || null,
        city: item.user?.city || item.event?.city || 'Pakistan',
        isRegistered: Boolean(item.userId),
      },
      sessionId: item.sessionId,
      event: {
        id: item.event?.id || item.eventId,
        name: item.event?.name || 'Event',
        city: item.event?.city,
        venue: item.event?.venue,
        date: item.event?.date,
        type: item.event?.type,
      },
      lastAction: item.lastAction,
      lastActionTime: item.lastActionTime,
      intentScore: Math.round(score),
      intentLevel: level,
      cartValue,
      cartValueSource,
      likelyReason,
      reasonDetail,
      reasonSource,
      recommendedAction,
      hasViewed: item.views > 0,
      hasSelectedSeat: item.selectedSeat,
      hasStartedCheckout: item.startedCheckout,
      hasAbandonedCheckout: item.abandonedCheckout,
    });
  }

  // Sort by lastActionTime descending
  abandonedList.sort((a, b) => new Date(b.lastActionTime) - new Date(a.lastActionTime));

  const totalCount = abandonedList.length;
  const avgIntent = totalCount > 0 ? Math.round(totalScoreSum / totalCount) : 0;

  // Determine top reason (none when nobody is listed)
  let topReason = null;
  let topReasonMax = 0;
  for (const [r, count] of Object.entries(reasonCounts)) {
    if (count > topReasonMax) {
      topReasonMax = count;
      topReason = r;
    }
  }

  const registeredDropouts = abandonedList.filter((a) => a.user.isRegistered).length;

  return {
    score_source: 'rules',
    summary: {
      totalAbandonedUsers: totalCount,
      recoverableRevenuePkr: totalRevenuePkr,
      avgIntentScore: avgIntent,
      topReason,
      registeredDropouts,
    },
    abandonedUsers: abandonedList.slice(0, Number(limit)),
  };
};

/**
 * Send targeted recovery reminder to an abandoned user
 */
export const sendAbandonedCartReminder = async ({
  targetUserId,
  eventId,
  customMessage = null,
  discountCode = null,
  discountPercent = null,
  validHours = 48,
  requesterUser,
  sharedCode = undefined, // batch: one existing code checked once for everyone
}) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { company: true },
  });

  if (!event) {
    throw httpError(404, 'Event not found');
  }

  if (!(await canAccessEvent(requesterUser, event, { permission: 'attendee.contact' }))) {
    throw httpError(403, 'Access denied: You cannot send reminders for this event');
  }

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
  });

  if (!user) {
    throw httpError(404, 'Target user not found');
  }

  const dc = sharedCode !== undefined ? sharedCode : await recoveryDiscount({ event, targetUserId, discountCode, discountPercent, validHours, requesterUser });
  const title = `Your seats for ${event.name} are waiting!`;
  const message = (customMessage || `Hi ${user.name}, you left seats in your cart for ${event.name} in ${event.city}. Seats are selling, so pick yours again soon.`) + offerText(dc);
  // The link opens the event with the code ready to apply at checkout
  const actionUrl = `/events/${event.id}${dc ? `?code=${encodeURIComponent(dc.code)}` : ''}`;

  const notificationRes = await dispatchNotification({
    userId: targetUserId,
    type: NOTIFICATION_TYPES.ABANDONED_CHECKOUT_REMINDER,
    title,
    message,
    data: {
      eventId: event.id,
      eventName: event.name,
      city: event.city,
      discountCode: dc?.code || null,
      actionUrl,
    },
  });

  await prisma.recoveryReminder.create({ data: { companyId: event.companyId, eventId: event.id, userId: targetUserId, discountCodeId: dc?.id || null, source: 'MANUAL', sentById: requesterUser.id } });
  await prisma.auditLog.create({
    data: {
      userId: requesterUser.id,
      companyId: event.companyId,
      action: 'ORGANIZER_SENT_ABANDONED_CART_REMINDER',
      targetType: 'User',
      targetId: targetUserId,
      details: {
        eventId: event.id,
        eventName: event.name,
        targetEmail: user.email,
        discountCode: dc?.code || null,
        discountCodeId: dc?.id || null,
        personalCode: dc?.source === 'CART_RECOVERY',
      },
    },
  });

  return {
    success: true,
    message: `Cart recovery reminder sent to ${user.name} (${user.email})${dc ? ` with code ${dc.code}` : ''}!`,
    discountCode: dc ? { code: dc.code, type: dc.type, value: Number(dc.value), endsAt: dc.endsAt, personal: dc.source === 'CART_RECOVERY' } : null,
    notification: {
      id: notificationRes.notification?.id,
      userId: targetUserId,
      type: NOTIFICATION_TYPES.ABANDONED_CHECKOUT_REMINDER,
      title,
      message,
    },
  };
};

/**
 * Batch send recovery reminders to all eligible abandoned users. With discountPercent everyone gets their own
 * single-use code; with discountCode everyone gets the same existing code.
 */
export const sendBatchAbandonedCartReminders = async ({
  eventId,
  discountCode = null,
  discountPercent = null,
  validHours = 48,
  requesterUser,
}) => {
  const dashboard = await getAbandonedIntentDashboard({
    eventId,
    requesterUser,
  });

  const eligibleUsers = dashboard.abandonedUsers.filter((a) => a.user.id);

  // An existing code is checked once per event up front, so a bad code fails the batch instead of every send
  const sharedByEvent = new Map();
  if (normalizeCode(discountCode)) {
    for (const eid of new Set(eligibleUsers.map((a) => a.event.id))) {
      const event = await prisma.event.findUnique({ where: { id: eid }, select: { id: true, companyId: true } });
      sharedByEvent.set(eid, await recoveryDiscount({ event, targetUserId: null, discountCode, requesterUser }));
    }
  }

  let sentCount = 0;
  for (const attendee of eligibleUsers) {
    try {
      await sendAbandonedCartReminder({
        targetUserId: attendee.user.id,
        eventId: attendee.event.id,
        discountPercent: sharedByEvent.size ? null : discountPercent,
        validHours,
        requesterUser,
        ...(sharedByEvent.size ? { sharedCode: sharedByEvent.get(attendee.event.id) } : {}),
      });
      sentCount += 1;
    } catch (err) {
      console.warn(`Failed to dispatch recovery reminder to user ${attendee.user.id}:`, err.message);
    }
  }

  return {
    success: true,
    dispatchedCount: sentCount,
    totalEligible: eligibleUsers.length,
    message: `Successfully dispatched ${sentCount} recovery reminders to abandoned attendees!`,
  };
};

export default {
  getEventIntentAnalytics,
  sendAttendeeReminder,
  sendBatchAttendeeReminders,
  getAbandonedIntentDashboard,
  sendAbandonedCartReminder,
  sendBatchAbandonedCartReminders,
};

