import crypto from 'node:crypto';

// Secrets that were once hardcoded in this repository: they are public and must never be accepted
const PUBLISHED_SECRETS = new Set(['ticketledger_jwt_super_secret_key_2026_fyp', 'ticketledger_qr_master_secret_key_2026_fyp', 'change-me-to-a-long-random-string']);

/**
 * Checks the secrets the API cannot run safely without. Called once at start (server.js), so a missing secret
 * stops the server instead of surfacing on the first login or ticket. Returns the list of problems; throws
 * when `fatal` (default) and there is any.
 */
export function assertSecrets({ fatal = true } = {}) {
  const problems = [];
  const production = process.env.NODE_ENV === 'production';
  const jwt = process.env.JWT_SECRET || '';

  if (!jwt) problems.push('JWT_SECRET is not set.');
  else if (PUBLISHED_SECRETS.has(jwt)) problems.push('JWT_SECRET is a value that was published in the source code; generate a new one.');
  else if (production && jwt.length < 32) problems.push('JWT_SECRET must be at least 32 characters in production.');
  if (process.env.QR_HMAC_SECRET && PUBLISHED_SECRETS.has(process.env.QR_HMAC_SECRET)) problems.push('QR_HMAC_SECRET is a published value; generate a new one.');

  if (production) {
    // Payout account numbers are encrypted with this key (services/financeCrypto.js)
    if (!process.env.FINANCE_ENCRYPTION_KEY) problems.push('FINANCE_ENCRYPTION_KEY must be set in production (encrypts payout account numbers).');
    // Gate passes: production must use its own Ed25519 key, never the development key file
    const pem = process.env.QR_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!pem) {
      problems.push('QR_SIGNING_PRIVATE_KEY must be set in production (Ed25519, PKCS#8 PEM).');
    } else {
      try {
        const key = crypto.createPrivateKey(pem);
        if (key.asymmetricKeyType !== 'ed25519') problems.push(`QR_SIGNING_PRIVATE_KEY must be an Ed25519 key (got ${key.asymmetricKeyType}).`);
      } catch {
        problems.push('QR_SIGNING_PRIVATE_KEY is not a valid PKCS#8 PEM private key.');
      }
    }
  }

  if (problems.length && fatal) {
    throw new Error(`Refusing to start, unsafe configuration:\n - ${problems.join('\n - ')}`);
  }
  return problems;
}
