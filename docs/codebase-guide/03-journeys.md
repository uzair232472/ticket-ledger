# User journeys (end to end)

[← Start here](README.md) · Modules: [index](02-modules/README.md) · API: [catalogue](06-api-catalogue.md)

Each journey shows the success path as numbered steps (UI → API → database), the data passed, the checks, and the important alternative/failure paths. Roles: **C** customer, **O** organizer, **G** gate staff, **A** Super Admin.

| # | Journey | Roles |
|---|---|---|
| 1 | [Sign-up, verify e-mail and first login](#journey-1--sign-up-verify-email-and-first-login) | C, O |
| 2 | [Session refresh, idle sign-out, password reset](#journey-2--session-refresh-idle-sign-out-password-reset) | all |
| 3 | [Company approval, event creation and submission](#journey-3--organizer-company-approval-event-creation-and-submission) | O, A |
| 4 | [Choose seats, hold and checkout](#journey-4--choose-seats-hold-and-checkout) | C |
| 5 | [Wallet, QR display, PDF and pass check](#journey-5--wallet-qr-display-pdf-and-pass-check) | C |
| 6 | [Gate scanning online and offline](#journey-6--gate-scanning-online-and-offline) | G, O, A |
| 7 | [Transfer and resale](#journey-7--transfer-and-resale) | C |
| 8 | [Admin review and governance](#journey-8--admin-review-and-governance) | A |
| 9 | [Organizer analytics (forecast, intent, abandoned carts)](#journey-9--organizer-analytics-forecast-intent-abandoned-carts) | O, A |
| 10 | [Gate staff onboarding and revocation](#journey-10--gate-staff-onboarding-and-revocation) | O, G |
| 11 | [Notifications and contact](#journey-11--notifications-and-contact) | all |

---

## Journey 1 — Sign-up, verify email and first login

**Success path**
1. `/signup` → `Signup.handleSubmit` validates (name 2–50, e-mail, PK mobile, password ≥8 with letter+digit, terms) → `POST /api/auth/signup {name, email, phone, password, accountType}`.
2. `authController.signup` → **User** created `PENDING_VERIFICATION`, role from `accountType` (customer/organizer only) → **OtpCode** (HMAC, 10 min) → e-mail (or console in dev) → cookie `tl_pending_signup` → 201 `{email, otpExpiresAt, resendAvailableAt, serverTime}`.
3. Browser stores `sessionStorage.tl_pending_email`, goes to `/verify`; `VerifyOtp.loadTiming` (`GET /pending-signup`) shows countdowns.
4. `POST /api/auth/verify-otp {email, code}` → `consumeOtp` → **User** `ACTIVE`, `emailVerifiedAt` → **RefreshToken** row + `tl_refresh` cookie → `{user, token}`.
5. `AuthContext.applySession` keeps the token in memory → navigate to `getHomeRoute(user)`: customer `/events`, organizer `/company` (no approved company yet), admin `/admin/dashboard`.

**Alternatives / failures:** duplicate e-mail/phone → 409; wrong code → "N attempts left", 5th → expired; resend within 60 s → 429 with `retryAfter`; "Change email" → `/signup` restores details and `PATCH /pending-signup` (new code to the new address); login while unverified → new code + 403 `needsVerification` → `/verify`; blocked account → `/suspended`. Rate limits per IP on all these endpoints.

**Data passed:** e-mail and code only for verification (ownership of an unverified signup is proved by the signed cookie, never by client-sent ids).

## Journey 2 — Session refresh, idle sign-out, password reset

1. Page load: `AuthProvider` → idle > 30 min? sign out : `POST /api/auth/refresh` (cookie) → rotated cookie + new access token.
2. Every 15 min (60 s before expiry) the timer refreshes again; any `401 TOKEN_EXPIRED` triggers one silent refresh + retry.
3. 30 min without activity (shared across tabs) → `POST /logout` → `/login` with a notice. Server independently refuses refresh tokens unused for 30 min.
4. Forgot password: `/forgot-password` → `POST /forgot-password` (generic answer) → `/reset-password` → `POST /reset-password {email, code, newPassword}` → new hash, **all sessions revoked** → `/login`.
5. Change password (signed in): Profile → `ChangePasswordCard` → `PUT /api/users/password` → hash updated, sessions revoked, notification + e-mail.

**Concurrency:** refresh is single-flight per tab; a reused refresh token outside a 30 s grace revokes every session (theft response).

## Journey 3 — Organizer company approval, event creation and submission

1. **O** `/company` → `POST /api/companies/register` (multipart, document) → **Company** `PENDING`, `User.companyId`, notification.
2. **A** `/admin/companies` → `PATCH /api/companies/admin/:id/status APPROVED` → notification/e-mail; reject requires a reason (O can resubmit).
3. **O** `CompanyRegistration` calls `refreshUser()` → `companyStatus: APPROVED` → studio routes unlock (`ProtectedRoute requireApprovedCompany`).
4. **O** `/organizer/create-event` (steps 1–3) → `POST /api/events` (multipart) → guards (role, approved company, multer) → images validated from bytes → transaction **Event** `DRAFT` + **TicketTier**s + **EventGalleryImage**s + **AuditLog** → notification → redirect to venue editor (or Demand Forecast if "prelaunch analysis" chosen).
5. **O** step 4 `/organizer/events/:id/venue` → template/plan/draw → `PUT /draft` → `POST /publish` → **Seat** rows created, tier totals recomputed, **VenueLayout** `PUBLISHED` v1.
6. **O** step 5 `/organizer/events/:id/submit` → `GET /submission` (readiness) → `POST /submit` → **Event** `PENDING_APPROVAL`, notifications to all admins.
7. **A** `/admin/event-approvals` → approve → **Event** `PUBLISHED` + `approvedAt` → organizer notified → event visible on `/events`.

**Failures:** unapproved company → 403 `COMPANY_NOT_APPROVED`; image ratio/size wrong → 400 (cropper offered in the browser first); submit without seating → 400; second admin decision → 409; reject → `REJECTED` with comment, organizer edits and resubmits. **Ownership:** every organizer endpoint checks the event's company against the caller's own company (`canManageEvent`).

## Journey 4 — Choose seats, hold and checkout

1. **C** `/events/:id` → `GET /api/events/:id` (+ behaviour) → sale state "On sale" → "Choose seats".
2. `/events/:id/seats` → `SeatMap` → `GET /api/venues/event/:id` → published plan → `VenueBooking`.
3. Click a section → camera zooms; click a seat → popover → **Select** → `POST /api/venues/event/:id/holds {key}` → `holdSeat`: event published, `expireStaleHolds`, ≤10 holds, **atomic UPDATE** → **Seat** `LOCKED` 10 min → socket `seat:status_batch` updates other viewers; behaviour `seat_selected` + `seat_locked` recorded.
   - GA: quantity stepper → `{sectionId, quantity}` (`SKIP LOCKED` selection); whole table → `{tableKey}` (all-or-nothing).
   - Signed out: the pick is stored in `sessionStorage['tl-pending-hold']`, login, then auto-held on return (if still free, within 30 min).
4. "Get tickets" → re-validate holds with the server → `/events/:id/checkout`.
5. `Checkout` → reloads my holds and server prices, posts `checkout_started` → choose method → `POST /api/bookings/initiate` with **telemetry** (time on page, click rate) → **anti-bot check** (`checkFraudRisk`; `CRITICAL_BOT` → 403) → **Order** `PENDING`, **Ticket** per seat (placeholder), tier available −n → payment params (real Stripe PaymentIntent if configured, otherwise simulated); if the server total differs, the customer confirms again.
6. Card: Stripe.js `confirmCardPayment` with the `CardElement` (test card 4242…). Then `POST /api/bookings/confirm` → verification (Stripe intent must be `succeeded`; wallets simulated OTP) → **Order** `SUCCESSFUL`, **Seat** `SOLD`, notification + e-mail, socket `SOLD`, NFT mint (simulated) → "You're going!" modal; `HoldBar` disappears.

**Alternatives / failures:** bot verdict → 403 with anomaly signals (try `?bot` on the checkout URL to see it); card declined by Stripe → message, order kept for retry; seat taken meanwhile → 409 explained; hold limit → 409; hold expires → seats released on next load/hold (orders failed 120 s after hold end); payment OTP wrong format → 400, retry with the same order; network timeout on confirm → confirmation page polls the order (3 s, up to 3 min); remove a line in checkout → `releaseHolds` (retires the unpaid order, restores tier counts; `checkout_abandoned` recorded). **Legacy events** (no plan) use `LegacySeatMap` with `/api/seats/lock|unlock` (Redis + DB).

## Journey 5 — Wallet, QR display, PDF and pass check

1. **C** `/wallet` → `GET /api/tickets/wallet` → paid tickets; missing token → lazy mint; `passFor` → signed `TL1…` code + manual code `TL-XXXX-XXXX` → QR PNG.
2. Download → `GET /api/tickets/:id/pdf` → PDFKit A4 with QR, manual code, event photo.
3. "Check my pass" → `POST /api/tickets/verify-qr` → intended as a read-only verdict ("Valid pass: it will be admitted"); **at `1ac4075` it reports every signed pass as invalid** because the API's prefix test expects `TL1:` while passes start with `TL1.` ([details](functions/api-tickets-qr-gate.md#api-ticket-verifyqr)).
4. At the gate, when scanned, the wallet receives `ticket:checked-in` and greys the QR ("Used at 7:42 PM, Gate B").
5. `/my-nfts` shows token data (`isLiveOnChain: false` unless configured); `/my-bookings` lists orders.

## Journey 6 — Gate scanning online and offline

1. **G** logs in → `/staff/events` (`GET /api/staff/my-events`) → "Scan for this event" → `/scanner?eventId=…`.
2. Scanner downloads the offline pack (`GET /api/checkin/events/:id/pack`, refreshed every 3 min), loads stats and recent scans, joins socket room `event_<id>`; staff picks a gate (remembered per event).
3. Camera decodes a QR (or code typed) → `POST /api/checkin/scan` → `evaluate` → GREEN → atomic admission → **CheckIn** + **GateScan** rows → sockets to holder and organizer → verdict screen with tone.
4. Re-scan → YELLOW "Already scanned at…"; old QR after transfer → RED; other event → RED; unpaid placeholder → RED.
5. Network loss → local verdict from the pack (WebCrypto), queued in IndexedDB → synced every 30 s / on reconnect → server reconciles, flags double offline admissions as `conflict`.
6. Offline > 2 h → scanning locked until reconnect.
**Authorization:** role GATE_STAFF/ORGANIZER/SUPER_ADMIN **and** event in scope (assignment / own company); revocation takes effect immediately on the next request and wipes the device on the socket event.

## Journey 7 — Transfer and resale

1. **C** wallet → Transfer → `POST /api/tickets/transfer {ticketId, recipientEmail}` → owner, ACTIVE, recipient registered → transaction: ticket owner changes, `qrVersion+1`, manual code cleared, active listing cancelled, **TicketTransferHistory**, notifications → old QR invalid at the gate.
2. **C** wallet / NFT page → List → `POST /api/resale/list {ticketId, resalePrice}` → price ≤ floor(1.10 × original) → **ResaleListing** ACTIVE → waitlisted users notified.
3. **C2** `/resale` → `GET /api/resale/market` → Buy → `POST /api/resale/buy/:id` → listing SOLD, ticket moves to C2 (same QR invalidation), history `P2P_RESALE`, notifications. **No payment is taken.**
4. Seller may cancel an active listing (`POST /api/resale/cancel/:id`).
5. Sold-out event page → "Join the waitlist" (`POST /api/events/:id/waitlist`).
**Failures:** not owner → 403; scanned ticket → 400; price over cap → 400 with figures; listing no longer active → 400; buying own listing → 400. **Race:** simultaneous buys are not prevented (see [module](02-modules/transfers-resale.md#concurrency-observed)).

## Journey 8 — Admin review and governance

1. **A** `/admin/dashboard` → metrics and tabs (`/api/admin/*`).
2. Users tab → change status (`PUT /api/admin/users/:id/status`): blocking revokes all sessions; the user's next request gets 403 `ACCOUNT_SUSPENDED` and the UI redirects to `/suspended`; a `SYSTEM_ALERT` notification is sent.
3. Companies (`/admin/companies`) and event approvals (`/admin/event-approvals`) as in journey 3.
4. Fraud watchlist (`/admin/fraud-watchlist`) → freeze/unfreeze (`/api/ml/freeze-user/:id`).
5. Events tab → delete (refused with paid or pending orders; organizer notified).

## Journey 9 — Organizer analytics (forecast, intent, abandoned carts)

1. **O** `/organizer/dashboard` → `GET /api/organizer/organizer-dashboard` → revenue, tiers, turnout (live via `checkin:stats`), rule-based attendance prediction.
2. `/demand-forecast?eventId=` → `GET /api/events/:id/prelaunch-forecast[?simulatedPrice]` → ML service (or fallback) + rule-based launch time and price warning → organizer edits prices → `PUT /api/events/:id/pricing`.
3. `/admin/purchase-intent` → choose event → `GET /api/analytics/intent/:id` → funnel, likely buyers, abandoned users (rules) → "Send reminder" (`POST …/send-reminder`) or batch → notification + e-mail.
4. `/admin/abandoned-intents` → `GET /api/analytics/abandoned` → reasons, recoverable revenue → reminders with a discount code text (code not redeemable anywhere).
**Ownership:** analytics are limited to the organizer's own events (403 otherwise); the event pickers list public events, so other organizers' events appear in the dropdown but fail to load.

## Journey 10 — Gate staff onboarding and revocation

1. **O** dashboard → Staff panel → invite e-mail for an event → `POST /api/staff/invites` (existing same-company staff are simply assigned).
2. **G** opens `/invite/<token>` → `GET /api/auth/invite/:token` → sets name/password → `POST /api/auth/accept-invite` → GATE_STAFF account + assignment + session → `/staff/events`.
3. **O** may resend/cancel invites, deactivate/reactivate staff, or revoke one event (`DELETE /api/staff/:id/events/:eventId` → socket `staff:access-revoked` → scanner wipes offline data).

## Journey 11 — Notifications and contact

1. Any feature writes a **Notification** → e-mailed automatically (respecting `emailNotifications`).
2. Header icon polls `GET /api/notifications?limit=3` every 60 s; `/notifications` lists 50, mark read/all, delete.
3. Profile → notification preferences (`PUT /api/users/notifications`).
4. `/contact` → `POST /api/contact` → e-mail to the support inbox with `Reply-To` (rate-limited; no copy to the sender).
