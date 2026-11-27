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
values. A row without a usable snapshot (none logged, logged before raw values were stored, not exact, or read
more than 2 hours after the prediction moment) is left out, and the reason is counted.

**Only exact snapshots are used.** Some inputs are read a little after the prediction's reference moment:
- request-path predictions (checkout fraud, demand forecast views) are read on the next tick;
- visits are read 30 to 45 minutes after the visit ends (a visit is only finished after 30 quiet minutes);
  their reference moment is the visit's start, i.e. the prices the customer saw;
- demand at sales open is read within the hour after the open.

Database triggers record every change to an event's inputs: schedule, capacity, type, city, sales-open
times, organizer, cancellation, tier prices and quantities, and tiers or gates added or removed. Ticket sales
are not inputs. The triggers are deferred to **commit time**: a change is logged at the moment it becomes
visible, even inside a long transaction (migrations `20261122120000_ml_input_changes` and
`20261123120000_ml_input_changes_commit_time`).

The prediction logger reads all inputs first. Then, in **one repeatable-read transaction**, it checks the
change log and writes the row. A snapshot is `exact` only if:
1. the commit-time change log is installed;
2. the predicted event's inputs did not change since the reference moment (minus 2 minutes);
3. nothing behind the **typical price** changed since the moment that price refers to: its events' prices or
   details, or the organizer company or account (which decides whether an event counts as real).

Point (3) is needed because old prices are not recorded, so a historical typical price cannot be rebuilt; the
row is left out instead. That moment is the sales open for demand and attendance, the visit end for visits,
and the request for fraud. The typical price also counts only events that existed at that moment: an event
created later with a backdated sales-open date never counts. Crowd inputs have no price-relative features, so
point (3) does not apply to them.

Why this holds under concurrency: a change the reads could see was committed before them, and its log row
was written in the same transaction at commit, so the later check sees it. A change committed after the check
cannot have affected values already read.

`test_ml_snapshot_concurrency.mjs` makes changes from a second database connection at each point: after the
reads, after the check, uncommitted during the capture, and in a long transaction. It also covers the
typical-price cases. Against the statement-time triggers alone, the long-transaction case fails and nothing is
marked exact. `test_ml_snapshot_integrity.mjs` covers price, quantity, tier, capacity, start, city, sales-open
and gate changes before and immediately after a prediction. Rows that are not exact are left out, never
repaired, and each one carries its reason (`context.integrity`).

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

### Fraud dataset scope (what it does and does not represent)
- **Current fraud labels cover only eligible paid orders**: an order by a real customer account, on a real
  event, whose payment the server confirmed with the provider in live mode, whose checkout logged an exact
  snapshot, that was selected for blind review and received a resolved blind decision.
- **Left out, and kept out of training**, until a separately reviewed and reliable labeling process exists
  for them:
  - unpaid checkout attempts (failed or abandoned orders);
  - blocked checkout attempts (`CRITICAL_BOT`: no order exists, see item 3);
  - orders without live payment evidence;
  - unresolved and exposed-only reviews.
- **The dataset does not represent all fraud activity.** It describes paid orders that passed the rules. The
  most bot-like attempts are blocked before payment and never appear. The sampling weights correct for
  *which paid orders were reviewed*, not for the orders that never reached payment. Precision, recall and
  false-flag rates computed from it apply to **paid orders only**, and reports must say so.
- Nothing in the exporter or the evaluation infers a label for an excluded attempt.

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

### Synthetic legacy endpoints (labelled, never in production)
- `ML_ALLOW_SYNTHETIC` is not set in any environment file, start script or deployment configuration in the
  repository, so it is off by default.
- It is now **ignored when `ML_ENV=production`**: no synthetic model loads, and the legacy training endpoints
  stay disabled. The flag only works in development.
- Second safeguard, in case the ML service itself is misconfigured: an API running with
  `NODE_ENV=production` discards any demand or intent answer that is not labelled `rules`, and uses its own
  labelled rule-based estimate (`refuseSyntheticInProduction`, `mlService.js`).
- Every legacy demand, intent and fraud answer says where it came from: `prediction_source` (`rules` or
  `synthetic-demo-model`), `validated: false` (always), and a `notice`. The API passes these through, and
  the demand forecast page labels each estimate as rule-based, demonstration (synthetic, not validated), or
  unverified (unknown source).
- The forecast page no longer shows a stand-in forecast built from made-up inputs (cricket, Lahore, 27,000
  seats) when the event's forecast fails. It shows the error.
- With the flag on in development, the legacy demand model file does not work with the current code
  (`KeyError 'sales_pipeline'`), so that endpoint fails and the API uses its labelled rule-based estimate.

### No model makes decisions (verified)
- Checkout blocks follow the ML service's `/fraud/score`. It now always answers with its rules (unchanged
  thresholds), even when a trained model is loaded: the legacy synthetic model used to set the score
  when `ML_ALLOW_SYNTHETIC=1`.
- Payments, refunds, tickets, transfers and gate admission never read model output or the shadow log.
  The shadow log is used only by the ML modules: logging, review sampling, outcomes and export.
- The behaviour profile no longer shows a fraud score. It used to call `mlService.predictFraud`, which
  doesn't exist, and always showed a fixed "low risk" (14) built from invented telemetry. It now says "not
  scored": fraud checks run at checkout only.
- Tests: `test_ml_hardening_unit.mjs` and `tests/test_no_model_decisions.py`.

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

## Regression testing

`apps/api/scripts/test-per-file.sh` runs every API test file of a source tree, one at a time, against its own
fresh database (restored from a backup, then `prisma migrate deploy`), with that tree's ML service, and writes
one line per file (tests, pass, fail, connection-refused errors). Compare two trees, e.g. a commit checked out
with `git worktree add` (copy the untracked `apps/ml-service/models/v0/` and `apps/api/.env` into it, and set
`ML_PYTHON` to the main checkout's `.venv` Python) against the working tree:

```
bash apps/api/scripts/test-per-file.sh <tree> <label> <backup.dump> <ml port>
```

14 files are HTTP tests against a running API server on `localhost:5000` (with Redis, seeded logins and the
ML service). The runner does not start that server: it runs background jobs with outside effects (recovery
e-mails to the addresses in the data, blockchain mint jobs). Those files therefore cannot run here, and their
tests are reported as failures with connection-refused errors. They are not passing tests.

## Remaining limitations
- **No real verified data yet.** No provider runs with live keys, and JazzCash and EasyPaisa are simulations,
  so no order can qualify. Real training needs a live Stripe key (or real JazzCash / EasyPaisa integrations
  that record provider confirmation), then months of live sales, check-ins and blind reviews. Snapshots only
  exist from this release onward: earlier history can never be used.
- **Fraud data covers eligible paid orders only** (see "Fraud dataset scope"): unpaid and blocked attempts
  stay out of training, and the dataset does not represent all fraud activity.
- **Snapshots are rejected, not repaired.** Any input change between the reference moment and the capture
  excludes the row. For visits that window is the visit plus 30 to 45 minutes; for demand, the first hour
  after sales open. Organizers who edit prices early lose those rows rather than getting reconstructed ones.
  The check covers the predicted event's own inputs. The typical-price reference uses all real events'
  prices as they are at capture time.
- **The integrity check needs both change-log migrations** (`20261122120000_ml_input_changes` and the
  commit-time `20261123120000_ml_input_changes_commit_time`). Where they are missing, every new snapshot is
  marked not exact, so nothing becomes trainable (safe, but no data accumulates). Status on 2026-11-21: both
  are applied on the main development database (backed up, restore-verified, checksums matched, rehearsed;
  business records unchanged) and on the verification database. They are not applied to production.
- **The typical-price rule is strict.** Any price or detail change to any real event behind the typical price,
  after the moment it refers to, excludes the row. Demand forecasts viewed long after sales open, and
  attendance snapshots (whose typical price refers to sales open), will often be excluded on a busy platform.
  Recording old prices in the change log would allow a true point-in-time typical price. That needs a new
  migration and has not been built.
- **The reference-set check is conservative**: a change to a reference event within 2 minutes before the
  prediction moment also excludes the row (clock margin).
- **Fraud labels are human judgment** from a stratified sample. The weights correct for the sampling, not
  for reviewer error.
- **The deployed-model comparison needs newer data** than the deployed model's training period.
- **Batching:** the exporter and the attendance snapshot read records one by one. That is fine at current
  sizes; batch them before events with tens of thousands of tickets.
- Real-data sufficiency minimums are planning estimates derived from the evaluation's test-period gates, not
  guarantees of a PASSED result.
