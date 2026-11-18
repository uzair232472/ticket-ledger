import prisma from '../config/prisma.js';
import { getScopedEventIds } from './accessService.js';
import { GateError } from './checkinService.js';

/*
 * Quarantine: scans the server received but did not process. They are kept exactly as submitted for supervisor
 * review and NEVER create or change an admission.
 *   INVALID         a scan in a sync upload that couldn't be read (the rest of the upload is processed)
 *   DEVICE_REVOKED  scans held by a device a supervisor revoked, handed in with POST /api/checkin/evidence
 *   ACCESS_REMOVED  scans held by staff who no longer scan for the event, handed in the same way
 * Idempotent per (organization, device, scan id): handing the same scans in again stores nothing new.
 */

const MAX_PAYLOAD_CHARS = 4000;

/** The submitted scan as stored (bounded, JSON-safe). */
function payloadOf(raw) {
  let json;
  try {
    json = JSON.stringify(raw ?? null);
  } catch {
    json = JSON.stringify(String(raw));
  }
  return json.length > MAX_PAYLOAD_CHARS ? { truncated: true, start: json.slice(0, MAX_PAYLOAD_CHARS) } : JSON.parse(json);
}
const scanIdOf = (raw) => (raw && typeof raw.clientId === 'string' && raw.clientId.length <= 80 ? raw.clientId : null);
const seqOf = (raw) => (raw && Number.isInteger(raw.seq) ? raw.seq : null);

/** Stores scans in quarantine; returns how many were new. */
export async function quarantine({ companyId, eventId, deviceKey, deviceId = null, submittedById, reason, scans }) {
  if (!scans.length) return 0;
  const { count } = await prisma.quarantinedScan.createMany({
    data: scans.map(({ raw, detail }) => ({ companyId, eventId, deviceKey: String(deviceKey).slice(0, 80), deviceId, clientScanId: scanIdOf(raw), deviceSeq: seqOf(raw), submittedById, reason, detail: detail ? String(detail).slice(0, 300) : null, payload: payloadOf(raw) })),
    skipDuplicates: true,
  });
  return count;
}

/**
 * POST /api/checkin/evidence: a scanner that may no longer upload admissions hands in the scans it still holds.
 * Allowed for the account that last used the device (or registered it) at this organization, or that still scans
 * the event; refused when the device and account are both fine (those scans belong in a normal sync).
 */
export async function submitEvidence(req, { eventId, deviceId: deviceKey, scans }) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, companyId: true } });
  if (!event) throw new GateError(404, 'Event not found.');
  const device = await prisma.gateDevice.findUnique({ where: { companyId_deviceKey: { companyId: event.companyId, deviceKey } } });
  const scope = await getScopedEventIds(req.user, 'gate.scan');
  const canScan = scope === null || scope.includes(eventId);
  const usedDevice = Boolean(device && (device.lastUserId === req.user.id || device.registeredById === req.user.id));
  if (!usedDevice && !canScan) throw new GateError(403, 'This device and account have no connection to this event.', 'EVIDENCE_NOT_ALLOWED');

  let reason;
  if (device?.status === 'REVOKED') reason = 'DEVICE_REVOKED';
  else if (!canScan) reason = 'ACCESS_REMOVED';
  else throw new GateError(409, 'This device can still upload: send these scans with a normal sync.', 'USE_SYNC');

  const stored = await quarantine({ companyId: event.companyId, eventId, deviceKey, deviceId: device?.id || null, submittedById: req.user.id, reason, scans: scans.map((raw) => ({ raw, detail: reason === 'DEVICE_REVOKED' ? 'Held by a revoked device' : 'Held by staff without access to the event' })) });
  await prisma.auditLog.create({
    data: { userId: req.user.id, companyId: event.companyId, actorRole: req.user.role, action: 'GATE_SCANS_QUARANTINED', targetType: 'GateDevice', targetId: device?.id || null, ipAddress: req.ip || null, userAgent: req.headers?.['user-agent']?.slice(0, 300) || null, details: { eventId, reason, submitted: scans.length, stored, deviceKey: String(deviceKey).slice(-6) } },
  });
  return { reason, stored, device, results: scans.map((raw) => ({ clientId: scanIdOf(raw), seq: seqOf(raw), status: 'QUARANTINED' })) };
}
