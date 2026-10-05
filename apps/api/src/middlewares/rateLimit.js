import rateLimit from 'express-rate-limit';

// AUTH_RATE_LIMIT_MAX can raise the ceiling for local testing; limits are skipped in automated tests
// (NODE_ENV=test, or NODE_TEST_CONTEXT which `node --test` sets for test processes).
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX) || (process.env.NODE_ENV === 'production' ? 5 : 200);
const isTestRun = () => process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);

const tooManyRequests = (req, res) => {
  res.status(429).json({
    success: false,
    message: 'Too many requests. Please wait a minute and try again.',
  });
};

// /login, /signup, /resend-otp and /forgot-password: 5 requests per minute per IP
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  handler: tooManyRequests,
});

// Endpoints that check a code or token (verify-otp, reset-password, accept-invite). Each OTP already
// locks after 5 wrong attempts; this caps how many codes one IP can try across accounts.
export const codeCheckRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Math.max(20, AUTH_RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  handler: tooManyRequests,
});

// Contact form: 5 messages per 10 minutes per IP in production
export const contactRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 5 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  handler: tooManyRequests,
});
