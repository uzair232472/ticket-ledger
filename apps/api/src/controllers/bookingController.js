import { z } from 'zod';
import prisma from '../config/prisma.js';
import { checkSeatLock, releaseSeatLock } from '../config/redis.js';
import { getIO } from '../config/socket.js';
import paymentService from '../services/paymentService.js';
import nftService from '../services/nftService.js';
import { ticketStates } from '../services/ticketStatus.js';
import { notifyAdmins } from '../services/notificationService.js';

// Each ticket with its payment, entry and NFT states (separate facts; services/ticketStatus.js)
const withStates = (order) => order && { ...order, tickets: (order.tickets || []).map((t) => ({ ...t, states: ticketStates(t, order) })) };
import mlService from '../services/mlService.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';
import { expireStaleHolds } from '../services/venueService.js';
import { DiscountError, markRedeemed, normalizeCode, quote as quoteDiscount, reserve as reserveDiscount } from '../services/discountService.js';

const money = (n) => Math.round(Number(n) * 100) / 100;
// The same seats in any order
const seatKey = (ids) => [...ids].sort().join(',');

/** Optional Idempotency-Key header of a checkout request (8–100 visible characters). */
function idempotencyKeyFrom(req) {
  const raw = String(req.get('Idempotency-Key') || '').trim();
  return /^[\x21-\x7e]{8,100}$/.test(raw) ? raw : null;
}

const ORDER_PRICING_INCLUDE = {
  tickets: { include: { seat: { include: { tier: true } } } },
  discountCode: { select: { code: true, type: true, value: true, description: true } },
};

/** What the customer pays: ticket prices, the discount and the total (the order's own stored figures). */
export const priceBreakdown = (order) => ({
  subtotal: Number(order.subtotalAmount ?? order.totalAmount),
  discount: Number(order.discountAmount || 0),
  discountCode: order.discountCode?.code || null,
  discountLabel: order.discountCode ? (order.discountCode.type === 'PERCENT' ? `${Number(order.discountCode.value)}% off` : `PKR ${Number(order.discountCode.value)} off`) : null,
  serviceFee: 0,
  total: Number(order.totalAmount),
  currency: 'PKR',
});

/** This customer's unpaid order for exactly these seats (or the one their Idempotency-Key created). */
async function findMyPendingOrder(userId, eventId, wantedSeats, idemKey = null) {
  if (idemKey) {
    const byKey = await prisma.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: idemKey } } });
    if (byKey?.status === 'PENDING') return byKey;
  }
  const orders = await prisma.order.findMany({ where: { userId, eventId, status: 'PENDING' }, include: { tickets: { select: { seatId: true } } }, orderBy: { createdAt: 'desc' }, take: 20 });
  return orders.find((o) => seatKey(o.tickets.map((t) => t.seatId)) === wantedSeats) || null;
}

/** An earlier checkout of this customer was paid (or is being paid): it must be confirmed, not replaced. */
const paidElsewhere = (res, order, state) => res.status(409).json({
  success: false,
  code: state === 'succeeded' ? 'PAYMENT_ALREADY_RECEIVED' : 'PAYMENT_IN_PROGRESS',
  orderId: order.id,
  message: state === 'succeeded'
    ? 'We already received a payment for your earlier checkout of these seats. Confirming that order instead of charging you again.'
    : 'A payment for your earlier checkout of these seats is still being processed. Wait a moment, then check My bookings before paying again.',
});

/**
 * Sends the order's payment parameters. The gateway payment is created once per order and returned again on
 * every retry (paymentService.initiatePayment with the stored paymentRef).
 */
async function sendPayment(req, res, order, { reused }) {
  const params = await paymentService.initiatePayment({
    orderId: order.id,
    amount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    customerPhone: req.body?.customerPhone || req.user.phone,
    customerEmail: req.user.email,
    paymentRef: order.paymentRef,
  });
  if (params.paymentRef && params.paymentRef !== order.paymentRef) {
    await prisma.order.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { paymentRef: params.paymentRef } });
  }
  const full = await prisma.order.findUnique({ where: { id: order.id }, include: ORDER_PRICING_INCLUDE });
  return res.status(reused ? 200 : 201).json({
    success: true,
    message: params.alreadyPaid
      ? 'This order is already paid. Confirming it now.'
      : reused
        ? 'Your open checkout for these seats was resumed. Complete payment to confirm.'
        : 'Booking initiated successfully. Please complete payment to confirm.',
    data: {
      orderId: full.id,
      reused,
      totalAmount: Number(full.totalAmount),
      currency: 'PKR',
      paymentMethod: full.paymentMethod,
      paymentParams: params,
      priceBreakdown: priceBreakdown(full),
      seats: full.tickets.map((t) => ({
        id: t.seat.id,
        section: t.seat.section,
        row: t.seat.row,
        seatNumber: t.seat.seatNumber,
        tierName: t.seat.tier.name,
        price: t.seat.tier.price,
      })),
    },
  });
}

// Schemas
const initiateBookingSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  seatIds: z.array(z.string().uuid()).min(1, 'Please select at least 1 seat').max(10, 'Maximum 10 seats per booking'),
  paymentMethod: z.enum(['STRIPE', 'JAZZCASH', 'EASYPAISA', 'MOCK']).default('MOCK'),
  customerPhone: z.string().optional(),
  discountCode: z.string().trim().max(40).optional(),
  telemetry: z.object({
    checkoutDurationSeconds: z.number().optional(),
    clicksPerMinute: z.number().optional(),
    rapidSeatAttempts: z.number().optional(),
    timeOnSeatmapSeconds: z.number().optional(),
    deviceSwitches: z.number().optional(),
  }).optional(),
});

const discountQuoteSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  seatIds: z.array(z.string().uuid()).min(1, 'Select at least 1 seat').max(10),
  code: z.string().trim().min(1, 'Enter a discount code.').max(40),
});

const confirmBookingSchema = z.object({
  orderId: z.string().uuid('Invalid order ID'),
  paymentDetails: z.record(z.any()).default({}),
});

const cancelBookingSchema = z.object({
  orderId: z.string().uuid('Invalid order ID'),
});

/**
 * 1. Initiate booking transaction for locked seats
 */
export const initiateBooking = async (req, res) => {
  try {
    const validated = initiateBookingSchema.parse(req.body);
    const { eventId, seatIds, paymentMethod, customerPhone } = validated;
    const userId = req.user.id;
    const now = new Date();

    // Verify Event
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // Hidden dates take no new bookings (tickets already sold stay valid)
    if (event.status !== 'PUBLISHED' || event.isHidden) {
      return res.status(400).json({
        success: false,
        message: 'This event is not currently accepting bookings.',
      });
    }

    const idemKey = idempotencyKeyFrom(req);
    const wantedSeats = seatKey(seatIds);
    const discountInput = normalizeCode(validated.discountCode);

    // A repeat of a checkout request already received (same Idempotency-Key): answer with its order
    if (idemKey) {
      await expireStaleHolds(eventId);
      const prior = await prisma.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: idemKey } }, include: { tickets: { select: { seatId: true } } } });
      if (prior) {
        if (prior.status === 'FAILED') {
          // That checkout ended (expired or cancelled): the key may start a new one
          await prisma.order.update({ where: { id: prior.id }, data: { idempotencyKey: null } });
        } else if (prior.eventId !== eventId || seatKey(prior.tickets.map((t) => t.seatId)) !== wantedSeats) {
          return res.status(422).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', message: 'This checkout request was already used for different seats. Reload checkout and try again.' });
        } else if (prior.status !== 'PENDING') {
          return res.status(200).json({ success: true, message: 'This order is already paid.', data: { orderId: prior.id, status: prior.status, alreadyPaid: true } });
        } else if (prior.paymentMethod === paymentMethod) {
          return sendPayment(req, res, prior, { reused: true });
        }
        // Same order, another payment method: handled below with the seat checks
      }
    }

    // AI Scalper Bot Pre-Checkout Detection
    if (validated.telemetry) {
      const fraudEvaluation = await mlService.checkFraudRisk({
        ...validated.telemetry,
        ticketsRequested: seatIds.length,
      });

      // Log behavioral telemetry
      await prisma.behaviorEvent.create({
        data: {
          userId,
          sessionId: req.headers['x-session-id'] || 'booking_' + Math.random().toString(36).substring(7),
          action: 'CHECKOUT_BOT_EVALUATION',
          eventId,
          metadata: {
            fraudEvaluation,
            seatIds,
          },
        },
      });

      // If Critical Bot detected -> BLOCK transaction
      if (fraudEvaluation.risk_level === 'CRITICAL_BOT') {
        await prisma.auditLog.create({
          data: {
            userId,
            action: 'CHECKOUT_BLOCKED_SCALPER_BOT',
            targetType: 'Event',
            targetId: eventId,
            details: {
              fraudScore: fraudEvaluation.fraud_score,
              anomalies: fraudEvaluation.anomaly_factors,
            },
          },
        });

        return res.status(403).json({
          success: false,
          blockedByAI: true,
          message: 'Anti-Scalping Security Alert: Transaction flagged and blocked by TicketLedger AI bot detection engine.',
          data: {
            fraudScore: fraudEvaluation.fraud_score,
            riskLevel: fraudEvaluation.risk_level,
            anomalyFactors: fraudEvaluation.anomaly_factors,
          },
        });
      }
    }

    // Free lapsed holds and checkouts first so their seats can't block (or be double-sold to) anyone
    await expireStaleHolds(eventId);

    // Verify all requested seats
    const seats = await prisma.seat.findMany({
      where: {
        id: { in: seatIds },
        eventId,
      },
      include: {
        tier: true,
      },
    });

    if (seats.length !== seatIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more seat IDs are invalid or do not belong to this event.',
      });
    }

    // Check each seat: must be currently locked by THIS user
    for (const seat of seats) {
      if (seat.status === 'SOLD') {
        return res.status(409).json({
          success: false,
          message: `Seat ${seat.section} Row ${seat.row} Seat ${seat.seatNumber} has already been sold.`,
        });
      }

      if (seat.status === 'BLOCKED') {
        return res.status(409).json({
          success: false,
          message: `Seat ${seat.section} Row ${seat.row} Seat ${seat.seatNumber} is blocked.`,
        });
      }

      // Check DB lock ownership and TTL
      const isLockedByMeInDb =
        seat.status === 'LOCKED' &&
        seat.lockedByUserId === userId &&
        seat.lockedUntil &&
        seat.lockedUntil > now;

      // Check Redis lock ownership
      const redisLock = await checkSeatLock(seat.id);
      const isLockedByMeInRedis = redisLock.locked && redisLock.userId === userId;

      if (!isLockedByMeInDb && !isLockedByMeInRedis) {
        return res.status(409).json({
          success: false,
          message: `Your reservation lock on Seat ${seat.section} Row ${seat.row}-${seat.seatNumber} has expired or was not acquired. Please select your seats again.`,
        });
      }
    }

    // Whole-table seats are sold together: every seat at the table must be in this booking
    const tableKeys = [...new Set(seats.filter((s) => s.wholeTable).map((s) => s.tableKey))];
    for (const tableKey of tableKeys) {
      const tableSeatIds = await prisma.seat.findMany({ where: { eventId, tableKey }, select: { id: true } });
      if (tableSeatIds.some((t) => !seatIds.includes(t.id))) {
        return res.status(400).json({ success: false, message: 'A whole table must be booked together. Please hold the full table again.' });
      }
    }

    // Seats already in a checkout: another customer's checkout wins. This customer's own unpaid checkout for
    // exactly these seats (and the same code) is reused, so retrying never creates a second booking or payment.
    // Their other unpaid checkouts for these seats are replaced, unless the gateway says one was paid or is being
    // paid right now: that one is kept and must be confirmed instead.
    const existingTickets = await prisma.ticket.findMany({
      where: { seatId: { in: seatIds } },
      include: { order: { include: { tickets: { include: { seat: true } }, discountCode: { select: { code: true } } } } },
    });
    for (const ticket of existingTickets) {
      if (ticket.order.status === 'SUCCESSFUL') {
        return res.status(409).json({ success: false, message: 'One of these seats has already been sold.' });
      }
      if (ticket.order.status === 'PENDING' && ticket.order.userId !== userId) {
        return res.status(409).json({ success: false, message: 'One of these seats is in another customer’s checkout.' });
      }
    }
    const myOrders = [...new Map(existingTickets.map((t) => [t.order.id, t.order])).values()];
    const reusable = myOrders.find((o) => o.status === 'PENDING' && seatKey(o.tickets.map((t) => t.seatId)) === wantedSeats && (o.discountCode?.code || '') === discountInput);

    for (const old of myOrders.filter((o) => o.status === 'PENDING' && (o !== reusable || o.paymentMethod !== paymentMethod))) {
      const state = await paymentService.paymentStatus({ paymentMethod: old.paymentMethod, paymentRef: old.paymentRef });
      if (state === 'succeeded' || state === 'processing') return paidElsewhere(res, old, state);
    }

    if (reusable) {
      let order = reusable;
      if (order.paymentMethod !== paymentMethod) {
        // Same seats, another payment method: the order's unpaid payment is dropped for a new one
        order = await prisma.order.update({ where: { id: order.id }, data: { paymentMethod, paymentRef: null } });
      }
      return sendPayment(req, res, order, { reused: true });
    }
    const supersededOrders = myOrders;

    // Ticket prices, then the discount (checked again with the code locked inside the transaction)
    const subtotal = money(seats.reduce((sum, seat) => sum + Number(seat.tier.price), 0));
    if (discountInput) await quoteDiscount(prisma, { code: discountInput, event, userId, ticketCount: seats.length, subtotal });

    // Group seat counts by tier for inventory decrement
    const tierCounts = {};
    for (const seat of seats) {
      tierCounts[seat.tierId] = (tierCounts[seat.tierId] || 0) + 1;
    }

    // Execute atomic creation in PostgreSQL
    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        // 0. Retire this customer's earlier unpaid checkout(s) for these seats and restore their counts
        for (const old of supersededOrders) {
          const flipped = old.status === 'PENDING'
            ? await tx.order.updateMany({ where: { id: old.id, status: 'PENDING' }, data: { status: 'FAILED', idempotencyKey: null } })
            : { count: 0 };
          await tx.ticket.deleteMany({ where: { orderId: old.id } });
          if (flipped.count) {
            const restore = {};
            for (const t of old.tickets) restore[t.seat.tierId] = (restore[t.seat.tierId] || 0) + 1;
            for (const [tierId, count] of Object.entries(restore)) {
              await tx.ticketTier.update({ where: { id: tierId }, data: { availableQuantity: { increment: count } } });
            }
          }
        }

        // 1. Create Pending Order
        let newOrder = await tx.order.create({
          data: {
            userId,
            eventId,
            subtotalAmount: subtotal,
            totalAmount: subtotal,
            status: 'PENDING',
            paymentMethod,
            idempotencyKey: idemKey,
          },
        });

        // 1b. Reserve the discount code for this order
        if (discountInput) {
          const q = await reserveDiscount(tx, { code: discountInput, event, userId, ticketCount: seats.length, subtotal, orderId: newOrder.id });
          newOrder = await tx.order.update({ where: { id: newOrder.id }, data: { discountCodeId: q.code.id, discountAmount: q.discount, totalAmount: q.total } });
        }

        // 2. Create placeholder tickets for each seat (one ticket per seat is enforced by the database)
        for (const seat of seats) {
          await tx.ticket.create({
            data: {
              orderId: newOrder.id,
              eventId,
              seatId: seat.id,
              userId,
              price: seat.tier.price,
              status: 'ACTIVE',
            },
          });
        }

        // 3. Decrement availableQuantity in each TicketTier
        for (const [tierId, count] of Object.entries(tierCounts)) {
          await tx.ticketTier.update({
            where: { id: tierId },
            data: {
              availableQuantity: { decrement: count },
            },
          });
        }

        return newOrder;
      });
    } catch (error) {
      // A parallel request of this same customer (double click, retry on a slow network) created the order
      // first: answer with that order instead of an error
      if (error.code === 'P2002') {
        const twin = await findMyPendingOrder(userId, eventId, wantedSeats, idemKey);
        if (twin) return sendPayment(req, res, twin, { reused: true });
      }
      throw error;
    }

    // 4. Log behavior event
    await prisma.behaviorEvent.create({
      data: {
        userId,
        sessionId: req.headers['x-session-id'] || 'session_' + userId,
        action: 'checkout_started',
        eventId,
        metadata: {
          orderId: order.id,
          seatCount: seats.length,
          totalAmount: Number(order.totalAmount),
          discountCode: discountInput || null,
          paymentMethod,
        },
      },
    });

    behaviorService.trackBehavior({
      req,
      userId,
      action: BEHAVIOR_ACTIONS.CHECKOUT_STARTED,
      eventId,
      metadata: {
        orderId: order.id,
        totalAmount: Number(order.totalAmount),
        seatCount: seats.length,
        paymentMethod,
      },
    });

    // 5. Payment parameters from the gateway (one payment per order, reused on retries)
    return sendPayment(req, res, order, { reused: false });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message });
    }
    if (error instanceof DiscountError) {
      return res.status(error.status).json({ success: false, code: error.code, field: 'discountCode', message: error.message });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'One of these seats was just taken by another checkout. Please choose again.' });
    }
    console.error('Error initiating booking:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 1b. Price a discount code for seats before checkout (the code is checked again when the order is created).
 * Body: { eventId, seatIds, code }
 */
export const quoteBookingDiscount = async (req, res) => {
  try {
    const { eventId, seatIds, code } = discountQuoteSchema.parse(req.body);
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, companyId: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const seats = await prisma.seat.findMany({ where: { id: { in: seatIds }, eventId }, include: { tier: { select: { price: true } } } });
    if (seats.length !== seatIds.length) return res.status(400).json({ success: false, message: 'One or more seats do not belong to this event.' });
    const subtotal = money(seats.reduce((n, s) => n + Number(s.tier.price), 0));
    // A retry of this customer's open order for these seats doesn't count against the code's limits
    const mine = await findMyPendingOrder(req.user.id, eventId, seatKey(seatIds));
    const q = await quoteDiscount(prisma, { code, event, userId: req.user.id, ticketCount: seats.length, subtotal, excludeOrderId: mine?.id });
    return res.json({
      success: true,
      data: { code: q.code.code, description: q.code.description, type: q.code.type, value: Number(q.code.value), subtotal, discount: q.discount, total: q.total, endsAt: q.code.endsAt },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message });
    if (error instanceof DiscountError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    console.error('Error quoting discount:', error);
    return res.status(500).json({ success: false, message: 'Could not check this code.' });
  }
};

/**
 * A real gateway payment for an order that is no longer open (its hold expired and the seats were released):
 * refund it at once so the customer is never charged without tickets. Sandbox gateways move no money, so
 * nothing is refunded for them. Returns { providerRef } when money was sent back, else null.
 */
async function refundLatePayment(req, order, paymentDetails, verification = null) {
  const v = verification || await paymentService.verifyPayment({ paymentMethod: order.paymentMethod, paymentDetails, expectedAmount: order.totalAmount, orderId: order.id });
  if (!v.success || !v.real || !paymentService.isRealPayment({ paymentMethod: order.paymentMethod, paymentTxId: v.transactionId })) return null;
  // Already refunded once (a repeated confirm): don't refund twice
  const done = await prisma.auditLog.findFirst({ where: { action: 'LATE_PAYMENT_REFUNDED', targetType: 'Order', targetId: order.id }, select: { details: true } });
  if (done) return { providerRef: done.details?.providerRef || 'refunded' };
  const refund = await paymentService.refund({ paymentMethod: order.paymentMethod, paymentTxId: v.transactionId, amount: order.totalAmount, reference: `late_${order.id}` });
  await prisma.auditLog.create({
    data: {
      userId: req.user.id,
      action: refund.success ? 'LATE_PAYMENT_REFUNDED' : 'LATE_PAYMENT_REFUND_FAILED',
      targetType: 'Order',
      targetId: order.id,
      details: { transactionId: v.transactionId, amount: Number(order.totalAmount), providerRef: refund.providerRef || null, error: refund.message || null },
    },
  });
  if (!refund.success) {
    // The money must not be lost: the admins handle it by hand
    await notifyAdmins({
      type: 'ADMIN_LATE_PAYMENT_REFUND_FAILED',
      title: 'Refund needed: payment for an expired order',
      message: `Order ${order.id.slice(0, 8)} was paid (${v.transactionId}, PKR ${Number(order.totalAmount)}) after its seats were released, and the automatic refund failed: ${refund.message}. Refund it manually.`,
    });
    return null;
  }
  await prisma.notification.create({
    data: {
      userId: order.userId,
      type: 'PAYMENT_REFUNDED',
      title: 'Payment refunded',
      message: `Your payment of PKR ${Number(order.totalAmount).toLocaleString()} arrived after your seat reservation expired, so it has been refunded (ref ${refund.providerRef}).`,
    },
  });
  return { providerRef: refund.providerRef };
}

/**
 * 2. Confirm booking and authorize payment
 */
export const confirmBooking = async (req, res) => {
  try {
    const validated = confirmBookingSchema.parse(req.body);
    const { orderId, paymentDetails } = validated;
    const userId = req.user.id;

    // Fetch order with tickets and seats
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: true,
        tickets: {
          include: {
            seat: {
              include: { tier: true },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }

    // Idempotent check
    if (order.status === 'SUCCESSFUL') {
      return res.status(200).json({
        success: true,
        message: 'Order has already been confirmed.',
        data: { order },
      });
    }

    if (order.status === 'FAILED') {
      // A real card payment that arrived after the hold expired is sent straight back
      const late = await refundLatePayment(req, order, paymentDetails);
      return res.status(late ? 409 : 400).json({
        success: false,
        code: late ? 'ORDER_EXPIRED_REFUNDED' : 'ORDER_CLOSED',
        message: late
          ? `Your seat reservation expired before the payment arrived, so the seats were released. Your payment of PKR ${Number(order.totalAmount).toLocaleString()} has been refunded (ref ${late.providerRef}).`
          : 'This booking order was cancelled or expired.',
      });
    }
    if (order.status !== 'PENDING') {
      return res.status(200).json({ success: true, message: 'Order has already been confirmed.', data: { order } });
    }

    // Verify payment with Payment Service (a real payment must be this order's, for this order's amount).
    // Without a PaymentIntent id from the browser, the order's own one is checked (a paid earlier checkout).
    const details = order.paymentMethod === 'STRIPE' && !paymentDetails.paymentIntentId && order.paymentRef?.startsWith('pi_')
      ? { ...paymentDetails, paymentIntentId: order.paymentRef }
      : paymentDetails;
    const verification = await paymentService.verifyPayment({
      paymentMethod: order.paymentMethod,
      paymentDetails: details,
      expectedAmount: order.totalAmount,
      orderId: order.id,
    });

    // One payment confirms one order: a transaction already used for another booking is refused
    if (verification.success && order.paymentMethod !== 'MOCK' && verification.transactionId) {
      const other = await prisma.order.findFirst({ where: { paymentTxId: verification.transactionId, id: { not: orderId } }, select: { id: true } });
      if (other) {
        return res.status(409).json({ success: false, code: 'PAYMENT_ALREADY_USED', message: 'This payment was already used for another booking.' });
      }
    }

    if (!verification.success) {
      behaviorService.trackBehavior({
        req,
        userId,
        action: BEHAVIOR_ACTIONS.PAYMENT_FAILED,
        eventId: order.eventId,
        metadata: {
          orderId: order.id,
          amount: order.totalAmount,
          reason: verification.message || 'Payment authorization failed.',
        },
      });

      return res.status(400).json({
        success: false,
        message: verification.message || 'Payment authorization failed.',
      });
    }

    // Atomic transaction: mark order SUCCESSFUL, seats SOLD, release Redis locks
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // 1. Move the order out of PENDING exactly once. If a parallel confirmation or the hold expiry
      //    got there first, this request changes nothing.
      const transition = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'SUCCESSFUL', paymentTxId: verification.transactionId },
      });
      if (!transition.count) return null;
      await markRedeemed(tx, orderId);
      const completedOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          event: true,
          discountCode: { select: { code: true, type: true, value: true } },
          tickets: {
            include: {
              seat: {
                include: { tier: true },
              },
            },
          },
        },
      });

      // 2. Mark all seats as SOLD and clear lock fields
      for (const ticket of order.tickets) {
        await tx.seat.update({
          where: { id: ticket.seatId },
          data: {
            status: 'SOLD',
            lockedUntil: null,
            lockedByUserId: null,
          },
        });
      }

      // 3. Log Audit entry
      await tx.auditLog.create({
        data: {
          userId,
          action: 'BOOKING_CONFIRMED',
          targetType: 'Order',
          targetId: orderId,
          details: {
            totalAmount: Number(order.totalAmount),
            paymentMethod: order.paymentMethod,
            transactionId: verification.transactionId,
            seatCount: order.tickets.length,
          },
        },
      });

      // 4. Create in-app notification
      await tx.notification.create({
        data: {
          userId,
          type: 'BOOKING_CONFIRMED',
          title: '🎟️ Booking Confirmed!',
          message: `Your booking for ${order.event.name} (${order.tickets.length} seats) has been successfully confirmed. Ref: ${orderId.substring(0, 8)}`,
        },
      });

      return completedOrder;
    });

    if (!updatedOrder) {
      const current = await prisma.order.findUnique({ where: { id: orderId }, include: { event: true, tickets: { include: { seat: { include: { tier: true } } } } } });
      if (current?.status === 'SUCCESSFUL') {
        return res.status(200).json({ success: true, message: 'Order has already been confirmed.', data: { order: current } });
      }
      const late = verification.real ? await refundLatePayment(req, order, paymentDetails, verification) : null;
      return res.status(409).json({
        success: false,
        code: late ? 'ORDER_EXPIRED_REFUNDED' : 'ORDER_EXPIRED',
        message: late
          ? `Your seat reservation expired before payment was confirmed, so the seats were released. Your payment has been refunded (ref ${late.providerRef}). Please select your seats again.`
          : 'Your seat reservation expired before payment was confirmed, so the seats were released. Please select your seats again.',
      });
    }

    // 5. Release Redis locks and broadcast Socket.io seat update
    const io = getIO();
    for (const ticket of order.tickets) {
      await releaseSeatLock(ticket.seatId, userId);

      if (io) {
        io.emit('seat:status_change', {
          eventId: order.eventId,
          seatId: ticket.seatId,
          key: ticket.seat.layoutKey,
          sectionKey: ticket.seat.sectionKey,
          section: ticket.seat.section,
          row: ticket.seat.row,
          seatNumber: ticket.seat.seatNumber,
          status: 'SOLD',
          lockedUntil: null,
          lockedByUserId: null,
        });
      }
    }

    // 6. Mint the ERC721 NFTs. The order is already paid and its tickets valid, so a failed mint is recorded on
    //    each ticket and retried in the background (services/nftService.js), never undoing the booking.
    let mintedNFTs = [];
    let issuance = { status: 'PENDING', minted: 0, pending: updatedOrder.tickets.length, total: updatedOrder.tickets.length };
    try {
      const mintResult = await nftService.batchMintOrderTickets(updatedOrder.id);
      mintedNFTs = mintResult.nfts || [];
      const pending = updatedOrder.tickets.length - mintResult.totalMinted;
      issuance = { status: pending ? 'PENDING' : 'MINTED', minted: mintResult.totalMinted, pending, total: updatedOrder.tickets.length };
    } catch (mintErr) {
      console.warn('⚠️ NFT minting deferred to the background job:', mintErr.message);
    }
    // The order's tickets with their mint state as it now stands
    updatedOrder.tickets = await prisma.ticket.findMany({
      where: { orderId: updatedOrder.id },
      include: { seat: { include: { tier: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Module 13: Track payment_completed and ticket_purchased
    behaviorService.trackBehavior({
      req,
      userId,
      action: BEHAVIOR_ACTIONS.PAYMENT_COMPLETED,
      eventId: order.eventId,
      metadata: {
        orderId: updatedOrder.id,
        amount: updatedOrder.totalAmount,
        transactionId: verification.transactionId,
        gateway: order.paymentMethod,
      },
    });

    behaviorService.trackBehavior({
      req,
      userId,
      action: BEHAVIOR_ACTIONS.TICKET_PURCHASED,
      eventId: order.eventId,
      metadata: {
        orderId: updatedOrder.id,
        ticketCount: updatedOrder.tickets.length,
      },
    });

    return res.status(200).json({
      success: true,
      message: issuance.status === 'MINTED'
        ? 'Payment verified and booking confirmed successfully! ERC721 NFT tickets minted.'
        : 'Payment successful and your booking is confirmed. Your tickets are valid for entry; NFT issuance is pending and will finish automatically.',
      data: {
        order: withStates(updatedOrder),
        priceBreakdown: priceBreakdown(updatedOrder),
        issuance,
        nftTickets: mintedNFTs,
        paymentReceipt: {
          transactionId: verification.transactionId,
          gateway: order.paymentMethod,
          amountPaid: updatedOrder.totalAmount,
          currency: 'PKR',
          paidAt: new Date(),
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message });
    }
    console.error('Error confirming booking:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Cancel pending booking before payment completion
 */
export const cancelBooking = async (req, res) => {
  try {
    const { orderId } = cancelBookingSchema.parse(req.body);
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        tickets: {
          include: { seat: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (order.status === 'SUCCESSFUL') {
      return res.status(400).json({
        success: false,
        message: 'Confirmed bookings cannot be cancelled via this endpoint.',
      });
    }

    if (order.status === 'FAILED') {
      return res.status(200).json({
        success: true,
        message: 'Order is already cancelled.',
      });
    }

    // Revert inventory and seat statuses
    const cancelled = await prisma.$transaction(async (tx) => {
      // 1. Mark order failed, only if it is still pending
      const flipped = await tx.order.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'FAILED' } });
      if (!flipped.count) return false;

      // 2. Delete placeholder tickets to release unique seatId constraint
      await tx.ticket.deleteMany({ where: { orderId } });

      // 2. Count seats per tier to restore inventory
      const tierCounts = {};
      for (const ticket of order.tickets) {
        tierCounts[ticket.seat.tierId] = (tierCounts[ticket.seat.tierId] || 0) + 1;

        // Reset seat to AVAILABLE
        await tx.seat.update({
          where: { id: ticket.seatId },
          data: {
            status: 'AVAILABLE',
            lockedUntil: null,
            lockedByUserId: null,
          },
        });
      }

      // 3. Restore availableQuantity
      for (const [tierId, count] of Object.entries(tierCounts)) {
        await tx.ticketTier.update({
          where: { id: tierId },
          data: { availableQuantity: { increment: count } },
        });
      }
      return true;
    });

    if (!cancelled) {
      const current = await prisma.order.findUnique({ where: { id: orderId } });
      return current?.status === 'SUCCESSFUL'
        ? res.status(400).json({ success: false, message: 'Confirmed bookings cannot be cancelled via this endpoint.' })
        : res.status(200).json({ success: true, message: 'Order is already cancelled.' });
    }

    // Release Redis locks and broadcast Socket.io
    const io = getIO();
    for (const ticket of order.tickets) {
      await releaseSeatLock(ticket.seatId, userId);

      if (io) {
        io.emit('seat:status_change', {
          eventId: order.eventId,
          seatId: ticket.seatId,
          key: ticket.seat.layoutKey,
          sectionKey: ticket.seat.sectionKey,
          section: ticket.seat.section,
          row: ticket.seat.row,
          seatNumber: ticket.seat.seatNumber,
          status: 'AVAILABLE',
          lockedUntil: null,
          lockedByUserId: null,
        });
      }
    }

    // Module 13: Track checkout_abandoned
    behaviorService.trackBehavior({
      req,
      userId,
      action: BEHAVIOR_ACTIONS.CHECKOUT_ABANDONED,
      eventId: order.eventId,
      metadata: {
        orderId: order.id,
        seatCount: order.tickets.length,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Booking order cancelled and seats released successfully.',
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * 4. Retrieve logged-in customer's booking history
 */
export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user.id;

    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            venue: true,
            city: true,
            date: true,
            time: true,
            type: true,
            bannerUrl: true,
          },
        },
        tickets: {
          include: {
            seat: {
              select: {
                id: true,
                section: true,
                row: true,
                seatNumber: true,
                tier: {
                  select: { name: true, price: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: { orders },
    });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Retrieve specific booking order details
 */
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        event: {
          include: { company: true },
        },
        tickets: {
          include: {
            seat: {
              include: { tier: true },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Booking order not found' });
    }

    if (order.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied to this booking' });
    }

    return res.status(200).json({
      success: true,
      data: { order: withStates(order) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
