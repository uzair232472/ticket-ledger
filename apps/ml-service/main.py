import hashlib
import hmac
import json
import os
import sys
import threading
import time
from typing import List, Optional, Dict, Any
from datetime import datetime
import joblib
import pandas as pd
import numpy as np
import sklearn
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Ensure root directory is on python path for script imports
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

from scripts.train_intent_model import train_intent
from scripts.train_fraud_model import train_fraud
from scripts.train_demand_model import train_demand
from ml.models import predict as ml_predict
from ml.schema import ALL_SPECS, NULLABLE_FEATURES, SPECS

# Legacy formula-trained models and their /train/* endpoints only run in development with
# ML_ALLOW_SYNTHETIC=1. Otherwise the legacy endpoints answer with their built-in rules, so every
# active decision in the app comes from rules. New models only run in shadow (/v2/shadow).
ML_ENV = os.environ.get("ML_ENV", "development")
# Never in production: a synthetic model must not answer customer- or organizer-facing requests there.
ALLOW_SYNTHETIC = os.environ.get("ML_ALLOW_SYNTHETIC") == "1" and ML_ENV != "production"
if os.environ.get("ML_ALLOW_SYNTHETIC") == "1" and ML_ENV == "production":
    print("ML_ALLOW_SYNTHETIC=1 is ignored because ML_ENV=production: legacy synthetic models stay off.")
# Every legacy answer says where it came from. Synthetic answers are demonstrations only.
SYNTHETIC_NOTICE = ("Demonstration only: produced by a model trained on synthetic data. Not validated on real "
                    "sales and not a real-world prediction.")
RULES_NOTICE = "Rule-based estimate (no trained model)."
SERVICE_TOKEN = os.environ.get("ML_SERVICE_TOKEN", "")

app = FastAPI(
    title="TicketLedger ML Service",
    description="Module 15: FastAPI ML Service — Inference Engine (Intent, Fraud, Demand) & On-Demand Model Retraining",
    version="2.2.0"
)

# Internal service: only the API calls it (no browser, so no CORS). Every route except /health needs
# the shared token in X-ML-Token. In production the service refuses to work without a token.
@app.middleware("http")
async def require_service_token(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if not SERVICE_TOKEN:
        if ML_ENV == "production":
            return JSONResponse(status_code=503, content={"detail": "ML_SERVICE_TOKEN is not configured"})
        return await call_next(request)
    given = request.headers.get("x-ml-token", "")
    if not hmac.compare_digest(given.encode(), SERVICE_TOKEN.encode()):
        return JSONResponse(status_code=401, content={"detail": "invalid service token"})
    return await call_next(request)

MODELS_DIR = os.path.join(BASE_DIR, "models")
FRAUD_MODEL_PATH = os.path.join(MODELS_DIR, "fraud_model.joblib")
DEMAND_MODEL_PATH = os.path.join(MODELS_DIR, "demand_model.joblib")
INTENT_MODEL_PATH = os.path.join(MODELS_DIR, "intent_model.joblib")
METRICS_PATH = os.path.join(MODELS_DIR, "model_metrics.json")

fraud_pkg = None
demand_pkg = None
intent_pkg = None

def load_models():
    global fraud_pkg, demand_pkg, intent_pkg
    if not ALLOW_SYNTHETIC:
        return            # legacy synthetic models never drive decisions outside development
    try:
        if os.path.exists(FRAUD_MODEL_PATH):
            fraud_pkg = joblib.load(FRAUD_MODEL_PATH)
        if os.path.exists(DEMAND_MODEL_PATH):
            demand_pkg = joblib.load(DEMAND_MODEL_PATH)
        if os.path.exists(INTENT_MODEL_PATH):
            intent_pkg = joblib.load(INTENT_MODEL_PATH)
    except Exception as e:
        print(f"Error loading models: {e}")

load_models()

# -----------------
# Pydantic Schemas
# -----------------
class FraudScoreRequest(BaseModel):
    # Core Module 14/15 features
    account_age_days: Optional[float] = Field(default=None, example=180.0)
    ticket_count: Optional[int] = Field(default=None, example=2)
    total_amount: Optional[float] = Field(default=None, example=5000.0)
    failed_payments: Optional[int] = Field(default=0, example=0)
    device_change_count: Optional[int] = Field(default=None, example=0)
    ip_city_mismatch: Optional[int] = Field(default=0, example=0)
    purchase_speed_seconds: Optional[float] = Field(default=None, example=25.0)
    resale_attempts: Optional[int] = Field(default=0, example=0)
    
    # Telemetry / legacy aliases
    checkout_duration_seconds: Optional[float] = Field(default=None, example=25.0)
    clicks_per_minute: Optional[float] = Field(default=35.0, example=35.0)
    rapid_seat_attempts: Optional[int] = Field(default=1, example=1)
    time_on_seatmap_seconds: Optional[float] = Field(default=20.0, example=20.0)
    device_switches: Optional[int] = Field(default=None, example=0)
    tickets_requested: Optional[int] = Field(default=None, example=2)

class FraudScoreResponse(BaseModel):
    fraud_score: float
    classification: str
    is_bot: bool
    risk_level: str
    action_recommended: str
    anomaly_factors: List[str]
    confidence: float
    prediction_source: str = "rules"          # always the rules (no model decides checkout blocks)
    validated: bool = False
    notice: str = RULES_NOTICE

class DemandForecastRequest(BaseModel):
    # Core features
    event_type: str = Field(default="CRICKET_MATCH", example="CRICKET_MATCH")
    city: str = Field(default="Lahore", example="Lahore")
    venue_capacity: int = Field(default=25000, example=27000)
    ticket_prices: Optional[float] = Field(default=None, example=3500.0)
    day_of_week: Optional[str] = Field(default=None, example="Saturday")
    publish_hour: Optional[int] = Field(default=18, example=18)
    popularity_score: Optional[float] = Field(default=None, example=85.0)
    marketing_score: Optional[float] = Field(default=None, example=80.0)

    # Legacy aliases
    marketing_tier: Optional[str] = Field(default=None, example="HIGH")
    avg_ticket_price: Optional[float] = Field(default=None, example=3500.0)
    is_weekend: Optional[int] = Field(default=None, example=1)

class DemandForecastResponse(BaseModel):
    projected_48h_sales: int
    projected_revenue_pkr: float
    sellout_probability: float
    demand_tier: str
    demand_level: str
    pricing_recommendation: str
    prediction_source: str = "rules"          # "rules" | "synthetic-demo-model"
    validated: bool = False                    # never a validated real-world model
    notice: str = RULES_NOTICE

class IntentPredictRequest(BaseModel):
    # Core features
    event_views: Optional[int] = Field(default=None, example=4)
    seat_selection: Optional[int] = Field(default=None, example=1)
    checkout_started: Optional[int] = Field(default=1, example=1)
    checkout_abandoned: Optional[int] = Field(default=0, example=0)
    ticket_price: Optional[float] = Field(default=3000.0, example=3500.0)
    city: Optional[str] = Field(default="Lahore", example="Lahore")
    event_type: Optional[str] = Field(default="CRICKET_MATCH", example="CRICKET_MATCH")
    previous_purchases: Optional[int] = Field(default=1, example=2)

    # Legacy aliases
    session_duration_seconds: Optional[float] = Field(default=180.0, example=240.0)
    event_views_count: Optional[int] = Field(default=None, example=4)
    seat_map_interacted: Optional[int] = Field(default=None, example=1)

class IntentPredictResponse(BaseModel):
    purchase_intent_score: float
    intent_score: float
    intent_level: str
    suggested_action: str
    prediction_source: str = "rules"          # "rules" | "synthetic-demo-model"
    validated: bool = False
    notice: str = RULES_NOTICE

class TrainingResponse(BaseModel):
    success: bool
    model_name: str
    message: str
    metrics: Dict[str, Any]
    duration_seconds: float
    timestamp: str

# -----------------
# Core Inference Logic
# -----------------
def execute_fraud_score(req: FraudScoreRequest) -> FraudScoreResponse:
    global fraud_pkg
    if fraud_pkg is None:
        load_models()

    speed = req.purchase_speed_seconds if req.purchase_speed_seconds is not None else (req.checkout_duration_seconds or 25.0)
    devices = req.device_change_count if req.device_change_count is not None else (req.device_switches or 0)
    tickets = req.ticket_count if req.ticket_count is not None else (req.tickets_requested or 2)
    clicks = req.clicks_per_minute or 30.0
    rapid_seats = req.rapid_seat_attempts or 1

    anomalies = []
    if speed < 3.0:
        anomalies.append(f"Sub-second / inhuman checkout speed ({speed:.2f}s)")
    if clicks > 150:
        anomalies.append(f"Superhuman click frequency ({clicks:.1f} clicks/min)")
    if rapid_seats >= 5:
        anomalies.append(f"Rapid seat sniping pattern ({rapid_seats} lock attempts)")
    if devices >= 2:
        anomalies.append(f"Suspicious client fingerprint hopping ({devices} switches)")

    if req.account_age_days is not None:
        account_age = float(req.account_age_days)
    else:
        account_age = 0.5 if (speed < 2.0 or rapid_seats >= 5) else 180.0

    failed_pmts = req.failed_payments if req.failed_payments is not None else (2 if rapid_seats >= 10 else 0)
    mismatch = req.ip_city_mismatch if req.ip_city_mismatch is not None else (1 if devices >= 2 else 0)
    total_amt = req.total_amount if req.total_amount is not None else float(tickets * 3500.0)
    resale = req.resale_attempts or 0

    # Checkout blocks follow these RULES only. A trained model never decides here, not even the legacy
    # synthetic model loaded with ML_ALLOW_SYNTHETIC=1 (it used to set this score when that flag was on).
    # New models run in shadow only (/v2/shadow). Same thresholds as before, so decisions are unchanged.
    base = 10.0
    if speed < 3.0: base += 55.0
    if clicks > 150: base += 25.0
    if rapid_seats >= 5: base += 20.0
    fraud_score = min(99.0, base)
    proba = fraud_score / 100.0

    if fraud_score >= 75.0:
        classification = "HIGH_RISK_BOT"
        risk_level = "CRITICAL_BOT"
        action = "BLOCK_TRANSACTION"
        is_bot = True
    elif fraud_score >= 45.0:
        classification = "SUSPICIOUS"
        risk_level = "SUSPICIOUS"
        action = "REQUIRE_CAPTCHA_OR_REVIEW"
        is_bot = False
    else:
        classification = "NORMAL"
        risk_level = "LOW"
        action = "ALLOW"
        is_bot = False

    return FraudScoreResponse(
        fraud_score=fraud_score,
        classification=classification,
        is_bot=is_bot,
        risk_level=risk_level,
        action_recommended=action,
        anomaly_factors=anomalies,
        confidence=round(proba, 4)
    )

def execute_demand_forecast(req: DemandForecastRequest) -> DemandForecastResponse:
    global demand_pkg
    if demand_pkg is None:
        load_models()

    price = req.ticket_prices or req.avg_ticket_price or 2500.0

    if req.marketing_score is not None:
        m_score = float(req.marketing_score)
    elif req.marketing_tier == "HIGH":
        m_score = 92.0
    elif req.marketing_tier == "LOW":
        m_score = 35.0
    else:
        m_score = 65.0

    if req.day_of_week is not None:
        day_str = req.day_of_week
    elif req.is_weekend == 1:
        day_str = "Saturday"
    else:
        day_str = "Wednesday"

    pop_score = req.popularity_score if req.popularity_score is not None else (90.0 if req.marketing_tier == "HIGH" else 80.0)
    pub_hour = req.publish_hour if req.publish_hour is not None else 18

    if demand_pkg is not None:
        sales_pipe = demand_pkg["sales_pipeline"]
        level_pipe = demand_pkg["level_pipeline"]

        input_df = pd.DataFrame([{
            "event_type": req.event_type,
            "city": req.city,
            "venue_capacity": int(req.venue_capacity),
            "ticket_prices": float(price),
            "day_of_week": day_str,
            "publish_hour": int(pub_hour),
            "popularity_score": float(pop_score),
            "marketing_score": float(m_score)
        }])

        pred_sales = float(sales_pipe.predict(input_df)[0])
        pred_sales = int(np.clip(pred_sales, 100, req.venue_capacity))
        demand_level = str(level_pipe.predict(input_df)[0])
    else:
        pred_sales = int(req.venue_capacity * 0.78)
        demand_level = "HIGH"

    sellout_ratio = round(pred_sales / req.venue_capacity, 3)
    projected_revenue = float(pred_sales * price)

    if sellout_ratio >= 0.70 or req.marketing_tier == "HIGH":
        tier = "VERY_HIGH"
        rec = f"Strong demand projected in {req.city}! High probability of 48-hour sellout. Recommend tiering premium sections."
    elif sellout_ratio >= 0.55:
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
        demand_level=demand_level,
        pricing_recommendation=rec,
        prediction_source="synthetic-demo-model" if demand_pkg is not None else "rules",
        validated=False,
        notice=SYNTHETIC_NOTICE if demand_pkg is not None else RULES_NOTICE,
    )

def execute_intent_predict(req: IntentPredictRequest) -> IntentPredictResponse:
    global intent_pkg
    if intent_pkg is None:
        load_models()

    views = req.event_views if req.event_views is not None else (req.event_views_count or 3)
    seat = req.seat_selection if req.seat_selection is not None else (req.seat_map_interacted or 1)
    chk_start = req.checkout_started if req.checkout_started is not None else 1
    chk_aband = req.checkout_abandoned if req.checkout_abandoned is not None else 0
    t_price = req.ticket_price or 3000.0
    city = req.city or "Lahore"
    ev_type = req.event_type or "CRICKET_MATCH"
    prev_purch = req.previous_purchases if req.previous_purchases is not None else 1

    if intent_pkg is not None:
        pipeline = intent_pkg["pipeline"]
        input_df = pd.DataFrame([{
            "event_views": int(views),
            "seat_selection": int(seat),
            "checkout_started": int(chk_start),
            "checkout_abandoned": int(chk_aband),
            "ticket_price": float(t_price),
            "city": city,
            "event_type": ev_type,
            "previous_purchases": int(prev_purch)
        }])

        score = float(pipeline.predict(input_df)[0])
        score = round(float(np.clip(score, 0.0, 100.0)), 1)
    else:
        score = 50.0
        if chk_start: score += 35.0
        if seat: score += 15.0

    if score >= 70.0:
        level = "HIGH_INTENT"
        action = "DISPATCH_SMS_REMINDER"
    elif score >= 40.0:
        level = "MODERATE"
        action = "MONITOR_SESSION"
    else:
        level = "CASUAL_BROWSER"
        action = "PASSIVE_RETENTION"

    return IntentPredictResponse(
        purchase_intent_score=score,
        intent_score=score,
        intent_level=level,
        suggested_action=action,
        prediction_source="synthetic-demo-model" if intent_pkg is not None else "rules",
        validated=False,
        notice=SYNTHETIC_NOTICE if intent_pkg is not None else RULES_NOTICE,
    )

# -----------------
# Endpoints: System & Health
# -----------------
@app.get("/")
def read_root():
    return {
        "service": "TicketLedger AI Analytics & Bot Defense Engine (Module 15)",
        "status": "online",
        "version": "2.2.0",
        "endpoints": {
            "intent_predict": "POST /intent/predict",
            "fraud_score": "POST /fraud/score",
            "demand_forecast": "POST /forecast/demand",
            "train_intent": "POST /train/intent",
            "train_fraud": "POST /train/fraud",
            "train_demand": "POST /train/demand",
            "model_metrics": "GET /models/metrics"
        },
        "models_loaded": {
            "fraud_detection": fraud_pkg is not None,
            "demand_forecasting": demand_pkg is not None,
            "purchase_intent": intent_pkg is not None,
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
            "fraud_model": fraud_pkg is not None,
            "demand_model": demand_pkg is not None,
            "intent_model": intent_pkg is not None,
        }
    }

@app.get("/models/metrics")
def get_model_metrics():
    if os.path.exists(METRICS_PATH):
        import json
        with open(METRICS_PATH, "r") as f:
            return json.load(f)
    return {"message": "Metrics not yet generated. Run scripts/evaluate_models.py."}

# -----------------
# Module 15 Endpoints: Inference
# -----------------
@app.post("/fraud/score", response_model=FraudScoreResponse, summary="Module 15: Score transaction fraud & bot risk")
def post_fraud_score(req: FraudScoreRequest):
    return execute_fraud_score(req)

@app.post("/predict/fraud", response_model=FraudScoreResponse, include_in_schema=False)
def post_predict_fraud_alias(req: FraudScoreRequest):
    return execute_fraud_score(req)

@app.post("/forecast/demand", response_model=DemandForecastResponse, summary="Module 15: Forecast event demand & sales")
def post_forecast_demand(req: DemandForecastRequest):
    return execute_demand_forecast(req)

@app.post("/predict/demand", response_model=DemandForecastResponse, include_in_schema=False)
def post_predict_demand_alias(req: DemandForecastRequest):
    return execute_demand_forecast(req)

@app.post("/intent/predict", response_model=IntentPredictResponse, summary="Module 15: Predict purchase intent score")
def post_intent_predict(req: IntentPredictRequest):
    return execute_intent_predict(req)

@app.post("/predict/intent", response_model=IntentPredictResponse, include_in_schema=False)
def post_predict_intent_alias(req: IntentPredictRequest):
    return execute_intent_predict(req)

# -----------------
# Module 15 Endpoints: On-Demand Training
# -----------------
@app.post("/train/intent", response_model=TrainingResponse, summary="Module 15: Retrain Purchase Intent Scoring Model")
def post_train_intent():
    if not ALLOW_SYNTHETIC:
        raise HTTPException(status_code=403, detail="Legacy synthetic training is disabled. Models are trained by the gated pipeline (python -m ml.train).")
    t0 = time.time()
    try:
        train_intent()
        load_models()
        elapsed = round(time.time() - t0, 2)
        metrics = intent_pkg.get("metrics", {}) if intent_pkg else {}
        return TrainingResponse(
            success=True,
            model_name="purchase_intent",
            message="Purchase Intent Model retrained and hot-reloaded into FastAPI memory successfully.",
            metrics=metrics,
            duration_seconds=elapsed,
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrain purchase intent model: {str(e)}")

@app.post("/train/fraud", response_model=TrainingResponse, summary="Module 15: Retrain Fraud Detection & Anti-Scalping Model")
def post_train_fraud():
    if not ALLOW_SYNTHETIC:
        raise HTTPException(status_code=403, detail="Legacy synthetic training is disabled. Models are trained by the gated pipeline (python -m ml.train).")
    t0 = time.time()
    try:
        train_fraud()
        load_models()
        elapsed = round(time.time() - t0, 2)
        metrics = fraud_pkg.get("metrics", {}) if fraud_pkg else {}
        return TrainingResponse(
            success=True,
            model_name="fraud_detection",
            message="Fraud Detection & Bot Defense Model retrained and hot-reloaded into FastAPI memory successfully.",
            metrics=metrics,
            duration_seconds=elapsed,
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrain fraud detection model: {str(e)}")

@app.post("/train/demand", response_model=TrainingResponse, summary="Module 15: Retrain Event Demand Forecasting Model")
def post_train_demand():
    if not ALLOW_SYNTHETIC:
        raise HTTPException(status_code=403, detail="Legacy synthetic training is disabled. Models are trained by the gated pipeline (python -m ml.train).")
    t0 = time.time()
    try:
        train_demand()
        load_models()
        elapsed = round(time.time() - t0, 2)
        metrics = demand_pkg.get("metrics", {}) if demand_pkg else {}
        return TrainingResponse(
            success=True,
            model_name="demand_forecasting",
            message="Event Demand Forecasting Model retrained and hot-reloaded into FastAPI memory successfully.",
            metrics=metrics,
            duration_seconds=elapsed,
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrain demand forecasting model: {str(e)}")

# -----------------
# v2: shadow scoring with gated-pipeline artifacts (never serves decisions)
# -----------------
ARTIFACT_DIR = os.environ.get("ML_ARTIFACT_DIR", os.path.join(BASE_DIR, "models", "v0"))
MAX_SHADOW_ROWS = 1000
_artifact_cache = {}
_artifact_lock = threading.Lock()


def _registry():
    path = os.path.join(ARTIFACT_DIR, "registry.json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return {m["name"]: m for m in json.load(f)["models"]}


def _file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_artifact(name, sha256):
    """Loads a registered artifact only if its file matches the fingerprint the API asked for and was
    built with the same scikit-learn version as this service (otherwise it might load but behave
    differently). Raises HTTPException with the reason."""
    key = (name, sha256)
    with _artifact_lock:
        if key in _artifact_cache:
            return _artifact_cache[key]
        entry = _registry().get(name)
        if not entry:
            raise HTTPException(status_code=404, detail=f"model '{name}' is not registered")
        if entry["sha256"] != sha256:
            raise HTTPException(status_code=409, detail=f"model '{name}' fingerprint mismatch: registry has {entry['sha256'][:12]}")
        path = os.path.join(ARTIFACT_DIR, entry["file"])
        if not os.path.exists(path) or _file_sha256(path) != sha256:
            raise HTTPException(status_code=409, detail=f"model '{name}' file is missing or does not match its fingerprint")
        artifact = joblib.load(path)
        built = artifact["versions"]["sklearn"].split(".")[:2]
        if built != sklearn.__version__.split(".")[:2]:
            raise HTTPException(status_code=409, detail=f"model '{name}' was built with scikit-learn {artifact['versions']['sklearn']}, service runs {sklearn.__version__}")
        _artifact_cache[key] = artifact
        return artifact


class ShadowRequest(BaseModel):
    sha256: str = Field(..., min_length=64, max_length=64)
    rows: List[Dict[str, Any]]


@app.get("/v2/models")
def list_shadow_models():
    return {"artifact_dir": ARTIFACT_DIR, "sklearn": sklearn.__version__,
            "models": [{k: v for k, v in m.items() if k != "evaluation"} for m in _registry().values()]}


@app.post("/v2/shadow/{name}")
def shadow_predict(name: str, req: ShadowRequest):
    if name not in ALL_SPECS:   # v0 models and the Step 5 ones (checkout_abandonment, demand_hourly)
        raise HTTPException(status_code=404, detail=f"unknown model '{name}'")
    if not req.rows or len(req.rows) > MAX_SHADOW_ROWS:
        raise HTTPException(status_code=422, detail=f"send 1 to {MAX_SHADOW_ROWS} rows")
    spec = ALL_SPECS[name]
    artifact = _load_artifact(name, req.sha256)
    needed = list(artifact["features"]["categorical"]) + list(artifact["features"]["numeric"])
    if name == "demand":
        needed = sorted(set(needed) | {"venue_capacity"})
    missing = sorted({c for r in req.rows for c in needed if c not in r})
    if missing:
        raise HTTPException(status_code=422, detail=f"rows are missing features: {missing}")
    df = pd.DataFrame(req.rows)
    for c in artifact["features"]["numeric"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    nullable = NULLABLE_FEATURES.get(name, set())
    bad = [c for c in artifact["features"]["numeric"] if c not in nullable and df[c].isna().any()]
    if bad:
        raise HTTPException(status_code=422, detail=f"non-numeric or empty values in: {bad}")
    out = ml_predict(artifact["model"], df, spec)
    th = artifact.get("thresholds", {})
    preds = []
    for i, v in enumerate(out):
        v = float(v)
        if spec.kind == "binary":
            item = {"probability": round(v, 6)}
            if name == "fraud":
                item["would_flag"] = bool(v >= th["threshold"])
        elif name == "demand":
            cap = float(df["venue_capacity"].iloc[i])
            q = th["conformal_q"]
            share = v / cap if cap > 0 else 0.0
            item = {"sales_48h": round(v, 1), "low": round(max(0.0, share - q) * cap, 1), "high": round(min(1.0, share + q) * cap, 1)}
        elif name == "demand_hourly":
            item = {"sales_next_24h": round(v, 1)}
        else:
            item = {"scans": round(v, 2)}
        preds.append(item)
    return {"model": name, "sha256": req.sha256, "role": "SHADOW", "may_serve_decisions": False, "predictions": preds}


# -----------------
# v2: health and metrics for the API's AI monitor (Step 6). No predictions, no decisions.
# -----------------
_metrics_lock = threading.Lock()
_metrics = {"started_at": datetime.utcnow().isoformat() + "Z", "routes": {}}
_fingerprint_cache = {}  # path -> (mtime, size, sha256)


def _route_key(path):
    if path.startswith("/v2/shadow/"):
        return "/v2/shadow/" + path.rsplit("/", 1)[-1]
    if path in ("/fraud/score", "/predict/fraud", "/forecast/demand", "/predict/demand", "/intent/predict", "/predict/intent"):
        return path
    return None


@app.middleware("http")
async def count_requests(request: Request, call_next):
    key = _route_key(request.url.path)
    if key is None:
        return await call_next(request)
    t0 = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        ms = (time.perf_counter() - t0) * 1000.0
        with _metrics_lock:
            m = _metrics["routes"].setdefault(key, {"requests": 0, "status_2xx": 0, "status_4xx": 0, "status_5xx": 0, "latencies_ms": []})
            m["requests"] += 1
            m["status_2xx" if status < 400 else "status_4xx" if status < 500 else "status_5xx"] += 1
            m["latencies_ms"].append(round(ms, 2))
            if len(m["latencies_ms"]) > 1000:
                del m["latencies_ms"][:-1000]   # keep the last 1000 for percentiles


def _percentile(xs, q):
    if not xs:
        return None
    ys = sorted(xs)
    return ys[min(len(ys) - 1, int(round(q * (len(ys) - 1))))]


def _fingerprint(path):
    st = os.stat(path)
    hit = _fingerprint_cache.get(path)
    if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
        return hit[2]
    digest = _file_sha256(path)
    _fingerprint_cache[path] = (st.st_mtime, st.st_size, digest)
    return digest


@app.get("/v2/health")
def v2_health():
    """Registry and artifact checks for each shadow model: file present, fingerprint matches, scikit-learn
    major.minor matches. Every model is shadow-only (may_serve_decisions false)."""
    models = []
    for name, entry in _registry().items():
        path = os.path.join(ARTIFACT_DIR, entry["file"])
        problem = None
        if not os.path.exists(path):
            problem = "artifact file missing"
        elif _fingerprint(path) != entry["sha256"]:
            problem = "artifact fingerprint does not match registry"
        elif str(entry.get("sklearn", "")).split(".")[:2] != sklearn.__version__.split(".")[:2]:
            problem = f"built with scikit-learn {entry.get('sklearn')}, service runs {sklearn.__version__}"
        models.append({
            "name": name, "version": entry.get("version"), "sha256": entry["sha256"], "source": entry.get("source"),
            "evaluation_status": entry.get("evaluation_status"), "fingerprint_ok": problem is None, "problem": problem,
            "may_serve_decisions": False,
        })
    return {"status": "ok", "ml_env": ML_ENV, "sklearn": sklearn.__version__, "artifact_dir_set": bool(os.environ.get("ML_ARTIFACT_DIR")),
            "legacy_synthetic_models_loaded": any(p is not None for p in (fraud_pkg, demand_pkg, intent_pkg)),
            "models": models, "may_serve_decisions": False}


@app.get("/v2/metrics")
def v2_metrics():
    """In-memory request counters since the service started (shadow and legacy scoring routes)."""
    with _metrics_lock:
        routes = {k: {"requests": v["requests"], "status_2xx": v["status_2xx"], "status_4xx": v["status_4xx"], "status_5xx": v["status_5xx"],
                      "p50_ms": _percentile(v["latencies_ms"], 0.5), "p95_ms": _percentile(v["latencies_ms"], 0.95)}
                  for k, v in _metrics["routes"].items()}
        return {"started_at": _metrics["started_at"], "routes": routes}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)

