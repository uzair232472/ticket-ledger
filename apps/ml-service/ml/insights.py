"""
Step 5 analyses that do not train a model:

  recommendation_report(df)  the recommendation experiment: PERSONALISED vs the non-personalised CONTROL
                             group (click-through, purchases within the attribution window, uplift with a
                             bootstrap interval over customers), exposure and diversity (new / less popular
                             events), first-time vs returning customers. Below the minimums it says so.
  behaviour_report(df)       customer behaviour (repeat purchases, spending, category interests, engagement,
                             first-time vs returning) from verified activity only. Works with any amount of
                             data; it describes, it does not segment with ML.
  drift_report(ref, cur, features)  population stability index per feature between two periods.

All inputs come from a database export (GENUINE_CUSTOMER rows only).
"""

import numpy as np
import pandas as pd

# Before the uplift is judged at all (per variant)
REC_MIN = {"impressions": 1000, "purchase_known": 500, "purchases": 30}
PSI_WARN, PSI_ALERT = 0.10, 0.25


def _rate(s):
    return round(float(s.mean()), 4) if len(s) else None


def _boot_uplift(df, col, B=500, seed=0):
    """Personalised minus control rate of `col`, resampling whole customers (their rows stay together)."""
    rng = np.random.default_rng(seed)
    custs = df["customer_id"].unique()
    by = {c: g for c, g in df.groupby("customer_id")}
    diffs = []
    for _ in range(B):
        s = pd.concat([by[c] for c in rng.choice(custs, len(custs))])
        p, c = s.loc[s["variant"] == "PERSONALISED", col], s.loc[s["variant"] == "CONTROL", col]
        if len(p) and len(c):
            diffs.append(p.mean() - c.mean())
    return [round(float(np.quantile(diffs, 0.025)), 4), round(float(np.quantile(diffs, 0.975)), 4)] if diffs else None


def recommendation_report(df):
    rep = {"rows": int(len(df)), "lists": int(df["list_id"].nunique()) if len(df) else 0}
    if not len(df):
        return {**rep, "status": "NO_DATA", "note": "no recommendation impressions from genuine customers yet"}
    known = df[df["purchased_7d"] >= 0]
    per = {}
    for v in ("PERSONALISED", "CONTROL"):
        d, k = df[df["variant"] == v], known[known["variant"] == v]
        per[v] = {"impressions": int(len(d)), "click_through": _rate(d["clicked"]), "purchase_known": int(len(k)),
                  "purchases": int(k["purchased_7d"].sum()), "purchase_rate_7d": _rate(k["purchased_7d"]),
                  "personal_basis_share": _rate(d["basis"] == "personal")}
    rep["variants"] = per
    short = [f"{v}: {m} {per[v][m] if m != 'purchases' else per[v]['purchases']} < {need}"
             for v in per for m, need in REC_MIN.items() if per[v][m] < need]
    rep["click_uplift"] = round((per["PERSONALISED"]["click_through"] or 0) - (per["CONTROL"]["click_through"] or 0), 4)
    rep["click_uplift_95ci"] = _boot_uplift(df, "clicked")
    if len(known):
        rep["purchase_uplift"] = round((per["PERSONALISED"]["purchase_rate_7d"] or 0) - (per["CONTROL"]["purchase_rate_7d"] or 0), 4)
        rep["purchase_uplift_95ci"] = _boot_uplift(known, "purchased_7d")
    # Exposure and diversity
    shown = df.groupby("event_id").size().sort_values()
    share = shown / shown.sum()
    gini = float(1 - 2 * np.sum(np.cumsum(share.to_numpy()) / len(share)) + 1 / len(share)) if len(share) else None
    rep["exposure"] = {"distinct_events": int(len(shown)), "exposure_gini": round(gini, 4) if gini is not None else None,
                       "new_event_share": _rate(df["is_new_event"]), "exploration_slot_ctr": _rate(df.loc[df["exploration"] == 1, "clicked"]),
                       "lower_popularity_share": _rate(df["popularity_rank"] > df["popularity_rank"].median())}
    rep["first_time_vs_returning"] = {name: {"impressions": int(len(g)), "click_through": _rate(g["clicked"]),
                                             "purchase_rate_7d": _rate(g.loc[g["purchased_7d"] >= 0, "purchased_7d"])}
                                      for name, g in (("first_time", df[df["first_time"] == 1]), ("returning", df[df["first_time"] == 0]))}
    rep["status"] = "NOT_ENOUGH_DATA" if short else "MEASURED"
    rep["short"] = short
    ci = rep.get("purchase_uplift_95ci")
    rep["conclusion"] = ("not enough data to judge whether personalisation improves purchases" if short
                         else "personalised lists improve purchases (95% interval above 0)" if ci and ci[0] > 0
                         else "no clear purchase improvement over the non-personalised control")
    return rep


def behaviour_report(df):
    rep = {"customers": int(len(df))}
    if not len(df):
        return {**rep, "status": "NO_DATA", "note": "no genuine customers yet"}
    buyers = df[df["verified_orders"] > 0]
    rep.update(
        status="DESCRIBED",
        buyers=int(len(buyers)),
        repeat_purchase_rate=_rate(buyers["repeat_customer"]) if len(buyers) else None,
        first_time_buyers=int((buyers["verified_orders"] == 1).sum()), returning_buyers=int((buyers["verified_orders"] > 1).sum()),
        spend={"total": round(float(buyers["verified_spend"].sum()), 2), "median_per_buyer": round(float(buyers["verified_spend"].median()), 2) if len(buyers) else None,
               "p90_per_buyer": round(float(buyers["verified_spend"].quantile(0.9)), 2) if len(buyers) else None},
        top_categories=buyers["top_category"].value_counts().head(5).to_dict() if len(buyers) else {},
        multi_category_share=_rate(buyers["categories_bought"] > 1) if len(buyers) else None,
        engagement={"median_visits": float(df["visits"].median()), "searchers_share": _rate(df["searches"] > 0),
                    "wishlist_users_share": _rate(df["wishlists"] > 0), "browse_only_share": _rate(df["verified_orders"] == 0)},
        median_days_first_to_last_purchase=float(buyers.loc[buyers["repeat_customer"] == 1, "days_first_to_last_purchase"].median()) if (buyers["repeat_customer"] == 1).any() else None,
    )
    return rep


def _psi(ref, cur, bins=10):
    ref, cur = pd.Series(ref).dropna(), pd.Series(cur).dropna()
    if not len(ref) or not len(cur):
        return None
    if ref.dtype == object or cur.dtype == object:
        cats = sorted(set(ref.astype(str)) | set(cur.astype(str)))
        r = ref.astype(str).value_counts(normalize=True).reindex(cats, fill_value=0).to_numpy()
        c = cur.astype(str).value_counts(normalize=True).reindex(cats, fill_value=0).to_numpy()
    else:
        edges = np.unique(np.quantile(ref, np.linspace(0, 1, bins + 1)))
        if len(edges) < 2:
            return 0.0 if (cur == ref.iloc[0]).all() else None
        edges[0], edges[-1] = -np.inf, np.inf
        r = np.histogram(ref, edges)[0] / len(ref)
        c = np.histogram(cur, edges)[0] / len(cur)
    r, c = np.clip(r, 1e-4, None), np.clip(c, 1e-4, None)
    return round(float(np.sum((c - r) * np.log(c / r))), 4)


def drift_report(ref, cur, features):
    """PSI per feature (> 0.10 watch, > 0.25 drift). ref / cur: DataFrames of two periods."""
    out = {f: _psi(ref[f], cur[f]) for f in features if f in ref and f in cur}
    flagged = {f: v for f, v in out.items() if v is not None and v > PSI_ALERT}
    return {"psi": out, "drifted": sorted(flagged), "watch": sorted(f for f, v in out.items() if v is not None and PSI_WARN < v <= PSI_ALERT),
            "reference_rows": int(len(ref)), "current_rows": int(len(cur))}


def time_drift(df, features, ts="ts"):
    """Drift between the oldest 70% and the newest 15% of one dataset (the periods a candidate trains and is tested on)."""
    if len(df) < 20:
        return {"status": "NOT_ENOUGH_DATA", "rows": int(len(df))}
    d = df.sort_values(ts)
    n = len(d)
    return {"status": "MEASURED", **drift_report(d.iloc[: int(n * 0.7)], d.iloc[int(n * 0.85):], features)}
