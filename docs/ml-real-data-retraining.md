# Retraining on the client's real data (Stage 4)

The v0 models were trained on synthetic data and run in **shadow mode only**: the rules make every decision.
This page covers how real data gets from the app's database into candidate models, what counts as a real,
verified outcome, and what still limits the results. Nothing in this pipeline registers, promotes or
deploys a model.

```
live predictions ──► MlPrediction snapshots ──► ml-export-datasets.mjs ──► exports/<stamp>/ ──► validate ──► auto_retrain.py
 (jobs + request     exact inputs + raw values   (read-only) snapshot rows   5 CSVs, events.csv  integrity,   candidates + reports
  paths)             read at prediction time     + verified outcomes         manifest, report    separation   (recommendation only)
```

```
cd apps/api
node scripts/ml-export-datasets.mjs                                          # read-only; writes ../ml-service/exports/<stamp>/
cd ../ml-service
.venv/Scripts/python scripts/auto_retrain.py --data exports/<stamp>          # validates, trains what has enough data
```

`exports/`, `models/candidates/` and `reports/candidates/` are git-ignored: they hold the client's data.
`auto_retrain.py` is safe to schedule (cron / Task Scheduler) after each export. It exits 0 when nothing has
enough data, which is the expected result for months after launch. It is not scheduled anywhere yet.

## What counts as real and verified

| | Rule |
|---|---|
| Customers | `CUSTOMER` accounts only. Test domains (`example.*`, `*.test`, `proxyfarm.com`, ...) and internal domains (`ticketledger.pk`) are left out. Extra: `ML_EXPORT_TEST_DOMAINS`, `ML_EXPORT_INTERNAL_DOMAINS`, `ML_EXPORT_EXCLUDE_USERS` |
| Events | Left out when cancelled, or run by a test or internal organizer account, or listed in `ML_EXPORT_EXCLUDE_EVENTS`. The same rule (`services/ml/dataPolicy.js`) keeps test and internal events out of the typical-price reference behind every `*_price_rel` input, live and in training |
| Purchases | A paid order only counts with **server-side live payment evidence**: when the server itself confirms the payment with the provider, it records the provider's own `livemode` flag (`services/paymentEvidence.js`, AuditLog `PAYMENT_SERVER_VERIFIED`). Only `livemode: true` counts, and its transaction id must still be the order's. Order rows, payment-method names, transaction ids and settings are never evidence. "Did not buy" labels only exist after the first live-verified payment |
| Fraud | Only the latest **blind**, resolved review (below). Unresolved, exposed-only and unreviewed orders are never labels |
| Attendance / crowd | Admitted first entries (`GREEN`, not re-entry, not reversed). An event is only used if all its tickets come from verified paid orders |

A row's label must also be complete before the export moment: 7 days for intent, the first 48 hours for
demand, and the event finished for attendance and crowd. Every query only sees records created before the
export moment (`--as-of` reproduces an earlier export). The test `test_ml_export.mjs` adds records dated
after that moment and checks the export does not change.

## The five datasets

**Every row comes from a prediction-time snapshot.** Each live prediction stores its exact inputs
(`MlPrediction.features`, role `RULES`) and the raw values a training row needs, read at that moment
(`output.context`: prices, capacity, start time, holder, with `captured_at`). Nothing is rebuilt from current
values. A row without a usable snapshot (none logged, logged before raw values were stored, or read more than
2 hours after the prediction moment) is left out, and the reason is counted.

| File | Row = | Snapshot logged by | Prediction time (`ts`) | Label |
|---|---|---|---|---|
| `behavior_sequences` | a signed-in visit to one event | `scoreVisits` (after the visit ends) | end of the visit | `purchased_7d`; `checkout_abandoned` (no paid order during the visit; -1 = no checkout) |
| `fraud_purchases` | a reviewed order | checkout (`bookingController`) | checkout | `is_fraud` + `sample_weight` = 1 / inclusion probability, `rule_flag` / `rule_score` = what the rules decided |
| `event_demand` | an event | `snapshotDemand` (new: within 1 h after sales open), or a forecast viewed before sales open | sales open | tickets sold in the first 48 h (live-verified orders) |
| `attendance_no_show` | every live ticket of a finished event | `snapshotAttendance` (new: about 24 h before the start) | the snapshot (22-26 h before the start) | `checked_in` |
| `crowd_flow` | active gate × 5-minute slot | `scoreCrowd` (30 min to 26 h before the start) | the slot | entries counted at that gate in that slot |

Snapshots are logged whether or not shadow scoring is on (`ML_SHADOW_ENABLED` controls the model calls,
`ML_SNAPSHOTS_ENABLED` the snapshots, default on). IDs are pseudonymised (`sha256`). Duplicates are dropped by
row id and counted. `export_report.md` lists, per dataset, the rows kept and every reason rows were left out.

### Real data stays separate from synthetic and test data
- The validator refuses a database export where any id is not an export pseudonym (synthetic ids like `C000123`
  fail), any row is not a snapshot, or the manifest does not declare `contains_test_data: false`.
- `ml.train` refuses synthetic data without `--allow-synthetic`, refuses `--allow-synthetic` together with a
  database export, and refuses test-fixture exports without `--allow-test-fixture` (tests only). So do the
  validator and `auto_retrain.py`.
- A candidate is trained and evaluated on one export only: its own time-based split. Synthetic v0 data never
  enters it.

## Retraining and comparison

`auto_retrain.py` validates the export (integrity failures stop the run) and trains only the models whose
verified data reaches these minimums:

| Model | Minimum verified data (plus ≥ 3 months) |
|---|---|
| intent | 800 buyers and 800 non-buyers |
| abandonment | 800 abandoned and 800 completed checkouts |
| fraud | 400 confirmed frauds, 800 confirmed legitimate (blind reviews) |
| demand | 800 events |
| attendance | 800 no-shows, 800 attendees, 250 events |
| crowd | 250 events |

The evaluation itself (unchanged from v0, `ml/README.md`) splits by time and judges the newest 15% it has
never seen. It still applies its own test-period minimums and gates, so NOT_ENOUGH_DATA remains possible.
Each candidate is compared with:
- **the current rules**: the rule the app uses today. For fraud this is now the decision the rules actually
  logged (`rule_flag`), not a recomputation;
- **the deployed model**: the SHADOW model the app runs (its SHA-256 is exported from the model registry), on
  test rows newer than everything it was trained on. Otherwise it would be judged on rows it has already seen.

Fraud rows are weighted by their sampling weight in the fit, the calibration, the flag threshold and every
rate, so precision and false-flag rate describe all orders, not the review sample.

Each report ends with a recommendation (`KEEP_CURRENT`, `REVIEW`, `PROMOTION_CANDIDATE`). It is only a
recommendation. Registering a candidate for shadow scoring is a manual step
(`node scripts/ml-register-models.mjs <candidates>/<stamp>/registry.json`). Serving decisions still needs a
passed live shadow check and admin approval, and no code path for that exists.

## Payment providers (inspected 2026-11-21; no secret values read out)

| Provider | Code | Configuration (dev `.env`) | Can produce live evidence? |
|---|---|---|---|
| Stripe | Real API: PaymentIntent created by the server, confirmed by `paymentIntents.retrieve` | `STRIPE_SECRET_KEY` has a **test** key prefix (`sk_test_`); publishable keys not set | Yes, once a live key is configured. With the test key, evidence says `livemode: false` |
| JazzCash | **Simulated**: no provider call, any 6-digit OTP accepted | `JAZZCASH_MERCHANT_ID` / `JAZZCASH_PASSWORD` hold placeholder values and are not used by the code | No: needs a real integration first |
| EasyPaisa | **Simulated**: no provider call | `EASYPAISA_STORE_ID` placeholder, unused | No: needs a real integration first |
| MOCK | Test checkout | - | Never |

No provider is configured with live keys. No production configuration is kept in the repository. The dev
database has 4 successful Stripe orders, none server-verified (they took the fallback path, which invents a
transaction id), and 0 orders with live evidence. Stripe orders before this change have no evidence and never
count.

## Foundation items

### 1. Fraud review blindness (fixed)
The fraud watchlist, the admin fraud alerts, an admin's view of a customer's behaviour profile,
investigations, and freezing or unfreezing an account from the watchlist all show fraud-detector output.
The same admins (`admin.fraud`) review the "blind" queue, and the queue showed the account id, so a
reviewer could match an order to a watchlist entry.
- The queue now shows a pseudonymous customer reference (`C-…`) instead of the account id.
- Those views are logged (`FRAUD_WATCHLIST_VIEWED` with the account ids shown, `FRAUD_PROFILE_VIEWED`,
  `INVESTIGATION_VIEWED`, plus the existing investigation and freeze actions).
- When a review is recorded, the reviewer's earlier views of that customer are checked. The review is stored
  with `blind` = true/false and the evidence (`exposure`). Migration `20261121120000_ml_review_blindness`
  adds the two nullable columns.
- **Only blind reviews are labels.** A blind review is never overridden by a later exposed one. An item
  with only exposed reviews stays in the queue for another reviewer, and is not shown again to the reviewer
  who already decided it. Reviews recorded before this check (`blind` = null) count as not blind.
- The reviewer is never told their review was exposed: that would reveal the customer had been flagged.
  Review history does not show it either. Super-admin metrics report `exposedOnly` and `exposedReviews` per
  cell.
- Other admin actions on an account (reminders, support, role changes) do not count as exposure. Testing on
  a copy of the dev data showed why this matters: a broader rule marked 12 reviews exposed because the admin
  had sent the customer an intent reminder.

### 2. Unresolved reviews reported separately (done)
`/ml/fraud-review-metrics` now has an `unresolved` section: count and share per cell, the cells over 20%
unresolved, and the estimate recomputed with every unresolved case counted as fraud and then as
legitimate. The true value lies between those two. `sufficient` is false while any cell is over 20%
unresolved. The export report counts unresolved, exposed-only, unreviewed, not-selected and not-yet-sampled
orders separately, and none of them is a label.

### 3. Blocked checkouts: the measurement gap (documented; collection planned, not built)
A `CRITICAL_BOT` rule decision blocks the checkout (HTTP 403). No order exists, so nothing can be reviewed
or verified. The attempt is logged (`MlPrediction`, subject `CHECKOUT_ATTEMPT`) and the export counts it, but
it has no label. Consequences:
- the rules' precision and false-flag rate exclude every blocked attempt: false blocks of real customers are
  invisible;
- fraud labels only exist for orders that were *not* blocked, so the most bot-like cases are missing from
  training (selection bias). A model can look worse or better than the rules there without anyone knowing.

Plan for collecting outcomes safely, in order of risk. None of these changes the blocking yet. Option (c)
needs a business decision.
1. **Blind review of a sample of blocked attempts.** Reviewers see the attempt's facts (account age and history,
   timing summary, seats requested), never the score. The result is stored as a separate label type ("blocked
   attempt judged fraud / legitimate") with its inclusion probability, and is never mixed silently with order
   labels. It needs a small table for blocked-attempt samples (not built).
2. **Follow-up evidence on the same account** (later blind-reviewed orders, support contacts about being
   blocked, investigation outcomes). These are reported as weak signals, never used as training labels.
3. **Step-up instead of block for a small, capped random share** of `CRITICAL_BOT` attempts (OTP or CAPTCHA). A
   pass continues to checkout and into the normal blind review with a known inclusion probability. This is
   the only way to measure false blocks directly, and it lets some flagged traffic reach checkout behind a
   challenge. It needs product and risk approval and a hard cap.

### 4. Abandonment evaluation vs. future real-time re-engagement (kept separate)
- The abandonment model scores a visit **after it ends** (30 minutes of quiet). Its label is "no paid order
  during the visit", which closes when the visit ends. Cart-recovery reminders go out at least 1 hour after a
  checkout lapses, so they cannot affect this label. The export checks this
  (`abandonmentRowsWithReminderInWindow`, expected 0).
- No abandonment prediction drives anything: reminders are triggered by the lapsed-checkout rule
  (`recoveryService.js`), not by a model.
- The 7-day intent label **can** include the effect of reminders. The export counts those rows
  (`intentRowsWithReminderInWindow`) and keeps them, because the label describes buying under current practice.
- A real-time re-engagement model (scoring *during* checkout and acting on it) must be a separate model with
  its own name, prediction time, label and evaluation. Its actions change the outcome it predicts, so it
  needs a randomised hold-out group to measure the effect. It must not reuse the abandonment model, its
  data or its results.

### 5. Gate capacity (documented; checks added)
Crowd-flow inputs split arrivals across gates by `capacityPerHour`, which is optional on gates. A missing
capacity is never guessed: the event is skipped by live scoring, left out of the export (reason counted),
and now shown:
- `crowdReadiness()` in `services/ml/crowd.js` is the single check (an active gate is needed, and every
  active gate needs a capacity);
- the gate operations dashboard (`operationsSummary` → `capacity.crowdForecast`) shows it per event;
- `scripts/gate-preflight.mjs` reports a CHECK for upcoming events (next 14 days) that can't be forecast.

In the dev database 2 of the 3 gates have no capacity (a past test event). Organizers have to enter real
capacities. Making the field required on new gates is a product decision and has not been changed.

## Remaining limitations
- **No real verified data yet.** No provider runs with live keys, and JazzCash and EasyPaisa are simulations,
  so no order can qualify. Real training needs a live Stripe key (or real JazzCash / EasyPaisa integrations
  that record provider confirmation), then months of live sales, check-ins and blind reviews. Snapshots only
  exist from this release onward: earlier history can never be used.
- **Unpaid checkout attempts never qualify for fraud training**: an order needs live payment evidence, so
  fraud labels only come from paid orders (and blocked attempts have none, item 3).
- **A snapshot is read when its job runs**: within 15 minutes for demand at sales open, and 30 to 45 minutes
  after a visit ends. A price edit inside that window is captured. Snapshots read more than 2 hours late are
  left out (e.g. after server downtime).
- **Fraud labels are human judgment** from a stratified sample. The weights correct for the sampling, not
  for reviewer error.
- **The deployed-model comparison needs newer data** than the deployed model's training period.
- **Batching:** the exporter and the attendance snapshot read records one by one. That is fine at current
  sizes; batch them before events with tens of thousands of tickets.
- Demand's average price is rounded to 10 (as in the training definition). When every tier has the same
  price that isn't a multiple of 10 (e.g. 7777), the average can exceed the maximum.
- Real-data sufficiency minimums are planning estimates derived from the evaluation's test-period gates, not
  guarantees of a PASSED result.
