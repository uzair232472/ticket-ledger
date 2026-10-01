import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import { sendOtpEmail } from './emailService.js';
import {
  getJwtSecret,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  MESSAGES,
} from '../config/auth.js';

// 6-digit OTP from a CSPRNG; only an HMAC of it is stored.
const generateCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
const hashCode = (code) => crypto.createHmac('sha256', getJwtSecret()).update(code).digest('hex');
const codeMatches = (code, storedHash) => {
  const a = Buffer.from(hashCode(code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Seconds left before another code for this purpose may be sent (0 when allowed).
 */
export const otpCooldownRemaining = async (userId, purpose) => {
  const latest = await prisma.otpCode.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) return 0;
  const remainingMs = latest.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 1000));
};

/**
 * Timing of the current code, for the OTP screen's countdowns. Times are ISO strings from the server clock.
 * A code locked by too many wrong attempts is reported as already expired.
 */
export const getOtpTiming = async (userId, purpose) => {
  const latest = await prisma.otpCode.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: 'desc' },
  });
  const now = new Date();
  if (!latest) return { otpExpiresAt: null, resendAvailableAt: now.toISOString(), serverTime: now.toISOString() };

  const usable = !latest.consumedAt && latest.attempts < OTP_MAX_ATTEMPTS;
  const expiresAt = usable ? latest.expiresAt : new Date(Math.min(latest.expiresAt.getTime(), now.getTime()));
  return {
    otpExpiresAt: expiresAt.toISOString(),
    resendAvailableAt: new Date(latest.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS).toISOString(),
    serverTime: now.toISOString(),
  };
};

/**
 * Issues a new code (cancelling older unused codes for the same purpose) and emails it.
 * The DB write happens first; SMTP failures are handled inside sendOtpEmail and never throw.
 */
export const issueOtp = async (user, purpose) => {
  const code = generateCode();
  const now = new Date();
  await prisma.$transaction([
    prisma.otpCode.updateMany({
      where: { userId: user.id, purpose, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.otpCode.create({
      data: {
        userId: user.id,
        purpose,
        codeHash: hashCode(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
    }),
  ]);
  await sendOtpEmail({ to: user.email, name: user.name, otpCode: code, purpose });
};

/**
 * Checks a code and consumes it on success.
 * Returns { ok: true } or { ok: false, message } with the user-facing message from the brief.
 */
export const consumeOtp = async (userId, purpose, code) => {
  const otp = userId
    ? await prisma.otpCode.findFirst({
        where: { userId, purpose, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, message: MESSAGES.OTP_EXPIRED };
  }

  if (!codeMatches(code, otp.codeHash)) {
    const updated = await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    const left = OTP_MAX_ATTEMPTS - updated.attempts;
    return { ok: false, message: left > 0 ? MESSAGES.OTP_INCORRECT(left) : MESSAGES.OTP_EXPIRED };
  }

  // Conditional update so the same code cannot be used twice by concurrent requests
  const { count } = await prisma.otpCode.updateMany({
    where: { id: otp.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) return { ok: false, message: MESSAGES.OTP_EXPIRED };
  return { ok: true };
};
