# Glossary

[← Start here](README.md)

| Term | Meaning in this codebase |
|---|---|
| **Access token** | Short-lived (15 min) JWT sent as `Authorization: Bearer …`; kept only in browser memory. |
| **Adapter (venue)** | Object `{live, load, hold, release}` that lets `VenueBooking` work against the API (`liveAdapter`) or an in-memory preview (`previewAdapter`). |
| **Atomic update** | A single SQL statement that checks a condition and writes in one step, so concurrent requests cannot both succeed (e.g. `UPDATE … WHERE free RETURNING`). |
| **Audit log** | `AuditLog` row recording who did what (admin and security actions). |
| **bcrypt** | Slow password-hashing algorithm; passwords are stored only as bcrypt hashes. |
| **Behaviour event** | Row in `BehaviorEvent` describing a user action (view, seat selected…). |
| **Blocked status** | `SUSPENDED`, `BANNED`, `DEACTIVATED`, `FROZEN`, `BLACKLISTED`: the account cannot log in or use existing sessions. |
| **Calibrated classifier** | Wrapper that adjusts a model's raw scores so they behave like real probabilities. |
| **Cascade delete** | Database rule that deletes child rows when the parent is deleted. |
| **Checkout / order** | An `Order` created when the customer presses *Confirm order*; `PENDING` until paid, then `SUCCESSFUL` or `FAILED`. |
| **CheckIn** | Row for each gate scan in the current scanner (GREEN/YELLOW/RED). |
| **Company status** | Verification state of an organizer's company: `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`. |
| **CORS** | Browser rule controlling which websites may call the API; configured by `corsOrigin`. |
| **CSPRNG** | Cryptographically secure random number generator (`crypto.randomInt`, `randomBytes`). |
| **Custodian wallet** | Platform-owned address used as NFT recipient when the customer has no wallet linked. |
| **Draft (venue)** | Unpublished `VenueLayout` the organizer is editing; attendees still see the published version. |
| **Ed25519** | Public-key signature scheme used to sign gate passes; the gate holds only the public key. |
| **ERC-721 / NFT** | Ethereum token standard for unique items; the contract represents one ticket per token. |
| **Fire-and-forget** | Starting an async task without waiting for it (behaviour tracking). |
| **FREE_SQL** | SQL condition defining a seat that can be held: available, or a lapsed hold without a checkout ticket. |
| **GA (general admission)** | Section sold by quantity; stored as numbered `GA_SLOT` seats. |
| **Gradient boosting** | ML method that adds many small decision trees, each correcting the previous ones. |
| **Grace period** | 120 s after a hold expires during which an in-flight payment can still complete. |
| **Hold / lock** | Temporary 10-minute reservation of a seat by one user (`Seat.status = LOCKED`). |
| **HMAC** | Keyed hash used for OTP storage and legacy QR passes. |
| **httpOnly cookie** | Cookie JavaScript cannot read; used for the refresh token. |
| **IndexedDB** | Browser database used by the scanner for offline data. |
| **Interceptor** | Code that runs on every axios/fetch request/response (adds headers, refreshes expired tokens). |
| **JWT** | JSON Web Token: signed JSON with claims (`userId`, `role`, `typ`, `exp`). |
| **joblib** | Python library used to save/load trained models. |
| **Layout key** | Stable seat id inside a plan: `<sectionId>/<row>/<number>` (tables: `<sectionId>/Table N/<chair>`, GA: `<sectionId>/GA/<n>`). |
| **Lazy expiry** | Expired data is cleaned up when it is next accessed rather than by a timer. |
| **Legacy grid** | Old seat creation (`generate-grid`) with rows A, B, C… and no `layoutKey`. |
| **Manual code** | `TL-XXXX-XXXX` code printed under the QR for typing at the gate. |
| **Middleware** | Express function that runs before the handler (auth, roles, upload parsing, rate limit). |
| **Monorepo / workspace** | One repository with several packages managed together by npm workspaces. |
| **multer** | Express middleware for multipart file uploads (memory storage here). |
| **Offline pack** | Event data (public key + paid tickets) downloaded by the scanner for offline use. |
| **One-hot encoding** | Turning a category (e.g. city) into 0/1 columns for an ML model. |
| **OTP** | One-time password: 6-digit code e-mailed for verification or password reset. |
| **Optimistic update** | UI shows the change immediately and reverts if the server fails (wishlist hearts). |
| **PaymentIntent** | Stripe object representing one card payment; created by the API (`paymentIntents.create`), confirmed in the browser with Stripe.js, and later retrieved to check `status === 'succeeded'`. |
| **Placeholder ticket** | `Ticket` created at checkout start, valid only once the order is `SUCCESSFUL`. |
| **Prisma** | ORM generating a typed database client from `schema.prisma`. |
| **Protected seat** | Seat that is sold, in a checkout or held; publishing may not change it. |
| **qrVersion** | Counter on `Ticket` incremented on transfer/resale; part of the signed pass, so old QRs fail. |
| **Random forest** | ML method where many decision trees vote. |
| **Refresh token** | Long-lived (7 days) random token in an httpOnly cookie, rotated on each use, stored hashed. |
| **Rotation / reuse detection** | Each refresh replaces the token; presenting an old one later revokes all sessions. |
| **Room (Socket.IO)** | Named group of sockets (`user_<id>`, `event_<id>`) for targeted events. |
| **Scope (events)** | Event ids a user may operate on (`getScopedEventIds`). |
| **Sandbox / test mode (Stripe)** | Stripe environment using test keys and test cards (e.g. 4242 4242 4242 4242); no real money moves. |
| **Section** | Drawn area of a venue plan: seats, tables or GA. |
| **Single-flight** | Concurrent callers share one in-progress request (token refresh). |
| **SKIP LOCKED** | PostgreSQL option to skip rows locked by other transactions (GA allocation). |
| **Socket.IO** | WebSocket library for realtime server → browser events. |
| **Telemetry (checkout)** | Behaviour measurements the Checkout page sends with `POST /bookings/initiate` (`checkoutDurationSeconds`, `clicksPerMinute`, `rapidSeatAttempts`, `deviceSwitches`); input to the anti-bot check. |
| **Tier** | Price category (`TicketTier`) with total and available quantities. |
| **Transaction** | Group of DB writes that all succeed or all roll back (`prisma.$transaction`). |
| **Zod** | Schema validation library used for request bodies. |
