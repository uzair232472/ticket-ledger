"""
No model decides: /fraud/score (the endpoint the checkout block follows) answers with the rules even
when a trained model is loaded (e.g. the legacy synthetic model with ML_ALLOW_SYNTHETIC=1), and shadow
scoring always says it may not serve decisions.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402


class AlwaysFraud:
    """A model that would call every checkout fraud."""

    def predict_proba(self, X):
        return np.tile([0.0, 1.0], (len(X), 1))


def _score(**kw):
    return main.execute_fraud_score(main.FraudScoreRequest(**kw))


def test_fraud_score_ignores_a_loaded_model():
    saved = main.fraud_pkg
    try:
        main.fraud_pkg = {"pipeline": AlwaysFraud()}
        human = _score(checkout_duration_seconds=40, clicks_per_minute=20, rapid_seat_attempts=1)
        assert human.fraud_score == 10.0 and human.risk_level == "LOW" and human.action_recommended == "ALLOW"
        bot = _score(checkout_duration_seconds=1, clicks_per_minute=200, rapid_seat_attempts=6)
        assert bot.risk_level == "CRITICAL_BOT"
    finally:
        main.fraud_pkg = saved


def test_rule_thresholds_unchanged():
    # Same thresholds as before this change: speed < 3 s (+55), clicks > 150 (+25), seat attempts >= 5 (+20)
    assert _score(checkout_duration_seconds=2.9).fraud_score == 65.0
    assert _score(checkout_duration_seconds=3.0).fraud_score == 10.0
    assert _score(checkout_duration_seconds=10, clicks_per_minute=151).fraud_score == 35.0
    assert _score(checkout_duration_seconds=10, rapid_seat_attempts=5).fraud_score == 30.0
    assert _score(checkout_duration_seconds=1, clicks_per_minute=200, rapid_seat_attempts=9).fraud_score == 99.0
    assert _score(checkout_duration_seconds=2, clicks_per_minute=160).risk_level == "CRITICAL_BOT"
    assert _score(checkout_duration_seconds=2).risk_level == "SUSPICIOUS"


def _reload(monkeypatch, env, synthetic):
    import importlib
    monkeypatch.setenv("ML_ENV", env)
    if synthetic:
        monkeypatch.setenv("ML_ALLOW_SYNTHETIC", "1")
    else:
        monkeypatch.delenv("ML_ALLOW_SYNTHETIC", raising=False)
    return importlib.reload(main)


def test_synthetic_models_never_load_in_production(monkeypatch):
    m = _reload(monkeypatch, "production", True)
    try:
        assert m.ALLOW_SYNTHETIC is False
        assert m.demand_pkg is None and m.intent_pkg is None and m.fraud_pkg is None
        r = m.execute_demand_forecast(m.DemandForecastRequest(venue_capacity=1000, ticket_prices=2000))
        assert r.prediction_source == "rules" and r.validated is False and "Rule-based" in r.notice
    finally:
        _reload(monkeypatch, "development", False)


def test_synthetic_answers_are_labelled_in_development():
    """Whenever a synthetic model answers (development, ML_ALLOW_SYNTHETIC=1), the answer says so."""
    class Const:
        def __init__(self, v):
            self.v = v

        def predict(self, X):
            return np.array([self.v] * len(X))

    saved = (main.demand_pkg, main.intent_pkg, main.fraud_pkg)
    try:
        main.demand_pkg = {"sales_pipeline": Const(400.0), "level_pipeline": Const("HIGH")}
        main.intent_pkg = {"pipeline": Const(70.0)}
        main.fraud_pkg = {"pipeline": AlwaysFraud()}
        d = main.execute_demand_forecast(main.DemandForecastRequest(venue_capacity=1000, ticket_prices=2000))
        assert d.prediction_source == "synthetic-demo-model" and d.validated is False
        assert "synthetic data" in d.notice and "Not validated" in d.notice
        i = main.execute_intent_predict(main.IntentPredictRequest(event_views=3, seat_selection=1))
        assert i.prediction_source == "synthetic-demo-model" and i.validated is False
        f = _score(checkout_duration_seconds=40)
        assert f.prediction_source == "rules" and f.fraud_score == 10.0, "fraud stays on the rules even with models loaded"
    finally:
        main.demand_pkg, main.intent_pkg, main.fraud_pkg = saved


def test_nothing_is_ever_labelled_validated():
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "main.py"), encoding="utf-8").read()
    assert "validated=True" not in src and "validated: bool = True" not in src
