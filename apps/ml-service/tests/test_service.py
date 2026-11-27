"""
ML service tests (FastAPI TestClient). Needs the v0 artifacts: run `python -m ml.train --allow-synthetic`
first (the tests skip otherwise).
"""

import importlib
import json
import os
import sys

import pandas as pd
import pytest

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
REGISTRY = os.path.join(BASE, "models", "v0", "registry.json")
TOKEN = "test-token-123"


def _client(monkeypatch, token=TOKEN, env="production", synthetic=None):
    from fastapi.testclient import TestClient
    monkeypatch.setenv("ML_SERVICE_TOKEN", token)
    monkeypatch.setenv("ML_ENV", env)
    if synthetic is None:
        monkeypatch.delenv("ML_ALLOW_SYNTHETIC", raising=False)
    else:
        monkeypatch.setenv("ML_ALLOW_SYNTHETIC", synthetic)
    import main
    importlib.reload(main)
    return TestClient(main.app), main


@pytest.fixture
def registry():
    if not os.path.exists(REGISTRY):
        pytest.skip("no v0 artifacts: run python -m ml.train --allow-synthetic")
    with open(REGISTRY) as f:
        return {m["name"]: m for m in json.load(f)["models"]}


H = {"X-ML-Token": TOKEN}


def test_health_is_open_everything_else_needs_the_token(monkeypatch):
    c, _ = _client(monkeypatch)
    assert c.get("/health").status_code == 200
    assert c.get("/v2/models").status_code == 401
    assert c.get("/v2/models", headers={"X-ML-Token": "wrong"}).status_code == 401
    assert c.get("/v2/models", headers=H).status_code == 200


def test_production_without_token_refuses(monkeypatch):
    c, _ = _client(monkeypatch, token="")
    assert c.get("/v2/models").status_code == 503
    assert c.get("/health").status_code == 200


def test_no_browser_cors(monkeypatch):
    c, _ = _client(monkeypatch)
    r = c.options("/v2/models", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_legacy_synthetic_training_disabled(monkeypatch):
    c, main = _client(monkeypatch)
    for m in ("intent", "fraud", "demand"):
        assert c.post(f"/train/{m}", headers=H).status_code == 403
    assert main.fraud_pkg is None and main.demand_pkg is None and main.intent_pkg is None


def test_legacy_endpoints_answer_with_rules(monkeypatch):
    c, _ = _client(monkeypatch)
    r = c.post("/fraud/score", headers=H, json={"checkout_duration_seconds": 1.0, "clicks_per_minute": 300,
                                                "rapid_seat_attempts": 8})
    assert r.status_code == 200 and r.json()["risk_level"] == "CRITICAL_BOT"   # the rule, as before
    r = c.post("/forecast/demand", headers=H, json={"venue_capacity": 10000})
    assert r.json()["projected_48h_sales"] == 7800                             # the 78% rule


def _rows(name, n=5):
    from ml import evaluate as ev
    from ml.schema import ALL_SPECS
    spec = ALL_SPECS[name]
    df = ev.load(spec, os.path.join(BASE, "data")).tail(n)
    cols = list(spec.cat) + list(spec.num) + (["venue_capacity"] if name == "demand" else [])
    return json.loads(df[sorted(set(cols))].to_json(orient="records"))


@pytest.mark.parametrize("name", ["intent", "abandonment", "checkout_abandonment", "fraud", "demand", "demand_hourly", "attendance", "crowd"])
def test_shadow_predictions(monkeypatch, registry, name):
    c, _ = _client(monkeypatch)
    r = c.post(f"/v2/shadow/{name}", headers=H, json={"sha256": registry[name]["sha256"], "rows": _rows(name)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "SHADOW" and body["may_serve_decisions"] is False
    p = body["predictions"]
    assert len(p) == 5
    if name in ("intent", "abandonment", "checkout_abandonment", "fraud", "attendance"):
        assert all(0 <= x["probability"] <= 1 for x in p)
    if name == "demand_hourly":
        assert all(x["sales_next_24h"] >= 0 for x in p)
    if name == "fraud":
        assert all(isinstance(x["would_flag"], bool) for x in p)
    if name == "demand":
        assert all(x["low"] <= x["sales_48h"] <= x["high"] for x in p)


def test_wrong_fingerprint_refused(monkeypatch, registry):
    c, _ = _client(monkeypatch)
    r = c.post("/v2/shadow/fraud", headers=H, json={"sha256": "0" * 64, "rows": _rows("fraud")})
    assert r.status_code == 409


def test_missing_or_bad_features_refused(monkeypatch, registry):
    c, _ = _client(monkeypatch)
    rows = _rows("fraud")
    for row in rows:
        row.pop("account_age_days")
    r = c.post("/v2/shadow/fraud", headers=H, json={"sha256": registry["fraud"]["sha256"], "rows": rows})
    assert r.status_code == 422 and "account_age_days" in r.text
    rows = _rows("fraud")
    rows[0]["clicks_per_minute"] = "fast"
    r = c.post("/v2/shadow/fraud", headers=H, json={"sha256": registry["fraud"]["sha256"], "rows": rows})
    assert r.status_code == 422


def test_unknown_event_type_and_city_still_scored(monkeypatch, registry):
    c, _ = _client(monkeypatch)
    rows = _rows("demand")
    for row in rows:
        row["event_type"], row["city"], row["country"] = "FOOD_FESTIVAL", "Dubai", "AE"
    r = c.post("/v2/shadow/demand", headers=H, json={"sha256": registry["demand"]["sha256"], "rows": rows})
    assert r.status_code == 200


def test_organizer_first_event_may_have_empty_history(monkeypatch, registry):
    c, _ = _client(monkeypatch)
    rows = _rows("demand")
    rows[0]["organizer_past_sell_through_48h"] = None
    rows[0]["organizer_past_events"] = 0
    r = c.post("/v2/shadow/demand", headers=H, json={"sha256": registry["demand"]["sha256"], "rows": rows})
    assert r.status_code == 200
    rows[1]["venue_capacity"] = None                      # but other inputs may not be empty
    r = c.post("/v2/shadow/demand", headers=H, json={"sha256": registry["demand"]["sha256"], "rows": rows})
    assert r.status_code == 422
