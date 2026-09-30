"""
TicketLedger - Train Fraud Detection Model (Module 14)
Input Features: account_age_days, ticket_count, total_amount, failed_payments, device_change_count, ip_city_mismatch, purchase_speed_seconds, resale_attempts
Target: is_fraud (0 or 1), fraud_score (0-100)
Data Split: 70% Train / 15% Validation / 15% Test
Model: RandomForestClassifier with Calibrated Probability Output
"""

import os
import time
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix, classification_report
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_PATH = os.path.join(DATA_DIR, "fraud_purchases.csv")
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)
MODEL_SAVE_PATH = os.path.join(MODELS_DIR, "fraud_model.joblib")

def train_fraud():
    print("=" * 65)
    print("Training Fraud Detection Model (Calibrated Random Forest)")
    print("=" * 65)
    start_time = time.time()

    # 1. Load Data
    print(f"Loading dataset from: {DATA_PATH}")
    df = pd.read_csv(DATA_PATH)
    print(f"Dataset shape: {df.shape} (Total rows: {len(df):,})")

    features = [
        "account_age_days", "ticket_count", "total_amount",
        "failed_payments", "device_change_count", "ip_city_mismatch",
        "purchase_speed_seconds", "resale_attempts"
    ]
    target_class = "is_fraud"
    target_score = "fraud_score"

    X = df[features]
    y_class = df[target_class]
    y_score = df[target_score]

    # 2. 70 / 15 / 15 Train / Val / Test Split
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y_class, test_size=0.30, random_state=42, stratify=y_class
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.50, random_state=42, stratify=y_temp
    )

    print(f"  Training Split   (70%): {len(X_train):,} samples (Fraud: {y_train.sum():,})")
    print(f"  Validation Split (15%): {len(X_val):,} samples (Fraud: {y_val.sum():,})")
    print(f"  Testing Split    (15%): {len(X_test):,} samples (Fraud: {y_test.sum():,})")

    # 3. Pipeline Preprocessing
    preprocessor = ColumnTransformer(
        transformers=[
            ("scaler", StandardScaler(), features)
        ]
    )

    # 4. Model Training (Calibrated Random Forest)
    base_rf = RandomForestClassifier(
        n_estimators=100,
        max_depth=12,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1
    )

    calibrated_rf = CalibratedClassifierCV(estimator=base_rf, cv=3)

    pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("classifier", calibrated_rf)
    ])

    print("\nFitting Calibrated Random Forest Pipeline...")
    pipeline.fit(X_train, y_train)

    # 5. Evaluate on Validation Set
    val_preds = pipeline.predict(X_val)
    val_probs = pipeline.predict_proba(X_val)[:, 1]

    val_acc = accuracy_score(y_val, val_preds)
    val_prec = precision_score(y_val, val_preds)
    val_rec = recall_score(y_val, val_preds)
    val_f1 = f1_score(y_val, val_preds)
    val_auc = roc_auc_score(y_val, val_probs)

    print("\nValidation Set Results (15%):")
    print(f"  Accuracy:  {val_acc:.4f}")
    print(f"  Precision: {val_prec:.4f}")
    print(f"  Recall:    {val_rec:.4f}")
    print(f"  F1 Score:  {val_f1:.4f}")
    print(f"  ROC-AUC:   {val_auc:.4f}")

    # 6. Evaluate on Unseen Test Set
    test_preds = pipeline.predict(X_test)
    test_probs = pipeline.predict_proba(X_test)[:, 1]

    test_acc = accuracy_score(y_test, test_preds)
    test_prec = precision_score(y_test, test_preds)
    test_rec = recall_score(y_test, test_preds)
    test_f1 = f1_score(y_test, test_preds)
    test_auc = roc_auc_score(y_test, test_probs)
    test_cm = confusion_matrix(y_test, test_preds)

    print("\nTesting Set Results (15% Unseen):")
    print(f"  Accuracy:  {test_acc:.4f}")
    print(f"  Precision: {test_prec:.4f}")
    print(f"  Recall:    {test_rec:.4f}")
    print(f"  F1 Score:  {test_f1:.4f}")
    print(f"  ROC-AUC:   {test_auc:.4f}")
    print(f"  Confusion Matrix:\n{test_cm}")

    # 7. Save Model Pipeline and Metadata
    model_payload = {
        "pipeline": pipeline,
        "features": features,
        "target": target_class,
        "metrics": {
            "val_accuracy": float(val_acc),
            "val_precision": float(val_prec),
            "val_recall": float(val_rec),
            "val_f1": float(val_f1),
            "val_roc_auc": float(val_auc),
            "test_accuracy": float(test_acc),
            "test_precision": float(test_prec),
            "test_recall": float(test_rec),
            "test_f1": float(test_f1),
            "test_roc_auc": float(test_auc),
            "test_confusion_matrix": test_cm.tolist()
        },
        "classification_tiers": {
            "NORMAL": "fraud_score < 45",
            "SUSPICIOUS": "45 <= fraud_score < 75",
            "HIGH_RISK_BOT": "fraud_score >= 75"
        },
        "training_metadata": {
            "model_type": "CalibratedClassifierCV(RandomForestClassifier)",
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

    # Save test partition for evaluation script
    test_data_path = os.path.join(DATA_DIR, "test_fraud.csv")
    X_test_export = X_test.copy()
    X_test_export[target_class] = y_test
    X_test_export.to_csv(test_data_path, index=False)
    print(f"Exported test set to {test_data_path}")

if __name__ == "__main__":
    train_fraud()
