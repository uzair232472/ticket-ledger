# Function catalogue — API core (startup, config, middleware, utilities)

[← Function catalogue index](README.md) · Related: [Architecture & startup](../01-architecture.md) · [Shared code](../08-shared-code.md)

This page covers the files that every API request passes through: the process entry point, the Express app, configuration modules, middleware and small utilities. Each entry uses the same layout:

- **Where** — exact file and line.
- **Trigger** — what calls it (route registration, import side effect, another function).
- **In → Out** — parameters and return value.
- **Steps** — what it does, in order.
- **Side effects / data** — database, Redis, files, sockets, globals.
- **Failure** — early returns, error responses, exceptions.
- **Used by** — known callers (verified with a repository search unless marked *inferred*).

---

## `apps/api/src/server.js` — process entry point

<a id="api-server-startserver"></a>
### `startServer()` (+ module top-level code)

- **Where:** `apps/api/src/server.js:46` (function), top-level code `:1-44`, `:56-70`.
- **Trigger:** `npm run dev` (`node --watch src/server.js`) or `npm start` in `apps/api` (`package.json` `scripts`). Runs at import unless `NODE_ENV === 'test'` (`:66`).
- **In → Out:** no parameters; returns a Promise that resolves after `server.listen` is called.
- **Steps (module load order):**
  1. Imports `app` from `./app.js`. Importing `app.js` runs `dotenv.config()` and registers every route (see [`app.js`](#api-app)). Because ES module imports are evaluated before the importing module's body, config modules that read `process.env` *at import time* see the environment before `dotenv` runs — this is why `config/auth.js`, `config/cors.js` and `emailService.js` read env lazily (comments at `config/auth.js:2`, `config/cors.js:4`).
  2. `http.createServer(app)` wraps Express in a Node HTTP server (`:10`).
  3. Creates a Socket.IO `Server` on the same HTTP server with CORS `origin: corsOrigin` and `credentials: true` (`:13-19`), then stores it with `setIO(io)` so controllers can emit without importing `server.js` (avoids a circular import).
  4. Registers the socket `connection` handler (inline callback, `:22-43`):
     - `join_user_room(userId)` → `socket.join('user_' + userId)` if `userId` is truthy. **No authentication** — any client may join any user's room by sending that id (observed; security implication noted in [state & realtime](../09-state-realtime-config.md#3-socketio-events)).
     - `join_event_room(eventId)` → joins `event_<id>` if `eventId` is a string under 64 characters.
     - `leave_event_room(eventId)` → leaves `event_<id>`.
     - `disconnect` → logs.
  5. `startServer()` awaits `connectRedis()` (never throws — it falls back to in-memory locks) and then `server.listen(PORT)` with `PORT = process.env.PORT || 5000`.
  6. Process guards: `unhandledRejection` and `uncaughtException` only log (`:57-63`). The process keeps running after an uncaught exception.
- **Side effects:** opens the HTTP port, Redis connection attempt, Socket.IO server.
- **Failure:** Redis down → warning, server still starts. Port in use → Node throws `EADDRINUSE` (logged by the `uncaughtException` guard).
- **Exports:** `io`, `server` (used by nothing else in the repo except possibly tests — repository search finds no `import { io }` in `src`; controllers use `getIO()` instead).

---

<a id="api-app"></a>
## `apps/api/src/app.js` — Express application

The module body (no named functions besides inline handlers) builds the app in this order:

| Order | Line | What is registered | Notes |
|---|---|---|---|
| 1 | `:27` | `dotenv.config()` | Loads `apps/api/.env` relative to the working directory. |
| 2 | `:32-35` | `cors({ origin: corsOrigin, credentials: true })` | See [`corsOrigin`](#api-config-corsorigin). |
| 3 | `:37` | `/api/venues` → `express.json({ limit: '2mb' })` | Venue plans are large JSON documents. Registered **before** the global parser so it wins for this prefix. |
| 4 | `:38-39` | `express.json()` (100 kb default), `express.urlencoded` | |
| 5 | `:41-43` | `morgan('dev')` unless `NODE_ENV=test` | Request logging. |
| 6 | `:46` | `GET /api/health` inline handler | Returns `{status:'ok', services:{api, redis, environment}}`; `redis` reads the live `redisConnected` binding. |
| 7 | `:61` | `/uploads` → `express.static('uploads')` | Serves files written by [`uploadFile`](#api-utils-uploadfile) local fallback. Path is relative to the process working directory (`apps/api`). |
| 8 | `:64-83` | 19 routers (`/api/auth`, `/api/users`, … `/api/admin`, `/api/organizer`) | `/api/organizer` re-mounts **the same** `adminRoutes` router, so every admin path also exists under `/api/organizer/*` (guards still apply). |
| 9 | `:86` | `GET /` inline handler | Static welcome JSON. |
| 10 | `:97` | 404 handler | `{success:false, message:'API endpoint … not found'}`. |
| 11 | `:105` | Error handler `(err, req, res, next)` | Uses `err.status` or 500. Only reached when a handler calls `next(err)` or throws synchronously; most controllers catch their own errors. |

Inline handlers in this file: the health handler, the root handler, the 404 handler and the error handler — all documented in the table above.

---

## `apps/api/src/config/` — configuration modules

<a id="api-config-getjwtsecret"></a>
### `getJwtSecret()` — `config/auth.js:6`
- **Trigger:** every JWT sign/verify (`tokenService.signAccessToken`, `verifyAccessToken`, pending-signup cookie helpers) and OTP hashing (`otpService.hashCode`), and QR fallback secrets (see `qrTicketService`).
- **In → Out:** none → string secret.
- **Steps:** returns `process.env.JWT_SECRET` if set; otherwise throws in production; otherwise returns the hard-coded development secret `DEV_JWT_SECRET`.
- **Failure:** throws `Error('JWT_SECRET must be set in production.')` when `NODE_ENV=production` and the variable is missing.
- **Constants in the same file:** `ACCESS_TOKEN_TTL='15m'`, `REFRESH_TOKEN_TTL_MS=7 days`, `SESSION_IDLE_TIMEOUT_MS=30 min`, `REFRESH_COOKIE_NAME='tl_refresh'`, `OTP_TTL_MS=10 min`, `OTP_MAX_ATTEMPTS=5`, `OTP_RESEND_COOLDOWN_MS=60 s`, `INVITE_TTL_MS=72 h`, `BLOCKED_STATUSES` (`SUSPENDED, BANNED, DEACTIVATED, FROZEN, BLACKLISTED`) and `MESSAGES` (user-facing strings; `OTP_INCORRECT(left)` and `OTP_COOLDOWN(seconds)` are small formatter functions).

<a id="api-config-corsorigin"></a>
### `corsOrigin(origin, callback)` — `config/cors.js:7`
- **Trigger:** called by the `cors` middleware on every request (`app.js:33`) and by Socket.IO's CORS check (`server.js:15`).
- **In → Out:** request `Origin` header (or `undefined`), Node-style callback → calls `callback(null, true|false)`.
- **Steps:** (1) no Origin (curl, same-origin, mobile) → allow. (2) Split `FRONTEND_URL` on commas, trim, drop trailing `/`. (3) Allow when the origin is in that list, or when not in production and it matches `http(s)://localhost|127.0.0.1(:port)`. (4) Otherwise `callback(null, false)` — CORS headers are omitted so the browser blocks the response, rather than the server returning 500.

### `EVENT_IMAGE_SPECS`, `LARGEST_IMAGE_BYTES` — `config/eventMedia.js`
Data only (no functions besides a `Math.max` expression). Per placement (`card`, `banner`, `galleryWide`, `gallery`, `venuePlan`) it defines target aspect ratio, recommended/minimum pixel size, max bytes and max count. `RATIO_TOLERANCE=0.1`, `MAX_DIMENSION=8000`, `MAX_PIXELS=40,000,000`. Mirrored by `apps/web/src/utils/eventImageSpecs.js` (must be kept in sync manually — comment at `:3`). Used by `eventMediaService`, `eventRoutes` (multer limits) and `venueRoutes`.

### `OFFICIAL_EMAIL` — `config/brand.js:2`
Constant `'ticketledger00@gmail.com'`; default mail sender (`emailService.MAIL_FROM`) and contact-form destination.

<a id="api-config-prisma"></a>
### Prisma client with notification-email extension — `config/prisma.js`

Exports a **single shared Prisma client** (`default export prisma`) used by every controller and service.

| Symbol | Line | What it does |
|---|---|---|
| `FRONTEND()` | `:4` | Returns `FRONTEND_URL` or `http://localhost:5173`. |
| `ACTIONS` | `:7` | Ordered list of `[regex, buttonLabel, path]` that maps a notification `type` prefix to the button in its email (e.g. `RESALE*` → `/resale`). |
| `actionFor(type)` | `:15` | First matching `ACTIONS` entry → `{label, url}`; default "Open your notifications" → `/notifications`. |
| base client | `:22-28` | `new PrismaClient({log})` inside `try`; failure only logs a warning (then `prisma` is `undefined` and every DB call will throw). |
| <a id="api-config-emailnotifications"></a>`emailNotifications(rows)` | `:36` | See below. |
| `prisma = base.$extends({query:{notification:{create, createMany}}})` | `:64` | Wraps two Prisma operations on the `Notification` model. |

**`emailNotifications(rows)`** — `config/prisma.js:36`
- **Trigger:** automatically after **every** `prisma.notification.create` / `createMany` anywhere in the API (the `$extends` query hooks at `:67-77`). Features never send notification mail themselves; this hook does it.
- **In:** one row or an array of rows `{userId, type, title, message}`.
- **Steps:** (1) Keep rows with `userId` and `title`. (2) `setImmediate(async …)` — runs **after** the current request continues, so it never delays or fails the HTTP response. (3) Loads the users' `email` and `emailNotifications` flag in one query. (4) For each row whose user has an email and has not turned email notifications off, calls [`sendEmailNotification`](api-notifications-email.md#api-email-sendemailnotification) with HTML-escaped title/message and `actionFor(type)` as the button. (5) Per-email failures and the whole block's failure only log warnings.
- **Note:** `createMany` passes `args.data` (the input rows), so rows are emailed even though `createMany` does not return them.

<a id="api-config-redis"></a>
### Redis connection and seat-lock store — `config/redis.js`

| Symbol | Line | Behaviour |
|---|---|---|
| `redis` | `:7` | `ioredis` client for `REDIS_URL` (default `redis://localhost:6379`), `lazyConnect: true`, `maxRetriesPerRequest: 1`, `retryStrategy` gives up after 3 retries (200/400/600 ms). |
| `redisConnected` | `:5` | Exported **live binding**; set `true` on the `connect` event (`:18`), `false` on `error` (`:23`). |
| `connectRedis()` | `:27` | Awaits `redis.connect()`; on failure sets `redisConnected=false` and logs "Using atomic in-memory lock store with TTL". Never throws. Called once by `startServer()`. |
| `inMemoryLocks` | `:37` | Process-local `Map<lockKey,{userId, expiresAt}>` used when Redis is unavailable. Lost on restart; not shared across multiple API processes. |

<a id="api-redis-acquireseatlock"></a>
**`acquireSeatLock(seatId, userId, ttlSeconds = 600)`** — `config/redis.js:43`
- **Key:** `seat:lock:<seatId>`; value = `userId`; expiry = `ttlSeconds` (default 10 minutes).
- **Steps:** If Redis is connected: `SET key userId NX EX ttl` and return `result === 'OK'` (atomic: only one caller can create the key). On Redis error, fall through to memory. Memory path: if an unexpired entry exists → same user refreshes `expiresAt` and returns `true`; another user returns `false`; otherwise store a new entry and return `true`.
- **Behaviour difference (observed):** with Redis, the **same user** re-locking a seat they already hold gets `false` (NX fails); with the in-memory fallback they get `true` and the TTL is extended.
- **Used by:** only [`seatController.lockSeat`](api-venues-seats.md#api-seat-lockseat) (`seatController.js:194`). `releaseSeatLock` is also called by `seatController` (`:213`, `:323`) and `bookingController` (`:476`, `:636`); `checkSeatLock` by `seatController` (`:196`) and `bookingController.initiateBooking` (`:155`). The newer venue **holds** (`venueService`) do **not** use these helpers — they lock seats in PostgreSQL instead (see [Seat locking & holds](../02-modules/seat-locking-holds.md)).

**`releaseSeatLock(seatId, userId)`** — `config/redis.js:79`
- Deletes the key only when `userId` is falsy (forced release) or matches the holder. Returns `true` when released or nothing was held, `false` when another user holds it.

**`checkSeatLock(seatId)`** — `config/redis.js:109`
- Returns `{locked:true, userId, ttl}` (TTL in seconds from `redis.ttl`, clamped ≥ 0) or `{locked:false}`; memory path computes TTL from `expiresAt`.

### `setIO(io)` / `getIO()` — `config/socket.js:3`, `:7`
Module-level holder for the Socket.IO server. `setIO` is called once in `server.js:20`. `getIO()` returns the instance or `null` (e.g. when a script or test imports a controller without starting the server); callers: `bookingController` (`:474`, `:634`), `seatController` (`:223`, `:327`), `staffController` (`:382`, optional chaining), `checkinService` (`:136`, `:227`), `notificationService` (`:74`), `venueService` (`:24`, `:571`).

---

## `apps/api/src/middlewares/`

<a id="api-mw-authenticatejwt"></a>
### `authenticateJWT(req, res, next)` (alias `requireAuth`) — `middlewares/auth.js:27`
- **Trigger:** registered on most protected routes (e.g. `router.use(requireAuth)` in `bookingRoutes.js:14`, `ticketRoutes.js:21`, `notificationRoutes.js:19`; per-route in `eventRoutes`, `adminRoutes`, etc.). See the [API catalogue](../06-api-catalogue.md) for the exact list.
- **In → Out:** request with `Authorization: Bearer <access JWT>` → sets `req.user` and calls `next()`, or sends an error response.
- **Steps:**
  1. `readBearer(req)` (`:17`) extracts the token after `Bearer `; missing → **401** "Missing or malformed authentication token".
  2. [`verifyAccessToken`](api-auth-accounts.md#api-token-verifyaccesstoken) checks signature, expiry and `typ === 'access'`.
  3. Loads the user **from the database on every request** with `USER_SELECT` (`id, email, name, phone, role, status, walletAddress, companyId, emailVerifiedAt`). Missing user → **401**.
  4. `status` in `BLOCKED_STATUSES` → **403** `{code:'ACCOUNT_SUSPENDED'}` (the web client redirects to `/suspended`, see [`installAxiosInterceptor`](web-core.md#web-session-interceptors)).
  5. `status === 'PENDING_VERIFICATION'` → **403** `{needsVerification:true}`.
  6. Sets `req.user` and continues.
- **Failure:** `TokenExpiredError` → **401** `{code:'TOKEN_EXPIRED'}` (this exact code triggers the web client's silent refresh-and-retry); any other JWT error → **401** "Invalid authentication token".
- **Why the DB read:** the comment at `:24-25` says a ban must take effect immediately even though access tokens live 15 minutes.

### `requireRole(...roles)` — `middlewares/auth.js:54`
- **Trigger:** route registration, always after `authenticateJWT`. Accepts either a list (`requireRole('A','B')`) or an array (`requireRole(['A','B'])`) — `roles.flat()` at `:55`.
- **Returns:** a middleware that sends **401** if `req.user` is missing, **403** "Role 'X' lacks permission… Required: …" if `req.user.role` is not allowed, else `next()`.

### `requireApprovedCompany(req, res, next)` — `middlewares/auth.js:82`
- Loads `Company` by `userId = req.user.id`; if missing or not `APPROVED` → **403** with `code` `COMPANY_NOT_REGISTERED` or `COMPANY_NOT_APPROVED` and `companyStatus`. Sets `req.company`.
- **Used by:** re-exported as `requireApprovedOrganizer` from `companyController.js:317` (`export const requireApprovedOrganizer = requireApprovedCompany`), which is what the routes import: `POST /api/events` (`eventRoutes.js:69`) and `GET /api/companies/guard-check` (`companyRoutes.js:34`). The middleware itself does not check the role, so it must follow `requireRole('ORGANIZER', …)`; a Super Admin without a company is refused by it (comment `:79-80`).

### `optionalAuth(req, res, next)` — `middlewares/auth.js:105`
- If a Bearer token is present and valid and the user is `ACTIVE`, sets `req.user`; **all errors are swallowed** and the request continues as a guest. Never responds itself.
- **Used by:** `GET /api/events`, `GET /api/events/:id`, `GET /api/resale/market`, `POST /api/behavior/track`, `POST /api/contact`, `GET /api/venues/event/:eventId`.
- **Related local variants:** `mlRoutes.js:17` and `seatRoutes.js:13` define their own inline "optional" middleware that calls `authenticateJWT` when a Bearer header exists — unlike `optionalAuth`, an *invalid or expired* token there produces a 401 instead of guest access.

### Rate limiters — `middlewares/rateLimit.js`
| Export | Window | Limit | Applied to |
|---|---|---|---|
| `authRateLimiter` | 60 s | `AUTH_RATE_LIMIT_MAX` or 5 in production / 200 otherwise | `/signup`, `/login`, `PATCH /pending-signup`, `/resend-otp`, `/forgot-password`, legacy `/register`, `/otp/send`; `PUT /api/users/password` |
| `codeCheckRateLimiter` | 60 s | `max(20, AUTH_RATE_LIMIT_MAX)` | `GET /pending-signup`, `/verify-otp`, `/reset-password`, `GET /invite/:token`, `/accept-invite`, legacy `/otp/verify` |
| `contactRateLimiter` | 10 min | 5 in production / 100 otherwise | `POST /api/contact` |

Helpers: `isTestRun()` (`:6`) skips limiting when `NODE_ENV=test` or `NODE_TEST_CONTEXT` is set (Node's test runner); `tooManyRequests(req,res)` (`:8`) sends **429** `{success:false, message:'Too many requests…'}`. Counters are in the default **in-memory** store of `express-rate-limit` (per process, reset on restart).

---

## `apps/api/src/utils/`

<a id="api-utils-canmanageevent"></a>
### `canManageEvent(user, event, { requireApproved = false })` — `utils/eventAccess.js:7`
- **Returns** `true` for `SUPER_ADMIN`; otherwise loads the user's owned company and returns `true` only if `company.id === event.companyId` and (when `requireApproved`) `company.status === 'APPROVED'`. No user → `false`.
- **Used by:** `eventController` (`getEventForEdit`, `updateEvent`, `deleteEvent`), `eventReviewController`, `venueController` (organizer endpoints). See those catalogue pages.

<a id="api-utils-inspectimage"></a>
### `inspectImage(buffer)` and helpers — `utils/imageInspect.js`
- **Purpose:** determine the *real* image type and pixel size from file bytes, never trusting the file name or browser MIME type.
- `inspectPng(buf)` (`:13`): checks the 8-byte PNG signature and `IHDR` chunk; width/height are big-endian uint32 at bytes 16 and 20.
- `inspectJpeg(buf)` (`:21`): walks JPEG markers from byte 2; skips fill bytes; stops at EOI/SOS; returns the first SOF0–SOF15 frame size (excluding DHT `C4`, JPG `C8`, DAC `CC`).
- `inspectWebp(buf)` (`:39`): checks `RIFF…WEBP`; supports lossy `VP8 ` (14-bit dims at byte 26/28), lossless `VP8L` (packed 14-bit dims +1), extended `VP8X` (24-bit dims +1).
- `inspectImage(buffer)` (`:60`): returns `{format, width, height, mime, ext}` or `null` (not a Buffer, unsupported format or truncated header).
- **Used by:** `eventMediaService.validateEventImage` (event images) and `venueController.uploadPlanImage` (venue plan background).

<a id="api-utils-uploadfile"></a>
### `uploadFile(file, folder = 'company_docs', options = {})` — `utils/storage.js:31`
- **Trigger:** company document upload (`companyController.registerCompany`), event media (`eventMediaService`), venue plan image (`venueController.uploadPlanImage`).
- **In → Out:** a multer file (`buffer` or `path`), destination folder, optional `{extension}` → `{url, publicId, provider}`.
- **Steps:**
  1. Throws `Error('No file provided for upload.')` if `file` is falsy.
  2. If Cloudinary is configured — all three `CLOUDINARY_*` variables set and not the placeholder values `mock_key` / `mock_secret` (evaluated **once at import**, `:6-11`) — streams the buffer to `ticketledger/<folder>` with `resource_type:'auto'` and returns `secure_url`. Cloudinary errors are caught and logged, then the local fallback runs.
  3. Local fallback: creates `uploads/<folder>/` (relative to the working directory), names the file `<timestamp>_<6 random chars><ext>` where `ext` is `options.extension`, else the original file extension, else `.pdf`; writes the buffer (or copies `file.path`; or writes a placeholder text file when neither exists). Returns `url: '/uploads/<folder>/<file>'`, `provider: 'local_storage'`.
- **Side effects:** files under `apps/api/uploads/` (this folder is currently **untracked** in git — see the [coverage page](../12-coverage.md#repository-revision)).
- **Note:** because `isCloudinaryConfigured` is computed when the module is first imported, and `app.js` calls `dotenv.config()` only in its body, the result depends on import order; with the shipped `.env.example` values (`mock_key`) local storage is always used.
