import { z } from 'zod';
import prisma from '../config/prisma.js';
import { acquireSeatLock, releaseSeatLock, checkSeatLock } from '../config/redis.js';
import { getIO } from '../config/socket.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

// Schemas
const lockSeatSchema = z.object({
  seatId: z.string().uuid('Invalid seat ID'),
});

const generateGridSchema = z.object({
  eventId: z.string().uuid('Invalid event ID'),
  section: z.string().min(1, 'Section is required'),
  tierId: z.string().uuid('Invalid tier ID'),
  rows: z.number().int().min(1).max(20),
  seatsPerRow: z.number().int().min(1).max(30),
});

/**
 * Retrieve seat map for an event with section and row organization
 */
export const getEventSeatMap = async (req, res) => {
  try {
    const { eventId } = req.params;
    const currentUserId = req.user?.id || null;

    // Check if event exists
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        tiers: true,
      },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const now = new Date();

    // Fetch all seats
    const allSeats = await prisma.seat.findMany({
      where: { eventId },
      include: {
        tier: {
          select: { id: true, name: true, price: true },
        },
      },
      orderBy: [
        { section: 'asc' },
        { row: 'asc' },
        { seatNumber: 'asc' },
      ],
    });

    // Automatically reconcile expired locks back to AVAILABLE
    const formattedSeats = await Promise.all(
      allSeats.map(async (seat) => {
        let currentStatus = seat.status;

        if (seat.status === 'LOCKED') {
          if (seat.lockedUntil && seat.lockedUntil < now) {
            // Expired lock, release in Redis and DB
            await releaseSeatLock(seat.id, seat.lockedByUserId);
            await prisma.seat.update({
              where: { id: seat.id },
              data: {
                status: 'AVAILABLE',
                lockedUntil: null,
                lockedByUserId: null,
              },
            });
            currentStatus = 'AVAILABLE';
          }
        }

        const isLockedByMe = currentStatus === 'LOCKED' && seat.lockedByUserId === currentUserId;

        return {
          id: seat.id,
          section: seat.section,
          row: seat.row,
          seatNumber: seat.seatNumber,
          status: currentStatus,
          tier: seat.tier,
          lockedUntil: currentStatus === 'LOCKED' ? seat.lockedUntil : null,
          isLockedByMe,
        };
      })
    );

    // Group seats by section for the interactive frontend map
    const sections = {};
    formattedSeats.forEach((seat) => {
      if (!sections[seat.section]) {
        sections[seat.section] = {
          sectionName: seat.section,
          tierName: seat.tier.name,
          tierPrice: seat.tier.price,
          rows: {},
        };
      }
      if (!sections[seat.section].rows[seat.row]) {
        sections[seat.section].rows[seat.row] = [];
      }
      sections[seat.section].rows[seat.row].push(seat);
    });

    // Summary counts
    const summary = {
      total: formattedSeats.length,
      available: formattedSeats.filter((s) => s.status === 'AVAILABLE').length,
      locked: formattedSeats.filter((s) => s.status === 'LOCKED').length,
      sold: formattedSeats.filter((s) => s.status === 'SOLD').length,
      blocked: formattedSeats.filter((s) => s.status === 'BLOCKED').length,
    };

    return res.status(200).json({
      success: true,
      data: {
        event: {
          id: event.id,
          name: event.name,
          venue: event.venue,
          city: event.city,
          date: event.date,
        },
        sections,
        summary,
        seats: formattedSeats,
      },
    });
  } catch (error) {
    console.error('Error fetching seat map:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve seat map',
      error: error.message,
    });
  }
};

/**
 * Atomically locks a seat for 10 minutes (600s) during checkout
 */
export const lockSeat = async (req, res) => {
  try {
    const { seatId } = lockSeatSchema.parse(req.body);
    const userId = req.user.id;
    const now = new Date();

    const seat = await prisma.seat.findUnique({
      where: { id: seatId },
      include: { tier: true, event: true },
    });

    if (!seat) {
      return res.status(404).json({ success: false, message: 'Seat not found' });
    }

    if (seat.status === 'SOLD') {
      return res.status(409).json({
        success: false,
        message: 'This seat has already been sold and minted as an NFT.',
      });
    }

    if (seat.status === 'BLOCKED') {
      return res.status(409).json({
        success: false,
        message: 'This seat is blocked by venue administration.',
      });
    }

    // Check if seat is currently locked by someone else
    if (seat.status === 'LOCKED' && seat.lockedUntil && seat.lockedUntil > now) {
      if (seat.lockedByUserId !== userId) {
        return res.status(409).json({
          success: false,
          message: 'Seat is currently reserved by another customer. Please select another seat.',
        });
      }
    }

    // 1. Attempt Redis atomic lock acquisition (TTL: 600s = 10 min)
    const acquired = await acquireSeatLock(seatId, userId, 600);
    if (!acquired) {
      return res.status(409).json({
        success: false,
        message: 'Seat lock collision: Another customer just reserved this seat.',
      });
    }

    // 2. Persist lock status to PostgreSQL
    const lockedUntil = new Date(Date.now() + 600 * 1000);
    const updatedSeat = await prisma.seat.update({
      where: { id: seatId },
      data: {
        status: 'LOCKED',
        lockedUntil,
        lockedByUserId: userId,
      },
      include: { tier: true },
    });

    // 3. Broadcast real-time seat lock via Socket.io to all connected clients
    const io = getIO();
    if (io) {
      io.emit('seat:status_change', {
        eventId: seat.eventId,
        seatId: seat.id,
        section: seat.section,
        row: seat.row,
        seatNumber: seat.seatNumber,
        status: 'LOCKED',
        lockedUntil,
        lockedByUserId: userId,
      });
    }

    // 4. Log behavioral events (Module 13 Behavior Tracking)
    behaviorService.trackBehavior({
      req,
      userId,
      action: BEHAVIOR_ACTIONS.SEAT_SELECTED,
      eventId: seat.eventId,
      metadata: {
        seatId: seat.id,
        section: seat.section,
        row: seat.row,
        seatNumber: seat.seatNumber,
      },
    });

    behaviorService.trackBehavior({
      req,
      userId,
      action: BEHAVIOR_ACTIONS.SEAT_LOCKED,
      eventId: seat.eventId,
      metadata: {
        seatId: seat.id,
        section: seat.section,
        row: seat.row,
        seatNumber: seat.seatNumber,
        price: Number(seat.tier.price),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Seat locked successfully for 10 minutes.',
      data: {
        seat: {
          id: updatedSeat.id,
          section: updatedSeat.section,
          row: updatedSeat.row,
          seatNumber: updatedSeat.seatNumber,
          price: updatedSeat.tier.price,
          tierName: updatedSeat.tier.name,
          status: updatedSeat.status,
          lockedUntil: updatedSeat.lockedUntil,
          ttlSeconds: 600,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message });
    }
    console.error('Error locking seat:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Release / unlock seat before 10-minute expiry
 */
export const unlockSeat = async (req, res) => {
  try {
    const { seatId } = lockSeatSchema.parse(req.body);
    const userId = req.user.id;

    const seat = await prisma.seat.findUnique({
      where: { id: seatId },
    });

    if (!seat) {
      return res.status(404).json({ success: false, message: 'Seat not found' });
    }

    // Release in Redis
    await releaseSeatLock(seatId, userId);

    // Release in PostgreSQL
    const updated = await prisma.seat.update({
      where: { id: seatId },
      data: {
        status: 'AVAILABLE',
        lockedUntil: null,
        lockedByUserId: null,
      },
    });

    // Broadcast via Socket.io
    const io = getIO();
    if (io) {
      io.emit('seat:status_change', {
        eventId: seat.eventId,
        seatId: seat.id,
        section: seat.section,
        row: seat.row,
        seatNumber: seat.seatNumber,
        status: 'AVAILABLE',
        lockedUntil: null,
        lockedByUserId: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Seat unlocked successfully.',
      data: { seat: updated },
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * Generate seat grid for an event section
 */
export const generateSeatGrid = async (req, res) => {
  try {
    const validated = generateGridSchema.parse(req.body);
    const { eventId, section, tierId, rows, seatsPerRow } = validated;

    const createdSeats = [];

    for (let r = 1; r <= rows; r++) {
      const rowLetter = String.fromCharCode(64 + r); // A, B, C, D...
      for (let s = 1; s <= seatsPerRow; s++) {
        const seatNumber = `${s}`;
        const seat = await prisma.seat.upsert({
          where: {
            eventId_section_row_seatNumber: {
              eventId,
              section,
              row: rowLetter,
              seatNumber,
            },
          },
          update: { tierId },
          create: {
            eventId,
            section,
            row: rowLetter,
            seatNumber,
            tierId,
            status: 'AVAILABLE',
          },
        });
        createdSeats.push(seat);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Generated ${createdSeats.length} seats for Section ${section}.`,
      data: { count: createdSeats.length },
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
