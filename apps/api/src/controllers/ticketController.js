import prisma from '../config/prisma.js';
import nftService from '../services/nftService.js';
import {
  createSignedQRPayload,
  generateQRDataUrl,
  verifyTicketQR,
  buildTicketPDF,
} from '../services/qrTicketService.js';
import { passFor } from '../services/qrPassService.js';
import { evaluate } from '../services/checkinService.js';

/**
 * 1. Explicitly mint NFT tickets for an order
 */
export const mintOrderNFTs = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        tickets: true,
      },
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied to this order' });
    }

    if (order.status !== 'SUCCESSFUL') {
      return res.status(400).json({
        success: false,
        message: 'Cannot mint NFT tickets for an unconfirmed or failed order.',
      });
    }

    const mintResult = await nftService.batchMintOrderTickets(orderId);

    return res.status(200).json({
      success: true,
      message: `Successfully minted ${mintResult.totalMinted} ERC721 NFT tickets on Polygon Amoy!`,
      data: mintResult,
    });
  } catch (error) {
    console.error('Error minting order NFTs:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Retrieve customer's complete Web3 NFT Ticket collection
 */
export const getMyNFTTickets = async (req, res) => {
  try {
    const userId = req.user.id;

    const tickets = await prisma.ticket.findMany({
      where: {
        userId,
        status: { not: 'CANCELLED' },
      },
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
            cardImageUrl: true,
          },
        },
        seat: {
          include: {
            tier: {
              select: { id: true, name: true, price: true },
            },
          },
        },
        order: {
          select: { id: true, paymentMethod: true, status: true, createdAt: true },
        },
        resaleListings: {
          where: { status: 'ACTIVE' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Auto-mint any confirmed tickets that don't have on-chain metadata yet
    const formattedNFTs = await Promise.all(
      tickets.map(async (t) => {
        let tokenId = t.tokenId;
        let txHash = t.txHash;
        let contractAddress = t.contractAddress;
        let ownerWallet = t.ownerWallet || req.user.walletAddress;

        if (!tokenId || !txHash) {
          try {
            const minted = await nftService.mintTicketNFT(t.id);
            tokenId = minted.tokenId;
            txHash = minted.txHash;
            contractAddress = minted.contractAddress;
            ownerWallet = minted.ownerWallet;
          } catch (e) {
            console.warn(`Background auto-mint skipped for ticket ${t.id}:`, e.message);
          }
        }

        const originalPrice = Number(t.price);
        const resalePriceCap = Math.floor((originalPrice * 110) / 100);

        return {
          id: t.id,
          status: t.status,
          price: originalPrice,
          resalePriceCap,
          antiScalpingRule: 'Max 110% of primary price enforced on-chain',
          event: t.event,
          seat: {
            id: t.seat.id,
            section: t.seat.section,
            row: t.seat.row,
            seatNumber: t.seat.seatNumber,
            kind: t.seat.kind,
            tierName: t.seat.tier.name,
          },
          blockchain: {
            network: 'Polygon Amoy Testnet',
            chainId: 80002,
            tokenId,
            contractAddress,
            ownerWallet,
            txHash,
            polygonscanTxUrl: txHash ? `https://amoy.polygonscan.com/tx/${txHash}` : null,
            polygonscanTokenUrl:
              contractAddress && tokenId
                ? `https://amoy.polygonscan.com/token/${contractAddress}?a=${tokenId}`
                : null,
            isMinted: Boolean(tokenId && txHash),
            isLiveOnChain: Boolean(process.env.POLYGON_PRIVATE_KEY && process.env.TICKET_NFT_CONTRACT_ADDRESS),
          },
          qrNonce: t.qrNonce,
          activeResaleListing: t.resaleListings?.[0] || null,
          createdAt: t.createdAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: {
        totalTickets: formattedNFTs.length,
        walletAddress: req.user.walletAddress || null,
        tickets: formattedNFTs,
      },
    });
  } catch (error) {
    console.error('Error fetching NFT tickets:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Retrieve single NFT ticket verification details
 */
export const getNFTTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        event: true,
        user: { select: { id: true, name: true, walletAddress: true } },
        seat: { include: { tier: true } },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const originalPrice = Number(ticket.price);
    const resalePriceCap = Math.floor((originalPrice * 110) / 100);

    return res.status(200).json({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          status: ticket.status,
          originalPrice,
          resalePriceCap,
          event: ticket.event,
          seat: ticket.seat,
          blockchain: {
            network: 'Polygon Amoy Testnet (ChainId 80002)',
            tokenId: ticket.tokenId,
            contractAddress: ticket.contractAddress,
            txHash: ticket.txHash,
            ownerWallet: ticket.ownerWallet,
            polygonscanUrl: ticket.txHash ? `https://amoy.polygonscan.com/tx/${ticket.txHash}` : null,
          },
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Digital Ticket & QR Wallet: Customer retrieves all purchased tickets with signed QR & NFT badges
 */
export const getCustomerWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    const tickets = await prisma.ticket.findMany({
      where: {
        userId,
        // Paid tickets only (an unfinished checkout's placeholder tickets have no valid pass)
        order: { status: 'SUCCESSFUL' },
      },
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
            cardImageUrl: true,
          },
        },
        seat: {
          include: {
            tier: {
              select: { id: true, name: true, price: true },
            },
          },
        },
        order: {
          select: { id: true, paymentMethod: true, status: true, createdAt: true },
        },
        resaleListings: {
          where: { status: 'ACTIVE' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const walletTickets = await Promise.all(
      tickets.map(async (t) => {
        let tokenId = t.tokenId;
        let txHash = t.txHash;
        let contractAddress = t.contractAddress;
        let ownerWallet = t.ownerWallet || req.user.walletAddress;

        // Auto-mint on Polygon Amoy if not yet minted
        if (!tokenId || !txHash) {
          try {
            const minted = await nftService.mintTicketNFT(t.id);
            tokenId = minted.tokenId;
            txHash = minted.txHash;
            contractAddress = minted.contractAddress;
            ownerWallet = minted.ownerWallet;
          } catch (e) {
            console.warn(`Background minting note for ticket ${t.id}:`, e.message);
          }
        }

        // Signed gate pass (TL1…) and its manual code; generated on demand, never stored
        const pass = await passFor(t);
        const qrCodeDataUrl = await generateQRDataUrl(pass.code);
        const originalPrice = Number(t.price);
        const resalePriceCap = Math.floor((originalPrice * 110) / 100);

        return {
          id: t.id,
          status: t.status,
          price: originalPrice,
          resalePriceCap,
          event: t.event,
          seat: {
            id: t.seat.id,
            section: t.seat.section,
            row: t.seat.row,
            seatNumber: t.seat.seatNumber,
            kind: t.seat.kind,
            tierName: t.seat.tier.name,
          },
          nft: {
            tokenId: tokenId || null,
            txHash: txHash || null,
            contractAddress: contractAddress || null,
            ownerWallet: ownerWallet || req.user.walletAddress || 'Platform Custodian',
            network: 'Polygon Amoy Testnet (ChainId 80002)',
            isMinted: Boolean(tokenId && txHash),
            ownershipBadge: {
              label: 'Verified ERC721 NFT Pass',
              network: 'Polygon Amoy',
              isOwner: true,
              wallet: ownerWallet || req.user.walletAddress || 'Platform Custodian',
            },
            polygonscanUrl: txHash ? `https://amoy.polygonscan.com/tx/${txHash}` : null,
          },
          qr: {
            code: pass.code,
            manualCode: pass.manualCode,
            qrVersion: pass.qrVersion,
            qrCodeDataUrl,
          },
          checkedInAt: t.checkedInAt,
          gate: t.gate,
          activeResaleListing: t.resaleListings?.[0] || null,
          createdAt: t.createdAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: {
        totalTickets: walletTickets.length,
        walletAddress: req.user.walletAddress || null,
        tickets: walletTickets,
      },
    });
  } catch (error) {
    console.error('Error fetching customer wallet:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Download Official PDF E-Ticket using PDFKit
 */
export const downloadTicketPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        event: true,
        seat: { include: { tier: true } },
        user: { select: { id: true, name: true, email: true, walletAddress: true } },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    if (ticket.userId !== userId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this ticket.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="TicketLedger-Pass-${ticket.id.slice(0, 8)}.pdf"`);

    await buildTicketPDF(ticket, res);
  } catch (error) {
    console.error('Error generating PDF ticket:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
};

/**
 * 6. Get real-time signed QR payload for an individual ticket
 */
export const getTicketQR = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        event: true,
        seat: { include: { tier: true } },
        order: { select: { status: true } },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // The pass is shown to its owner only (wallet and PDF)
    if (ticket.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (ticket.order?.status !== 'SUCCESSFUL') {
      return res.status(409).json({ success: false, message: 'This ticket has not been paid for yet.' });
    }

    const pass = await passFor(ticket);
    const qrCodeDataUrl = await generateQRDataUrl(pass.code);

    return res.status(200).json({
      success: true,
      data: {
        ticketId: ticket.id,
        status: ticket.status,
        code: pass.code,
        manualCode: pass.manualCode,
        qrVersion: pass.qrVersion,
        qrCodeDataUrl,
        checkedInAt: ticket.checkedInAt,
        gate: ticket.gate,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Verify QR Code Pass & Validate Nonce Invalidation
 */
export const verifyTicketQRPost = async (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload) {
      return res.status(400).json({ success: false, message: 'Missing QR payload to verify' });
    }

    // Read-only check of a pass (the wallet's "check my pass"); nothing is marked used
    const verdict = await evaluate(typeof payload === 'string' ? payload : payload.code, null);
    const valid = verdict.result === 'GREEN';
    return res.status(200).json({
      success: valid,
      valid,
      result: verdict.result,
      reason: verdict.result,
      message: valid ? 'Valid pass: it will be admitted at the gate.' : verdict.reason,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
