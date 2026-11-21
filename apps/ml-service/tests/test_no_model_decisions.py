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
