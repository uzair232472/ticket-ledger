import os
import sys
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor, GradientBoostingClassifier
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.metrics import accuracy_score, roc_auc_score, r2_score, mean_squared_error

# Ensure UTF-8 stdout if possible
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODELS_DIR, exist_ok=True)

np.random.seed(42)

def train_fraud_model():
    print("[1/3] Training AI Scalper Bot & Fraud Detection Model...")
    N = 25000
    
    is_bot = np.random.choice([0, 1], size=N, p=[0.85, 0.15])
    
    checkout_duration = np.where(is_bot == 1, np.random.uniform(0.1, 2.5, N), np.random.normal(32, 12, N).clip(6.0, 180.0))
    clicks_per_minute = np.where(is_bot == 1, np.random.uniform(150, 450, N), np.random.normal(35, 15, N).clip(5, 90))
    rapid_seat_attempts = np.where(is_bot == 1, np.random.poisson(8, N) + 3, np.random.choice([1, 2, 3], size=N, p=[0.8, 0.15, 0.05]))
    time_on_seatmap = np.where(is_bot == 1, np.random.uniform(0.2, 1.8, N), np.random.normal(25, 10, N).clip(4.0, 120.0))
    device_switches = np.where(is_bot == 1, np.random.choice([1, 2, 3, 4], size=N, p=[0.2, 0.4, 0.3, 0.1]), np.random.choice([0, 1], size=N, p=[0.95, 0.05]))
    tickets_requested = np.where(is_bot == 1, np.random.choice([4, 6, 8, 10], size=N), np.random.choice([1, 2, 3, 4], size=N, p=[0.5, 0.3, 0.15, 0.05]))
    
    df = pd.DataFrame({
        "checkout_duration_seconds": checkout_duration,
        "clicks_per_minute": clicks_per_minute,
        "rapid_seat_attempts": rapid_seat_attempts,
        "time_on_seatmap_seconds": time_on_seatmap,
        "device_switches": device_switches,
        "tickets_requested": tickets_requested,
        "is_bot": is_bot
    })
    
    X = df.drop(columns=["is_bot"])
    y = df["is_bot"]
    
    X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.30, random_state=42)
    X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.50, random_state=42)
    
    model = RandomForestClassifier(n_estimators=100, max_depth=8, random_state=42)
    model.fit(X_train, y_train)
    
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]
    
    acc = accuracy_score(y_test, y_pred)
    auc = roc_auc_score(y_test, y_proba)
    print(f"   -> Fraud Model Accuracy: {acc * 100:.2f}% | ROC-AUC: {auc:.4f}")
    
    joblib.dump(model, os.path.join(MODELS_DIR, "fraud_model.joblib"))
    print("   -> Saved to models/fraud_model.joblib")


def train_demand_model():
    print("[2/3] Training Pre-Launch Demand Forecasting Model...")
    N = 10000
    
    event_types = ["CRICKET_MATCH", "FOOTBALL_MATCH", "MUSIC_CONCERT", "KABADDI", "MUSIC_FESTIVAL"]
    cities = ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Multan", "Peshawar"]
    marketing_tiers = ["LOW", "MEDIUM", "HIGH"]
    
    cat_type = np.random.choice(event_types, size=N, p=[0.40, 0.15, 0.25, 0.10, 0.10])
    city = np.random.choice(cities, size=N, p=[0.35, 0.30, 0.15, 0.08, 0.07, 0.05])
    mkt = np.random.choice(marketing_tiers, size=N, p=[0.3, 0.5, 0.2])
    venue_cap = np.random.choice([5000, 12000, 25000, 35000, 42000], size=N)
    avg_price = np.random.uniform(500, 12000, size=N)
    is_weekend = np.random.choice([0, 1], size=N, p=[0.4, 0.6])
    
    base_rate = np.where(cat_type == "CRICKET_MATCH", 0.75, np.where(cat_type == "MUSIC_CONCERT", 0.65, 0.50))
    city_mult = np.where(np.isin(city, ["Lahore", "Karachi"]), 1.15, 1.0)
    mkt_mult = np.where(mkt == "HIGH", 1.25, np.where(mkt == "MEDIUM", 1.0, 0.8))
    price_penalty = 1.0 - (avg_price / 30000.0).clip(0, 0.4)
    weekend_bonus = np.where(is_weekend == 1, 1.12, 0.95)
    
    ratio = (base_rate * city_mult * mkt_mult * price_penalty * weekend_bonus) + np.random.normal(0, 0.05, N)
    ratio = ratio.clip(0.10, 1.0)
    sales_48h = (venue_cap * ratio).astype(int)
    
    df = pd.DataFrame({
        "event_type": cat_type,
        "city": city,
        "marketing_tier": mkt,
        "venue_capacity": venue_cap,
        "avg_ticket_price": avg_price,
        "is_weekend": is_weekend,
        "sales_48h": sales_48h
    })
    
    X = df.drop(columns=["sales_48h"])
    y = df["sales_48h"]
    
    categorical_features = ["event_type", "city", "marketing_tier"]
    numeric_features = ["venue_capacity", "avg_ticket_price", "is_weekend"]
    
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), numeric_features),
            ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_features)
        ]
    )
    
    pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("regressor", GradientBoostingRegressor(n_estimators=100, max_depth=5, random_state=42))
    ])
    
    X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.30, random_state=42)
    X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.50, random_state=42)
    
    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)
    
    r2 = r2_score(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    print(f"   -> Demand Forecast R2 Score: {r2:.4f} | RMSE: {rmse:.1f} tickets")
    
    joblib.dump(pipeline, os.path.join(MODELS_DIR, "demand_model.joblib"))
    print("   -> Saved to models/demand_model.joblib")


def train_intent_model():
    print("[3/3] Training Purchase Intent Scoring Model...")
    N = 20000
    
    session_duration = np.random.exponential(scale=180, size=N).clip(5, 1200)
    event_views = np.random.poisson(lam=4, size=N) + 1
    seat_map_interacted = np.random.choice([0, 1], size=N, p=[0.35, 0.65])
    checkout_started = np.where(seat_map_interacted == 1, np.random.choice([0, 1], size=N, p=[0.4, 0.6]), 0)
    
    log_odds = -2.0 + (session_duration / 250.0) + (event_views * 0.25) + (seat_map_interacted * 1.5) + (checkout_started * 3.0)
    prob = 1.0 / (1.0 + np.exp(-log_odds))
    completed_purchase = (np.random.rand(N) < prob).astype(int)
    
    df = pd.DataFrame({
        "session_duration_seconds": session_duration,
        "event_views_count": event_views,
        "seat_map_interacted": seat_map_interacted,
        "checkout_started": checkout_started,
        "completed": completed_purchase
    })
    
    X = df.drop(columns=["completed"])
    y = df["completed"]
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)
    
    pipeline = Pipeline(steps=[
        ("scaler", StandardScaler()),
        ("classifier", GradientBoostingClassifier(n_estimators=80, max_depth=4, random_state=42))
    ])
    pipeline.fit(X_train, y_train)
    
    acc = accuracy_score(y_test, pipeline.predict(X_test))
    auc = roc_auc_score(y_test, pipeline.predict_proba(X_test)[:, 1])
    print(f"   -> Purchase Intent Accuracy: {acc * 100:.2f}% | ROC-AUC: {auc:.4f}")
    
    joblib.dump(pipeline, os.path.join(MODELS_DIR, "intent_model.joblib"))
    print("   -> Saved to models/intent_model.joblib")


if __name__ == "__main__":
    print("==================================================")
    print("TicketLedger ML Service - Automated Model Training")
    print("==================================================")
    train_fraud_model()
    train_demand_model()
    train_intent_model()
    print("SUCCESS: All 3 Production ML Models Trained & Serialized Successfully!")
