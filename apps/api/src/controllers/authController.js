import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';
import { issueOtp, consumeOtp, otpCooldownRemaining, getOtpTiming } from '../services/otpService.js';
import {
  sha256,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  readRefreshCookie,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  clearRefreshCookie,
  setPendingSignupCookie,
  clearPendingSignupCookie,
  readPendingSignupUserId,
} from '../services/tokenService.js';
import { BLOCKED_STATUSES, OTP_RESEND_COOLDOWN_MS, MESSAGES } from '../config/auth.js';

// The role is never taken from the client. Public signup can only create CUSTOMER or ORGANIZER accounts;
// GATE_STAFF come from invites and SUPER_ADMIN from the seed script.
const ACCOUNT_TYPE_TO_ROLE = { customer: 'CUSTOMER', organizer: 'ORGANIZER' };

// Validation Schemas (same rules as the frontend forms)
const emailSchema = z.string().trim().toLowerCase().email('Invalid email address');
const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters');
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least 1 letter')
  .regex(/\d/, 'Password must contain at least 1 number');
const codeSchema = z.string().regex(/^\d{6}$/, 'The code must be exactly 6 digits');

// Accepts 03XXXXXXXXX or +92 3XX XXXXXXX (spaces/dashes allowed) and normalizes to +923XXXXXXXXX
const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (v.startsWith('03') ? `+92${v.slice(1)}` : v))
  .refine((v) => /^\+923\d{9}$/.test(v), 'Phone must be a Pakistani mobile number (+923XXXXXXXXX)');

const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  // A Pakistani mobile number is required to sign up
  phone: z.string({ required_error: 'Mobile number is required' }).trim().min(1, 'Mobile number is required').pipe(phoneSchema),
  accountType: z.enum(['customer', 'organizer']).optional().default('customer'),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum/Polygon wallet address').optional().or(z.literal('')),
});

// Correcting a pending signup: same fields, but the password may be left blank to keep the current one
const pendingSignupUpdateSchema = signupSchema
  .omit({ password: true, walletAddress: true })
  .extend({ password: z.literal('').transform(() => undefined).or(passwordSchema).optional() });

const PHONE_EXISTS = 'An account with this phone number already exists.';
const ROLE_TO_ACCOUNT_TYPE = { CUSTOMER: 'customer', ORGANIZER: 'organizer' };

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// `otpCode` is accepted as an alias of `code` for older clients
const withCodeAlias = (body) => ({ ...body, code: body?.code ?? body?.otpCode });

const verifyOtpSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  purpose: z.literal('VERIFY_EMAIL').optional().default('VERIFY_EMAIL'),
});

const resendOtpSchema = z.object({
  email: emailSchema,
  purpose: z.enum(['VERIFY_EMAIL', 'RESET_PASSWORD']).optional().default('VERIFY_EMAIL'),
});

const forgotPasswordSchema = z.object({ email: emailSchema });

const resetPasswordSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  newPassword: passwordSchema,
});

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Invite token is required'),
  name: nameSchema,
  password: passwordSchema,
});

const isBlocked = (user) => BLOCKED_STATUSES.includes(user.status);

const suspendedResponse = (res) =>
  res.status(403).json({ success: false, code: 'ACCOUNT_SUSPENDED', message: MESSAGES.ACCOUNT_SUSPENDED });

const handleError = (res, error, context) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: error.errors[0]?.message || 'Validation error',
      errors: error.errors,
    });
  }
  console.error(`${context} error:`, error);
  return res.status(500).json({ success: false, message: `Server error during ${context.toLowerCase()}` });
};

/**
 * The user object returned by login, verify-otp, refresh, accept-invite and /me.
 * Organizers get companyStatus (NONE / PENDING / APPROVED / REJECTED / SUSPENDED) so the frontend can
 * redirect without an extra call.
 */
export const buildAuthUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      company: { select: { id: true, companyName: true, status: true, rejectionReason: true } },
      memberOfCompany: { select: { id: true, companyName: true } },
    },
  });
  if (!user) return null;

  const isOrganizer = user.role === 'ORGANIZER';
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    walletAddress: user.walletAddress,
    city: user.city,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    companyId: user.companyId,
    companyName: (isOrganizer ? user.company?.companyName : user.memberOfCompany?.companyName) || null,
    companyStatus: isOrganizer ? user.company?.status || 'NONE' : null,
    companyRejectionReason: isOrganizer ? user.company?.rejectionReason || null : null,
  };
};

// Issues an access token + rotating refresh cookie and returns the standard session payload
const startSession = async (res, userId) => {
  const user = await buildAuthUser(userId);
  await issueRefreshToken(res, user.id);
  return { user, token: signAccessToken(user) };
};

const trackLogin = (req, userId, method, email) => {
  const clientSessionId = req.headers['x-session-id'] || req.body?.sessionId;
  if (clientSessionId) {
    behaviorService.attachSessionToUser({ sessionId: clientSessionId, userId });
  }
  behaviorService.trackBehavior({
    req,
    userId,
    action: BEHAVIOR_ACTIONS.LOGIN,
    metadata: { method, email },
  });
};

/**
 * POST /api/auth/signup
 */
export const signup = async (req, res) => {
  try {
    // This browser already has an unverified signup: correct it instead of creating a second account
    if (await findPendingSignupUser(req)) return updatePendingSignup(req, res);

    const { name, email, password, phone, accountType, walletAddress } = signupSchema.parse(req.body);

    if (walletAddress) {
      const existingWallet = await prisma.user.findFirst({
        where: { walletAddress: walletAddress.toLowerCase() },
      });
      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: 'This MetaMask wallet address is already linked to another account.',
        });
      }
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: existingUser.email === email ? MESSAGES.EMAIL_EXISTS : PHONE_EXISTS,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        passwordHash,
        role: ACCOUNT_TYPE_TO_ROLE[accountType],
        status: 'PENDING_VERIFICATION',
        walletAddress: walletAddress || null,
      },
      select: { id: true, name: true, email: true },
    });

    // No session is issued until the email is verified; the pending-signup cookie only allows correcting it
    await issueOtp(user, 'VERIFY_EMAIL');
    setPendingSignupCookie(res, user.id);
    trackLogin(req, user.id, 'REGISTRATION_PENDING_OTP', user.email);

    return res.status(201).json({
      success: true,
      requiresOtp: true,
      message: `We sent a 6-digit verification code to ${user.email}.`,
      data: { email: user.email, ...(await getOtpTiming(user.id, 'VERIFY_EMAIL')) },
    });
  } catch (error) {
    if (error?.code === 'P2002') return res.status(409).json({ success: false, message: MESSAGES.EMAIL_EXISTS });
    return handleError(res, error, 'Registration');
  }
};

// The unverified user identified by this browser's signed pending-signup cookie, or null
const findPendingSignupUser = async (req) => {
  const userId = readPendingSignupUserId(req);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.status === 'PENDING_VERIFICATION' ? user : null;
};

const noPendingSignup = (res) =>
  res.status(401).json({
    success: false,
    code: 'NO_PENDING_SIGNUP',
    message: 'Your signup session has expired. Please sign in or create your account again.',
  });

/**
 * GET /api/auth/pending-signup — the unverified signup from this browser (no password) and OTP timing
 */
export const getPendingSignup = async (req, res) => {
  try {
    const user = await findPendingSignupUser(req);
    if (!user) return noPendingSignup(res);
    return res.status(200).json({
      success: true,
      data: {
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        accountType: ROLE_TO_ACCOUNT_TYPE[user.role] || 'customer',
        ...(await getOtpTiming(user.id, 'VERIFY_EMAIL')),
      },
    });
  } catch (error) {
    return handleError(res, error, 'Pending signup lookup');
  }
};

/**
 * PATCH /api/auth/pending-signup — corrects the unverified signup from this browser.
 * Ownership comes only from the signed cookie. The record's own email and phone are excluded from the
 * uniqueness checks; other accounts' values are still rejected. A changed email cancels the old code,
 * stays unverified and gets a new code (subject to the normal resend cooldown).
 */
export const updatePendingSignup = async (req, res) => {
  try {
    const user = await findPendingSignupUser(req);
    if (!user) return noPendingSignup(res);

    const { name, email, phone, password, accountType } = pendingSignupUpdateSchema.parse(req.body);
    const others = { id: { not: user.id } };

    if (await prisma.user.findFirst({ where: { email, ...others } })) {
      return res.status(409).json({ success: false, message: MESSAGES.EMAIL_EXISTS });
    }
    if (phone && (await prisma.user.findFirst({ where: { phone, ...others } }))) {
      return res.status(409).json({ success: false, message: PHONE_EXISTS });
    }

    const emailChanged = email !== user.email;
    if (emailChanged) {
      const waitSeconds = await otpCooldownRemaining(user.id, 'VERIFY_EMAIL');
      if (waitSeconds > 0) {
        return res.status(429).json({
          success: false,
          message: MESSAGES.OTP_COOLDOWN(waitSeconds),
          data: { retryAfter: waitSeconds },
        });
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name,
        email,
        phone: phone || null,
        role: ACCOUNT_TYPE_TO_ROLE[accountType],
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
        ...(emailChanged ? { emailVerifiedAt: null } : {}),
      },
    });

    // issueOtp cancels every earlier code, so the code sent to the old address stops working
    if (emailChanged) await issueOtp(updated, 'VERIFY_EMAIL');
    setPendingSignupCookie(res, updated.id);

    return res.status(200).json({
      success: true,
      requiresOtp: true,
      message: emailChanged
        ? `We sent a new 6-digit verification code to ${updated.email}.`
        : `Your details were updated. Enter the code sent to ${updated.email}.`,
      data: { email: updated.email, emailChanged, ...(await getOtpTiming(updated.id, 'VERIFY_EMAIL')) },
    });
  } catch (error) {
    // A concurrent signup took the email or phone between the check and the update
    if (error?.code === 'P2002') {
      const target = String(error.meta?.target || '');
      return res.status(409).json({ success: false, message: target.includes('phone') ? PHONE_EXISTS : MESSAGES.EMAIL_EXISTS });
    }
    return handleError(res, error, 'Signup update');
  }
};

/**
 * POST /api/auth/verify-otp — verifies the email and starts a session
 */
export const verifyOtp = async (req, res) => {
  try {
    const { email, code } = verifyOtpSchema.parse(withCodeAlias(req.body));

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && isBlocked(user)) return suspendedResponse(res);

    const result = await consumeOtp(user?.id, 'VERIFY_EMAIL', code);
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt || new Date(),
        ...(user.status === 'PENDING_VERIFICATION' ? { status: 'ACTIVE' } : {}),
      },
    });

    trackLogin(req, user.id, 'EMAIL_OTP_VERIFIED', user.email);
    clearPendingSignupCookie(res);
    const session = await startSession(res, user.id);
    return res.status(200).json({ success: true, message: 'Email verified successfully.', data: session });
  } catch (error) {
    return handleError(res, error, 'Verification');
  }
};

/**
 * POST /api/auth/resend-otp
 */
export const resendOtp = async (req, res) => {
  try {
    const { email, purpose } = resendOtpSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    // Verification codes only go to unverified accounts, reset codes to any non-blocked account.
    // Everyone else gets the same generic answer so the endpoint does not reveal which emails exist.
    const eligible = user && !isBlocked(user) && (purpose === 'RESET_PASSWORD' || user.status === 'PENDING_VERIFICATION');
    if (eligible) {
      const waitSeconds = await otpCooldownRemaining(user.id, purpose);
      if (waitSeconds > 0) {
        return res.status(429).json({
          success: false,
          message: MESSAGES.OTP_COOLDOWN(waitSeconds),
          data: { retryAfter: waitSeconds },
        });
      }
      await issueOtp(user, purpose);
    }

    return res.status(200).json({
      success: true,
      message: MESSAGES.FORGOT_PASSWORD_SENT,
      data: { retryAfter: OTP_RESEND_COOLDOWN_MS / 1000 },
    });
  } catch (error) {
    return handleError(res, error, 'Resend code');
  }
};

/**
 * POST /api/auth/login
 */
export const login = async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    // Same response for unknown email and wrong password
    const isMatch = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!isMatch) {
      return res.status(401).json({ success: false, message: MESSAGES.INVALID_CREDENTIALS });
    }

    if (isBlocked(user)) return suspendedResponse(res);

    // Unverified email: send a fresh code (unless one was just sent) and send the user to /verify
    if (user.status === 'PENDING_VERIFICATION') {
      if ((await otpCooldownRemaining(user.id, 'VERIFY_EMAIL')) === 0) {
        await issueOtp(user, 'VERIFY_EMAIL');
      }
      // The password was correct, so this browser may correct the pending signup
      setPendingSignupCookie(res, user.id);
      return res.status(403).json({
        success: false,
        needsVerification: true,
        message: `Please verify your email first. We've sent a 6-digit code to ${user.email}.`,
        data: { email: user.email },
      });
    }

    trackLogin(req, user.id, 'PASSWORD', user.email);
    const session = await startSession(res, user.id);
    return res.status(200).json({ success: true, message: 'Logged in successfully.', data: session });
  } catch (error) {
    return handleError(res, error, 'Login');
  }
};

/**
 * POST /api/auth/refresh — rotates the refresh cookie and returns a new access token
 */
export const refresh = async (req, res) => {
  try {
    const userId = await rotateRefreshToken(req, res);
    if (!userId) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }

    const user = await buildAuthUser(userId);
    if (!user || isBlocked(user)) {
      await revokeAllRefreshTokens(userId);
      clearRefreshCookie(res);
      return user ? suspendedResponse(res) : res.status(401).json({ success: false, message: 'Session expired.' });
    }

    return res.status(200).json({ success: true, data: { user, token: signAccessToken(user) } });
  } catch (error) {
    return handleError(res, error, 'Refresh');
  }
};

/**
 * POST /api/auth/logout
 */
export const logout = async (req, res) => {
  try {
    await revokeRefreshToken(readRefreshCookie(req));
    clearRefreshCookie(res);
    return res.status(204).end();
  } catch (error) {
    return handleError(res, error, 'Logout');
  }
};

/**
 * POST /api/auth/forgot-password — always answers with the same generic message
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && !isBlocked(user) && (await otpCooldownRemaining(user.id, 'RESET_PASSWORD')) === 0) {
      await issueOtp(user, 'RESET_PASSWORD');
    }

    return res.status(200).json({ success: true, message: MESSAGES.FORGOT_PASSWORD_SENT });
  } catch (error) {
    return handleError(res, error, 'Forgot password');
  }
};

/**
 * POST /api/auth/reset-password
 */
export const resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = resetPasswordSchema.parse(withCodeAlias(req.body));
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && isBlocked(user)) return suspendedResponse(res);

    const result = await consumeOtp(user?.id, 'RESET_PASSWORD', code);
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        // The code was delivered to this inbox, which also proves the email
        emailVerifiedAt: user.emailVerifiedAt || new Date(),
        ...(user.status === 'PENDING_VERIFICATION' ? { status: 'ACTIVE' } : {}),
      },
    });
    await revokeAllRefreshTokens(user.id);

    return res.status(200).json({ success: true, message: 'Your password has been reset. You can now log in.' });
  } catch (error) {
    return handleError(res, error, 'Reset password');
  }
};

// Returns the invite if its link is still usable; expired PENDING invites are marked EXPIRED
const findUsableInvite = async (rawToken) => {
  const invite = await prisma.staffInvite.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: {
      event: { select: { id: true, name: true, date: true, venue: true, city: true } },
      company: { select: { id: true, companyName: true } },
    },
  });
  if (!invite || invite.status !== 'PENDING') return null;
  if (invite.expiresAt < new Date()) {
    await prisma.staffInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    return null;
  }
  return invite;
};

/**
 * GET /api/auth/invite/:token
 */
export const getInvite = async (req, res) => {
  try {
    const invite = await findUsableInvite(req.params.token);
    if (!invite) {
      return res.status(410).json({ success: false, code: 'INVITE_INVALID', message: MESSAGES.INVITE_INVALID });
    }
    return res.status(200).json({
      success: true,
      data: {
        email: invite.email,
        eventName: invite.event.name,
        eventDate: invite.event.date,
        venue: `${invite.event.venue}, ${invite.event.city}`,
        companyName: invite.company.companyName,
      },
    });
  } catch (error) {
    return handleError(res, error, 'Invite lookup');
  }
};

/**
 * POST /api/auth/accept-invite — creates the gate staff account and starts a session
 */
export const acceptInvite = async (req, res) => {
  try {
    const { token, name, password } = acceptInviteSchema.parse(req.body);
    const invite = await findUsableInvite(token);
    if (!invite) {
      return res.status(410).json({ success: false, code: 'INVITE_INVALID', message: MESSAGES.INVITE_INVALID });
    }

    if (await prisma.user.findUnique({ where: { email: invite.email } })) {
      return res.status(409).json({ success: false, message: MESSAGES.INVITE_EMAIL_TAKEN });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const staff = await prisma.$transaction(async (tx) => {
      // Single use: only one request can move the invite out of PENDING
      const { count } = await tx.staffInvite.updateMany({
        where: { id: invite.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      if (count === 0) return null;

      const created = await tx.user.create({
        data: {
          name,
          email: invite.email,
          passwordHash,
          role: 'GATE_STAFF',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          companyId: invite.companyId,
        },
      });
      await tx.staffEventAssignment.create({
        data: { staffId: created.id, eventId: invite.eventId, assignedById: invite.invitedById },
      });
      return created;
    });

    if (!staff) {
      return res.status(410).json({ success: false, code: 'INVITE_INVALID', message: MESSAGES.INVITE_INVALID });
    }

    trackLogin(req, staff.id, 'STAFF_INVITE_ACCEPTED', staff.email);
    const session = await startSession(res, staff.id);
    return res.status(201).json({ success: true, message: 'Your gate staff account is ready.', data: session });
  } catch (error) {
    return handleError(res, error, 'Accept invite');
  }
};

/**
 * GET /api/auth/me
 */
export const getMe = async (req, res) => {
  try {
    const user = await buildAuthUser(req.user.id);
    return res.status(200).json({ success: true, data: { user } });
  } catch (error) {
    return handleError(res, error, 'Profile');
  }
};
