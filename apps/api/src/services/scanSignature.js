import crypto from 'node:crypto';

/*
 * Tamper evidence for offline scan records. At enrollment a scanner registers the public half (JWK, ECDSA P-256) of
 * a key pair whose private half it keeps non-extractable in the browser. It signs every scan record when the scan
 * is made; the server verifies the signature on upload. A record changed afterwards in the browser's storage (code,
 * verdict, time, gate, direction, sequence) no longer verifies and is quarantined as TAMPERED, never processed.
 *
 * Limits: code running in the page can still sign whatever it likes (XSS / a compromised device); revocation covers
 * those. Records made before the key existed are unsigned: accepted, marked deviceSigned=false and reported.
 *
 * The canonical text MUST match apps/web/src/lib/gateScanModel.js canonicalScan (checked by
 * test_gate_security.mjs). It is built from the scan exactly as uploaded, before any server-side trimming.
 */

export const SCAN_SIGNATURE_VERSION = 'TL-SCAN-1';

export function canonicalScan(eventId, s) {
  return [SCAN_SIGNATURE_VERSION, s.clientId ?? '', s.seq ?? '', eventId, s.code ?? '', s.direction || 'ENTRY', s.gateId || '', s.gate || '', s.deviceScannedAt || s.scannedAt || '', s.localResult || ''].join('|');
}

/** A public signing key as registered by the scanner: only these four members, never a private part. */
export function cleanPublicJwk(jwk) {
  if (!jwk || typeof jwk !== 'object') return null;
  const ok = jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string' && !('d' in jwk) && jwk.x.length <= 64 && jwk.y.length <= 64;
  if (!ok) return null;
  try {
    crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  } catch {
    return null;
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

const keyCache = new Map();
const keyOf = (jwk) => {
  const id = `${jwk.x}.${jwk.y}`;
  if (!keyCache.has(id)) {
    if (keyCache.size > 500) keyCache.clear();
    keyCache.set(id, crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' }));
  }
  return keyCache.get(id);
};

/** 'valid' | 'invalid' | 'unsigned' for one uploaded scan of a device that has a signing key. */
export function checkScanSignature(jwk, eventId, raw) {
  if (!raw || typeof raw.sig !== 'string' || !raw.sig) return 'unsigned';
  try {
    const sig = Buffer.from(raw.sig, 'base64url');
    if (sig.length !== 64) return 'invalid';
    return crypto.verify('sha256', Buffer.from(canonicalScan(eventId, raw)), { key: keyOf(jwk), dsaEncoding: 'ieee-p1363' }, sig) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}
