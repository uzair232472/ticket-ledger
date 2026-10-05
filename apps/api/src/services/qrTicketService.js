import crypto from 'crypto';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { drawTicketPdf, loadEventPhoto } from './ticketPdf.js';
import prisma from '../config/prisma.js';
import { passFor } from './qrPassService.js';

const QR_SECRET = process.env.QR_HMAC_SECRET || process.env.JWT_SECRET || 'ticketledger_qr_master_secret_key_2026_fyp';

/**
 * 1. Generate Cryptographically Signed QR Payload
 * Required fields: ticketId, eventId, tokenId, nonce, issuedAt, qrVersion, signature
 */
export const createSignedQRPayload = (ticket) => {
  const ticketId = ticket.id;
  const eventId = ticket.eventId;
  const tokenId = Number(ticket.tokenId || 0);
  const nonce = ticket.qrNonce;
  const issuedAt = Date.now();
  const qrVersion = '1.0';

  // Compute HMAC signature across immutable core fields
  const message = `${ticketId}:${eventId}:${tokenId}:${nonce}:${issuedAt}:${qrVersion}`;
  const signature = crypto
    .createHmac('sha256', QR_SECRET)
    .update(message)
    .digest('hex');

  return {
    ticketId,
    eventId,
    tokenId,
    nonce,
    issuedAt,
    qrVersion,
    signature,
  };
};

/**
 * 2. Generate Base64 Data URL for Frontend Display
 */
export const generateQRDataUrl = async (payload) => {
  return await QRCode.toDataURL(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 320,
    color: {
      dark: '#030712',
      light: '#ffffff',
    },
  });
};

/**
 * 3. Generate PNG Buffer for PDFKit Embedding
 */
export const generateQRBuffer = async (payload) => {
  return await QRCode.toBuffer(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 300,
  });
};

export const ROTATION_WINDOW_SECONDS = 30;

/**
 * Generate Dynamic Rotating Time-Step QR Payload (Anti-Screenshot Security)
 */
export const createDynamicQRPayload = (ticket, timestamp = Date.now()) => {
  const ticketId = ticket.id;
  const eventId = ticket.eventId || ticket.event?.id;
  const tokenId = Number(ticket.tokenId || ticket.nft?.tokenId || 0);
  const nonce = ticket.qrNonce || ticket.qr?.nonce;
  const timeStep = Math.floor(timestamp / (ROTATION_WINDOW_SECONDS * 1000));
  const issuedAt = timestamp;
  const expiresAt = (timeStep + 1) * (ROTATION_WINDOW_SECONDS * 1000);
  const qrVersion = '2.0-dynamic';

  const message = `${ticketId}:${eventId}:${tokenId}:${nonce}:${timeStep}:${qrVersion}`;
  const signature = crypto
    .createHmac('sha256', QR_SECRET)
    .update(message)
    .digest('hex');

  return {
    ticketId,
    eventId,
    tokenId,
    nonce,
    timeStep,
    issuedAt,
    expiresAt,
    windowSeconds: ROTATION_WINDOW_SECONDS,
    qrVersion,
    signature,
  };
};

/**
 * Offline HMAC Mathematical Validation (Runs locally on scanner without database)
 */
export const verifyOfflineHMAC = (payload, currentTimestamp = Date.now()) => {
  try {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const { ticketId, eventId, tokenId, nonce, timeStep, issuedAt, qrVersion, signature } = data;

    if (!ticketId || !nonce || !signature) {
      return { valid: false, reason: 'MALFORMED_PAYLOAD', message: 'Missing mandatory payload fields.' };
    }

    if (timeStep !== undefined) {
      // Dynamic TOTP verification
      const currentStep = Math.floor(currentTimestamp / (ROTATION_WINDOW_SECONDS * 1000));
      // Allow current step or previous step (1-step window for clock drift)
      if (timeStep < currentStep - 1) {
        return {
          valid: false,
          reason: 'EXPIRED_SCREENSHOT',
          message: 'Access Denied: Dynamic QR has expired! Screenshots and static photos are rejected by gate scanner.',
        };
      }

      const expectedMsg = `${ticketId}:${eventId}:${tokenId}:${nonce}:${timeStep}:${qrVersion}`;
      const expectedSig = crypto.createHmac('sha256', QR_SECRET).update(expectedMsg).digest('hex');

      if (signature !== expectedSig) {
        return { valid: false, reason: 'INVALID_SIGNATURE', message: 'Cryptographic signature mismatch! Counterfeit ticket.' };
      }
    } else {
      // v1 payload fallback
      const expectedMsg = `${ticketId}:${eventId}:${tokenId}:${nonce}:${issuedAt}:${qrVersion || '1.0'}`;
      const expectedSig = crypto.createHmac('sha256', QR_SECRET).update(expectedMsg).digest('hex');

      if (signature !== expectedSig) {
        return { valid: false, reason: 'INVALID_SIGNATURE', message: 'Cryptographic signature mismatch! Counterfeit ticket.' };
      }
    }

    return {
      valid: true,
      message: 'Offline HMAC signature mathematically verified!',
      ticketId,
      eventId,
      tokenId,
      nonce,
    };
  } catch (err) {
    return { valid: false, reason: 'PARSING_ERROR', message: err.message };
  }
};

/**
 * Verification without modifying status (used by attendee wallet check & API verify)
 */
export const verifyTicketQR = async (rawPayload) => {
  const offlineCheck = verifyOfflineHMAC(rawPayload);
  if (!offlineCheck.valid) {
    return offlineCheck;
  }

  const { ticketId, nonce } = offlineCheck;
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      event: true,
      seat: { include: { tier: true } },
      user: { select: { id: true, name: true, email: true, walletAddress: true } },
    },
  });

  if (!ticket) {
    return { valid: false, reason: 'NOT_FOUND', message: 'Ticket not found in ledger.' };
  }

  if (ticket.qrNonce !== nonce) {
    return {
      valid: false,
      reason: 'INVALIDATED_OLD_QR',
      message: 'Access Denied: This QR pass has been invalidated due to a ticket transfer or resale! A new QR code was issued to the current owner.',
      ticket: { id: ticket.id, status: ticket.status, currentOwner: ticket.user.name },
    };
  }

  if (ticket.status !== 'ACTIVE') {
    return {
      valid: false,
      reason: `TICKET_${ticket.status}`,
      message: `Ticket cannot be used for entry because its status is '${ticket.status}'.`,
      ticket,
    };
  }

  return {
    valid: true,
    message: 'Gate Pass Cryptographically Verified!',
    ticket,
    verifiedAt: new Date().toISOString(),
  };
};

/**
 * Gate Staff Check-In & Turnstile Processing (Updates DB, prevents double-entry, logs GateScan)
 */
/**
 * allowedEventIds: events the scanner may admit to (null = any event, used for Super Admins).
 */
export const processGateScan = async ({ payload, staffId, gateNumber = 'Gate 1', offlineMode = false, allowedEventIds = null }) => {
  // 1. First run offline HMAC verification
  const offlineCheck = verifyOfflineHMAC(payload);
  if (!offlineCheck.valid) {
    return {
      valid: false,
      result: 'INVALID_SCAN',
      reason: offlineCheck.reason,
      message: offlineCheck.message,
    };
  }

  const { ticketId, nonce } = offlineCheck;

  // 2. Fetch ticket from database
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      event: true,
      seat: { include: { tier: true } },
      user: { select: { id: true, name: true, email: true, phone: true } },
      scans: { orderBy: { scanTime: 'desc' }, take: 1, include: { staff: { select: { name: true } } } },
    },
  });

  if (!ticket) {
    return {
      valid: false,
      result: 'INVALID_SCAN',
      reason: 'NOT_FOUND',
      message: 'Ticket not found in ledger.',
    };
  }

  // Gate staff may only admit tickets for events they are assigned to (organizers: their own events)
  if (allowedEventIds && !allowedEventIds.includes(ticket.eventId)) {
    return {
      valid: false,
      result: 'INVALID_SCAN',
      reason: 'EVENT_NOT_ASSIGNED',
      message: 'This ticket is for an event you are not assigned to.',
    };
  }

  // 3. Check Nonce (prevents old QR after transfer/resale)
  if (ticket.qrNonce !== nonce) {
    return {
      valid: false,
      result: 'INVALID_SCAN',
      reason: 'INVALIDATED_OLD_QR',
      message: 'Access Denied: Ticket was transferred or resold. Gate pass revoked.',
      ticket: { id: ticket.id, currentOwner: ticket.user.name },
    };
  }

  // 4. Check Double Entry (Already Scanned)
  if (ticket.status === 'SCANNED') {
    const prevScan = ticket.scans[0];
    const prevTime = prevScan ? new Date(prevScan.scanTime).toLocaleTimeString() : 'earlier';
    const prevGate = prevScan?.gateNumber || 'Turnstile';

    // Log double-entry attempt in audit
    if (staffId) {
      await prisma.gateScan.create({
        data: {
          ticketId: ticket.id,
          staffId,
          result: 'ALREADY_SCANNED',
          gateNumber,
          notes: `Double entry attempt at ${gateNumber}. Previously scanned at ${prevGate} (${prevTime}).`,
        },
      });
    }

    return {
      valid: false,
      result: 'ALREADY_SCANNED',
      reason: 'ALREADY_SCANNED',
      message: `DOUBLE ENTRY REJECTED: This ticket was already scanned at ${prevGate} at ${prevTime}. Entry denied.`,
      ticket: {
        id: ticket.id,
        event: ticket.event.name,
        seat: `${ticket.seat.tier.name} - Row ${ticket.seat.row} #${ticket.seat.seatNumber}`,
        attendee: ticket.user.name,
        previousScanTime: prevScan?.scanTime,
      },
    };
  }

  // 5. Check Non-Active Status
  if (ticket.status !== 'ACTIVE') {
    return {
      valid: false,
      result: 'INVALID_SCAN',
      reason: `TICKET_${ticket.status}`,
      message: `Access Denied: Ticket status is '${ticket.status}'.`,
      ticket,
    };
  }

  // 6. VALID FIRST SCAN: Atomically update ticket status to SCANNED and record GateScan
  const [updatedTicket, scanRecord] = await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'SCANNED' },
    }),
    prisma.gateScan.create({
      data: {
        ticketId: ticket.id,
        staffId: staffId || ticket.userId, // fallback if staffId not provided
        result: 'VALID_FIRST_SCAN',
        gateNumber,
        notes: `Verified dynamic QR. Admitted to ${ticket.seat.section} Row ${ticket.seat.row} #${ticket.seat.seatNumber}.`,
      },
    }),
  ]);

  return {
    valid: true,
    result: 'VALID_FIRST_SCAN',
    message: 'ACCESS GRANTED: Turnstile Open! Welcome to event.',
    ticket: {
      id: updatedTicket.id,
      status: updatedTicket.status,
      event: ticket.event,
      seat: {
        section: ticket.seat.section,
        row: ticket.seat.row,
        seatNumber: ticket.seat.seatNumber,
        tierName: ticket.seat.tier.name,
      },
      attendee: {
        name: ticket.user.name,
        email: ticket.user.email,
        phone: ticket.user.phone,
      },
      scanTime: scanRecord.scanTime,
      gateNumber: scanRecord.gateNumber,
    },
  };
};

/**
 * 5. Generate the PDF e-ticket (layout in ticketPdf.js)
 */
export const buildTicketPDF = async (ticket, res) => {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: `TicketLedger Pass - ${ticket.event?.name || 'Event'}`,
      Author: 'TicketLedger',
      Subject: 'Official event pass',
    },
  });

  // Prepare everything before streaming, so a failure can still return a JSON error
  // The same signed pass the wallet shows, plus the manual code for when the camera fails
  const pass = await passFor(ticket);
  const qrBuffer = await generateQRBuffer(pass.code);
  const photo = await loadEventPhoto(ticket.event);

  doc.pipe(res);
  drawTicketPdf(doc, ticket, { qrBuffer, photo, manualCode: pass.manualCode });
  doc.end();
};
