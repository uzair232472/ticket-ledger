import { eventWhereFor, memberContext } from './orgAccess.js';
import { LEFT_CHECKOUT_ACTIONS } from './checkoutOutcome.js';
import { getSetting } from './systemConfig.js';
import prisma from '../config/prisma.js';
import { showRate } from './ml/attendanceBaseline.js';

/**
 * Service to aggregate comprehensive organizer dashboard metrics, sales charts,
 * tier breakdowns, live turnstile entry pacing, attendance predictions, and fraud feeds.
 */
export const getOrganizerDashboardMetrics = async (args) => withAccess(await buildDashboard(args), args);

const buildDashboard = async ({ organizerUser, eventId = null, orgContext = null }) => {
  // 1. The organization (membership) and what this member may see. Super Admins see every event.
  let ctx = null;
  const eventWhere = {};
  if (organizerUser.role !== 'SUPER_ADMIN' || orgContext) {
    ctx = orgContext ?? (await memberContext(organizerUser));
    if (!ctx || !ctx.permissions.has('event.view')) {
      return {
        hasCompany: false,
        message: 'No company registered for this organizer.',
        events: [],
        metrics: null,
      };
    }
    Object.assign(eventWhere, eventWhereFor(ctx, 'event.view'));
  }

  // 2. Fetch accessible events for this organizer
  const organizerEvents = await prisma.event.findMany({
    where: eventWhere,
    select: {
      id: true,
      name: true,
      type: true,
      city: true,
      venue: true,
      date: true,
      endsAt: true,
      status: true,
      bannerUrl: true,
      cardImageUrl: true,
      reviewComment: true,
      submittedAt: true,
      createdAt: true,
      priorityStatus: true,
      heroStatus: true,
      priorityStartsAt: true,
      priorityEndsAt: true,
      heroStartsAt: true,
      heroEndsAt: true,
      postponedAt: true,
    },
    // Newest first: an event the organizer has just created is at the top of every list and picker
    orderBy: { createdAt: 'desc' },
  });

  const accessibleEventIds = organizerEvents.map((e) => e.id);
  if (accessibleEventIds.length === 0) {
    return {
      hasCompany: true,
      events: [],
      selectedEvent: null,
      salesGraph: [],
      metrics: {
        totalRevenuePkr: 0,
        platformFeePkr: 0,
        netRevenuePkr: 0,
        totalTicketsSold: 0,
        totalCapacity: 0,
        turnoutPercentage: 0,
        liveScannedCount: 0,
        predictedAttendanceRate: 0,
        predictedNoShowRisk: 0,
      },
      tierBreakdown: [],
      liveGatePacing: { scanned: 0, validScans: 0, duplicateScans: 0, remaining: 0 },
      attendancePrediction: null,
      fraudFeed: [],
      intentSummary: null,
      demandSummary: null,
      abandonedSummary: null,
    };
  }

  // Filter by eventId if provided
  let activeEventIds = accessibleEventIds;
  let selectedEvent = null;
  if (eventId && eventId !== 'ALL') {
    if (!accessibleEventIds.includes(eventId)) {
      const error = new Error('Access denied: Event does not belong to your company');
      error.status = 403;
      throw error;
    }
    activeEventIds = [eventId];
    selectedEvent = organizerEvents.find((e) => e.id === eventId);
  }

  // 3. Query Orders and Financials
  const successfulOrders = await prisma.order.findMany({
    where: {
      eventId: { in: activeEventIds },
      // Refunded orders count too; the refunds are subtracted below
      status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
    },
    include: {
      tickets: {
        select: { id: true, price: true, status: true, createdAt: true, seatId: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  let totalRevenuePkr = 0;
  successfulOrders.forEach((o) => {
    totalRevenuePkr += Number(o.totalAmount);
  });
  // Refunds: the organizer pays back face value (organizerShare); TicketLedger covers any resale premium
  const refundRows = await prisma.refund.findMany({
    where: { eventId: { in: activeEventIds } },
    select: { eventId: true, amount: true, organizerShare: true, status: true },
  });
  const refundedPkr = refundRows.reduce((n, r) => n + Number(r.organizerShare), 0);
  const refundsPending = refundRows.filter((r) => r.status !== 'SUCCEEDED').length;
  const grossSalesPkr = totalRevenuePkr;
  totalRevenuePkr -= refundedPkr;
  const platformFeePkr = Math.round((totalRevenuePkr * Number(await getSetting('platformFeePercent'))) / 100);
  const netRevenuePkr = totalRevenuePkr - platformFeePkr;

  // Payouts are held until PAYOUT_HOLD_DAYS after each event ends, so refunds can always be paid
  const PAYOUT_HOLD_DAYS = 3;
  const releaseCutoff = Date.now() - PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000;
  const eventEnds = new Map(
    (await prisma.event.findMany({ where: { id: { in: activeEventIds } }, select: { id: true, endsAt: true, date: true, status: true } })).map((e) => [e.id, e]),
  );
  const refundByEvent = new Map();
  refundRows.forEach((r) => refundByEvent.set(r.eventId, (refundByEvent.get(r.eventId) || 0) + Number(r.organizerShare)));
  const salesByEvent = new Map();
  successfulOrders.forEach((o) => salesByEvent.set(o.eventId, (salesByEvent.get(o.eventId) || 0) + Number(o.totalAmount)));
  let payoutReleasablePkr = 0;
  let payoutHeldPkr = 0;
  for (const [evId, gross] of salesByEvent) {
    const net = Math.round((gross - (refundByEvent.get(evId) || 0)) * 0.95);
    const ev = eventEnds.get(evId);
    const ended = ev && ev.status !== 'CANCELLED' && (ev.endsAt || ev.date).getTime() < releaseCutoff;
    if (ended) payoutReleasablePkr += net;
    else payoutHeldPkr += net;
  }

  // 4. Sales Graph (Aggregate sales by Date)
  const salesByDateMap = new Map();
  // Fill recent 7 days or based on order dates
  successfulOrders.forEach((o) => {
    const d = new Date(o.createdAt).toISOString().split('T')[0];
    if (!salesByDateMap.has(d)) {
      salesByDateMap.set(d, { date: d, ticketsSold: 0, revenuePkr: 0, ordersCount: 0 });
    }
    const entry = salesByDateMap.get(d);
    entry.ticketsSold += o.tickets.length;
    entry.revenuePkr += Number(o.totalAmount);
    entry.ordersCount += 1;
  });

  const salesGraph = Array.from(salesByDateMap.values()).sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // 5. Query Ticket Tiers Breakdown
  const ticketTiers = await prisma.ticketTier.findMany({
    where: {
      eventId: { in: activeEventIds },
    },
    include: {
      event: { select: { id: true, name: true } },
    },
  });

  let totalCapacity = 0;
  let totalAvailable = 0;
  const tierBreakdown = ticketTiers.map((t) => {
    const sold = t.totalQuantity - t.availableQuantity;
    const priceNum = Number(t.price);
    const revenue = sold * priceNum;
    totalCapacity += t.totalQuantity;
    totalAvailable += t.availableQuantity;

    return {
      tierId: t.id,
      eventName: t.event?.name,
      tierName: t.name,
      price: priceNum,
      totalQuantity: t.totalQuantity,
      soldQuantity: sold,
      availableQuantity: t.availableQuantity,
      percentageSold: t.totalQuantity > 0 ? Math.round((sold / t.totalQuantity) * 100) : 0,
      tierRevenuePkr: revenue,
    };
  });

  const totalTicketsSold = totalCapacity - totalAvailable;

  // 6. Live Entry Count (Gate Scans)
  const gateScans = await prisma.gateScan.findMany({
    where: {
      ticket: {
        eventId: { in: activeEventIds },
      },
    },
    include: {
      ticket: { select: { id: true, status: true } },
    },
  });

  // Reversed admissions stay in the log but are not attendance
  const validScans = gateScans.filter((s) => s.result === 'VALID_FIRST_SCAN' && !s.reversedAt).length;
  const duplicateScans = gateScans.filter((s) => s.result === 'ALREADY_SCANNED').length;
  const invalidScans = gateScans.filter((s) => s.result === 'INVALID_SCAN').length;
  const turnoutPercentage = totalTicketsSold > 0 ? Math.round((validScans / totalTicketsSold) * 100) : 0;

  // 7. Attendance prediction: tickets sold x historical show rate of past finished events
  // (falls back to the previous fixed percentages until enough check-ins exist; see services/ml/attendanceBaseline.js)
  let predictedAttendanceRate = 88.5;
  let predictedNoShowRisk = 11.5;
  let attendanceFactors = [];
  let attendanceBasis = 'FIXED_RULE';

  const targetEventObj = selectedEvent || organizerEvents[0];
  if (targetEventObj) {
    const sr = await showRate({ type: targetEventObj.type, city: targetEventObj.city });
    predictedAttendanceRate = sr.rate;
    attendanceFactors = sr.factors;
    attendanceBasis = sr.basis;
    predictedNoShowRisk = Math.round((100 - predictedAttendanceRate) * 10) / 10;
  }

  const predictedAttendees = Math.round((totalTicketsSold * predictedAttendanceRate) / 100);

  // 8. Fraud Feed (Flagged Bot/Scalper Activity for organizer events)
  const fraudEvents = await prisma.behaviorEvent.findMany({
    where: {
      eventId: { in: activeEventIds },
      action: { in: ['bot_risk_flagged', 'rapid_clicks', 'seat_rapid_click', 'fraud_score_computed'] },
    },
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true, status: true } },
    },
  });

  const fraudFeed = fraudEvents.map((f) => {
    const meta = f.metadata || {};
    return {
      id: f.id,
      action: f.action,
      userName: f.user?.name || 'Guest Bot Candidate',
      userEmail: f.user?.email,
      userStatus: f.user?.status || 'UNKNOWN',
      fraudScore: meta.fraudScore || (meta.isBot ? 85 : 60),
      riskLevel: (meta.fraudScore || 60) >= 75 ? 'HIGH' : 'SUSPICIOUS',
      reason: meta.anomalyFactors?.[0] || 'Unusual click velocity during checkout',
      timestamp: f.createdAt,
    };
  });

  // 9. Quick Summaries for M16 (Intent), M17 (Demand), M18 (Abandoned)
  const [viewersCount, abandonedCount] = await Promise.all([
    prisma.behaviorEvent.count({
      where: { eventId: { in: activeEventIds }, action: 'event_view' },
    }),
    prisma.behaviorEvent.count({
      where: { eventId: { in: activeEventIds }, action: { in: LEFT_CHECKOUT_ACTIONS } },
    }),
  ]);

  return {
    hasCompany: true,
    events: organizerEvents,
    selectedEvent: targetEventObj,
    metrics: {
      totalRevenuePkr,
      grossSalesPkr,
      refundedPkr,
      refundsPending,
      payoutHeldPkr,
      payoutReleasablePkr,
      payoutHoldDays: PAYOUT_HOLD_DAYS,
      platformFeePkr,
      netRevenuePkr,
      totalTicketsSold,
      totalCapacity,
      turnoutPercentage,
      liveScannedCount: validScans,
      predictedAttendanceRate,
      predictedNoShowRisk,
    },
    salesGraph,
    tierBreakdown,
    liveGatePacing: {
      totalTicketsSold,
      scanned: validScans,
      duplicateScans,
      invalidScans,
      remaining: Math.max(0, totalTicketsSold - validScans),
      turnoutPercentage,
    },
    attendancePrediction: {
      rate: predictedAttendanceRate,
      noShowRisk: predictedNoShowRisk,
      predictedAttendees,
      totalTicketsSold,
      confidenceScore: 0.91,
      factors: attendanceFactors,
      basis: attendanceBasis, // HISTORY_TYPE | HISTORY_ALL | FIXED_RULE
    },
    fraudFeed,
    modulesPreview: {
      intentViewers: viewersCount,
      abandonedCarts: abandonedCount,
      recoverablePkr: abandonedCount * 3500,
    },
  };
};

/**
 * Removes what the member's permissions don't cover: money figures without finance.view, the attendee fraud
 * feed without attendee.view. Super Admins and owners see everything.
 */
async function withAccess(data, { organizerUser, orgContext = null }) {
  if (organizerUser.role === 'SUPER_ADMIN' && !orgContext) return { ...data, access: { finance: true, attendees: true } };
  const ctx = orgContext ?? (await memberContext(organizerUser));
  const finance = Boolean(ctx?.permissions.has('finance.view'));
  const attendees = Boolean(ctx?.permissions.has('attendee.view'));
  const money = /pkr|revenue|payout|refund|fee|price|amount/i;
  const strip = (obj) => {
    if (Array.isArray(obj)) return obj.map(strip);
    if (!obj || typeof obj !== 'object' || obj instanceof Date) return obj;
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !money.test(k)).map(([k, v]) => [k, strip(v)]));
  };
  const out = { ...data, access: { finance, attendees } };
  if (!finance) {
    for (const key of ['metrics', 'salesGraph', 'tierBreakdown', 'modulesPreview']) if (out[key]) out[key] = strip(out[key]);
  }
  if (!attendees) out.fraudFeed = [];
  return out;
}

export default {
  getOrganizerDashboardMetrics,
};
