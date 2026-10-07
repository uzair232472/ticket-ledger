# Function catalogue — behaviour tracking, ML, intent analytics & dashboards

[← Function catalogue index](README.md) · Module walkthroughs: [Behaviour analysis & AI](../02-modules/behavior-analytics-ml.md) · [Admin & organizer dashboards](../02-modules/dashboards-admin.md)

Files: `apps/api/src/services/behaviorService.js`, `controllers/behaviorController.js`, `services/mlService.js`, `controllers/mlController.js`, `services/intentAnalyticsService.js`, `controllers/intentAnalyticsController.js`, `services/adminService.js`, `controllers/adminController.js`, `services/organizerDashboardService.js`. The Python service is on its own page: [ML service (Python)](ml-service.md).

> **What is really "AI" here (summary — details in the [module walkthrough](../02-modules/behavior-analytics-ml.md)):**
> - Three scikit-learn models exist in `apps/ml-service` (fraud classifier, intent regressor, demand regressor + demand-level classifier), trained on **synthetic** CSV data. They are reached over HTTP through `mlService.js`.
> - In the running web app, the models are only consulted by: the **Demand Forecast** page (`/api/events/:id/prelaunch-forecast` and the `/api/ml/demand-forecast` fallback). The fraud model is reached only if a client sends `telemetry` to `/api/bookings/initiate` or calls `/api/ml/fraud/score` — the web app does neither.
> - Intent scores on the analytics dashboards, the attendance/no-show prediction, the fraud feeds and the behaviour-profile scores are **hand-written rules**, not model output.

---

## `behaviorService.js`

`BEHAVIOR_ACTIONS` (`:5`) — 15 action strings: `event_view, category_view, seat_selected, seat_locked, checkout_started, checkout_abandoned, payment_completed, payment_failed, ticket_purchased, ticket_transferred, resale_viewed, resale_attempted, gate_checked_in, wallet_connected, login`. Other action strings written elsewhere: `CHECKOUT_BOT_EVALUATION` (booking), `AI_BOT_EVALUATION`, `AI_DEMAND_FORECAST`, `AI_INTENT_EVALUATION` (mlController), and seed-only `bot_risk_flagged`, `rapid_clicks`.

<a id="api-behavior-extractsessionid"></a>
### `extractSessionId(req, userId)` — `:26`
First of: `x-session-id` header (the web app always sends it — `utils/api.js` request interceptor), `body.sessionId`, `query.sessionId`; else `sess_usr_<first 8 of userId>_<YYYY-MM-DD>` for signed-in users; else `guest_sess_<random>`.

<a id="api-behavior-trackbehavior"></a>
### `trackBehavior({req, userId, sessionId, action, eventId, metadata})` — `:45`
- **Purpose:** record one row in `BehaviorEvent`.
- **Steps:** user = explicit `userId` or `req.user.id` or null; session = explicit or `extractSessionId`; missing `action` → warn, return null; **insert** `{userId, sessionId, action, eventId, metadata + ip + userAgent + timestamp}`.
- **Async:** returns a Promise, but every caller in the API except `behaviorController.recordClientEvent` calls it **without `await`** (fire-and-forget), so a slow or failing insert never delays the response. All errors are caught and logged ("telemetry should never break payment/checkout").
- **Callers (server-side tracking):** `authController.trackLogin` (LOGIN), `eventController.getEvents` (CATEGORY_VIEW when filtered by type) and `getEventById` (EVENT_VIEW), `seatController.lockSeat` (SEAT_SELECTED + SEAT_LOCKED), `venueController.createHold` (SEAT_SELECTED + SEAT_LOCKED, since `690ea08`) and `releaseHold` (CHECKOUT_ABANDONED, reason `seat_hold_released`), `bookingController.initiateBooking` (CHECKOUT_STARTED), `confirmBooking` (PAYMENT_FAILED / PAYMENT_COMPLETED + TICKET_PURCHASED), `cancelBooking` (CHECKOUT_ABANDONED), `ticketTransferController` (TICKET_TRANSFERRED), `resaleController` (RESALE_ATTEMPTED, RESALE_VIEWED), `userController.updateWallet` (WALLET_CONNECTED), `gateController.scanTicket` (GATE_CHECKED_IN, legacy), and `behaviorController.recordClientEvent` (client-sent actions).
- **Duplicate counting (observed):** the web app *also* sends `event_view` (`EventDetails.jsx:153`), `category_view` (`Events.jsx:142`) and `seat_selected` (`SeatMap.jsx:320`) through `trackClientBehavior`, while the server records the same actions for the same requests — so these actions are typically stored **twice** per user action.
- **Venue-plan holds (since `690ea08`):** every successful `POST /api/venues/event/:id/holds` writes `seat_selected` **and** `seat_locked` (metadata = request body + hold count), and every `holds/release` writes `checkout_abandoned` — including a simple deselect on the seat map or removing a line from the cart, so "abandoned" counts now include ordinary seat changes. The Checkout page additionally posts `checkout_started` when it opens and `checkout_abandoned` (reason `user_discarded_tickets`) on *Discard all*, which then also triggers the server-side `checkout_abandoned` through the release call (two rows).

### `attachSessionToUser({sessionId, userId})` — `:88`
`updateMany` behaviour rows with that `sessionId` and no user → set `userId` (links anonymous browsing to the account after login). Callers: `authController.trackLogin`, `behaviorController.linkSessionToUser`.

<a id="api-behavior-profile"></a>
### `getUserBehavioralProfile(userId, sessionId)` — `:112`
1. Attach the session's anonymous rows to the user (errors ignored).
2. Load the user (throws "User not found").
3. Load the **latest 100** behaviour rows of the user (or the session) with event name/type/city/venue.
4. Count each `BEHAVIOR_ACTIONS` type into `counts` (15 counters).
5. Build `telemetryFeatures` (e.g. `dwell_time_seconds = min(300, 30 + eventsViewed × 20)`, `abandonment_ratio`).
6. **Intent:** calls `mlService.predictPurchaseIntent(...)` — **this function does not exist in `mlService.js`** (it exports `scorePurchaseIntent`). The call throws `TypeError`, which is caught, so the **fallback always runs**: `score = clamp(10, 98, views×5 + seatsSelected×10 + checkoutsStarted×15 + paymentsCompleted×20)`; tier `HIGH` > 65, `MODERATE` > 35, else `LOW`.
7. **Fraud:** calls `mlService.predictFraud(...)` — **also does not exist** (the real one is `checkFraudRisk`). Always caught → `fraudScore = 14`, level `LOW`.
8. Returns `{user, stats: counts, totalEventsTracked, scores:{purchaseIntent:{score, tier, description}, fraudRisk:{score, level, isBot, description}}, summary, timeline}`. `summary` (added in `fad6f72`, `:314`) repeats intent score/level and action count, maps the fraud level to `LOW_RISK`/`SUSPICIOUS`/`CRITICAL_BOT`, sets `topCategory` to the **name of the first event** found in the timeline (not a category; default "PSL Cricket"), and returns a **fixed** `categoryAffinity` list — "PSL Cricket" with the event-view count and "Music Concert" with the category-view count — regardless of what was actually viewed.
- **Callers:** `GET /api/behavior/profile` (`Profile.jsx:158`, `BehaviorProfile.jsx:102`) and `GET /api/behavior/user/:userId`.

## `behaviorController.js` (`/api/behavior`)

| Handler | Route & guards | Behaviour | Web caller |
|---|---|---|---|
| `recordClientEvent` (`:7`) | `POST /track` (`optionalAuth`) | 400 without `action` (any string is accepted — not validated against the list); `trackBehavior` with the body's `sessionId` or header; returns the row. | `trackClientBehavior` in `utils/api.js` ← `EventDetails`, `Events`, `SeatMap`, `BehaviorProfile` simulator; direct `api.post` from `Checkout.jsx:223,241` |
| `getMyBehaviorProfile` (`:41`) | `GET /profile` (auth) | `getUserBehavioralProfile(req.user.id, x-session-id)`. | `Profile.jsx:158`, `BehaviorProfile.jsx:102` |
| `getUserBehaviorProfileById` (`:60`) | `GET /user/:userId` (SUPER_ADMIN, ORGANIZER) | Organizers only for users with an order in one of their events (403 otherwise). | none found |
| `linkSessionToUser` (`:87`) | `POST /attach-session` (auth) | 400 without `sessionId`; `attachSessionToUser`. | none found (login does it server-side) |

---

## `mlService.js` — HTTP client for the Python ML service

`ML_SERVICE_URL` (`:4`) = env or `http://localhost:8000`. Uses Node's global `fetch` with **no timeout** (a hung ML service makes the calling request wait until the TCP connection fails). `ML_EVENT_TYPE` / `mlEventType(type)` (`:101-108`) map event types the models were not trained on to the closest trained one (hockey → football; qawwali, theatre, conference → concert; general admission → festival).

<a id="api-ml-checkfraudrisk"></a>
### `checkFraudRisk(telemetry)` — `:9`
- **Input (camelCase, defaults):** `checkoutDurationSeconds 25, clicksPerMinute 30, rapidSeatAttempts 1, timeOnSeatmapSeconds 18, deviceSwitches 0, ticketsRequested 1`, optional `accountAgeDays, totalAmount, failedPayments, ipCityMismatch, resaleAttempts`.
- **Transformation:** to snake_case JSON; also duplicates `purchase_speed_seconds = checkout_duration_seconds` and `ticket_count = tickets_requested`.
- **Call:** `POST {ML}/fraud/score`; on HTTP 404 retry `POST /predict/fraud`; non-OK → throw.
- **Fallback (any error):** `score = 10 (+55 if duration < 2.5 s) (+25 if clicks > 150/min) (+20 if seat attempts ≥ 6)`; `risk_level` CRITICAL_BOT ≥ 75, SUSPICIOUS ≥ 45, else LOW; `fallback: true`.
- **Callers:** `bookingController.initiateBooking` (only when the request body has `telemetry`), `mlController.checkFraud`.

<a id="api-ml-forecast"></a>
### `forecastEventDemand(eventParams)` — `:110`
- **Input defaults:** `eventType CRICKET_MATCH, city Lahore, marketingTier MEDIUM, venueCapacity 25000, avgTicketPrice 2500, isWeekend 1, publishHour 18`, optional `ticketPrices, dayOfWeek, popularityScore, marketingScore`.
- **Call:** `POST /forecast/demand` (404 → `/predict/demand`).
- **Fallback:** `projected_48h_sales = floor(capacity × 0.78)`, revenue = sales × price, `sellout_probability 0.78`, tier `HIGH`.
- **Callers:** `eventController.getPreLaunchDemandForecast`, `mlController.forecastDemand`.

### `scorePurchaseIntent(sessionParams)` — `:177`
- **Call:** `POST /intent/predict` (404 → `/predict/intent`) with `event_views, seat_selection, checkout_started, checkout_abandoned, ticket_price, city, event_type, previous_purchases` (+ legacy fields).
- **Fallback:** score 85 if `checkoutStarted` else 45.
- **Callers:** only `mlController.scoreIntent` (`POST /api/ml/intent/predict`), which **has no web caller**.

### `triggerModelTraining(modelType)` — `:241`
Validates `intent|fraud|demand`, `POST /train/<type>`, returns JSON or throws with the service's `detail`. No fallback. Caller: `mlController.trainModel`.

## `mlController.js` (`/api/ml`)

The "optional" auth on the scoring routes (`mlRoutes.js:17`) authenticates when a Bearer header is present (invalid tokens → 401).

| Handler | Route & guards | Behaviour | Web caller |
|---|---|---|---|
| `checkFraud` (`:8`) | `POST /fraud/score`, `/fraud-check` | `checkFraudRisk(body)` → **stores** a `BehaviorEvent` `AI_BOT_EVALUATION` with telemetry and result → if `is_bot` and signed in, AuditLog `SCALPER_BOT_FLAGGED`. | none |
| `forecastDemand` (`:72`) | `POST /forecast/demand`, `/demand-forecast` | `forecastEventDemand(body)` → stores `AI_DEMAND_FORECAST`. | `DemandForecast.jsx:92` (fallback when the event-based forecast fails) |
| `scoreIntent` (`:117`) | `POST /intent/predict`, `/intent-score` | `scorePurchaseIntent(body)` → stores `AI_INTENT_EVALUATION`. | none |
| `trainModel` (`:159`) | `POST /train/:modelType` (SUPER_ADMIN) | `triggerModelTraining` → AuditLog `ML_MODEL_RETRAINED`. | none |
| `getPredictionHistory` (`:198`) | `GET /predictions` (SUPER_ADMIN) | Latest stored `AI_*` rows (optionally one action). | none |
| `getFraudWatchlist` (`:242`) | `GET /fraud-watchlist` (SUPER_ADMIN) | Latest `AI_BOT_EVALUATION` rows with user and stored scores + counts of `CRITICAL_BOT` / `SUSPICIOUS`. **Note:** booking-time evaluations are stored as `CHECKOUT_BOT_EVALUATION` and are **not** included. | `AdminFraudWatchlist.jsx:45` |
| `freezeUserAccount` (`:307`) | `POST /freeze-user/:userId` (SUPER_ADMIN) | Status `SUSPENDED`, revoke all refresh tokens, AuditLog. No protection against freezing another Super Admin (unlike `adminService.updateUserStatus`). | `AdminFraudWatchlist.jsx:67` |
| `unfreezeUserAccount` (`:353`) | `POST /unfreeze-user/:userId` (SUPER_ADMIN) | Status `ACTIVE`, AuditLog. | `AdminFraudWatchlist.jsx:67` |

---

## `intentAnalyticsService.js` — rule-based funnel and "intent" scoring

<a id="api-intent-geteventintent"></a>
### `getEventIntentAnalytics(eventId, requesterUser)` — `:8`
1. Load event + company + tiers; throw if missing; non-admin must own the company (403).
2. Load **all** `BehaviorEvent` rows of the event (with user) and all orders of the event.
3. Group rows by `userId` or, for guests, `sessionId`; count views, seat selections (`seat_selected`/`seat_locked`), checkout starts, abandons, payments, tickets; build funnel sets (a `checkout_started` also counts as viewed and seat-selected).
4. Add every `SUCCESSFUL` order's user to payment/ticket sets.
5. Funnel stages Viewed → Seat Selected → Checkout Started → Payment Completed → Ticket Issued, each with `count`, `percent` of viewers (viewers floor 1) and `dropoff`.
6. **Intent score per person (rules, not ML — despite the comment "Use ML intent calculation"):** start 40; +15 if ≥3 views; +20 if any seat selection; +25 if any checkout start; −10 if any abandon; = 95 if bought; clamp 10–99. Level HIGH ≥ 75, MODERATE ≥ 55, else LOW, each with a fixed recommended action.
7. `usersLikelyToBuy` = score ≥ 55; `abandonedUsers` = abandoned, or started checkout/selected seat without buying (with stage and recovery action).
8. Returns summary, funnel and both lists (sorted by score). `mlService` is imported but unused here.
- Callers: `GET /api/analytics/intent/:eventId` ← `PurchaseIntentAnalytics.jsx:77`; `sendBatchAttendeeReminders`.

### `sendAttendeeReminder({eventId, targetUserId, reminderType, customMessage, requesterUser})` — `:286`
Ownership check (403) → target user must exist → [`dispatchNotification`](api-notifications-email.md#api-notif-dispatch) (DB row + email via hook + Socket.IO + mock push) → AuditLog `ORGANIZER_SENT_INTENT_REMINDER`. **The target is not checked against the event's audience**, so an organizer can message any user id. Caller: `POST /api/analytics/intent/:eventId/send-reminder` ← `PurchaseIntentAnalytics.jsx:112`.

### `sendBatchAttendeeReminders({eventId, targetAudience, requesterUser})` — `:367`
Recomputes analytics, picks `abandonedUsers` (`ABANDONED`) or `usersLikelyToBuy`, keeps registered users, sends sequentially; failures are counted out, not thrown. Caller: `PurchaseIntentAnalytics.jsx:138`.

<a id="api-intent-abandoned"></a>
### `getAbandonedIntentDashboard({eventId, minScore, reason, limit, requesterUser})` — `:415`
1. Scope: organizer's company events (empty result without a company), optionally one event.
2. Load behaviour rows of those events, `SUCCESSFUL` orders and `ACTIVE` tickets (a ticket of an unpaid checkout also counts as "bought").
3. Group per (user or session, event); flags `selectedSeat`, `startedCheckout`, `abandonedCheckout`; track last action.
4. Skip buyers and people who never selected a seat/started checkout.
5. **Score (rules):** 45 +10 (≥2 views) +15 (seat) +20 (checkout) −10 (abandoned), clamp 15–95; optional `minScore` filter.
6. **Cart value:** `latestMetadata.cartValue` if present, else `2 ×` the first tier's price. Because the row's `event` include selects no tiers, the fallback price is effectively always 2500 → cart value 5000 (observed).
7. **Likely reason (rules):** explicit `payment_hesitation|payment_failure` → `PAYMENT_FRICTION`; cart ≥ 7000 → `HIGH_TICKET_PRICE`; seat but no checkout → `SEAT_LOCK_TIMEOUT`; ≥ 4 views → `COMPARISON_SHOPPING`; else `BROWSER_HESITATION`; optional `reason` filter.
8. Summary: count, recoverable revenue (sum of cart values), average score, top reason, registered drop-outs; list sorted by last action, cut to `limit`.
- Caller: `GET /api/analytics/abandoned` ← `AbandonedIntentDashboard.jsx:106`.

### `sendAbandonedCartReminder({targetUserId, eventId, customMessage, discountCode='RECOVER10', requesterUser})` — `:691`
Same pattern as `sendAttendeeReminder` with type `ABANDONED_CHECKOUT_REMINDER` and a message mentioning the discount code. **Discount codes are not implemented anywhere in checkout** — the code is text only. Caller: `AbandonedIntentDashboard.jsx:142`.

### `sendBatchAbandonedCartReminders({eventId, discountCode, requesterUser})` — `:769`
Recomputes the dashboard and sends to every registered drop-out. Caller: `AbandonedIntentDashboard.jsx:175`.

## `intentAnalyticsController.js` (`/api/analytics`, ORGANIZER or SUPER_ADMIN)
Six thin handlers (`getEventIntentAnalytics :6`, `sendAttendeeReminder :27` — 400 without `targetUserId`, `sendBatchAttendeeReminders :61`, `getAbandonedDashboard :86` — parses `limit`, `sendAbandonedReminder :113` — 400 without `targetUserId`/`eventId`, `sendBatchAbandonedReminders :144`) that call the service and map `error.status` (403) or 500.

---

## `organizerDashboardService.js`

<a id="api-orgdash-metrics"></a>
### `getOrganizerDashboardMetrics({organizerUser, eventId})` — `:7`
1. Organizer → own company (else `{hasCompany:false}`); admin → all events.
2. Events of the scope (with review fields); none → zeroed structure.
3. Optional `eventId` must be in scope (403).
4. **Revenue:** sum of `SUCCESSFUL` order totals; platform fee **5 %** (hard-coded); net.
5. **Sales graph:** orders grouped by `YYYY-MM-DD` (tickets, revenue, orders).
6. **Tiers:** sold = `totalQuantity − availableQuantity` (note: `availableQuantity` is decremented when a checkout *starts*, so unpaid checkouts count as sold until they expire), revenue = sold × price.
7. **Gate pacing:** counts `GateScan` results (also written by the current check-in via `logScan`).
8. **Attendance prediction — fixed rules:** default 88.5 %; cricket 92.4, music 86.8, kabaddi 89.1; +2 points for Lahore/Karachi; clamp 65–98; `confidenceScore: 0.91` is a constant. **No model is used** — the `attendance_no_show.csv` dataset has no training script.
9. **Fraud feed:** latest 10 rows with actions `bot_risk_flagged, rapid_clicks, seat_rapid_click, fraud_score_computed` — only the seed script writes such actions; real ML evaluations (`AI_BOT_EVALUATION`, `CHECKOUT_BOT_EVALUATION`) never appear here. Missing scores default to 85/60.
10. Previews: count of `event_view` and `checkout_abandoned` rows; `recoverablePkr = abandoned × 3500`.
- Caller: `GET /api/organizer/organizer-dashboard` (also `/api/admin/organizer-dashboard`) ← `OrganizerDashboard.jsx:156`.

## `adminService.js` (all behind SUPER_ADMIN routes except as noted)

| Function | Line | Behaviour |
|---|---|---|
| `getSuperAdminMetrics()` | `:9` | 15 parallel counts/aggregates: users (active, suspended, banned), companies (pending), events (published), orders (successful), tickets (scanned), gate scans, audit logs, revenue sum; fee = 5 %; `turnoutRate`. |
| `getUsersList({page, limit, search, role, status})` | `:89` | Paginated users with search over name/email/phone/wallet, role/status filters, company and `_count`. |
| <a id="api-admin-updateuserstatus"></a>`updateUserStatus({userId, status, reason, adminUser})` | `:158` | Allowed `ACTIVE|SUSPENDED|BANNED|DEACTIVATED` (400); 404; refuses changing **another** Super Admin (403); updates status; blocked statuses → `revokeAllRefreshTokens`; AuditLog (`USER_SUSPENDED`/`BANNED`/`DEACTIVATED`/`REACTIVATED`/`STATUS_UPDATED`); `dispatchNotification` type `SYSTEM_ALERT` (failure only logged). |
| `getAllEventsAdmin({...})` | `:247` | Paginated events with company, tiers, counts; adds capacity/sold/available/occupancy from tier quantities. |
| `getAllTransactionsAdmin({...})` | `:319` | Paginated orders with search (order id, payment tx, user, event), status and payment-method filters. |
| `getBlockchainLogs({...})` | `:376` | Paginated **tickets** presented as "blockchain logs" (token, txHash, wallet, transfer history). Missing contract address is displayed as a hard-coded placeholder address. Data comes from PostgreSQL, not from the chain. |
| `getFraudAlerts({page, limit, minScore})` | `:446` | Behaviour rows with actions `bot_risk_flagged, rapid_clicks, seat_rapid_click, fraud_score_computed, checkout_abandoned` (so every abandoned checkout appears as an alert); missing score → 88 if `isBot` else 65; `minScore` is accepted but **unused**. |
| `getGateScanLogs({...})` | `:505` | Paginated `GateScan` rows with staff, ticket holder, event, seat. |
| `getAuditLogs({...})` | `:554` | Paginated `AuditLog` with action filter and search. |

## `adminController.js` (`/api/admin`, and the same router again at `/api/organizer`)
Ten thin handlers (`getSuperAdminMetrics :7`, `getUsersList :20`, `updateUserStatus :34` — 400 without `status`, `getAllEventsAdmin :59`, `getAllTransactionsAdmin :73`, `getBlockchainLogs :87`, `getFraudAlerts :101`, `getGateScanLogs :115`, `getAuditLogs :129`, `getOrganizerDashboard :143` — ORGANIZER or SUPER_ADMIN) that pass query parameters to the services and map `error.status`. Callers: `SuperAdminDashboard.jsx` (see the [web pages catalogue](web-pages.md)).
