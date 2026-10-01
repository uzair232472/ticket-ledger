import crypto from 'crypto';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import prisma from '../config/prisma.js';

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
  return await QRCode.toDataURL(JSON.stringify(payload), {
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
  return await QRCode.toBuffer(JSON.stringify(payload), {
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
 * 5. Generate PDF E-Ticket using PDFKit
 */
export const buildTicketPDF = async (ticket, res) => {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `TicketLedger Pass - ${ticket.event?.name || 'Event'}`,
      Author: 'TicketLedger Blockchain System',
      Subject: 'Official Event E-Ticket & Polygon Amoy NFT Gate Pass',
    },
  });

  doc.pipe(res);

  // Generate QR payload and PNG Buffer
  const qrPayload = createSignedQRPayload(ticket);
  const qrBuffer = await generateQRBuffer(qrPayload);

  // Header Banner Background
  doc.rect(40, 40, 515, 95).fill('#090d16');

  // Brand Name
  doc.fillColor('#10b981').fontSize(18).font('Helvetica-Bold').text('TICKETLEDGER', 60, 55);
  doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text('BLOCKCHAIN EVENT TICKETING • POLYGON AMOY', 60, 78);

  // NFT Ownership Badge
  doc.rect(370, 55, 170, 24).fillAndStroke('#132f22', '#10b981');
  doc.fillColor('#34d399').fontSize(8).font('Helvetica-Bold').text('POLYGON AMOY NFT PASS', 382, 63);

  const tokenIdDisplay = ticket.tokenId ? `#${ticket.tokenId}` : 'PENDING MINT';
  doc.fillColor('#a7f3d0').fontSize(8).font('Helvetica').text(`TOKEN ID: ${tokenIdDisplay}`, 382, 73);

  // Event Details Box
  doc.rect(40, 145, 515, 230).fill('#0f172a');

  // Event Title
  doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold').text(ticket.event?.name || 'Live Event', 60, 165, { width: 475 });
  
  // Category / Type
  doc.fillColor('#10b981').fontSize(9).font('Helvetica-Bold').text(
    (ticket.event?.type || 'EVENT').replace('_', ' ').toUpperCase(),
    60,
    188
  );

  // Divider Line
  doc.strokeColor('#334155').lineWidth(1).moveTo(60, 202).lineTo(495, 202).stroke();

  // Grid details (Left: Venue, Date, Attendee, Right: Seat coordinates)
  // Venue
  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('VENUE & CITY', 60, 215);
  doc.fillColor('#f8fafc').fontSize(10).font('Helvetica-Bold').text(`${ticket.event?.venue || 'Venue'}, ${ticket.event?.city || 'Pakistan'}`, 60, 226, { width: 230 });

  // Date & Time
  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('DATE & TIME', 60, 255);
  const eventDate = ticket.event?.date ? new Date(ticket.event.date).toLocaleDateString('en-PK', { dateStyle: 'full' }) : 'TBD';
  doc.fillColor('#f8fafc').fontSize(10).font('Helvetica-Bold').text(`${eventDate} • ${ticket.event?.time || '7:00 PM'}`, 60, 266, { width: 230 });

  // Attendee
  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('TICKET HOLDER', 60, 295);
  doc.fillColor('#f8fafc').fontSize(10).font('Helvetica-Bold').text(ticket.user?.name || 'Verified Customer', 60, 306);
  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text(`Email: ${ticket.user?.email || 'N/A'}`, 60, 319);

  // Seat Badge (Right Box)
  doc.rect(320, 215, 215, 125).fill('#1e293b');
  doc.fillColor('#10b981').fontSize(8).font('Helvetica-Bold').text('SEAT ALLOCATION', 335, 227);

  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('TIER', 335, 245);
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(ticket.seat?.tier?.name || 'Standard Tier', 335, 257);

  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('ROW', 335, 280);
  doc.fillColor('#38bdf8').fontSize(13).font('Helvetica-Bold').text(ticket.seat?.row || 'GA', 335, 292);

  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('SEAT #', 420, 280);
  doc.fillColor('#34d399').fontSize(13).font('Helvetica-Bold').text(ticket.seat?.seatNumber ? `#${ticket.seat.seatNumber}` : 'GA', 420, 292);

  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('PAID PRICE', 335, 315);
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(`PKR ${Number(ticket.price || 0).toLocaleString()}`, 335, 326);

  // Gate QR Verification Section
  doc.rect(40, 390, 515, 270).fill('#090d16');

  // Embed Signed QR Code
  doc.image(qrBuffer, 65, 410, { width: 170, height: 170 });

  // QR Instructions & Cryptographic Audit
  doc.fillColor('#ffffff').fontSize(12).font('Helvetica-Bold').text('OFFICIAL GATE PASS', 260, 420);
  doc.fillColor('#10b981').fontSize(9).font('Helvetica-Bold').text('CRYPTOGRAPHIC HMAC-SHA256 SIGNED', 260, 436);

  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text(
    'Present this QR pass at the stadium turnstile or venue scanner. The signature is verified against the TicketLedger master key.',
    260,
    455,
    { width: 275, lineGap: 3 }
  );

  // Technical Metadata
  doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text('GATE SECURITY NONCE:', 260, 495);
  doc.fillColor('#cbd5e1').fontSize(7.5).font('Courier-Bold').text(ticket.qrNonce || 'N/A', 260, 506);

  doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text('CRYPTOGRAPHIC SIGNATURE (HMAC-SHA256):', 260, 523);
  doc.fillColor('#10b981').fontSize(6.5).font('Courier').text(qrPayload.signature, 260, 534, { width: 275 });

  doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text('ON-CHAIN TRANSACTION HASH:', 260, 555);
  doc.fillColor('#c084fc').fontSize(7).font('Courier').text(ticket.txHash || 'Custodial On-Chain Record', 260, 566, { width: 275 });

  // Security & Anti-Scalping Footer
  doc.rect(40, 680, 515, 80).fill('#0f172a');
  doc.fillColor('#f59e0b').fontSize(8).font('Helvetica-Bold').text('SECURITY & ANTI-SCALPING POLICY', 60, 695);
  doc.fillColor('#94a3b8').fontSize(7.5).font('Helvetica').text(
    '1. Each ticket is cryptographically unique. Screenshots and duplicated copies are automatically invalidated upon first scan.\n' +
    '2. Resale is strictly restricted to the official TicketLedger Secondary Marketplace bounded by a mandatory 110% price ceiling.\n' +
    '3. If resold or transferred, this QR code and its nonce are permanently invalidated, and a new pass is issued to the buyer.',
    60,
    708,
    { width: 475, lineGap: 2.5 }
  );

  doc.end();
};
