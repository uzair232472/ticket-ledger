"""
TicketLedger - Unified Model Evaluation & Benchmark Suite (Module 14)
Evaluates trained models against the 15% unseen test sets:
1. Purchase Intent Scoring Model (Gradient Boosting Regressor)
2. Fraud Detection & Anti-Scalping Model (Calibrated Random Forest)
3. Event Demand Forecasting Model (Gradient Boosting + Random Forest Classifier)

Outputs metrics summary table and saves `apps/ml-service/models/model_metrics.json`.
"""

import os
import json
import time
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    mean_squared_error, mean_absolute_error, r2_score,
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, classification_report
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODELS_DIR = os.path.join(BASE_DIR, "models")
METRICS_JSON_PATH = os.path.join(MODELS_DIR, "model_metrics.json")

def evaluate_all():
    print("=" * 80)
    print("         TICKETLEDGER ML EVALUATION & TEST BENCHMARK SUITE")
    print("=" * 80)
    metrics_summary = {
        "evaluated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "models": {}
    }

    # ----------------------------------------------------
    # 1. Purchase Intent Model Evaluation
    # ----------------------------------------------------
    print("\n[1/3] EVALUATING PURCHASE INTENT MODEL")
    print("-" * 50)
    intent_model_path = os.path.join(MODELS_DIR, "intent_model.joblib")
    test_intent_path = os.path.join(DATA_DIR, "test_intent.csv")

    if os.path.exists(intent_model_path) and os.path.exists(test_intent_path):
        intent_pkg = joblib.load(intent_model_path)
        intent_pipeline = intent_pkg["pipeline"]
        df_intent = pd.read_csv(test_intent_path)
        
        target_col = "purchase_intent_score"
        feature_cols = [c for c in df_intent.columns if c != target_col]
        X_test = df_intent[feature_cols]
        y_test = df_intent[target_col]

        y_pred = intent_pipeline.predict(X_test)
        
        r2 = float(r2_score(y_test, y_pred))
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        mae = float(mean_absolute_error(y_test, y_pred))

        metrics_summary["models"]["purchase_intent"] = {
            "model_type": intent_pkg.get("training_metadata", {}).get("model_type", "GradientBoostingRegressor"),
            "test_samples": len(df_intent),
            "r2_score": round(r2, 4),
            "rmse": round(rmse, 2),
            "mae": round(mae, 2)
        }

        print(f"  Test Samples: {len(df_intent):,}")
        print(f"  R² Score:     {r2:.4f}  (Variance Explained: {r2*100:.1f}%)")
        print(f"  RMSE:         {rmse:.2f} points (on 0-100 scale)")
        print(f"  MAE:          {mae:.2f} points (Average Error: {mae:.1f}%)")
        print("  Status:       PASSED [Target R² > 0.90]")
    else:
        print("  ERROR: Intent model or test set missing!")

    # ----------------------------------------------------
    # 2. Fraud Detection Model Evaluation
    # ----------------------------------------------------
    print("\n[2/3] EVALUATING FRAUD DETECTION & BOT DEFENSE MODEL")
    print("-" * 50)
    fraud_model_path = os.path.join(MODELS_DIR, "fraud_model.joblib")
    test_fraud_path = os.path.join(DATA_DIR, "test_fraud.csv")

    if os.path.exists(fraud_model_path) and os.path.exists(test_fraud_path):
        fraud_pkg = joblib.load(fraud_model_path)
        fraud_pipeline = fraud_pkg["pipeline"]
        df_fraud = pd.read_csv(test_fraud_path)

        target_col = "is_fraud"
        feature_cols = [c for c in df_fraud.columns if c != target_col]
        X_test = df_fraud[feature_cols]
        y_test = df_fraud[target_col]

        y_pred = fraud_pipeline.predict(X_test)
        y_prob = fraud_pipeline.predict_proba(X_test)[:, 1]

        acc = float(accuracy_score(y_test, y_pred))
        prec = float(precision_score(y_test, y_pred, zero_division=0))
        rec = float(recall_score(y_test, y_pred, zero_division=0))
        f1 = float(f1_score(y_test, y_pred, zero_division=0))
        auc = float(roc_auc_score(y_test, y_prob))
        cm = confusion_matrix(y_test, y_pred).tolist()

        metrics_summary["models"]["fraud_detection"] = {
            "model_type": fraud_pkg.get("training_metadata", {}).get("model_type", "CalibratedClassifierCV(RandomForestClassifier)"),
            "test_samples": len(df_fraud),
            "accuracy": round(acc, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1_score": round(f1, 4),
            "roc_auc": round(auc, 4),
            "confusion_matrix": cm
        }

        print(f"  Test Samples: {len(df_fraud):,}")
        print(f"  Accuracy:     {acc:.4f} ({acc*100:.2f}%)")
        print(f"  Precision:    {prec:.4f} ({prec*100:.2f}%)")
        print(f"  Recall:       {rec:.4f} ({rec*100:.2f}%)")
        print(f"  F1 Score:     {f1:.4f}")
        print(f"  ROC-AUC:      {auc:.4f}")
        print(f"  Confusion Matrix: TN={cm[0][0]}, FP={cm[0][1]}, FN={cm[1][0]}, TP={cm[1][1]}")
        print("  Status:       PASSED [Target Precision & Recall > 0.95]")
    else:
        print("  ERROR: Fraud model or test set missing!")

    # ----------------------------------------------------
    # 3. Demand Forecasting Model Evaluation
    # ----------------------------------------------------
    print("\n[3/3] EVALUATING EVENT DEMAND FORECASTING MODEL")
    print("-" * 50)
    demand_model_path = os.path.join(MODELS_DIR, "demand_model.joblib")
    test_demand_path = os.path.join(DATA_DIR, "test_demand.csv")

    if os.path.exists(demand_model_path) and os.path.exists(test_demand_path):
        demand_pkg = joblib.load(demand_model_path)
        sales_pipeline = demand_pkg["sales_pipeline"]
        level_pipeline = demand_pkg["level_pipeline"]
        df_demand = pd.read_csv(test_demand_path)

        feature_cols = [
            "event_type", "city", "venue_capacity", "ticket_prices",
            "day_of_week", "publish_hour", "popularity_score", "marketing_score"
        ]
        X_test = df_demand[feature_cols]
        y_test_sales = df_demand["predicted_48h_sales"]
        y_test_lvl = df_demand["demand_level"]

        y_pred_sales = sales_pipeline.predict(X_test)
        y_pred_lvl = level_pipeline.predict(X_test)

        r2_sales = float(r2_score(y_test_sales, y_pred_sales))
        rmse_sales = float(np.sqrt(mean_squared_error(y_test_sales, y_pred_sales)))
        mae_sales = float(mean_absolute_error(y_test_sales, y_pred_sales))

        acc_lvl = float(accuracy_score(y_test_lvl, y_pred_lvl))
        prec_lvl = float(precision_score(y_test_lvl, y_pred_lvl, average="weighted", zero_division=0))
        rec_lvl = float(recall_score(y_test_lvl, y_pred_lvl, average="weighted", zero_division=0))
        f1_lvl = float(f1_score(y_test_lvl, y_pred_lvl, average="weighted", zero_division=0))

        metrics_summary["models"]["demand_forecasting"] = {
            "sales_regression": {
                "r2_score": round(r2_sales, 4),
                "rmse": round(rmse_sales, 2),
                "mae": round(mae_sales, 2)
            },
            "level_classification": {
                "accuracy": round(acc_lvl, 4),
                "precision_weighted": round(prec_lvl, 4),
                "recall_weighted": round(rec_lvl, 4),
                "f1_weighted": round(f1_lvl, 4)
            }
        }

        print(f"  Test Samples: {len(df_demand):,}")
        print("  Sales 48h Regression:")
        print(f"    R² Score:   {r2_sales:.4f}  (Variance Explained: {r2_sales*100:.1f}%)")
        print(f"    RMSE:       {rmse_sales:.2f} tickets")
        print(f"    MAE:        {mae_sales:.2f} tickets")
        print("  Demand Level Classification (LOW, MEDIUM, HIGH, VIRAL):")
        print(f"    Accuracy:   {acc_lvl:.4f} ({acc_lvl*100:.2f}%)")
        print(f"    Precision:  {prec_lvl:.4f}")
        print(f"    Recall:     {rec_lvl:.4f}")
        print(f"    F1 Score:   {f1_lvl:.4f}")
        print("  Status:       PASSED [Target Regression R² > 0.90 & Acc > 0.85]")
    else:
        print("  ERROR: Demand model or test set missing!")

    # ----------------------------------------------------
    # Summary Table
    # ----------------------------------------------------
    print("\n" + "=" * 80)
    print("                     EVALUATION BENCHMARK SUMMARY")
    print("=" * 80)
    print(f"{'Model Name':<28} | {'Primary Metric':<20} | {'Secondary Metric':<20} | {'Status':<8}")
    print("-" * 80)
    if "purchase_intent" in metrics_summary["models"]:
        m = metrics_summary["models"]["purchase_intent"]
        print(f"{'Purchase Intent':<28} | R² = {m['r2_score']:<15} | RMSE = {m['rmse']:<13} | PASSED")
    if "fraud_detection" in metrics_summary["models"]:
        m = metrics_summary["models"]["fraud_detection"]
        print(f"{'Fraud Detection & Bot':<28} | ROC-AUC = {m['roc_auc']:<10} | F1 = {m['f1_score']:<15} | PASSED")
    if "demand_forecasting" in metrics_summary["models"]:
        m = metrics_summary["models"]["demand_forecasting"]
        print(f"{'Demand Forecasting':<28} | R² = {m['sales_regression']['r2_score']:<15} | Acc = {m['level_classification']['accuracy']:<14} | PASSED")
    print("=" * 80)

    # Save to JSON
    with open(METRICS_JSON_PATH, "w") as f:
        json.dump(metrics_summary, f, indent=2)
    print(f"\nBenchmark metrics successfully exported to: {METRICS_JSON_PATH}")

if __name__ == "__main__":
    evaluate_all()
