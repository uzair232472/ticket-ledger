import crypto from 'node:crypto';

/*
 * Encryption at rest for payout account numbers (IBAN, mobile wallet). AES-256-GCM with a key from
 * FINANCE_ENCRYPTION_KEY (any long random string; it is hashed to 32 bytes). Development without the variable
 * derives a key from JWT_SECRET so the feature works out of the box; production refuses to start without it
 * (config/security.js). Changing the key makes stored numbers unreadable, so keep it with the database backups.
 * Stored form: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */

let warned = false;
function key() {
  const raw = process.env.FINANCE_ENCRYPTION_KEY;
  if (raw) return crypto.createHash('sha256').update(raw).digest();
  if (process.env.NODE_ENV === 'production') throw new Error('FINANCE_ENCRYPTION_KEY is not set.');
  if (!warned) {
    warned = true;
    console.warn('⚠️ FINANCE_ENCRYPTION_KEY is not set: payout details are encrypted with a development key derived from JWT_SECRET.');
  }
  return crypto.createHash('sha256').update(`ticketledger-finance:${process.env.JWT_SECRET || 'dev'}`).digest();
}

export function encryptSecret(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(stored) {
  if (!stored) return null;
  const [version, iv, tag, data] = String(stored).split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable encrypted value.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export const last4 = (value) => (value ? String(value).replace(/\s/g, '').slice(-4) : null);
export const masked = (l4) => (l4 ? `•••• ${l4}` : null);
