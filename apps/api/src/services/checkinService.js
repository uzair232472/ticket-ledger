import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { verifyPass, normaliseManualCode, looksLikeManualCode, ensureManualCodes, getPublicKey } from './qrPassService.js';

/**
 * Gate check-in.
 *
 * Ticket statuses map onto the scanning states as: ACTIVE = valid (never entered), SCANNED = used (entered at
 * least once), CANCELLED = refunded / cancelled (TRANSFERRED / RESOLD are retired records of a pass that moved).
 * Presence: `isInside` after an entry, false after an exit scan; `entryCount` counts entries incl. re-entries,
 * which the event's re-entry policy (NONE / UNLIMITED / LIMITED) allows or refuses.
 *
 * Gates (EventGate) are optional per event: when an event has gates, every scan names one; a gate admits only
 * its direction(s) (ENTRY / EXIT / ENTRY_EXIT) and, if set, only some ticket types. Staff assigned to some gates
 * may only scan there. Without gates, the scanner's free-text gate name is kept as before.
 *
 * Every scan, admitted or not, is logged in CheckIn (fraud evidence and audit trail). Admission is a single
 * conditional UPDATE, so two gates scanning the same ticket at the same moment can't both let it in.
 */

export class GateError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ticketInclude = {
  event: { select: { id: true, name: true, status: true, reentryPolicy: true, maxReentries: true } },
  order: { select: { status: true } },
  seat: { select: { section: true, row: true, seatNumber: true, kind: true, tierId: true, tier: { select: { name: true } } } },
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
  isInside: Boolean(t.isInside),
  entryCount: t.entryCount || 0,
  event: t.event?.name,
};

/** Re-entries still allowed for a ticket that is outside: Infinity, a number, or 0. */
export function reentriesLeft(event, entryCount) {
  if (!event || event.reentryPolicy === 'NONE' || !event.reentryPolicy) return 0;
  if (event.reentryPolicy === 'UNLIMITED') return Infinity;
  return Math.max(0, (event.maxReentries ?? 0) - Math.max(0, (entryCount || 1) - 1));
}

/**
 * Runs the checks in order and returns the verdict without changing anything:
 * { result: 'GREEN'|'YELLOW'|'RED', reason, ticket?, firstScan?, reentry? }.
 * opts: { direction = 'ENTRY', gate: EventGate row (or null), gateNames: names of gates admitting this ticket }
 */
export async function evaluate(raw, eventId, { direction = 'ENTRY', gate = null, gates = [] } = {}) {
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

  const first = ticket.checkedInAt && { at: ticket.checkedInAt, gate: ticket.gate, by: ticket.checkedInBy?.name };

  // Leaving the venue
  if (direction === 'EXIT') {
    if (ticket.status !== 'SCANNED') return { result: 'RED', reason: "This ticket hasn't entered yet", ticket };
    if (!ticket.isInside) return { result: 'YELLOW', reason: ticket.lastExitAt ? `Already left at ${timeOf(ticket.lastExitAt)}` : 'Already outside', ticket, firstScan: first };
    const left = reentriesLeft(ticket.event, ticket.entryCount);
    return { result: 'GREEN', reason: left ? 'Exit recorded. Re-entry allowed' : 'Exit recorded. No re-entry with this ticket', ticket, qrVersion };
  }

  // 7. Ticket type allowed at this gate (e.g. a VIP entrance)
  if (gate?.allowedTierIds?.length && !gate.allowedTierIds.includes(ticket.seat?.tierId)) {
    const names = gates.filter((g) => g.active && g.type !== 'EXIT' && (!g.allowedTierIds.length || g.allowedTierIds.includes(ticket.seat?.tierId))).map((g) => g.name);
    return { result: 'RED', code: 'WRONG_GATE', reason: `Wrong gate: ${ticket.seat?.tier?.name || 'this'} tickets enter at ${names.join(', ') || 'another gate'}`, ticket };
  }

  // 8. Already used
  if (ticket.status === 'SCANNED') {
    if (ticket.isInside || !ticket.lastExitAt) {
      return {
        result: 'YELLOW',
        reason: ticket.checkedInAt ? `Already scanned at ${timeOf(ticket.checkedInAt)}${ticket.gate ? `, ${ticket.gate}` : ''}` : 'Already scanned',
        ticket,
        firstScan: first,
      };
    }
    // Outside after an exit: re-entry per the event's policy
    if (reentriesLeft(ticket.event, ticket.entryCount) > 0) return { result: 'GREEN', reason: 'Re-entry allowed', ticket, qrVersion, reentry: true };
    return {
      result: 'YELLOW',
      reason: ticket.event?.reentryPolicy === 'LIMITED' ? `Re-entry limit reached (left at ${timeOf(ticket.lastExitAt)})` : `Left at ${timeOf(ticket.lastExitAt)}: no re-entry for this event`,
      ticket,
      firstScan: first,
    };
  }
  // 9. Good
  return { result: 'GREEN', reason: 'Entry allowed', ticket, qrVersion };
}

const LEGACY_RESULT = { GREEN: 'VALID_FIRST_SCAN', YELLOW: 'ALREADY_SCANNED', RED: 'INVALID_SCAN' };

async function logScan({ verdict, eventId, staffId, deviceId, gate, gateId, direction = 'ENTRY', offline, scannedAt, conflict = false, exceptionId = null }) {
  const ticketId = verdict.ticket?.id || null;
  const row = await prisma.checkIn.create({
    data: {
      ticketId,
      eventId,
      staffId,
      deviceId: deviceId || null,
      gate: gate || null,
      gateId: gateId || null,
      direction,
      reentry: Boolean(verdict.reentry),
      result: verdict.result,
      reason: verdict.reason,
      offline,
      conflict,
      exceptionId,
      scannedAt,
      syncedAt: offline ? new Date() : null,
    },
  });
  // The older GateScan log still feeds the dashboards' turnout figures (entries only)
  if (ticketId && direction === 'ENTRY') {
    await prisma.gateScan.create({
      data: { ticketId, staffId, result: LEGACY_RESULT[verdict.result], gateNumber: gate || null, scanTime: scannedAt, notes: verdict.reason },
    });
  }
  return row;
}

/**
 * Applies a GREEN verdict to the ticket with one conditional UPDATE (first entry, re-entry or exit). Returns the
 * verdict as it now stands: if another scan changed the ticket first, it is evaluated again.
 */
async function admit(verdict, { code, eventId, staffId, gate, gateId, direction, at, opts }) {
  const t = verdict.ticket;
  let where;
  let data;
  if (direction === 'EXIT') {
    where = { id: t.id, status: 'SCANNED', isInside: true };
    data = { isInside: false, lastExitAt: at };
  } else if (verdict.reentry) {
    where = { id: t.id, status: 'SCANNED', isInside: false, entryCount: t.entryCount };
    data = { isInside: true, entryCount: { increment: 1 } };
  } else {
    where = { id: t.id, status: 'ACTIVE', qrVersion: verdict.qrVersion };
    data = { status: 'SCANNED', checkedInAt: at, checkedInById: staffId, gate: gate || null, isInside: true, entryCount: 1 };
  }
  const { count } = await prisma.ticket.updateMany({ where, data });
  if (count) {
    const after = direction === 'EXIT' ? { isInside: false, lastExitAt: at } : verdict.reentry ? { isInside: true, entryCount: t.entryCount + 1 } : { status: 'SCANNED', checkedInAt: at, gate: gate || null, isInside: true, entryCount: 1 };
    return { ...verdict, ticket: { ...t, ...after }, admitted: true };
  }
  const again = await evaluate(code, eventId, opts);
  if (again.result === 'GREEN') return { result: 'RED', reason: 'Ticket changed while scanning; scan again', ticket: again.ticket };
  return again;
}

/** Entered vs. sold for an event, per gate, with presence, throughput and gate load. */
export async function eventStats(eventId) {
  const paid = { eventId, order: { status: 'SUCCESSFUL' }, status: { in: ['ACTIVE', 'SCANNED'] } };
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [sold, entered, inside, perGate, results, gates, recentByGate, exitsByGate] = await Promise.all([
    prisma.ticket.count({ where: paid }),
    prisma.ticket.count({ where: { ...paid, status: 'SCANNED' } }),
    prisma.ticket.count({ where: { ...paid, status: 'SCANNED', isInside: true } }),
    prisma.ticket.groupBy({ by: ['gate'], where: { ...paid, status: 'SCANNED' }, _count: { _all: true } }),
    prisma.checkIn.groupBy({ by: ['result'], where: { eventId }, _count: { _all: true } }),
    prisma.eventGate.findMany({ where: { eventId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.checkIn.groupBy({ by: ['gate'], where: { eventId, result: 'GREEN', direction: 'ENTRY', reversedAt: null, scannedAt: { gte: since } }, _count: { _all: true } }),
    prisma.checkIn.groupBy({ by: ['gate'], where: { eventId, result: 'GREEN', direction: 'EXIT', reversedAt: null }, _count: { _all: true } }),
  ]);
  const scans = Object.fromEntries(['GREEN', 'YELLOW', 'RED'].map((r) => [r, results.find((x) => x.result === r)?._count._all || 0]));
  const byName = (rows, name) => rows.find((r) => (r.gate || null) === name)?._count._all || 0;
  const gateRows = gates.length
    ? gates.map((g) => {
        const last15 = byName(recentByGate, g.name);
        const ratePerHour = last15 * 4;
        return {
          id: g.id,
          gate: g.name,
          type: g.type,
          active: g.active,
          entered: byName(perGate, g.name),
          exits: byName(exitsByGate, g.name),
          last15,
          ratePerHour,
          capacityPerHour: g.capacityPerHour,
          loadPct: g.capacityPerHour ? Math.round((ratePerHour / g.capacityPerHour) * 100) : null,
          overloaded: Boolean(g.capacityPerHour && ratePerHour >= g.capacityPerHour * 0.9),
        };
      })
    : perGate.map((g) => ({ gate: g.gate || 'Unassigned gate', entered: g._count._all })).sort((a, b) => b.entered - a.entered);
  return {
    eventId,
    sold,
    entered,
    inside,
    remaining: Math.max(0, sold - entered),
    gates: gateRows,
    scans,
    conflicts: await prisma.checkIn.count({ where: { eventId, conflict: true } }),
    pendingExceptions: await prisma.gateException.count({ where: { eventId, status: 'PENDING' } }),
  };
}

export async function broadcast(eventId, ticket) {
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
  code: verdict.code || null,
  reentry: Boolean(verdict.reentry),
  ticket: ticketView(verdict.ticket),
  firstScan: verdict.firstScan || null,
  ...extra,
});

/**
 * The gate a scan is made at. With gates configured for the event, `gateId` (or an exact gate name) is required,
 * the gate must be active and take this direction, and staff limited to some gates must use one of theirs
 * (supervisors may use any). Without gates: the free-text name, entries and exits allowed.
 */
export async function resolveGate({ eventId, gateId, gate, direction = 'ENTRY', staffId, supervisor = false }) {
  const gates = await prisma.eventGate.findMany({ where: { eventId } });
  if (!gates.length) return { gate: gate || null, gateId: null, row: null, gates };
  const row = gates.find((g) => g.id === gateId) || gates.find((g) => g.name === gate);
  if (!row) throw new GateError(400, 'Choose one of this event’s gates.', 'GATE_REQUIRED');
  if (!row.active) throw new GateError(409, `${row.name} is closed.`, 'GATE_CLOSED');
  if (direction === 'ENTRY' && row.type === 'EXIT') throw new GateError(409, `${row.name} is an exit only.`, 'GATE_DIRECTION');
  if (direction === 'EXIT' && row.type === 'ENTRY') throw new GateError(409, `${row.name} is an entrance only.`, 'GATE_DIRECTION');
  if (!supervisor && staffId) {
    const mine = await prisma.gateAssignment.findMany({ where: { staffId, eventId }, select: { gateId: true } });
    if (mine.length && !mine.some((m) => m.gateId === row.id)) {
      const names = gates.filter((g) => mine.some((m) => m.gateId === g.id)).map((g) => g.name);
      throw new GateError(403, `You are assigned to ${names.join(', ')}.`, 'GATE_NOT_ASSIGNED');
    }
  }
  return { gate: row.name, gateId: row.id, row, gates };
}

/** One online scan: checks, admits atomically, logs, broadcasts. */
export async function scan({ code, eventId, staffId, gate, gateId, direction = 'ENTRY', deviceId, supervisor = false, scannedAt = new Date() }) {
  const g = await resolveGate({ eventId, gateId, gate, direction, staffId, supervisor });
  const opts = { direction, gate: g.row, gates: g.gates };
  let verdict = await evaluate(code, eventId, opts);
  if (verdict.result === 'GREEN') verdict = await admit(verdict, { code, eventId, staffId, gate: g.gate, gateId: g.gateId, direction, at: new Date(), opts });

  const row = await logScan({ verdict, eventId, staffId, deviceId, gate: g.gate, gateId: g.gateId, direction, offline: false, scannedAt });
  if (verdict.result === 'GREEN') await broadcast(eventId, verdict.ticket);
  return response(verdict, { checkInId: row.id, direction, gate: g.gate, gateId: g.gateId });
}

/**
 * Queued offline scans. The earliest admission wins: if two devices let the same ticket in while offline,
 * the later one is flagged as a conflict for the organizer. Exits and re-entries are replayed in time order.
 */
export async function syncOffline({ scans, eventId, staffId, deviceId, supervisor = false }) {
  const ordered = [...scans].sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt));
  const results = [];
  const admitted = [];
  const allGates = await prisma.eventGate.findMany({ where: { eventId } });
  for (const s of ordered) {
    const scannedAt = Number.isNaN(new Date(s.scannedAt).getTime()) ? new Date() : new Date(s.scannedAt);
    const direction = s.direction === 'EXIT' ? 'EXIT' : 'ENTRY';
    // The gate as configured now; a gate removed since the scan is kept by name only
    const row = allGates.find((g) => g.id === s.gateId) || allGates.find((g) => g.name === s.gate) || null;
    const gate = row?.name || s.gate || null;
    const opts = { direction, gate: row, gates: allGates };
    let verdict = await evaluate(s.code, eventId, opts);
    let conflict = false;

    // Only an admission at the gate can change a ticket: a scan the device turned away is logged as such
    if (verdict.result === 'GREEN' && s.localResult && s.localResult !== 'GREEN') {
      verdict = { ...verdict, result: s.localResult, reason: `Turned away while offline: ${s.localReason || 'not valid on this device'}` };
    }

    if (verdict.result === 'GREEN') {
      verdict = await admit(verdict, { code: s.code, eventId, staffId, gate, gateId: row?.id, direction, at: scannedAt, opts });
      if (verdict.admitted) admitted.push(verdict.ticket);
    }

    if (direction === 'ENTRY' && verdict.result === 'YELLOW' && s.localResult === 'GREEN') {
      // This device admitted the ticket offline, but it was already used: a duplicate admission
      conflict = true;
      const t = verdict.ticket;
      if (t.checkedInAt && scannedAt < new Date(t.checkedInAt)) {
        // This offline admission happened first: it becomes the recorded check-in
        await prisma.ticket.update({ where: { id: t.id }, data: { checkedInAt: scannedAt, checkedInById: staffId, gate } });
      }
      verdict = { ...verdict, reason: `Duplicate admission while offline (${verdict.reason.toLowerCase()})` };
    }

    await logScan({ verdict, eventId, staffId, deviceId: s.deviceId || deviceId, gate, gateId: row?.id, direction, offline: true, scannedAt, conflict });
    results.push(response(verdict, { clientId: s.clientId || null, conflict, direction }));
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

/** Offline pack: public key, gates, re-entry policy and every paid ticket of the event with what the scanner needs. */
export async function eventPack(eventId, { staffId = null } = {}) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, date: true, time: true, venue: true, city: true, reentryPolicy: true, maxReentries: true } });
  const tickets = await prisma.ticket.findMany({
    where: { eventId, order: { status: 'SUCCESSFUL' } },
    select: {
      id: true,
      status: true,
      qrVersion: true,
      manualCode: true,
      checkedInAt: true,
      gate: true,
      isInside: true,
      entryCount: true,
      lastExitAt: true,
      seat: { select: { section: true, row: true, seatNumber: true, kind: true, tierId: true, tier: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  });
  await ensureManualCodes(tickets);
  const [gates, mine] = await Promise.all([
    prisma.eventGate.findMany({ where: { eventId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    staffId ? prisma.gateAssignment.findMany({ where: { eventId, staffId }, select: { gateId: true } }) : [],
  ]);
  const STATUS = { ACTIVE: 'VALID', SCANNED: 'USED', CANCELLED: 'CANCELLED', TRANSFERRED: 'CANCELLED', RESOLD: 'CANCELLED' };
  return {
    event,
    publicKey: getPublicKey(),
    generatedAt: new Date().toISOString(),
    gates: gates.map((g) => ({ id: g.id, name: g.name, type: g.type, allowedTierIds: g.allowedTierIds, active: g.active })),
    // Gates this staff member is limited to (empty: every gate)
    myGateIds: mine.map((m) => m.gateId),
    tickets: tickets.map((t) => ({
      id: t.id,
      status: STATUS[t.status] || 'CANCELLED',
      qrVersion: t.qrVersion,
      manualCode: t.manualCode,
      type: t.seat?.tier?.name || 'Ticket',
      tierId: t.seat?.tierId || null,
      seat: seatLabel(t.seat),
      holder: firstName(t.user?.name),
      checkedInAt: t.checkedInAt,
      gate: t.gate,
      isInside: t.isInside,
      entryCount: t.entryCount,
      lastExitAt: t.lastExitAt,
    })),
  };
}
