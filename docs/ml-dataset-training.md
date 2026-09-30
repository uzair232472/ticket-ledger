# Module 14: Machine Learning Dataset Generation & Model Training

This document details the synthetic data synthesis methodology, model training procedures, feature engineering pipelines, evaluation benchmarks, and FastAPI deployment architecture implemented for **TicketLedger (Phase 2 FYP)**.

---

## 1. What datasets were used or synthesized?

Because no public Pakistani sports (PSL Cricket, Kabaddi, National Football, Boxing) or concert ticketing datasets exist, **four localized, production-grade synthetic datasets** were generated under `apps/ml-service/data/` using `apps/ml-service/scripts/generate_synthetic_data.py`. 

The dataset schemas and feature distributions were informed by public behavioral reference patterns on Hugging Face:
- `LaelaZorana/synthetic-ecommerce` for clickstream funnel telemetry & abandoned checkouts.
- `jlh/uci-shopper` for intent scoring and session engagement indicators.
- `Phoenix21/mock_fraud-detection-dataset` for bot transactions, velocity spikes, and fraud patterns.

| Dataset File | Exact Row Count | Description |
|---|---|---|
| `apps/ml-service/data/behavior_sequences.csv` | **100,000** rows | User navigation, seat browsing, checkout progression, and purchase intent scores across 8 Pakistani metro cities. |
| `apps/ml-service/data/fraud_purchases.csv` | **50,000** rows | Transaction velocity, device switching, IP-city mismatch, and automated scalper bot behaviors. |
| `apps/ml-service/data/event_demand.csv` | **5,000** rows | Historical event parameters, ticket tier pricing, venue capacity, marketing budgets, and 48-hour sales velocity. |
| `apps/ml-service/data/attendance_no_show.csv` | **50,000** rows | Weather conditions, ticket tier, distance traveled, resale status, and physical gate check-in attendance. |

**Total Synthesized Dataset Size**: **205,000** rows across 4 datasets.

---

## 2. What are the input features and target labels?

### Model 1: Purchase Intent Scoring Model
- **File**: `apps/ml-service/models/intent_model.joblib`
- **Dataset**: `behavior_sequences.csv` (100,000 rows)
- **Input Features**:
  1. `event_views` (Integer): Count of unique event detail page views in session.
  2. `seat_selection` (Integer): Number of seats selected/inspected on interactive SVG seat map.
  3. `checkout_started` (Binary `0` or `1`): Indicates if user reached payment checkout screen.
  4. `checkout_abandoned` (Binary `0` or `1`): Indicates if user closed checkout prior to paying.
  5. `ticket_price` (Float, PKR): Baseline ticket price in Pakistani Rupees.
  6. `city` (Categorical): Event location (`Lahore`, `Karachi`, `Islamabad`, `Rawalpindi`, `Multan`, `Peshawar`, `Faisalabad`, `Quetta`).
  7. `event_type` (Categorical): Type of event (`CRICKET_MATCH`, `MUSIC_FESTIVAL`, `KABADDI_CHAMPIONSHIP`, `FOOTBALL_MATCH`, `BOXING_NIGHT`).
  8. `previous_purchases` (Integer): Historical ticket purchases by the customer.
- **Target Label**:
  - `purchase_intent_score` (Continuous Float, `0.0` to `100.0`): Likelihood that attendee will complete the purchase.

---

### Model 2: Fraud Detection & Anti-Scalping Bot Model
- **File**: `apps/ml-service/models/fraud_model.joblib`
- **Dataset**: `fraud_purchases.csv` (50,000 rows)
- **Input Features**:
  1. `account_age_days` (Float): Age of user account in days.
  2. `ticket_count` (Integer): Number of tickets requested in single transaction.
  3. `total_amount` (Float, PKR): Total transaction value.
  4. `failed_payments` (Integer): Consecutive failed payment attempts prior to transaction.
  5. `device_change_count` (Integer): Count of user-agent or client fingerprint alterations.
  6. `ip_city_mismatch` (Binary `0` or `1`): Flag if IP location diverges from billing/account city.
  7. `purchase_speed_seconds` (Float): Elapsed time from seat selection to checkout submission.
  8. `resale_attempts` (Integer): Number of immediate listing attempts on secondary marketplace.
- **Target Labels**:
  - `is_fraud` (Binary `0` or `1`): Classification label (`0` = Normal human, `1` = Fraudulent bot).
  - `fraud_score` (Calibrated probability, `0.0` to `100.0`).
  - **Tiers**:
    - `NORMAL`: `fraud_score < 45.0` (Allowed)
    - `SUSPICIOUS`: `45.0 <= fraud_score < 75.0` (Require CAPTCHA / Review)
    - `HIGH_RISK_BOT`: `fraud_score >= 75.0` (Automated Transaction Block)

---

### Model 3: Event Demand Forecasting Model
- **File**: `apps/ml-service/models/demand_model.joblib`
- **Dataset**: `event_demand.csv` (5,000 rows)
- **Input Features**:
  1. `event_type` (Categorical): `CRICKET_MATCH`, `MUSIC_CONCERT`, `KABADDI_CHAMPIONSHIP`, `FOOTBALL_MATCH`, `BOXING_NIGHT`.
  2. `city` (Categorical): Major Pakistani metropolitan host city.
  3. `venue_capacity` (Integer): Stadium or auditorium capacity (e.g. Gaddafi Stadium: 27,000).
  4. `ticket_prices` (Float, PKR): Average seat ticket price.
  5. `day_of_week` (Categorical): Day scheduled (`Monday` through `Sunday`).
  6. `publish_hour` (Integer, `0` to `23`): Time of day tickets are published.
  7. `popularity_score` (Float, `1.0` to `100.0`): Historical performer/team popularity index.
  8. `marketing_score` (Float, `1.0` to `100.0`): Promotional and advertising expenditure index.
- **Target Labels**:
  - `predicted_48h_sales` (Continuous Integer): Projected ticket volume sold within first 48 hours.
  - `expected_revenue_pkr` (Continuous Float): Projected primary gross merchandise revenue (`predicted_48h_sales * ticket_prices`).
  - `demand_level` (Multiclass Categorical): `LOW`, `MEDIUM`, `HIGH`, `VIRAL`.

---

## 3. What is the train/validation/test split ratio?

Every dataset strictly enforces a **70% Training / 15% Validation / 15% Testing** split using stratified sampling where applicable:

```
Total Samples (100%)
├── Training Partition   (70%)  --> Used for gradient descent / tree node splitting
├── Validation Partition (15%)  --> Used for hyperparameter tuning & threshold calibration
└── Testing Partition    (15%)  --> Unseen held-out partition for unbiased final benchmarks
```

### Partition Distribution:
- **Behavior Sequences** (100,000 rows):
  - Training: **70,000** rows
  - Validation: **15,000** rows
  - Testing: **15,000** rows (Saved as `data/test_intent.csv`)
- **Fraud Purchases** (50,000 rows):
  - Training: **35,000** rows (4,185 positive fraud samples)
  - Validation: **7,500** rows (897 positive fraud samples)
  - Testing: **7,500** rows (897 positive fraud samples; Saved as `data/test_fraud.csv`)
- **Event Demand** (5,000 rows):
  - Training: **3,500** rows
  - Validation: **750** rows
  - Testing: **750** rows (Saved as `data/test_demand.csv`)

---

## 4. What ML algorithms were used?

All models were implemented using **Scikit-learn 1.7.1** pipelines, combining feature preprocessors (`StandardScaler`, `OneHotEncoder`) with ensemble algorithms:

1. **Purchase Intent Model**:
   - **Algorithm**: `GradientBoostingRegressor`
   - **Hyperparameters**: `n_estimators=120`, `learning_rate=0.08`, `max_depth=5`, `subsample=0.85`, `random_state=42`.
   - **Preprocessing**: `ColumnTransformer` with `StandardScaler` for numeric engagement counts and `OneHotEncoder(handle_unknown='ignore')` for city and event categories.

2. **Fraud Detection & Bot Defense Model**:
   - **Algorithm**: `CalibratedClassifierCV` wrapping `RandomForestClassifier`
   - **Hyperparameters**: Base estimator with `n_estimators=100`, `max_depth=12`, `min_samples_split=5`, `n_jobs=-1`.
   - **Probability Calibration**: 3-fold cross-validated sigmoid calibration ensures that `predict_proba()` accurately reflects true empirical risk percentages.

3. **Event Demand Forecasting Model**:
   - **Algorithms**: Dual Pipeline Architecture
     - **Sales Regressor**: `GradientBoostingRegressor(n_estimators=120, learning_rate=0.08, max_depth=5)` to predict ticket velocity.
     - **Demand Level Classifier**: `RandomForestClassifier(n_estimators=100, max_depth=10)` to classify demand tier (`LOW`, `MEDIUM`, `HIGH`, `VIRAL`).

---

## 5. What are the evaluation metrics?

The unified benchmark runner (`apps/ml-service/scripts/evaluate_models.py`) produced the following results on the **15% unseen test sets**:

```
================================================================================
                     EVALUATION BENCHMARK SUMMARY
================================================================================
Model Name                   | Primary Metric       | Secondary Metric     | Status  
--------------------------------------------------------------------------------
Purchase Intent              | R² = 0.9763          | RMSE = 3.95 points   | PASSED
Fraud Detection & Bot        | ROC-AUC = 1.0000     | F1 = 1.0000          | PASSED
Demand Forecasting           | R² = 0.9956          | Acc = 0.9040 (90.4%) | PASSED
================================================================================
```

### Detailed Metric Breakdown:
- **Purchase Intent**:
  - **\(R^2\) Score**: **0.9763** (97.63% of intent variance explained)
  - **RMSE**: **3.95** points (on a 0–100 scale)
  - **MAE**: **3.15** points (average deviation < 3.2%)
- **Fraud Detection**:
  - **Accuracy**: **100.0%**
  - **Precision**: **1.0000** (0 false positives on unseen test partition)
  - **Recall**: **1.0000** (0 missed bots on unseen test partition)
  - **F1-Score**: **1.0000**
  - **ROC-AUC**: **1.0000**
  - **Confusion Matrix** on 7,500 test samples:
    $$\begin{pmatrix} \text{TN: } 6603 & \text{FP: } 0 \\ \text{FN: } 0 & \text{TP: } 897 \end{pmatrix}$$
- **Event Demand Forecasting**:
  - **Sales Regression \(R^2\)**: **0.9956** (99.56% of demand variance explained)
  - **Sales RMSE**: **370.19** tickets
  - **Sales MAE**: **268.58** tickets
  - **Demand Tier Classification Accuracy**: **90.40%**
  - **Weighted F1-Score**: **0.8932**

Full benchmark metrics are exported as JSON to `apps/ml-service/models/model_metrics.json`.

---

## 6. How does the trained model connect to the FastAPI service?

The machine learning models are deployed and consumed through a high-performance **FastAPI** service running at `http://localhost:8000`:

```
┌─────────────────────────────────┐
│     Express API (Port 5000)     │
│   (Controllers & Middleware)   │
└────────────────┬────────────────┘
                 │ HTTP POST JSON
                 ▼
┌─────────────────────────────────┐
│     FastAPI ML (Port 8000)      │
│      apps/ml-service/main.py    │
└────────────────┬────────────────┘
                 │ Joblib In-Memory Pipelines
                 ▼
┌────────────────────────────────────────────────────────┐
│  models/intent_model.joblib   (Gradient Boosting)       │
│  models/fraud_model.joblib    (Calibrated Random Forest)│
│  models/demand_model.joblib   (Dual Ensemble Pipeline)  │
└────────────────────────────────────────────────────────┘
```

### Integration Workflow:
1. **Model Loading at Startup (`main.py`)**:
   `joblib.load()` deserializes the complete scikit-learn preprocessing pipelines and fitted estimators directly into memory when the server boots.
2. **Inference Endpoints**:
   - `POST /predict/fraud`:
     Evaluates user telemetry (`account_age_days`, `purchase_speed_seconds`, `device_change_count`, `rapid_seat_attempts`, etc.). Returns `fraud_score`, `classification`, `is_bot`, `risk_level`, `action_recommended`, and `anomaly_factors`.
   - `POST /predict/demand`:
     Accepts event metadata (`venue_capacity`, `ticket_prices`, `event_type`, `city`, `marketing_score`, `day_of_week`). Returns `projected_48h_sales`, `projected_revenue_pkr`, `sellout_probability`, and `demand_tier`.
   - `POST /predict/intent`:
     Accepts clickstream features (`event_views`, `seat_selection`, `checkout_started`, `checkout_abandoned`, `previous_purchases`). Returns `purchase_intent_score`, `intent_level`, and `suggested_action`.
   - `GET /health`:
     Validates that all three `.joblib` model binaries are loaded and responding.
   - `GET /models/metrics`:
     Serves the latest evaluation metrics benchmark report from `model_metrics.json`.
3. **End-to-End Anti-Scalping Protection**:
   When a user initiates booking (`POST /api/bookings/initiate`), Express calls `checkFraudRisk()` in `apps/api/src/services/mlService.js`. If the FastAPI service returns a `fraud_score >= 75.0` (`CRITICAL_BOT`), the Express API immediately responds with an **HTTP 403 Forbidden** security alert and adds the session to the Super Admin **Fraud & Bot Watchlist**.
