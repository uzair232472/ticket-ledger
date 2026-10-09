import { z } from 'zod';
import crypto from 'crypto';
import prisma from '../config/prisma.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

// Schemas
const listTicketSchema = z.object({
  ticketId: z.string().uuid('Invalid ticket ID'),
  resalePrice: z.number().positive('Resale price must be greater than 0'),
});

/**
 * 1. List an owned ticket for secondary resale with anti-scalping price ceiling
 */
export const listTicketForResale = async (req, res) => {
  try {
    const { ticketId, resalePrice } = listTicketSchema.parse(req.body);
    const userId = req.user.id;

    // Fetch ticket with event and seats
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: true,
        seat: {
          include: { tier: true },
        },
        resaleListings: {
          where: { status: { in: ['ACTIVE', 'PAUSED'] } },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Postponed or cancelled events can't be resold (buyers wouldn't know the date)
    if (ticket.event.postponedAt || ['CANCELLED', 'COMPLETED'].includes(ticket.event.status)) {
      return res.status(409).json({
        success: false,
        message: ticket.event.postponedAt
          ? 'This event is postponed. You can list your ticket once the new date is announced, or get a refund instead.'
          : `This event is ${ticket.event.status.toLowerCase()}, so its tickets can’t be resold.`,
      });
    }

    // Verify ownership
    if (ticket.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this ticket.',
      });
    }

    // Verify ticket is active (cannot resell scanned, resold, or cancelled tickets)
    if (ticket.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Cannot resell ticket with status '${ticket.status}'. Only active, unscanned tickets can be listed.`,
      });
    }

    // Check if already listed
    if (ticket.resaleListings && ticket.resaleListings.length > 0) {
      return res.status(409).json({
        success: false,
        message: ticket.resaleListings[0].status === 'PAUSED'
          ? 'This ticket’s listing was paused because the event moved. Relist it from My listings.'
          : 'This ticket is already actively listed on the secondary marketplace.',
      });
    }

    // Anti-Scalping Ceiling Check: Max 110% of primary original price
    const originalPrice = Number(ticket.price);
    const maxResalePrice = Math.floor(originalPrice * 1.10);

    if (resalePrice > maxResalePrice) {
      return res.status(400).json({
        success: false,
        message: `Anti-scalping violation: Maximum allowed resale price is Rs. ${maxResalePrice.toLocaleString()} (110% of original price Rs. ${originalPrice.toLocaleString()}). Predatory markups are blocked on-chain.`,
        data: {
          originalPrice,
          maxResalePrice,
          attemptedPrice: resalePrice,
        },
      });
    }

    // Create active Resale Listing
    const listing = await prisma.resaleListing.create({
      data: {
        ticketId: ticket.id,
        sellerId: userId,
        originalPrice,
        resalePrice,
        maxResalePrice,
        status: 'ACTIVE',
      },
      include: {
        ticket: {
          include: {
            seat: { include: { tier: true } },
            event: true,
          },
        },
      },
    });

    // Log Audit and Behavior
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'TICKET_LISTED_FOR_RESALE',
        targetType: 'ResaleListing',
        targetId: listing.id,
        details: {
          ticketId: ticket.id,
          originalPrice,
          resalePrice,
          maxResalePrice,
        },
      },
    });

    // Notify Waitlist users for this event
    try {
      const waitlistEntries = await prisma.waitlist.findMany({
        where: { eventId: ticket.eventId },
      });

      if (waitlistEntries.length > 0) {
        const targetWaitlist = waitlistEntries.filter((w) => w.userId !== userId);
        if (targetWaitlist.length > 0) {
          await prisma.notification.createMany({
            data: targetWaitlist.map((w) => ({
              userId: w.userId,
              type: 'RESALE_TICKET_AVAILABLE',
              title: '🎟️ Resale Ticket Available!',
              message: `A resale ticket is now available for ${ticket.event.name} (Tier: ${ticket.seat.tier.name}) at Rs. ${resalePrice.toLocaleString()}!`,
            })),
          });

          await prisma.waitlist.updateMany({
            where: {
              id: { in: targetWaitlist.map((w) => w.id) },
            },
            data: { notified: true },
          });
        }
      }
    } catch (notifyErr) {
      console.error('Failed to notify waitlist users:', notifyErr);
    }

    // Module 13: Track resale_attempted
    behaviorService.trackBehavior({
      req,
      userId,
      action: BEHAVIOR_ACTIONS.RESALE_ATTEMPTED,
      eventId: ticket.eventId,
      metadata: {
        ticketId,
        resalePrice,
        originalPrice: Number(ticket.price),
      },
    });

    await prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'RESALE_LISTED',
        title: `Ticket listed for resale: ${ticket.event.name}`,
        message: `Your ${ticket.seat.tier.name} ticket is listed on TicketLedger fan resale for Rs. ${resalePrice.toLocaleString()}. You’ll be notified when it sells.`,
      },
    });

    return res.status(201).json({
      success: true,
      message: `Ticket successfully listed on secondary marketplace for Rs. ${resalePrice.toLocaleString()} (Compliant with 110% Anti-Scalping Rule).`,
      data: { listing },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message });
    }
    console.error('Error listing ticket for resale:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Cancel an active resale listing
 */
export const cancelResaleListing = async (req, res) => {
  try {
    const { listingId } = req.params;
    const userId = req.user.id;

    const listing = await prisma.resaleListing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Resale listing not found' });
    }

    if (listing.sellerId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied to this listing' });
    }

    if (!['ACTIVE', 'PAUSED'].includes(listing.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel listing with status '${listing.status}'.`,
      });
    }

    const updated = await prisma.resaleListing.update({
      where: { id: listingId },
      data: { status: 'CANCELLED' },
    });

    await prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'RESALE_CANCELLED',
        title: 'Resale listing cancelled',
        message: 'Your resale listing was cancelled and the ticket is back in your wallet as an active pass.',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Resale listing cancelled. Ticket returned to your active passes.',
      data: { listing: updated },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Discover all active verified resale tickets
 */
export const getMarketListings = async (req, res) => {
  try {
    const { eventId, city, maxPrice, search } = req.query;

    const whereClause = {
      status: 'ACTIVE',
      ticket: {
        status: 'ACTIVE',
      },
    };

    if (eventId) {
      whereClause.ticket.eventId = eventId;
    }

    if (city) {
      whereClause.ticket.event = { city };
    }

    if (maxPrice) {
      whereClause.resalePrice = { lte: parseFloat(maxPrice) };
    }

    if (search) {
      whereClause.ticket.event = {
        ...whereClause.ticket.event,
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { venue: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const listings = await prisma.resaleListing.findMany({
      where: whereClause,
      include: {
        seller: {
          select: { id: true, name: true, city: true },
        },
        ticket: {
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
            seat: {
              include: {
                tier: { select: { id: true, name: true, price: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = listings.map((l) => {
      const orig = Number(l.originalPrice);
      const resPrice = Number(l.resalePrice);
      const markupPercent = Math.round(((resPrice - orig) / orig) * 100);

      return {
        id: l.id,
        resalePrice: resPrice,
        originalPrice: orig,
        maxAllowedCeiling: Number(l.maxResalePrice),
        markupPercent,
        status: l.status,
        seller: l.seller,
        event: l.ticket.event,
        seat: {
          id: l.ticket.seat.id,
          section: l.ticket.seat.section,
          row: l.ticket.seat.row,
          seatNumber: l.ticket.seat.seatNumber,
          tierName: l.ticket.seat.tier.name,
        },
        blockchain: {
          tokenId: l.ticket.tokenId,
          contractAddress: l.ticket.contractAddress,
          txHash: l.ticket.txHash,
        },
        createdAt: l.createdAt,
      };
    });

    // Module 13: Track resale_viewed
    behaviorService.trackBehavior({
      req,
      action: BEHAVIOR_ACTIONS.RESALE_VIEWED,
      eventId: eventId || null,
      metadata: {
        city: city || null,
        activeListingsCount: formatted.length,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        totalActiveListings: formatted.length,
        antiScalpingPolicy: 'All resale tickets are price-capped at max 110% of primary cost on-chain',
        listings: formatted,
      },
    });
  } catch (error) {
    console.error('Error fetching market listings:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Retrieve logged-in seller's own listings
 */
export const getMyListings = async (req, res) => {
  try {
    const userId = req.user.id;

    const listings = await prisma.resaleListing.findMany({
      where: { sellerId: userId },
      include: {
        ticket: {
          include: {
            event: true,
            seat: { include: { tier: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: { listings },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Purchase a secondary market resale ticket
 */
export const buyResaleTicket = async (req, res) => {
  try {
    const { listingId } = req.params;
    const buyerId = req.user.id;

    // Fetch listing with ticket
    const listing = await prisma.resaleListing.findUnique({
      where: { id: listingId },
      include: {
        seller: true,
        ticket: {
          include: {
            event: true,
            seat: { include: { tier: true } },
          },
        },
      },
    });

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Resale listing not found' });
    }

    if (listing.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'This resale listing is no longer active (already sold or cancelled).',
      });
    }

    // The event moved, was postponed or cancelled since the listing went up
    const ev = listing.ticket.event;
    if (ev.status !== 'PUBLISHED' || ev.postponedAt || listing.ticket.status !== 'ACTIVE') {
      return res.status(409).json({ success: false, message: 'This event is no longer on sale, so this ticket can’t be bought.' });
    }

    // Buyer cannot buy their own ticket
    if (listing.sellerId === buyerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot purchase your own resale listing.',
      });
    }

    const oldNonce = listing.ticket.qrNonce;
    const newNonce = crypto.randomUUID();

    // Execute atomic secondary ownership transfer
    const updatedTicket = await prisma.$transaction(async (tx) => {
      // 1. Mark listing as SOLD
      await tx.resaleListing.update({
        where: { id: listingId },
        data: {
          status: 'SOLD',
          buyerId,
        },
      });

      // 2. Transfer Ticket ownership, reset dynamic QR nonce (revokes seller's gate access!)
      const transferred = await tx.ticket.update({
        where: { id: listing.ticketId },
        data: {
          userId: buyerId,
          ownerWallet: req.user.walletAddress || listing.ticket.ownerWallet,
          status: 'ACTIVE',
          // Generate new QR nonce so old seller's screenshot/QR pass is destroyed
          qrNonce: newNonce,
          qrIssuedAt: new Date(),
          // The previous owner's QR and manual code stop working
          qrVersion: { increment: 1 },
          manualCode: null,
        },
        include: {
          event: true,
          seat: { include: { tier: true } },
        },
      });

      // 3. Record in TicketTransferHistory table
      await tx.ticketTransferHistory.create({
        data: {
          ticketId: listing.ticketId,
          fromUserId: listing.sellerId,
          toUserId: buyerId,
          transferType: 'P2P_RESALE',
          price: listing.resalePrice,
          oldNonce,
          newNonce,
          txHash: listing.ticket.txHash,
        },
      });

      // 3. Notify Seller
      await tx.notification.create({
        data: {
          userId: listing.sellerId,
          type: 'RESALE_TICKET_SOLD',
          title: '💰 Ticket Sold on Secondary Market!',
          message: `Your ticket for ${listing.ticket.event.name} (Section ${listing.ticket.seat.section} Row ${listing.ticket.seat.row} Seat ${listing.ticket.seat.seatNumber}) was purchased for Rs. ${Number(listing.resalePrice).toLocaleString()}. Funds have been credited.`,
        },
      });

      // 4. Notify Buyer
      await tx.notification.create({
        data: {
          userId: buyerId,
          type: 'RESALE_TICKET_PURCHASED',
          title: '🎟️ Verified Resale Ticket Acquired!',
          message: `You successfully purchased a verified pass for ${listing.ticket.event.name} (Section ${listing.ticket.seat.section} Row ${listing.ticket.seat.row} Seat ${listing.ticket.seat.seatNumber}) at the regulated price of Rs. ${Number(listing.resalePrice).toLocaleString()}.`,
        },
      });

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          userId: buyerId,
          action: 'RESALE_PURCHASE_COMPLETED',
          targetType: 'Ticket',
          targetId: listing.ticketId,
          details: {
            listingId,
            sellerId: listing.sellerId,
            buyerId,
            originalPrice: Number(listing.originalPrice),
            resalePrice: Number(listing.resalePrice),
            seatId: listing.ticket.seatId,
          },
        },
      });

      return transferred;
    });

    return res.status(200).json({
      success: true,
      message: 'Resale ticket purchased successfully! Ownership transferred and new dynamic QR pass issued.',
      data: {
        ticket: updatedTicket,
        receipt: {
          listingId,
          amountPaid: Number(listing.resalePrice),
          currency: 'PKR',
          purchasedAt: new Date(),
          sellerName: listing.seller.name,
        },
      },
    });
  } catch (error) {
    console.error('Error buying resale ticket:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Seller puts a listing paused by a reschedule back on the market (optionally at a new price, still
 * within the 110% cap), now that buyers see the new date.
 */
export const relistResaleListing = async (req, res) => {
  try {
    const listing = await prisma.resaleListing.findUnique({ where: { id: req.params.listingId }, include: { ticket: { include: { event: true } } } });
    if (!listing) return res.status(404).json({ success: false, message: 'Resale listing not found' });
    if (listing.sellerId !== req.user.id) return res.status(403).json({ success: false, message: 'Access denied to this listing' });
    if (listing.status !== 'PAUSED') return res.status(400).json({ success: false, message: 'Only a paused listing can be relisted.' });
    const { event } = listing.ticket;
    if (event.status !== 'PUBLISHED' || event.postponedAt || listing.ticket.status !== 'ACTIVE') {
      return res.status(409).json({ success: false, message: 'This event isn’t on sale right now, so the ticket can’t be relisted yet.' });
    }
    const price = req.body?.resalePrice != null ? Number(req.body.resalePrice) : Number(listing.resalePrice);
    if (!(price > 0) || price > Number(listing.maxResalePrice)) {
      return res.status(400).json({ success: false, message: `Choose a price up to Rs. ${Number(listing.maxResalePrice).toLocaleString()} (110% of face value).` });
    }
    const updated = await prisma.resaleListing.update({ where: { id: listing.id }, data: { status: 'ACTIVE', resalePrice: price } });
    return res.json({ success: true, message: 'Your ticket is listed again with the new date.', data: { listing: updated } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
