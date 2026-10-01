import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import {
  getJwtSecret,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
  REFRESH_COOKIE_NAME,
} from '../config/auth.js';

// A refresh token presented again within this window after being rotated is treated as a race between
// tabs (both refreshed at once), not as theft.
const ROTATION_GRACE_MS = 30 * 1000;

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const signAccessToken = (user) =>
  jwt.sign({ userId: user.id, role: user.role, typ: 'access' }, getJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });

// `typ` rejects the 7-day tokens issued before refresh tokens existed
export const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, getJwtSecret());
  if (decoded.typ !== 'access') throw new jwt.JsonWebTokenError('Unsupported token type');
  return decoded;
};

const cookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  // Cross-site deployments (frontend and API on different sites) need COOKIE_SAMESITE=none
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  return {
    httpOnly: true,
    secure: isProduction || sameSite === 'none',
    sameSite,
    path: '/api/auth',
  };
};

const readCookie = (req, name) => {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

export const readRefreshCookie = (req) => readCookie(req, REFRESH_COOKIE_NAME);

/**
 * Pending-signup session: identifies the unverified account created (or logged into) from this browser,
 * so the signup can be corrected before email verification. It is a signed, httpOnly cookie; the server
 * never accepts an email, phone or user id from the client as proof of ownership.
 */
const PENDING_SIGNUP_COOKIE_NAME = 'tl_pending_signup';
const PENDING_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;

export const setPendingSignupCookie = (res, userId) => {
  const token = jwt.sign({ userId, typ: 'pending_signup' }, getJwtSecret(), {
    expiresIn: Math.floor(PENDING_SIGNUP_TTL_MS / 1000),
  });
  res.cookie(PENDING_SIGNUP_COOKIE_NAME, token, { ...cookieOptions(), maxAge: PENDING_SIGNUP_TTL_MS });
};

export const clearPendingSignupCookie = (res) => {
  res.clearCookie(PENDING_SIGNUP_COOKIE_NAME, cookieOptions());
};

/** Returns the user id from a valid pending-signup cookie, or null. */
export const readPendingSignupUserId = (req) => {
  const token = readCookie(req, PENDING_SIGNUP_COOKIE_NAME);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    return decoded.typ === 'pending_signup' ? decoded.userId : null;
  } catch {
    return null;
  }
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
};

/**
 * Creates a refresh token row (only its hash is stored) and sets it as an httpOnly cookie.
 */
export const issueRefreshToken = async (res, userId) => {
  const raw = crypto.randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  res.cookie(REFRESH_COOKIE_NAME, raw, { ...cookieOptions(), maxAge: REFRESH_TOKEN_TTL_MS });
};

/**
 * Validates the refresh cookie and rotates it. Returns the user id, or null when the session is invalid.
 * Reuse of an already-rotated token (outside the short multi-tab grace window) revokes every session of
 * that user, since it means the token was copied.
 */
export const rotateRefreshToken = async (req, res) => {
  const raw = readRefreshCookie(req);
  if (!raw) return null;

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!stored || stored.expiresAt < new Date()) return null;

  if (stored.revokedAt) {
    if (Date.now() - stored.revokedAt.getTime() > ROTATION_GRACE_MS) {
      await revokeAllRefreshTokens(stored.userId);
    }
    return null;
  }

  // Only one concurrent request can win the rotation
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) return null;

  await issueRefreshToken(res, stored.userId);
  return stored.userId;
};

export const revokeRefreshToken = async (raw) => {
  if (!raw) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

/**
 * Ends every session of a user. Called on password reset, ban, suspension and staff deactivation.
 */
export const revokeAllRefreshTokens = async (userId) => {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};
