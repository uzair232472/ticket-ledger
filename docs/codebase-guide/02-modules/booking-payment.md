# Module: Booking, checkout & payment

[← Modules](README.md) · Functions: [booking & payment](../functions/api-booking-payment.md) · [Checkout page](../functions/web-pages.md#web-checkout-submit) · Journey: [4](../03-journeys.md#journey-4--choose-seats-hold-and-checkout)

## Overview

A booking turns the customer's held seats into an **Order** with **placeholder Tickets**, takes payment, and on success marks the seats **SOLD**, sends a confirmation and mints NFT records. Every web checkout first passes an **anti-bot check** fed by behaviour measurements from the page.

Payment status by method (at commit `1ac4075`):

| Method | Status |
|---|---|
| **Card (Stripe)** | **Real Stripe sandbox** when `STRIPE_SECRET_KEY` (API) is set to a real test key: the API creates a PaymentIntent, the browser confirms the card with Stripe Elements, and the API retrieves the intent and requires `succeeded` — but only when the client names an intent (see [gaps](#gaps-observed)). Without the key the API falls back to simulated values (see [failure behaviour](#failure-behaviour)). |
| JazzCash, EasyPaisa | **Simulated** (OTP check only). |
| Instant test payment (MOCK) | Simulated, always succeeds. |

## Behind the scenes

```mermaid
sequenceDiagram
  participant CO as Checkout.jsx (CheckoutContent)
  participant ST as Stripe.js (browser)
  participant IB as initiateBooking
  participant ML as mlService.checkFraudRisk
  participant CB as confirmBooking
  participant DB as PostgreSQL
  participant PS as paymentService
  participant S as Stripe API
  participant NFT as nftService
  CO->>CO: loadReservation (my holds, server prices); post checkout_started telemetry
  CO->>CO: measure time on page + click rate (or bot profile if ?bot / window.simulateBot())
  CO->>IB: POST /bookings/initiate {eventId, seatIds, paymentMethod, phone, telemetry}
  IB->>ML: fraud score (ML service / fallback)
  alt CRITICAL_BOT (score ≥ 75)
    IB-->>CO: 403 blockedByAI + anomaly factors (AuditLog)
  end
  IB->>DB: expireStaleHolds; seats locked by me; TX: Order PENDING + Tickets + tier −n
  IB->>PS: initiatePayment
  PS->>S: create PaymentIntent (only if STRIPE_SECRET_KEY real)
  IB-->>CO: {orderId, totalAmount, paymentParams (clientSecret, paymentIntentId…)}
  CO->>ST: confirmCardPayment(clientSecret, CardElement) [Stripe only]
  ST-->>CO: paymentIntent succeeded / error
  CO->>CB: POST /bookings/confirm {orderId, paymentDetails}
  CB->>PS: verifyPayment
  PS->>S: retrieve PaymentIntent → status must be succeeded
  CB->>DB: TX: Order PENDING→SUCCESSFUL (conditional), seats SOLD, AuditLog, Notification
  CB->>NFT: batchMintOrderTickets (errors ignored)
  CB-->>CO: {order, nftTickets, paymentReceipt}
  CO->>CO: OrderConfirmedModal; dispatch tl:holds-changed
```

| # | Step | File → function | Data |
|---|---|---|---|
| 1 | Load holds and prices | `Checkout.loadReservation` (`Checkout.jsx:37`) → `GET /venues/event/:id` (legacy: `/seats/event/:id`) | — |
| 2 | Checkout-opened telemetry | effect at `Checkout.jsx:220` (request at `:223`) → `POST /behavior/track checkout_started` (once per page) | `BehaviorEvent` |
| 3 | Client validation | `Checkout.validate` (only the cardholder name for Stripe; card fields live in Stripe's `CardElement`) | phone, OTP |
| 4 | Build telemetry | `Checkout.submit` (`:276-290`): seconds since the page mounted, clicks per minute (window click counter, capped at 180, default 28); `?bot` in the URL or `window.simulateBot()` substitutes a bot profile (0.4 s, 240 clicks/min, 6 seat attempts, 2 device switches) | — |
| 5 | Initiate + bot check | `bookingController.initiateBooking` → `mlService.checkFraudRisk` | `BehaviorEvent CHECKOUT_BOT_EVALUATION`; on block `AuditLog` |
| 6 | Order and placeholder tickets | same handler, transaction | `Order`, `Ticket`×n, `TicketTier` −n, `BehaviorEvent`×2 |
| 7 | Payment parameters | `paymentService.initiatePayment` (Stripe PaymentIntent or simulated) | Stripe (external) |
| 8 | Price recheck | `Checkout.submit` compares server total | — |
| 9 | Card confirmation (Stripe) | `stripe.confirmCardPayment` (`Checkout.jsx:319`) via `@stripe/react-stripe-js` `Elements`/`CardElement` | Stripe (external) |
| 10 | Confirm | `bookingController.confirmBooking` + `paymentService.verifyPayment` | `Order` SUCCESSFUL + `paymentTxId`, `Seat` SOLD, `AuditLog`, `Notification` (→ e-mail) |
| 11 | Live update | `seat:status_change` broadcast | — |
| 12 | NFT mint | `nftService.batchMintOrderTickets` | `Ticket` token fields, `AuditLog` |
| 13 | Confirmation | `OrderConfirmedModal` or `BookingSuccess` (polls 3 s up to 3 min while PENDING) | — |

**Why the order is created before payment:** the placeholder tickets claim the seats through the unique `Ticket.seatId` constraint, so even if the hold lapses during payment, `FREE_SQL` treats the seat as taken (a ticket references it) until the order is failed by expiry (120 s after the hold ends) or cancelled.

**Retries and idempotency:** confirming an already SUCCESSFUL order returns 200 again; a FAILED order → 400; a parallel confirmation/expiry race is resolved by the conditional `updateMany({status:'PENDING'})` (the loser gets 409 or "already confirmed"). Checkout reuses the same order when only the payment step failed; a changed selection or method creates a new order and the old PENDING one is failed automatically. A Stripe card error stops before `/confirm` (order stays PENDING, the customer may retry).

**Cancellation:** `POST /bookings/cancel` (no web caller) fails the order, deletes tickets, frees seats, restores tier counts. In the UI, removing tickets in checkout calls `releaseHolds`, which retires the unpaid order the same way; "Discard all" additionally posts a `checkout_abandoned` telemetry event.

## Anti-bot check — how a normal customer is scored
The check always runs, so its thresholds matter for real users (Node fallback rules shown; the Python heuristic is similar, the trained model differs — see [behaviour & AI](behavior-analytics-ml.md)):

| Signal sent by the page | Fallback penalty |
|---|---|
| `checkoutDurationSeconds` < 2.5 (time since the checkout page opened) | +55 |
| `clicksPerMinute` > 150 | +25 |
| `rapidSeatAttempts` ≥ 6 (always 1 for humans) | +20 |
Base 10; ≥ 75 blocks. A human who opens checkout and presses *Confirm order* within 2.5 s while clicking quickly (e.g. 3 clicks in 1 s → 180 clicks/min) scores 90 and **is blocked** (observed from the formulas; an edge case). Normal use (tens of seconds on the page) scores 10.

## Payment details (`paymentService.js`)
| Method | initiate returns | verify accepts |
|---|---|---|
| STRIPE (configured) | real `clientSecret`, `paymentIntentId`, `publishableKey` | PaymentIntent retrieved from Stripe must be `succeeded` |
| STRIPE (not configured / Stripe error) | fake `clientSecret` `pi_…_secret_…` | always (lenient path) |
| JAZZCASH | `ppTxnRefNo`, OTP hint 123456 | missing OTP, `123456`, or any 6-character OTP |
| EASYPAISA | `epOrderId`, OTP hint 123456 | same rule |
| MOCK | `mockTxId` | always |
`expectedAmount` is passed but never compared. Configuration: `STRIPE_SECRET_KEY` (API, read since `2208b32`), `STRIPE_PUBLISHABLE_KEY` (API, echoed), `VITE_STRIPE_PUBLISHABLE_KEY` (web; `Checkout.jsx:16` falls back to a **hard-coded Stripe test publishable key** when unset — publishable keys are public by design, but the fallback ties the UI to one Stripe account). `JAZZCASH_*`, `EASYPAISA_STORE_ID` are still not read.

## Failure behaviour
| Case | Result |
|---|---|
| Bot verdict `CRITICAL_BOT` | 403 `blockedByAI`; red notice listing the anomaly signals; seats remain held |
| ML service down/slow | Node fallback score (no timeout on the HTTP call — a hung service delays checkout) |
| Hold expired before initiate | 409 "reservation lock … expired"; Checkout refreshes |
| Seat in another customer's checkout | 409 |
| Race on insert | `P2002` → 409 |
| Stripe card declined / 3-D Secure failure | Stripe.js error shown; `/confirm` not called; order stays PENDING |
| **Stripe not configured on the API but card chosen** | The API returns a fake `pi_…_secret_…`; the page only skips Stripe.js for secrets containing `mock`, so it calls `confirmCardPayment` with the fake secret, which Stripe rejects → payment error (inferred from the code; not executed). Card checkout therefore needs a real `STRIPE_SECRET_KEY`. |
| Stripe retrieve error on confirm | 400 unless a `paymentTxId` was also sent (then lenient success) |
| Payment "declined" (bad OTP format) | 400; order stays PENDING; customer may retry |
| Confirm after expiry | 409 "Your seat reservation expired…" |
| No response from confirm | Checkout navigates to the confirmation page with `pending:true`, which polls |
| NFT mint fails | Logged; booking still SUCCESSFUL; wallet mints lazily later |

## Gaps (observed)
**Card payment is not enforced server-side:** `/confirm` accepts a STRIPE order without a real PaymentIntent (no id, a non-`pi_` id, or a bad `pi_` id plus `paymentTxId`), and a real intent is not matched to the order — see [Stripe verification gap](../functions/api-booking-payment.md#stripe-verification-gap). JazzCash/EasyPaisa remain simulated; no refund flow; no amount check on confirm; no webhooks (Stripe status is checked only when the browser calls `/confirm`; if the browser dies after paying, the order stays PENDING and later expires although Stripe captured the payment — inferred); the bot thresholds can block very fast humans; tier `availableQuantity` drops at checkout start, so dashboards count unpaid checkouts as sold until expiry.

## Worked example (fictional)
Hina holds 2 seats (PKR 3,000 each), spends 40 s on checkout with 12 clicks → telemetry `{40, 18 clicks/min, 1, 0}` → fallback score 10, LOW → order O `PENDING` 6,000, tickets T1/T2 `ACTIVE`, tier 98 → 96.
- **Card, Stripe configured:** PaymentIntent for 600,000 (PKR × 100) created; she enters the test card 4242… in the Stripe field → `confirmCardPayment` succeeds → `/confirm {paymentIntentId:'pi_…'}` → API retrieves the intent (`succeeded`) → O `SUCCESSFUL` (`paymentTxId` = intent id), seats SOLD, notification + e-mail, NFT mint (simulated unless the chain is configured) → "You're going!".
- **JazzCash:** params `{ppTxnRefNo:'JC1730…123', otpHint:'123456'}` → she enters `123456` → same confirmation, simulated.
- **Bot demo:** opening `/events/E/checkout?bot` sends `{0.4 s, 240/min, 6, 2}` → score 100 → 403 "Anti-Scalping Security Alert…" with three anomaly signals.
