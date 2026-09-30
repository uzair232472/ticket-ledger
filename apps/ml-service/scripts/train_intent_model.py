"""
TicketLedger - Train Purchase Intent Scoring Model (Module 14)
Input Features: event_views, seat_selection, checkout_started, checkout_abandoned, ticket_price, city, event_type, previous_purchases
Target: purchase_intent_score (0-100)
Data Split: 70% Train / 15% Validation / 15% Test
"""

import os
import time
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_PATH = os.path.join(DATA_DIR, "behavior_sequences.csv")
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)
MODEL_SAVE_PATH = os.path.join(MODELS_DIR, "intent_model.joblib")

def train_intent():
    print("=" * 65)
    print("Training Purchase Intent Model (Scikit-learn Gradient Boosting)")
    print("=" * 65)
    start_time = time.time()

    # 1. Load Data
    print(f"Loading dataset from: {DATA_PATH}")
    df = pd.read_csv(DATA_PATH)
    print(f"Dataset shape: {df.shape} (Total rows: {len(df):,})")

    features = [
        "event_views", "seat_selection", "checkout_started",
        "checkout_abandoned", "ticket_price", "city",
        "event_type", "previous_purchases"
    ]
    target = "purchase_intent_score"

    X = df[features]
    y = df[target]

    # 2. 70 / 15 / 15 Train / Val / Test Split
    # First split 70% train and 30% temp
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.30, random_state=42
    )
    # Split the 30% temp into 50/50 -> 15% val and 15% test
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.50, random_state=42
    )

    print(f"  Training Split   (70%): {len(X_train):,} samples")
    print(f"  Validation Split (15%): {len(X_val):,} samples")
    print(f"  Testing Split    (15%): {len(X_test):,} samples")

    # 3. Pipeline Preprocessing
    categorical_cols = ["city", "event_type"]
    numerical_cols = [
        "event_views", "seat_selection", "checkout_started",
        "checkout_abandoned", "ticket_price", "previous_purchases"
    ]

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), numerical_cols),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), categorical_cols)
        ]
    )

    # 4. Model Training
    model = GradientBoostingRegressor(
        n_estimators=120,
        learning_rate=0.08,
        max_depth=5,
        subsample=0.85,
        random_state=42
    )

    pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("regressor", model)
    ])

    print("\nFitting Gradient Boosting Regressor Pipeline...")
    pipeline.fit(X_train, y_train)

    # 5. Evaluate on Validation Set
    val_preds = pipeline.predict(X_val)
    val_r2 = r2_score(y_val, val_preds)
    val_rmse = np.sqrt(mean_squared_error(y_val, val_preds))
    val_mae = mean_absolute_error(y_val, val_preds)
    print("\nValidation Set Results (15%):")
    print(f"  R² Score: {val_r2:.4f}")
    print(f"  RMSE:     {val_rmse:.2f}")
    print(f"  MAE:      {val_mae:.2f}")

    # 6. Evaluate on Unseen Test Set
    test_preds = pipeline.predict(X_test)
    test_r2 = r2_score(y_test, test_preds)
    test_rmse = np.sqrt(mean_squared_error(y_test, test_preds))
    test_mae = mean_absolute_error(y_test, test_preds)
    print("\nTesting Set Results (15% Unseen):")
    print(f"  R² Score: {test_r2:.4f}")
    print(f"  RMSE:     {test_rmse:.2f}")
    print(f"  MAE:      {test_mae:.2f}")

    # 7. Save Model Pipeline and Metadata
    model_payload = {
        "pipeline": pipeline,
        "features": features,
        "target": target,
        "metrics": {
            "val_r2": float(val_r2),
            "val_rmse": float(val_rmse),
            "val_mae": float(val_mae),
            "test_r2": float(test_r2),
            "test_rmse": float(test_rmse),
            "test_mae": float(test_mae)
        },
        "training_metadata": {
            "model_type": "GradientBoostingRegressor",
            "train_samples": len(X_train),
            "val_samples": len(X_val),
            "test_samples": len(X_test),
            "trained_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
    }

    joblib.dump(model_payload, MODEL_SAVE_PATH)
    elapsed = time.time() - start_time
    print(f"\nModel exported successfully to: {MODEL_SAVE_PATH} ({os.path.getsize(MODEL_SAVE_PATH)/1024:.1f} KB)")
    print(f"Training completed in {elapsed:.2f} seconds.")

    # Save test partition for unified evaluator
    test_data_path = os.path.join(DATA_DIR, "test_intent.csv")
    X_test_export = X_test.copy()
    X_test_export[target] = y_test
    X_test_export.to_csv(test_data_path, index=False)

if __name__ == "__main__":
    train_intent()
