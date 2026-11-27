"""
Evaluates one model specification end to end:

  1. load the dataset, add as-of baseline columns
  2. time-based split + leakage assertions
  3. train on the oldest 70%; calibrate / pick thresholds on the next 15%; score the newest 15%
  4. compare with the baseline on the same test rows (main measure + bootstrap interval)
  5. must-not-get-worse guards, known vs unseen customers/events, segments, train-vs-test gap
  6. learning curve (10/25/50/100% of the training rows)
  7. decision: PASSED / REJECTED / NOT_ENOUGH_DATA
  8. if PASSED: refit on all rows with the same settings -> final artifact
  9. comparison with the currently deployed model on test rows it was not trained on (recommendation only:
     nothing is ever promoted or deployed automatically)

Fraud labels exported from the database come from a stratified review sample (every flagged order, a small
random share of the rest), so fraud rows carry `sample_weight` = 1 / inclusion probability and every fraud
fit, threshold and rate is weighted by it. The fraud baseline is then the decision the rules actually made
(`rule_flag`), not a re-computation.
"""

import os
import platform
import time

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.isotonic import IsotonicRegression

from . import baselines, metrics
from .gates import GATES
from .explain import LABELS, explanation_note, reasons, reference_profile
from .models import COMPLEXITY, WeightedCalibrated, build, feature_frame, predict, target
from .schema import ModelSpec
from .splits import assert_no_leakage, time_split

ARTIFACT_FORMAT = 1


# ---------------------------------------------------------------------------------------------
def weights(spec: ModelSpec, df: pd.DataFrame):
    """Sampling weights (fraud from a db export only; attendance's sample_weight means something else)."""
    if spec.name == "fraud" and "sample_weight" in df:
        return df["sample_weight"].to_numpy(dtype=float)
    return None


def _sub(w, idx):
    return None if w is None else w[idx]


def load(spec: ModelSpec, data_dir: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(data_dir, f"{spec.dataset}.csv"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    if spec.row_filter is not None:
        df = df[spec.row_filter(df)]
    df = df.sort_values(["ts"] + [c for c in ("session_id", "order_id", "ticket_id", "event_id", "gate_id") if c in df],
                        kind="stable").reset_index(drop=True)
    if spec.name == "crowd":
        df = baselines.crowd_features_and_baseline(df)
    return df


def baseline(spec: ModelSpec, df: pd.DataFrame) -> dict:
    if spec.name == "intent":
        return {"score": baselines.intent_rule(df)}
    if spec.name == "abandonment":
        return {"score": baselines.abandonment_rule(df)}
    if spec.name == "fraud":
        s, flag = baselines.fraud_rule(df)
        if "rule_flag" in df and len(df) and df["rule_flag"].notna().all():
            flag = df["rule_flag"].to_numpy() == 1          # what the app's rules actually decided
            if "rule_score" in df and df["rule_score"].notna().all():
                s = df["rule_score"].to_numpy(dtype=float)
        return {"score": s, "flag": flag}
    if spec.name == "demand":
        pred, lo, hi = baselines.demand_baseline(df)
        return {"pred": pred, "lo": lo, "hi": hi}
    if spec.name == "attendance":
        return {"rate": baselines.attendance_show_rate(df), "current_rule": baselines.attendance_current_rule(df)}
    if spec.name == "crowd":
        return {"pred": df["baseline_scans"].to_numpy(dtype=float)}
    if spec.name == "checkout_abandonment":
        return {"score": baselines.checkout_abandonment_rule(df)}
    if spec.name == "demand_hourly":
        return {"pred": baselines.demand_hourly_rule(df)}
    raise ValueError(spec.name)


# ---------------------------------------------------------------------------------------------
# Main measure per model, for the model and the baseline on a set of rows
# ---------------------------------------------------------------------------------------------
HIGHER_IS_BETTER = {"intent": True, "abandonment": True, "fraud": True, "demand": False, "attendance": False,
                    "crowd": False, "checkout_abandonment": True, "demand_hourly": False}
MAIN_NAME = {
    "intent": "share of actual buyers among the top 10% scored visitors",
    "abandonment": "share of actual abandons among the top 10% scored checkouts",
    "fraud": "share of flagged orders that are fraud (precision)",
    "demand": "weighted % error of 48-hour sales",
    "attendance": "average error in people attending per event",
    "crowd": "average error in scans per gate per 5 minutes",
    "checkout_abandonment": "share of actual abandons among the top 10% scored checkouts",
    "demand_hourly": "weighted % error of next-24-hour sales (zero sales handled)",
}


def _per_event_attendance(df, idx, p_show, rate):
    d = df.iloc[idx]
    w = d["sample_weight"].to_numpy(dtype=float)
    t = pd.DataFrame({"e": d["event_id"].to_numpy(), "pred": p_show * w, "act": d["checked_in"].to_numpy() * w,
                      "base": rate, "sold": d["event_tickets_sold"].to_numpy(dtype=float)})
    g = t.groupby("e").agg(pred=("pred", "sum"), act=("act", "sum"), base=("base", "first"), sold=("sold", "first"))
    return g["pred"].to_numpy(), g["base"].to_numpy() * g["sold"].to_numpy(), g["act"].to_numpy()


def main_measure(spec, df, idx, out, base, ctx):
    """Returns (model_value, baseline_value) of the main measure on rows idx."""
    y = df[spec.label].to_numpy()[idx]
    if spec.name in ("intent", "abandonment", "checkout_abandonment"):
        f = GATES["top_fraction"]
        return metrics.top_share(y, out["p"][idx], f), metrics.top_share(y, base["score"][idx], f)
    if spec.name == "demand_hourly":
        return metrics.wape_safe(y, out["pred"][idx])[0], metrics.wape_safe(y, base["pred"][idx])[0]
    if spec.name == "fraud":
        w = _sub(weights(spec, df), idx)
        m = metrics.flag_stats(y, out["p"][idx] >= ctx["threshold"], w)
        b = metrics.flag_stats(y, base["flag"][idx], w)
        return m["precision"], b["precision"]
    if spec.name == "demand":
        return metrics.wape(y, out["pred"][idx]), metrics.wape(y, base["pred"][idx])
    if spec.name == "attendance":
        pred, bpred, act = _per_event_attendance(df, idx, out["p"][idx], base["rate"][idx])
        return metrics.mae(act, pred), metrics.mae(act, bpred)
    if spec.name == "crowd":
        return metrics.mae(y, out["pred"][idx]), metrics.mae(y, base["pred"][idx])
    raise ValueError(spec.name)


def bootstrap_improvement(spec, df, idx, out, base, ctx, seed=0):
    """Resamples whole events in the test period. Improvement > 0 means the model is better."""
    rng = np.random.default_rng(seed)
    a = (1 - GATES["bootstrap_confidence"]) / 2
    if spec.name == "attendance":
        # The measure is per event: resample the per-event results (a repeated event counts twice)
        pred, bpred, act = _per_event_attendance(df, idx, out["p"][idx], base["rate"][idx])
        diffs = []
        for _ in range(GATES["bootstrap_resamples"]):
            k = rng.integers(0, len(act), len(act))
            diffs.append(metrics.mae(act[k], bpred[k]) - metrics.mae(act[k], pred[k]))
        return float(np.quantile(diffs, a)), float(np.quantile(diffs, 1 - a))
    events = df["event_id"].to_numpy()[idx]
    uniq, inv = np.unique(events, return_inverse=True)
    rows_of = [idx[inv == k] for k in range(len(uniq))]
    sign = 1.0 if HIGHER_IS_BETTER[spec.name] else -1.0
    diffs = []
    for _ in range(GATES["bootstrap_resamples"]):
        pick = rng.integers(0, len(uniq), len(uniq))
        sample = np.concatenate([rows_of[k] for k in pick])
        m, b = main_measure(spec, df, sample, out, base, ctx)
        diffs.append(sign * (m - b))
    return float(np.quantile(diffs, a)), float(np.quantile(diffs, 1 - a))


# ---------------------------------------------------------------------------------------------
def _fit(spec, df, idx, seed=0, complexity=None):
    model = build(spec, seed=seed, complexity=complexity)
    w = _sub(weights(spec, df), idx)
    kw = {} if w is None else {"model__sample_weight": w}
    model.fit(feature_frame(df.iloc[idx], spec), target(df.iloc[idx], spec), **kw)
    return model


def _select_complexity(spec, df, split, seed=0):
    """Picks the model complexity using the VALIDATION period only: the best validation score among
    levels that do not memorise (train-vs-validation gap within the gate limits); if none qualifies,
    the simplest level. The test period plays no part in this choice."""
    tr, va = split.train, split.val
    y_tr, y_va = df[spec.label].to_numpy()[tr], df[spec.label].to_numpy()[va]
    w = weights(spec, df)
    rows = []
    for c in COMPLEXITY:
        model = _fit(spec, df, tr, seed=seed, complexity=c)
        p_tr, p_va = predict(model, df.iloc[tr], spec), predict(model, df.iloc[va], spec)
        if spec.kind == "binary":
            a_va = metrics.auc(y_va, p_va, _sub(w, va))
            score, gap_value = a_va, metrics.auc(y_tr, p_tr, _sub(w, tr)) - a_va
            ok = gap_value <= GATES["max_auc_gap"]
        else:
            err = metrics.wape if spec.name == "demand" else (lambda a, b: metrics.wape_safe(a, b)[0]) if spec.name == "demand_hourly" else metrics.mae
            score = err(y_va, p_va)
            gap_value = err(y_tr, p_tr) / max(score, 1e-9)
            ok = gap_value >= GATES["min_error_ratio"]
        rows.append({"level": c["name"], "validation_score": round(float(score), 4),
                     "train_vs_validation": round(float(gap_value), 4), "not_memorising": bool(ok)})
    candidates = [k for k, r in enumerate(rows) if r["not_memorising"]]
    if candidates:
        pick = (max if spec.kind == "binary" else min)(candidates, key=lambda k: rows[k]["validation_score"])
    else:
        pick = len(COMPLEXITY) - 1
    return COMPLEXITY[pick], {"measure": "validation AUC" if spec.kind == "binary" else "validation error",
                              "levels": rows, "chosen": COMPLEXITY[pick]["name"]}


def _outputs(spec, model, df, ctx):
    """Model outputs for every row (calibrated where relevant)."""
    raw = predict(model, df, spec)
    if spec.kind == "binary":
        p = ctx["calibrator"].predict(raw) if ctx.get("calibrator") is not None else raw
        return {"raw": raw, "p": p}
    out = {"pred": raw}
    if spec.name == "crowd" and ctx.get("resid_q"):
        lo, hi, p_over = crowd_range(raw, df["gate_capacity_per_hour"].to_numpy(dtype=float) / 12.0, ctx["resid_q"], over_cal=ctx.get("over_cal"))
        out.update(lo=lo, hi=hi, p_over=p_over)
    if spec.name == "demand":
        cap = df["venue_capacity"].to_numpy(dtype=float)
        q = ctx["conformal_q"]
        share = raw / cap
        out["lo"] = np.clip(share - q, 0, 1) * cap
        out["hi"] = np.clip(share + q, 0, 1) * cap
    return out


def crowd_range(pred, capacity_per_slot, resid_q, level=0.80, over_cal=None):
    """80% range and P(scans > capacity in the slot) from the scaled validation residuals; `over_cal` (101 points
    on 0..1) maps the raw chance to the calibrated one."""
    q = np.asarray(resid_q, dtype=float)
    pred = np.asarray(pred, dtype=float)
    s = np.sqrt(pred + 1.0)
    a = (1 - level) / 2
    lo = np.maximum(0.0, pred + np.quantile(q, a) * s)
    hi = pred + np.quantile(q, 1 - a) * s
    p_over = ((pred[:, None] + q[None, :] * s[:, None]) > np.asarray(capacity_per_slot, dtype=float)[:, None]).mean(axis=1)
    if over_cal is not None:
        p_over = np.interp(p_over, np.linspace(0, 1, len(over_cal)), np.asarray(over_cal, dtype=float))
    return lo, hi, p_over


def _prepare_context(spec, model, df, split):
    """Everything fitted on the validation period: calibration, thresholds, range width."""
    ctx = {}
    v = split.val
    if spec.kind == "binary":
        raw_v = predict(model, df.iloc[v], spec)
        y_v = df[spec.label].to_numpy()[v]
        w_v = _sub(weights(spec, df), v)
        ctx["calibrator"] = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(raw_v, y_v, sample_weight=w_v)
        p_v = ctx["calibrator"].predict(raw_v)
        if spec.name == "fraud":
            # Highest flag volume that keeps false flags among legitimate orders within the limit
            legit = y_v == 0
            ctx["threshold"] = metrics.weighted_quantile(p_v[legit], 1 - GATES["max_false_flag_rate"],
                                                         None if w_v is None else w_v[legit]) + 1e-9
        if spec.name == "attendance":
            # Threshold that balances catching no-shows and shows (best balanced accuracy)
            grid = np.unique(np.quantile(p_v, np.linspace(0.01, 0.99, 99)))
            ba = [metrics.balanced_accuracy(y_v, p_v >= t) for t in grid]
            ctx["threshold"] = float(grid[int(np.argmax(ba))])
    if spec.name == "crowd":
        # Split-conformal on scaled residuals (count data: spread grows with the level), validation period only.
        # 99 quantiles give a range and the chance that a slot goes over the gate's capacity (crowd_overload).
        pred_v = predict(model, df.iloc[v], spec)
        r = (df["scans"].to_numpy(dtype=float)[v] - pred_v) / np.sqrt(pred_v + 1.0)
        ctx["resid_q"] = [float(x) for x in np.quantile(r, np.linspace(0.01, 0.99, 99))]
        # The raw chance pools all levels, so it is calibrated (isotonic) against what happened on the validation
        # period; stored as interpolation points so the ML service needs no extra object.
        cap_v = df["gate_capacity_per_hour"].to_numpy(dtype=float)[v] / 12.0
        _, _, raw_v = crowd_range(pred_v, cap_v, ctx["resid_q"])
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(raw_v, (df["scans"].to_numpy(dtype=float)[v] > cap_v).astype(float))
        grid = np.linspace(0, 1, 101)
        ctx["over_cal"] = [round(float(x), 6) for x in iso.predict(grid)]
    if spec.name == "demand":
        share_pred = predict(model, df.iloc[v], spec) / df["venue_capacity"].to_numpy(dtype=float)[v]
        share_act = df["sales_48h"].to_numpy(dtype=float)[v] / df["venue_capacity"].to_numpy(dtype=float)[v]
        resid = np.abs(share_act - share_pred)
        n = len(resid)
        level = min(1.0, np.ceil((n + 1) * 0.80) / n)          # split-conformal 80% interval
        ctx["conformal_q"] = float(np.quantile(resid, level))
    return ctx


# ---------------------------------------------------------------------------------------------
def _enough_data(spec, df, test):
    y = df[spec.label].to_numpy()[test]
    n_events = df["event_id"].iloc[test].nunique()
    if spec.name == "fraud":
        need = {"frauds": (int((y == 1).sum()), GATES["min_test_frauds"])}
    elif spec.kind == "binary":
        minority = int((y == 0).sum()) if spec.name == "attendance" else int((y == 1).sum())
        need = {"positives (rare outcome)": (minority, GATES["min_test_positives"]),
                "other outcome": (int(len(y) - minority), GATES["min_test_negatives"])}
        if spec.name == "attendance":
            need["events"] = (n_events, GATES["min_test_events_attendance"])
    elif spec.name == "demand":
        need = {"events": (n_events, GATES["min_test_events_demand"])}
    elif spec.name == "demand_hourly":
        need = {"events": (n_events, GATES["min_test_events_demand_hourly"])}
    else:
        need = {"events": (n_events, GATES["min_test_events_crowd"])}
    missing = {k: f"{have} < {req}" for k, (have, req) in need.items() if have < req}
    return missing, {k: have for k, (have, _) in need.items()}


def _guards(spec, df, split, out, base, ctx, train_out):
    """Must-not-get-worse checks. Returns list of dicts {name, value, limit, passed}."""
    g = []
    test, train = split.test, split.train
    y_t = df[spec.label].to_numpy()[test]
    w = weights(spec, df)

    def add(name, value, limit, passed):
        g.append({"name": name, "value": None if value is None else round(float(value), 4),
                  "limit": limit, "passed": bool(passed)})

    if spec.kind == "binary":
        y_tr = df[spec.label].to_numpy()[train]
        gap = metrics.auc(y_tr, train_out["raw"], _sub(w, train)) - metrics.auc(y_t, out["raw"][test], _sub(w, test))
        add("train AUC - test AUC (memorising)", gap, f"<= {GATES['max_auc_gap']}", gap <= GATES["max_auc_gap"])
        if spec.name != "fraud":
            e = metrics.ece(y_t, out["p"][test])
            add("calibration error (ECE)", e, f"<= {GATES['max_calibration_error']}", e <= GATES["max_calibration_error"])
    else:
        y_tr = df[spec.label].to_numpy()[train]
        err = metrics.wape if spec.name == "demand" else (lambda a, b: metrics.wape_safe(a, b)[0]) if spec.name == "demand_hourly" else metrics.mae
        ratio = err(y_tr, train_out["pred"]) / max(err(y_t, out["pred"][test]), 1e-9)
        add("train error / test error (memorising)", ratio, f">= {GATES['min_error_ratio']}", ratio >= GATES["min_error_ratio"])

    if spec.name in ("intent", "abandonment", "checkout_abandonment"):
        first = "first_time_customers" if spec.name == "checkout_abandonment" else "first_time_visitors"
        seg = spec.segments[first](df.iloc[test]).to_numpy()
        f = GATES["top_fraction"]
        m = metrics.top_share(y_t[seg], out["p"][test][seg], f)
        b = metrics.top_share(y_t[seg], base["score"][test][seg], f)
        add("first-time customers/visitors: top-10% share vs rule", m - b, ">= 0 (not worse)", m >= b)
    if spec.name == "fraud":
        m = metrics.flag_stats(y_t, out["p"][test] >= ctx["threshold"], _sub(w, test))
        b = metrics.flag_stats(y_t, base["flag"][test], _sub(w, test))
        add("false flags among legitimate orders", m["false_flag_rate"], f"<= {GATES['max_false_flag_rate']}",
            m["false_flag_rate"] <= GATES["max_false_flag_rate"])
        add("share of frauds caught vs rules", m["recall"] - b["recall"], ">= 0 (not worse)", m["recall"] >= b["recall"])
    if spec.name == "demand":
        cov = metrics.coverage(y_t, out["lo"][test], out["hi"][test])
        bcov = metrics.coverage(y_t, base["lo"][test], base["hi"][test])
        add("range holds the real number", cov, f">= {GATES['min_range_coverage']}", cov >= GATES["min_range_coverage"])
        add("range coverage vs baseline range", cov - bcov, f">= -{GATES['coverage_tolerance']}",
            cov >= bcov - GATES["coverage_tolerance"])
    if spec.name == "attendance":
        ba = metrics.balanced_accuracy(y_t, out["p"][test] >= ctx["threshold"])
        add("per-ticket balanced accuracy vs baseline (0.5)", ba, ">= 0.5 (not worse)", ba >= 0.5)
    if spec.name == "crowd":
        peak = y_t >= np.quantile(y_t, 0.80)
        m = metrics.mae(y_t[peak], out["pred"][test][peak])
        b = metrics.mae(y_t[peak], base["pred"][test][peak])
        add("peak-time error vs baseline", m - b, "<= 0 (not worse)", m <= b)
    return g


def _known_unseen(spec, df, split, out, base, ctx):
    res = {}
    test = split.test
    trained = np.concatenate([split.train, split.val])
    for col in spec.known_groups:
        seen = set(df[col].iloc[trained])
        is_known = df[col].iloc[test].isin(seen).to_numpy()
        for label, mask in (("known", is_known), ("unseen", ~is_known)):
            idx = test[mask]
            res[f"{col.replace('_id', '')}s_{label}"] = _segment_result(spec, df, idx, out, base, ctx)
    for name, fn in spec.segments.items():
        idx = test[fn(df.iloc[test]).to_numpy()]
        res[name] = _segment_result(spec, df, idx, out, base, ctx)
    return res


def _segment_result(spec, df, idx, out, base, ctx):
    if len(idx) == 0:
        return {"rows": 0}
    y = df[spec.label].to_numpy()[idx]
    if spec.kind == "binary" and (min((y == 1).sum(), (y == 0).sum()) < 30):
        return {"rows": int(len(idx)), "note": "too few cases to measure"}
    if spec.kind != "binary" and df["event_id"].iloc[idx].nunique() < 10:
        return {"rows": int(len(idx)), "note": "too few events to measure"}
    m, b = main_measure(spec, df, idx, out, base, ctx)
    return {"rows": int(len(idx)), "model": round(m, 4), "baseline": round(b, 4)}


def _learning_curve(spec, df, split, ctx_full, seed=0):
    rng = np.random.default_rng(seed)
    test = split.test
    y_t = df[spec.label].to_numpy()[test]
    w_t = _sub(weights(spec, df), test)
    curve = []
    for frac in (0.10, 0.25, 0.50, 1.00):
        n = max(50, int(len(split.train) * frac))
        idx = np.sort(rng.choice(split.train, size=min(n, len(split.train)), replace=False))
        model = _fit(spec, df, idx, seed=seed, complexity=ctx_full.get("complexity"))
        raw = predict(model, df.iloc[test], spec)
        if spec.kind == "binary":
            value, name = metrics.auc(y_t, raw, w_t), "test AUC (higher is better)"
        elif spec.name == "demand":
            value, name = metrics.wape(y_t, raw), "test weighted % error (lower is better)"
        elif spec.name == "demand_hourly":
            value, name = metrics.wape_safe(y_t, raw)[0], "test weighted % error (lower is better)"
        else:
            value, name = metrics.mae(y_t, raw), "test error (lower is better)"
        curve.append({"train_fraction": frac, "train_rows": int(len(idx)), "value": round(float(value), 4)})
    better = (lambda a, b: a > b) if spec.kind == "binary" else (lambda a, b: a < b)
    last, prev = curve[-1]["value"], curve[-2]["value"]
    gain = abs(last - prev) / max(abs(prev), 1e-9)
    return {"measure": name, "points": curve,
            "still_improving": bool(better(last, prev) and gain > 0.01),
            "note": ("more data would likely still help" if better(last, prev) and gain > 0.01
                     else "score has levelled off: more data of the same kind adds little")}


# ---------------------------------------------------------------------------------------------
# Diagnostics for the model card (AI monitor). All on the test period, after the decision inputs above were
# fixed: none of this changes the status, a threshold or a setting.
# ---------------------------------------------------------------------------------------------
LINK_FEATURES = ("linked_accounts", "linked_accounts_confirmed_fraud", "linked_orders_same_event_24h")
TIME_SLICES = 5
IMPORTANCE_ROWS = 4000


def _calibration(y, p, w=None, bins=10):
    order = np.argsort(p, kind="stable")
    out = []
    for chunk in np.array_split(order, bins):
        if not len(chunk):
            continue
        ww = None if w is None else w[chunk]
        out.append({"predicted": round(float(np.average(p[chunk], weights=ww)), 4),
                    "actual": round(float(np.average(y[chunk], weights=ww)), 4), "rows": int(len(chunk))})
    return out


def _over_time(spec, df, idx, out, base, ctx):
    """The main measure for the model and the rule in consecutive slices of the test period."""
    slices = []
    for chunk in np.array_split(idx, TIME_SLICES):
        if len(chunk) < 20:
            continue
        item = {"from": df["ts"].iloc[chunk[0]].isoformat(), "to": df["ts"].iloc[chunk[-1]].isoformat(), "rows": int(len(chunk))}
        try:
            m, b = main_measure(spec, df, chunk, out, base, ctx)
            item.update(model=None if not np.isfinite(m) else round(float(m), 4), rule=None if not np.isfinite(b) else round(float(b), 4))
        except Exception as e:                      # a slice with no flags / no positives: shown as a gap
            item.update(model=None, rule=None, note=str(e)[:80])
        if spec.name == "demand":
            y = df[spec.label].to_numpy()[chunk]
            item["range_coverage"] = round(metrics.coverage(y, out["lo"][chunk], out["hi"][chunk]), 4)
        slices.append(item)
    return slices


def _importance(spec, model, df, idx, seed=0):
    """Permutation importance on (a sample of) the test period: how much worse the model gets when one input
    is shuffled. Binary: AUC drop (raw scores); others: increase in average error."""
    rng = np.random.default_rng(seed)
    if len(idx) > IMPORTANCE_ROWS:
        idx = np.sort(rng.choice(idx, size=IMPORTANCE_ROWS, replace=False))
    d = df.iloc[idx].reset_index(drop=True)
    y = df[spec.label].to_numpy()[idx]
    score = (lambda p: metrics.auc(y, p)) if spec.kind == "binary" else (lambda p: -metrics.mae(y, p))
    ref = score(predict(model, d, spec))
    if not np.isfinite(ref):
        return {"measure": None, "features": []}
    res = []
    for c in list(spec.cat) + list(spec.num):
        drops = []
        for _ in range(2):
            s = d.copy()
            s[c] = s[c].to_numpy()[rng.permutation(len(s))]
            drops.append(ref - score(predict(model, s, spec)))
        res.append({"feature": c, "label": LABELS.get(c, c), "importance": round(float(np.mean(drops)), 5)})
    res.sort(key=lambda r: -r["importance"])
    return {"measure": "drop in test AUC when shuffled" if spec.kind == "binary" else "increase in average error when shuffled",
            "rows": int(len(idx)), "features": res}


def _examples(spec, model, df, split, out, ctx):
    """Two test rows with their reasons: the highest prediction and a middle one."""
    test = split.test
    key = out["p"] if spec.kind == "binary" else out["pred"]
    order = test[np.argsort(-key[test], kind="stable")]
    picks = [("highest prediction", order[0]), ("middle prediction", order[len(order) // 2])]
    ref = reference_profile(df.iloc[split.train], spec)
    cal = ctx.get("calibrator")
    transform = (lambda p, _d: cal.predict(p)) if cal is not None else None
    rows = df.iloc[[i for _, i in picks]]
    why = reasons(model, rows, spec, ref, transform=transform)
    return [{"which": label, "prediction": round(float(key[i]), 4), "actual": _plain(df[spec.label].iloc[i]), "reasons": r}
            for (label, i), r in zip(picks, why)]


def _plain(v):
    return v.item() if hasattr(v, "item") else v


def _without_links(spec, df, split, base, seed=0, complexity=None):
    """Fraud only: the same pipeline without the account-link inputs (what they add)."""
    from dataclasses import replace
    s2 = replace(spec, num=tuple(c for c in spec.num if c not in LINK_FEATURES))
    model = _fit(s2, df, split.train, seed=seed, complexity=complexity)
    ctx = _prepare_context(s2, model, df, split)
    out = _outputs(s2, model, df, ctx)
    y_t = df[spec.label].to_numpy()[split.test]
    w_t = _sub(weights(spec, df), split.test)
    m, b = main_measure(s2, df, split.test, out, base, ctx)
    flags = metrics.flag_stats(y_t, out["p"][split.test] >= ctx["threshold"], w_t)
    return {"precision": round(m, 4), "rule_precision": round(b, 4), "test_auc": round(metrics.auc(y_t, out["p"][split.test], w_t), 4),
            **{k: round(v, 4) for k, v in flags.items()}}


# Fairness: the same test rows split by group. Informational: it never changes the status (the gates were fixed
# before evaluation); it lists groups the model serves worse, for a person to look at before any go-live.
FAIR_GROUPS = ("city", "event_type", "payment_method")
FAIR_MIN = {"binary_each_class": 30, "events": 10, "legit_for_false_flags": 200}


def _fair_row(spec, df, idx, out, base, ctx, overall):
    y = df[spec.label].to_numpy()[idx]
    row = {"rows": int(len(idx))}
    if spec.name == "fraud":
        w = _sub(weights(spec, df), idx)
        legit = int((y == 0).sum())
        if legit < FAIR_MIN["legit_for_false_flags"]:
            return {**row, "note": "too few legitimate orders to measure"}
        m = metrics.flag_stats(y, out["p"][idx] >= ctx["threshold"], w)
        b = metrics.flag_stats(y, base["flag"][idx], w)
        row.update(false_flag_rate=round(m["false_flag_rate"], 4), rule_false_flag_rate=round(b["false_flag_rate"], 4), frauds=int((y == 1).sum()))
        if (y == 1).sum() >= FAIR_MIN["binary_each_class"]:
            row.update(recall=round(m["recall"], 4), rule_recall=round(b["recall"], 4))
        worse = m["false_flag_rate"] > max(GATES["max_false_flag_rate"], 2 * overall.get("false_flag_rate", 0))
        row["watch"] = bool(worse)
        row["why"] = "false flags over 1% and over twice the overall rate" if worse else None
        return row
    if spec.kind == "binary":
        if min((y == 1).sum(), (y == 0).sum()) < FAIR_MIN["binary_each_class"]:
            return {**row, "note": "too few cases to measure"}
        p = out["p"][idx]
        gap = float(p.mean() - y.mean())
        row.update(predicted_rate=round(float(p.mean()), 4), actual_rate=round(float(y.mean()), 4), gap=round(gap, 4),
                   auc=round(metrics.auc(y, p), 4))
        row["watch"] = bool(abs(gap) > GATES["max_calibration_error"])
        row["why"] = f"predicted rate off by more than {GATES['max_calibration_error']:.0%}" if row["watch"] else None
        return row
    if df["event_id"].iloc[idx].nunique() < FAIR_MIN["events"]:
        return {**row, "note": "too few events to measure"}
    m, b = main_measure(spec, df, idx, out, base, ctx)
    worse = (m > b) if not HIGHER_IS_BETTER[spec.name] else (m < b)
    row.update(model=round(m, 4), rule=round(b, 4), watch=bool(worse), why="worse than the rule in this group" if worse else None)
    return row


def _fairness(spec, df, split, out, base, ctx):
    test = split.test
    y = df[spec.label].to_numpy()[test]
    overall = {}
    if spec.name == "fraud":
        overall = metrics.flag_stats(y, out["p"][test] >= ctx["threshold"], _sub(weights(spec, df), test))
    groups = {}
    cols = [c for c in FAIR_GROUPS if c in spec.cat]
    for c in cols:
        vals = df[c].iloc[test].astype(str).to_numpy()
        groups[c] = {v: _fair_row(spec, df, test[vals == v], out, base, ctx, overall) for v in sorted(set(vals))}
    if spec.segments:
        groups["customer_history"] = {name: _fair_row(spec, df, test[fn(df.iloc[test]).to_numpy()], out, base, ctx, overall)
                                      for name, fn in spec.segments.items()}
    watch = [f"{g}: {v}" for g, vs in groups.items() for v, r in vs.items() if r.get("watch")]
    return {"groups": groups, "watch": watch,
            "rule": ("fraud: false flags over 1% and over twice the overall rate" if spec.name == "fraud" else
                     f"predicted rate off by more than {GATES['max_calibration_error']:.0%}" if spec.kind == "binary" else
                     "error worse than the rule in the group"),
            "note": "Informational, on the offline test period. It never changes the status; flagged groups need a person's review before any go-live."}


def _diagnostics(spec, model, df, split, out, base, ctx, seed=0):
    test = split.test
    y_t = df[spec.label].to_numpy()[test]
    d = {"over_time": _over_time(spec, df, test, out, base, ctx), "importance": _importance(spec, model, df, test, seed=seed)}
    if spec.kind == "binary":
        d["calibration"] = _calibration(y_t.astype(float), out["p"][test], _sub(weights(spec, df), test))
    if spec.name == "demand":
        d["range"] = {"level": 0.80, "width_share_of_capacity": round(ctx["conformal_q"], 4),
                      "coverage": round(metrics.coverage(y_t, out["lo"][test], out["hi"][test]), 4),
                      "baseline_coverage": round(metrics.coverage(y_t, base["lo"][test], base["hi"][test]), 4)}
    try:
        d["examples"] = _examples(spec, model, df, split, out, ctx)
        d["explanation_note"] = explanation_note(spec)
    except Exception as e:
        d["examples_error"] = str(e)[:200]
    d["fairness"] = _fairness(spec, df, split, out, base, ctx)
    if spec.name == "crowd" and "p_over" in out:
        cap = df["gate_capacity_per_hour"].to_numpy(dtype=float)[test] / 12.0
        over = (y_t > cap).astype(float)
        p = out["p_over"][test]
        order = np.argsort(p, kind="stable")
        d["overload"] = {
            "range_level": 0.80, "range_coverage": round(metrics.coverage(y_t, out["lo"][test], out["hi"][test]), 4),
            "slots_over_capacity": int(over.sum()), "slots": int(len(over)),
            "calibration": [{"predicted": round(float(p[c].mean()), 4), "actual": round(float(over[c].mean()), 4), "rows": int(len(c))}
                            for c in np.array_split(order, 10) if len(c)],
            "note": "Chance that a gate gets more scans in a 5-minute slot than its capacity allows (capacity per hour / 12).",
        }
    if spec.name == "fraud" and all(c in spec.num for c in LINK_FEATURES):
        d["without_link_features"] = _without_links(spec, df, split, base, seed=seed, complexity=ctx.get("complexity"))
    return d


# ---------------------------------------------------------------------------------------------
def _deployed_comparison(spec, df, split, out, ctx, deployed, seed=0):
    """The candidate vs the currently deployed model, on test rows newer than everything the deployed model
    was trained on (otherwise it would be judged on rows it has seen). deployed: {artifact, sha256, file}."""
    if deployed is None:
        return {"status": "NO_DEPLOYED_MODEL"}
    art = deployed["artifact"]
    if art is None:
        return {"status": "DEPLOYED_ARTIFACT_NOT_FOUND", "sha256": deployed["sha256"],
                "reason": "the app's deployed model file is not available to compare with"}
    info = {"sha256": deployed["sha256"], "file": deployed.get("file"), "source": art.get("data_source"),
            "trained_to": art.get("trained_to")}
    want = {"categorical": list(spec.cat), "numeric": list(spec.num)}
    if art.get("features") != want:
        return {**info, "status": "NOT_COMPARABLE", "reason": "the deployed model uses different inputs"}
    trained_to = pd.Timestamp(art["trained_to"])
    if trained_to.tzinfo is None:
        trained_to = trained_to.tz_localize("UTC")
    idx = split.test[(df["ts"].iloc[split.test] > trained_to).to_numpy()]
    missing, sizes = _enough_data(spec, df, idx) if len(idx) else ({"rows": "0 newer than its training data"}, {})
    if missing:
        return {**info, "status": "NOT_ENOUGH_DATA", "rows": int(len(idx)),
                "reasons": [f"test rows newer than the deployed model's training data: {k} {v}" for k, v in missing.items()]}
    p = predict(art["model"], df, spec)
    th = art.get("thresholds", {}).get("threshold")
    dep = {"score": p, "pred": p, "flag": (p >= th) if th is not None else np.zeros(len(p), dtype=bool)}
    m, d = main_measure(spec, df, idx, out, dep, ctx)
    lo, hi = bootstrap_improvement(spec, df, idx, out, dep, ctx, seed=seed)
    better = lo > 0
    return {**info, "status": "COMPARED", "rows": int(len(idx)), "test_size": sizes,
            "candidate": round(m, 4), "deployed": round(d, 4),
            "improvement": round((m - d) if HIGHER_IS_BETTER[spec.name] else (d - m), 4),
            "improvement_95ci": [round(lo, 4), round(hi, 4)], "candidate_clearly_better": bool(better)}


def recommendation(report):
    """Human-facing recommendation. Never acted on automatically."""
    dep = report.get("deployed_model", {})
    if report.get("status") != "PASSED":
        return "KEEP_CURRENT: the candidate did not pass the evaluation gates"
    if report.get("data", {}).get("source") != "db-export":
        return "KEEP_CURRENT: trained on synthetic data"
    if dep.get("status") == "COMPARED" and not dep.get("candidate_clearly_better"):
        return "KEEP_CURRENT: not clearly better than the deployed model"
    if dep.get("status") in ("NOT_ENOUGH_DATA", "NOT_COMPARABLE", "DEPLOYED_ARTIFACT_NOT_FOUND"):
        return f"REVIEW: passed the gates; deployed-model comparison {dep['status'].lower().replace('_', ' ')}"
    return "PROMOTION_CANDIDATE: passed the gates; needs a live shadow check and admin approval"


def evaluate(spec: ModelSpec, data_dir: str, manifest: dict, seed=0, final=True, shadow_decision=None, deployed=None):
    t0 = time.time()
    df = load(spec, data_dir)
    base = baseline(spec, df)
    split = time_split(df, spec, seed=seed)
    assert_no_leakage(df, split, spec)

    report = {
        "model": spec.name, "title": spec.title, "label": spec.label, "kind": spec.kind,
        "features": {"categorical": list(spec.cat), "numeric": list(spec.num)},
        "data": {"dataset": f"{spec.dataset}.csv", "rows": int(len(df)), "source": manifest.get("source"),
                 "sha256": manifest.get("files", {}).get(spec.dataset, {}).get("sha256"),
                 "from": df["ts"].min().isoformat(), "to": df["ts"].max().isoformat()},
        "split": split.summary(), "leakage_checks": "passed", "gates": GATES,
        "main_measure": MAIN_NAME[spec.name], "higher_is_better": HIGHER_IS_BETTER[spec.name],
    }

    missing, sizes = _enough_data(spec, df, split.test)
    report["test_size"] = sizes
    if missing:
        report.update(status="NOT_ENOUGH_DATA", reasons=[f"test period too small: {k} {v}" for k, v in missing.items()])
        report["duration_seconds"] = round(time.time() - t0, 1)
        return report, None

    complexity, selection = _select_complexity(spec, df, split, seed=seed)
    report["complexity_selection"] = selection
    model = _fit(spec, df, split.train, seed=seed, complexity=complexity)
    ctx = _prepare_context(spec, model, df, split)
    ctx["complexity"] = complexity
    out = _outputs(spec, model, df, ctx)
    train_out = {k: v[split.train] for k, v in out.items()}

    m, b = main_measure(spec, df, split.test, out, base, ctx)
    lo, hi = bootstrap_improvement(spec, df, split.test, out, base, ctx, seed=seed)
    report["result"] = {"model": round(m, 4), "baseline": round(b, 4),
                        "improvement": round((m - b) if HIGHER_IS_BETTER[spec.name] else (b - m), 4),
                        "improvement_95ci": [round(lo, 4), round(hi, 4)]}

    y_t = df[spec.label].to_numpy()[split.test]
    w_t = _sub(weights(spec, df), split.test)
    extra = {}
    if spec.kind == "binary":
        extra["test_auc"] = round(metrics.auc(y_t, out["p"][split.test], w_t), 4)
        extra["test_brier"] = round(metrics.brier(y_t, out["p"][split.test]), 4)
        if "score" in base:
            extra["baseline_auc"] = round(metrics.auc(y_t, base["score"][split.test], w_t), 4)
    if spec.name == "fraud":
        extra["threshold"] = round(ctx["threshold"], 4)
        extra["sampling_weighted"] = w_t is not None
        extra["baseline_is_logged_rule_decision"] = bool("rule_flag" in df and df["rule_flag"].notna().all())
        extra["model_flags"] = {k: round(v, 4) for k, v in metrics.flag_stats(y_t, out["p"][split.test] >= ctx["threshold"], w_t).items()}
        extra["rule_flags"] = {k: round(v, 4) for k, v in metrics.flag_stats(y_t, base["flag"][split.test], w_t).items()}
    if spec.name == "demand":
        extra["model_mae_tickets"] = round(metrics.mae(y_t, out["pred"][split.test]), 1)
        extra["baseline_mae_tickets"] = round(metrics.mae(y_t, base["pred"][split.test]), 1)
        extra["range_width_share"] = round(ctx["conformal_q"], 4)
    if spec.name == "checkout_abandonment":
        # False predictions when the top 10% are treated as "will abandon"
        f = GATES["top_fraction"]
        for who, score in (("model", out["p"][split.test]), ("rule", base["score"][split.test])):
            k = max(1, int(round(len(score) * f)))
            flag = np.zeros(len(score), dtype=bool)
            flag[np.argsort(-score, kind="stable")[:k]] = True
            extra[f"{who}_top10_false_predictions"] = {
                "false_alarm_share": round(float((y_t[flag] == 0).mean()), 4),
                "completed_checkouts_flagged": round(float(flag[y_t == 0].mean()) if (y_t == 0).any() else 0.0, 4),
                "abandons_missed": round(float((~flag[y_t == 1]).mean()) if (y_t == 1).any() else 0.0, 4)}
        extra["calibration_error_ece"] = round(metrics.ece(y_t, out["p"][split.test]), 4)
    if spec.name == "demand_hourly":
        v, note = metrics.wape_safe(y_t, out["pred"][split.test])
        extra["zero_sales_note"] = note
        extra["test_hours_with_zero_sales"] = int((y_t == 0).sum())
    if spec.name == "crowd":
        d = df.iloc[split.test].assign(err_m=np.abs(out["pred"][split.test] - y_t), err_b=np.abs(base["pred"][split.test] - y_t))
        by = lambda col: {str(k): {"model": round(float(g["err_m"].mean()), 3), "baseline": round(float(g["err_b"].mean()), 3), "rows": int(len(g))}
                          for k, g in d.groupby(col)}
        extra["error_by_minutes_from_start"] = by("minutes_from_start")
        extra["error_by_event_type"] = by("event_type")
        extra["error_by_day_of_week"] = by("day_of_week")
        gate = d.groupby("gate_id")[["err_m", "err_b"]].mean()
        extra["gate_level"] = {"gates": int(len(gate)), "gates_where_model_better": int((gate["err_m"] < gate["err_b"]).sum())}
    if spec.name == "attendance":
        pred, _, act = _per_event_attendance(df, split.test, out["p"][split.test], base["rate"][split.test])
        cur = _per_event_attendance(df, split.test, out["p"][split.test], base["current_rule"][split.test])[1]
        extra["current_fixed_rule_error"] = round(metrics.mae(act, cur), 1)
        extra["no_show_threshold"] = round(ctx["threshold"], 4)
        extra["average_event_attendance"] = round(float(act.mean()), 1)
    report["details"] = extra

    report["guards"] = _guards(spec, df, split, out, base, ctx, train_out)
    report["segments"] = _known_unseen(spec, df, split, out, base, ctx)
    report["learning_curve"] = _learning_curve(spec, df, split, ctx, seed=seed)
    report["diagnostics"] = _diagnostics(spec, model, df, split, out, base, ctx, seed=seed)

    reasons = []
    if lo <= 0:
        reasons.append(f"not clearly better than the baseline: 95% interval of the improvement is [{lo:.4f}, {hi:.4f}]")
    reasons += [f"guard failed: {g['name']} = {g['value']} (needs {g['limit']})" for g in report["guards"] if not g["passed"]]
    report["status"] = "PASSED" if not reasons else "REJECTED"
    report["reasons"] = reasons
    report["deployed_model"] = _deployed_comparison(spec, df, split, out, ctx, deployed, seed=seed)

    artifact = None
    if final and report["status"] == "PASSED":
        artifact = _final_artifact(spec, df, ctx, report, manifest, seed)
    elif final and report["status"] == "REJECTED" and shadow_decision:
        # Rejected, but kept in shadow by a recorded decision to collect live evidence. It can never
        # serve decisions; it must be re-evaluated on reviewed real cases first.
        artifact = _final_artifact(spec, df, ctx, report, manifest, seed)
        artifact["shadow_decision"] = shadow_decision
        report["shadow_decision"] = shadow_decision
        report["final_model"] = {k: v for k, v in artifact.items() if k in ("trained_rows", "trained_from", "trained_to",
                                                                            "calibration")}
    report["duration_seconds"] = round(time.time() - t0, 1)
    return report, artifact


def _final_artifact(spec, df, ctx, report, manifest, seed):
    """Same settings, all rows (the newest months matter most for what comes next)."""
    X, y = feature_frame(df, spec), target(df, spec)
    w = weights(spec, df)
    if spec.kind == "binary" and w is not None:
        # Weighted fit on all rows + the calibration fitted (weighted) on the validation period
        est = build(spec, seed=seed, complexity=ctx["complexity"]).fit(X, y, model__sample_weight=w)
        model = WeightedCalibrated(est, ctx["calibrator"])
        calibration = "isotonic on the validation period, sampling-weighted"
    elif spec.kind == "binary":
        model = CalibratedClassifierCV(build(spec, seed=seed, complexity=ctx["complexity"]), method="isotonic", cv=5)
        model.fit(X, y)
        calibration = "isotonic, 5-fold (CalibratedClassifierCV)"
    else:
        model = build(spec, seed=seed, complexity=ctx["complexity"]).fit(X, y)
        calibration = None
    return {
        "format": ARTIFACT_FORMAT, "model_name": spec.name, "model": model,
        "features": {"categorical": list(spec.cat), "numeric": list(spec.num)}, "kind": spec.kind,
        "thresholds": {k: ctx[k] for k in ("threshold", "conformal_q", "resid_q", "over_cal") if k in ctx},
        "calibration": calibration, "complexity": ctx["complexity"],
        # Typical values (for per-prediction reasons) and training distributions (for drift checks)
        "reference": reference_profile(df, spec),
        "trained_rows": int(len(df)), "trained_from": df["ts"].min().isoformat(), "trained_to": df["ts"].max().isoformat(),
        "data_source": manifest.get("source"), "data_sha256": report["data"]["sha256"],
        "evaluation": {"status": report["status"], "result": report["result"], "reasons": report.get("reasons", [])},
        # Synthetic-trained models and rejected models may only run in shadow. Serving decisions needs a
        # PASSED evaluation on db-export data AND a passed live shadow check AND admin approval.
        "may_serve_decisions": bool(report["status"] == "PASSED" and manifest.get("source") == "db-export"),
        "versions": {"python": platform.python_version(), "sklearn": sklearn.__version__,
                     "numpy": np.__version__, "pandas": pd.__version__},
        "created_at": pd.Timestamp.now(tz="UTC").isoformat(),
    }


def save_artifact(artifact, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    joblib.dump(artifact, path, compress=3)
