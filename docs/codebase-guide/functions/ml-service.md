# Function catalogue — ML service (Python / FastAPI)

[← Function catalogue index](README.md) · Module walkthrough: [Behaviour analysis & AI](../02-modules/behavior-analytics-ml.md) · Node client: [`mlService.js`](api-analytics-ml.md#api-ml-checkfraudrisk)

Folder: `apps/ml-service/`. Python 3.10 virtual environment in `.venv/` (dependency folder, not documented). Requirements (`requirements.txt`): FastAPI 0.115, Uvicorn, Pydantic 2, scikit-learn 1.6.1, pandas, NumPy, requests, joblib.

**How to run (observed):** `python main.py` (its `__main__` block starts Uvicorn on `0.0.0.0:8000`) or `uvicorn main:app --port 8000`. The root `package.json` script `dev:ml` runs `npm run dev:ml --prefix apps/api`, but `apps/api/package.json` has **no `dev:ml` script**, so that npm command fails.

> ### Model-file status on this machine (verified 2026-10-06 by running the code)
> - `models/*.joblib` are **git-ignored** (`.gitignore: *.joblib`), so a fresh clone has **no model files**. In that case `load_models()` loads nothing and each endpoint uses its built-in heuristic branch.
> - The three `.joblib` files present locally were produced by the **legacy** trainer `train_models.py` (they contain a bare `RandomForestClassifier` and two bare `Pipeline`s). `main.py` expects the **dictionary** format written by `scripts/train_*.py` (keys `pipeline`, `sales_pipeline`, `level_pipeline`). Calling the inference functions with these files raised: fraud → `TypeError: list indices must be integers or slices, not str`; intent → `KeyError: 'pipeline'`; demand → `KeyError: 'sales_pipeline'`. Over HTTP these become **500 errors**, and the Node `mlService` then returns its own fallback values.
> - Running `python scripts/train_intent_model.py` (etc.) or calling `POST /train/<type>` rewrites the files in the dictionary format and makes the trained models usable. `models/model_metrics.json` (dated 2026-09-26) describes dictionary-format models, i.e. not the files currently on disk.

---

## `main.py` — FastAPI app

| Symbol | Line | Behaviour |
|---|---|---|
| `app = FastAPI(...)` + `CORSMiddleware(allow_origins=["*"])` | `:22-35` | Open CORS; **no authentication** — anyone who can reach port 8000 can score, read metrics or **retrain** models. Only the Node API is meant to call it (`ML_SERVICE_URL`). |
| Paths | `:37-41` | `models/fraud_model.joblib`, `demand_model.joblib`, `intent_model.joblib`, `model_metrics.json`. |
| `load_models()` | `:47` | Loads each file that exists into globals `fraud_pkg`, `demand_pkg`, `intent_pkg`; a load error is printed and swallowed. Runs at import (`:59`) and again whenever a package is `None` at request time, and after training. |
| Pydantic request/response models | `:64-144` | `FraudScoreRequest` (core features + telemetry aliases), `FraudScoreResponse`, `DemandForecastRequest` (+ aliases `marketing_tier`, `avg_ticket_price`, `is_weekend`), `DemandForecastResponse`, `IntentPredictRequest` (+ aliases), `IntentPredictResponse`, `TrainingResponse`. All fields optional with defaults, so missing values never fail validation. |

<a id="ml-execute-fraud"></a>
### `execute_fraud_score(req)` — `:149`
1. **Missing-value handling / feature derivation:** `speed` = `purchase_speed_seconds` → `checkout_duration_seconds` → 25; `devices` = `device_change_count` → `device_switches` → 0; `tickets` = `ticket_count` → `tickets_requested` → 2; `clicks` default 30; `rapid_seats` default 1.
2. **Anomaly text** (rules): speed < 3 s, clicks > 150/min, seat attempts ≥ 5, devices ≥ 2.
3. **Imputed model features** when not supplied: `account_age_days` = 0.5 if speed < 2 or seat attempts ≥ 5, else 180; `failed_payments` = 2 if seat attempts ≥ 10 else 0 (note: the Pydantic default is already 0, so this branch only runs if the client sends `null`); `ip_city_mismatch` similarly; `total_amount` = tickets × 3500; `resale_attempts` default 0.
4. **Model path** (`fraud_pkg` loaded): one-row DataFrame with the 8 training features → `pipeline.predict_proba(...)[0][1]` = probability of fraud. **Post-model overrides:** speed < 1 s or clicks > 300 → probability ≥ 0.95; speed > 30 s and clicks < 50 → probability ≤ 0.15. Score = probability × 100.
5. **Heuristic path** (no model): 10 +55 (speed < 3) +25 (clicks > 150) +20 (seat attempts ≥ 5), max 99.
6. **Thresholds:** ≥ 75 → `HIGH_RISK_BOT` / `CRITICAL_BOT` / `BLOCK_TRANSACTION` / `is_bot`; ≥ 45 → `SUSPICIOUS` / `REQUIRE_CAPTCHA_OR_REVIEW`; else `NORMAL` / `LOW` / `ALLOW`. `confidence` = the probability.
- Note: `clicks_per_minute`, `rapid_seat_attempts` and `time_on_seatmap_seconds` are **not model inputs** in this version (the model was trained on `fraud_purchases.csv` columns); they only influence the overrides, imputations and anomaly text.

<a id="ml-execute-demand"></a>
### `execute_demand_forecast(req)` — `:234`
1. `price` = `ticket_prices` → `avg_ticket_price` → 2500. `marketing_score` = given, else HIGH 92 / LOW 35 / other 65. `day_of_week` = given, else Saturday if `is_weekend == 1`, else Wednesday. `popularity_score` = given, else 90 (HIGH marketing) or 80. `publish_hour` default 18.
2. **Model path:** `sales_pipeline.predict` (Gradient Boosting regression of 48-hour sales), clipped to `[100, venue_capacity]`; `level_pipeline.predict` (Random Forest class `LOW|MEDIUM|HIGH|VERY_HIGH`).
3. **Heuristic path:** sales = 78 % of capacity, level `HIGH`.
4. `sellout_probability` = sales ÷ capacity (a ratio, not a calibrated probability); revenue = sales × price.
5. **`demand_tier` rule:** ratio ≥ 0.70 **or marketing tier HIGH** → `VERY_HIGH`; ≥ 0.55 → `HIGH`; ≥ 0.40 → `MODERATE`; else `LOW`, each with a fixed recommendation text. Because `eventController.getPreLaunchDemandForecast` sends `marketingTier: 'HIGH'` by default, its `demand_tier` is always `VERY_HIGH` unless the organizer simulates another tier (observed in code).

<a id="ml-execute-intent"></a>
### `execute_intent_predict(req)` — `:307`
1. Defaults: views 3, seat 1, checkout started 1, abandoned 0, price 3000, Lahore, cricket, previous purchases 1.
2. **Model path:** Gradient Boosting regressor predicts a 0–100 score (clipped). **Heuristic path:** 50 +35 (checkout started) +15 (seat).
3. Thresholds: ≥ 70 `HIGH_INTENT` → `DISPATCH_SMS_REMINDER`; ≥ 40 `MODERATE` → `MONITOR_SESSION`; else `CASUAL_BROWSER` → `PASSIVE_RETENTION`.

### HTTP endpoints
| Route | Line | Handler |
|---|---|---|
| `GET /` (`read_root`) | `:361` | Service info and which packages are loaded (non-`None`, even if in the wrong format). |
| `GET /health` (`health_check`) | `:383` | `{status:'healthy', models_loaded:{…}}`. |
| `GET /models/metrics` (`get_model_metrics`) | `:397` | Contents of `models/model_metrics.json`. |
| `POST /fraud/score`, `/predict/fraud` (`post_fraud_score`, `post_predict_fraud_alias`) | `:408`, `:412` | `execute_fraud_score`. |
| `POST /forecast/demand`, `/predict/demand` (`post_forecast_demand`, `post_predict_demand_alias`) | `:416`, `:420` | `execute_demand_forecast`. |
| `POST /intent/predict`, `/predict/intent` (`post_intent_predict`, `post_predict_intent_alias`) | `:424`, `:428` | `execute_intent_predict`. |
| `POST /train/intent` (`post_train_intent`) | `:435` | `train_intent()` (synchronous — blocks the request for the whole training run), `load_models()`, returns metrics/duration. Errors → HTTP 500 with detail. |
| `POST /train/fraud` (`post_train_fraud`) | `:454` | `train_fraud()` likewise. |
| `POST /train/demand` (`post_train_demand`) | `:473` | `train_demand()` likewise. |

`BackgroundTasks` is imported but unused.

---

## Training scripts (offline; run manually or via `POST /train/*`)

### `scripts/generate_synthetic_data.py` — **all training data is synthetic**
| Function | Line | Output |
|---|---|---|
| `check_huggingface_datasets()` | `:45` | Sends `HEAD` requests to three Hugging Face dataset URLs and prints the HTTP status; **no data is downloaded or used**. |
| `generate_behavior_sequences(n_rows=100000, seed=42)` | `:64` | `data/behavior_sequences.csv`. Views ~ geometric; seat selection probability rises with views; checkout mostly after seat selection; label `purchase_intent_score = clip(round(views(≤10)×2.5 + seat×24 + checkout×32 − abandoned×18 + prev_purchases(≤5)×4 + event boost − price penalty + N(0,4)), 5, 99)`. |
| `generate_fraud_purchases(n_rows=50000, seed=42)` | `:134` | `data/fraud_purchases.csv`; 12 % fraud; bots get young accounts, more tickets, failed payments, device changes, IP mismatch, sub-3.5 s purchases, resale attempts. `fraud_score` label = `is_fraud×60 + devices×7 + mismatch×15 + 22·[speed<2] + failed×4.5 + resale×6 + noise`. |
| `generate_event_demand(n_rows=5000, seed=42)` | `:215` | `data/event_demand.csv`; capacity and price ranges per event type; `demand_index = popularity×0.45 + marketing×0.30 + weekend×12 + type_factor×10 − price/1200`; sales ratio = clip(index/120, 0.15, 0.98); level thresholds 0.80/0.55/0.35. |
| `generate_attendance_no_show(n_rows=50000, seed=42)` | `:303` | `data/attendance_no_show.csv` (weather, distance, price, resale → check-in probability). **No script trains on it and no code reads it** (the organizer dashboard's attendance prediction is a fixed rule). |
| `main()` | `:353` | Runs all four. |

Because labels are generated from the same features by formulas, very high test scores are expected (e.g. fraud accuracy 1.0, intent R² 0.976 in `model_metrics.json`) and **say nothing about real-world performance**.

### `scripts/train_fraud_model.py` — `train_fraud()` (`:31`)
Reads `fraud_purchases.csv`; features `account_age_days, ticket_count, total_amount, failed_payments, device_change_count, ip_city_mismatch, purchase_speed_seconds, resale_attempts`; target `is_fraud`; stratified 70/15/15 split (seed 42); `StandardScaler` → `CalibratedClassifierCV(RandomForestClassifier(100 trees, depth 12), cv=3)`; reports accuracy/precision/recall/F1/ROC-AUC on validation and test; saves `{pipeline, features, target, metrics, classification_tiers, training_metadata}` to `models/fraud_model.joblib`; writes `data/test_fraud.csv`.

### `scripts/train_intent_model.py` — `train_intent()` (`:27`)
Reads `behavior_sequences.csv`; numeric features scaled, `city`/`event_type` one-hot (`handle_unknown="ignore"`, so unseen cities don't crash); `GradientBoostingRegressor(120, lr 0.08, depth 5, subsample 0.85)`; R²/RMSE/MAE; saves `{pipeline, …}` to `intent_model.joblib`; writes `data/test_intent.csv`.

### `scripts/train_demand_model.py` — `train_demand()` (`:27`)
Reads `event_demand.csv`; one-hot `event_type, city, day_of_week`, scaled numerics; **two pipelines** on the same preprocessing: `GradientBoostingRegressor` for `predicted_48h_sales` and `RandomForestClassifier(100, depth 10)` for `demand_level`; stratified on level; saves `{sales_pipeline, level_pipeline, …}` to `demand_model.joblib`; writes `data/test_demand.csv`.

### `scripts/evaluate_models.py` — `evaluate_all()` (`:28`)
Loads each dictionary-format model and its `data/test_*.csv`, recomputes metrics, prints a report and writes `models/model_metrics.json`. Fails (or skips) with legacy-format files.

### `train_models.py` (top level) — **legacy, incompatible**
`train_fraud_model()` (`:25`), `train_demand_model()` (`:68`), `train_intent_model()` (`:135`) generate their own random data in memory (different feature sets: e.g. clicks per minute, marketing tier, session duration) and save **bare estimators**. `main.py` cannot use these files (see the status box above). Treat this file as superseded by `scripts/`.

### `test_health.py`
`test_root()` asserts `GET /` returns `service == "TicketLedger ML Service"`, but `read_root` returns `"TicketLedger AI Analytics & Bot Defense Engine (Module 15)"`, so **this assertion fails** against the current code (not executed here; inferred from the source). `test_health()` matches the current `/health` response. Requires `httpx` for FastAPI's `TestClient`, which is not in `requirements.txt`.

### Data files (`apps/ml-service/data/`)
| File | Rows | Produced by | Used by |
|---|---|---|---|
| `behavior_sequences.csv` | 100 000 | generator | `train_intent` |
| `fraud_purchases.csv` | 50 000 | generator | `train_fraud` |
| `event_demand.csv` | 5 000 | generator | `train_demand` |
| `attendance_no_show.csv` | 50 000 | generator | nothing |
| `test_intent.csv`, `test_fraud.csv`, `test_demand.csv` | 15 000 / 7 500 / 750 | training scripts | `evaluate_models.py` |
