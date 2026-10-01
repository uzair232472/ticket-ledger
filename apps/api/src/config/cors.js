// Allowed frontend origins. FRONTEND_URL may be a comma-separated list.
// In development any localhost / 127.0.0.1 port is also accepted, so Vite
// falling back to 5174, 5175... when 5173 is taken doesn't break the app.
// Env is read per call because ES module imports run before dotenv.config().
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const corsOrigin = (origin, callback) => {
  // Same-origin requests, curl, Postman, mobile apps send no Origin header
  if (!origin) return callback(null, true);

  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const isDev = process.env.NODE_ENV !== 'production';

  if (allowedOrigins.includes(origin) || (isDev && localhostPattern.test(origin))) {
    return callback(null, true);
  }
  // Omit CORS headers so the browser blocks it (instead of a 500 error)
  return callback(null, false);
};
