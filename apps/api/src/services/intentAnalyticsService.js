import prisma from '../config/prisma.js';
import mlService from './mlService.js';
import { dispatchNotification, NOTIFICATION_TYPES } from './notificationService.js';

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
  if (requesterUser.role !== 'SUPER_ADMIN' && event.company.userId !== requesterUser.id) {
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
        entry.checkoutAbandons += 1;
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

  // Cross-reference completed orders for this event
  for (const ord of orders) {
    if (ord.status === 'SUCCESSFUL') {
      paymentCompleters.add(ord.userId);
      if (ord.tickets && ord.tickets.length > 0) {
        ticketHolders.add(ord.userId);
      }
      if (userSessionMap.has(ord.userId)) {
        const u = userSessionMap.get(ord.userId);
        u.payments += 1;
        u.tickets += (ord.tickets?.length || 1);
      }
    }
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

  for (const [identifier, profile] of userSessionMap.entries()) {
    const hasBought = profile.tickets > 0 || profile.payments > 0;

    // Use ML intent calculation
    let intentScore = 40.0;
    if (profile.views >= 3) intentScore += 15.0;
    if (profile.seatSelections >= 1) intentScore += 20.0;
    if (profile.checkoutStarts >= 1) intentScore += 25.0;
    if (profile.checkoutAbandons >= 1) intentScore -= 10.0;
    if (hasBought) intentScore = 95.0;

    intentScore = Math.min(99.0, Math.max(10.0, intentScore));
    totalIntentScoreSum += intentScore;
    scoredProspectCount += 1;

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
      hasPurchased: hasBought,
      intentScore: Math.round(intentScore),
      intentLevel,
      recommendedAction,
      lastActive: profile.lastActive,
    };

    // Classify into Users Likely to Buy
    if (intentScore >= 55.0) {
      usersLikelyToBuy.push(prospectData);
    }

    // Classify into Abandoned Users
    if (profile.checkoutAbandons > 0 || (profile.checkoutStarts > 0 && !hasBought) || (profile.seatSelections > 0 && !hasBought)) {
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
    : 65;

  return {
    eventId: event.id,
    eventName: event.name,
    eventType: event.type,
    city: event.city,
    venue: event.venue,
    eventDate: event.date,
    companyName: event.company.companyName,
    summary: {
      totalWatchers: viewedCount,
      usersLikelyToBuyCount: usersLikelyToBuy.length,
      abandonedUsersCount: abandonedUsers.length,
      ticketsIssuedCount: ticketIssuedCount,
      overallConversionRate: Math.min(100, Math.round((ticketIssuedCount / viewedCount) * 100)),
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
  if (requesterUser.role !== 'SUPER_ADMIN' && event.company.userId !== requesterUser.id) {
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
  const eventWhere = {};
  if (requesterUser.role !== 'SUPER_ADMIN') {
    const company = await prisma.company.findUnique({
      where: { userId: requesterUser.id },
    });
    if (!company) {
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
    eventWhere.companyId = company.id;
  }

  if (eventId) {
    eventWhere.id = eventId;
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
      status: 'SUCCESSFUL',
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
      status: 'ACTIVE',
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
    if (b.action === 'checkout_abandoned') item.abandonedCheckout = true;

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

    // Calculate Purchase Intent Score
    let score = 45;
    if (item.views >= 2) score += 10;
    if (item.selectedSeat) score += 15;
    if (item.startedCheckout) score += 20;
    if (item.abandonedCheckout) score -= 10;
    score = Math.min(95, Math.max(15, score));

    if (minScore && score < Number(minScore)) continue;

    // Calculate approximate cart value
    const basePrice = item.event?.tiers?.length > 0 
      ? Number(item.event.tiers[0].price) 
      : 2500;
    const cartValue = item.latestMetadata?.cartValue 
      ? Number(item.latestMetadata.cartValue) 
      : basePrice * 2;

    // Infer Likely Reason
    let likelyReason = 'PAYMENT_HESITATION';
    let reasonDetail = 'Attendee hesitated during final payment confirmation.';
    let recommendedAction = 'SEND_10_PERCENT_DISCOUNT';

    const explicitReason = item.latestMetadata?.reason;
    if (explicitReason === 'payment_hesitation' || explicitReason === 'payment_failure') {
      likelyReason = 'PAYMENT_FRICTION';
      reasonDetail = 'Friction during payment gateway interaction.';
      recommendedAction = 'OFFER_JAZZCASH_EASYPAISA_DIRECT';
    } else if (cartValue >= 7000) {
      likelyReason = 'HIGH_TICKET_PRICE';
      reasonDetail = 'Cart total exceeded price sensitivity threshold for this venue.';
      recommendedAction = 'OFFER_FLEXIBLE_INSTALLMENT_OR_DISCOUNT';
    } else if (item.selectedSeat && !item.startedCheckout) {
      likelyReason = 'SEAT_LOCK_TIMEOUT';
      reasonDetail = '10-minute Redis seat lock expired before proceeding to checkout.';
      recommendedAction = 'HOLD_SEATS_EXTRA_15_MINUTES';
    } else if (item.views >= 4) {
      likelyReason = 'COMPARISON_SHOPPING';
      reasonDetail = 'Multiple view cycles indicate comparison across dates or tier enclosures.';
      recommendedAction = 'SEND_LIMITED_INVENTORY_ALERT';
    } else {
      likelyReason = 'BROWSER_HESITATION';
      reasonDetail = 'Attendee closed session prior to completing checkout.';
      recommendedAction = 'DISPATCH_EVENT_REMINDER';
    }

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
      intentLevel: score >= 70 ? 'HIGH' : score >= 45 ? 'MODERATE' : 'LOW',
      cartValue,
      likelyReason,
      reasonDetail,
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

  // Determine top reason
  let topReason = 'PAYMENT_HESITATION';
  let topReasonMax = 0;
  for (const [r, count] of Object.entries(reasonCounts)) {
    if (count > topReasonMax) {
      topReasonMax = count;
      topReason = r;
    }
  }

  const registeredDropouts = abandonedList.filter((a) => a.user.isRegistered).length;

  return {
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
  discountCode = 'RECOVER10',
  requesterUser,
}) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { company: true },
  });

  if (!event) {
    throw new Error('Event not found');
  }

  if (requesterUser.role !== 'SUPER_ADMIN' && event.company.userId !== requesterUser.id) {
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

  const title = `Your seats for ${event.name} are waiting!`;
  const message = customMessage || `Hi ${user.name}, you left seats in your cart for ${event.name} in ${event.city}. Use code ${discountCode} for 10% off your checkout before seats are released!`;

  const notificationRes = await dispatchNotification({
    userId: targetUserId,
    type: NOTIFICATION_TYPES.ABANDONED_CHECKOUT_REMINDER,
    title,
    message,
    data: {
      eventId: event.id,
      eventName: event.name,
      city: event.city,
      discountCode,
      actionUrl: `/events/${event.id}`,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: requesterUser.id,
      action: 'ORGANIZER_SENT_ABANDONED_CART_REMINDER',
      targetType: 'User',
      targetId: targetUserId,
      details: {
        eventId: event.id,
        eventName: event.name,
        targetEmail: user.email,
        discountCode,
      },
    },
  });

  return {
    success: true,
    message: `Cart recovery reminder sent to ${user.name} (${user.email})!`,
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
 * Batch send recovery reminders to all eligible abandoned users
 */
export const sendBatchAbandonedCartReminders = async ({
  eventId,
  discountCode = 'RECOVER10',
  requesterUser,
}) => {
  const dashboard = await getAbandonedIntentDashboard({
    eventId,
    requesterUser,
  });

  const eligibleUsers = dashboard.abandonedUsers.filter((a) => a.user.id);

  let sentCount = 0;
  for (const attendee of eligibleUsers) {
    try {
      await sendAbandonedCartReminder({
        targetUserId: attendee.user.id,
        eventId: attendee.event.id,
        discountCode,
        requesterUser,
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

