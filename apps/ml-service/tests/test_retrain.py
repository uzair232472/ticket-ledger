"""
Retraining from database exports: weighted fraud metrics, export validation, the deployed-model comparison,
and the automatic retraining runner (trains only with enough data, never promotes or deploys).

The "export" fixtures here are built from the synthetic files and marked test_fixture: they exercise the
code paths only; auto_retrain refuses them without --allow-test-fixture.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from ml import baselines, metrics  # noqa: E402
from ml.evaluate import _deployed_comparison, evaluate, recommendation  # noqa: E402
from ml.models import WeightedCalibrated  # noqa: E402
from ml.schema import SPECS  # noqa: E402

SCHEMA_COLS = None


def _sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def _validator_schema():
    import importlib.util
    spec = importlib.util.spec_from_file_location("vd", os.path.join(BASE, "scripts", "validate_datasets.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SCHEMA


ID_COLS = ("session_id", "customer_id", "event_id", "order_id", "ticket_id", "organizer_id", "gate_id")


def _pseudo(col, series):
    return series.astype(str).map(lambda v: col[0].upper() + hashlib.sha256(f"fx:{col}:{v}".encode()).hexdigest()[:16])


def make_export(tmp, datasets=("event_demand", "fraud_purchases"), deployed=None, fraud_sample=True, pseudonymise=True):
    """Synthetic rows reshaped like a database export (ids pseudonymised, rows marked as snapshots, manifest
    marked test_fixture): chosen datasets kept, the others empty."""
    out = tmp / "export"
    out.mkdir()
    src = os.path.join(BASE, "data")
    schema = _validator_schema()
    man = json.load(open(os.path.join(src, "manifest.json")))
    files = {}
    ev = pd.read_csv(os.path.join(src, "event_demand.csv"))
    for name, cols in schema.items():
        df = pd.read_csv(os.path.join(src, f"{name}.csv")) if name in datasets else pd.DataFrame(columns=cols)
        if name == "fraud_purchases" and name in datasets and fraud_sample:
            # A review sample: every fraud + every rule-flagged order, 10% of the rest (weight 10)
            _, flag = baselines.fraud_rule(df)
            rng = np.random.default_rng(0)
            keep = (df["is_fraud"] == 1) | flag | (rng.random(len(df)) < 0.10)
            df = df[keep].copy()
            df["sample_weight"] = np.where((df["is_fraud"] == 1) | flag[keep.to_numpy()], 1.0, 10.0)
            df["rule_flag"] = flag[keep.to_numpy()].astype(int)
            df["rule_score"] = baselines.fraud_rule(df)[0]
        if pseudonymise:
            for c in ID_COLS:
                if c in df:
                    df[c] = _pseudo("event_id" if c == "event_id" else c, df[c]) if len(df) else df[c]
        df["feature_source"] = "snapshot"
        path = out / f"{name}.csv"
        df.to_csv(path, index=False)
        files[name] = {"file": f"{name}.csv", "rows": int(len(df)), "sha256": _sha(path)}
    eid = _pseudo("event_id", ev["event_id"]) if pseudonymise else ev["event_id"]
    pd.DataFrame({"event_id": eid, "sales_open": ev["ts"], "event_start": ev["event_start"]}).to_csv(out / "events.csv", index=False)
    man.update(source="db-export", test_fixture=True, contains_test_data=True, feature_sources=["snapshot"], files=files, deployed_models=deployed or {})
    json.dump(man, open(out / "manifest.json", "w"))
    return out


# ---------------------------------------------------------------------------------------------
def test_weighted_flag_stats_describe_all_orders():
    # 2 flagged frauds (weight 1), 1 flagged legit (weight 1), 10 sampled legit unflagged standing for 100
    y = np.array([1, 1, 0] + [0] * 10)
    f = np.array([1, 1, 1] + [0] * 10, dtype=bool)
    w = np.array([1, 1, 1] + [10] * 10, dtype=float)
    s = metrics.flag_stats(y, f, w)
    assert s["precision"] == pytest.approx(2 / 3)
    assert s["false_flag_rate"] == pytest.approx(1 / 101)        # unweighted would say 1/11
    assert metrics.flag_stats(y, f)["false_flag_rate"] == pytest.approx(1 / 11)
    assert metrics.weighted_quantile([1, 2, 3], 0.5, [1, 1, 10]) == 3


def test_weighted_calibrated_behaves_like_a_classifier():
    from sklearn.isotonic import IsotonicRegression

    class Est:
        def predict_proba(self, X):
            p = np.asarray(X, dtype=float).ravel()
            return np.column_stack([1 - p, p])

    cal = IsotonicRegression(out_of_bounds="clip").fit([0.1, 0.9], [0.0, 1.0])
    p = WeightedCalibrated(Est(), cal).predict_proba(np.array([[0.1], [0.9]]))
    assert p.shape == (2, 2) and np.allclose(p.sum(axis=1), 1)


def test_auto_retrain_refuses_synthetic_and_unmarked_fixtures(tmp_path):
    r = subprocess.run([sys.executable, "scripts/auto_retrain.py", "--data", os.path.join(BASE, "data"), "--reports", str(tmp_path / "r")],
                       cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 2 and "not a database export" in r.stdout
    exp = make_export(tmp_path, datasets=())
    r = subprocess.run([sys.executable, "scripts/auto_retrain.py", "--data", str(exp), "--reports", str(tmp_path / "r")],
                       cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 2 and "test fixture" in r.stdout


def test_empty_export_validates_and_trains_nothing(tmp_path):
    exp = make_export(tmp_path, datasets=())
    out, rep = tmp_path / "models", tmp_path / "reports"
    r = subprocess.run([sys.executable, "scripts/auto_retrain.py", "--data", str(exp), "--out", str(out), "--reports", str(rep), "--allow-test-fixture"],
                       cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "NOTHING_TO_TRAIN" in r.stdout
    assert not out.exists(), "no candidate folder when nothing is trained"
    s = json.load(open(next(rep.glob("*/retrain_summary.json"))))
    assert s["promoted"] is False and s["registered"] is False and s["deployed"] is False
    assert all(not m["sufficient"] and not m["trained"] for m in s["models"].values())


def test_export_validation_catches_integrity_problems(tmp_path):
    exp = make_export(tmp_path, datasets=("event_demand",))
    df = pd.read_csv(exp / "event_demand.csv")
    df.loc[0, "sales_48h"] = -5
    df.to_csv(exp / "event_demand.csv", index=False)
    man = json.load(open(exp / "manifest.json"))
    man["files"]["event_demand"]["sha256"] = _sha(exp / "event_demand.csv")
    json.dump(man, open(exp / "manifest.json", "w"))
    r = subprocess.run([sys.executable, "scripts/validate_datasets.py", "--data", str(exp), "--allow-test-fixture"], cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 1 and "sales_48h >= 0" in r.stdout


def test_real_exports_stay_separate_from_synthetic_and_test_data(tmp_path):
    # Raw synthetic ids (C000123, E00042 ...) in a "database export" fail validation
    exp = make_export(tmp_path, datasets=("event_demand",), pseudonymise=False)
    r = subprocess.run([sys.executable, "scripts/validate_datasets.py", "--data", str(exp), "--allow-test-fixture"], cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 1 and "ids are export pseudonyms" in r.stdout
    # A test fixture is refused without the explicit test flag, by the validator and by training
    (tmp_path / "b").mkdir()
    exp2 = make_export(tmp_path / "b", datasets=("event_demand",))
    r = subprocess.run([sys.executable, "scripts/validate_datasets.py", "--data", str(exp2)], cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 1 and "not a test fixture" in r.stdout
    r = subprocess.run([sys.executable, "-m", "ml.train", "--data", str(exp2), "--models", "demand"], cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 2 and "test fixture" in r.stdout
    # Real exports can never be mixed with --allow-synthetic
    r = subprocess.run([sys.executable, "-m", "ml.train", "--data", str(exp2), "--allow-synthetic", "--allow-test-fixture"], cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 2 and "cannot be combined" in r.stdout
    # Rows not from a prediction-time snapshot fail
    df = pd.read_csv(exp2 / "event_demand.csv")
    df["feature_source"] = "rebuilt"
    df.to_csv(exp2 / "event_demand.csv", index=False)
    man = json.load(open(exp2 / "manifest.json"))
    man["files"]["event_demand"]["sha256"] = _sha(exp2 / "event_demand.csv")
    json.dump(man, open(exp2 / "manifest.json", "w"))
    r = subprocess.run([sys.executable, "scripts/validate_datasets.py", "--data", str(exp2), "--allow-test-fixture"], cwd=BASE, capture_output=True, text=True)
    assert r.returncode == 1 and "prediction-time snapshot" in r.stdout


@pytest.mark.slow
def test_auto_retrain_trains_candidates_and_never_promotes(tmp_path):
    v0 = os.path.join(BASE, "models", "v0")
    before = {f: _sha(os.path.join(v0, f)) for f in os.listdir(v0)}
    deployed = {"demand": {"sha256": _sha(os.path.join(v0, "demand.joblib")), "source": "synthetic-v0"}}
    exp = make_export(tmp_path, datasets=("event_demand", "fraud_purchases"), deployed=deployed)
    out, rep = tmp_path / "models", tmp_path / "reports"
    r = subprocess.run([sys.executable, "scripts/auto_retrain.py", "--data", str(exp), "--out", str(out), "--reports", str(rep),
                        "--deployed", v0, "--allow-test-fixture"], cwd=BASE, capture_output=True, text=True, timeout=900)
    assert r.returncode == 0, r.stdout + r.stderr
    s = json.load(open(next(rep.glob("*/retrain_summary.json"))))
    assert s["status"] == "RAN" and s["promoted"] is False
    assert s["models"]["demand"]["trained"] and s["models"]["fraud"]["trained"]
    assert not s["models"]["intent"]["trained"], "no data, no training"
    fraud = json.load(open(next(rep.glob("*/fraud.json"))))
    assert fraud["details"]["sampling_weighted"] is True
    assert fraud["details"]["baseline_is_logged_rule_decision"] is True
    assert "shadow_decision" not in fraud, "the v0 keep-in-shadow decision never applies to real-data candidates"
    dem = json.load(open(next(rep.glob("*/demand.json"))))
    # The v0 demand model was trained on all of this data: no newer test rows to compare on
    assert dem["deployed_model"]["status"] == "NOT_ENOUGH_DATA"
    assert dem["recommendation"].startswith(("KEEP_CURRENT", "REVIEW", "PROMOTION_CANDIDATE"))
    assert {f: _sha(os.path.join(v0, f)) for f in os.listdir(v0)} == before, "deployed models untouched"
    reg = next(out.glob("*/registry.json"), None)
    if reg:
        for m in json.load(open(reg))["models"]:
            assert m["recommendation"] and m["source"] == "db-export"


@pytest.mark.slow
def test_deployed_comparison_uses_only_rows_newer_than_its_training(tmp_path):
    import joblib
    from ml.evaluate import _fit, _outputs, _prepare_context, load
    from ml.splits import time_split
    spec = SPECS["demand"]
    exp = make_export(tmp_path, datasets=("event_demand",))
    df = load(spec, str(exp))
    split = time_split(df, spec)
    model = _fit(spec, df, split.train)
    ctx = _prepare_context(spec, model, df, split)
    out = _outputs(spec, model, df, ctx)
    art = joblib.load(os.path.join(BASE, "models", "v0", "demand.joblib"))
    cut = df["ts"].iloc[split.test].quantile(0.25)
    art["trained_to"] = cut.isoformat()                    # code-path check: pretend it was trained up to here
    res = _deployed_comparison(spec, df, split, out, ctx, {"artifact": art, "sha256": "x" * 64, "file": "demand.joblib"})
    assert res["status"] in ("COMPARED", "NOT_ENOUGH_DATA")
    assert res["rows"] == int((df["ts"].iloc[split.test] > cut).sum())
    if res["status"] == "COMPARED":
        assert set(res) >= {"candidate", "deployed", "improvement_95ci"}
    bad = dict(art, features={"categorical": [], "numeric": ["x"]})
    assert _deployed_comparison(spec, df, split, out, ctx, {"artifact": bad, "sha256": "x" * 64})["status"] == "NOT_COMPARABLE"
    assert _deployed_comparison(spec, df, split, out, ctx, None)["status"] == "NO_DEPLOYED_MODEL"
    assert recommendation({"status": "REJECTED"}).startswith("KEEP_CURRENT")
    assert recommendation({"status": "PASSED", "data": {"source": "synthetic-v0"}}).startswith("KEEP_CURRENT")
    assert recommendation({"status": "PASSED", "data": {"source": "db-export"},
                           "deployed_model": {"status": "COMPARED", "candidate_clearly_better": False}}).startswith("KEEP_CURRENT")
    assert recommendation({"status": "PASSED", "data": {"source": "db-export"},
                           "deployed_model": {"status": "COMPARED", "candidate_clearly_better": True}}).startswith("PROMOTION_CANDIDATE")
