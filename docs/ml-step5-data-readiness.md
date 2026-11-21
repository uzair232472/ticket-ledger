# Step 5: real-data validation and dataset infrastructure

Status on 2026-11-21. TicketLedger runs locally and has **no genuine external customers yet**. This step builds
everything needed to collect, verify, prepare, train and evaluate on genuine data automatically once real use
begins, and it reports readiness honestly. **No real-world validation has been possible yet.** Nothing here
deploys a model, changes a decision, or enables live payments.

Related: `docs/ml-real-data-retraining.md` (Stage 4 exporter, snapshots, integrity, retraining).

## 1. What data exists (main development database, read-only inventory)

| Source | What is there | Usable as genuine customer data? |
|---|---|---|
| Accounts | 22 customers, 17 organizers, 5 gate staff, 1 admin (seed, internal and developer accounts) | No: all from before genuine use began |
| Events | 17 (16 with price tiers) | No |
| Orders | 29: **25 paid** (20 MOCK, 4 Stripe-flow orders completed by the simulated fallback because the Stripe key is a placeholder, 1 simulated JazzCash) and **4 failed** (2 Stripe, 1 MOCK, 1 JazzCash) | No: no Stripe API call was ever made; no server-verified payment |
| Tickets / check-ins / gate scans | 29 tickets (5 checked in), 54 check-ins, 22 gate scans | No |
| Behaviour log | 2,129 events (574 anonymous), 2026-09-26 to 2026-11-17 | No |
| ML prediction log, fraud samples, reviews, payment evidence | 0 rows each | Nothing yet |
| Synthetic datasets (`apps/ml-service/data/`) | 5 files, about 297,000 rows, seed 42 (v0 models) | SYNTHETIC: development only |
| Legacy formula data (`dev/legacy-synthetic/`) | 4 files + test splits | SYNTHETIC: never used |
| Public datasets | Online Shoppers (fetched), Online Retail II (catalogued) | PUBLIC: experiments only |

A database export of the main development database today keeps **0 rows** in all nine datasets: every record is
classified INTERNAL_TEST.

## 2. Data-source classes (never mixed without tracking)

| Class | Definition | Where |
|---|---|---|
| SYNTHETIC | Generated for development | `data/manifest.json` `source_class: SYNTHETIC`; training needs `--allow-synthetic` |
| PUBLIC | External, licensed, documented | `data/public/<name>/manifest.json` `source_class: PUBLIC`; `ml.train` refuses it |
| INTERNAL_TEST | Developers, testers, seed and demo data | Everything the exporter leaves out under that class (counted in `export_report.md`) |
| GENUINE_CUSTOMER | Real customer activity, verified | The only class a database export contains (`manifest.source_class`) |

The rules that decide GENUINE_CUSTOMER, all in code and tested:
- **Accounts:** a `CUSTOMER` account, not a test or internal domain or excluded id (`dataPolicy.js`). It also needs
  its own live, server-verified purchase, or to be created after the platform's first live-verified payment.
  Pre-launch accounts with ordinary e-mail domains (developers, testers) are therefore INTERNAL_TEST.
- **Events:** a real organizer, plus a live-verified sale or creation after genuine use began.
- **Purchases:** server-side payment evidence with Stripe `livemode: true` (section 4). Never order rows, method
  names, browser messages or settings.
- **Anonymous visitors:** only genuine once linked to a genuine account at login (section 3).
- **Predictions are never labels.** Every label comes from a verified outcome.

## 3. Collection infrastructure (automatic once genuine users arrive)

| Activity | How it is recorded | New in Step 5 |
|---|---|---|
| Event views, category views, seat selections and locks, checkout starts | `BehaviorEvent` (existing) | |
| Searches | `search` with normalised text (80 chars), filters, result ids | yes |
| Wishlists | `wishlist_added` / `wishlist_removed` | yes |
| Checkout endings | AuditLog `CHECKOUT_ENDED` with reason (HOLD_EXPIRED, CUSTOMER_CANCELLED, SUPERSEDED, EVENT_CANCELLED), written in the same transaction as the status change; behaviour `checkout_expired` / `checkout_cancelled` / `seat_hold_released` | yes: cancellations and seat releases were recorded as `checkout_abandoned`; dashboards still count all of them as "left checkout" |
| Payment attempts, successes, failures, refunds, disputes | Payment behaviour events, `Refund`, and the Stripe webhook evidence (section 4) | webhook: yes |
| Sessions and repeat visits | Visits rebuilt from the behaviour log (30-minute gap); prior-session counts | |
| Anonymous → account | `attachSessionToUser` at login: only the last 30 days, never a session that already holds another account's activity (shared device), audited (`GUEST_ACTIVITY_LINKED`). Profile views no longer link silently. No fingerprinting | rules: yes |
| Recommendation impressions and clicks | `GET /api/events/recommendations`: rules, deterministic CONTROL (non-personalised popularity) vs PERSONALISED. A first-time visitor gets the population ranking. An exploration slot goes to under-exposed events. Every list is logged; a click is accepted only for an event in that visitor's list. **Not shown in the app yet** (that is Step 6) | yes |
| Gate scans and attendance | `CheckIn` (existing); late and corrected check-ins and exception admissions reported | report: yes |
| Event sales and demand | Snapshots at sales open, and new **hourly** snapshots while on sale | hourly: yes |
| Checkout snapshot | Logged at checkout start (`checkout_abandonment`), the agreed abandonment prediction moment | yes |
| Fraud outcomes | Blind reviews (Steps 1–4); disputes are now kept apart from fraud labels | disputes: yes |

Every prediction stores its exact prediction-time inputs, the prediction moment, the model version (SHADOW rows
reference `MlModel`) and later its verified outcome. Corrections are appended, never overwritten: reviews,
check-in reversals, audit rows.

## 4. Payment verification

| Provider | Status |
|---|---|
| Stripe | Server-side `paymentIntents.retrieve` (existing) **and a new signed webhook**, `POST /api/payments/stripe/webhook` (raw body, `STRIPE_WEBHOOK_SECRET`). Test and live are separate configurations: `STRIPE_MODE=test|live` must match the key prefix, and each event's `livemode` must match the mode, else the event is refused and audited. Events are processed once; outcomes are linked to the order by PaymentIntent (else `metadata.orderId`) and the amount must match. Successful payments become payment evidence; failures, refunds and disputes are recorded. The webhook never changes orders, payments or tickets |
| JazzCash, EasyPaisa | Simulated in `paymentService.js` (no provider call): never evidence |
| MOCK | Test checkout: never evidence |

Current configuration (`node scripts/payment-config-check.mjs`, prints no secrets): Stripe mode **test**, and the
secret key is a **placeholder** (`sk_test_mock…`, so `paymentService.js` creates no Stripe client at all and
no Stripe API is ever called). **No webhook secret is set**, and live payments are not possible. The 4 paid
"Stripe" orders carry `ch_<timestamp>` ids made up by the simulated fallback; they are not Stripe test-mode
transactions. No live credentials were created or enabled. Corrected on 2026-11-21: the Step 5 report said
"26 paid, 4 Stripe test mode"; the database has 25 paid and 4 failed, and no Stripe test-mode payment.

## 5. The eight features: data, evaluation, readiness

| Feature | Dataset (export) | Evaluation built | Development testing | Real data today |
|---|---|---|---|---|
| A. Purchase intent | `behavior_sequences` (visit snapshots) | Top-10% buyer share vs rule, calibration, first-time / returning | v0 synthetic; PUBLIC experiment (Online Shoppers) | 0 rows: blocked |
| B. Abandoned checkout | **`checkout_abandonment`** (checkout-start snapshots; agreed label) | Top-10% abandon share vs rule, false predictions, calibration, first-time / returning | fixture tests | 0 rows: blocked |
| C. Fraud | `fraud_purchases` (blind reviews, sampling weights, disputes apart) | Precision, false-flag rate ≤ 1%, recall | v0 synthetic (rejected); weighting tests | 0 rows: blocked |
| D. Customer behaviour | **`customer_behaviour`** + `behaviour_report` | Repeat purchases, spend, categories, engagement, first-time / returning | fixture tests | 0 customers: reports run, nothing to describe |
| E. Recommendations | **`recommendation_impressions`** + `recommendation_report` | CTR and 7-day purchases vs non-personalised control (bootstrap uplift), exposure, diversity | fixture tests | 0: not exposed in the app (Step 6) |
| F. Demand | `event_demand` (sales open) + **`demand_hourly`** (post-publication) | Weighted % error, zero sales handled, vs rule / pace | v0 synthetic; fixture tests | 0 rows: blocked |
| G. Attendance | `attendance_no_show` + attendance quality (sold, refunded, attended, no-shows, late, corrected) | Per-event attendance error vs historical show rate | v0 synthetic | 0 rows: blocked |
| H. Crowd flow | `crowd_flow` | Error per slot; gate-level, time-slot and condition breakdowns | v0 synthetic | 0 rows: blocked (no real gate data) |

**First-time customers.** Every model uses contextual inputs available for anyone: activity in this visit, event
category, price relative to the market, timing, sales pace, seats. A customer's history counts are explicit zeros
with `first_time = 1`, never estimates. Recommendations fall back to the population ranking. Every report
evaluates first-time and returning customers separately.

## 6. Training and evaluation

Unchanged gates (`ml/gates.py`; one new gate for the new model: at least 30 test-period events for hourly
demand). The rules:
- chronological splits, with customers, events and organizers held out;
- calibration and thresholds fitted on the validation period only;
- the newest 15% unseen for testing;
- comparison with the rules and the deployed shadow model on the same rows;
- bootstrap intervals; first-time and returning segments;
- `NOT_ENOUGH_DATA` below the minimums.

A candidate is never promoted for training accuracy.

## 7. Continuous learning (built; not scheduled)

`scripts/auto_retrain.py --data <export> [--min-new-rows N]`:
- validates the export and classifies its sources;
- reports drift (PSI per feature between the training and test periods);
- writes the recommendation and behaviour reports;
- retrains only models with enough (new) verified data and evaluates them against the rules and the deployed model;
- saves versioned candidates (`models/candidates/<stamp>/`) and reports, each with a recommendation.

A failed training run removes its partial candidate and is retried next time. **It never registers, promotes or
deploys anything.** Rollback is a manual step: `node scripts/ml-register-models.mjs <registry> --restore`
re-activates a retired artifact, as SHADOW only. No schedule was installed. Scheduling it against production
data needs authorization.

## 8. Security and reliability (verified)

- No secrets in tracked source; `.env` files are not tracked; payment checks print modes only.
- Exports and candidates are git-ignored. IDs are pseudonymised (SHA-256). Exports contain no names, e-mails,
  phones, wallets, IPs or payment details. Search text is normalised and truncated.
- If the ML service is down, the rules answer (existing fallbacks). Shadow logging never blocks a request.
- AI never rejects payments, invalidates tickets, blocks entry or finalises fraud decisions. Tests enforce that
  payment, ticket, refund and gate code never reads model output, and that `/fraud/score` is rules-only.

## 9. What genuine data must arrive before anything can be validated

1. A **live Stripe configuration** (live key, `STRIPE_MODE=live`, webhook secret) authorised by the business. Or real
   JazzCash / EasyPaisa integrations that confirm payments with the provider.
2. Genuine customers over at least 3 months, enough to reach each model's minimums (e.g. 800 buyers and 800
   non-buyers for intent; 400 confirmed frauds for fraud; 800 events for demand).
3. Recommendations shown to customers with the control group (a Step 6 decision).
4. Gate capacities set on real events, and real check-ins.

## 10. Exporter scaling: batching needed before production-scale collection

> **R0 status (2026-11-22): implemented.** Paging, grouped SQL, chunked lookups, streamed CSV output with
> incremental hashing, one read-only `REPEATABLE READ` snapshot per export, and the indexes (migration
> `20261124120000_export_and_payment_indexes`). The migration was applied to the main development database on
> 2026-11-22, after a verified backup and a restore rehearsal; all 61 business tables are byte-identical before and
> after.
>
> **Verification:**
> - same rows and report as the previous exporter at four export moments on both fixture worlds (327 to 720
>   rows);
> - identical output with a page size of 1 and with unordered query results reversed;
> - streamed files byte-identical to the in-memory export;
> - writes made during an export are not seen.
>
> **Two old-exporter bugs fixed:** `first_seen` / `last_seen` of customers without browsing came from database
> order (sometimes reversed), and a view without an event counted as an event viewed.
>
> The order of rows in the files is now the processing order (defined by every query), not sorted by time; the
> ML service sorts by time itself. The table below is the original review.

The exporter (`src/services/ml/export.js`) is correct at today's size (it finishes in about 1 second on the
development database) but is written for small data. Reviewed on 2026-11-21:

| Where | Today | Breaks at | Required change |
|---|---|---|---|
| `loadContext` | Loads **all** users, companies, events (with gates) and all live evidence into memory | ~10^6 users | Load only ids and classes needed (or a temp table of account classes); keep events in memory only per batch |
| `snaps()` (all 9 datasets) | Loads **every** RULES snapshot of a model, with its full `features` / `output` JSON | ~10^5–10^6 snapshots (GBs of JSON) | Keyset pagination on `(asOf, id)` in pages of ~5,000; process and write each page, then drop it |
| `IN (...)` lists (visits: orders and reminders `userId IN all users`; fraud: `id IN all orders`; attendance: `id IN all tickets of an event`) | One list with every id | PostgreSQL's 32,767 bind-parameter limit (query error), and slow plans long before | Chunk to ≤ 5,000 ids, or join against the page's ids in SQL |
| `exportDemand`, `exportDemandHourly` | 2 queries **per event / per hourly snapshot** (orders, then a ticket count) | Hourly: 1,000 events × 30 days × 24 h ≈ 720,000 snapshots ≈ 1.4 M queries | One SQL per event batch: verified tickets per hour (`date_trunc` / window over evidence-joined tickets), joined to the snapshots |
| `exportCheckouts` | 1 "later order" query **per checkout** | ~10^5 checkouts | One query per page: later orders of the same (user, event) within 24 h with a window function |
| `exportCustomerBehaviour` | Loads each customer's **whole** behaviour history and orders (2 queries per customer) | ~10^4 active customers | SQL aggregates `GROUP BY userId` (counts, first/last activity, categories, spend) |
| `exportRecommendations` | Loads all impressions and all clicks; one orders query per user | ~10^6 impressions | Page impressions by `createdAt`; clicks joined by list id through an index (below) |
| `attendanceQuality`, `exportCrowd` | 3–4 queries per event | ~10^4 events | Grouped counts per event batch |
| Output (`ml-export-datasets.mjs`) | Builds each CSV as one string, `writeFileSync`, hashes the file after | Hundreds of MB | Stream rows to a write stream per page; hash incrementally |
| De-duplication (`Rows`) | In-memory key `Set` per dataset | ~10^7 rows | Unique by construction from the database (or a sorted external merge) |
| Consistency | Many separate reads while the app keeps writing | Any size under live traffic | Run in one read-only `REPEATABLE READ` transaction, or (preferred) against a restored backup or a read replica, never the primary under load |

Indexes the batched version needs (a migration, only with the usual backup and rehearsal):
- `MlPrediction (modelName, role, subjectType, asOf, id)`. Today only `(modelName, createdAt)` exists.
- `BehaviorEvent (action, createdAt)` and `(userId, createdAt)`. Today they are single-column.
- An expression index on `BehaviorEvent ((metadata->>'listId'))` for recommendation clicks, or a dedicated
  impressions table (section 12).
- `AuditLog (action, targetType, targetId)`, also needed for webhook idempotency (section 11).
- `Ticket (eventId, createdAt)` and `Order (eventId, createdAt)`, `Order (userId, eventId, createdAt)`.

Acceptance before production-scale collection:
- the batched exporter produces **byte-identical** CSVs to the current one on the fixture worlds of
  `test_ml_export.mjs` and `test_step5.mjs`;
- a performance test on a `*_verify` copy filled with a generated load fixture (labelled SYNTHETIC, used for
  timing only, never exported as data) stays within a fixed memory bound (e.g. 1 GB) and time budget.

No gate or label definition changes.

## 11. Requirements for genuine Stripe payments and live webhook verification

Today: **no Stripe account is connected** (placeholder key). Nothing below has been done; each step needs the
business's authorisation.

**A. Business prerequisites (blocking)**
1. A Stripe account for the business that sells the tickets. Stripe's availability page (stripe.com/global,
   read 2026-11-21) does **not** list Pakistan. A live account therefore needs a legal entity in a supported
   country, or a different provider. Real JazzCash / EasyPaisa merchant integrations would need their own
   server-side verification (provider callbacks with signature or hash checks, status inquiry APIs), built
   like the Stripe one.
2. Confirm PKR charging and settlement for that account in the Stripe Dashboard. The code sends
   `currency: 'pkr'` with amounts in paisa (×100), and I could not confirm PKR support from the public
   currencies page. Also legal terms, refund policy and tax handling for live sales.

**B. Code changes required before any live key is set (blocking)**

> **R0 status: B1–B4 implemented, with B5 left for the live set-up.**
> - **B1:** fail-closed Stripe provider (`services/payments/`); JazzCash and EasyPaisa disabled; the MOCK test
>   checkout refused in production and live mode; resale purchases refused wherever real payments are required.
> - **B2:** the startup check.
> - **B3:** database-enforced webhook and evidence idempotency.
> - **B4:** only `orderId` in the PaymentIntent metadata.
> - **B5 (restricted live key):** a configuration step for the live set-up.
1. **Fail closed.** `paymentService.verifyPayment('STRIPE')` today returns success **without** asking Stripe
   in two cases: there is no Stripe client (placeholder key), or the retrieve call fails while the browser
   sent a `paymentTxId`. That is how the 4 "Stripe" orders were paid. With `STRIPE_MODE=live`, verification
   must succeed only after `paymentIntents.retrieve` returns `status: succeeded` and `livemode: true`, with
   the matching amount and order. Any error must mean "not paid, retry". The same applies to the simulated
   JazzCash / EasyPaisa paths (any 6-digit OTP is accepted): they must be disabled when live payments are on.
2. **Startup check.** The server refuses to start with `STRIPE_MODE=live` unless the key is `sk_live_` /
   `rk_live_`, `STRIPE_WEBHOOK_SECRET` (`whsec_…`) is set, the publishable key is `pk_live_`, and
   `NODE_ENV=production`. It also refuses a live key with `STRIPE_MODE=test`. Today this is only reported by
   `scripts/payment-config-check.mjs`.
3. **Webhook idempotency in the database.** A unique index on the STRIPE_EVENT row
   (`AuditLog (action, targetType, targetId)` or a `StripeEvent` table). Today a `findFirst`-then-insert
   allows double processing if Stripe delivers the same event twice concurrently.
4. **Data minimisation.** PaymentIntent metadata currently includes the customer's e-mail and phone. Keep
   only `orderId`.
5. **Restricted key.** Use a restricted live key (PaymentIntents read/write, Refunds write) rather than the
   full secret key, stored in the server's secret store, never in the repository or the frontend.

**C. Configuration**
- `STRIPE_MODE=live`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`, frontend
  `VITE_STRIPE_PUBLISHABLE_KEY`) and `STRIPE_WEBHOOK_SECRET` from the **live-mode** webhook endpoint.
- Keep the test configuration separate: a separate deployment or Stripe sandbox with its own keys and
  webhook secret. Never both in one process.

**D. Live webhook endpoint**
- Dashboard → Developers → Webhooks, in **live mode**: `https://<public API host>/api/payments/stripe/webhook`,
  HTTPS only.
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
  `charge.dispute.created`, `charge.dispute.closed`.
- The route already verifies the signature on the raw body. Make sure no proxy or CDN rewrites the body,
  and keep the server clock in sync (signature timestamp tolerance).

**E. Verification before real customers (one controlled purchase by the business)**
1. `node scripts/payment-config-check.mjs` prints `mode live, key live, webhook configured, live payments
   possible: true`.
2. The Dashboard's "send test webhook" is a test-mode event, so it **must be refused** by the live endpoint
   (400, `STRIPE_WEBHOOK_MODE_MISMATCH` audited). This proves mode separation.
3. A staff member buys one low-priced ticket with a real card:
   - the order becomes SUCCESSFUL only after the server-side retrieve;
   - exactly one `PAYMENT_SERVER_VERIFIED` row with `livemode: true` from the checkout, and the webhook
     delivery adds its STRIPE_EVENT row (a re-delivery shows `duplicate: true`).
4. Refund that purchase from the admin flow: `PAYMENT_REFUND_VERIFIED` appears.
5. That purchase is staff activity. Its account must be excluded from datasets (excluded-user list or an
   internal domain), and the exporter must show it as INTERNAL_TEST. **Note:** the first live-verified
   payment also starts the "genuine use began" clock (section 2). If the staff purchase happens long before
   real customers, set the start explicitly (an `ML_GENUINE_FROM` setting, to be added) rather than letting
   staff tests define it.

## 12. Recommendation impressions, clicks and purchases once recommendations are displayed

> **R0 status:** item 5 is implemented. A visitor keeps the group of their first list, also after logging in
> and on later visits. Lists shown in the other group, from another device before linking, are left out of the
> comparison (`experiment group changed`). Items 2, 3, 4 (impressions on render, click beacon, list id carried
> to checkout) and 6 belong to the display work in Step 6.

Built (API only): `GET /api/events/recommendations?surface=home` and
`POST /api/events/recommendations/:listId/click`. What displaying them requires, in order:

1. **Exposure decision (Step 6):** which surface (home page first), the control share (`ML_REC_CONTROL_SHARE`,
   default 0.5), and a kill switch. Recommendations are a list of event cards; nothing about price,
   availability or checkout changes.
2. **Impression = rendered, not fetched.** Today a list is logged when the API is called. The web app must
   call the endpoint only when the module is actually rendered. The next refinement is a viewability ping
   (`recommendation_viewed`, list id, when ≥ 50% of the module is on screen for 1 s), so that lists
   fetched but never seen do not count. Until then, CTR is computed per served list.
3. **Click:** the card link calls the click endpoint (with `navigator.sendBeacon`, so navigation is never
   delayed). The server accepts it only for an event in that list for that visitor, within the 24-hour
   click window. The event page view that follows is the existing `event_view`.
4. **Purchase:** attributed in the export, never by the browser. A verified (live, server-side) purchase
   of the recommended event by the same account within 7 days counts (view-through). Clicked lists also
   have a click-through measure. Anonymous visitors count only after login links their session (section
   3); unlinked anonymous impressions stay out.
   To be added: carry the list id from the click to checkout (stored on the checkout's behaviour events),
   so click-through purchases are exact rather than inferred from time windows.
5. **Variant stability (fix needed before display):** the variant is a hash of the account id when signed in
   and of the session id when not. A visitor who logs in can therefore switch variant, which contaminates
   the comparison. Use the session's variant for the rest of that visit, or keep exposures of switched
   visitors out (flag `variant_switched`).
6. **Storage at scale:** impressions are behaviour events with the list inside JSON. Before high traffic,
   move them to a dedicated table or add the list-id index (section 10).
7. **Evaluation (already built):** `recommendation_report` gives CTR and 7-day purchase rate per variant,
   bootstrap uplift of personalised over control, exposure of new and less-popular events, and diversity.
   It reports first-time and returning visitors separately. A decision needs the minimum sample in each
   arm; until then the report states NOT_ENOUGH_DATA.

## 13. API tests not verified because the full environment was not running

> **R0 status (2026-11-22): run.** All 153 tests ran with `scripts/test-server-suites.sh`. A preflight run with
> the server's exact environment confirmed:
> - mail goes to the in-memory transport;
> - minting is in simulation;
> - no usable Stripe key, and Cloudinary is off;
> - the database is a `*_verify` copy.
>
> The server log showed no SMTP, chain, Stripe or Cloudinary activity.
>
> **Results:**
>
> | Tree | Passed | Failed |
> |---|---|---|
> | Before R0 (`8c837d1`) | 110 | 43 |
> | After R0 | 110 | 43 (the same tests) |
>
> R0 first broke 9 `test_booking` tests that asserted the removed behaviour (a card checkout without any Stripe
> account, and JazzCash confirming with the demo OTP). They were rewritten to the fail-closed requirements and
> pass.
>
> The 43 failures existed before R0 and are outside its scope:
> - seed data the tests expect but the database dump no longer has (demo logins, PSL event, bot ring user,
>   resale listing);
> - sign-up now requires an e-mail code;
> - legacy synthetic ML models are off in production mode, and the profile fraud score is "unavailable" since
>   Stage 4;
> - minting is simulated in the sandbox (no contract address);
> - recovery reminders and a pre-publish price edit, explained since.
>
> All 43 are classified in `docs/server-test-failures.md`: 27 obsolete test expectations and 6 that need live
> testnet minting. The investigation also found two application issues, both fixed: cross-organizer price changes,
> and a 500 for disabled training.
>
> The text below is the original plan.

14 files, **153 tests**, need a running API server on `localhost:5000` (and 4 of them the ML service on
`localhost:8000`). In every run they failed with `ECONNREFUSED`. They are **unverified**, neither passing
nor failing:

| File | Tests | | File | Tests |
|---|---|---|---|---|
| test_abandoned_intent_dashboard | 9 | | test_final_master_suite | 12 |
| test_admin_dashboard | 15 | | test_nft_minting | 8 |
| test_ai_anti_scalping | 11 | | test_notification_system | 16 |
| test_behavior_system | 8 | | test_prelaunch_demand_forecast | 8 |
| test_booking | 11 | | test_purchase_intent_analytics | 9 |
| test_digital_wallet | 10 | | test_resale | 11 |
| test_fastapi_ml_service | 12 | | test_transfer_resale | 13 |

Why they were not run: `apps/api/.env` points at a real Gmail SMTP account, and the server's background jobs
(reminders, broadcasts, refunds, payouts, minting retries, ML jobs) run against whatever database it is given.
Three of these files (digital wallet, resale, transfer resale) also write to the database directly.

**How to run them safely:** `bash apps/api/scripts/test-server-suites.sh <backup.dump> [label]` (added; not yet
run). It:
- restores a fresh `ticketledger_<label>_verify` copy;
- refuses to start if ports 5000 or 8000 are taken;
- starts the ML service and the full server with sandbox values that override `.env`;
- refuses to run the tests unless the server reports `minting mode: simulation`;
- runs the 14 files against the same copy, scans the server log for SMTP or chain activity, and drops the
  copy.

The sandbox values:

| Setting | Effect |
|---|---|
| SMTP host and user `mock` | Nodemailer's in-memory transport; nothing is sent |
| No minter key | Minting simulation: no chain call, no transaction |
| Mock Stripe key | No Stripe client |
| No Cloudinary keys | Local file storage |
| Redis database 15 | Not the development one |
| A random ML token | Only this run's ML service accepts it |

What it does not do: it does not block outbound network at the OS level. For stronger isolation, run it in a
container with no external network.

## 14. Test reliability: the intermittent failures (investigated 2026-11-21)

**`test_ml_export.mjs`: cause found and fixed.**
- **Reproduced** with every run's log kept: 2 failures across about 70 alternating cycles. One was in
  the last test ("later edits and records change nothing"). It showed identical attendance rows returned
  in a different order (`checked_in` 1 ↔ 0 together with the swapped `ticket_id` and `customer_id`).
- **Cause:** a product defect in the exporter, not only in the test. Rows were sorted by `ts` alone, and
  ties kept the order PostgreSQL happened to return the snapshots in (no `ORDER BY`). That order is not
  guaranteed and changes after updates, vacuum or concurrent writes. All attendance rows of an event share
  one snapshot time, so their order could flip between two exports of identical data. That gives different
  CSV bytes and hashes, and "first row wins" de-duplication would depend on it too.
- **Fix:** rows are sorted by time, then by their own key. Snapshot queries are ordered by
  `(asOf, subjectId)`.
- **Regression test:** "the export does not depend on the order the database returns rows in" runs the
  whole export through a database wrapper that returns every `findMany` result in reverse. It **fails on the
  old exporter and passes on the fixed one**.
- The other failure seen (every account-based dataset empty) happened while two of my test loops
  **accidentally overlapped on the same database**. These tests write shared fixture data and are only
  supported one at a time (both runners are sequential), so that run is not counted as a defect.
- **After the fix:** a clean sequential loop on a fresh database copy passed **40/40** exporter runs
  (11/11 tests each) and **40/40** Step 5 runs (9/9 each). The full per-file suite on another fresh copy:
  561 tests, 408 passed, 153 failed, all 153 in the 14 server-dependent files (section 13).

**`test_step5.mjs`, "search and wishlist activity is recorded": 1 failure in 40 cycles, fixed.**
- **Cause:** wishlist tracking is fire-and-forget by design (it never delays the request), and the test
  waited a fixed 200 ms. Under load the `wishlist_added` write had not landed (`actual:
  ['wishlist_removed']`).
- **Fix:** the test now waits up to 10 s for both rows and compares them as a set. Product code unchanged.

**Pre-existing, outside Step 5:** `apps/ml-service/test_health.py::test_root` fails. It was written in the
initial commit and expects the service name "TicketLedger ML Service", which an earlier commit (`6114e20`)
renamed. It is not part of `tests/` (the suite run in Steps 4–5), so it was not reported before. It is left
unchanged for a decision.
