// Authentication settings shared by the auth controller, middleware and token service.
// Env is read lazily because ES module imports run before dotenv.config().

const DEV_JWT_SECRET = 'ticketledger_jwt_super_secret_key_2026_fyp';

export const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production.');
  }
  return DEV_JWT_SECRET;
};

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A session not refreshed for this long is over (inactivity sign-out). Active tabs refresh about every
// 14 minutes, well inside it; the web app also signs out after the same idle time on its side.
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const REFRESH_COOKIE_NAME = 'tl_refresh';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

// Accounts in these states cannot log in, and their existing sessions are rejected.
export const BLOCKED_STATUSES = ['SUSPENDED', 'BANNED', 'DEACTIVATED', 'FROZEN', 'BLACKLISTED'];

// User-facing wording from the Login & Signup brief, section 7
export const MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid email or password.',
  EMAIL_EXISTS: 'An account with this email already exists. Try logging in.',
  OTP_INCORRECT: (left) => `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`,
  OTP_EXPIRED: 'This code has expired. Please request a new one.',
  OTP_COOLDOWN: (seconds) => `Please wait ${seconds} seconds before requesting a new code.`,
  FORGOT_PASSWORD_SENT: "If an account exists for this email, we've sent a code.",
  ACCOUNT_SUSPENDED: 'Your account has been suspended. Contact support.',
  INVITE_INVALID: 'This invite link is no longer valid. Ask the organizer to send a new one.',
  INVITE_EMAIL_TAKEN: 'This email is already registered with another account type.',
  INVITE_NOT_OWN_EVENT: 'You can only invite staff for your own events.',
  COMPANY_NOT_APPROVED: 'Your company must be approved before you can create events.',
};

// Password rule for every place a password is set (sign-up, reset, staff invite, change password).
// Keep in sync with apps/web/src/lib/validation.js.
export const PASSWORD_RULES = [
  { test: (v) => v.length >= 8, message: 'Password must be at least 8 characters' },
  { test: (v) => /[A-Z]/.test(v), message: 'Password must contain at least 1 uppercase letter' },
  { test: (v) => /\d/.test(v), message: 'Password must contain at least 1 number' },
  { test: (v) => /[^A-Za-z0-9\s]/.test(v), message: 'Password must contain at least 1 special character (e.g. @ # $ % !)' },
];
/** Adds the password rules to a zod string schema. */
export const withPasswordRules = (schema) => PASSWORD_RULES.reduce((s, r) => s.refine(r.test, r.message), schema);
