import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { verifyPass, normaliseManualCode, looksLikeManualCode, ensureManualCodes, getPublicKey } from './qrPassService.js';

/**
 * Gate check-in.
 *
 * Ticket statuses map onto the scanning states as: ACTIVE = valid, SCANNED = used, CANCELLED = refunded /
 * cancelled (TRANSFERRED / RESOLD are retired records of a pass that moved to someone else).
 *
 * Every scan, admitted or not, is logged in CheckIn (fraud evidence and audit trail). Admission is a single
 * conditional UPDATE, so two gates scanning the same ticket at the same moment can't both let it in.
 */

const ticketInclude = {
  event: { select: { id: true, name: true, status: true } },
  order: { select: { status: true } },
  seat: { select: { section: true, row: true, seatNumber: true, kind: true, tier: { select: { name: true } } } },
  user: { select: { name: true } },
  checkedInBy: { select: { name: true } },
};

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'Guest';
const seatLabel = (seat) => {
  if (!seat) return 'General admission';
  if (seat.kind === 'GA_SLOT') return `${seat.section || 'General admission'}`;
  return [seat.section, seat.row && `Row ${seat.row}`, seat.seatNumber && `Seat ${seat.seatNumber}`].filter(Boolean).join(' · ');
};
const timeOf = (d) => new Date(d).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });

const ticketView = (t) => t && {
  id: t.id,
  type: t.seat?.tier?.name || 'Ticket',
  seat: seatLabel(t.seat),
  holder: firstName(t.user?.name),
  holderName: (t.user?.name || '').trim() || 'Guest',
  // Short code printed under the QR (TL-XXXX-XXXX), or the start of the ticket id
  code: t.manualCode || `TL-${String(t.id).slice(0, 8).toUpperCase()}`,
  checkedInAt: t.checkedInAt || null,
  gate: t.gate || null,
  event: t.event?.name,
};

/**
 * Runs the checks in order and returns the verdict without changing anything:
 * { result: 'GREEN'|'YELLOW'|'RED', reason, ticket?, firstScan? }.
 */
export async function evaluate(raw, eventId) {
  const text = String(raw || '').trim();
  let ticket = null;
  let qrVersion = null;

  if (looksLikeManualCode(text)) {
    ticket = await prisma.ticket.findUnique({ where: { manualCode: normaliseManualCode(text) }, include: ticketInclude });
    if (!ticket) return { result: 'RED', reason: 'No ticket has this code' };
    qrVersion = ticket.qrVersion; // codes are replaced on transfer, so a matching code is the current one
  } else {
    // 1. Signature
    const pass = verifyPass(text);
    if (!pass.ok) return { result: 'RED', reason: pass.reason };
    // 2. Exists
    ticket = await prisma.ticket.findUnique({ where: { id: pass.ticketId }, include: ticketInclude });
    if (!ticket || ticket.eventId !== pass.eventId) return { result: 'RED', reason: 'Invalid ticket (not found)' };
    qrVersion = pass.qrVersion;
  }

  // 3. Right event
  if (eventId && ticket.eventId !== eventId) {
    return { result: 'RED', reason: `Ticket is for a different event (${ticket.event?.name || 'another event'})`, ticket };
  }
  // 5. Current QR (the old owner's QR after a transfer / resale)
  if (qrVersion !== ticket.qrVersion) return { result: 'RED', reason: 'Old QR: this ticket was transferred', ticket };
  // Placeholder tickets of an unfinished checkout are never valid
  if (ticket.order?.status !== 'SUCCESSFUL') return { result: 'RED', reason: 'Ticket was never paid for', ticket };
  if (ticket.event?.status === 'CANCELLED') return { result: 'RED', reason: 'Event was cancelled', ticket };
  // 6. Refunded / cancelled / moved
  if (ticket.status === 'CANCELLED') return { result: 'RED', reason: 'Ticket refunded / cancelled', ticket };
  if (ticket.status === 'TRANSFERRED' || ticket.status === 'RESOLD') return { result: 'RED', reason: 'Old QR: this ticket was transferred', ticket };
  // 7. Already used
  if (ticket.status === 'SCANNED') {
    return {
      result: 'YELLOW',
      reason: ticket.checkedInAt ? `Already scanned at ${timeOf(ticket.checkedInAt)}${ticket.gate ? `, ${ticket.gate}` : ''}` : 'Already scanned',
      ticket,
      firstScan: ticket.checkedInAt && { at: ticket.checkedInAt, gate: ticket.gate, by: ticket.checkedInBy?.name },
    };
  }
  // 8. Good
  return { result: 'GREEN', reason: 'Entry allowed', ticket, qrVersion };
}

const LEGACY_RESULT = { GREEN: 'VALID_FIRST_SCAN', YELLOW: 'ALREADY_SCANNED', RED: 'INVALID_SCAN' };

async function logScan({ verdict, eventId, staffId, deviceId, gate, offline, scannedAt, conflict = false }) {
  const ticketId = verdict.ticket?.id || null;
  await prisma.checkIn.create({
    data: {
      ticketId,
      eventId,
      staffId,
      deviceId: deviceId || null,
      gate: gate || null,
      result: verdict.result,
      reason: verdict.reason,
      offline,
      conflict,
      scannedAt,
      syncedAt: offline ? new Date() : null,
    },
  });
  // The older GateScan log still feeds the dashboards' turnout figures
  if (ticketId) {
    await prisma.gateScan.create({
      data: { ticketId, staffId, result: LEGACY_RESULT[verdict.result], gateNumber: gate || null, scanTime: scannedAt, notes: verdict.reason },
    });
  }
}

/** Entered vs. sold for an event, per gate. */
export async function eventStats(eventId) {
  const paid = { eventId, order: { status: 'SUCCESSFUL' }, status: { in: ['ACTIVE', 'SCANNED'] } };
  const [sold, entered, perGate, results] = await Promise.all([
    prisma.ticket.count({ where: paid }),
    prisma.ticket.count({ where: { ...paid, status: 'SCANNED' } }),
    prisma.ticket.groupBy({ by: ['gate'], where: { ...paid, status: 'SCANNED' }, _count: { _all: true } }),
    prisma.checkIn.groupBy({ by: ['result'], where: { eventId }, _count: { _all: true } }),
  ]);
  const scans = Object.fromEntries(['GREEN', 'YELLOW', 'RED'].map((r) => [r, results.find((x) => x.result === r)?._count._all || 0]));
  return {
    eventId,
    sold,
    entered,
    remaining: Math.max(0, sold - entered),
    gates: perGate.map((g) => ({ gate: g.gate || 'Unassigned gate', entered: g._count._all })).sort((a, b) => b.entered - a.entered),
    scans,
    conflicts: await prisma.checkIn.count({ where: { eventId, conflict: true } }),
  };
}

async function broadcast(eventId, ticket) {
  const io = getIO();
  if (!io) return;
  // The holder's wallet greys the QR out ("Used at 7:42 PM, Gate B")
  if (ticket) io.to(`user_${ticket.userId}`).emit('ticket:checked-in', { ticketId: ticket.id, checkedInAt: ticket.checkedInAt, gate: ticket.gate });
  // Live entry counters (organizer dashboard, other scanners of the event)
  const stats = await eventStats(eventId);
  io.to(`event_${eventId}`).emit('checkin:stats', stats);
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { company: { select: { userId: true } } } });
  if (event?.company?.userId) io.to(`user_${event.company.userId}`).emit('checkin:stats', stats);
}

const response = (verdict, extra = {}) => ({
  result: verdict.result,
  reason: verdict.reason,
  ticket: ticketView(verdict.ticket),
  firstScan: verdict.firstScan || null,
  ...extra,
});

/** One online scan: checks, admits atomically, logs, broadcasts. */
export async function scan({ code, eventId, staffId, gate, deviceId, scannedAt = new Date() }) {
  let verdict = await evaluate(code, eventId);

  if (verdict.result === 'GREEN') {
    // Atomic admission: only one scan can move the ticket from valid to used
    const now = new Date();
    const { count } = await prisma.ticket.updateMany({
      where: { id: verdict.ticket.id, status: 'ACTIVE', qrVersion: verdict.qrVersion },
      data: { status: 'SCANNED', checkedInAt: now, checkedInById: staffId, gate: gate || null },
    });
    if (!count) {
      verdict = await evaluate(code, eventId); // someone else got there first: yellow (or red)
      if (verdict.result === 'GREEN') verdict = { result: 'RED', reason: 'Ticket changed while scanning; scan again', ticket: verdict.ticket };
    } else {
      verdict.ticket = { ...verdict.ticket, status: 'SCANNED', checkedInAt: now, gate: gate || null };
    }
  }

  await logScan({ verdict, eventId, staffId, deviceId, gate, offline: false, scannedAt });
  if (verdict.result === 'GREEN') await broadcast(eventId, verdict.ticket);
  return response(verdict);
}

/**
 * Queued offline scans. The earliest admission wins: if two devices let the same ticket in while offline,
 * the later one is flagged as a conflict for the organizer.
 */
export async function syncOffline({ scans, eventId, staffId, deviceId }) {
  const ordered = [...scans].sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt));
  const results = [];
  const admitted = [];
  for (const s of ordered) {
    const scannedAt = Number.isNaN(new Date(s.scannedAt).getTime()) ? new Date() : new Date(s.scannedAt);
    const gate = s.gate || null;
    let verdict = await evaluate(s.code, eventId);
    let conflict = false;

    // Only an admission at the gate can mark a ticket used: a scan the device turned away is logged as such
    if (verdict.result === 'GREEN' && s.localResult && s.localResult !== 'GREEN') {
      verdict = { ...verdict, result: s.localResult, reason: `Turned away while offline: ${s.localReason || 'not valid on this device'}` };
    }

    if (verdict.result === 'GREEN') {
      const { count } = await prisma.ticket.updateMany({
        where: { id: verdict.ticket.id, status: 'ACTIVE', qrVersion: verdict.qrVersion },
        data: { status: 'SCANNED', checkedInAt: scannedAt, checkedInById: staffId, gate },
      });
      if (count) {
        verdict.ticket = { ...verdict.ticket, status: 'SCANNED', checkedInAt: scannedAt, gate };
        admitted.push(verdict.ticket);
      } else {
        verdict = await evaluate(s.code, eventId);
      }
    }

    if (verdict.result === 'YELLOW' && s.localResult === 'GREEN') {
      // This device admitted the ticket offline, but it was already used: a duplicate admission
      conflict = true;
      const t = verdict.ticket;
      if (t.checkedInAt && scannedAt < new Date(t.checkedInAt)) {
        // This offline admission happened first: it becomes the recorded check-in
        await prisma.ticket.update({ where: { id: t.id }, data: { checkedInAt: scannedAt, checkedInById: staffId, gate } });
      }
      verdict = { ...verdict, reason: `Duplicate admission while offline (${verdict.reason.toLowerCase()})` };
    }

    await logScan({ verdict, eventId, staffId, deviceId: s.deviceId || deviceId, gate, offline: true, scannedAt, conflict });
    results.push(response(verdict, { clientId: s.clientId || null, conflict }));
  }
  if (admitted.length) {
    for (const t of admitted.slice(0, -1)) {
      const io = getIO();
      io?.to(`user_${t.userId}`).emit('ticket:checked-in', { ticketId: t.id, checkedInAt: t.checkedInAt, gate: t.gate });
    }
    await broadcast(eventId, admitted[admitted.length - 1]);
  }
  return results;
}

/** Offline pack: public key and every paid ticket of the event with what the scanner needs. */
export async function eventPack(eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, date: true, time: true, venue: true, city: true } });
  const tickets = await prisma.ticket.findMany({
    where: { eventId, order: { status: 'SUCCESSFUL' } },
    select: {
      id: true,
      status: true,
      qrVersion: true,
      manualCode: true,
      checkedInAt: true,
      gate: true,
      seat: { select: { section: true, row: true, seatNumber: true, kind: true, tier: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  });
  await ensureManualCodes(tickets);
  const STATUS = { ACTIVE: 'VALID', SCANNED: 'USED', CANCELLED: 'CANCELLED', TRANSFERRED: 'CANCELLED', RESOLD: 'CANCELLED' };
  return {
    event,
    publicKey: getPublicKey(),
    generatedAt: new Date().toISOString(),
    tickets: tickets.map((t) => ({
      id: t.id,
      status: STATUS[t.status] || 'CANCELLED',
      qrVersion: t.qrVersion,
      manualCode: t.manualCode,
      type: t.seat?.tier?.name || 'Ticket',
      seat: seatLabel(t.seat),
      holder: firstName(t.user?.name),
      checkedInAt: t.checkedInAt,
      gate: t.gate,
    })),
  };
}
