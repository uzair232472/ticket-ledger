import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../config/prisma.js';

/**
 * Signed gate passes.
 *
 * A pass is `TL1.<ticketId>.<eventId>.<qrVersion>.<signature>`: the server signs the first four parts with
 * an Ed25519 private key. Gate devices only ever receive the public key, which can verify passes but never
 * create them, so a stolen scanner can't mint tickets. `qrVersion` goes up on every transfer / resale, so the
 * previous owner's QR stops working. The pass carries no personal data.
 *
 * Key: QR_SIGNING_PRIVATE_KEY (PKCS#8 PEM) in production. In development a key is generated once into
 * apps/api/.keys/ (git-ignored) so passes stay valid across restarts.
 */

export const PASS_PREFIX = 'TL1';
const KEY_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.keys/qr-ed25519.pem');

let keys = null;
const loadKeys = () => {
  if (keys) return keys;
  let pem = process.env.QR_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!pem) {
    if (process.env.NODE_ENV === 'production') throw new Error('QR_SIGNING_PRIVATE_KEY must be set in production.');
    if (fs.existsSync(KEY_FILE)) {
      pem = fs.readFileSync(KEY_FILE, 'utf8');
    } else {
      const { privateKey } = crypto.generateKeyPairSync('ed25519');
      pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      fs.writeFileSync(KEY_FILE, pem, { mode: 0o600 });
    }
  }
  const privateKey = crypto.createPrivateKey(pem);
  const publicKey = crypto.createPublicKey(privateKey);
  keys = {
    privateKey,
    publicKey,
    // Raw 32-byte key (base64url) for the scanner's WebCrypto verification
    publicKeyRaw: publicKey.export({ format: 'jwk' }).x,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
  return keys;
};

export const getPublicKey = () => {
  const k = loadKeys();
  return { alg: 'Ed25519', raw: k.publicKeyRaw, pem: k.publicKeyPem };
};

/** The signed pass string for a ticket (generated on demand, never stored). */
export const signPass = (ticket) => {
  const payload = `${PASS_PREFIX}.${ticket.id}.${ticket.eventId}.${ticket.qrVersion}`;
  const sig = crypto.sign(null, Buffer.from(payload), loadKeys().privateKey).toString('base64url');
  return `${payload}.${sig}`;
};

/**
 * Checks a scanned string's format and signature. Returns { ok: true, ticketId, eventId, qrVersion }
 * or { ok: false, reason }.
 */
export const verifyPass = (raw) => {
  const text = String(raw || '').trim();
  const parts = text.split('.');
  if (parts.length !== 5 || parts[0] !== PASS_PREFIX) return { ok: false, reason: 'Not a TicketLedger pass' };
  const [, ticketId, eventId, version, sig] = parts;
  const qrVersion = Number(version);
  if (!ticketId || !eventId || !Number.isInteger(qrVersion) || qrVersion < 1 || !sig) return { ok: false, reason: 'Not a TicketLedger pass' };
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(parts.slice(0, 4).join('.')), loadKeys().publicKey, Buffer.from(sig, 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'Invalid ticket (signature check failed)' };
  return { ok: true, ticketId, eventId, qrVersion };
};

// ---------- Manual codes: TL-XXXX-XXXX (no 0/O/1/I/L, so they read back without mistakes) ----------
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const randomCode = () => {
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `TL-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
};

/** Normalises what staff typed ("tl 7k3m 9qx2", "7K3M9QX2") to the stored form. */
export const normaliseManualCode = (raw) => {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TL/, '');
  if (s.length !== 8) return null;
  return `TL-${s.slice(0, 4)}-${s.slice(4)}`;
};
export const looksLikeManualCode = (raw) => normaliseManualCode(raw) !== null && !String(raw).includes('.');

/** Gives a ticket a fresh manual code (new tickets, and after every transfer / resale). */
export const assignManualCode = async (ticketId, tx = prisma) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const updated = await tx.ticket.update({ where: { id: ticketId }, data: { manualCode: randomCode() } });
      return updated.manualCode;
    } catch (err) {
      if (err.code !== 'P2002') throw err; // unique clash: try another code
    }
  }
  throw new Error('Could not allocate a manual code');
};

/** Makes sure every given ticket has a manual code (tickets issued before codes existed). */
export const ensureManualCodes = async (tickets) => {
  for (const t of tickets) {
    if (!t.manualCode) t.manualCode = await assignManualCode(t.id);
  }
  return tickets;
};

/** The data passed to the wallet / PDF for a ticket. */
export const passFor = async (ticket) => {
  if (!ticket.manualCode) await ensureManualCodes([ticket]);
  return { code: signPass(ticket), manualCode: ticket.manualCode, qrVersion: ticket.qrVersion };
};
