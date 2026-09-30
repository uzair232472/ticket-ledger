"""
TicketLedger - Train Event Demand Forecasting Model (Module 14)
Input Features: event_type, city, venue_capacity, ticket_prices, day_of_week, publish_hour, popularity_score, marketing_score
Target Outputs: predicted_48h_sales, expected_revenue_pkr, demand_level (LOW, MEDIUM, HIGH, VIRAL)
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
from sklearn.ensemble import GradientBoostingRegressor, RandomForestClassifier
from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error, accuracy_score, classification_report

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_PATH = os.path.join(DATA_DIR, "event_demand.csv")
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)
MODEL_SAVE_PATH = os.path.join(MODELS_DIR, "demand_model.joblib")

def train_demand():
    print("=" * 65)
    print("Training Event Demand Forecasting Model (Gradient Boosting)")
    print("=" * 65)
    start_time = time.time()

    # 1. Load Data
    print(f"Loading dataset from: {DATA_PATH}")
    df = pd.read_csv(DATA_PATH)
    print(f"Dataset shape: {df.shape} (Total rows: {len(df):,})")

    features = [
        "event_type", "city", "venue_capacity", "ticket_prices",
        "day_of_week", "publish_hour", "popularity_score", "marketing_score"
    ]
    target_sales = "predicted_48h_sales"
    target_revenue = "expected_revenue_pkr"
    target_level = "demand_level"

    X = df[features]
    y_sales = df[target_sales]
    y_level = df[target_level]

    # 2. 70 / 15 / 15 Train / Val / Test Split
    X_train, X_temp, y_train_sales, y_temp_sales, y_train_lvl, y_temp_lvl = train_test_split(
        X, y_sales, y_level, test_size=0.30, random_state=42, stratify=y_level
    )
    X_val, X_test, y_val_sales, y_test_sales, y_val_lvl, y_test_lvl = train_test_split(
        X_temp, y_temp_sales, y_temp_lvl, test_size=0.50, random_state=42, stratify=y_temp_lvl
    )

    print(f"  Training Split   (70%): {len(X_train):,} samples")
    print(f"  Validation Split (15%): {len(X_val):,} samples")
    print(f"  Testing Split    (15%): {len(X_test):,} samples")

    # 3. Pipeline Preprocessing
    categorical_cols = ["event_type", "city", "day_of_week"]
    numerical_cols = [
        "venue_capacity", "ticket_prices",
        "publish_hour", "popularity_score", "marketing_score"
    ]

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), numerical_cols),
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), categorical_cols)
        ]
    )

    # 4. Model Training: Sales Regressor
    regressor = GradientBoostingRegressor(
        n_estimators=120,
        learning_rate=0.08,
        max_depth=5,
        random_state=42
    )

    sales_pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("regressor", regressor)
    ])

    print("\nFitting Demand Sales Regressor Pipeline...")
    sales_pipeline.fit(X_train, y_train_sales)

    # 5. Model Training: Demand Level Classifier
    classifier = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        random_state=42
    )

    level_pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("classifier", classifier)
    ])

    print("Fitting Demand Level Classifier Pipeline...")
    level_pipeline.fit(X_train, y_train_lvl)

    # 6. Evaluate Sales Model
    val_preds_sales = sales_pipeline.predict(X_val)
    val_r2 = r2_score(y_val_sales, val_preds_sales)
    val_rmse = np.sqrt(mean_squared_error(y_val_sales, val_preds_sales))
    val_mae = mean_absolute_error(y_val_sales, val_preds_sales)

    test_preds_sales = sales_pipeline.predict(X_test)
    test_r2 = r2_score(y_test_sales, test_preds_sales)
    test_rmse = np.sqrt(mean_squared_error(y_test_sales, test_preds_sales))
    test_mae = mean_absolute_error(y_test_sales, test_preds_sales)

    print("\nSales Regression Results:")
    print(f"  Validation R²: {val_r2:.4f}, RMSE: {val_rmse:.2f}, MAE: {val_mae:.2f}")
    print(f"  Testing R²:    {test_r2:.4f}, RMSE: {test_rmse:.2f}, MAE: {test_mae:.2f}")

    # 7. Evaluate Demand Level Classifier
    val_preds_lvl = level_pipeline.predict(X_val)
    val_acc = accuracy_score(y_val_lvl, val_preds_lvl)

    test_preds_lvl = level_pipeline.predict(X_test)
    test_acc = accuracy_score(y_test_lvl, test_preds_lvl)

    print("\nDemand Level Classification Results:")
    print(f"  Validation Accuracy: {val_acc:.4f}")
    print(f"  Testing Accuracy:    {test_acc:.4f}")

    # 8. Save Model Payload
    model_payload = {
        "sales_pipeline": sales_pipeline,
        "level_pipeline": level_pipeline,
        "features": features,
        "targets": ["predicted_48h_sales", "expected_revenue_pkr", "demand_level"],
        "metrics": {
            "sales_regression": {
                "val_r2": float(val_r2),
                "val_rmse": float(val_rmse),
                "val_mae": float(val_mae),
                "test_r2": float(test_r2),
                "test_rmse": float(test_rmse),
                "test_mae": float(test_mae)
            },
            "level_classification": {
                "val_accuracy": float(val_acc),
                "test_accuracy": float(test_acc)
            }
        },
        "training_metadata": {
            "sales_model": "GradientBoostingRegressor",
            "level_model": "RandomForestClassifier",
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

    # Save test partition
    test_data_path = os.path.join(DATA_DIR, "test_demand.csv")
    X_test_export = X_test.copy()
    X_test_export[target_sales] = y_test_sales
    X_test_export[target_level] = y_test_lvl
    X_test_export.to_csv(test_data_path, index=False)
    print(f"Exported test set to {test_data_path}")

if __name__ == "__main__":
    train_demand()
