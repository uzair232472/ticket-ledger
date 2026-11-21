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
| Orders | 26 paid: 20 MOCK, 4 Stripe test mode (none server-verified), 1 simulated JazzCash; 4 unpaid | No: no live, server-verified payment |
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

Current configuration (`node scripts/payment-config-check.mjs`, prints no secrets): Stripe in **test** mode with
a test key, **no webhook secret set**, live payments not possible. No live credentials were created or enabled.

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
