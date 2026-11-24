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

// Scanner device enrollment (issues device credentials): 10 per minute per signed-in user (IP when not signed in)
export const deviceEnrollRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Offline scan uploads and evidence hand-ins: 120 requests per minute per signed-in user (each carries up to 500 scans)
export const gateSyncRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 120 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Scanner traffic: scans, heartbeats, connection tests (600 per minute per user: a busy gate scans ~1 ticket / s)
export const gateDeviceRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 600 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Offline ticket-list downloads (every paid ticket of the event): 30 per minute per user
export const gatePackRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 30 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Step 6: legacy ML scoring endpoints (/api/ml/fraud/score, /intent/predict, /forecast/demand and aliases).
// SUPER_ADMIN only; 30 per minute per admin in production. `makeMlLegacyRateLimiter` exists so tests can check
// the limit itself (the exported limiter, like the others, is skipped in automated test runs).
export const ML_LEGACY_LIMIT = () => (process.env.NODE_ENV === 'production' ? 30 : 120);
export const makeMlLegacyRateLimiter = ({ limit = ML_LEGACY_LIMIT(), windowMs = 60 * 1000, skip = isTestRun } = {}) => rateLimit({
  windowMs,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});
export const mlLegacyRateLimiter = makeMlLegacyRateLimiter();

// Step 6: read-only AI insight / monitor endpoints (staff dashboards): 120 per minute per user in production
export const mlInsightsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 120 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Step 6: recommendation "rendered" / click beacons (public): 120 per minute per visitor in production
export const recBeaconRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 120 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Gate load plan (rebuilds the plan from every live ticket and past arrivals): 30 per minute per user in production
export const gatePlanRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 30 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Sending gate advice (a message and email to every ticket holder): 5 per 10 minutes per user in production.
// The job itself never sends the same advice twice; this only stops a manager from queueing runs in a loop.
export const gateNotifyRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 5 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});

// Super Admin behaviour report and customer timelines (aggregate the behaviour log): 20 per minute per admin
export const behaviourReportRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 20 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: tooManyRequests,
});
