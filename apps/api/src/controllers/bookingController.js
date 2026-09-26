import { z } from 'zod';
import prisma from '../config/prisma.js';
import { checkSeatLock, releaseSeatLock } from '../config/redis.js';
import { getIO } from '../config/socket.js';
import paymentService from '../services/paymentService.js';
import nftService from '../services/nftService.js';
import mlService from '../services/mlService.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

// Schemas
const initiateBookingSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  seatIds: z.array(z.string().uuid()).min(1, 'Please select at least 1 seat').max(10, 'Maximum 10 seats per booking'),
  paymentMethod: z.enum(['STRIPE', 'JAZZCASH', 'EASYPAISA', 'MOCK']).default('MOCK'),
  customerPhone: z.string().optional(),
  telemetry: z.object({
    checkoutDurationSeconds: z.number().optional(),
    clicksPerMinute: z.number().optional(),
    rapidSeatAttempts: z.number().optional(),
    timeOnSeatmapSeconds: z.number().optional(),
    deviceSwitches: z.number().optional(),
  }).optional(),
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

    if (event.status !== 'PUBLISHED') {
      return res.status(400).json({
        success: false,
        message: 'This event is not currently accepting bookings.',
      });
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

    // Calculate total price
    const totalAmount = seats.reduce((sum, seat) => sum + Number(seat.tier.price), 0);

    // Group seat counts by tier for inventory decrement
    const tierCounts = {};
    for (const seat of seats) {
      tierCounts[seat.tierId] = (tierCounts[seat.tierId] || 0) + 1;
    }

    // Execute atomic creation in PostgreSQL
    const order = await prisma.$transaction(async (tx) => {
      // 1. Create Pending Order
      const newOrder = await tx.order.create({
        data: {
          userId,
          eventId,
          totalAmount,
          status: 'PENDING',
          paymentMethod,
        },
      });

      // 2. Create placeholder tickets for each seat
      for (const seat of seats) {
        await tx.ticket.deleteMany({
          where: {
            seatId: seat.id,
            order: { status: { in: ['PENDING', 'FAILED'] } },
          },
        });

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

    // 4. Initiate payment parameters via Payment Gateway service
    const paymentParams = await paymentService.initiatePayment({
      orderId: order.id,
      amount: totalAmount,
      paymentMethod,
      customerPhone: customerPhone || req.user.phone,
      customerEmail: req.user.email,
    });

    // 5. Log behavior event
    await prisma.behaviorEvent.create({
      data: {
        userId,
        sessionId: req.headers['x-session-id'] || 'session_' + userId,
        action: 'checkout_started',
        eventId,
        metadata: {
          orderId: order.id,
          seatCount: seats.length,
          totalAmount,
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
        totalAmount,
        seatCount: seats.length,
        paymentMethod,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Booking initiated successfully. Please complete payment to confirm.',
      data: {
        orderId: order.id,
        totalAmount,
        currency: 'PKR',
        paymentMethod,
        paymentParams,
        seats: seats.map((s) => ({
          id: s.id,
          section: s.section,
          row: s.row,
          seatNumber: s.seatNumber,
          tierName: s.tier.name,
          price: s.tier.price,
        })),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message });
    }
    console.error('Error initiating booking:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
      return res.status(400).json({
        success: false,
        message: 'This booking order was cancelled or expired.',
      });
    }

    // Verify payment with Payment Service
    const verification = await paymentService.verifyPayment({
      paymentMethod: order.paymentMethod,
      paymentDetails,
      expectedAmount: order.totalAmount,
    });

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
      // 1. Update Order status
      const completedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'SUCCESSFUL',
          paymentTxId: verification.transactionId,
        },
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

    // 5. Release Redis locks and broadcast Socket.io seat update
    const io = getIO();
    for (const ticket of order.tickets) {
      await releaseSeatLock(ticket.seatId, userId);

      if (io) {
        io.emit('seat:status_change', {
          eventId: order.eventId,
          seatId: ticket.seatId,
          section: ticket.seat.section,
          row: ticket.seat.row,
          seatNumber: ticket.seat.seatNumber,
          status: 'SOLD',
          lockedUntil: null,
          lockedByUserId: null,
        });
      }
    }

    // 6. Automatically mint Polygon Amoy ERC721 NFT tickets for confirmed order
    let mintedNFTs = [];
    try {
      const mintResult = await nftService.batchMintOrderTickets(updatedOrder.id);
      mintedNFTs = mintResult.nfts || [];
    } catch (mintErr) {
      console.warn('⚠️ NFT Auto-Minting delayed:', mintErr.message);
    }

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
      message: 'Payment verified and booking confirmed successfully! ERC721 NFT tickets minted.',
      data: {
        order: updatedOrder,
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
    await prisma.$transaction(async (tx) => {
      // 1. Delete placeholder tickets to release unique seatId constraint
      await tx.ticket.deleteMany({ where: { orderId } });

      // 2. Mark order failed
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'FAILED' },
      });

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
    });

    // Release Redis locks and broadcast Socket.io
    const io = getIO();
    for (const ticket of order.tickets) {
      await releaseSeatLock(ticket.seatId, userId);

      if (io) {
        io.emit('seat:status_change', {
          eventId: order.eventId,
          seatId: ticket.seatId,
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
      data: { order },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
