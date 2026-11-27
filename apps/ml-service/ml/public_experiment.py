"""
PUBLIC-data experiment (development only): the purchase-intent method on the UCI Online Shoppers dataset.

    python -m ml.public_experiment [intent|fraud]   # after: python scripts/fetch_public_datasets.py

NOT TicketLedger data and NOT evidence of real-world performance: e-commerce sessions of one shop over one year,
with no event, seat, price or days-to-event fields. It exercises the method (chronological split, calibration,
top-10% buyer share against a rule, new vs returning visitors) on genuinely recorded data. The result is written
to reports/public/ and is never registered, compared with app models or used by the app.

Split by time (the data has months, no year): train Feb-Sep, calibrate on Oct, test on Nov-Dec (season shift
included). `PageValues` is computed from pages that can come after the decision (a known leakage risk of this
dataset), so results are reported with and without it.
"""

import json
import os

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression

from . import metrics

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data", "public", "online_shoppers")
OUT = os.path.join(BASE, "reports", "public")
MONTHS = ["Feb", "Mar", "May", "June", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
TRAIN, CAL, TEST = MONTHS[:7], ["Oct"], ["Nov", "Dec"]
BANNER = ("PUBLIC dataset (UCI Online Shoppers Purchasing Intention, CC BY 4.0, Sakar & Kastro 2018). E-commerce, not "
          "ticketing; not TicketLedger customer data; experimentation only; not evidence of real-world performance.")


def run(data_dir=DATA, out_dir=OUT, seed=0):
    man = json.load(open(os.path.join(data_dir, "manifest.json")))
    assert man["source_class"] == "PUBLIC", "this experiment only runs on PUBLIC data"
    df = pd.read_csv(os.path.join(data_dir, "online_shoppers_intention.csv"))
    df["y"] = df["Revenue"].astype(str).str.upper().eq("TRUE").astype(int)
    df["new_visitor"] = (df["VisitorType"] == "New_Visitor").astype(int)
    df["weekend"] = df["Weekend"].astype(str).str.upper().eq("TRUE").astype(int)
    num = ["Administrative", "Administrative_Duration", "Informational", "Informational_Duration", "ProductRelated",
           "ProductRelated_Duration", "BounceRates", "ExitRates", "PageValues", "SpecialDay", "new_visitor", "weekend"]
    cat = ["OperatingSystems", "Browser", "Region", "TrafficType"]
    tr, ca, te = (df[df["Month"].isin(m)] for m in (TRAIN, CAL, TEST))
    # The app's intent rule shape, on what this data records (pages viewed as "views"; nothing for seats/checkout)
    rule = lambda d: (40 + 15 * (d["ProductRelated"] >= 3)).to_numpy(dtype=float)
    res = {"banner": BANNER, "source": {k: man[k] for k in ("title", "page", "license", "citation", "archive_sha256")},
           "split": {"train_months": TRAIN, "calibration_months": CAL, "test_months": TEST,
                     "rows": {"train": int(len(tr)), "calibration": int(len(ca)), "test": int(len(te))},
                     "buyer_rate": {"train": round(float(tr["y"].mean()), 4), "test": round(float(te["y"].mean()), 4)}}}
    for variant, feats in (("with_PageValues", num + cat), ("without_PageValues", [f for f in num if f != "PageValues"] + cat)):
        mask = [f in cat for f in feats]
        model = HistGradientBoostingClassifier(categorical_features=mask, max_depth=4, learning_rate=0.08, max_iter=200, random_state=seed)
        model.fit(tr[feats], tr["y"])
        cal = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(model.predict_proba(ca[feats])[:, 1], ca["y"])
        p = cal.predict(model.predict_proba(te[feats])[:, 1])
        y = te["y"].to_numpy()
        seg = {}
        for name, m in (("new_visitors", te["new_visitor"] == 1), ("returning_visitors", te["new_visitor"] == 0)):
            m = m.to_numpy()
            seg[name] = {"rows": int(m.sum()), "auc": round(metrics.auc(y[m], p[m]), 4),
                         "top10_buyer_share": round(metrics.top_share(y[m], p[m]), 4), "rule_top10_buyer_share": round(metrics.top_share(y[m], rule(te)[m]), 4)}
        res[variant] = {"test_auc": round(metrics.auc(y, p), 4), "top10_buyer_share": round(metrics.top_share(y, p), 4),
                        "rule_top10_buyer_share": round(metrics.top_share(y, rule(te)), 4), "calibration_error_ece": round(metrics.ece(y, p), 4),
                        "segments": seg}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "online_shoppers.json"), "w") as f:
        json.dump(res, f, indent=2)
    L = ["# PUBLIC-data experiment: purchase intent on UCI Online Shoppers", "", f"**{BANNER}**", "",
         f"Split by month: train {', '.join(TRAIN)}; calibrate {', '.join(CAL)}; test {', '.join(TEST)} "
         f"({res['split']['rows']['test']:,} sessions, {res['split']['buyer_rate']['test']:.1%} buyers).", "",
         "| Variant | Test AUC | Top-10% buyer share | Rule top-10% | Calibration error | New visitors top-10% | Returning top-10% |", "|---|---|---|---|---|---|---|"]
    for v in ("with_PageValues", "without_PageValues"):
        r = res[v]
        L.append(f"| {v} | {r['test_auc']} | {r['top10_buyer_share']} | {r['rule_top10_buyer_share']} | {r['calibration_error_ece']} | "
                 f"{r['segments']['new_visitors']['top10_buyer_share']} | {r['segments']['returning_visitors']['top10_buyer_share']} |")
    L += ["", "`PageValues` can include pages visited after the purchase decision; the variant without it is the honest one.",
          "These numbers say nothing about TicketLedger. They only show the method runs on genuinely recorded public data.", ""]
    with open(os.path.join(out_dir, "online_shoppers.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    return res




# ---------------------------------------------------------------------------------------------
# Fraud method check on the ULB card-fraud data (python -m ml.public_experiment fraud)
# ---------------------------------------------------------------------------------------------
FRAUD_DATA = os.path.join(BASE, "data", "public", "credit_card_fraud")
FRAUD_BANNER = ("PUBLIC dataset (ULB Credit Card Fraud, Dal Pozzolo et al. 2015, OpenML 1597). Card transactions with anonymised "
                "features, NOT ticket scalping; not TicketLedger data; a check of the fraud METHOD only; not evidence of "
                "real-world performance for TicketLedger.")
MAX_FALSE_FLAGS = 0.01   # the same limit as the app's fraud gate (ml/gates.py)


def _flags(y, flag):
    y, flag = np.asarray(y), np.asarray(flag, dtype=bool)
    tp, fp = int((flag & (y == 1)).sum()), int((flag & (y == 0)).sum())
    return {"flagged": int(flag.sum()), "precision": round(tp / max(1, flag.sum()), 4), "recall": round(tp / max(1, (y == 1).sum()), 4),
            "false_flag_rate": round(fp / max(1, (y == 0).sum()), 5)}


def run_fraud(data_dir=FRAUD_DATA, out_dir=OUT, seed=0, resamples=300):
    from sklearn.metrics import average_precision_score
    man = json.load(open(os.path.join(data_dir, "manifest.json")))
    assert man["source_class"] == "PUBLIC", "this experiment only runs on PUBLIC data"
    df = pd.read_csv(os.path.join(data_dir, "creditcard.csv")).sort_values("Time", kind="stable").reset_index(drop=True)
    df["y"] = df["Class"].astype(int)
    df["hour"] = (df["Time"] // 3600) % 24
    feats = [f"V{i}" for i in range(1, 29)] + ["Amount", "hour"]
    n = len(df)
    tr, ca, te = df.iloc[: int(n * 0.6)], df.iloc[int(n * 0.6): int(n * 0.8)], df.iloc[int(n * 0.8):]    # chronological
    model = HistGradientBoostingClassifier(max_leaf_nodes=31, min_samples_leaf=40, l2_regularization=1.0, learning_rate=0.06,
                                           max_iter=500, early_stopping=True, validation_fraction=0.1, n_iter_no_change=30, random_state=seed)
    model.fit(tr[feats], tr["y"])
    cal = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(model.predict_proba(ca[feats])[:, 1], ca["y"])
    p_ca = cal.predict(model.predict_proba(ca[feats])[:, 1])
    p = cal.predict(model.predict_proba(te[feats])[:, 1])
    y = te["y"].to_numpy()
    # Threshold fixed on the calibration period: the highest flag volume with at most 1% false flags among legitimate ones
    th = float(np.quantile(p_ca[ca["y"].to_numpy() == 0], 1 - MAX_FALSE_FLAGS)) + 1e-9
    # A simple rule with the same flag budget: the largest amounts (top 1% of calibration-period amounts)
    amt_th = float(np.quantile(ca["Amount"], 1 - MAX_FALSE_FLAGS))
    m_flag, r_flag = p >= th, te["Amount"].to_numpy() >= amt_th
    rng = np.random.default_rng(seed)
    diffs = []
    for _ in range(resamples):
        k = rng.integers(0, len(y), len(y))
        diffs.append(_flags(y[k], m_flag[k])["recall"] - _flags(y[k], r_flag[k])["recall"])
    order = np.argsort(p, kind="stable")
    bins = [{"predicted": round(float(p[c].mean()), 4), "actual": round(float(y[c].mean()), 4), "rows": int(len(c))} for c in np.array_split(order[-int(len(order) * 0.05):], 5)]
    res = {
        "banner": FRAUD_BANNER, "source": {k: man[k] for k in ("title", "page", "license", "citation", "archive_sha256")},
        "split": {"method": "chronological by Time: oldest 60% train, next 20% calibrate + threshold, newest 20% test",
                  "rows": {"train": int(len(tr)), "calibration": int(len(ca)), "test": int(len(te))},
                  "frauds": {"train": int(tr["y"].sum()), "calibration": int(ca["y"].sum()), "test": int(y.sum())}},
        "threshold": {"probability": round(th, 5), "fixed_on": "calibration period", "max_false_flags": MAX_FALSE_FLAGS},
        "base_rate": round(float(y.mean()), 5),
        "model": {**_flags(y, m_flag), "test_auc": round(metrics.auc(y, p), 4), "average_precision": round(float(average_precision_score(y, p)), 4),
                  "lift_over_random": round(_flags(y, m_flag)["precision"] / max(float(y.mean()), 1e-9), 1),
                  "false_flags_within_limit": bool(_flags(y, m_flag)["false_flag_rate"] <= MAX_FALSE_FLAGS)},
        "rule": {**_flags(y, r_flag), "rule": f"flag the largest amounts (>= {amt_th:.2f}, top 1% of the calibration period)"},
        "recall_gain_95ci": [round(float(np.quantile(diffs, 0.025)), 4), round(float(np.quantile(diffs, 0.975)), 4)],
        "calibration_top5pct": bins,
        "note": "Same method as the app's fraud model (chronological split, isotonic calibration on a later period, threshold fixed "
                "before the test at 1% false flags, comparison with a rule at a similar flag budget). Card fraud is not scalping: "
                "these numbers say the method works on real rare fraud, not that the TicketLedger model does.",
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "credit_card_fraud.json"), "w") as f:
        json.dump(res, f, indent=2)
    mm, rr = res["model"], res["rule"]
    L = ["# PUBLIC-data experiment: the fraud method on ULB card fraud", "", f"**{FRAUD_BANNER}**", "", res["split"]["method"],
         f"({res['split']['rows']['test']:,} test transactions, {res['split']['frauds']['test']} frauds).", "",
         "| | Flagged | Share of flags that are fraud | Frauds caught | False flags | AUC | Avg precision |", "|---|---|---|---|---|---|---|",
         f"| Model | {mm['flagged']} | {mm['precision']} | {mm['recall']} | {mm['false_flag_rate']} | {mm['test_auc']} | {mm['average_precision']} |",
         f"| Rule (largest amounts) | {rr['flagged']} | {rr['precision']} | {rr['recall']} | {rr['false_flag_rate']} | | |", "",
         f"95% interval of the recall gain: {res['recall_gain_95ci']}. Fraud base rate {res['base_rate']:.3%}: the model's flags are "
         f"{mm['lift_over_random']}x more likely to be fraud than a random transaction.", "", res["note"], ""]
    with open(os.path.join(out_dir, "credit_card_fraud.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    return res


if __name__ == "__main__":
    import sys
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "intent"):
        r = run()
        print(json.dumps({k: r[k] for k in ("with_PageValues", "without_PageValues")}, indent=2))
    if which in ("all", "fraud"):
        r = run_fraud()
        print(json.dumps({k: r[k] for k in ("model", "rule", "recall_gain_95ci")}, indent=2))
