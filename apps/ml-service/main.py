import os
from typing import List, Optional
from datetime import datetime
import joblib
import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="TicketLedger ML Service",
    description="Machine Learning service for anti-scalper bot detection, pre-launch demand forecasting, and purchase intent scoring",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
FRAUD_MODEL_PATH = os.path.join(MODELS_DIR, "fraud_model.joblib")
DEMAND_MODEL_PATH = os.path.join(MODELS_DIR, "demand_model.joblib")
INTENT_MODEL_PATH = os.path.join(MODELS_DIR, "intent_model.joblib")

fraud_model = None
demand_model = None
intent_model = None

def load_models():
    global fraud_model, demand_model, intent_model
    try:
        if os.path.exists(FRAUD_MODEL_PATH):
            fraud_model = joblib.load(FRAUD_MODEL_PATH)
        if os.path.exists(DEMAND_MODEL_PATH):
            demand_model = joblib.load(DEMAND_MODEL_PATH)
        if os.path.exists(INTENT_MODEL_PATH):
            intent_model = joblib.load(INTENT_MODEL_PATH)
    except Exception as e:
        print(f"Error loading models: {e}")

load_models()

# -----------------
# Pydantic Schemas
# -----------------
class FraudCheckRequest(BaseModel):
    checkout_duration_seconds: float = Field(..., example=1.5, description="Duration from seat selection to checkout submission in seconds")
    clicks_per_minute: float = Field(default=35.0, example=240.0, description="Click frequency during session")
    rapid_seat_attempts: int = Field(default=1, example=8, description="Number of different seat locking attempts in short succession")
    time_on_seatmap_seconds: float = Field(default=20.0, example=0.9, description="Time spent inspecting seat coordinates before click")
    device_switches: int = Field(default=0, example=2, description="Number of user-agent or IP changes during session")
    tickets_requested: int = Field(default=2, example=6, description="Total quantity of tickets requested in single order")

class FraudCheckResponse(BaseModel):
    fraud_score: float
    is_bot: bool
    risk_level: str
    action_recommended: str
    anomaly_factors: List[str]
    confidence: float

class DemandForecastRequest(BaseModel):
    event_type: str = Field(default="CRICKET_MATCH", example="CRICKET_MATCH")
    city: str = Field(default="Lahore", example="Lahore")
    marketing_tier: str = Field(default="MEDIUM", example="HIGH")
    venue_capacity: int = Field(default=25000, example=27000)
    avg_ticket_price: float = Field(default=2500.0, example=3500.0)
    is_weekend: int = Field(default=1, example=1)

class DemandForecastResponse(BaseModel):
    projected_48h_sales: int
    projected_revenue_pkr: float
    sellout_probability: float
    demand_tier: str
    pricing_recommendation: str

class IntentScoreRequest(BaseModel):
    session_duration_seconds: float = Field(default=180.0, example=320.0)
    event_views_count: int = Field(default=3, example=6)
    seat_map_interacted: int = Field(default=1, example=1)
    checkout_started: int = Field(default=1, example=1)

class IntentScoreResponse(BaseModel):
    intent_score: float
    intent_level: str
    suggested_action: str

# -----------------
# Endpoints
# -----------------
@app.get("/")
def read_root():
    return {
        "service": "TicketLedger AI Analytics & Bot Defense Engine",
        "status": "online",
        "version": "2.0.0",
        "models": {
            "fraud_detection": fraud_model is not None,
            "demand_forecasting": demand_model is not None,
            "purchase_intent": intent_model is not None,
        }
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "ml-service",
        "framework": "FastAPI",
        "timestamp": datetime.utcnow().isoformat(),
        "models_loaded": {
            "fraud_model": fraud_model is not None,
            "demand_model": demand_model is not None,
            "intent_model": intent_model is not None,
        }
    }

@app.post("/predict/fraud", response_model=FraudCheckResponse)
def predict_fraud(req: FraudCheckRequest):
    # If model is not loaded, reload or fallback
    global fraud_model
    if fraud_model is None:
        load_models()
    
    anomalies = []
    if req.checkout_duration_seconds < 3.0:
        anomalies.append(f"Sub-second / inhuman checkout speed ({req.checkout_duration_seconds:.2f}s)")
    if req.clicks_per_minute > 150:
        anomalies.append(f"Superhuman click frequency ({req.clicks_per_minute:.1f} clicks/min)")
    if req.rapid_seat_attempts >= 5:
        anomalies.append(f"Rapid seat sniping pattern ({req.rapid_seat_attempts} lock attempts)")
    if req.time_on_seatmap_seconds < 1.5:
        anomalies.append(f"Immediate robotic seat acquisition ({req.time_on_seatmap_seconds:.2f}s)")
    if req.device_switches >= 2:
        anomalies.append(f"Suspicious client fingerprint hopping ({req.device_switches} switches)")

    if fraud_model is not None:
        features = pd.DataFrame([{
            "checkout_duration_seconds": req.checkout_duration_seconds,
            "clicks_per_minute": req.clicks_per_minute,
            "rapid_seat_attempts": req.rapid_seat_attempts,
            "time_on_seatmap_seconds": req.time_on_seatmap_seconds,
            "device_switches": req.device_switches,
            "tickets_requested": req.tickets_requested
        }])
        
        proba = float(fraud_model.predict_proba(features)[0][1])
        fraud_score = round(proba * 100.0, 1)
    else:
        # Rule-based fallback
        base = 10.0
        if req.checkout_duration_seconds < 3.0: base += 45.0
        if req.clicks_per_minute > 150: base += 25.0
        if req.rapid_seat_attempts >= 5: base += 20.0
        fraud_score = min(99.0, base)
        proba = fraud_score / 100.0

    is_bot = fraud_score >= 65.0
    if fraud_score >= 75.0:
        risk_level = "CRITICAL_BOT"
        action = "BLOCK_TRANSACTION"
    elif fraud_score >= 45.0:
        risk_level = "SUSPICIOUS"
        action = "REQUIRE_CAPTCHA_OR_REVIEW"
    else:
        risk_level = "LOW"
        action = "ALLOW"

    return FraudCheckResponse(
        fraud_score=fraud_score,
        is_bot=is_bot,
        risk_level=risk_level,
        action_recommended=action,
        anomaly_factors=anomalies,
        confidence=round(proba, 4)
    )

@app.post("/predict/demand", response_model=DemandForecastResponse)
def predict_demand(req: DemandForecastRequest):
    global demand_model
    if demand_model is None:
        load_models()

    if demand_model is not None:
        features = pd.DataFrame([{
            "event_type": req.event_type,
            "city": req.city,
            "marketing_tier": req.marketing_tier,
            "venue_capacity": req.venue_capacity,
            "avg_ticket_price": req.avg_ticket_price,
            "is_weekend": req.is_weekend
        }])
        pred_sales = float(demand_model.predict(features)[0])
        pred_sales = int(np.clip(pred_sales, 100, req.venue_capacity))
    else:
        # Fallback heuristic
        pred_sales = int(req.venue_capacity * 0.75)

    sellout_ratio = round(pred_sales / req.venue_capacity, 3)
    projected_revenue = float(pred_sales * req.avg_ticket_price)

    if sellout_ratio >= 0.85:
        tier = "VERY_HIGH"
        rec = f"Strong demand projected in {req.city}! High probability of 48-hour sellout. Recommend tiering premium sections."
    elif sellout_ratio >= 0.65:
        tier = "HIGH"
        rec = f"Healthy ticket uptake expected in {req.city}. Promote mid-tier seating packages."
    elif sellout_ratio >= 0.40:
        tier = "MODERATE"
        rec = "Moderate velocity. Early-bird incentives could accelerate primary sales."
    else:
        tier = "LOW"
        rec = "Consider lowering baseline ticket prices or increasing localized social marketing."

    return DemandForecastResponse(
        projected_48h_sales=pred_sales,
        projected_revenue_pkr=projected_revenue,
        sellout_probability=sellout_ratio,
        demand_tier=tier,
        pricing_recommendation=rec
    )

@app.post("/predict/intent", response_model=IntentScoreResponse)
def predict_intent(req: IntentScoreRequest):
    global intent_model
    if intent_model is None:
        load_models()

    if intent_model is not None:
        features = pd.DataFrame([{
            "session_duration_seconds": req.session_duration_seconds,
            "event_views_count": req.event_views_count,
            "seat_map_interacted": req.seat_map_interacted,
            "checkout_started": req.checkout_started
        }])
        proba = float(intent_model.predict_proba(features)[0][1])
        score = round(proba * 100.0, 1)
    else:
        score = 50.0
        if req.checkout_started: score += 35.0
        if req.seat_map_interacted: score += 15.0

    if score >= 70.0:
        level = "HIGH_INTENT"
        action = "DISPATCH_SMS_REMINDER"
    elif score >= 40.0:
        level = "MODERATE"
        action = "MONITOR_SESSION"
    else:
        level = "CASUAL_BROWSER"
        action = "PASSIVE_RETENTION"

    return IntentScoreResponse(
        intent_score=score,
        intent_level=level,
        suggested_action=action
    )
