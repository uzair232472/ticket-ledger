import crypto from 'crypto';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { drawTicketPdf, loadEventPhoto } from './ticketPdf.js';
import prisma from '../config/prisma.js';
import { passFor } from './qrPassService.js';

// Legacy HMAC payloads (the gate uses the Ed25519 passes in qrPassService.js). No hardcoded fallback; read per call
// because ES module imports run before dotenv.config().
const qrSecret = () => {
  const secret = process.env.QR_HMAC_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('QR_HMAC_SECRET or JWT_SECRET must be set.');
  return secret;
};

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
    .createHmac('sha256', qrSecret())
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
    .createHmac('sha256', qrSecret())
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
      const expectedSig = crypto.createHmac('sha256', qrSecret()).update(expectedMsg).digest('hex');

      if (signature !== expectedSig) {
        return { valid: false, reason: 'INVALID_SIGNATURE', message: 'Cryptographic signature mismatch! Counterfeit ticket.' };
      }
    } else {
      // v1 payload fallback
      const expectedMsg = `${ticketId}:${eventId}:${tokenId}:${nonce}:${issuedAt}:${qrVersion || '1.0'}`;
      const expectedSig = crypto.createHmac('sha256', qrSecret()).update(expectedMsg).digest('hex');

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

/*
 * processGateScan (the old /api/gate/scan admission) was removed: it admitted tickets with an unconditional update,
 * without device authentication, gate rules or re-entry policy. Admissions go through checkinService.scan
 * (POST /api/checkin/scan) and checkinService.syncOffline (POST /api/checkin/sync) only.
 */

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
