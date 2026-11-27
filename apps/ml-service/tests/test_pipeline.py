"""
Tests for the training pipeline. A small synthetic dataset (5% scale) is generated once per run.

    .venv/Scripts/python -m pytest tests -q
"""

import json
import os
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from ml import baselines, evaluate as ev, metrics  # noqa: E402
from ml.models import CategoryDropout, build, feature_frame, predict, target  # noqa: E402
from ml.schema import SPECS  # noqa: E402
from ml.splits import LeakageError, assert_no_leakage, time_split  # noqa: E402


@pytest.fixture(scope="session")
def data_dir(tmp_path_factory):
    out = tmp_path_factory.mktemp("data")
    subprocess.run([sys.executable, os.path.join(BASE, "scripts", "generate_synthetic_data.py"),
                    "--scale", "0.05", "--out", str(out)], check=True, capture_output=True)
    return str(out)


@pytest.fixture(scope="session")
def manifest(data_dir):
    with open(os.path.join(data_dir, "manifest.json")) as f:
        return json.load(f)


# ---------------------------------------------------------------- metrics
def test_top_share_counts_ties_fairly():
    y = np.array([1, 0, 0, 0, 1, 0, 0, 0, 0, 0] * 10)
    assert metrics.top_share(y, np.ones(len(y)), 0.10) == pytest.approx(y.mean())   # all tied -> base rate
    assert metrics.top_share(y, y.astype(float), 0.10) == 1.0                     # perfect ranking


def test_calibration_error():
    rng = np.random.default_rng(0)
    p = rng.random(20000)
    y = (rng.random(20000) < p).astype(int)
    assert metrics.ece(y, p) < 0.02                       # calibrated
    assert metrics.ece(y, np.clip(p + 0.3, 0, 1)) > 0.2   # 30 points too high


def test_wape_and_coverage():
    assert metrics.wape([10, 0, 10], [12, 1, 8]) == pytest.approx(5 / 20)
    assert metrics.coverage([5, 10, 20], [0, 0, 0], [6, 9, 30]) == pytest.approx(2 / 3)


# ---------------------------------------------------------------- splits and leakage
@pytest.mark.parametrize("name", list(SPECS))
def test_splits_are_time_ordered_and_leak_free(name, data_dir):
    spec = SPECS[name]
    df = ev.load(spec, data_dir)
    s = time_split(df, spec)
    assert assert_no_leakage(df, s, spec)
    assert df["ts"].iloc[s.train].max() < df["ts"].iloc[s.test].min()
    trained = set(df[spec.holdout_group].iloc[np.concatenate([s.train, s.val])])
    assert not (trained & s.holdout_groups)


def test_leakage_is_detected(data_dir):
    spec = SPECS["intent"]
    df = ev.load(spec, data_dir)
    s = time_split(df, spec)
    # a test row also in training
    bad = time_split(df, spec)
    bad.train = np.append(bad.train, bad.test[0])
    with pytest.raises(LeakageError):
        assert_no_leakage(df, bad, spec)
    # a training row whose 7-day label reaches into validation (not purged)
    bad = time_split(df, spec)
    late = np.flatnonzero((df["ts"] < s.val_start) & (df["ts"] + pd.Timedelta(days=7) > s.val_start))
    bad.train = np.union1d(bad.train, late[:1])
    with pytest.raises(LeakageError):
        assert_no_leakage(df, bad, spec)
    # a held-out customer trained on
    bad = time_split(df, spec)
    held = df.index[df["customer_id"].isin(bad.holdout_groups) & (df["ts"] < s.val_start)].to_numpy()
    bad.train = np.union1d(bad.train, held[:1])
    with pytest.raises(LeakageError):
        assert_no_leakage(df, bad, spec)


def test_grouped_rows_never_split(data_dir):
    spec = SPECS["crowd"]
    df = ev.load(spec, data_dir)
    s = time_split(df, spec)
    parts = [set(df["event_id"].iloc[i]) for i in (s.train, s.val, s.test)]
    assert not (parts[0] & parts[1]) and not (parts[0] & parts[2]) and not (parts[1] & parts[2])


# ---------------------------------------------------------------- baselines are "as of"
def test_demand_baseline_never_uses_the_future(data_dir):
    spec = SPECS["demand"]
    df = ev.load(spec, data_dir)
    before, _, _ = baselines.demand_baseline(df)
    changed = df.copy()
    later = changed["ts"] > changed["ts"].quantile(0.5)
    changed.loc[later, "sales_48h"] = 0                # rewrite the future
    after, _, _ = baselines.demand_baseline(changed)
    early = (df["ts"] + pd.Timedelta(days=2) <= df["ts"].quantile(0.5)).to_numpy()
    np.testing.assert_allclose(before[early], after[early])


def test_crowd_baseline_feature_is_as_of(data_dir):
    spec = SPECS["crowd"]
    df = ev.load(spec, data_dir)
    first_event = df.sort_values("ts").iloc[0]["event_id"]
    rows = df[df["event_id"] == first_event]
    # no history yet: flat default curve x default show rate
    expected = rows["tickets_sold"] * 0.85 * (1.0 / df["minutes_from_start"].nunique()) * rows["gate_capacity_share"]
    np.testing.assert_allclose(rows["baseline_scans"], expected)


# ---------------------------------------------------------------- models
def test_category_dropout_only_while_fitting():
    X = pd.DataFrame({"event_type": ["A"] * 1000})
    d = CategoryDropout(columns=("event_type",), rate=0.1)
    assert d.transform(X).equals(X)
    assert d.fit_transform(X)["event_type"].isna().mean() == pytest.approx(0.1, abs=0.03)


def test_unknown_categories_predict_without_guessing(data_dir):
    spec = SPECS["intent"]
    df = ev.load(spec, data_dir)
    model = build(spec).fit(feature_frame(df, spec), target(df, spec))
    new = df.head(50).copy()
    new["event_type"], new["city"], new["country"] = "FOOD_FESTIVAL", "Dubai", "AE"
    p = predict(model, new, spec)
    assert np.isfinite(p).all() and ((p >= 0) & (p <= 1)).all()


# ---------------------------------------------------------------- gates
def test_a_useless_model_is_rejected(data_dir, manifest, monkeypatch):
    spec = SPECS["demand"]
    rng = np.random.default_rng(0)
    real_predict = ev.predict

    def noise(model, df, s):                       # predictions unrelated to the data
        return real_predict(model, df, s) * 0 + rng.uniform(0, 1, len(df)) * df["venue_capacity"].to_numpy()
    monkeypatch.setattr(ev, "predict", noise)
    report, artifact = ev.evaluate(spec, data_dir, manifest)
    assert report["status"] in ("REJECTED", "NOT_ENOUGH_DATA")
    assert artifact is None
    if report["status"] == "REJECTED":
        assert any("not clearly better" in r for r in report["reasons"])


def test_too_little_data_is_not_judged(tmp_path, manifest, data_dir):
    spec = SPECS["fraud"]
    df = pd.read_csv(os.path.join(data_dir, "fraud_purchases.csv"))
    df.head(800).to_csv(tmp_path / "fraud_purchases.csv", index=False)
    report, artifact = ev.evaluate(spec, str(tmp_path), manifest)
    assert report["status"] == "NOT_ENOUGH_DATA" and artifact is None


def test_final_artifact_is_complete_and_uses_all_rows(data_dir, manifest):
    from ml.models import COMPLEXITY
    spec = SPECS["intent"]
    df = ev.load(spec, data_dir)
    report = {"status": "PASSED", "result": {}, "data": {"sha256": "abc"}}
    artifact = ev._final_artifact(spec, df, {"complexity": COMPLEXITY[-1]}, report, manifest, seed=0)
    for key in ("model", "features", "thresholds", "versions", "data_source", "data_sha256", "complexity", "trained_rows"):
        assert key in artifact
    assert artifact["data_source"] == "synthetic-v0"
    assert artifact["trained_rows"] == len(df)                     # final model uses all rows
    p = artifact["model"].predict_proba(feature_frame(df.head(20), spec))[:, 1]
    assert ((p >= 0) & (p <= 1)).all()


def test_attendance_baseline_never_uses_the_future(data_dir):
    df = ev.load(SPECS["attendance"], data_dir)
    before = baselines.attendance_show_rate(df, min_tickets=50)
    cut = df["ts"].quantile(0.5)
    changed = df.copy()
    changed.loc[changed["ts"] > cut, "checked_in"] = 0
    after = baselines.attendance_show_rate(changed, min_tickets=50)
    early = (df["ts"] <= cut).to_numpy()
    np.testing.assert_allclose(before[early], after[early])


def test_crowd_baseline_never_uses_the_future(data_dir):
    raw = pd.read_csv(os.path.join(data_dir, "crowd_flow.csv"))
    raw["ts"] = pd.to_datetime(raw["ts"], utc=True)
    before = baselines.crowd_features_and_baseline(raw)
    cut = raw["ts"].quantile(0.5)
    changed = raw.copy()
    changed.loc[changed["ts"] > cut, "scans"] = 0
    after = baselines.crowd_features_and_baseline(changed)
    early = (raw.groupby("event_id")["ts"].transform("max") + pd.Timedelta(days=1) <= cut).to_numpy()
    np.testing.assert_allclose(before["baseline_scans"].to_numpy()[early], after["baseline_scans"].to_numpy()[early])


def test_synthetic_data_refused_without_flag(data_dir, tmp_path):
    from ml import train
    code = train.main(["--data", data_dir, "--reports", str(tmp_path / "r"), "--artifacts", str(tmp_path / "a")])
    assert code == 2
    assert not (tmp_path / "a").exists()


def test_invalid_data_refused(data_dir, tmp_path):
    import shutil
    from ml import train
    bad = tmp_path / "bad"
    shutil.copytree(data_dir, bad)
    df = pd.read_csv(bad / "event_demand.csv")
    df.loc[0, "sales_48h"] = df.loc[0, "venue_capacity"] + 1          # impossible: more sold than seats
    df.to_csv(bad / "event_demand.csv", index=False)
    code = train.main(["--data", str(bad), "--allow-synthetic", "--reports", str(tmp_path / "r"),
                       "--artifacts", str(tmp_path / "a")])
    assert code == 1
    assert not (tmp_path / "a").exists()
