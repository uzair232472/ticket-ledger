import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import { deviceAuthMode } from '../config/gateDeviceAuth.js';
import { GateError } from './checkinService.js';
import { cleanPublicJwk } from './scanSignature.js';

/*
 * Scanner device identity.
 *
 * A device is enrolled once per organization (POST /api/checkin/devices/enroll, signed in with gate.scan for one of
 * the organization's events) and receives a random token. The server keeps only its SHA-256 (GateDevice.tokenHash);
 * the token is sent as X-Device-Token on every scanner request together with the device id. Re-enrolling an
 * enrolled device needs its current token (rotation) or a supervisor's reset, so knowing another device's id is not
 * enough to take it over. Revoking a device or resetting its enrollment deletes the hash: its token stops working.
 *
 * GATE_DEVICE_AUTH (config/gateDeviceAuth.js) decides what happens to devices that have no token yet.
 */

export const DEVICE_TOKEN_HEADER = 'x-device-token';
const TOKEN_PREFIX = 'tld_';
const FAILURE_AUDIT_EVERY_MS = 5 * 60 * 1000;

export const hashDeviceToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** { present, value }: a header that is there but malformed counts as a (wrong) token, never as "no token". */
const readToken = (req) => {
  const raw = req.headers?.[DEVICE_TOKEN_HEADER];
  if (raw === undefined || raw === '') return { present: false, value: null };
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  return { present: true, value: value.startsWith(TOKEN_PREFIX) && value.length <= 120 ? value : null };
};

const cleanKey = (deviceKey) => {
  const key = String(deviceKey || '').trim().slice(0, 80);
  if (key.length < 4) throw new GateError(400, 'This scanner did not send its device id. Reload the scanner page.', 'DEVICE_REQUIRED');
  return key;
};

async function eventCompany(eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, companyId: true } });
  if (!event) throw new GateError(404, 'Event not found.');
  return event.companyId;
}

const statusData = (req, eventId, { gate, pendingScans, packAt, online, synced, diagnostics } = {}) => {
  const now = new Date();
  return {
    lastSeenAt: now,
    lastUserId: req.user.id,
    lastEventId: eventId,
    ...(gate ? { lastGate: gate } : {}),
    ...(pendingScans !== undefined ? { pendingScans } : {}),
    ...(packAt ? { packAt } : {}),
    online: online !== undefined ? online : true,
    ...(synced ? { lastSyncAt: now } : {}),
    userAgent: req.headers?.['user-agent']?.slice(0, 200) || null,
    // Health the scanner reports with its heartbeat (gateDiagnosticsService)
    ...(diagnostics || {}),
  };
};

const auditData = (req, companyId, action, device, details) => ({
  userId: req.user.id,
  companyId,
  actorRole: req.org?.role || req.user.role,
  action,
  targetType: 'GateDevice',
  targetId: device?.id || null,
  ipAddress: req.ip || null,
  userAgent: req.headers?.['user-agent']?.slice(0, 300) || null,
  details: details || {},
});

/** A rejected credential: counted on the device; written to the audit log at most every 5 minutes per device. */
async function recordFailure(req, companyId, device, code) {
  console.warn(`[gate-device] ${code} device=${device?.id || 'unknown'} user=${req.user?.id} ip=${req.ip} path=${req.originalUrl?.split('?')[0]}`);
  if (!device) return;
  const now = new Date();
  const log = !device.lastAuthFailureAt || now - device.lastAuthFailureAt > FAILURE_AUDIT_EVERY_MS;
  await prisma.gateDevice.update({ where: { id: device.id }, data: { authFailures: { increment: 1 }, lastAuthFailureAt: now } });
  if (log) await prisma.auditLog.create({ data: auditData(req, companyId, 'GATE_DEVICE_AUTH_FAILED', device, { code, path: req.originalUrl?.split('?')[0], failuresBefore: device.authFailures }) });
}

const defaultName = (req, key) => `${(req.user.name || 'Staff').split(/\s+/)[0]}'s device ${key.slice(-4).toUpperCase()}`;

/** Creates the device on first use (legacy / flag-off path), or updates its status. */
async function upsertUntokened(req, companyId, key, existing, data, { legacy }) {
  const counters = legacy ? { legacyRequests: { increment: 1 }, lastLegacyAt: new Date() } : {};
  if (existing) return prisma.gateDevice.update({ where: { id: existing.id }, data: { ...data, ...counters } });
  try {
    const d = await prisma.gateDevice.create({ data: { companyId, deviceKey: key, name: defaultName(req, key), registeredById: req.user.id, ...data, ...(legacy ? { legacyRequests: 1, lastLegacyAt: new Date() } : {}) } });
    await prisma.auditLog.create({ data: auditData(req, companyId, 'GATE_DEVICE_REGISTERED', d, { name: d.name, eventId: data.lastEventId, legacy }) });
    return d;
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    return prisma.gateDevice.update({ where: { companyId_deviceKey: { companyId, deviceKey: key } }, data: { ...data, ...counters } });
  }
}

/**
 * Every scanner request (scan, sync, pack, heartbeat) goes through here. Returns the device row and sets
 * req.gateDevice / req.gateDeviceAuth ('token' | 'legacy' | 'off'). Throws GateError:
 *   400 DEVICE_REQUIRED            no device id
 *   403 DEVICE_REVOKED             revoked by a supervisor (whatever the token)
 *   401 DEVICE_TOKEN_INVALID       a token was sent but it is not this device's current token
 *   401 DEVICE_TOKEN_REQUIRED      the device is enrolled but the request has no token
 *   401 DEVICE_ENROLLMENT_REQUIRED enforce mode and the device has never enrolled
 */
export async function authenticateDevice(req, eventId, deviceKey, status = {}) {
  const key = cleanKey(deviceKey);
  const companyId = await eventCompany(eventId);
  const existing = await prisma.gateDevice.findUnique({ where: { companyId_deviceKey: { companyId, deviceKey: key } } });
  if (existing?.status === 'REVOKED') throw new GateError(403, 'This scanner device was revoked by a supervisor. Ask them to restore it, or use another device.', 'DEVICE_REVOKED');

  const mode = deviceAuthMode();
  const data = statusData(req, eventId, status);
  let device;
  let auth;
  if (mode === 'off') {
    device = await upsertUntokened(req, companyId, key, existing, data, { legacy: false });
    auth = 'off';
  } else {
    const token = readToken(req);
    if (token.present) {
      if (!existing?.tokenHash || !token.value || !sameHash(hashDeviceToken(token.value), existing.tokenHash)) {
        await recordFailure(req, companyId, existing, 'DEVICE_TOKEN_INVALID');
        throw new GateError(401, 'This scanner’s device credential is not valid any more. It will enroll again automatically.', 'DEVICE_TOKEN_INVALID');
      }
      device = await prisma.gateDevice.update({ where: { id: existing.id }, data });
      auth = 'token';
    } else if (existing?.tokenHash) {
      await recordFailure(req, companyId, existing, 'DEVICE_TOKEN_REQUIRED');
      throw new GateError(401, 'This scanner is enrolled but did not send its device credential.', 'DEVICE_TOKEN_REQUIRED');
    } else if (mode === 'enforce') {
      throw new GateError(401, 'Enroll this scanner device before scanning.', 'DEVICE_ENROLLMENT_REQUIRED');
    } else {
      device = await upsertUntokened(req, companyId, key, existing, data, { legacy: true });
      auth = 'legacy';
    }
  }
  req.gateDevice = device;
  req.gateDeviceAuth = auth;
  return device;
}

/**
 * Enrolls a device for the event's organization and returns its token (shown once, never stored). An enrolled
 * device can only rotate its token by presenting the current one; otherwise a supervisor must reset it.
 */
export async function enrollDevice(req, eventId, deviceKey, { signingKey } = {}) {
  const key = cleanKey(deviceKey);
  const companyId = await eventCompany(eventId);
  const existing = await prisma.gateDevice.findUnique({ where: { companyId_deviceKey: { companyId, deviceKey: key } } });
  if (existing?.status === 'REVOKED') throw new GateError(403, 'This scanner device was revoked by a supervisor. Ask them to restore it, or use another device.', 'DEVICE_REVOKED');

  const current = readToken(req);
  const rotating = Boolean(existing?.tokenHash);
  if (rotating && !(current.value && sameHash(hashDeviceToken(current.value), existing.tokenHash))) {
    await recordFailure(req, companyId, existing, 'DEVICE_ALREADY_ENROLLED');
    // companyId lets the scanner find the token it already holds for this organization
    throw new GateError(409, 'This device is already enrolled. Ask a supervisor to reset its enrollment (Gate management → Devices).', 'DEVICE_ALREADY_ENROLLED', { companyId });
  }

  const token = newToken();
  const now = new Date();
  const jwk = signingKey ? cleanPublicJwk(signingKey) : null;
  if (signingKey && !jwk) throw new GateError(400, 'The device signing key is not a valid public P-256 key.', 'BAD_SIGNING_KEY');
  // A new key replaces the old one; enrolling without one keeps the registered key (older scanner builds)
  const cred = { tokenHash: hashDeviceToken(token), tokenIssuedAt: now, enrolledById: req.user.id, ...(jwk ? { signingKey: jwk, signingKeyAt: now } : {}) };
  const data = { ...statusData(req, eventId), ...cred };
  let device;
  if (existing) {
    // Conditional on the hash we checked, so two enrollments racing for the same device can't both win
    const { count } = await prisma.gateDevice.updateMany({ where: { id: existing.id, status: 'ACTIVE', tokenHash: existing.tokenHash }, data });
    if (!count) throw new GateError(409, 'This device was enrolled at the same moment from somewhere else. Try again.', 'DEVICE_ENROLL_CONFLICT');
    device = await prisma.gateDevice.findUnique({ where: { id: existing.id } });
  } else {
    try {
      device = await prisma.gateDevice.create({ data: { companyId, deviceKey: key, name: defaultName(req, key), registeredById: req.user.id, ...data } });
    } catch (e) {
      if (e.code === 'P2002') throw new GateError(409, 'This device was enrolled at the same moment from somewhere else. Try again.', 'DEVICE_ENROLL_CONFLICT');
      throw e;
    }
  }
  const action = rotating ? 'GATE_DEVICE_TOKEN_ROTATED' : 'GATE_DEVICE_ENROLLED';
  await prisma.auditLog.create({ data: auditData(req, companyId, action, device, { name: device.name, eventId, previouslyLegacy: Boolean(existing && !rotating), legacyRequests: existing?.legacyRequests || 0, signingKeyRegistered: Boolean(jwk) }) });
  return { token, companyId, device: { id: device.id, name: device.name, status: device.status, tokenIssuedAt: device.tokenIssuedAt, signing: Boolean(device.signingKey) } };
}
