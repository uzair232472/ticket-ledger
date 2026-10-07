# State, realtime, scheduled work, integrations & configuration

[← Start here](README.md) · Related: [architecture](01-architecture.md) · [database](07-database.md) · [shared code](08-shared-code.md)

## 1. Frontend state

| State | Where it lives | Lifetime | Source of truth |
|---|---|---|---|
| Signed-in user, access token | `AuthContext` React state + `lib/session.js` module variable | Until reload/sign-out (restored from cookie on load) | API (`buildAuthUser`) |
| Refresh token | httpOnly cookie `tl_refresh` (path `/api/auth`, 7 days) | Rotated on each refresh | `RefreshToken` table |
| Pending signup | httpOnly cookie `tl_pending_signup` (24 h) + `sessionStorage.tl_pending_email` | Until verified | `User` (PENDING_VERIFICATION) |
| Wishlist ids | `WishlistContext` | Per user session | `WishlistItem` |
| Holds / cart | `HoldBar`, `useCartHolds`, `VenueBooking` local state | Polled (20–30 s), on focus, on `tl:holds-changed` | `Seat` lock columns |
| Page data | Component state (no global store such as Redux) | Per page | API |
| Behaviour session id | `localStorage.tl_session_id` | Persistent | — |
| Scanner offline data | IndexedDB `tl-gate` | Until wiped/replaced | Pack from API |
| UI conveniences | sessionStorage/localStorage keys listed in [frontend shell](02-modules/frontend-shell.md#browser-storage-keys) | — | — |

**Authentication state machine (web):** `loading` (startup refresh in flight) → `signed out` | `signed in` → (token near expiry) refresh → (refresh fails) `signed out` → (`ACCOUNT_SUSPENDED`) `/suspended`. Idle 30 min → sign-out with notice.

## 2. Redis

| Key | Value | Expiry | Purpose |
|---|---|---|---|
| `seat:lock:<seatId>` | user id | 600 s | First-stage lock for the **legacy** per-seat flow (`/api/seats/lock`); booking accepts a Redis-held seat as "locked by me" |

No other Redis keys exist. The rate limiter, FCM token registry and in-memory lock fallback all use **process memory**, not Redis (lost on restart; not shared across instances). Connection: `REDIS_URL`, lazy connect at startup, gives up after 3 retries; `/api/health` reports `redis: connected | offline/awaiting_docker`.

## 3. Socket.IO events

Server: `apps/api/src/server.js` (same port as HTTP, CORS = `corsOrigin`). **Rooms are joined on request without authentication.**

| Direction | Event | Payload | Room / audience | Emitter → Listener |
|---|---|---|---|---|
| client → server | `join_user_room` | `userId` | joins `user_<userId>` | wallet, scanner, organizer dashboard, (NotificationBell) |
| client → server | `join_event_room` / `leave_event_room` | `eventId` (string < 64) | `event_<eventId>` | GateScanner |
| server → all | `seat:status_change` | `{eventId, seatId, key, sectionKey, section, row, seatNumber, status, lockedUntil, lockedByUserId}` | broadcast (clients filter by `eventId`) | `seatController.lockSeat/unlockSeat`, `bookingController.confirm/cancel` → `VenueBooking`, `LegacySeatMap` |
| server → all | `seat:status_batch` | `{eventId, seats:[{seatId, key, sectionKey, status, lockedUntil, lockedByUserId}]}` | broadcast | `venueService.emitSeatChanges` → `VenueBooking` |
| server → all | `venue:published` | `{eventId, version}` | broadcast | `publishDraft` → `VenueBooking` (reload) |
| server → user | `ticket:checked-in` | `{ticketId, checkedInAt, gate}` | `user_<holder>` | `checkinService` → `DigitalWallet` |
| server → event + organizer | `checkin:stats` | `{eventId, sold, entered, remaining, gates, scans, conflicts}` | `event_<id>`, `user_<organizer>` | `checkinService.broadcast` → `GateScanner`, `OrganizerDashboard` |
| server → user | `staff:access-revoked` | `{eventId}` | `user_<staff>` | `staffController.revokeEventAccess` → `GateScanner` |
| server → user / all | `notification` / `notification_<userId>` | Notification row | `user_<id>` / broadcast | `dispatchNotification` → `NotificationBell` (unused) |

Note: seat broadcasts include `lockedByUserId` (user ids of holders) to every connected client.

## 4. Scheduled and background work

| Mechanism | What | Where |
|---|---|---|
| Lazy, request-triggered cleanup | Expire holds and fail stale checkouts | `venueService.expireStaleHolds` (called by plan load, holds, legacy map, initiate) |
| Lazy expiry | Staff invites `PENDING → EXPIRED` | `staffController.expireStaleInvites`, `authController.findUsableInvite` |
| Post-response task | Notification e-mails | `config/prisma.js` `setImmediate` |
| Fire-and-forget | Behaviour inserts | `behaviorService.trackBehavior` |
| Browser timers | token refresh, idle check (15 s), holds polling (20/30 s), notifications polling (60 s), scanner pack refresh (3 min) and sync (30 s), booking confirmation polling (3 s) | web |
| Cron / job queue / worker | **None** | — |

## 5. External integrations

| Integration | Used for | Configured by | Real or simulated |
|---|---|---|---|
| PostgreSQL | All data | `DATABASE_URL` | Real |
| Redis | Legacy seat locks | `REDIS_URL` | Real if running; memory fallback |
| SMTP (nodemailer) | OTP, invites, notifications, contact | `SMTP_*`, `MAIL_FROM`… | Real if configured; else in-memory JSON transport |
| Cloudinary | Uploads | `CLOUDINARY_*` | Real if non-placeholder keys; else local `uploads/` |
| Python ML service | Fraud/intent/demand | `ML_SERVICE_URL` | Real HTTP; Node fallbacks on any error |
| Polygon Amoy (ethers) | NFT mint | `POLYGON_AMOY_RPC`, `POLYGON_PRIVATE_KEY`, `TICKET_NFT_CONTRACT_ADDRESS`, `PLATFORM_CUSTODIAN_WALLET` | Simulated unless key set |
| Stripe (`stripe` Node SDK; `@stripe/stripe-js` + `@stripe/react-stripe-js` in the browser) | Card checkout: PaymentIntent create/retrieve on the API, `CardElement` + `confirmCardPayment` in the browser | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (API), `VITE_STRIPE_PUBLISHABLE_KEY` (web) | **Real (sandbox/test mode) if `STRIPE_SECRET_KEY` is set**; otherwise simulated. Server-side enforcement is incomplete ([gap](functions/api-booking-payment.md#stripe-verification-gap)) |
| JazzCash, EasyPaisa | Checkout | — | **Simulated only** |
| Local Hardhat node | Development minting (root `scripts/`) | `contracts/hardhat.config.cjs` network `localhost` (127.0.0.1:8545, chain 31337) | Real local chain when started by hand |
| Firebase Cloud Messaging | Push | — | **Mock** |
| OpenStreetMap Nominatim | Address search / reverse geocode | — (browser direct) | Real (public API) |
| MetaMask (`window.ethereum`) | Wallet address | — | Real in browser; no ownership proof |
| Google Fonts, Unsplash, Google Maps links | UI | — | Real (browser) |
| Hugging Face (dataset HEAD checks) | Nothing used | — | Informational requests in the data generator |

## 6. Configuration variables (names only — no values)

### API (`apps/api/.env`, template `.env.example`)
| Variable | Read by | Purpose |
|---|---|---|
| `PORT` | `server.js` | HTTP port (default 5000) |
| `NODE_ENV` | many | `production` enables strict secrets, secure cookies, strict rate limits; `test` disables listen/morgan/limits |
| `DATABASE_URL` | Prisma schema | PostgreSQL connection |
| `REDIS_URL` | `config/redis.js` | Redis connection |
| `JWT_SECRET` | `config/auth.js`, `qrTicketService` (legacy fallback) | Signs JWTs, HMACs OTPs; required in production |
| `COOKIE_SAMESITE` | `tokenService` | Cookie SameSite (`none` for cross-site, forces Secure) |
| `AUTH_RATE_LIMIT_MAX` | `rateLimit.js` | Auth requests/min/IP |
| `FRONTEND_URL` | CORS, e-mail links | Allowed origins (comma list); first entry used for links |
| `ML_SERVICE_URL` | `mlService` | Python service base URL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | `emailService` | Mail transport |
| `MAIL_FROM` / `FROM_EMAIL` / `EMAIL_FROM` | `emailService` | Sender |
| `SUPPORT_EMAIL` | `contactController` | Contact-form destination |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `storage.js` | Upload provider |
| `QR_SIGNING_PRIVATE_KEY` | `qrPassService` | Ed25519 PKCS#8 PEM; required in production (dev key auto-generated into `apps/api/.keys/`) |
| `QR_HMAC_SECRET` | `qrTicketService` | Legacy HMAC passes |
| `POLYGON_AMOY_RPC`, `POLYGON_PRIVATE_KEY`, `TICKET_NFT_CONTRACT_ADDRESS`, `PLATFORM_CUSTODIAN_WALLET` | `nftService`, `ticketController`, Hardhat config | On-chain minting |
| `STRIPE_SECRET_KEY` | `paymentService` (module load) | Enables the real Stripe client unless missing or containing `mock` (read since `2208b32`) |
| `STRIPE_PUBLISHABLE_KEY` | `paymentService` | Echoed to the client in `paymentParams` (the web app uses its own variable) |
| `ADMIN_PASSWORD` | `create-super-admin.mjs` | Script input |
| `NODE_TEST_CONTEXT` | set by `node --test` | Disables rate limits and real SMTP |
| **Listed in `.env.example` but never read** | — | `POLYGON_RPC_URL`, `NFT_CONTRACT_ADDRESS`, `MARKETPLACE_CONTRACT_ADDRESS`, `DEPLOYER_PRIVATE_KEY`, `JAZZCASH_MERCHANT_ID`, `JAZZCASH_PASSWORD`, `EASYPAISA_STORE_ID` |

### Web (`apps/web/.env`, template `.env.example`)
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base (22 references) |
| `VITE_SOCKET_URL` | Socket.IO URL (falls back to API URL) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe.js publishable key in `Checkout.jsx:16` (falls back to a hard-coded test publishable key) |
| `VITE_ML_SERVICE_URL`, `VITE_POLYGON_CHAIN_ID` | Defined but not read by source |

### Docker compose
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `REDIS_PORT` (defaults differ from `.env.example`'s `DATABASE_URL` credentials).

### ML service
No environment variables; paths are relative to `main.py`; port 8000 fixed in `__main__`.
