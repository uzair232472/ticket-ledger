import api from '../utils/api';

/**
 * Scanner device credential (server-issued device token, see the API's deviceAuthService).
 *
 * The token is kept in its own IndexedDB database (tl-gate-cred), never in localStorage and never in the
 * offline scan database (tl-gate). It is encrypted with an AES-GCM key generated on this device as
 * *non-extractable*: page scripts can use the key but no one can read it out, so copying the stored record
 * (storage export, another profile, a backup) does not reveal the token. This does not protect against code
 * running in the page itself (XSS) or a fully compromised device; revocation on the server covers those.
 * One token per organization (a device row is per organization on the server).
 */

const DB_NAME = 'tl-gate-cred';
const DB_VERSION = 1;
export const DEVICE_AUTH_CODES = ['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED', 'DEVICE_ENROLLMENT_REQUIRED'];

let dbPromise = null;
const openDb = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
        if (!db.objectStoreNames.contains('tokens')) db.createObjectStore('tokens'); // key: companyId
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
    t.onabort = () => reject(t.error);
  });
};

// One tab at a time creates the key or enrolls (two tabs of the scanner share the device and its token)
const withLock = (name, fn) => (typeof navigator !== 'undefined' && navigator.locks?.request ? navigator.locks.request(name, fn) : fn());

const canEncrypt = () => typeof crypto !== 'undefined' && Boolean(crypto.subtle);

async function wrappingKey() {
  return withLock('tl-gate-cred-key', async () => {
    const existing = await tx('keys', 'readonly', (s) => s.get('aes'));
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await tx('keys', 'readwrite', (s) => s.put(key, 'aes'));
    return key;
  });
}

// ---------- Scan signing key (tamper evidence; API src/services/scanSignature.js) ----------
// An ECDSA P-256 key pair generated here with a NON-extractable private key: page scripts can sign with it, but the
// key itself can't be read or copied out. Its public half is registered with the server at enrollment.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function signingKeyPair() {
  if (!canEncrypt()) return null;
  return withLock('tl-gate-cred-key', async () => {
    const existing = await tx('keys', 'readonly', (s) => s.get('sign'));
    if (existing) return existing;
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']).catch(() => null);
    if (pair) await tx('keys', 'readwrite', (s) => s.put(pair, 'sign'));
    return pair;
  }).catch(() => null);
}

/** The public signing key as the enrollment endpoint takes it, or null (no WebCrypto ECDSA in this browser). */
export async function publicSigningJwk() {
  const pair = await signingKeyPair();
  if (!pair) return null;
  const j = await crypto.subtle.exportKey('jwk', pair.publicKey).catch(() => null);
  return j ? { kty: j.kty, crv: j.crv, x: j.x, y: j.y } : null;
}

/** Signs a scan record's canonical text (gateScanModel.canonicalScan); null when the device can't sign. */
export async function signScan(text) {
  const pair = await signingKeyPair();
  if (!pair) return null;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(text));
  return b64url(sig);
}

const loadRecord = (companyId) => (companyId ? tx('tokens', 'readonly', (s) => s.get(companyId)).catch(() => null) : Promise.resolve(null));

export async function loadDeviceToken(companyId, deviceKey) {
  if (!companyId) return null;
  try {
    const rec = await tx('tokens', 'readonly', (s) => s.get(companyId));
    if (!rec || rec.deviceKey !== deviceKey) return null;
    if (rec.plain) return rec.plain; // browser without WebCrypto (stored unencrypted, see saveDeviceToken)
    const key = await wrappingKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function saveDeviceToken(companyId, deviceKey, token, { keyRegistered = false } = {}) {
  if (!canEncrypt()) {
    await tx('tokens', 'readwrite', (s) => s.put({ deviceKey, plain: token, keyRegistered, savedAt: Date.now() }, companyId));
    return;
  }
  const key = await wrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  await tx('tokens', 'readwrite', (s) => s.put({ deviceKey, iv, ct, keyRegistered, savedAt: Date.now() }, companyId));
}

/**
 * A device enrolled before scan signing registers its signing key once, by rotating its token (the current token
 * proves it is the same device). Returns the token to use from now on.
 */
async function registerSigningKey({ eventId, deviceKey, companyId, token }) {
  const signingKey = await publicSigningJwk();
  if (!signingKey) return token;
  try {
    const res = await api.post('/checkin/devices/enroll', { eventId, deviceId: deviceKey, signingKey }, { headers: { 'X-Device-Token': token } });
    await saveDeviceToken(res.data.data.companyId, deviceKey, res.data.data.token, { keyRegistered: true });
    return res.data.data.token;
  } catch {
    return token; // try again next time; the current token still works
  }
}

/** Forget this device's credential for one organization (or for all of them without a companyId). */
export const clearDeviceToken = (companyId) => tx('tokens', 'readwrite', (s) => (companyId ? s.delete(companyId) : s.clear())).catch(() => {});

/**
 * Makes sure this device holds a valid token for the event's organization. `invalidToken`: the token the server
 * just refused (it is dropped only if it is still the stored one, in case another tab already replaced it).
 * Returns { token, companyId, state } with state 'enrolled' | 'needs-reset' | 'revoked' | 'offline' | 'error'.
 */
export async function ensureDeviceToken({ eventId, deviceKey, companyId, invalidToken = null }) {
  return withLock('tl-gate-enroll', async () => {
    const stored = await loadDeviceToken(companyId, deviceKey);
    if (stored && stored !== invalidToken) {
      const rec = await loadRecord(companyId);
      const token = rec?.keyRegistered ? stored : await registerSigningKey({ eventId, deviceKey, companyId, token: stored });
      return { token, companyId, state: 'enrolled' };
    }
    if (stored && companyId) await clearDeviceToken(companyId);
    try {
      const signingKey = await publicSigningJwk();
      const res = await api.post('/checkin/devices/enroll', { eventId, deviceId: deviceKey, ...(signingKey ? { signingKey } : {}) });
      const { token, companyId: cid } = res.data.data;
      await saveDeviceToken(cid, deviceKey, token, { keyRegistered: Boolean(signingKey) });
      return { token, companyId: cid, state: 'enrolled' };
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'DEVICE_ALREADY_ENROLLED') {
        // The organization wasn't known yet (event list still loading): the token may already be here
        const cid = err.response.data.companyId;
        const mine = cid && cid !== companyId ? await loadDeviceToken(cid, deviceKey) : null;
        if (mine && mine !== invalidToken) return { token: mine, companyId: cid, state: 'enrolled' };
        return { token: null, companyId: cid || companyId, state: 'needs-reset', message: err.response.data.message };
      }
      if (code === 'DEVICE_REVOKED') return { token: null, companyId, state: 'revoked' };
      return { token: null, companyId, state: err.response ? 'error' : 'offline', message: err.response?.data?.message };
    }
  });
}
