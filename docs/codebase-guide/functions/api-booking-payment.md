# Function catalogue — API booking & payment

[← Function catalogue index](README.md) · Module walkthrough: [Booking, checkout & payment](../02-modules/booking-payment.md)

Files: `apps/api/src/controllers/bookingController.js`, `apps/api/src/services/paymentService.js`. All `/api/bookings` routes run behind `router.use(requireAuth)` (`bookingRoutes.js:14`).

---

## `bookingController.js`

Schemas: `initiateBookingSchema` (`:12` — `eventId` UUID, 1–10 `seatIds` UUIDs, `paymentMethod` enum default MOCK, `customerPhone?`, optional `telemetry {checkoutDurationSeconds, clicksPerMinute, rapidSeatAttempts, timeOnSeatmapSeconds, deviceSwitches}`), `confirmBookingSchema` (`:26` — `orderId`, `paymentDetails` object), `cancelBookingSchema` (`:31`).

<a id="api-booking-initiate"></a>
### `initiateBooking` — `POST /api/bookings/initiate` — `:38`
- **Caller:** `Checkout.jsx:292` (`submit`), which since commits `87aa15d`/`f991cc5` **always sends `telemetry`** (see [Checkout](web-pages.md#web-checkout-submit)). Also the demo scripts `scripts/simulate_scalper_bot.js` and `scripts/demo_live_checkout_to_metamask.mjs`.
- **Steps:**
  1. Validate; load the event (404); must be `PUBLISHED` (400).
  2. **Bot check** (runs whenever `telemetry` is present — i.e. on every web checkout): [`mlService.checkFraudRisk({...telemetry, ticketsRequested})`](api-analytics-ml.md#api-ml-checkfraudrisk) → Python model, Python heuristic or Node fallback depending on what is available; inserts `BehaviorEvent CHECKOUT_BOT_EVALUATION` with the evaluation and seat ids; `risk_level === 'CRITICAL_BOT'` (score ≥ 75) → AuditLog `CHECKOUT_BLOCKED_SCALPER_BOT` and **403** `{blockedByAI:true, data:{fraudScore, riskLevel, anomalyFactors}}`. The seats stay held by the user (nothing is released on block, despite the demo script's printed claim).
  3. [`expireStaleHolds(eventId)`](api-venues-seats.md#api-venue-expirestaleholds) so lapsed holds/checkouts cannot block or be double-sold.
  4. Load the seats (must all belong to the event — 400 otherwise).
  5. Per seat: SOLD → 409; BLOCKED → 409; must be held by this user either **in the DB** (`LOCKED`, `lockedByUserId`, `lockedUntil > now`) **or in Redis** (`checkSeatLock`) — otherwise 409 "reservation lock … expired or was not acquired".
  6. Whole-table seats: every chair of the table must be in the request (400).
  7. Existing tickets on these seats: a `SUCCESSFUL` order → 409 sold; another customer's `PENDING` order → 409; the caller's own older `PENDING` order(s) are **superseded**.
  8. `totalAmount` = sum of tier prices (server-side prices only); per-tier counts.
  9. **Transaction:** for each superseded order: conditional `PENDING → FAILED`, delete its tickets, restore tier counts; create `Order {PENDING, paymentMethod}`; create one `Ticket {ACTIVE, price}` per seat (unique `seatId` enforces one ticket per seat); decrement each tier's `availableQuantity`.
  10. [`paymentService.initiatePayment(...)`](#api-payment-initiate) → gateway parameters (a **real Stripe PaymentIntent** when `STRIPE_SECRET_KEY` is configured, otherwise simulated values).
  11. Behaviour: a direct `prisma.behaviorEvent.create({action:'checkout_started'})` **and** `trackBehavior(CHECKOUT_STARTED)` (two rows; the Checkout page also posts its own `checkout_started` when it opens).
  12. **201** `{orderId, totalAmount, currency:'PKR', paymentMethod, paymentParams, seats}`.
- **Failure:** Zod → 400; Prisma `P2002` (seat taken by a concurrent checkout) → 409; other → 500 with the raw message.
- **Note:** the seats are **not** changed here — they stay `LOCKED` by the user; the placeholder ticket is what protects them if the hold lapses.

<a id="api-booking-confirm"></a>
### `confirmBooking` — `POST /api/bookings/confirm` — `:327`
- **Caller:** `Checkout.jsx:351` (45 s client timeout). For a real Stripe card payment the browser first calls `stripe.confirmCardPayment` and sends `{paymentIntentId, paymentTxId, cardLast4}`.
- **Steps:**
  1. Load order with event and tickets→seat→tier (404); owner or SUPER_ADMIN (403).
  2. Already `SUCCESSFUL` → 200 (idempotent); `FAILED` → 400 "cancelled or expired".
  3. [`paymentService.verifyPayment`](#api-payment-verify)`({paymentMethod: order.paymentMethod, paymentDetails, expectedAmount})`; failure → behaviour `PAYMENT_FAILED`, **400** with the message (order stays PENDING, retry possible).
  4. **Transaction:** conditional `updateMany({id, status:'PENDING'} → SUCCESSFUL, paymentTxId)`; if 0 rows → return null (a parallel confirmation or the expiry got there first); update each seat to `SOLD` and clear lock fields; AuditLog `BOOKING_CONFIRMED`; Notification `BOOKING_CONFIRMED` (e-mailed by the Prisma hook).
  5. `null` → re-read: SUCCESSFUL → 200 "already confirmed", else **409** "reservation expired…".
  6. After commit: for each ticket `releaseSeatLock(seatId, userId)` (Redis/memory) and emit `seat:status_change` `SOLD`.
  7. `nftService.batchMintOrderTickets(order.id)` in a try/catch (failures only logged).
  8. Behaviour `PAYMENT_COMPLETED` + `TICKET_PURCHASED`.
  9. **200** `{order, nftTickets, paymentReceipt:{transactionId, gateway, amountPaid, currency, paidAt}}`.
- **Not checked here:** whether the seat holds are still live (expiry is handled by `expireStaleHolds` failing the order first, with a 120 s grace). The Stripe amount is not compared with the order total on confirmation (the PaymentIntent was created with the order amount at initiate).

### `cancelBooking` — `POST /api/bookings/cancel` — `:555`
Owner/admin; SUCCESSFUL → 400; FAILED → 200 already cancelled. **Transaction:** conditional `PENDING → FAILED`, delete tickets, set seats `AVAILABLE` (unconditionally for the order's seats), restore tier counts. Then release Redis keys, emit `seat:status_change AVAILABLE`, behaviour `CHECKOUT_ABANDONED`. Errors → 400 with the message. **No web caller** (the UI releases holds instead, which retires the order through `venueService.releaseHolds`).

### `getMyBookings` — `GET /api/bookings/my-bookings` — `:678`
The caller's orders (all statuses, newest first) with event summary and tickets→seat→tier. Caller: `MyBookings.jsx:31`.

### `getBookingById` — `GET /api/bookings/:id` — `:729`
Order with event (+company) and tickets; owner or admin. Caller: `BookingSuccess.jsx:42` (polling while PENDING).

---

## `paymentService.js` — gateways (singleton `new PaymentService()`)

**Module setup (`:4`):** `stripeClient = new Stripe(STRIPE_SECRET_KEY)` only when the variable is set and does **not** contain `mock`; otherwise `null`. Created once at import time (so `.env` must already be loaded — `apps/api/src/app.js`'s `dotenv.config()` runs after imports; in practice `emailService`/`mlService` call `dotenv.config()` at import earlier in the graph, but this ordering is fragile — inferred).

<a id="api-payment-initiate"></a>
### `initiatePayment({orderId, amount, paymentMethod, customerPhone, customerEmail})` — `:16`
- **STRIPE with `stripeClient`:** `stripe.paymentIntents.create({amount: max(100, round(amount × 100)), currency:'pkr', automatic_payment_methods:{enabled:true}, metadata:{orderId, customerEmail, customerPhone}, description})` → `{gateway, clientSecret, paymentIntentId, currency, amount, publishableKey: STRIPE_PUBLISHABLE_KEY, instructions}`. A Stripe error is logged and the code **falls back** to the simulated branch below.
- **STRIPE without `stripeClient`** (or after an error): fake `clientSecret: 'pi_<order>_secret_<random>'`, placeholder publishable key, test-card instructions. No network call.
- JAZZCASH `{ppTxnRefNo: 'JC<time><3 digits>', phone, otpHint:'123456'}`; EASYPAISA `{epOrderId: 'EP…', otpHint}`; MOCK/default `{mockTxId}` — all simulated.

<a id="api-payment-verify"></a>
### `verifyPayment({paymentMethod, paymentDetails, expectedAmount})` — `:103`
- **STRIPE:** target id = `paymentIntentId`, else `paymentTxId` if it starts with `pi_`. If `stripeClient` exists and the id is not a mock/secret-looking id → `stripe.paymentIntents.retrieve(id)`: status must be `succeeded` (else `{success:false, message:"Stripe payment status is '<status>'…"}`); success returns the intent id as `transactionId` and its creation time. If the retrieve call throws: failure **unless** a `paymentTxId` was also sent, in which case it falls through to the lenient path. **Lenient path** (no Stripe client, or mock id): always success with `paymentTxId`/target id or a random `ch_…` — i.e. without Stripe configured, card payments are still simulated.
- **JAZZCASH / EASYPAISA:** fails only if an OTP is present, is not `123456` **and** is not 6 characters long (any 6-character code, or none, succeeds) — simulated.
- **MOCK:** success.
- `expectedAmount` is ignored by every branch.

<a id="stripe-verification-gap"></a>
**Stripe verification gap (observed, `paymentService.js:105-140`).** Stripe is consulted only when the request *names* a PaymentIntent. Even with `STRIPE_SECRET_KEY` configured, `/confirm` succeeds for a STRIPE order when the client sends:
- no `paymentIntentId` and a `paymentTxId` that does not start with `pi_` (or no details at all) → `targetId` is null → lenient success;
- an id containing `mock` or `_secret_` → lenient success;
- a non-existent `pi_…` id **plus** any `paymentTxId` → the retrieve error is swallowed → lenient success (this is how `scripts/demo_live_checkout_to_metamask.mjs` confirms).
Also, a retrieved intent is not checked against the order (no `metadata.orderId` or amount comparison), so one succeeded intent id could confirm several orders. The web UI always pays through Stripe.js first, so honest customers are unaffected, but the server does not enforce payment for card orders.
