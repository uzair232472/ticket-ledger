/**
 * Offline scan records: pure rules shared by the scan store (gateScanStore.js) and its tests. No browser APIs here
 * except crypto (UUIDs, checksums), so `node --test` can exercise every rule.
 *
 * A scan record is created on the device the moment a scan is decided, before the verdict is shown, and is never
 * deleted because an upload failed. Its life:
 *
 *   PENDING ──upload──▶ UPLOADING ──server acknowledged──▶ SYNCED      (processed normally)
 *      ▲                    │                         └──▶ CONFLICT    (processed, flagged for supervisors)
 *      │                    ├──no connection / server error / credential / RETRY──▶ PENDING (retried, with backoff)
 *      │                    └──scan REJECTED, or request refused as invalid (4xx)──▶ FAILED (kept; "Retry failed")
 *      └──────────── page closed mid-upload: UPLOADING found later is put back to PENDING
 *
 *   revoked device / access removed: unprocessed scans are handed in as evidence ──▶ QUARANTINED (never admitted)
 */

export const SCAN_SCHEMA = 2;
export const STATES = ['PENDING', 'UPLOADING', 'SYNCED', 'FAILED', 'CONFLICT', 'QUARANTINED'];
/** States the server has not processed yet (they must reach the server, and they count as "waiting"). */
export const UNSYNCED = ['PENDING', 'UPLOADING', 'FAILED'];
/** SYNCED records are kept this long on the device, then removed; nothing else is ever pruned. */
export const SYNCED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const BATCH_SIZE = 200;

/** RFC 4122 v4 id from a cryptographic source (never Math.random). */
export function newScanId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const str = (v, max) => (v == null || v === '' ? null : String(v).slice(0, max));
const direction = (d) => (d === 'EXIT' ? 'EXIT' : 'ENTRY');
const result = (r) => (['GREEN', 'YELLOW', 'RED'].includes(r) ? r : 'RED');

/**
 * A new record for a scan decided on this device. `at` is the device clock: kept as evidence, never trusted on
 * its own (the server orders scans by device and sequence, and keeps its own receipt time).
 */
export function newScanRecord({ scanId, seq, deviceId, eventId, ticketId, code, gate, gateId, direction: dir, localResult, localReason, recordedBy, appVersion, at = new Date() }) {
  const iso = new Date(at).toISOString();
  return {
    schema: SCAN_SCHEMA,
    scanId: scanId || newScanId(),
    seq,
    deviceId,
    eventId,
    ticketId: ticketId || null,
    code: String(code || '').trim(),
    gate: str(gate, 60),
    gateId: str(gateId, 60),
    direction: direction(dir),
    deviceScannedAt: iso,
    localResult: result(localResult),
    localReason: str(localReason, 300),
    recordedBy: recordedBy || null,
    appVersion: appVersion || null,
    createdAt: iso,
    syncState: 'PENDING',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    syncedAt: null,
    server: null, // the server's acknowledgement: { result, reason, conflict }
  };
}

/** A queue item written by the previous scanner version (IndexedDB tl-gate / queue), as a v2 record. */
export function fromLegacyItem(item, { seq, deviceId, appVersion }) {
  const at = Number.isNaN(new Date(item.scannedAt).getTime()) ? new Date() : new Date(item.scannedAt);
  return {
    ...newScanRecord({ scanId: item.clientId, seq, deviceId, eventId: item.eventId, ticketId: null, code: item.code, gate: item.gate, gateId: item.gateId, direction: item.direction, localResult: item.localResult, localReason: item.localReason, appVersion, at }),
    // Exactly what the old queue held, so the device time stays the original even if it was malformed
    deviceScannedAt: String(item.scannedAt || at.toISOString()),
    createdAt: new Date().toISOString(),
    migratedFrom: 'queue-v1',
  };
}

/** The mirror written to the old queue store so a rolled-back scanner still uploads scans not yet processed. */
export const toLegacyItem = (r) => ({ clientId: r.scanId, eventId: r.eventId, code: r.code, gate: r.gate || undefined, gateId: r.gateId || undefined, direction: r.direction, scannedAt: r.deviceScannedAt, localResult: r.localResult, localReason: r.localReason || undefined });

/** Legacy items not yet in the scan store (the store's own mirrors are skipped), oldest first. */
export function planMigration(legacyItems, existingScanIds) {
  const have = new Set(existingScanIds);
  const seen = new Set();
  return (legacyItems || [])
    .filter((q) => q && q.clientId && !have.has(q.clientId) && !seen.has(q.clientId) && seen.add(q.clientId))
    .sort((a, b) => String(a.scannedAt).localeCompare(String(b.scannedAt)));
}

const FIELDS = [['clientId', 'scanId'], ['eventId', 'eventId'], ['code', 'code'], ['direction', 'direction'], ['scannedAt', 'deviceScannedAt'], ['localResult', 'localResult']];
const norm = (k, v) => (k === 'direction' ? direction(v) : k === 'localResult' ? result(v) : k === 'code' ? String(v || '').trim() : v);

/** Every backed-up legacy item must have an identical v2 record. Returns { ok, missing: [ids], mismatched: [ids] }. */
export function verifyMigration(legacyItems, records) {
  const byId = new Map((records || []).filter(Boolean).map((r) => [r.scanId, r]));
  const missing = [];
  const mismatched = [];
  for (const q of legacyItems || []) {
    const r = byId.get(q.clientId);
    if (!r) missing.push(q.clientId);
    else if (FIELDS.some(([a, b]) => norm(a, q[a]) !== r[b]) || String(q.gate || '') !== String(r.gate || '') || String(q.gateId || '') !== String(r.gateId || '')) mismatched.push(q.clientId);
  }
  return { ok: !missing.length && !mismatched.length, missing, mismatched };
}

/** Order-independent SHA-256 over the items' JSON (backup integrity check). */
export async function checksum(items) {
  const canon = JSON.stringify([...(items || [])].map((i) => JSON.stringify(i, Object.keys(i).sort())).sort());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Why this record can't be uploaded as it is (same limits as POST /api/checkin/sync), or null. */
export function uploadProblem(r) {
  if (!r?.scanId || String(r.scanId).length > 80) return 'The scan has no valid id';
  if (!r.eventId) return 'The scan has no event';
  if (r.code.length < 4 || r.code.length > 400) return 'The scanned code is too short or too long to check';
  if (String(r.deviceScannedAt).length > 40) return 'The scan time is not readable';
  return null;
}

/** The scan as POST /api/checkin/sync takes it. clientId carries the scan id (the server echoes it back). */
export const toUploadItem = (r) => ({
  clientId: r.scanId,
  code: r.code,
  gate: r.gate || undefined,
  gateId: r.gateId || undefined,
  direction: r.direction,
  scannedAt: r.deviceScannedAt,
  localResult: r.localResult,
  localReason: r.localReason ? r.localReason.slice(0, 200) : undefined,
  // Evidence for the server (ignored until the server stores them)
  seq: r.seq,
  ticketId: r.ticketId || undefined,
  deviceScannedAt: r.deviceScannedAt,
});

/**
 * The batch after the server answered, matched by scan id. Per-scan status (POST /api/checkin/sync):
 *   ACCEPTED / ALREADY_PROCESSED (or no status: older server) → SYNCED, or CONFLICT when flagged
 *   REJECTED → FAILED (the server kept it for review; the reason is shown)
 *   RETRY, or not mentioned → PENDING (sent again, never dropped)
 */
export function applyAcks(batch, results, now = new Date()) {
  const ack = new Map((results || []).filter((x) => x?.clientId).map((x) => [x.clientId, x]));
  return batch.map((r) => {
    const a = ack.get(r.scanId);
    if (!a) return { ...r, syncState: 'PENDING', lastError: 'The server did not acknowledge this scan; it will be sent again.' };
    const server = { status: a.status || 'ACCEPTED', result: a.result ?? null, reason: a.reason ?? null, conflict: Boolean(a.conflict) };
    if (a.status === 'RETRY') return { ...r, syncState: 'PENDING', lastError: a.reason || 'The server could not process this scan yet; it will be sent again.' };
    if (a.status === 'REJECTED') return { ...r, syncState: 'FAILED', lastError: a.reason || 'The server could not read this scan', server };
    return { ...r, syncState: a.conflict ? 'CONFLICT' : 'SYNCED', syncedAt: now.toISOString(), lastError: null, server };
  });
}

/** Scans handed in as evidence (POST /api/checkin/evidence): acknowledged ones are QUARANTINED, others stay. */
export function applyEvidenceAcks(batch, results, now = new Date()) {
  const ack = new Set((results || []).filter((x) => x?.clientId && x.status === 'QUARANTINED').map((x) => x.clientId));
  return batch.map((r) => (ack.has(r.scanId)
    ? { ...r, syncState: 'QUARANTINED', syncedAt: now.toISOString(), lastError: null, server: { status: 'QUARANTINED', result: null, reason: 'Kept for supervisor review; did not admit anyone', conflict: false } }
    : { ...r, syncState: 'PENDING', lastError: 'The server did not confirm this scan; it will be handed in again.' }));
}

/**
 * Wait before the next automatic upload after n consecutive failed attempts: 30 s, 1, 2, 4, 8 min, then 10 min,
 * each ±20 % so many devices coming back online at once don't retry in step. Manual "Upload now" ignores it.
 */
export function backoffDelay(failures, random = Math.random) {
  if (!failures) return 0;
  const base = Math.min(10 * 60 * 1000, 30 * 1000 * 2 ** (failures - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * What a failed upload request means for its batch: { state: 'PENDING' | 'FAILED', retry, message }.
 * Connection problems, server errors, rate limits and device-credential refusals are retried; a request the server
 * refused as invalid marks the batch FAILED (kept, shown, retried on request).
 */
export function classifySyncError(err) {
  const status = err?.response?.status;
  const message = err?.response?.data?.message;
  if (!status) return { state: 'PENDING', retry: true, message: 'No connection to the server' };
  if (status === 401 || status === 403) return { state: 'PENDING', retry: false, message: message || 'The server refused this device or account' };
  if (status === 408 || status === 429 || status >= 500) return { state: 'PENDING', retry: true, message: message || `Server unavailable (${status})` };
  return { state: 'FAILED', retry: false, message: message || `The server refused the upload (${status})` };
}

/** UPLOADING left behind by a closed page (only called while holding the upload lock). */
export const recoverInterrupted = (r) => (r.syncState === 'UPLOADING' ? { ...r, syncState: 'PENDING', lastError: 'Upload was interrupted (page closed, reloaded or connection lost); it will be sent again.' } : r);

export const shouldPrune = (r, now = Date.now()) => r.syncState === 'SYNCED' && Boolean(r.syncedAt) && now - new Date(r.syncedAt).getTime() > SYNCED_RETENTION_MS;

export function countStates(records) {
  const c = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const r of records || []) if (c[r.syncState] !== undefined) c[r.syncState]++;
  c.unsynced = UNSYNCED.reduce((n, s) => n + c[s], 0);
  return c;
}

export const STUCK_AFTER_MS = 15 * 60 * 1000;
export const STUCK_ATTEMPTS = 5;

/**
 * What the scanner reports about its own scans (heartbeat diagnostics, and the list sent when a supervisor asks to
 * see the pending scans): counts, stuck scans (unprocessed for 15+ minutes or retried 5+ times), the oldest
 * unprocessed scan and the last scan.
 */
export function scanDiagnostics(records, now = Date.now()) {
  const counts = countStates(records);
  const open = (records || []).filter((r) => UNSYNCED.includes(r.syncState));
  const time = (r) => new Date(r.createdAt || r.deviceScannedAt).getTime();
  const stuck = open.filter((r) => now - time(r) > STUCK_AFTER_MS || (r.attempts || 0) >= STUCK_ATTEMPTS);
  const latest = (records || []).reduce((m, r) => (!m || time(r) > time(m) ? r : m), null);
  const oldest = open.reduce((m, r) => (!m || time(r) < time(m) ? r : m), null);
  return {
    counts,
    pending: counts.PENDING + counts.UPLOADING,
    failed: counts.FAILED,
    conflicts: counts.CONFLICT,
    stuck: stuck.length,
    oldestPendingAt: oldest ? new Date(time(oldest)).toISOString() : null,
    lastScanAt: latest ? new Date(time(latest)).toISOString() : null,
    manifest: open.sort((a, b) => a.seq - b.seq).slice(0, 200).map((r) => ({ scanId: r.scanId, seq: r.seq, state: r.syncState, direction: r.direction, gate: r.gate, deviceScannedAt: r.deviceScannedAt, localResult: r.localResult, attempts: r.attempts || 0, lastError: r.lastError })),
  };
}
