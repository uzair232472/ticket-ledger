"""
Baselines each model must beat - the rules the app uses today, or the AI strategy's stated baseline.
Everything here is "as of" each row's time: history only counts outcomes already known then.

  intent       current Node rule (intentAnalyticsService.getEventIntentAnalytics):
               40 +15 (3+ views) +20 (seat selected) +25 (checkout started), 10..99.
               Its "-10 if abandoned" and "95 if bought" terms use the outcome itself, so they are left out.
  abandonment  the same rule turned into a risk: 100 - intent rule (higher = more likely to abandon).
  fraud        current server rules (mlService.checkFraudRisk fallback):
               10 +55 (checkout < 2.5 s) +25 (> 150 clicks/min) +20 (6+ rapid seat attempts);
               score >= 45 is flagged for review.
  demand       strategy: average 48-hour sell-through of comparable past events
               (same type and city -> same type -> all) x capacity; range = their 10th-90th percentile.
  attendance   strategy: tickets sold x average show rate of past events (same type -> all).
               Also reported: the current fixed-percentage rule in organizerDashboardService.
  crowd        strategy: average arrival curve of similar past events (same type -> all)
               x expected attendees (tickets sold x past show rate) x the gate's share of capacity.
"""

from collections import defaultdict, deque

import numpy as np
import pandas as pd

MIN_GROUP = 5            # past events needed before a narrower comparison group is used


def intent_rule(df):
    s = 40.0 + 15.0 * (df["event_views"] >= 3) + 20.0 * (df["seat_selections"] >= 1) + 25.0 * (df["checkout_started"] == 1)
    return np.clip(s.to_numpy(dtype=float), 10, 99)


def abandonment_rule(df):
    return 100.0 - intent_rule(df)


def fraud_rule(df):
    s = (10.0 + 55.0 * (df["checkout_duration_seconds"] < 2.5) + 25.0 * (df["clicks_per_minute"] > 150)
         + 20.0 * (df["rapid_seat_attempts"] >= 6))
    s = np.minimum(s.to_numpy(dtype=float), 100.0)
    return s, s >= 45.0


def _as_of_groups(df, known_at, keys_fn, value_fn, fallback_chain, reduce_fn):
    """Generic as-of aggregator. Walks rows in time order; an observation is added once known_at has
    passed. For each row, `reduce_fn` is applied to the values observed SO FAR in the narrowest group
    of `fallback_chain` with at least MIN_GROUP observations (empty list if none).

    The statistic is computed immediately: returning the live list would let later observations
    (the future) change earlier rows' values."""
    order = np.argsort(df["ts"].to_numpy(), kind="stable")
    pending = deque(sorted(range(len(df)), key=lambda i: known_at[i]))
    store = defaultdict(list)
    out = [None] * len(df)
    ts = df["ts"].to_numpy()
    for i in order:
        while pending and known_at[pending[0]] <= ts[i]:
            j = pending.popleft()
            for key in keys_fn(j):
                store[key].append(value_fn(j))
        chosen = []
        for key in fallback_chain(i):
            vals = store.get(key, [])
            if len(vals) >= MIN_GROUP:
                chosen = vals
                break
        out[i] = reduce_fn(chosen)
    return out


def demand_baseline(df):
    """Returns (prediction, low, high) in tickets for each event row."""
    known_at = (df["ts"] + pd.Timedelta(days=2)).to_numpy()
    fill = (df["sales_48h"] / df["venue_capacity"]).to_numpy()
    etype, city, country = df["event_type"].to_numpy(), df["city"].to_numpy(), df["country"].to_numpy()
    keys = lambda j: [("tc", etype[j], city[j], country[j]), ("t", etype[j]), ("all",)]
    chain = lambda i: [("tc", etype[i], city[i], country[i]), ("t", etype[i]), ("all",)]
    stats = lambda h: (np.mean(h), np.percentile(h, 10), np.percentile(h, 90)) if len(h) else (0.4, 0.1, 0.8)
    hist = np.array(_as_of_groups(df, known_at, keys, lambda j: fill[j], chain, stats))
    cap = df["venue_capacity"].to_numpy(dtype=float)
    return hist[:, 0] * cap, hist[:, 1] * cap, hist[:, 2] * cap


def attendance_show_rate(df, min_tickets=200):
    """As-of average show rate (per ticket) of past finished events: same type, else all types; until
    there are `min_tickets` of history, today's fixed-percentage rule (so day one behaves exactly as the
    app does now). Running totals, so it stays fast on large exports."""
    fallback = attendance_current_rule(df)
    known_at = (pd.to_datetime(df["event_start"], utc=True) + pd.Timedelta(hours=4)).to_numpy()
    ts = df["ts"].to_numpy()
    y = df["checked_in"].to_numpy(dtype=float)
    etype = df["event_type"].to_numpy()
    order = np.argsort(ts, kind="stable")
    pending = deque(np.argsort(known_at, kind="stable"))
    s, n = defaultdict(float), defaultdict(int)
    out = np.empty(len(df))
    for i in order:
        while pending and known_at[pending[0]] <= ts[i]:
            j = pending.popleft()
            for key in (etype[j], "__all__"):
                s[key] += y[j]
                n[key] += 1
        for key in (etype[i], "__all__"):
            if n[key] >= min_tickets:
                out[i] = s[key] / n[key]
                break
        else:
            out[i] = fallback[i]
    return out


def attendance_current_rule(df):
    """organizerDashboardService today: fixed % by type, +2 points in Lahore/Karachi, 65..98."""
    base = df["event_type"].map({"CRICKET_MATCH": 92.4, "MUSIC_CONCERT": 86.8, "MUSIC_FESTIVAL": 86.8,
                                 "KABADDI": 89.1}).fillna(88.5)
    base = base + 2.0 * df["city"].isin(["Lahore", "Karachi"])
    return np.clip(base.to_numpy(dtype=float), 65, 98) / 100.0


def crowd_features_and_baseline(df):
    """Adds gate_capacity_share and baseline_scans (as-of arrival curves). Returns a new DataFrame."""
    df = df.copy()
    gates = df.drop_duplicates("gate_id")[["event_id", "gate_id", "gate_capacity_per_hour"]]
    event_capacity = gates.groupby("event_id")["gate_capacity_per_hour"].sum()
    df["gate_capacity_share"] = df["gate_capacity_per_hour"] / df["event_id"].map(event_capacity)
    bins = np.sort(df["minutes_from_start"].unique())
    bin_pos = {b: k for k, b in enumerate(bins)}

    # One record per event: start time, type, tickets sold, scans per bin
    df["_bin"] = df["minutes_from_start"].map(bin_pos)
    per_bin = df.pivot_table(index="event_id", columns="_bin", values="scans", aggfunc="sum", fill_value=0)
    meta = df.groupby("event_id").agg(start=("ts", "min"), etype=("event_type", "first"), sold=("tickets_sold", "first"))
    meta["start"] = meta["start"] - pd.Timedelta(minutes=int(bins[0]))     # first slot is bins[0] minutes from start
    meta = meta.sort_values("start", kind="stable")
    totals = per_bin.sum(axis=1)

    curve_sum = defaultdict(lambda: np.zeros(len(bins)))
    show_sum = defaultdict(float)
    count = defaultdict(int)
    pending = deque(meta.index[np.argsort((meta["start"] + pd.Timedelta(days=1)).to_numpy(), kind="stable")])
    known = (meta["start"] + pd.Timedelta(days=1))
    default_curve = np.full(len(bins), 1.0 / len(bins))
    ev_curve, ev_show = {}, {}
    for ev, row in meta.iterrows():
        while pending and known[pending[0]] <= row["start"]:
            j = pending.popleft()
            tot = totals[j]
            if tot > 0:
                shares = per_bin.loc[j].to_numpy(dtype=float) / tot
                for key in (("t", meta.at[j, "etype"]), ("all",)):
                    curve_sum[key] += shares
                    show_sum[key] += tot / max(meta.at[j, "sold"], 1)
                    count[key] += 1
        for key in (("t", row["etype"]), ("all",)):
            if count[key] >= MIN_GROUP:
                ev_curve[ev] = curve_sum[key] / count[key]
                ev_show[ev] = show_sum[key] / count[key]
                break
        else:
            ev_curve[ev], ev_show[ev] = default_curve, 0.85

    curve_val = np.array([ev_curve[e][b] for e, b in zip(df["event_id"], df["_bin"])])
    show_val = df["event_id"].map(ev_show).to_numpy()
    df["baseline_scans"] = df["tickets_sold"] * show_val * curve_val * df["gate_capacity_share"]
    return df.drop(columns="_bin")
