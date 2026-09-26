# TicketLedger ML Dataset & Training Specification

## 1. Rationale & Data Strategy
Because public real-world transactional datasets for Pakistani sporting leagues (e.g., PSL cricket, national kabaddi tournaments) and music concerts do not exist in open-access formats, TicketLedger incorporates a tailored synthetic generation pipeline inspired by public e-commerce and fraud detection patterns (such as `LaelaZorana/synthetic-ecommerce`, `jlh/uci-shopper`, and `Phoenix21/mock_fraud-detection-dataset`).

## 2. Dataset Targets
1. **`behavior_sequences.csv`** (100,000 rows):
   - User navigation sequences, event views, category filtering, seat selection, checkout initialization, and checkout abandonment.
2. **`fraud_purchases.csv`** (50,000 rows):
   - Purchase speed, ticket count anomalies, multiple payment failures, rapid resale attempts, and device/IP mismatches.
3. **`event_demand.csv`** (5,000 rows):
   - Pre-launch features (event type, city, venue capacity, tier prices, publish day/hour, organizer rating, marketing score) paired with first 48-hour sales.
4. **`attendance_no_show.csv`** (50,000 rows):
   - Historical check-in behavior and no-show rates.

## 3. Train / Validation / Test Split
All models strictly adopt a **70% / 15% / 15%** split:
- **70% Training**: Model parameter optimization.
- **15% Validation**: Hyperparameter tuning & early stopping.
- **15% Testing**: Unbiased generalization evaluation.

## 4. Model Architectures & Outputs
- **Purchase Intent Model**:
  - Predicts `purchase_intent_score` (0 - 100).
  - Used in: Organizer Intent Funnel & Abandoned Intent Dashboard.
- **Fraud Detection Model**:
  - Predicts `fraud_score` (0 - 100).
  - Used in: Super Admin Fraud Watchlist & Real-Time Alert Engine.
- **Pre-Launch Demand Forecast Model**:
  - Predicts expected 48-hour ticket sales, revenue, and demand level (`HIGH`, `MEDIUM`, `LOW`).
  - Used in: Pre-launch pricing and schedule optimization page.
