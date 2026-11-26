"""
Model-ops additions: reference profiles, per-prediction reasons, the model card / reference endpoints, the
diagnostics in the reports, the account-link inputs and the replay tool. Needs the v0 artifacts and reports
(python -m ml.train --allow-synthetic ...); the tests skip otherwise.
"""

import json
import os
import sys

import joblib
import numpy as np
import pandas as pd
import pytest

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
sys.path.insert(0, os.path.join(BASE, "tests"))

from ml.explain import reasons, reference_profile  # noqa: E402
from ml.schema import SPECS  # noqa: E402
from test_service import H, _client, registry  # noqa: E402,F401

V0 = os.path.join(BASE, "models", "v0")
REPORTS = os.path.join(BASE, "reports", "v0")
DATA = os.path.join(BASE, "data")
LINKS = ["linked_accounts", "linked_accounts_confirmed_fraud", "linked_orders_same_event_24h"]


def _artifact(name):
    path = os.path.join(V0, f"{name}.joblib")
    if not os.path.exists(path):
        pytest.skip("no v0 artifacts")
    return joblib.load(path)


def _rows(dataset, n=5):
    return pd.read_csv(os.path.join(DATA, f"{dataset}.csv"), nrows=2000).sample(n, random_state=1).reset_index(drop=True)


def test_reference_profile_shares_sum_to_one_and_typical_is_median():
    spec = SPECS["fraud"]
    df = pd.read_csv(os.path.join(DATA, "fraud_purchases.csv"), nrows=3000)
    ref = reference_profile(df, spec)
    for c in spec.num:
        assert abs(sum(ref["numeric"][c]["shares"]) - 1) < 1e-4
        assert ref["typical"][c] == pytest.approx(df[c].median(), abs=1e-3)
    for c in spec.cat:
        s = ref["categorical"][c]
        assert abs(sum(s["shares"].values()) + s["other_share"] - 1) < 1e-4


def test_every_artifact_carries_its_reference_profile():
    for name in ("intent", "fraud", "demand", "crowd", "attendance"):
        art = _artifact(name)
        ref = art["reference"]
        feats = set(art["features"]["categorical"]) | set(art["features"]["numeric"])
        assert set(ref["typical"]) == feats, name
        assert ref["rows"] == art["trained_rows"], name


def test_reasons_are_one_at_a_time_effects_of_the_real_model():
    art = _artifact("demand")
    spec = SPECS["demand"]
    rows = _rows("event_demand", 3)
    why = reasons(art["model"], rows, spec, art["reference"])
    assert len(why) == 3
    from ml.models import predict
    base = predict(art["model"], rows, spec)
    for i, items in enumerate(why):
        assert len(items) <= 3
        effects = [abs(r["effect"]) for r in items]
        assert effects == sorted(effects, reverse=True)
        for r in items:
            alt = rows.iloc[[i]].copy()
            if r["feature"] in spec.cat:
                alt[r["feature"]] = alt[r["feature"]].astype(object)
            alt[r["feature"]] = art["reference"]["typical"][r["feature"]]
            assert r["effect"] == pytest.approx(base[i] - predict(art["model"], alt, spec)[0], abs=0.02)
            assert r["direction"] == ("up" if r["effect"] > 0 else "down")


def test_shadow_explain_adds_reasons_only_when_asked(monkeypatch, registry):  # noqa: F811
    c, _ = _client(monkeypatch)
    rows = _rows("fraud_purchases", 2)
    feats = registry["fraud"]["features"]
    payload = [{k: (v.item() if hasattr(v, "item") else v) for k, v in r.items() if k in feats["categorical"] + feats["numeric"]} for r in rows.to_dict("records")]
    plain = c.post("/v2/shadow/fraud", headers=H, json={"sha256": registry["fraud"]["sha256"], "rows": payload}).json()
    assert all("reasons" not in p for p in plain["predictions"])
    rich = c.post("/v2/shadow/fraud", headers=H, json={"sha256": registry["fraud"]["sha256"], "rows": payload, "explain": True}).json()
    assert rich["may_serve_decisions"] is False
    assert [p["probability"] for p in rich["predictions"]] == [p["probability"] for p in plain["predictions"]]
    assert all(isinstance(p["reasons"], list) for p in rich["predictions"])


def test_reference_endpoint_checks_the_fingerprint(monkeypatch, registry):  # noqa: F811
    c, _ = _client(monkeypatch)
    ok = c.get(f"/v2/reference/crowd?sha256={registry['crowd']['sha256']}", headers=H)
    assert ok.status_code == 200 and "numeric" in ok.json()["reference"]
    assert c.get(f"/v2/reference/crowd?sha256={'0' * 64}", headers=H).status_code == 409
    assert c.get("/v2/reference/crowd?sha256=x", headers={}).status_code == 401


def test_model_card_and_metrics_come_from_the_gated_reports(monkeypatch, registry):  # noqa: F811
    c, _ = _client(monkeypatch)
    card = c.get("/v2/model-card/intent", headers=H).json()
    with open(os.path.join(REPORTS, "intent.json")) as f:
        rep = json.load(f)
    assert card["status"] == rep["status"] and card["result"] == rep["result"]
    assert card["may_serve_decisions"] is False
    assert card["registry_sha256"] == registry["intent"]["sha256"]
    d = card["diagnostics"]
    assert len(d["over_time"]) >= 3 and d["importance"]["features"] and len(d["calibration"]) == 10
    m = c.get("/models/metrics", headers=H).json()
    assert m["models"]["fraud"]["status"] == json.load(open(os.path.join(REPORTS, "fraud.json")))["status"]
    # The old near-perfect legacy file is gone and never served
    assert not os.path.exists(os.path.join(BASE, "models", "model_metrics.json"))
    assert all(v.get("accuracy") is None for v in m["models"].values())


def test_fraud_report_has_link_inputs_and_the_without_links_comparison():
    with open(os.path.join(REPORTS, "fraud.json")) as f:
        rep = json.load(f)
    assert all(c in rep["features"]["numeric"] for c in LINKS)
    w = rep["diagnostics"]["without_link_features"]
    assert {"precision", "recall", "false_flag_rate", "test_auc"} <= set(w)


def test_demand_registry_entry_carries_the_offline_range_coverage(registry):  # noqa: F811
    with open(os.path.join(REPORTS, "demand.json")) as f:
        rep = json.load(f)
    assert registry["demand"]["evaluation"]["range_coverage"] == rep["diagnostics"]["range"]["coverage"]


def test_link_inputs_in_the_data_are_as_of_and_consistent():
    df = pd.read_csv(os.path.join(DATA, "fraud_purchases.csv"))
    assert (df["linked_accounts_confirmed_fraud"] <= df["linked_accounts"]).all()
    assert list(df.columns)[-1] == "is_fraud"
    assert (df[LINKS] >= 0).all().all()
    # Links are noisy evidence, not a giveaway: many frauds have none, a few legitimate orders do
    fraud, legit = df[df["is_fraud"] == 1], df[df["is_fraud"] == 0]
    assert 0.2 < (fraud["linked_accounts"] == 0).mean() < 0.6
    assert 0.02 < (legit["linked_accounts"] > 0).mean() < 0.15


def test_replay_compares_two_files_on_rows_newer_than_both(tmp_path):
    from ml.replay import replay
    art = _artifact("intent")
    a = os.path.join(V0, "intent.joblib")
    res = replay("intent", a, a, DATA, resamples=20)
    # The v0 model was trained on every row, so nothing is newer than its training data: no comparison
    assert res["status"] == "NOT_ENOUGH_DATA" and res["promotes_anything"] is False
    # An "older" copy (trained-to moved back) leaves rows to compare; the same model against itself is a tie
    old = dict(art, trained_to=str(pd.Timestamp(art["trained_to"]) - pd.Timedelta(days=60)))
    p = tmp_path / "old.joblib"
    joblib.dump(old, p)
    res = replay("intent", str(p), str(p), DATA, resamples=20)
    assert res["status"] == "COMPARED" and res["b_minus_a_improvement"] == 0 and res["verdict"] == "no clear difference"
