"""
Attendance: should the app's fixed-percentage rule be replaced by the historical-average baseline?

Both are judged exactly like a model: same leakage-free time split (newest 15% of events is the test
period), same measure (average error in people attending per event), same 95% bootstrap over events.
The historical average must be clearly better (interval above zero) to recommend replacing the rule.

    python -m ml.compare_baselines            -> reports/v0/attendance_baseline_comparison.{md,json}
"""

import json
import os
import sys

import numpy as np

from . import baselines, metrics
from .evaluate import _per_event_attendance, load
from .gates import GATES
from .schema import SPECS
from .splits import assert_no_leakage, time_split

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def compare(data_dir, seed=0):
    spec = SPECS["attendance"]
    df = load(spec, data_dir)
    split = time_split(df, spec, seed=seed)
    assert_no_leakage(df, split, spec)
    hist_rate = baselines.attendance_show_rate(df)          # as of each event (tests prove no future use)
    fixed_rate = baselines.attendance_current_rule(df)
    zero_p = np.zeros(len(df))

    def per_event(idx):
        _, hist_pred, act = _per_event_attendance(df, idx, zero_p[idx], hist_rate[idx])
        _, fixed_pred, _ = _per_event_attendance(df, idx, zero_p[idx], fixed_rate[idx])
        return hist_pred, fixed_pred, act

    results = {}
    rng = np.random.default_rng(seed)
    a = (1 - GATES["bootstrap_confidence"]) / 2
    # Test period (as for the models) and the whole period after a burn-in (enough history to average)
    burn_in = df["ts"].quantile(0.15)
    periods = {"test period (newest 15%)": split.test,
               "all events after the first 15% (burn-in)": np.flatnonzero((df["ts"] >= burn_in).to_numpy())}
    for name, idx in periods.items():
        h, f, act = per_event(idx)
        diffs = []
        for _ in range(GATES["bootstrap_resamples"]):
            k = rng.integers(0, len(act), len(act))
            diffs.append(metrics.mae(act[k], f[k]) - metrics.mae(act[k], h[k]))
        lo, hi = float(np.quantile(diffs, a)), float(np.quantile(diffs, 1 - a))
        results[name] = {
            "events": int(len(act)),
            "historical_average_error": round(metrics.mae(act, h), 1),
            "fixed_rule_error": round(metrics.mae(act, f), 1),
            "improvement": round(metrics.mae(act, f) - metrics.mae(act, h), 1),
            "improvement_95ci": [round(lo, 1), round(hi, 1)],
            "historical_average_bias": round(float(np.mean(h - act)), 1),
            "fixed_rule_bias": round(float(np.mean(f - act)), 1),
            "clearly_better": bool(lo > 0),
        }
    decision = all(r["clearly_better"] for r in results.values())
    return {"question": "replace the fixed-percentage attendance rule with the historical-average baseline?",
            "measure": "average error in people attending per event (lower is better)",
            "leakage_checks": "passed", "split": split.summary(), "results": results,
            "recommendation": "replace" if decision else "keep the fixed rule (not clearly better)"}


def markdown(r):
    lines = ["# Attendance baseline: historical average vs current fixed rule", "",
             f"**Recommendation: {r['recommendation']}**", "",
             "Fixed rule (today, `organizerDashboardService`): 92.4% cricket, 86.8% music, 89.1% kabaddi, 88.5% "
             "otherwise, +2 points in Lahore/Karachi. Historical average: tickets sold x average show rate of past "
             "finished events of the same type (all types until 200 tickets of history; before any history, the fixed rule itself), computed as of each event.",
             "", "Caveat: on synthetic data the fixed rule's percentages do not match the simulated show rate, so part of its error is built in. What this shows is that the historical average corrects itself to the actual show rate and the fixed rule cannot; the client's check-ins decide the real numbers.",
             "", f"Measure: {r['measure']}. Same leakage-free split as the models; 95% bootstrap over events.", "",
             "| Period | Events | Historical average | Fixed rule | Improvement (95% interval) | Bias hist. / fixed | Clearly better |",
             "|---|---|---|---|---|---|---|"]
    for name, x in r["results"].items():
        lines.append(f"| {name} | {x['events']} | {x['historical_average_error']} | {x['fixed_rule_error']} | "
                     f"{x['improvement']} ({x['improvement_95ci'][0]} to {x['improvement_95ci'][1]}) | "
                     f"{x['historical_average_bias']:+} / {x['fixed_rule_bias']:+} | {'yes' if x['clearly_better'] else 'no'} |")
    lines += ["", "Bias = average (predicted - actual) people per event; positive means over-predicting attendance.",
              "", "Synthetic data: this shows the method is sound and leakage-free. The client's own check-ins decide "
              "the real show rates once events have run."]
    return "\n".join(lines) + "\n"


def main():
    data = os.path.join(BASE_DIR, "data")
    out = os.path.join(BASE_DIR, "reports", "v0")
    r = compare(data)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "attendance_baseline_comparison.json"), "w") as f:
        json.dump(r, f, indent=2)
    with open(os.path.join(out, "attendance_baseline_comparison.md"), "w", encoding="utf-8") as f:
        f.write(markdown(r))
    print(markdown(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
