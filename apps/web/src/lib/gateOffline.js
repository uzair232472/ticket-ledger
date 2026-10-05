/**
 * Offline support for the gate scanner.
 *
 * IndexedDB keeps, per event: the offline pack (public key + every paid ticket with its status, qrVersion and
 * manual code), the check-ins this device made, and a queue of scans to upload with POST /api/checkin/sync.
 * Passes are verified locally with the public key (WebCrypto Ed25519), which can check passes but never make
 * them. If the device has been offline for more than 2 hours, scanning locks until it reconnects.
 */

const DB_NAME = 'tl-gate';
const DB_VERSION = 1;
export const OFFLINE_LIMIT_MS = 2 * 60 * 60 * 1000;
const LAST_ONLINE_KEY = 'tl-gate-last-online';
const DEVICE_KEY = 'tl-gate-device';

let dbPromise = null;
const openDb = () => {
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
  const db = await openDb();
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
export const enqueue = (scan) => tx('queue', 'readwrite', (s) => s.put(scan));
export const queued = async (eventId) => {
  const all = await tx('queue', 'readonly', (s) => s.getAll());
  return (all || []).filter((q) => !eventId || q.eventId === eventId).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
};
export const dequeue = (ids) => tx('queue', 'readwrite', (s) => ids.forEach((id) => s.delete(id)));

/**
 * Access to an event was revoked: remove everything this device holds for it (the ticket list, its own
 * check-ins and scans waiting to upload, which the server would refuse). Returns how many queued scans
 * were dropped.
 */
export async function wipeEvent(eventId) {
  const dropped = (await queued(eventId)).map((q) => q.clientId);
  await dequeue(dropped);
  await tx('packs', 'readwrite', (s) => s.delete(eventId));
  const keys = (await tx('used', 'readonly', (s) => s.getAllKeys())) || [];
  const mine = keys.filter((k) => String(k).startsWith(`${eventId}:`));
  if (mine.length) await tx('used', 'readwrite', (s) => mine.forEach((k) => s.delete(k)));
  return dropped.length;
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
    id = `gate-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
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

/**
 * Decides a scan on the device, from the pack (same order of checks as the server). Admitting marks the
 * ticket used on this device so a second scan here turns yellow.
 */
export async function evaluateOffline(pack, raw, gate) {
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

  const view = { type: ticket.type, seat: ticket.seat, holder: ticket.holder };
  if (version !== ticket.qrVersion) return { result: 'RED', reason: 'Old QR: this ticket was transferred', ticket: view };
  if (ticket.status === 'CANCELLED') return { result: 'RED', reason: 'Ticket refunded / cancelled', ticket: view };

  const local = await usedLocally(eventId, ticket.id);
  const used = local || (ticket.status === 'USED' ? { at: ticket.checkedInAt, gate: ticket.gate } : null);
  if (used) {
    return {
      result: 'YELLOW',
      reason: used.at ? `Already scanned at ${timeOf(used.at)}${used.gate ? `, ${used.gate}` : ''}` : 'Already scanned',
      ticket: view,
      firstScan: used,
    };
  }

  await markUsedLocally(eventId, ticket.id, { at: new Date().toISOString(), gate });
  return { result: 'GREEN', reason: 'Entry allowed', ticket: view };
}
