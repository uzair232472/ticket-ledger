"""
Validates the training datasets in data/ (or --data DIR) before any training run.

Checks: manifest and file hashes, exact columns, IDs present and unique, timestamps valid and in
the right order (nothing bought after the event, no scan outside the event), labels in range,
"as of" history columns consistent, links between datasets, no leftover formula-label columns,
and enough rare cases (buyers, abandons, frauds, no-shows) to train and test on.

Exit code 0 = all checks passed, 1 = at least one failed.

Usage:
    python scripts/validate_datasets.py [--data data]
"""

import argparse
import hashlib
import json
import os
import sys

import numpy as np
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCHEMA = {
    "behavior_sequences": ["session_id", "customer_id", "event_id", "ts", "event_type", "city", "country",
                           "event_views", "seat_selections", "checkout_started", "session_duration_seconds",
                           "currency", "ticket_price", "ticket_price_rel", "min_price", "tier_count",
                           "hours_since_sales_open", "days_until_event", "customer_prior_sessions",
                           "customer_prior_purchases", "prior_sessions_this_event", "account_age_days",
                           "purchased_7d", "checkout_abandoned"],
    "fraud_purchases": ["order_id", "customer_id", "event_id", "ts", "event_type", "city", "country",
                        "tickets_requested", "currency", "total_amount", "unit_price_rel", "payment_method",
                        "checkout_duration_seconds", "clicks_per_minute", "rapid_seat_attempts",
                        "time_on_seatmap_seconds", "device_switches", "account_age_days", "customer_prior_orders",
                        "orders_last_24h", "failed_payments_30d", "prior_resale_listings",
                        "hours_since_sales_open", "is_fraud"],
    "event_demand": ["event_id", "organizer_id", "ts", "event_start", "event_type", "city", "country", "timezone",
                     "venue_capacity", "tier_count", "currency", "min_price", "avg_price", "max_price",
                     "min_price_rel", "avg_price_rel", "max_price_rel", "day_of_week", "start_hour",
                     "sales_open_hour", "lead_days", "start_month", "organizer_past_events",
                     "organizer_past_sell_through_48h", "sales_48h"],
    "attendance_no_show": ["ticket_id", "customer_id", "event_id", "ts", "event_start", "event_type", "city",
                           "country", "day_of_week", "start_hour", "tier_rank", "currency", "ticket_price",
                           "ticket_price_rel", "tickets_in_order", "days_before_event_purchased", "is_transferred",
                           "is_resold", "customer_prior_tickets", "customer_prior_attended",
                           "customer_prior_no_shows", "event_tickets_sold", "sample_weight", "checked_in"],
    "crowd_flow": ["event_id", "gate_id", "ts", "minutes_from_start", "event_type", "city", "country",
                   "day_of_week", "start_hour", "tickets_sold", "gate_count", "gate_capacity_per_hour", "scans"],
}
PRICE_REL = {"behavior_sequences": ["ticket_price_rel"], "fraud_purchases": ["unit_price_rel"],
             "event_demand": ["min_price_rel", "avg_price_rel", "max_price_rel"], "attendance_no_show": ["ticket_price_rel"]}
ROW_ID = {"behavior_sequences": ["session_id"], "fraud_purchases": ["order_id"], "event_demand": ["event_id"],
          "attendance_no_show": ["ticket_id"], "crowd_flow": ["gate_id", "ts"]}
# Columns that may be empty: organizer history before their first finished event
NULLABLE = {"event_demand": {"organizer_past_sell_through_48h"}}
# Columns from the old formula datasets that must never come back (labels or things the app can't record)
FORBIDDEN = {"purchase_intent_score", "fraud_score", "no_show_risk", "weather_condition", "marketing_score",
             "popularity_score", "ip_city_mismatch", "distance_km", "predicted_48h_sales", "expected_revenue_pkr",
             "demand_level"}
# Minimum rare cases per 1.0 of scale, so train/validation/test each get enough
MIN_CASES = {
    ("behavior_sequences", "purchased_7d", 1): 5000, ("behavior_sequences", "purchased_7d", 0): 5000,
    ("behavior_sequences", "checkout_abandoned", 1): 2000, ("behavior_sequences", "checkout_abandoned", 0): 2000,
    ("fraud_purchases", "is_fraud", 1): 1000,
    ("attendance_no_show", "checked_in", 0): 3000,
}
MIN_EVENTS = {"event_demand": 3000, "attendance_no_show": 600, "crowd_flow": 600}


class Report:
    def __init__(self):
        self.failed = 0
        self.passed = 0

    def check(self, ok, what, detail=""):
        if ok:
            self.passed += 1
        else:
            self.failed += 1
            print(f"  FAIL  {what}{(': ' + detail) if detail else ''}")
        return ok


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(BASE_DIR, "data"))
    args = ap.parse_args()
    r = Report()

    mpath = os.path.join(args.data, "manifest.json")
    if not r.check(os.path.exists(mpath), "manifest.json exists"):
        return 1
    with open(mpath) as f:
        manifest = json.load(f)
    scale = float(manifest.get("scale", 1.0))
    print(f"Validating {args.data} (source {manifest.get('source')}, scale {scale})")
    r.check(manifest.get("source") in ("synthetic-v0", "db-export"), "known source tag", str(manifest.get("source")))
    hist_from = pd.Timestamp(manifest["history"]["from"]).tz_convert("UTC")
    hist_to = pd.Timestamp(manifest["history"]["to"]).tz_convert("UTC")

    d = {}
    for name, cols in SCHEMA.items():
        path = os.path.join(args.data, f"{name}.csv")
        if not r.check(os.path.exists(path), f"{name}.csv exists"):
            continue
        r.check(sha256(path) == manifest["files"][name]["sha256"], f"{name}: file matches manifest hash")
        df = pd.read_csv(path)
        d[name] = df
        r.check(list(df.columns) == cols, f"{name}: exact columns", f"got {list(df.columns)}")
        r.check(not (set(df.columns) & FORBIDDEN), f"{name}: no formula-label columns", str(set(df.columns) & FORBIDDEN))
        r.check(len(df) == manifest["files"][name]["rows"], f"{name}: row count matches manifest")
        allowed_null = NULLABLE.get(name, set())
        nulls = {c: int(n) for c, n in df.isna().sum().items() if n and c not in allowed_null}
        r.check(not nulls, f"{name}: no missing values", str(nulls))
        r.check(not df.duplicated(ROW_ID[name]).any(), f"{name}: row IDs unique")
        for c in [c for c in df.columns if c in ("ts", "event_start")]:
            r.check(df[c].astype(str).str.endswith("Z").all(), f"{name}: {c} is UTC (ends with Z)")
            df[c] = pd.to_datetime(df[c], errors="coerce", utc=True)
            r.check(df[c].notna().all(), f"{name}: {c} parses as a timestamp")
        r.check(df["country"].astype(str).str.fullmatch(r"[A-Z]{2}").all(), f"{name}: country is a 2-letter ISO code")
        if "currency" in df:
            r.check(df["currency"].astype(str).str.fullmatch(r"[A-Z]{3}").all(), f"{name}: currency is a 3-letter ISO code")
            r.check((df.groupby("country")["currency"].nunique() == 1).all(), f"{name}: one currency per country")
        for c in PRICE_REL.get(name, []):
            r.check((df[c] > 0).all(), f"{name}: {c} positive")
        r.check(((df["ts"] >= hist_from - pd.Timedelta(days=1)) & (df["ts"] <= hist_to + pd.Timedelta(hours=2))).all(),
                f"{name}: ts within the exported history")
        # The most recent period is what time-based tests use: no dataset may stop early or leave a gap
        latest = {"behavior_sequences": hist_to - pd.Timedelta(days=7)}.get(name, hist_to)
        r.check(df["ts"].max() >= latest - pd.Timedelta(days=21), f"{name}: covers the latest weeks",
                f"last row {df['ts'].max()}")
        months = df["ts"].dt.tz_localize(None).dt.to_period("M")
        expected = pd.period_range(months.min(), months.max(), freq="M")
        missing = sorted(set(expected) - set(months))
        # An empty month means a gap only when months normally hold plenty of events (small test runs
        # can have a quiet month by chance)
        per_month = df["event_id"].nunique() / len(expected)
        if per_month >= 10:
            r.check(not missing, f"{name}: no empty months", str(missing))
        print(f"  ok    {name}.csv  {len(df):,} rows")

    if len(d) != len(SCHEMA):
        print(f"\n{r.failed} check(s) failed")
        return 1

    ev = d["event_demand"].set_index("event_id")
    bs, fp, at, cf = d["behavior_sequences"], d["fraud_purchases"], d["attendance_no_show"], d["crowd_flow"]

    # ---- event_demand
    r.check((ev["sales_48h"] >= 0).all() and (ev["sales_48h"] <= ev["venue_capacity"]).all(), "demand: 0 <= sales_48h <= capacity")
    r.check((ev["event_start"] > ev["ts"]).all(), "demand: event starts after sales open")
    r.check((ev["ts"] + pd.Timedelta(days=2) <= hist_to + pd.Timedelta(minutes=1)).all(), "demand: every 48 h window is complete")
    # Local-time features must match UTC time + the venue's time zone
    local = pd.Series([t.tz_convert(z) for t, z in zip(ev["event_start"], ev["timezone"])], index=ev.index)
    r.check((local.map(lambda t: t.hour) == ev["start_hour"]).all(), "demand: start_hour is local time of event_start")
    r.check((local.map(lambda t: t.day_name()) == ev["day_of_week"]).all(), "demand: day_of_week is local day of event_start")
    r.check((ev["min_price_rel"] <= ev["avg_price_rel"]).all() and (ev["avg_price_rel"] <= ev["max_price_rel"]).all(),
            "demand: relative prices keep min <= avg <= max")
    r.check((ev["min_price"] <= ev["avg_price"]).all() and (ev["avg_price"] <= ev["max_price"]).all(), "demand: min <= avg <= max price")
    hist_ok = ev["organizer_past_sell_through_48h"].isna() == (ev["organizer_past_events"] == 0)
    r.check(hist_ok.all(), "demand: organizer history empty only for first events")
    r.check(ev["organizer_past_sell_through_48h"].dropna().between(0, 1).all(), "demand: past sell-through is a share")

    # ---- behavior_sequences
    r.check(bs["purchased_7d"].isin([0, 1]).all(), "sessions: purchased_7d is 0/1")
    r.check(((bs["checkout_abandoned"] == -1) == (bs["checkout_started"] == 0)).all(),
            "sessions: checkout_abandoned is -1 exactly when no checkout")
    r.check(((bs["checkout_started"] == 0) | (bs["seat_selections"] > 0)).all(), "sessions: checkout only after a seat selection")
    r.check((bs["event_views"] >= 1).all(), "sessions: at least one view")
    r.check(bs["event_id"].isin(ev.index).all(), "sessions: every event exists in event_demand")
    e = ev.reindex(bs["event_id"])
    r.check((bs["ts"].to_numpy() >= e["ts"].to_numpy()).all(), "sessions: no session before sales open")
    r.check((bs["ts"].to_numpy() < e["event_start"].to_numpy()).all(), "sessions: no session after the event started")
    r.check((bs["ts"] <= hist_to - pd.Timedelta(days=7)).all(), "sessions: 7-day purchase labels have matured")
    r.check((bs["account_age_days"] >= 0).all(), "sessions: account exists before the session")
    first = bs.sort_values("ts").groupby("customer_id").head(1)
    r.check((first["customer_prior_sessions"] == 0).all() and (first["customer_prior_purchases"] == 0).all(),
            "sessions: a customer's first session has no history")
    mono = bs.sort_values(["customer_id", "ts"]).groupby("customer_id")["customer_prior_sessions"].diff().dropna()
    r.check((mono >= 0).all(), "sessions: history counts never go down")

    # ---- fraud_purchases
    r.check(fp["is_fraud"].isin([0, 1]).all(), "orders: is_fraud is 0/1")
    r.check(fp["tickets_requested"].between(1, 10).all(), "orders: 1-10 tickets (app limit)")
    r.check((fp["total_amount"] > 0).all(), "orders: positive amount")
    r.check((fp["hours_since_sales_open"] >= 0).all(), "orders: no order before sales open")
    known = fp["event_id"].isin(ev.index)
    e = ev.reindex(fp.loc[known, "event_id"])
    r.check((fp.loc[known, "ts"].to_numpy() < e["event_start"].to_numpy()).all(), "orders: no order after the event started")
    r.check(known.mean() > 0.99, "orders: events exist in event_demand", f"{known.mean():.4f}")
    r.check((fp["orders_last_24h"] <= fp["customer_prior_orders"]).all() and (fp["orders_last_24h"] >= 0).all(),
            "orders: last-24h count within prior orders")
    r.check((fp["account_age_days"] >= 0).all(), "orders: account exists before the order")

    # ---- one sign-up date per customer across sessions and orders (ts - account age)
    signup = pd.concat([
        pd.DataFrame({"c": bs["customer_id"], "s": bs["ts"] - pd.to_timedelta(bs["account_age_days"], unit="D")}),
        pd.DataFrame({"c": fp["customer_id"], "s": fp["ts"] - pd.to_timedelta(fp["account_age_days"], unit="D")}),
    ])
    spread = signup.groupby("c")["s"].agg(lambda s: (s.max() - s.min()) / pd.Timedelta(days=1))
    r.check((spread <= 0.15).all(), "customers: one consistent sign-up date", f"max spread {spread.max():.2f} days")

    # ---- attendance_no_show
    r.check(at["checked_in"].isin([0, 1]).all(), "tickets: checked_in is 0/1")
    r.check(at["event_id"].isin(ev.index).all(), "tickets: every event exists in event_demand")
    r.check(((at["event_start"] - at["ts"]) == pd.Timedelta(hours=24)).all(), "tickets: predicted 24 h before start")
    r.check((at["event_start"] + pd.Timedelta(hours=4) <= hist_to).all(), "tickets: events finished before the export")
    r.check((at["days_before_event_purchased"] >= 1).all(), "tickets: bought before the prediction time")
    r.check((at["customer_prior_no_shows"] >= 0).all() and
            (at["customer_prior_attended"] + at["customer_prior_no_shows"] == at["customer_prior_tickets"]).all(),
            "tickets: attended + no-shows = prior tickets")
    r.check((at["event_tickets_sold"] >= at.groupby("event_id")["ticket_id"].transform("count")).all(),
            "tickets: sample no larger than tickets sold")

    # ---- crowd_flow
    r.check((cf["scans"] >= 0).all(), "crowd: scans not negative")
    r.check(cf["event_id"].isin(at["event_id"]).all(), "crowd: events are finished events with tickets")
    limit = (cf["gate_capacity_per_hour"] / 12 * 1.1).astype(int)
    r.check((cf["scans"] <= limit).all(), "crowd: no gate scans more than its capacity per 5 minutes")
    starts = ev["event_start"].reindex(cf["event_id"]).to_numpy()
    r.check(((cf["ts"].to_numpy() - starts) == (cf["minutes_from_start"].to_numpy() * np.timedelta64(1, "m"))).all(),
            "crowd: slot time = event start + minutes_from_start")
    per_event = cf.groupby("event_id")["scans"].sum()
    r.check((per_event <= cf.groupby("event_id")["tickets_sold"].first()).all(), "crowd: scans per event <= tickets sold")
    r.check((cf.groupby("gate_id")["gate_count"].nunique() == 1).all(), "crowd: gate metadata consistent")

    # ---- enough cases to train and test on
    print("\nRare cases (need enough in every split):")
    for (name, col, val), need in MIN_CASES.items():
        have = int((d[name][col] == val).sum())
        need = int(need * scale)
        print(f"  {name}.{col} = {val}: {have:,} (minimum {need:,})")
        r.check(have >= need, f"enough {name}.{col} = {val}", f"{have} < {need}")
    for name, need in MIN_EVENTS.items():
        have = int(d[name]["event_id"].nunique())
        need = int(need * scale)
        print(f"  {name}: {have:,} separate events (minimum {need:,})")
        r.check(have >= need, f"enough events in {name}", f"{have} < {need}")

    print(f"\n{r.passed} checks passed, {r.failed} failed")
    return 0 if r.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
