"""
PUBLIC-data experiment (development only): the purchase-intent method on the UCI Online Shoppers dataset.

    python -m ml.public_experiment          # after: python scripts/fetch_public_datasets.py

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


if __name__ == "__main__":
    r = run()
    print(json.dumps({k: r[k] for k in ("with_PageValues", "without_PageValues")}, indent=2))
