"""
Replay: two model files on the same rows, side by side. Development / review tool: it registers, promotes and
deploys nothing.

    python -m ml.replay --model fraud --a models/v0/fraud.joblib --b models/candidates/<stamp>/fraud.joblib \
                        --data exports/<stamp>  [--out reports/replay]

With a database export, the rows ARE the logged shadow traffic: every row carries the exact inputs logged at
prediction time (feature_source "snapshot") and the outcome attached later, so this replays what each model would
have said on what really happened. Only rows newer than BOTH models' training data are used, so neither is judged
on rows it learned from. Each model uses its own inputs and its own stored threshold. The difference is reported
with a 95% interval from resampling whole events; "clearly better" needs the interval above zero.
"""

import argparse
import json
import os
import sys
from dataclasses import replace

import joblib
import numpy as np
import pandas as pd

from . import metrics
from .evaluate import HIGHER_IS_BETTER, MAIN_NAME, _per_event_attendance, load, weights
from .gates import GATES
from .models import predict
from .schema import ALL_SPECS


def _spec_for(spec, art):
    return replace(spec, cat=tuple(art["features"]["categorical"]), num=tuple(art["features"]["numeric"]))


def _measure(spec, df, idx, p, threshold, w):
    y = df[spec.label].to_numpy()[idx]
    if spec.name in ("intent", "abandonment", "checkout_abandonment"):
        return metrics.top_share(y, p[idx], GATES["top_fraction"])
    if spec.name == "fraud":
        return metrics.flag_stats(y, p[idx] >= threshold, None if w is None else w[idx])["precision"]
    if spec.name == "demand":
        return metrics.wape(y, p[idx])
    if spec.name == "demand_hourly":
        return metrics.wape_safe(y, p[idx])[0]
    if spec.name == "attendance":
        pred, _, act = _per_event_attendance(df, idx, p[idx], np.zeros(len(idx)))
        return metrics.mae(act, pred)
    return metrics.mae(y, p[idx])


def replay(name, a_path, b_path, data_dir, resamples=GATES["bootstrap_resamples"], seed=0):
    spec = ALL_SPECS[name]
    arts = {k: joblib.load(p) for k, p in (("a", a_path), ("b", b_path))}
    for k, art in arts.items():
        if art.get("model_name") != name:
            raise SystemExit(f"{k}: file is a '{art.get('model_name')}' model, not '{name}'")
    df = load(spec, data_dir)
    newer = max(pd.Timestamp(art["trained_to"]) for art in arts.values())
    if newer.tzinfo is None:
        newer = newer.tz_localize("UTC")
    idx = np.where((df["ts"] > newer).to_numpy())[0]
    out = {"model": name, "measure": MAIN_NAME[name], "higher_is_better": HIGHER_IS_BETTER[name], "data": data_dir,
           "rows_newer_than_both": int(len(idx)), "both_trained_to": newer.isoformat(),
           "a": {"file": a_path, "trained_to": arts["a"]["trained_to"], "source": arts["a"].get("data_source")},
           "b": {"file": b_path, "trained_to": arts["b"]["trained_to"], "source": arts["b"].get("data_source")},
           "promotes_anything": False}
    if len(idx) < 50 or df["event_id"].iloc[idx].nunique() < 10:
        out["status"] = "NOT_ENOUGH_DATA"
        out["reason"] = f"{len(idx)} rows / {df['event_id'].iloc[idx].nunique()} events newer than both models' training data"
        return out
    w = weights(spec, df)
    preds = {}
    for k, art in arts.items():
        s = _spec_for(spec, art)
        missing = [c for c in s.cat + s.num if c not in df]
        if missing:
            raise SystemExit(f"{k}: the data has no column(s) {missing} that this model needs")
        preds[k] = (predict(art["model"], df, s), art.get("thresholds", {}).get("threshold"))
    va, vb = (_measure(spec, df, idx, p, th, w) for p, th in (preds["a"], preds["b"]))
    sign = 1.0 if HIGHER_IS_BETTER[name] else -1.0
    events = df["event_id"].to_numpy()[idx]
    uniq, inv = np.unique(events, return_inverse=True)
    rows_of = [idx[inv == k] for k in range(len(uniq))]
    rng = np.random.default_rng(seed)
    diffs = []
    for _ in range(resamples):
        sample = np.concatenate([rows_of[k] for k in rng.integers(0, len(uniq), len(uniq))])
        diffs.append(sign * (_measure(spec, df, sample, *preds["b"], w) - _measure(spec, df, sample, *preds["a"], w)))
    lo, hi = float(np.quantile(diffs, 0.025)), float(np.quantile(diffs, 0.975))
    out.update(status="COMPARED", events=int(len(uniq)), a_value=round(float(va), 4), b_value=round(float(vb), 4),
               b_minus_a_improvement=round(sign * (vb - va), 4), improvement_95ci=[round(lo, 4), round(hi, 4)],
               verdict="B clearly better" if lo > 0 else "A clearly better" if hi < 0 else "no clear difference")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, choices=sorted(ALL_SPECS))
    ap.add_argument("--a", required=True, help="model file A (usually the one the app runs now)")
    ap.add_argument("--b", required=True, help="model file B (usually a candidate)")
    ap.add_argument("--data", required=True, help="dataset directory (a database export to replay logged traffic)")
    ap.add_argument("--out", default=None, help="write the result as JSON into this directory")
    args = ap.parse_args(argv)
    res = replay(args.model, args.a, args.b, args.data)
    print(json.dumps(res, indent=2))
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, f"replay_{args.model}.json"), "w") as f:
            json.dump(res, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
