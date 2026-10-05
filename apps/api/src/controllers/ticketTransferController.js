import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

const transferSchema = z.object({
  ticketId: z.string().uuid('Invalid ticket ID'),
  recipientEmail: z.string().email('Invalid recipient email address'),
});

/**
 * 1. Customer can transfer ticket directly to another registered user
 */
export const transferTicketDirectly = async (req, res) => {
  try {
    const { ticketId, recipientEmail } = transferSchema.parse(req.body);
    const senderId = req.user.id;
    const normalizedEmail = recipientEmail.toLowerCase().trim();

    // Check sender owns the ticket
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: true,
        seat: { include: { tier: true } },
        resaleListings: { where: { status: 'ACTIVE' } },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    if (ticket.userId !== senderId) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this ticket.' });
    }

    if (ticket.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Cannot transfer ticket with status '${ticket.status}'. Only active, unscanned tickets can be transferred.`,
      });
    }

    // Lookup recipient in database
    const recipient = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: `Recipient account '${recipientEmail}' is not registered on TicketLedger. Both parties must be registered users.`,
      });
    }

    if (recipient.id === senderId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer a ticket to your own account.',
      });
    }

    const oldNonce = ticket.qrNonce;
    const newNonce = crypto.randomUUID();

    // Perform atomic ownership transfer & QR nonce regeneration
    const transferResult = await prisma.$transaction(async (tx) => {
      // 1. Cancel any active resale listings if present
      if (ticket.resaleListings && ticket.resaleListings.length > 0) {
        await tx.resaleListing.updateMany({
          where: { ticketId: ticket.id, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        });
      }

      // 2. Transfer ticket ownership & regenerate QR nonce (invalidating old QR)
      const updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          userId: recipient.id,
          ownerWallet: recipient.walletAddress || ticket.ownerWallet,
          qrNonce: newNonce,
          qrIssuedAt: new Date(),
          // The previous owner's QR and manual code stop working
          qrVersion: { increment: 1 },
          manualCode: null,
        },
        include: {
          event: true,
          seat: { include: { tier: true } },
          user: { select: { id: true, name: true, email: true, walletAddress: true } },
        },
      });

      // 3. Store in TicketTransferHistory table
      const historyRecord = await tx.ticketTransferHistory.create({
        data: {
          ticketId: ticket.id,
          fromUserId: senderId,
          toUserId: recipient.id,
          transferType: 'DIRECT_TRANSFER',
          price: 0,
          oldNonce,
          newNonce,
          txHash: ticket.txHash,
        },
      });

      // 4. Send in-app notification to recipient
      await tx.notification.create({
        data: {
          userId: recipient.id,
          type: 'TICKET_RECEIVED',
          title: '🎟️ You Received a Ticket!',
          message: `${req.user.name} transferred a ticket for ${ticket.event.name} (Tier: ${ticket.seat.tier.name}, Row ${ticket.seat.row} #${ticket.seat.seatNumber}) to your account. A fresh QR code is now in your wallet!`,
        },
      });

      // 5. Send in-app notification to sender
      await tx.notification.create({
        data: {
          userId: senderId,
          type: 'TICKET_TRANSFERRED',
          title: '✓ Ticket Transfer Completed',
          message: `Your ticket for ${ticket.event.name} has been transferred to ${recipient.name} (${recipient.email}). Your gate pass has been revoked.`,
        },
      });

      // 6. Audit Log
      await tx.auditLog.create({
        data: {
          userId: senderId,
          action: 'TICKET_TRANSFERRED_DIRECTLY',
          targetType: 'Ticket',
          targetId: ticket.id,
          details: {
            fromUserId: senderId,
            toUserId: recipient.id,
            recipientEmail,
            oldNonce,
            newNonce,
          },
        },
      });

      return { updated, historyRecord };
    });

    // Module 13: Track ticket_transferred
    behaviorService.trackBehavior({
      req,
      userId: senderId,
      action: BEHAVIOR_ACTIONS.TICKET_TRANSFERRED,
      eventId: ticket.eventId,
      metadata: {
        ticketId: ticket.id,
        recipientEmail: recipient.email,
        recipientId: recipient.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Ticket successfully transferred to ${recipient.name} (${recipient.email})! Gate pass QR has been refreshed for the new owner.`,
      data: {
        ticketId: transferResult.updated.id,
        newOwner: {
          id: recipient.id,
          name: recipient.name,
          email: recipient.email,
        },
        oldNonceInvalidated: oldNonce,
        newNonceIssued: newNonce,
        historyId: transferResult.historyRecord.id,
      },
    });
  } catch (error) {
    console.error('Error transferring ticket:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Join Event Waitlist
 */
export const joinEventWaitlist = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const waitlistEntry = await prisma.waitlist.upsert({
      where: {
        eventId_userId: { eventId, userId },
      },
      update: {
        notified: false,
      },
      create: {
        eventId,
        userId,
        notified: false,
      },
    });

    const totalCount = await prisma.waitlist.count({
      where: { eventId },
    });

    return res.status(200).json({
      success: true,
      message: `You have joined the waitlist for '${event.name}'. You will be immediately notified when a secondary resale ticket is listed!`,
      data: {
        waitlistId: waitlistEntry.id,
        totalWaitlistCount: totalCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Check Event Waitlist Status
 */
export const getEventWaitlistStatus = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    const entry = await prisma.waitlist.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });

    const totalCount = await prisma.waitlist.count({
      where: { eventId },
    });

    return res.status(200).json({
      success: true,
      data: {
        onWaitlist: Boolean(entry),
        totalWaitlistCount: totalCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Retrieve Transfer & Resale History for a Ticket
 */
export const getTicketTransferHistory = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const history = await prisma.ticketTransferHistory.findMany({
      where: { ticketId },
      include: {
        fromUser: { select: { id: true, name: true, email: true } },
        toUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: {
        totalTransfers: history.length,
        history,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Retrieve My Transfer & Resale History (Sent and Received)
 */
export const getMyTransferHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const sent = await prisma.ticketTransferHistory.findMany({
      where: { fromUserId: userId },
      include: {
        ticket: {
          include: {
            event: { select: { id: true, name: true, date: true, venue: true } },
            seat: { include: { tier: true } },
          },
        },
        toUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const received = await prisma.ticketTransferHistory.findMany({
      where: { toUserId: userId },
      include: {
        ticket: {
          include: {
            event: { select: { id: true, name: true, date: true, venue: true } },
            seat: { include: { tier: true } },
          },
        },
        fromUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: {
        sentCount: sent.length,
        receivedCount: received.length,
        sent,
        received,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
