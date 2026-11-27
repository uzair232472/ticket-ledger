# Step 6: AI integration (implemented locally, shadow / development mode)

Status: implemented on 2026-11-22 on branch `feat/ml-datasets-v0`, **not committed, pushed or deployed**. Plan:
`docs/ml-step6-integration-plan.md` (approved with conditions). No model was promoted, no live payment was
enabled, JazzCash / EasyPaisa were not implemented.

## 1. What is guaranteed

| Rule | How it is enforced |
|---|---|
| Rules make every decision | Decision code (payments, refunds, tickets, gates, check-in, booking, pricing, discounts, recovery, accounts) never imports the insight, monitor or shadow modules or reads the model tables: static test `test_ml_step6_unit.mjs` |
| No synchronous ML call in checkout or other critical journeys | Checkout and the pre-launch page evaluate their rules **inside the API** (`services/security/checkoutBotRules.js`, `services/demandRules.js`); the HTTP test counts zero ML calls while checking out with the ML service up, down, slow or refusing |
| Identical behaviour with the ML service unavailable | `test_ml_step6_api.mjs`: checkout (bot, borderline, human) and the pre-launch estimate give byte-identical answers in all four ML states |
| Predictions never decide | Every insight answer says `decision_source: 'rules'`; every experimental block says `may_serve_decisions: false, validated: false`, even if a registry row were misconfigured |
| Organizers: aggregates only | Organizers get the rules part only (`ML_INSIGHTS_ORGANIZER=false`); no answer ever contains a customer id, subject id or e-mail (tested on every endpoint) |
| Fraud review stays blind | Fraud figures are SUPER_ADMIN totals only; the review queue has no score, probability, cell or experimental field (tested) |
| No made-up metrics | The app never computes accuracy: evaluation blocks are outcome counts against the `ml/gates.py` minimums (`NO_OUTCOMES_YET`, `NOT_ENOUGH_DATA`, `MINIMUMS_REACHED_EVALUATE_OFFLINE`), `metrics: null` |
| What-ifs never apply | The demand what-if is one live call (300 ms), returns `stored: false, applied: false`; the test checks tier prices and the event are unchanged |
| Off by default in production | `ML_INSIGHTS_ENABLED` defaults off in production; `ML_INSIGHTS_ORGANIZER` and `ML_REC_DISPLAY` off everywhere |

## 2. The eight features

| Feature | Rules (decide / shown first) | Experimental model (display only) | Screen |
|---|---|---|---|
| A. Purchase intent | Visit intent rule (40 + 15/20/25 points); intent page and reminders unchanged | v0 intent (synthetic, SHADOW): probability bands, mean, share pointing the same way as the rule | Purchase intent page (un-gated) + "Visit scoring summary" panel |
| B. Abandoned checkout | 100 − intent rule; reminders only by the organizer or the existing recovery rules | v0 abandonment (SHADOW): bands, mean. `checkout_abandonment` has no model | Abandoned intents page: per-event panel |
| C. Fraud | Checkout security rules (now in the API, same thresholds as the ML service); CRITICAL_BOT blocks | v0 fraud (REJECTED offline, kept in shadow): would-flag counts, SUPER_ADMIN only | AI monitor, fraud section (totals); blind review unchanged |
| D. Customer behaviour | Description only: customers, buyers, first-time vs returning, orders per buyer, activity, categories | none (no model) | New aggregate "Customer behaviour" page (`/admin/behavior-profile`) |
| E. Recommendations | Rule ranking, CONTROL vs PERSONALISED, exploration slot | none (rules) | Rows on /events, event page, wishlist, **only with `ML_REC_DISPLAY=true`** (off) |
| F. Demand | Pre-launch rule (78% of capacity; text says it is a fixed rule) and hourly pace | v0 demand (SHADOW): latest logged forecast with range, and a what-if at the edited price | Demand forecast page (un-gated) + experimental panel |
| G. Attendance | Show-rate rule (history by type / all / fixed), expected attendance, check-ins so far, final attended | none registered ("No experimental model exists for this yet") | Gates page, Live tab |
| H. Crowd flow | Per gate x 5-minute rule baseline (logged 30 min–26 h before start, else computed now) | v0 crowd (SHADOW): muted line beside the rule; actual scans after the event | Gates page, Live tab |

## 3. API contracts

All insight answers: `{ success, data: { enabled: true, feature, decision_source: 'rules', rules, experimental, evaluation, notes, generated_at } }`,
or `{ enabled: false }` when switched off. `experimental`: `{ model, status, may_serve_decisions: false, validated: false, version, source, sha256_12, offline_evaluation, offline_note, value, unavailable_reason }`;
for organizers `{ ..., value: null, hidden: true, unavailable_reason: 'ORGANIZER_VIEW_RULES_ONLY' }`.
`unavailable_reason`: `NO_MODEL_REGISTERED`, `NO_MODEL_FOR_FEATURE`, `NO_SHADOW_PREDICTIONS_YET`, `SHADOW_CALL_FAILED`,
`INPUTS_MISSING`, and for the what-if `ML_SERVICE_UNAVAILABLE`, `TIMEOUT`, `ARTIFACT_MISMATCH`, `UNEXPECTED_RESPONSE`.
`evaluation`: `{ status, logged_outcomes, minimums, short_of: [{measure, have, need}], metrics: null, note }`.

| Method and path | Guard | Notes |
|---|---|---|
| `GET /api/ml/flags` | public | `{ insights, organizerInsights, recommendations }` booleans only |
| `GET /api/ml/monitor` | SUPER_ADMIN, 120/min | models, rows, shadow failures (+reasons), outcome counts, jobs, ML service health, recommendation counts, flags, warnings |
| `GET /api/ml/insights/fraud` | SUPER_ADMIN | totals only |
| `GET /api/ml/insights/behaviour` | SUPER_ADMIN | description only |
| `GET /api/ml/insights/events/:id/intent` | `attendee.view` + own organization | |
| `GET /api/ml/insights/events/:id/abandonment` | `attendee.view` + own organization | |
| `GET /api/ml/insights/events/:id/demand[?price=&capacity=]` | `event.pricing` + own organization | what-if never stored or applied |
| `GET /api/ml/insights/events/:id/attendance` | `event.view` + own organization | |
| `GET /api/ml/insights/events/:id/crowd` | `gate.supervise` + own organization | |
| `GET /api/events/recommendations?surface=&cards=1` | optional auth | card mode returns nothing (and logs nothing) when `ML_REC_DISPLAY` is off; card mode hides the group |
| `POST /api/events/recommendations/:listId/rendered` | optional auth, 120/min | same visitor only (else 404); once per list (`alreadyRecorded`) |
| `POST /api/events/recommendations/:listId/click` | optional auth, 120/min | unchanged contract, now rate-limited |
| `POST /api/ml/{fraud/score, fraud-check, forecast/demand, demand-forecast, intent/predict, intent-score}` | **SUPER_ADMIN, 30/min** (was public) | legacy diagnostics; anonymous 401, others 403 |
| ML service `GET /v2/health`, `GET /v2/metrics` | service token | artifact checks; in-memory counters (p50/p95) |

Checkout block (unchanged rule, changed wording): 403 `{ blockedByRules: true, blockedByAI: true /* deprecated, one release */, message: 'Anti-Scalping Security Alert: this checkout was stopped by our automated security checks…' }`.

## 4. Behaviour changes to know about

1. **Checkout security rule when the ML service is down.** Before, a down service made the API use a looser copy
   (speed < 2.5 s, ≥ 6 seat attempts) than the service (< 3.0 s, ≥ 5). A checkout at 2.7 s and 200 clicks/min was
   blocked with the service up and allowed with it down. Now the service's thresholds apply in both cases
   (parity tested on 2,310 inputs). With the service up nothing changed.
2. **Pre-launch estimate when the ML service is down** now equals the service's rule answer (tier VERY_HIGH with
   the default HIGH marketing tier) instead of a different fallback (tier HIGH). In development with
   `ML_ALLOW_SYNTHETIC=1` the page no longer shows a synthetic model's number as the forecast; that model's view
   is in the labelled experimental panel.
3. **Wording.** Made-up claims removed: "blocked by TicketLedger AI", "Verified ML", "Random Forest demand
   classifier", "Gradient Boosting … ~18% deceleration", "Historical sports telemetry indicates…", "+34% organic
   conversions", "scikit-learn ML engine" (Profile), "predicted by the scikit-learn model" (intent page).
   A missing average intent score is now 0, not a made-up 65. The rule suggestion `OFFER_JAZZCASH_EASYPAISA_DIRECT`
   became `OFFER_PAYMENT_HELP` (those wallets are disabled).
4. **Bug fixed (shadow logging):** `eventController` wrote `eventId`, `userId` and `asOf` inside a `//` comment,
   so every pre-launch `EVENT_FORECAST` demand snapshot failed ("asOf is missing") and was silently dropped since it
   was added. Regression test added.

## 5. Model status (main development database, checked 2026-11-22)

They were **not registered** before Step 6 (0 `MlModel`, 0 `MlPrediction` rows). The artifacts were verified
(fingerprints, scikit-learn 1.6.1, functional equivalence with a fresh rebuild) and registered with
`scripts/ml-register-models.mjs`, which can only create SHADOW rows. `registry.json` is now tracked; reproduction
and verification: `apps/ml-service/models/v0/README.md`, `apps/ml-service/scripts/verify_v0_artifacts.py`.

**Portability (Option 1, chosen 2026-11-22):** the five v0 `.joblib` artifacts are committed together with
`registry.json` (a narrow `.gitignore` exception for exactly these five files; `.gitattributes` marks them binary),
so every machine has identical files and fingerprints and nobody retrains. Verified from a clean export of the
repository: a fresh venv from `requirements.txt`, `verify_v0_artifacts.py` (all five match the committed
fingerprints), `prisma migrate deploy` on an empty database, `ml-register-models.mjs` (five SHADOW rows with the
committed fingerprints, `mayServeDecisions=false`), and the ML service started from that copy (`/v2/health`:
every fingerprint verified and equal to the database rows). Setup steps: `apps/ml-service/models/v0/README.md`.

| Model | Fingerprint | Status | `mayServeDecisions` | Source | Offline evaluation | Predictions logged |
|---|---|---|---|---|---|---|
| intent | `5b1f3f56d07e` | SHADOW | false | synthetic-v0 | PASSED (synthetic) | 0 |
| abandonment | `3e30d171b25b` | SHADOW | false | synthetic-v0 | PASSED (synthetic) | 0 |
| fraud | `6ac94abf8702` | SHADOW | false | synthetic-v0 | **REJECTED** | 0 |
| demand | `68db22d6fa39` | SHADOW | false | synthetic-v0 | PASSED (synthetic) | 0 |
| crowd | `19c67dfbcd5c` | SHADOW | false | synthetic-v0 | PASSED (synthetic) | 0 |

No model is READY, ACTIVE or able to serve decisions; "PASSED" means passed offline checks **on synthetic data**,
never validated on real outcomes.

**Fraud: SHADOW registration vs REJECTED evaluation.** These are two different fields. `evaluationStatus =
REJECTED` is the offline result: its precision was 0.893 against the rules' 0.994 (improvement −0.101, 95%
interval [−0.142, −0.066]), so it is not better than the rules. `status = SHADOW` is what the model may do in the
app: score in the background only. It stays in shadow by the recorded decision ("Option 1", 2026-11-20, stored in
`shadowDecision`): the rules remain the active system, the model runs in shadow so its recall and bot detection can
be compared with verified (blind-reviewed) outcomes, and it is re-evaluated only on real data once the
`ml/gates.py` minimums are met; the benchmark is not lowered. In practice: after the rules decide a checkout, the
shadow logger asks the fraud model for a probability and a would-flag answer (logged only); its would-flag answers
also decide which blind-review sampling cell an order falls in, never the order itself. No checkout has happened
since registration, so 0 fraud predictions are logged yet.

### Availability by feature

| Feature | What decides | Trained model | Kind |
|---|---|---|---|
| A. Purchase intent | Rules | v0 `intent` | **Synthetic model, shadow only** |
| B. Abandoned checkout (visit) | Rules | v0 `abandonment` | **Synthetic model, shadow only** |
| B. Abandoned checkout (checkout start, agreed label) | Rules | none | No trained model yet (needs genuine data) |
| C. Fraud | Rules | v0 `fraud` | **Synthetic model, shadow only, rejected offline** |
| D. Customer behaviour | n/a (description) | none | Rules / descriptive only, by design (no model planned) |
| E. Recommendations | Rules (ranking + control group) | none | Rules only, by design; display off |
| F. Demand (first 48 h) | Rules | v0 `demand` | **Synthetic model, shadow only** |
| F. Demand (hourly, next 24 h) | Rules | none | No trained model yet (needs genuine data) |
| G. Attendance | Rules (show rate) | none | No trained model yet (no v0 artifact) |
| H. Crowd flow | Rules (arrival baseline) | v0 `crowd` | **Synthetic model, shadow only** |

## 6. Performance and the index decision (not applied)

Measured on a throwaway `*_verify` copy with a timing-only load of 2,000,026 `MlPrediction` rows and 600,000
recommendation events (dropped afterwards; never exported).

| Query | Time | Plan / note |
|---|---|---|
| Per-event insight rows | 2.7 ms | existing `(modelName, role, subjectType, eventId)` |
| Demand rows per event | 0.24 ms | existing indexes |
| Outcome counts per model | 687–832 ms | existing `(modelName, outcomeAt)` + heap fetches |
| Monitor row counts (whole log) | 0.8–1.4 s | parallel full scan |
| Recommendation counts | 7.06 s → **0.48 s** | `count(DISTINCT listId)` removed (one row per list by construction) |

Without a new index: outcome counts cached 5 minutes, monitor aggregates 60 seconds (per API process).
End to end: per-event insight 0.8–1.1 s once per 5 minutes, then 14–94 ms; monitor about 8.6 s on a cold load
(including the 1.5 s health-probe timeout when the ML service is down), then 6–12 ms.

**Proposal (needs approval). Not applied: no migration file exists for it, and no database has it (checked
`ticketledger_db`, `ticketledger_ml_verify`, `ticketledger_db_migcopy`); it was only measured on the throwaway copy, since dropped:** a partial index

    CREATE INDEX "MlPrediction_outcome_counts_idx" ON "MlPrediction" ("modelName", role, "outcomeLabel", "eventId") WHERE "outcomeAt" IS NOT NULL;

Measured on the same copy: outcome counts 687 → 87 ms (intent) and 425 → 16 ms (crowd) as index-only scans;
per-event insight cold 838 → 129 ms. Size 36 MB at 2,000,000 rows (built in 7.1 s). **Not needed today** (the
development database has no predictions yet); recommended together with production-scale collection, with
the usual backup and rehearsal.

## 7. Tests (complete results, 2026-11-22)

| Suite | Tests | Pass | Fail | Skipped | Notes |
|---|---|---|---|---|---|
| `test_ml_step6_unit.mjs` | 15 | 15 | 0 | 0 | rule parity with the ML service (2,310 checkout inputs, 72 demand inputs), decision-path guard, read-only insight layer, envelope invariants, flags, rate limit, gate minimums |
| `test_ml_step6_api.mjs` | 10 | 10 | 0 | 0 | access and organization scope, aggregates only, fraud blindness, flags, ML up / down / slow / 409 equivalence, failure labels, demand-snapshot regression, recommendation impressions |
| ML service (`pytest`) | 74 | 74 | 0 | 0 | includes 12 new in `tests/test_step6.py` |
| Web (`npm test`) | 43 | 43 | 0 | 0 | 16 new (helpers + offline renders); `vite build` succeeds |
| Sandboxed server suites (14 HTTP files, full server) | 154 | 111 | 43 | 0 | the 43 failures are exactly the R0-reconciled list (33 individual + 10 module parents, `docs/server-test-failures.md`); none new |
| Per-file run, every API test file (no API server) | 604 | 449 | 155 | 0 | breakdown below |

**Per-file run: baseline (HEAD `55f45e5`) vs Step 6.**

| | Tests | Pass | Fail | Skipped / cancelled / todo |
|---|---|---|---|---|
| Baseline | 578 | 424 | 154 | 0 |
| Step 6 | 604 | 449 | 155 | 0 |
| Difference | +26 | +25 | +1 | 0 |

- **Server-dependent:** 14 files call the API server on `localhost:5000`, which this runner does not start. All
  their tests fail with connection refused in both runs: 153 tests at baseline, 154 now. The +1 is the new
  `test_ai_anti_scalping` check (anonymous/customer refused). The same 14 files run against a full server in the
  sandboxed server suites (above), where that check passes.
- **The rest:** 39 files, 450 tests now (425 at baseline), all pass except 1 failure that is in both runs:
  `test_ml_persistence.mjs` test 1 expects a database with **no** models registered and asserts that registration
  creates 5. Both runs restored a backup taken after the v0 models were registered, so it found them already
  registered (0 created). Re-run on the pre-registration backup
  (`ticketledger_db_pre_export_payment_indexes_20261121T212424.dump`): 11/11 pass. Not a defect.
- **Explained exactly:** +25 passing = 15 + 10 new Step 6 tests; +1 failing = the new server-dependent check. Every
  other file has identical counts in both runs.

Updated tests: `test_ml_hardening_unit.mjs` (new allowed reader list, checkout makes no ML call),
`test_ai_anti_scalping.mjs` (admin token, the refusal check, rules wording), `test_fastapi_ml_service.mjs` (admin
token), `test_prelaunch_demand_forecast.mjs` (rule wording, `prediction_source: 'rules'`).

## 8. Remaining limitations

- No genuine customers yet: every model still shows `NO_OUTCOMES_YET`; nothing can be validated (Step 5 §9).
- Synthetic v0 models only (committed as binary artifacts, 1.4 MB); the fraud model is rejected offline; attendance, checkout-start abandonment and
  hourly demand have no model.
- Job status and caches are per API process (a multi-server deployment shows each server's own).
- The recommendation display is built but **off**; turning it on is a separate decision (it changes what
  customers see).
- The workflow explorer data (`components/workflow/flow*.js`) is a dated snapshot (October 2026) and still
  describes the old ML calls.
- External alerting waits for R1 (staging); the monitor only shows warnings on its page and in the log.

## 9. Safety by feature (why no workflow can control a real decision)

| Feature | Real decision and who makes it | Where the model's output goes | Why it cannot decide |
|---|---|---|---|
| A. Purchase intent | Reminders: sent only by an organizer's action | Logged rows → staff panel totals | The intent page and reminder code never read model rows (static guard) |
| B. Abandoned checkout | Reminders / recovery codes: organizer or existing recovery rules | Logged rows → per-event totals | `recoveryService` and the reminder endpoints are covered by the guard; the panel is display-only |
| C. Fraud | Checkout block: the security rules in the API | Logged rows; would-flag picks the blind-review **sampling** cell; admin totals | The block reads the rule result only (tested); sampling only chooses which orders humans review; reviews change no order, ticket, payment or account; reviewers never see a score |
| D. Customer behaviour | None (no automated decision about anyone) | Totals on an admin page | No model; no individual scores |
| E. Recommendations | Which events are listed: rules (control or personalised), off by default | Impressions and clicks are logged | No model; prices, availability and checkout are untouched; both groups look identical |
| F. Demand | Prices and publishing: the organizer's own save / publish buttons | Logged forecast + what-if in a labelled panel | The what-if is never stored or applied (tested: prices and event unchanged); the page shows the rule estimate |
| G. Attendance | Gate admission: ticket and gate rules | Rule estimate only (no model) | Gate and check-in code never read ML (static guard) |
| H. Crowd flow | Gate admission and staffing: gate rules and staff | Logged rows → muted chart line | Scanner, admission and sync code never read ML (static guard) |

Across all eight:
- decision code imports no insight, monitor or shadow module and reads no model table (`test_ml_step6_unit.mjs`);
- the insight layer only reads;
- every experimental block says `may_serve_decisions: false, validated: false`, even for a misconfigured registry row;
- no model can be READY or ACTIVE (registration creates SHADOW only; there is no promotion path);
- answers are identical with the ML service up, down, slow or refusing (`test_ml_step6_api.mjs`).
