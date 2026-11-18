/**
 * Offline support for the gate scanner.
 *
 * IndexedDB (tl-gate) keeps, per event: the offline pack (public key + every paid ticket with its status, qrVersion
 * and manual code) and the check-ins this device made. Scans themselves live in gateScanStore.js (tl-gate-scans);
 * the old `queue` store here is kept at version 1 so an older scanner build still opens this database, and holds a
 * mirror of the scans not processed by the server yet (a rolled-back scanner uploads exactly those).
 * Passes are verified locally with the public key (WebCrypto Ed25519), which can check passes but never make
 * them. If the device has been offline for more than 2 hours, scanning locks until it reconnects.
 */

const DB_NAME = 'tl-gate';
const DB_VERSION = 1;
export const OFFLINE_LIMIT_MS = 2 * 60 * 60 * 1000;
const LAST_ONLINE_KEY = 'tl-gate-last-online';
const DEVICE_KEY = 'tl-gate-device';

let dbPromise = null;
/** Kept at version 1 on purpose: an older scanner build must still be able to open it (rollback). */
export const openLegacyDb = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('packs'); // key: eventId
        db.createObjectStore('used'); // key: `${eventId}:${ticketId}` -> { at, gate }
        db.createObjectStore('queue', { keyPath: 'clientId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
};

const tx = async (store, mode, fn) => {
  const db = await openLegacyDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const request = fn(t.objectStore(store));
    t.oncomplete = () => resolve(request instanceof IDBRequest ? request.result : undefined);
    t.onerror = () => reject(t.error);
  });
};

// A pack belongs to the staff member who downloaded it; another account on the same device can't use it
export const savePack = (eventId, pack, ownerId) => tx('packs', 'readwrite', (s) => s.put({ ...pack, ownerId, savedAt: Date.now() }, eventId));
export const loadPack = async (eventId, ownerId) => {
  const pack = await tx('packs', 'readonly', (s) => s.get(eventId));
  return pack && pack.ownerId === ownerId ? pack : null;
};
export const markUsedLocally = (eventId, ticketId, info) => tx('used', 'readwrite', (s) => s.put(info, `${eventId}:${ticketId}`));
export const usedLocally = (eventId, ticketId) => tx('used', 'readonly', (s) => s.get(`${eventId}:${ticketId}`));
// The version-1 queue (see the header): written and cleared only by gateScanStore.js
export const legacyPut = (item) => tx('queue', 'readwrite', (s) => s.put(item));
export const legacyAll = async () => (await tx('queue', 'readonly', (s) => s.getAll())) || [];
export const legacyDelete = (ids) => (ids.length ? tx('queue', 'readwrite', (s) => ids.forEach((id) => s.delete(id))) : Promise.resolve());

/**
 * Access to an event (or this device) was revoked: delete the event's ticket list and the device's local
 * presence copy, so it can't decide scans any more. Scans waiting to upload are evidence of what happened at the
 * gate and are KEPT: scan records (gateScanStore.js) are never deleted here (supervisors review them; they never
 * admit anyone by themselves).
 */
export async function wipeEventPack(eventId) {
  await tx('packs', 'readwrite', (s) => s.delete(eventId));
  const keys = (await tx('used', 'readonly', (s) => s.getAllKeys())) || [];
  const mine = keys.filter((k) => String(k).startsWith(`${eventId}:`));
  if (mine.length) await tx('used', 'readwrite', (s) => mine.forEach((k) => s.delete(k)));
}

// ---------- Device identity and connectivity ----------
const safeGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};
export const deviceId = () => {
  let id = safeGet(DEVICE_KEY);
  if (!id) {
    const rnd = crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    id = `gate-${rnd}`;
    safeSet(DEVICE_KEY, id);
  }
  return id;
};
export const noteOnline = () => safeSet(LAST_ONLINE_KEY, String(Date.now()));
export const lastOnline = () => Number(safeGet(LAST_ONLINE_KEY)) || 0;
export const offlineTooLong = () => {
  const last = lastOnline();
  return Boolean(last) && Date.now() - last > OFFLINE_LIMIT_MS;
};

// ---------- Pass parsing and local verification ----------
const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export const normaliseManualCode = (raw) => {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TL/, '');
  return s.length === 8 ? `TL-${s.slice(0, 4)}-${s.slice(4)}` : null;
};
export const isManualCode = (raw) => !String(raw).includes('.') && normaliseManualCode(raw) !== null;

const keyCache = new Map();
const importKey = async (raw) => {
  if (!keyCache.has(raw)) {
    keyCache.set(raw, crypto.subtle.importKey('raw', b64urlToBytes(raw), { name: 'Ed25519' }, false, ['verify']).catch(() => null));
  }
  return keyCache.get(raw);
};

/** Signature check with the pack's public key. Returns true / false, or null when the browser can't check. */
const verifySignature = async (pack, payload, sig) => {
  if (!crypto?.subtle) return null;
  const key = await importKey(pack.publicKey.raw);
  if (!key) return null; // no Ed25519 in this browser
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, b64urlToBytes(sig), new TextEncoder().encode(payload));
  } catch {
    return false;
  }
};

const timeOf = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Re-entries still allowed for a ticket that is outside (same rule as the server's checkinService). */
const reentriesLeft = (event, entries) => {
  if (!event?.reentryPolicy || event.reentryPolicy === 'NONE') return 0;
  if (event.reentryPolicy === 'UNLIMITED') return Infinity;
  return Math.max(0, (event.maxReentries ?? 0) - Math.max(0, (entries || 1) - 1));
};

/**
 * Decides a scan on the device, from the pack (same order of checks as the server): signature, event, QR
 * version, cancelled, the gate's ticket types, then entry / exit and the re-entry policy. The device keeps each
 * ticket's presence (inside / outside, number of entries) so its own later scans are decided correctly.
 * opts: { direction: 'ENTRY' | 'EXIT', gateRow: the pack's gate (or null) }
 */
export async function evaluateOffline(pack, raw, gate, { direction = 'ENTRY', gateRow = null } = {}) {
  const eventId = pack.event.id;
  const text = String(raw || '').trim();
  let ticket = null;
  let version = null;

  if (isManualCode(text)) {
    const code = normaliseManualCode(text);
    ticket = pack.tickets.find((t) => t.manualCode === code) || null;
    if (!ticket) return { result: 'RED', reason: 'No ticket has this code' };
    version = ticket.qrVersion;
  } else {
    const parts = text.split('.');
    if (parts.length !== 5 || parts[0] !== 'TL1') return { result: 'RED', reason: 'Not a TicketLedger pass' };
    const [, ticketId, passEvent, v, sig] = parts;
    const ok = await verifySignature(pack, parts.slice(0, 4).join('.'), sig);
    if (ok === false) return { result: 'RED', reason: 'Invalid ticket (signature check failed)' };
    if (passEvent !== eventId) return { result: 'RED', reason: 'Ticket is for a different event' };
    ticket = pack.tickets.find((t) => t.id === ticketId) || null;
    if (!ticket) return { result: 'RED', reason: 'Invalid ticket (not in this event’s list)' };
    version = Number(v);
  }

  const view = { id: ticket.id, type: ticket.type, seat: ticket.seat, holder: ticket.holder };
  if (version !== ticket.qrVersion) return { result: 'RED', reason: 'Old QR: this ticket was transferred', ticket: view };
  if (ticket.status === 'CANCELLED') return { result: 'RED', reason: 'Ticket refunded / cancelled', ticket: view };

  const now = new Date().toISOString();
  const local = await usedLocally(eventId, ticket.id);
  const used = local || (ticket.status === 'USED' ? { at: ticket.checkedInAt, gate: ticket.gate, inside: ticket.isInside !== false, entries: ticket.entryCount || 1, exitAt: ticket.lastExitAt } : null);
  const inside = used && used.inside !== false;

  if (direction === 'EXIT') {
    if (!used) return { result: 'RED', reason: "This ticket hasn't entered yet", ticket: view };
    if (!inside) return { result: 'YELLOW', reason: used.exitAt ? `Already left at ${timeOf(used.exitAt)}` : 'Already outside', ticket: view, firstScan: used };
    await markUsedLocally(eventId, ticket.id, { ...used, inside: false, exitAt: now });
    return { result: 'GREEN', reason: reentriesLeft(pack.event, used.entries) ? 'Exit recorded. Re-entry allowed' : 'Exit recorded. No re-entry with this ticket', ticket: view };
  }

  if (gateRow?.allowedTierIds?.length && !gateRow.allowedTierIds.includes(ticket.tierId)) {
    const names = (pack.gates || []).filter((g) => g.active && g.type !== 'EXIT' && (!g.allowedTierIds.length || g.allowedTierIds.includes(ticket.tierId))).map((g) => g.name);
    return { result: 'RED', code: 'WRONG_GATE', reason: `Wrong gate: ${ticket.type} tickets enter at ${names.join(', ') || 'another gate'}`, ticket: view };
  }

  if (used) {
    if (inside || !used.exitAt) {
      return { result: 'YELLOW', reason: used.at ? `Already scanned at ${timeOf(used.at)}${used.gate ? `, ${used.gate}` : ''}` : 'Already scanned', ticket: view, firstScan: used };
    }
    if (reentriesLeft(pack.event, used.entries) > 0) {
      await markUsedLocally(eventId, ticket.id, { ...used, inside: true, entries: (used.entries || 1) + 1 });
      return { result: 'GREEN', reason: 'Re-entry allowed', reentry: true, ticket: view };
    }
    return { result: 'YELLOW', reason: pack.event.reentryPolicy === 'LIMITED' ? 'Re-entry limit reached' : `Left at ${timeOf(used.exitAt)}: no re-entry for this event`, ticket: view, firstScan: used };
  }

  await markUsedLocally(eventId, ticket.id, { at: now, gate, inside: true, entries: 1 });
  return { result: 'GREEN', reason: 'Entry allowed', ticket: view };
}
