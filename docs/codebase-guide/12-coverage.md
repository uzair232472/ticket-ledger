# Coverage checklist and verification

[← Start here](README.md)

## Repository revision

| Item | Value |
|---|---|
| Branch | `main` |
| Commit | `1ac40752d176b5ecd5f3bfb16e1e312a4a496d2e` (2026-10-07) — "docs: add comprehensive FYP viva defense guide and full codebase audit" (local `main` fast-forwarded to `origin/master`). The guide was first written at `cbe37ba` and then revised for the 12 commits `fad6f72…1ac4075` — see [changes since the first edition](#changes-since-the-first-edition-cbe37ba--1ac4075). |
| Uncommitted changes at writing time | **Modified:** `apps/web/src/pages/Checkout.jsx` — formatting only (indentation, spacing, the doc comment above `CheckoutContent` removed, an emoji removed from a console message); it shifts that file's line numbers after line 83 by −5. This guide documents the **committed** version (all generated tables were produced from a `git archive` of `HEAD`). **Untracked:** `apps/api/uploads/` (uploaded files, runtime data), `apps/web/public/web visuals/ticket ledger.mp4` (hero video source), and this handbook (`docs/codebase-guide/`). None of the untracked items contains application code. |
| Guide written | 2026-10-06; revised 2026-10-07 |
| Local, git-ignored files observed but not documented in detail | `apps/api/.env` and `apps/api/.keys/qr-ed25519.pem` (secrets — not read), `apps/ml-service/models/*.joblib` (legacy-format models, inspected only for their Python type), `apps/ml-service/.venv/`, `.tl_venue.log` |

If the code changes after this commit, line numbers in this guide may drift; symbol names remain the reliable anchor.

## Method

1. **File inventory first** — `git ls-files` (332 tracked files: 300 source/config/data/doc + 32 media). Every non-media file is a row in the [file inventory](04-file-inventory.md).
2. **Function inventory** — every `.js/.jsx/.mjs/.cjs` file parsed with `@babel/parser` (from the repo's own `node_modules`), collecting imports, exports, route registrations and every function node with its enclosing function and line range: 234 files, **3,648 function nodes**, of which **1,205** are named top-level functions/components or named nested handlers (tracked items). Python (31 functions) and Solidity (8 members) were inventoried by reading.
3. **Reading** — every controller, service, route, config, middleware, utility, the venue library, the Python service, the contract and the key web files were read in full; remaining web components/pages were read for logic (API calls, effects, handlers) and skimmed for presentation.
4. **Cross-reference scans** — import graph (used-by), Prisma model read/write map per function, endpoint ↔ web caller map (handles multi-line, chained and helper-literal calls), Socket.IO emit/listen map, env-variable usage.
5. **Coverage check** — for each tracked function, its name was searched in the catalogue page responsible for its file. Result: **1,205 / 1,205 referenced** (plus the 39 Python/Solidity symbols listed in the [symbol index](functions/README.md#symbol-index)). Limitation: the check confirms the name is present on the right page, not the quality of the description; very generic names (`start`, `end`, `update`) were reviewed manually in the per-component helper tables.
6. **Link check** — all relative links and `#anchors` between the Markdown pages were validated by the HTML build script (`_build/build-html.mjs`), using the same heading-slug rule as GitHub.
7. **Execution** — the application, the HTTP test scripts, the root demo scripts and the contract tests were **not run** (Stripe behaviour is documented from the code, not from a live Stripe account). One read-only Python check was executed: loading the local model files and calling the three inference functions (results quoted in [ML service](functions/ml-service.md)).

## Coverage summary

| Area | Documented | Excluded | Unresolved |
|---|---|---|---|
| Files (300 non-media tracked) | 300 in inventory | 32 media assets (listed by folder); lockfiles listed only | — |
| API routes | 146 unique route registrations (158 incl. `/api/organizer` duplicates) in the [API catalogue](06-api-catalogue.md) | — | — |
| Named JS functions | 1,205 / 1,205 | anonymous inline callbacks summarised in prose | — |
| Python functions | 31 / 31 | `.venv` | — |
| Solidity members | 8 / 8 | OpenZeppelin base contracts | — |
| Database models | 22 / 22, enums 17 / 17 | — | Legacy `User` OTP columns (purpose historical) |
| Socket events | 9 / 9 | — | — |
| Env variables | all read variables + unused template entries | secret values (by design) | — |
| Module walkthroughs | 14 / 14 | — | — |
| Journeys | 11 | — | — |

## Representative flows traced end to end against the code

| Flow | Traced through |
|---|---|
| Sign-up → OTP → session → refresh → idle sign-out | `Signup` → `AuthContext.signup` → `authController.signup` → `otpService.issueOtp` → `VerifyOtp` → `verifyOtp` → `startSession` → `AuthProvider` effects → `rotateRefreshToken` |
| Seat hold on a venue plan | `VenueBooking.selectFromPop` → `liveAdapter.hold` → `createHold` → `holdSeat` (`FREE_SQL`) → `emitSeatChanges` → other clients' `patch` |
| Checkout and payment | `Checkout.submit` (telemetry) → `initiateBooking` → `mlService.checkFraudRisk` → `paymentService.initiatePayment` (Stripe PaymentIntent) → `stripe.confirmCardPayment` → `confirmBooking` → `verifyPayment` → `nftService.batchMintOrderTickets` → `OrderConfirmedModal` |
| Wallet pass → gate admission | `getCustomerWallet` → `passFor`/`signPass` → `GateScanner.check` → `checkinService.scan`/`evaluate` → `logScan` → `broadcast` → `DigitalWallet` socket listener |
| Offline scan reconciliation | `decideOffline` → `evaluateOffline` → `enqueue` → `syncQueue` → `syncOffline` |
| Transfer invalidates old QR | `transferTicketDirectly` (`qrVersion+1`) → `evaluate` step 4 |
| Venue publish with protected seats | `VenueEditor.publish` → `publishDraft` conflicts |
| Behaviour → analytics | `trackClientBehavior`/`trackBehavior` (incl. `createHold`/`releaseHold`, Checkout `checkout_started`) → `BehaviorEvent` → `getEventIntentAnalytics` / `getAbandonedIntentDashboard` |
| Demand forecast → ML | `DemandForecast` → `getPreLaunchDemandForecast` → `forecastEventDemand` → `main.py execute_demand_forecast` |
| Notification → e-mail | feature `prisma.notification.create` → `$extends` hook → `emailNotifications` → `sendEmailNotification` |

## Unresolved or uncertain items

| Item | Why uncertain |
|---|---|
| Whether `npm test` discovers any `test_*.mjs` file | Inferred from Node's documented default patterns; not executed. |
| Which seeder is canonical (`prisma/seed.js` vs `src/seed.js`) | Both exist; npm uses `prisma/seed.js`. |
| Real-world ML quality | Models trained on synthetic data only; local model files are in an incompatible format. |
| Behaviour of a real SMTP / Cloudinary / Polygon setup | Not configured in the repository; documented from code paths. |
| Legacy `User.otpCode`, `otpExpiresAt`, `isVerified`, `Ticket.qrSignature`, `pdfUrl`, `AuditLog.ipAddress` | Present in schema; no current reads/writes found. |
| Pre-existing `docs/*.md` and `TICKETLEDGER_FYP_VIVA_GUIDE.md` | Not verified line by line. The viva guide describes some features differently from the code (e.g. it presents the rotating HMAC QR as the pass system; the wallet and gate use Ed25519 `TL1.` passes, and the HMAC system is legacy). Prefer this handbook where they disagree. |
| Live Stripe behaviour | Documented from the code paths; no Stripe key was used. |

## Notable findings (observed in the code)

Functional gaps and risks a reader should know. Each links to the detailed explanation.

| # | Finding | Where explained |
|---|---|---|
| 1 | Card payments use Stripe (test mode) only when `STRIPE_SECRET_KEY` is set, and **the server does not enforce them**: `/confirm` accepts a STRIPE order with no PaymentIntent id, a non-`pi_` id, or a bad `pi_` id plus `paymentTxId`, and does not match an intent to its order. JazzCash/EasyPaisa are simulated; resale purchases take no payment at all. | [Stripe gap](functions/api-booking-payment.md#stripe-verification-gap), [booking](02-modules/booking-payment.md), [resale](02-modules/transfers-resale.md) |
| 2 | Behaviour-profile "ML" scores always use the fallback because `mlService.predictPurchaseIntent` / `predictFraud` do not exist. | [behaviour & AI](02-modules/behavior-analytics-ml.md) |
| 3 | Every web checkout now sends `telemetry` and passes the anti-bot check. The fallback rules block anyone who confirms within 2.5 s of opening checkout while clicking fast. `?bot` or `window.simulateBot()` triggers a demo block. | [booking](02-modules/booking-payment.md#anti-bot-check--how-a-normal-customer-is-scored) |
| 4 | Local ML model files are legacy-format; inference raises → Node fallbacks. Model files are git-ignored. | [ML service](functions/ml-service.md) |
| 5 | NFT minting is simulated unless `POLYGON_PRIVATE_KEY` is set; `.env.example` uses different variable names. Transfers/resale are not reflected on-chain. | [blockchain](02-modules/blockchain-nft.md) |
| 6 | `buyResaleTicket` has a check-then-act race (unconditional listing update). | [transfers & resale](02-modules/transfers-resale.md#concurrency-observed) |
| 7 | `updateEventPricing` / `publishEventWithPricing` update tiers by id without checking event ownership of the tier; `publishEventWithPricing` does not publish. | [events API](functions/api-events.md) |
| 8 | Socket.IO rooms are joined without authentication; `notification_<id>` and seat events (with holder ids) are broadcast to all clients. | [realtime](09-state-realtime-config.md#3-socketio-events) |
| 9 | `POST /api/notifications/test` lets any user notify/e-mail any user id; intent reminders can target any user id. | [notifications API](functions/api-notifications-email.md#api-notif-sendtest) |
| 10 | `GET /api/tickets/:ticketId/transfer-history` and `GET /api/tickets/nft/:id` have no ownership check. | [transfers API](functions/api-resale-transfer-nft.md) |
| 11 | `NotificationBell` (the only realtime notification listener) is never rendered; the header polls every 60 s. | [notifications](02-modules/notifications-email.md) |
| 12 | Legacy `/api/gate/*` scanner remains mounted (non-conditional admission, no payment check, any gate staff may fetch any rotating QR). | [tickets, QR & gate](functions/api-tickets-qr-gate.md) |
| 13 | `getMyNFTTickets` and transfers/listings do not require the order to be paid (placeholder tickets are `ACTIVE`). | [tickets](functions/api-tickets-qr-gate.md), [transfers](02-modules/transfers-resale.md) |
| 14 | Event views, category views and legacy seat selections are tracked twice (client + server); checkout start writes three rows (page + two server rows); every venue-hold release, even a simple deselect, is recorded as `checkout_abandoned`. | [behaviour & AI](02-modules/behavior-analytics-ml.md#5-the-data) |
| 15 | Organizer attendance prediction, fraud feeds and intent scores are fixed rules / seed data presented as AI output. | [dashboards](02-modules/dashboards-admin.md) |
| 16 | `mlService` fetches have no timeout. | [behaviour & AI](02-modules/behavior-analytics-ml.md#8-failure-behaviour) |
| 17 | Broken npm scripts: root `dev:ml`, `build:api`; contracts `deploy:amoy`. `test_health.py` root assertion outdated. | [scripts](functions/scripts-tests-infra.md), [ML service](functions/ml-service.md) |
| 18 | `changePassword` intends to keep the current session but the refresh cookie is not sent to `/api/users/*` (path-scoped), so all sessions are revoked. | [auth API](functions/api-auth-accounts.md) |
| 19 | Seed layout helper re-points existing tickets to arbitrary new seats. | [scripts](functions/scripts-tests-infra.md) |
| 20 | `autoProvisionVenueLayout` is unused; `requireApprovedCompany` is used only via its alias. | [venues API](functions/api-venues-seats.md) |
| 21 | The wallet's "Check my pass" reports every valid pass as invalid: `verifyTicketQRPost` tests for the prefix `TL1:`, but passes start with `TL1.`. | [tickets API](functions/api-tickets-qr-gate.md#api-ticket-verifyqr) |
| 22 | Behaviour-profile `summary.categoryAffinity` is a fixed pair of labels ("PSL Cricket" and "Music Concert") filled with view counts, and `topCategory` is an event name. | [analytics API](functions/api-analytics-ml.md#api-behavior-profile) |
| 23 | Root `scripts/` are manual demos. `test_live_mint.mjs` overwrites token data on the newest ticket, and `mint_to_user.mjs` hard-codes Hardhat's public development key. `Checkout.jsx` falls back to a hard-coded Stripe test publishable key. | [scripts](functions/scripts-tests-infra.md#root-scripts-folder-manual-demo-scripts) |

## Changes since the first edition (`cbe37ba` → `1ac4075`)

| Commit | Change in the code | Pages revised |
|---|---|---|
| `fad6f72` | `verifyTicketQRPost` now routes three ways (the `TL1:` prefix bug) and returns 400 when a pass is invalid. Wallet `qr` gains `payload`/`nonce`. Behaviour profile gains `summary`. Seed adds a PENDING company. `publishEventWithPricing` message changed. Test fixtures updated. | [tickets API](functions/api-tickets-qr-gate.md), [web pages](functions/web-pages.md), [analytics API](functions/api-analytics-ml.md), [scripts](functions/scripts-tests-infra.md), [events API](functions/api-events.md) |
| `2208b32` | Stripe: `stripeClient`, real PaymentIntent create/retrieve; Checkout uses Stripe Elements `CardElement` + `confirmCardPayment`; new web deps `@stripe/stripe-js`, `@stripe/react-stripe-js` | [booking module](02-modules/booking-payment.md), [booking API](functions/api-booking-payment.md), [config](09-state-realtime-config.md), [architecture](01-architecture.md) |
| `690ea08` | Venue `createHold` tracks `seat_selected` and `seat_locked`; `releaseHold` tracks `checkout_abandoned`. Checkout posts `checkout_started` and, on discard, `checkout_abandoned`. | [behaviour & AI](02-modules/behavior-analytics-ml.md), [venues API](functions/api-venues-seats.md) |
| `87aa15d`, `f991cc5` | Checkout always sends telemetry (time on page, click rate; bot profile through `?bot` or `window.simulateBot()`). Blocked notice lists the anomaly signals. `scripts/simulate_scalper_bot.js` added. | [booking module](02-modules/booking-payment.md), [web pages](functions/web-pages.md#web-checkout-submit), [behaviour & AI](02-modules/behavior-analytics-ml.md) |
| `cc26c42`, `89489d6`, `30e167b`, `1a91b0d` | Hardhat `localhost` network; `nftService` checksums the recipient address; root `scripts/` for local minting and a live checkout demo | [blockchain](02-modules/blockchain-nft.md), [NFT API](functions/api-resale-transfer-nft.md), [scripts](functions/scripts-tests-infra.md#root-scripts-folder-manual-demo-scripts) |
| `fc8018d`, `7e93840` | Profile `connectMetaMask` first switches the wallet to Polygon Amoy (80002); behaviour tiles read `scores` | [web pages](functions/web-pages.md) |
| `1ac4075` | Adds `TICKETLEDGER_FYP_VIVA_GUIDE.md` (documentation only) | [file inventory](04-file-inventory.md) |
