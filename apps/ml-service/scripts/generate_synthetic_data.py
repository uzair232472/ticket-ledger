"""
TicketLedger - v0 dataset generator (simulated platform history)

Builds one linked, time-ordered simulated world - organizers, events, customers, sessions, orders,
tickets and gate scans - and writes five datasets in the same shape the production exporter will
produce from the client's database:

    behavior_sequences.csv   one row per visitor session (purchase intent + abandonment)
    fraud_purchases.csv      one row per checkout attempt (fraud flag-for-review)
    event_demand.csv         one row per event at sales open (48-hour demand)
    attendance_no_show.csv   one row per ticket, 24 h before the event (attendance)
    crowd_flow.csv           one row per gate per 5-minute slot (crowd flow)
    checkout_abandonment.csv one row per started checkout (checkout-start abandonment)     [2.2.0]
    demand_hourly.csv        one row per event per sampled hour on sale (next-24-hour sales) [2.2.0]

Version 2.2.0 adds, on a SEPARATE random stream (seed + 1000) so that behavior_sequences, event_demand and
crowd_flow stay byte-identical to 2.1.0:
  * harder fraud in fraud_purchases: card-testing / account-takeover buyers at normal human speed,
    detectable only from account and payment history (the speed rules cannot see them);
  * a larger attendance_no_show (3x the events; every crowd_flow event is kept) so the test period is
    large enough to judge the model;
  * checkout_abandonment.csv and demand_hourly.csv, shaped exactly like the database export (pseudonymous
    ids, feature_source "snapshot").

Version 2.3.0 adds three account-link columns to fraud_purchases on a third random stream (seed + 2000), so every
other file stays byte-identical to 2.2.0: linked_accounts (other accounts that shared a phone number or browser
before the order), linked_accounts_confirmed_fraud (of those, accounts with fraud confirmed by then) and
linked_orders_same_event_24h. ASSUMPTION: bot rings often share devices and wallets (65% of bot accounts are in
a ring); 6% of legitimate customers share a family phone or browser; 2% of orders get an unrelated link.

Rules this generator follows:
  * Every feature column is something the app can compute from its own tables at prediction time
    ("as of" the row's `ts`). Nothing from after `ts` leaks into a feature.
  * Labels come from simulated outcomes, not from a formula over the exported features: each
    outcome also depends on hidden factors (customer keenness, price sensitivity, reliability, event
    popularity, day-of shocks, sophisticated bots) that are NOT exported. Models therefore cannot
    score perfectly, as with real data.
  * Rows carry IDs (event, customer, session, order, ticket, gate) and timestamps so training can use
    time-based splits and keep customers/events from leaking across train and test.

This is SYNTHETIC data (source tag "synthetic-v0"). It trains the starter (v0) models and tests the
pipeline. Production models are trained only on data exported from the client's database.

Usage:
    python scripts/generate_synthetic_data.py [--scale 1.0] [--seed 42] [--out data]
"""

import argparse
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from math import erf

import numpy as np
import pandas as pd

GENERATOR_VERSION = "2.3.0"
SOURCE_TAG = "synthetic-v0"

# Global-ready columns. The platform launches in Pakistan, so v0 data is Pakistan-only, but every row
# carries its country and currency, prices also come relative to the country's typical price, and
# timestamps are UTC while hour/weekday features are in the venue's local time - the same shape the
# exporter produces when other countries join.
COUNTRY = "PK"
CURRENCY = "PKR"
TIMEZONE = "Asia/Karachi"
UTC_OFFSET_H = 5          # Pakistan has no daylight saving time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Simulated history: three years. Data is "exported" at END, so outcomes after END are unknown.
START = datetime(2023, 1, 1)
END = datetime(2025, 12, 31, 23, 59)

HOUR = 3600.0
DAY = 86400.0

# ---------------------------------------------------------------------------------------------
# Domain constants (Pakistani event ticketing; event types match the app's EventType enum)
# ---------------------------------------------------------------------------------------------
CITIES = ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Multan", "Peshawar", "Faisalabad", "Quetta"]
CITY_WEIGHTS = np.array([0.30, 0.30, 0.15, 0.10, 0.05, 0.04, 0.04, 0.02])

DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# capacity range, base price range (PKR), start hours, demand base (logit), show-rate shift (logit),
# arrival mean / sd (minutes relative to start; negative = before start)
TYPE_PROFILE = {
    "CRICKET_MATCH":     dict(w=0.30, cap=(15000, 35000), price=(800, 4000),  hours=[14, 19, 20], demand=0.6,  show=0.35,  arr=(-50, 35)),
    "MUSIC_CONCERT":     dict(w=0.18, cap=(1500, 15000),  price=(2000, 8000), hours=[19, 20, 21], demand=0.3,  show=0.10,  arr=(-25, 30)),
    "MUSIC_FESTIVAL":    dict(w=0.08, cap=(5000, 25000),  price=(3000, 12000), hours=[16, 17, 18], demand=0.1, show=-0.05, arr=(-10, 45)),
    "FOOTBALL_MATCH":    dict(w=0.07, cap=(5000, 20000),  price=(500, 2500),  hours=[16, 19, 20], demand=-0.2, show=0.15,  arr=(-40, 30)),
    "KABADDI":           dict(w=0.08, cap=(3000, 12000),  price=(300, 1500),  hours=[15, 19, 20], demand=-0.1, show=0.20,  arr=(-35, 30)),
    "BOXING":            dict(w=0.04, cap=(1500, 8000),   price=(1500, 6000), hours=[19, 20, 21], demand=-0.3, show=0.10,  arr=(-30, 30)),
    "HOCKEY_MATCH":      dict(w=0.04, cap=(3000, 12000),  price=(300, 1500),  hours=[15, 19],     demand=-0.5, show=0.05,  arr=(-35, 30)),
    "QAWWALI":           dict(w=0.07, cap=(800, 5000),    price=(1000, 5000), hours=[20, 21, 22], demand=0.0,  show=0.10,  arr=(-15, 35)),
    "THEATRE":           dict(w=0.08, cap=(300, 1500),    price=(1000, 4000), hours=[18, 19, 20], demand=-0.2, show=0.25,  arr=(-20, 15)),
    "CONFERENCE":        dict(w=0.06, cap=(200, 3000),    price=(2000, 15000), hours=[9, 10, 14], demand=-0.6, show=-0.60, arr=(-20, 40)),
}
EVENT_TYPES = list(TYPE_PROFILE.keys())
TYPE_WEIGHTS = np.array([TYPE_PROFILE[t]["w"] for t in EVENT_TYPES])
TYPE_WEIGHTS = TYPE_WEIGHTS / TYPE_WEIGHTS.sum()

TIER_MULTIPLIERS = [1.0, 1.8, 3.0, 5.0]
PAYMENT_METHODS = ["JAZZCASH", "EASYPAISA", "STRIPE"]


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def iso(seconds_from_start):
    """Seconds since START (simulated in local Pakistan time) -> UTC ISO timestamps, minute precision,
    e.g. '2024-03-14T14:32Z'. The app stores UTC; local hour/weekday are separate feature columns."""
    base = np.datetime64(START, "s") - np.timedelta64(UTC_OFFSET_H, "h")
    t = base + np.asarray(seconds_from_start, dtype="int64").astype("timedelta64[s]")
    return np.char.add(np.datetime_as_string(t, unit="m"), "Z")


def weekday_of(seconds_from_start):
    return ((np.asarray(seconds_from_start) // DAY).astype(int) + START.weekday()) % 7


def month_of(seconds_from_start):
    days = (np.asarray(seconds_from_start) // DAY).astype("int64")
    return (np.datetime64(START, "D") + days.astype("timedelta64[D]")).astype("datetime64[M]").astype(int) % 12 + 1


def as_of_count(df_points, key, ts_col, df_events, ev_ts_col, weight_col=None):
    """For each point row: number (or weighted sum) of df_events rows with the same key and an
    event time strictly before the point's time. Leakage-safe history features."""
    ev = df_events[[key, ev_ts_col] + ([weight_col] if weight_col else [])].sort_values([key, ev_ts_col], kind="stable")
    out = np.zeros(len(df_points))
    pts = df_points[[key, ts_col]].reset_index()
    groups = dict(tuple(ev.groupby(key, sort=False)))
    for k, g in pts.groupby(key, sort=False):
        if k not in groups:
            continue
        e = groups[k]
        times = e[ev_ts_col].to_numpy()
        idx = np.searchsorted(times, g[ts_col].to_numpy(), side="left")
        if weight_col:
            cum = np.concatenate([[0.0], np.cumsum(e[weight_col].to_numpy(dtype=float))])
            out[g["index"].to_numpy()] = cum[idx]
        else:
            out[g["index"].to_numpy()] = idx
    return out


# ---------------------------------------------------------------------------------------------
# The world
# ---------------------------------------------------------------------------------------------
class World:
    def __init__(self, scale=1.0, seed=42):
        self.rng = np.random.default_rng(seed)
        self.scale = scale
        self.span = (END - START).total_seconds()
        self._organizers()
        self._events()
        self._customers()

    # -- organizers --------------------------------------------------------------------------
    def _organizers(self):
        rng = self.rng
        n = max(30, int(150 * np.sqrt(self.scale)))
        self.org_id = np.array([f"ORG{i + 1:04d}" for i in range(n)])
        self.org_city = rng.choice(len(CITIES), size=n, p=CITY_WEIGHTS)
        self.org_reputation = rng.normal(0.0, 0.45, size=n)          # hidden: reach / brand strength
        self.org_activity = rng.lognormal(0.0, 0.8, size=n)          # how many events they run

    # -- events ------------------------------------------------------------------------------
    def _events(self):
        rng = self.rng
        n = int(5000 * self.scale)
        org = rng.choice(len(self.org_id), size=n, p=self.org_activity / self.org_activity.sum())
        city = np.where(rng.random(n) < 0.8, self.org_city[org], rng.choice(len(CITIES), size=n, p=CITY_WEIGHTS))
        etype = rng.choice(len(EVENT_TYPES), size=n, p=TYPE_WEIGHTS)

        cap = np.empty(n, dtype=int)
        base_price = np.empty(n)
        start_hour = np.empty(n, dtype=int)
        for t, name in enumerate(EVENT_TYPES):
            m = etype == t
            p = TYPE_PROFILE[name]
            cap[m] = (rng.uniform(*p["cap"], size=m.sum()) // 100 * 100).astype(int)
            base_price[m] = rng.uniform(*p["price"], size=m.sum())
            start_hour[m] = rng.choice(p["hours"], size=m.sum())

        tier_count = rng.choice([1, 2, 3, 4], size=n, p=[0.15, 0.35, 0.35, 0.15])
        prices = [np.where(tier_count > i, np.round(base_price * TIER_MULTIPLIERS[i], -2), np.nan) for i in range(4)]
        prices = np.vstack(prices).T
        min_price = np.nanmin(prices, axis=1)
        max_price = np.nanmax(prices, axis=1)
        avg_price = np.round(np.nanmean(prices, axis=1), -1)

        # Sales open at a business hour; the event starts 7-60 days later
        open_day = rng.uniform(0, self.span / DAY - 12, size=n).astype(int)
        open_hour = rng.choice(np.arange(9, 23), size=n)
        sales_open = open_day * DAY + open_hour * HOUR
        lead_days = rng.integers(7, 61, size=n)
        start = (open_day + lead_days) * DAY + start_hour * HOUR

        # Hidden demand drivers
        popularity = rng.normal(0.0, 0.6, size=n)
        month = month_of(start)
        season = np.zeros(n)
        season += np.where((etype == EVENT_TYPES.index("CRICKET_MATCH")) & np.isin(month, [2, 3]), 0.45, 0.0)   # PSL season
        season += np.where(np.isin(etype, [EVENT_TYPES.index("MUSIC_FESTIVAL"), EVENT_TYPES.index("MUSIC_CONCERT")]) & np.isin(month, [11, 12, 1, 2]), 0.25, 0.0)
        season -= np.where(np.isin(month, [6, 7]), 0.25, 0.0)   # summer heat
        wd = weekday_of(start)
        weekend = np.isin(wd, [4, 5, 6]).astype(float)
        type_demand = np.array([TYPE_PROFILE[EVENT_TYPES[t]]["demand"] for t in etype])
        type_mid_price = np.array([np.mean(TYPE_PROFILE[EVENT_TYPES[t]]["price"]) for t in etype])
        type_mid_cap = np.array([np.mean(TYPE_PROFILE[EVENT_TYPES[t]]["cap"]) for t in etype])

        logit = (-0.9 + type_demand + popularity + self.org_reputation[org] + season + 0.25 * weekend
                 - 0.45 * np.log(avg_price / type_mid_price) - 0.30 * np.log(cap / type_mid_cap)
                 + rng.normal(0, 0.35, size=n))                           # day-of noise (news, rivals...)
        fill48 = 0.85 * sigmoid(logit)
        sales_48h = rng.binomial(cap, fill48)
        later = sigmoid(logit + 0.9) * 0.9
        sold_total = np.minimum(cap, sales_48h + rng.binomial(cap - sales_48h, later))

        self.ev = pd.DataFrame({
            "event_id": [f"E{i + 1:05d}" for i in range(n)],
            "org": org, "city": city, "etype": etype, "cap": cap,
            "tier_count": tier_count, "min_price": min_price, "avg_price": avg_price, "max_price": max_price,
            "sales_open": sales_open, "start": start, "start_hour": start_hour, "open_hour": open_hour,
            "lead_days": lead_days, "weekday": wd, "logit": logit,
            "sales_48h": sales_48h, "sold_total": sold_total,
        })
        self.prices = prices
        self.ev["finished"] = self.ev["start"] + 4 * HOUR < self.span
        self.ev["country"] = COUNTRY
        # Typical price in the country, known at sales open: median average price of the country's
        # events whose sales opened earlier (the event's own price for the very first one). Prices are
        # also given relative to it, so PKR, USD, AED... events are comparable.
        order = np.argsort(self.ev["sales_open"].to_numpy(), kind="stable")
        ref = np.empty(n)
        for _, idx in self.ev.iloc[order].groupby("country", sort=False).groups.items():
            pos = order[np.isin(order, idx.to_numpy())]
            prices_c = self.ev["avg_price"].to_numpy()[pos]
            med = pd.Series(prices_c).shift(1).expanding().median().to_numpy().copy()
            med[0] = prices_c[0]
            ref[pos] = med
        self.ev["ref_price"] = ref

    # -- customers ---------------------------------------------------------------------------
    def _customers(self):
        rng = self.rng
        n = int(20000 * self.scale)
        self.cu = pd.DataFrame({
            "customer_id": [f"C{i + 1:06d}" for i in range(n)],
            "city": rng.choice(len(CITIES), size=n, p=CITY_WEIGHTS),
            "signup": rng.uniform(-365 * DAY, self.span - 30 * DAY, size=n),
            "keen": rng.beta(1.3, 4.0, size=n),                 # hidden: how much they buy
            "price_sens": rng.lognormal(0.0, 0.4, size=n),       # hidden
            "reliability": rng.beta(8.0, 1.6, size=n),           # hidden: shows up when they buy
            "fav_type": rng.choice(len(EVENT_TYPES), size=n, p=TYPE_WEIGHTS),
        })
        self.cu["signup"] = np.maximum(self.cu["signup"], -365 * DAY)

    # -- shared sampler: who visits which event when -----------------------------------------
    def sample_visits(self, n, event_mask=None, event_weight=None):
        """Returns (event_idx, customer_idx, ts) for n visits. Visits fall in the event's sales window
        (sales open -> start, capped at END) and after the customer's sign-up."""
        rng = self.rng
        ev, cu = self.ev, self.cu
        w = event_weight if event_weight is not None else (ev["sold_total"].to_numpy() + 0.02 * ev["cap"].to_numpy())
        w = w * (event_mask if event_mask is not None else 1.0)
        counts = rng.multinomial(n, w / w.sum())
        base_w = 0.15 + cu["keen"].to_numpy()
        c_city, c_fav, c_signup = cu["city"].to_numpy(), cu["fav_type"].to_numpy(), cu["signup"].to_numpy()
        ev_idx, cu_idx, ts = [], [], []
        for e in np.nonzero(counts)[0]:
            k = counts[e]
            row = ev.iloc[e]
            w_end = min(row["start"], self.span) - HOUR
            if w_end <= row["sales_open"]:
                continue
            wc = base_w * np.where(c_city == row["city"], 4.0, 1.0) * np.where(c_fav == row["etype"], 2.0, 1.0)
            wc = wc * (c_signup < w_end - HOUR)
            if wc.sum() == 0:
                continue
            chosen = rng.choice(len(cu), size=k, p=wc / wc.sum())
            # Visits bunch up right after sales open and just before the event
            u = rng.random(k)
            mix = rng.random(k)
            u = np.where(mix < 0.35, np.minimum(rng.exponential(0.06, k), 1.0),
                np.where(mix < 0.65, 1.0 - np.minimum(rng.exponential(0.08, k), 1.0), u))
            t = row["sales_open"] + u * (w_end - row["sales_open"])
            t = np.maximum(t, c_signup[chosen] + HOUR)
            t = np.minimum(t, w_end)
            ev_idx.append(np.full(k, e)); cu_idx.append(chosen); ts.append(t)
        return np.concatenate(ev_idx), np.concatenate(cu_idx), np.concatenate(ts)

    # ===========================================================================================
    # 1. Sessions -> behavior_sequences.csv
    # ===========================================================================================
    def sessions(self, n_target):
        rng = self.rng
        ev, cu = self.ev, self.cu
        e, c, ts = self.sample_visits(int(n_target * 1.08))
        m = len(e)
        E = ev.iloc[e].reset_index(drop=True)
        C = cu.iloc[c].reset_index(drop=True)

        tier = np.minimum(rng.choice(4, size=m, p=[0.55, 0.25, 0.14, 0.06]), E["tier_count"].to_numpy() - 1)
        price = self.prices[e, tier]
        appeal = sigmoid(E["logit"].to_numpy())
        fav = (C["fav_type"].to_numpy() == E["etype"].to_numpy()).astype(float)
        same_city = (C["city"].to_numpy() == E["city"].to_numpy()).astype(float)
        mood = rng.normal(0, 0.8, size=m)                                       # hidden, per session
        latent = (-1.3 + 2.6 * C["keen"].to_numpy() + 1.4 * (appeal - 0.4) + 0.5 * fav + 0.3 * same_city
                  - 0.5 * C["price_sens"].to_numpy() * np.log(price / 1500.0) + mood)

        views = np.clip(1 + rng.poisson(np.exp(np.clip(0.2 + 0.45 * latent, -2, 2.5))), 1, 30)
        seat_p = sigmoid(latent - 0.4 + rng.normal(0, 0.5, size=m))
        seat_sel = np.where(rng.random(m) < seat_p, 1 + rng.poisson(0.6, size=m), 0)
        chk = (seat_sel > 0) & (rng.random(m) < sigmoid(latent + 0.3))
        duration = np.round(np.clip(rng.lognormal(np.log(40 + 35 * views + 60 * (seat_sel > 0)), 0.5), 5, 7200))

        pay_p = sigmoid(1.1 + 0.8 * latent - 0.6 * C["price_sens"].to_numpy() * np.log(price / 2000.0) + rng.normal(0, 0.7, size=m))
        pay_fail = rng.random(m) < 0.06
        paid_now = chk & (rng.random(m) < pay_p) & ~pay_fail
        abandoned = chk & ~paid_now

        # Coming back later to buy (within 7 days, before the event)
        back_p = np.where(abandoned, 0.30 * sigmoid(latent + 0.5), sigmoid(latent - 2.4))
        back = ~paid_now & (rng.random(m) < back_p)
        delay = rng.uniform(2 * HOUR, 7 * DAY, size=m)
        start = E["start"].to_numpy()
        back &= (ts + delay) < np.minimum(start, self.span)
        purchase_ts = np.where(paid_now, ts + duration, np.where(back, ts + delay, np.nan))
        purchased_7d = paid_now | back

        df = pd.DataFrame({
            "session_id": "", "customer_id": C["customer_id"], "event_id": E["event_id"],
            "_ts": ts, "_cust": c, "_event": e, "_purchase_ts": purchase_ts,
            "event_type": [EVENT_TYPES[t] for t in E["etype"]], "city": [CITIES[i] for i in E["city"]],
            "country": E["country"], "currency": CURRENCY,
            "event_views": views, "seat_selections": seat_sel, "checkout_started": chk.astype(int),
            "session_duration_seconds": duration.astype(int), "ticket_price": price.astype(int),
            "ticket_price_rel": np.round(price / E["ref_price"].to_numpy(), 3),
            "min_price": E["min_price"].astype(int), "tier_count": E["tier_count"],
            "hours_since_sales_open": np.round((ts - E["sales_open"].to_numpy()) / HOUR, 1),
            "days_until_event": np.round((start - ts) / DAY, 2),
            "purchased_7d": purchased_7d.astype(int),
            "checkout_abandoned": np.where(chk, abandoned.astype(int), -1),
        })
        df = df.sort_values("_ts", kind="stable").reset_index(drop=True)

        # Labels must have matured: drop sessions within 7 days of the export. Then thin out at random
        # (not by time, which would cut off the latest months) BEFORE computing history, so history
        # only counts sessions that are in the dataset - as with a complete database export.
        df = df[df["_ts"] <= self.span - 7 * DAY]
        if len(df) > n_target:
            df = df.iloc[np.sort(rng.choice(len(df), size=n_target, replace=False))]
        df = df.reset_index(drop=True)

        # As-of history (only things that happened before this session)
        purchases = df.loc[df["_purchase_ts"].notna(), ["customer_id", "_purchase_ts"]]
        df["customer_prior_sessions"] = as_of_count(df, "customer_id", "_ts", df, "_ts").astype(int)
        df["customer_prior_purchases"] = as_of_count(df, "customer_id", "_ts", purchases, "_purchase_ts").astype(int)
        df["_ce"] = df["customer_id"] + "|" + df["event_id"]
        df["prior_sessions_this_event"] = as_of_count(df, "_ce", "_ts", df, "_ts").astype(int)
        df["session_id"] = [f"S{i + 1:07d}" for i in range(len(df))]
        df["ts"] = iso(df["_ts"])
        self.session_purchases = df.loc[df["purchased_7d"] == 1, ["_cust", "_event", "_purchase_ts", "ticket_price"]]
        self._S = df
        return self.sessions_output()

    def sessions_output(self):
        """Session rows with account age from the current sign-up dates (orders() can move sign-ups)."""
        df = self._S
        acct = df["_ts"].to_numpy() - self.cu["signup"].to_numpy()[df["_cust"].to_numpy()]
        df["account_age_days"] = np.round(np.maximum(acct, 0) / DAY, 1)
        cols = ["session_id", "customer_id", "event_id", "ts", "event_type", "city", "country", "event_views",
                "seat_selections", "checkout_started", "session_duration_seconds", "currency", "ticket_price",
                "ticket_price_rel", "min_price", "tier_count",
                "hours_since_sales_open", "days_until_event", "customer_prior_sessions", "customer_prior_purchases",
                "prior_sessions_this_event", "account_age_days", "purchased_7d", "checkout_abandoned"]
        return df[cols]

    # ===========================================================================================
    # 2. Checkout attempts -> fraud_purchases.csv
    # ===========================================================================================
    def orders(self, n_target, fraud_rate=0.04):
        rng = self.rng
        ev, cu = self.ev, self.cu
        n_fraud = int(n_target * fraud_rate)
        n_legit = n_target - n_fraud

        # Legitimate: the purchases from sampled sessions plus purchases from traffic not in the sample
        sp = self.session_purchases
        n_extra = max(0, n_legit - len(sp))
        e2, c2, t2 = self.sample_visits(n_extra)
        tier2 = np.minimum(rng.choice(4, size=len(e2), p=[0.55, 0.25, 0.14, 0.06]), ev["tier_count"].to_numpy()[e2] - 1)
        legit = pd.DataFrame({
            "_event": np.concatenate([sp["_event"].to_numpy(), e2]),
            "_cust": np.concatenate([sp["_cust"].to_numpy(), c2]),
            "_ts": np.concatenate([sp["_purchase_ts"].to_numpy(), t2]),
            "_unit": np.concatenate([sp["ticket_price"].to_numpy(), self.prices[e2, tier2]]),
        }).head(n_legit)
        L = len(legit)
        power_user = rng.random(L) < 0.08                 # fast, practised humans (autofill, repeat buyers)
        legit["tickets_requested"] = rng.choice([1, 2, 3, 4, 5, 6], size=L, p=[0.30, 0.38, 0.14, 0.11, 0.04, 0.03])
        legit["checkout_duration_seconds"] = np.where(power_user, rng.uniform(4, 12, L), rng.lognormal(np.log(40), 0.5, L))
        legit["clicks_per_minute"] = np.clip(rng.normal(np.where(power_user, 55, 30), 12, L), 3, 160)
        legit["rapid_seat_attempts"] = 1 + rng.poisson(np.where(power_user, 0.8, 0.3), L)
        legit["time_on_seatmap_seconds"] = np.where(power_user, rng.uniform(3, 15, L), rng.lognormal(np.log(25), 0.6, L))
        legit["device_switches"] = rng.choice([0, 1, 2], size=L, p=[0.90, 0.08, 0.02])
        legit["failed_payments_30d"] = rng.poisson(0.12, L)
        legit["prior_resale_listings"] = rng.poisson(0.05, L)
        legit["payment_method"] = rng.choice(PAYMENT_METHODS, size=L, p=[0.42, 0.33, 0.25])
        legit["customer_id"] = cu["customer_id"].to_numpy()[legit["_cust"].to_numpy()]
        legit["is_fraud"] = 0

        # Many real customers sign up only when they first buy or browse: move those customers' sign-up
        # to just before their first activity (sessions and orders), so a brand-new account is normal
        acts = pd.concat([self._S[["_cust", "_ts"]], legit[["_cust", "_ts"]]])
        first = acts.groupby("_cust")["_ts"].min()
        jit = first[rng.random(len(first)) < 0.45]
        new_signup = jit.to_numpy() - rng.exponential(0.4 * DAY, len(jit)) - 600
        self.cu.loc[jit.index.to_numpy(), "signup"] = new_signup
        legit["_account_created"] = self.cu["signup"].to_numpy()[legit["_cust"].to_numpy()]

        # Bots / scalpers hitting high-demand events. Naive bots: many orders per account, machine-speed
        # telemetry. Sophisticated bots: human-like timing and spread over many accounts (1-3 orders each).
        F = n_fraud
        soph = rng.random(F) < 0.40
        n_na = max(5, int((~soph).sum() / 15))
        n_so = max(5, int(soph.sum() / 2))
        bot_idx = np.where(soph, n_na + rng.integers(0, n_so, F), rng.integers(0, n_na, F))
        n_bots = n_na + n_so
        sleeper = np.concatenate([rng.random(n_na) < 0.20, rng.random(n_so) < 0.50])   # accounts created long before use
        is_soph_acct = np.arange(n_bots) >= n_na
        hot = (ev["sales_48h"] / ev["cap"]).to_numpy() ** 2 * (ev["sales_open"].to_numpy() < self.span - 2 * DAY)
        fe = rng.choice(len(ev), size=n_fraud, p=hot / hot.sum())
        open_t = ev["sales_open"].to_numpy()[fe]
        hours_after = np.where(soph, rng.exponential(72, F), rng.exponential(2.5, F))
        f_ts = np.minimum(open_t + hours_after * HOUR, ev["start"].to_numpy()[fe] - 2 * HOUR)
        first_use = np.zeros(n_bots)
        for b in range(n_bots):
            m = bot_idx == b
            first_use[b] = f_ts[m].min() if m.any() else 0
        fresh_age = np.where(is_soph_acct, rng.uniform(1, 30, n_bots), rng.uniform(0.05, 5, n_bots))
        created = first_use - np.where(sleeper, rng.uniform(60, 400, n_bots), fresh_age) * DAY
        fraud = pd.DataFrame({
            "_event": fe, "_ts": f_ts, "_cust": -1,
            "_unit": self.prices[fe, np.minimum(rng.choice(4, size=F, p=[0.3, 0.3, 0.25, 0.15]), ev["tier_count"].to_numpy()[fe] - 1)],
            "tickets_requested": np.where(soph, rng.choice([1, 2, 3, 4, 5, 6], size=F, p=[0.15, 0.30, 0.20, 0.20, 0.10, 0.05]), rng.choice([4, 6, 8, 10], size=F)),
            "checkout_duration_seconds": np.where(soph, rng.lognormal(np.log(28), 0.5, F), rng.uniform(0.4, 4.0, F)),
            "clicks_per_minute": np.where(soph, np.clip(rng.normal(38, 14, F), 3, 160), rng.uniform(140, 420, F)),
            "rapid_seat_attempts": np.where(soph, 1 + rng.poisson(0.7, F), rng.integers(4, 16, F)),
            "time_on_seatmap_seconds": np.where(soph, rng.lognormal(np.log(20), 0.6, F), rng.uniform(0.3, 3.0, F)),
            "device_switches": np.where(soph, rng.choice([0, 1, 2], size=F, p=[0.75, 0.20, 0.05]), rng.integers(1, 6, F)),
            "failed_payments_30d": np.where(soph, rng.poisson(0.25, F), rng.poisson(1.2, F)),
            "prior_resale_listings": np.where(soph, rng.poisson(0.3, F), rng.poisson(2.0, F)),
            "payment_method": np.where(soph, rng.choice(PAYMENT_METHODS, size=F, p=[0.35, 0.30, 0.35]), rng.choice(PAYMENT_METHODS, size=F, p=[0.25, 0.20, 0.55])),
            "_account_created": created[bot_idx],
            "customer_id": [f"B{b + 1:05d}" for b in bot_idx],
            "is_fraud": 1,
        })
        df = pd.concat([legit, fraud], ignore_index=True).sort_values("_ts", kind="stable").reset_index(drop=True)
        n = len(df)
        E = ev.iloc[df["_event"].to_numpy()].reset_index(drop=True)
        df["event_id"] = E["event_id"]
        df["event_type"] = [EVENT_TYPES[t] for t in E["etype"]]
        df["city"] = [CITIES[i] for i in E["city"]]
        df["tickets_requested"] = np.minimum(df["tickets_requested"], 10)   # app limit: 10 seats per booking
        df["total_amount"] = (df["tickets_requested"] * df["_unit"]).round(-1).astype(int)
        df["country"] = E["country"]
        df["currency"] = CURRENCY
        df["unit_price_rel"] = np.round(df["total_amount"] / df["tickets_requested"] / E["ref_price"], 3)
        df["hours_since_sales_open"] = np.round((df["_ts"] - E["sales_open"]) / HOUR, 2)
        df["account_age_days"] = np.round(np.maximum(df["_ts"] - df["_account_created"], 0) / DAY, 2)
        df["customer_prior_orders"] = as_of_count(df, "customer_id", "_ts", df, "_ts").astype(int)
        t = df[["customer_id", "_ts"]].copy()
        t["_ts_plus"] = t["_ts"] + DAY      # an order counts toward the next 24 h
        df["orders_last_24h"] = (df["customer_prior_orders"] - as_of_count(df.assign(_q=df["_ts"]), "customer_id", "_q", t, "_ts_plus")).astype(int)
        for col, nd in [("checkout_duration_seconds", 2), ("clicks_per_minute", 1), ("time_on_seatmap_seconds", 2)]:
            df[col] = df[col].round(nd)
        # Reviewers occasionally miss a fraud (label noise, as in real reviews)
        missed = (df["is_fraud"] == 1) & (rng.random(n) < 0.02)
        df.loc[missed, "is_fraud"] = 0
        df = df[df["_ts"] <= self.span].reset_index(drop=True)
        df["order_id"] = [f"O{i + 1:07d}" for i in range(len(df))]
        df["ts"] = iso(df["_ts"])
        cols = ["order_id", "customer_id", "event_id", "ts", "event_type", "city", "country", "tickets_requested",
                "currency", "total_amount", "unit_price_rel", "payment_method", "checkout_duration_seconds", "clicks_per_minute", "rapid_seat_attempts",
                "time_on_seatmap_seconds", "device_switches", "account_age_days", "customer_prior_orders",
                "orders_last_24h", "failed_payments_30d", "prior_resale_listings", "hours_since_sales_open", "is_fraud"]
        return df[cols]

    # ===========================================================================================
    # 3. Events -> event_demand.csv
    # ===========================================================================================
    def demand(self):
        ev = self.ev.sort_values("sales_open", kind="stable").reset_index(drop=True)
        ev = ev[ev["sales_open"] + 2 * DAY <= self.span].reset_index(drop=True)   # 48 h window complete
        # Organizer history known at sales open: their events whose 48 h window had already ended
        ev["_window_end"] = ev["sales_open"] + 2 * DAY
        ev["_fill"] = ev["sales_48h"] / ev["cap"]
        ev["_org"] = self.org_id[ev["org"].to_numpy()]
        past_n = as_of_count(ev, "_org", "sales_open", ev, "_window_end")
        past_fill = as_of_count(ev, "_org", "sales_open", ev, "_window_end", weight_col="_fill")
        df = pd.DataFrame({
            "event_id": ev["event_id"], "organizer_id": ev["_org"], "ts": iso(ev["sales_open"]),
            "event_start": iso(ev["start"]),
            "event_type": [EVENT_TYPES[t] for t in ev["etype"]], "city": [CITIES[i] for i in ev["city"]],
            "country": ev["country"], "timezone": TIMEZONE,
            "venue_capacity": ev["cap"], "tier_count": ev["tier_count"], "currency": CURRENCY,
            "min_price": ev["min_price"].astype(int), "avg_price": ev["avg_price"].astype(int), "max_price": ev["max_price"].astype(int),
            "min_price_rel": np.round(ev["min_price"] / ev["ref_price"], 3),
            "avg_price_rel": np.round(ev["avg_price"] / ev["ref_price"], 3),
            "max_price_rel": np.round(ev["max_price"] / ev["ref_price"], 3),
            "day_of_week": [DAYS_OF_WEEK[d] for d in ev["weekday"]], "start_hour": ev["start_hour"],
            "sales_open_hour": ev["open_hour"], "lead_days": ev["lead_days"], "start_month": month_of(ev["start"]),
            "organizer_past_events": past_n.astype(int),
            "organizer_past_sell_through_48h": np.where(past_n > 0, np.round(past_fill / np.maximum(past_n, 1), 4), np.nan),
            "sales_48h": ev["sales_48h"],
        })
        return df

    # ===========================================================================================
    # 4. Tickets -> attendance_no_show.csv  (and the per-event show rates used by crowd flow)
    # ===========================================================================================
    def attendance(self, n_target, per_event=50, rng=None, must_include=None):
        rng = self.rng if rng is None else rng
        ev, cu = self.ev, self.cu
        eligible = np.nonzero((ev["finished"] & (ev["sold_total"] >= per_event)).to_numpy())[0]
        n_events = min(len(eligible), int(np.ceil(n_target / per_event)))
        if must_include is None:
            chosen = np.sort(rng.choice(eligible, size=n_events, replace=False))
        else:   # 2.2.0: a larger sample that keeps every event the crowd data already uses
            must = np.asarray(must_include)
            others = np.setdiff1d(eligible, must)
            extra = rng.choice(others, size=max(0, min(len(others), n_events - len(must))), replace=False)
            chosen = np.sort(np.concatenate([must, extra]))
        self.attendance_events = chosen
        rows = []
        shocks = rng.normal(0, 0.35, size=len(ev))                 # hidden: weather, traffic, strikes on the day
        c_city, c_keen, c_rel, c_signup = cu["city"].to_numpy(), cu["keen"].to_numpy(), cu["reliability"].to_numpy(), cu["signup"].to_numpy()
        self.event_show_rate = {}
        for e in chosen:
            row = ev.iloc[e]
            k = per_event
            wc = (0.15 + c_keen) * np.where(c_city == row["city"], 4.0, 1.0) * (c_signup < row["start"] - DAY)
            cust = rng.choice(len(cu), size=k, p=wc / wc.sum())
            # Purchases spread over the sales window, front-loaded
            u = np.minimum(rng.exponential(0.3, k), 1.0)
            bought = row["sales_open"] + u * (row["start"] - DAY - row["sales_open"])
            bought = np.maximum(bought, c_signup[cust] + HOUR)
            tier = np.minimum(rng.choice(4, size=k, p=[0.55, 0.25, 0.14, 0.06]), row["tier_count"] - 1)
            price = self.prices[e, tier]
            transferred = rng.random(k) < 0.05
            resold = rng.random(k) < 0.03
            in_order = rng.choice([1, 2, 3, 4, 5, 6], size=k, p=[0.30, 0.38, 0.14, 0.11, 0.04, 0.03])
            days_before = (row["start"] - bought) / DAY
            weekday_evening = 1.0 if (row["weekday"] < 4 and row["start_hour"] >= 19) else 0.0
            show_logit = (np.log(c_rel[cust] / (1 - c_rel[cust])) + TYPE_PROFILE[EVENT_TYPES[row["etype"]]]["show"]
                          + 0.40 * np.log(price / 1000.0) + 0.6 * resold + 0.4 * transferred
                          - 0.025 * days_before + 0.40 * (in_order > 1) - 0.35 * weekday_evening
                          + shocks[e] + rng.normal(0, 0.3, k))
            p_show = sigmoid(show_logit)
            self.event_show_rate[e] = float(p_show.mean())
            rows.append(pd.DataFrame({
                "_event": e, "_cust": cust, "_bought": bought, "_start": row["start"],
                "tier_rank": tier, "ticket_price": price.astype(int), "tickets_in_order": in_order,
                "days_before_event_purchased": np.round(days_before, 1),
                "is_transferred": transferred.astype(int), "is_resold": resold.astype(int),
                "checked_in": (rng.random(k) < p_show).astype(int),
            }))
        df = pd.concat(rows, ignore_index=True)
        E = ev.iloc[df["_event"].to_numpy()].reset_index(drop=True)
        df["event_id"] = E["event_id"]
        df["customer_id"] = cu["customer_id"].to_numpy()[df["_cust"].to_numpy()]
        df["_ts"] = df["_start"] - DAY                                      # prediction time: 24 h before start
        df = df.sort_values(["_ts", "event_id"], kind="stable").reset_index(drop=True)
        # Customer attendance history: tickets for events that had ended before this prediction time
        hist = df[["customer_id", "_start", "checked_in"]].copy()
        hist["_ended"] = hist["_start"] + 4 * HOUR
        hist["_no_show"] = 1 - hist["checked_in"]
        df["customer_prior_tickets"] = as_of_count(df, "customer_id", "_ts", hist, "_ended").astype(int)
        df["customer_prior_attended"] = as_of_count(df, "customer_id", "_ts", hist, "_ended", weight_col="checked_in").astype(int)
        df["customer_prior_no_shows"] = df["customer_prior_tickets"] - df["customer_prior_attended"]
        df["ticket_id"] = [f"T{i + 1:07d}" for i in range(len(df))]
        df["ts"] = iso(df["_ts"])
        df["event_start"] = iso(ev["start"].to_numpy()[df["_event"].to_numpy()])
        df["event_type"] = [EVENT_TYPES[t] for t in ev["etype"].to_numpy()[df["_event"].to_numpy()]]
        df["city"] = [CITIES[i] for i in ev["city"].to_numpy()[df["_event"].to_numpy()]]
        df["day_of_week"] = [DAYS_OF_WEEK[d] for d in ev["weekday"].to_numpy()[df["_event"].to_numpy()]]
        df["start_hour"] = ev["start_hour"].to_numpy()[df["_event"].to_numpy()]
        sold = ev["sold_total"].to_numpy()[df["_event"].to_numpy()]
        df["event_tickets_sold"] = sold
        df["sample_weight"] = np.round(sold / per_event, 3)    # tickets this row stands for when totalling per event
        df["country"] = ev["country"].to_numpy()[df["_event"].to_numpy()]
        df["currency"] = CURRENCY
        df["ticket_price_rel"] = np.round(df["ticket_price"] / ev["ref_price"].to_numpy()[df["_event"].to_numpy()], 3)
        cols = ["ticket_id", "customer_id", "event_id", "ts", "event_start", "event_type", "city", "country",
                "day_of_week", "start_hour", "tier_rank", "currency", "ticket_price", "ticket_price_rel", "tickets_in_order", "days_before_event_purchased",
                "is_transferred", "is_resold", "customer_prior_tickets", "customer_prior_attended",
                "customer_prior_no_shows", "event_tickets_sold", "sample_weight", "checked_in"]
        return df[cols]

    # ===========================================================================================
    # 5. Gate scans -> crowd_flow.csv
    # ===========================================================================================
    def crowd(self, bin_from=-90, bin_to=60, bin_min=5):
        rng = self.rng
        ev = self.ev
        bins = np.arange(bin_from, bin_to, bin_min)
        rows = []
        for e in self.attendance_events:
            row = ev.iloc[e]
            attendees = rng.binomial(int(row["sold_total"]), self.event_show_rate[e])
            n_gates = int(np.clip(2 + row["cap"] // 8000, 2, 8))
            gate_cap = rng.choice([600, 800, 1000, 1200, 1500], size=n_gates)     # people per hour (EventGate.capacityPerHour)
            share = rng.dirichlet(np.full(n_gates, 3.0)) * gate_cap
            share = share / share.sum()
            mu, sd = TYPE_PROFILE[EVENT_TYPES[row["etype"]]]["arr"]
            mu = mu + rng.normal(0, 10)                                            # hidden: crowd mood, traffic
            edges = np.append(bins, bins[-1] + bin_min)
            cdf = np.array([0.5 * (1 + erf((x - mu) / (sd * np.sqrt(2)))) for x in edges])
            p_bin = np.diff(cdf)
            p_bin = p_bin / p_bin.sum()
            # Every attendee arrives exactly once: split them across gates, then across 5-minute slots
            per_gate = rng.multinomial(attendees, share)
            for g in range(n_gates):
                demand = rng.multinomial(per_gate[g], p_bin)
                limit = int(gate_cap[g] / 12 * 1.1)                                 # per 5 minutes
                scans, queue = np.zeros(len(bins), dtype=int), 0
                for b in range(len(bins)):                                          # a full gate pushes people to the next slot
                    want = demand[b] + queue
                    scans[b] = min(want, limit)
                    queue = want - scans[b]
                rows.append(pd.DataFrame({
                    "_event": e, "gate_id": f"{row['event_id']}-G{g + 1}", "gate_capacity_per_hour": gate_cap[g],
                    "gate_count": n_gates, "minutes_from_start": bins, "_t": row["start"] + bins * 60.0, "scans": scans,
                }))
        df = pd.concat(rows, ignore_index=True)
        E = ev.iloc[df["_event"].to_numpy()].reset_index(drop=True)
        df["event_id"] = E["event_id"]
        df["ts"] = iso(df["_t"])
        df["event_type"] = [EVENT_TYPES[t] for t in E["etype"]]
        df["city"] = [CITIES[i] for i in E["city"]]
        df["day_of_week"] = [DAYS_OF_WEEK[d] for d in E["weekday"]]
        df["start_hour"] = E["start_hour"]
        df["tickets_sold"] = E["sold_total"]
        df["country"] = E["country"]
        df = df.sort_values(["ts", "gate_id"], kind="stable").reset_index(drop=True)
        cols = ["event_id", "gate_id", "ts", "minutes_from_start", "event_type", "city", "country", "day_of_week", "start_hour",
                "tickets_sold", "gate_count", "gate_capacity_per_hour", "scans"]
        return df[cols]


    # ===========================================================================================
    # 2.2.0 additions (separate random stream: the 2.1.0 files above are unchanged)
    # ===========================================================================================
    def harder_fraud(self, fp, rng, share=0.03):
        """Card-testing / account-takeover fraud at human speed: telemetry copied from real-looking legitimate
        checkouts, so speed rules cannot see it. What gives it away is recorded history: a brand-new or long-
        dormant account, several orders inside a day, failed payments, many seats of the dearer tiers."""
        legit = fp[(fp["is_fraud"] == 0) & (pd.to_datetime(fp["ts"]) < pd.Timestamp(END, tz="UTC") - pd.Timedelta(days=1))]
        n = int(len(fp) * share)
        per_acct = rng.choice([2, 3, 4, 5], size=n // 3 + 1, p=[0.25, 0.35, 0.25, 0.15])
        acct = np.repeat(np.arange(len(per_acct)), per_acct)[:n]
        k = np.concatenate([np.arange(c) for c in per_acct])[:n]                  # order number within the account
        # One hot event per account: a takeover / scalper account buys the same event several times within hours
        acct_base = legit.sample(n=len(per_acct), random_state=int(rng.integers(1 << 31)), replace=True).reset_index(drop=True)
        base = acct_base.iloc[acct].reset_index(drop=True)
        tele = legit.sample(n=n, random_state=int(rng.integers(1 << 31)), replace=True).reset_index(drop=True)
        gap_h = np.where(k == 0, 0.0, rng.uniform(0.3, 5.0, n))
        offs = pd.Series(gap_h).groupby(acct).cumsum().to_numpy()
        base_t = pd.to_datetime(base["ts"]).dt.tz_localize(None)                     # naive UTC throughout
        ts = base_t + pd.to_timedelta(offs, unit="h")
        # Never after 2 hours before the event starts (as for every other order), then minute precision as iso()
        ev_start = self.ev.set_index("event_id")["start"]
        latest = pd.to_datetime(iso(ev_start.reindex(base["event_id"]).to_numpy() - 2 * HOUR), utc=True).tz_localize(None)
        ts = pd.Series(np.minimum(ts.to_numpy(), latest.to_numpy())).dt.floor("min")
        ts = pd.Series(np.maximum(ts.to_numpy(), base_t.dt.floor("min").to_numpy()))   # never before the copied order
        df = base.copy()
        shift_h = (ts - base_t).dt.total_seconds().to_numpy() / HOUR
        df["ts"] = ts.dt.strftime("%Y-%m-%dT%H:%MZ")
        df["hours_since_sales_open"] = np.round(np.maximum(0, base["hours_since_sales_open"].to_numpy() + shift_h), 2)
        for c in ["checkout_duration_seconds", "clicks_per_minute", "rapid_seat_attempts", "time_on_seatmap_seconds"]:
            df[c] = tele[c].to_numpy()
        dormant = rng.random(len(per_acct)) < 0.3
        age0 = np.where(dormant, rng.uniform(120, 700, len(per_acct)), rng.uniform(0.01, 1.5, len(per_acct)))[acct]
        since_first = (ts - ts.groupby(acct).transform("min")).dt.total_seconds().to_numpy() / DAY
        df["account_age_days"] = np.round(age0 + since_first, 2)
        df["customer_id"] = [f"B{90000 + a:05d}" for a in acct]
        df["customer_prior_orders"] = k
        df["orders_last_24h"] = k                                                   # all of an account's orders fall within a day
        df["tickets_requested"] = rng.choice([2, 4, 6, 8, 10], size=n, p=[0.15, 0.25, 0.25, 0.2, 0.15])
        df["unit_price_rel"] = np.round(base["unit_price_rel"].to_numpy() * rng.uniform(1.0, 1.8, n), 3)
        df["total_amount"] = (df["tickets_requested"] * df["unit_price_rel"] * (base["total_amount"] / base["tickets_requested"] / base["unit_price_rel"]).to_numpy()).round(-1).astype(int)
        df["failed_payments_30d"] = rng.poisson(np.where(k == 0, 1.0, 2.5), n)
        df["device_switches"] = rng.choice([0, 1, 2, 3], size=n, p=[0.35, 0.35, 0.2, 0.1])
        df["prior_resale_listings"] = rng.poisson(0.1, n)
        df["payment_method"] = rng.choice(PAYMENT_METHODS, size=n, p=[0.15, 0.15, 0.70])   # mostly card payments
        df["is_fraud"] = (rng.random(n) >= 0.02).astype(int)                       # reviewers miss ~2%, as above
        out = pd.concat([fp, df[fp.columns]], ignore_index=True)
        out = out.sort_values("ts", kind="stable").reset_index(drop=True)
        out["order_id"] = [f"O{i + 1:07d}" for i in range(len(out))]
        return out

    def account_links(self, fp, rng):
        """2.3.0: account-link inputs. Accounts are linked when they shared a phone number or a browser before
        the order. Assumptions (synthetic, stated in the README): bot / scalper accounts are run in rings that
        often (not always) share devices and wallets; some legitimate customers share a family phone or a
        browser. Every value is as of the order: links, confirmed frauds (known 14 days after the order, the
        review window) and the ring's orders for the same event in the previous 24 h."""
        fp = fp.copy()
        ts = pd.to_datetime(fp["ts"], utc=True).astype("int64").to_numpy() / 1e9
        cust = fp["customer_id"].to_numpy()
        is_bot = np.char.startswith(cust.astype(str), "B")
        group = {}
        # Bot rings: 3-12 accounts; 35% of bot accounts run alone on clean devices (no links at all)
        bots = np.unique(cust[is_bot])
        rng.shuffle(bots)
        alone = rng.random(len(bots)) < 0.35
        ringed = bots[~alone]
        k, g = 0, 0
        while k < len(ringed):
            size = int(rng.integers(3, 13))
            for c in ringed[k:k + size]:
                group[c] = f"R{g}"
            k += size
            g += 1
        # Families / shared browsers: 6% of legitimate customers, in pairs or threes
        legit = np.unique(cust[~is_bot])
        shared = legit[rng.random(len(legit)) < 0.06]
        rng.shuffle(shared)
        k = 0
        while k < len(shared):
            size = int(rng.choice([2, 3], p=[0.75, 0.25]))
            for c in shared[k:k + size]:
                group[c] = f"F{g}"
            k += size
            g += 1
        grp = np.array([group.get(c, "") for c in cust], dtype=object)
        fraud = fp["is_fraud"].to_numpy() == 1
        ev = fp["event_id"].to_numpy()
        linked = np.zeros(len(fp), dtype=int)
        linked_fraud = np.zeros(len(fp), dtype=int)
        same_event = np.zeros(len(fp), dtype=int)
        df_g = pd.DataFrame({"g": grp, "c": cust, "t": ts, "f": fraud, "e": ev})
        for gid, rows in df_g[df_g["g"] != ""].groupby("g").groups.items():
            rows = np.asarray(rows)
            sub = df_g.loc[rows]
            first = sub.groupby("c")["t"].min()                     # a member is known once it has ordered
            fraud_known = sub[sub["f"]].groupby("c")["t"].min() + 14 * DAY
            for i in rows:
                me, t, e = cust[i], ts[i], ev[i]
                others = first.drop(me, errors="ignore")
                linked[i] = int((others <= t).sum())
                fk = fraud_known.drop(me, errors="ignore")
                linked_fraud[i] = int((fk <= t).sum())
                m = (sub["c"] != me) & (sub["e"] == e) & (sub["t"] < t) & (sub["t"] >= t - DAY)
                same_event[i] = int(m.sum())
        # A few unrelated links (shared office / cafe network), so no input is a giveaway
        noise = rng.random(len(fp)) < 0.02
        linked[noise] += rng.integers(1, 3, int(noise.sum()))
        fp["linked_accounts"] = linked
        fp["linked_accounts_confirmed_fraud"] = linked_fraud
        fp["linked_orders_same_event_24h"] = same_event
        cols = [c for c in fp.columns if c != "is_fraud"] + ["is_fraud"]     # label last, as the exporter writes it
        return fp[cols]

    @staticmethod
    def _pseudo(kind, values):
        return [kind + hashlib.sha256(f"synthetic:{kind}:{v}".encode()).hexdigest()[:16] for v in values]

    def checkout_abandonment(self, bs, rng):
        """Every started checkout of behavior_sequences, as the checkout export shapes it (one row at checkout
        start). Customer history counts only checkouts whose outcome was known (24 h) before this one."""
        c = bs[bs["checkout_started"] == 1].copy().sort_values("ts", kind="stable").reset_index(drop=True)
        t = pd.to_datetime(c["ts"])
        known = c[["customer_id"]].copy()
        known["_known"] = t + pd.Timedelta(days=1)
        known["_ab"] = c["checkout_abandoned"].to_numpy()
        expired = np.zeros(len(c), dtype=int)
        for cust, idx in c.groupby("customer_id").groups.items():
            idx = np.asarray(idx)
            if len(idx) < 2:
                continue
            kt, ab = known["_known"].to_numpy()[idx], known["_ab"].to_numpy()[idx]
            for j, i in enumerate(idx):
                expired[i] = int(((kt[:j] <= t.to_numpy()[i]) & (ab[:j] == 1)).sum())
        n = len(c)
        out = pd.DataFrame({
            "order_id": self._pseudo("O", c["session_id"]), "customer_id": self._pseudo("C", c["customer_id"]),
            "event_id": self._pseudo("E", c["event_id"]), "ts": c["ts"], "event_type": c["event_type"], "city": c["city"],
            "country": c["country"], "payment_method": rng.choice(PAYMENT_METHODS, size=n, p=[0.42, 0.33, 0.25]),
            "tickets_requested": rng.choice([1, 2, 3, 4, 5, 6], size=n, p=[0.30, 0.38, 0.14, 0.11, 0.04, 0.03]),
            "unit_price_rel": c["ticket_price_rel"], "hours_since_sales_open": c["hours_since_sales_open"],
            "days_until_event": c["days_until_event"], "account_age_days": c["account_age_days"],
            "customer_prior_orders": c["customer_prior_purchases"].to_numpy() + expired,
            "customer_prior_purchases": c["customer_prior_purchases"], "customer_prior_expired_checkouts": expired,
            "first_time": (c["customer_prior_purchases"] == 0).astype(int),
            "visit_event_views": c["event_views"], "visit_seat_selections": c["seat_selections"],
            "abandoned": c["checkout_abandoned"].astype(int), "feature_source": "snapshot",
        })
        return out

    def demand_hourly(self, dm, rng, snapshots=12):
        """Hourly sales of each event while on sale: the first 48 h sell sales_48h (front-loaded), the rest of
        sold_total follows, rising again in the last days. Up to `snapshots` random hours per event; the label is
        what sold in the next 24 h; the rule logged with each snapshot is "the last 24 hours' pace continues"."""
        ev = self.ev.set_index("event_id")
        rows = []
        for r in dm.itertuples(index=False):
            e = ev.loc[r.event_id]
            open_t, start = float(e["sales_open"]), float(e["start"])
            end_t = min(start - DAY, self.span - DAY)
            hours = int((end_t - open_t) // HOUR)
            if hours < 72:
                continue
            h = np.arange(hours)
            tau = rng.uniform(6, 20)
            w48 = np.exp(-h[:48] / tau)
            days_left = (start - (open_t + h[48:] * HOUR)) / DAY
            wrest = (0.3 + 2.0 * np.exp(-days_left / 3.0)) * np.where((h[48:] % 24 >= 2) & (h[48:] % 24 <= 7), 0.15, 1.0)
            sales = np.concatenate([rng.multinomial(int(e["sales_48h"]), w48 / w48.sum()),
                                    rng.multinomial(int(max(0, e["sold_total"] - e["sales_48h"])), wrest / wrest.sum())])
            cum = np.concatenate([[0], np.cumsum(sales)])
            pick = np.sort(rng.choice(np.arange(1, hours - 24), size=min(snapshots, hours - 25), replace=False))
            for p in pick:
                sold = int(cum[p])
                last24 = int(cum[p] - cum[max(0, p - 24)])
                rows.append((r.event_id, r.organizer_id, open_t + p * HOUR, r.event_type, r.city, r.country, r.day_of_week,
                             r.venue_capacity, r.tier_count, r.min_price_rel, r.avg_price_rel, r.max_price_rel, r.start_hour,
                             r.start_month, r.organizer_past_events, r.organizer_past_sell_through_48h, float(p),
                             round((start - open_t - p * HOUR) / DAY, 2), sold, last24, round(sold / r.venue_capacity, 4),
                             last24, int(cum[p + 24] - cum[p])))
        cols = ["event_id", "organizer_id", "_t", "event_type", "city", "country", "day_of_week", "venue_capacity", "tier_count",
                "min_price_rel", "avg_price_rel", "max_price_rel", "start_hour", "start_month", "organizer_past_events",
                "organizer_past_sell_through_48h", "hours_since_sales_open", "days_until_event", "sold_so_far", "sold_last_24h",
                "sell_through_so_far", "rule_next_24h", "sales_next_24h"]
        df = pd.DataFrame(rows, columns=cols).sort_values(["_t", "event_id"], kind="stable").reset_index(drop=True)
        df["ts"] = iso(df["_t"])
        df["event_id"] = self._pseudo("E", df["event_id"])
        df["organizer_id"] = self._pseudo("G", df["organizer_id"])
        df["feature_source"] = "snapshot"
        return df[["event_id", "organizer_id", "ts"] + cols[3:] + ["feature_source"]]


# ---------------------------------------------------------------------------------------------
LABELS = {
    "behavior_sequences": ["purchased_7d", "checkout_abandoned"],
    "fraud_purchases": ["is_fraud"],
    "event_demand": ["sales_48h"],
    "attendance_no_show": ["checked_in"],
    "crowd_flow": ["scans"],
    "checkout_abandonment": ["abandoned"],
    "demand_hourly": ["sales_next_24h"],
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scale", type=float, default=1.0, help="multiply every size (default 1.0)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=os.path.join(BASE_DIR, "data"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    t0 = time.time()
    print(f"TicketLedger v0 dataset generator {GENERATOR_VERSION} (scale {args.scale}, seed {args.seed})")
    world = World(scale=args.scale, seed=args.seed)
    s = args.scale
    datasets = {}
    datasets["behavior_sequences"] = world.sessions(int(100_000 * s))
    datasets["fraud_purchases"] = world.orders(int(50_000 * s))
    datasets["behavior_sequences"] = world.sessions_output()   # account ages after sign-up dates were settled
    datasets["event_demand"] = world.demand()
    datasets["attendance_no_show"] = world.attendance(int(50_000 * s))
    datasets["crowd_flow"] = world.crowd()
    # 2.2.0: everything below uses its own random stream, so the files above are unchanged
    rng2 = np.random.default_rng(args.seed + 1000)
    datasets["fraud_purchases"] = world.harder_fraud(datasets["fraud_purchases"], rng2)
    datasets["attendance_no_show"] = world.attendance(int(150_000 * s), rng=rng2, must_include=world.attendance_events)
    datasets["checkout_abandonment"] = world.checkout_abandonment(datasets["behavior_sequences"], rng2)
    datasets["demand_hourly"] = world.demand_hourly(datasets["event_demand"], rng2)
    # 2.3.0: account-link inputs on a third stream (every other file is unchanged)
    rng3 = np.random.default_rng(args.seed + 2000)
    datasets["fraud_purchases"] = world.account_links(datasets["fraud_purchases"], rng3)

    manifest = {
        "source": SOURCE_TAG,
        "generator_version": GENERATOR_VERSION,
        "seed": args.seed,
        "scale": args.scale,
        "history": {"from": str(iso([0])[0]), "to": str(iso([(END - START).total_seconds()])[0])},   # UTC
        "countries": [COUNTRY], "currencies": {COUNTRY: CURRENCY}, "timezones": {COUNTRY: TIMEZONE},
        "world": {"organizers": int(len(world.org_id)), "events": int(len(world.ev)), "customers": int(len(world.cu))},
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "files": {},
    }
    for name, df in datasets.items():
        path = os.path.join(args.out, f"{name}.csv")
        df.to_csv(path, index=False)
        labels = {}
        for lab in LABELS[name]:
            col = df[lab]
            if name in ("event_demand", "crowd_flow", "demand_hourly"):
                labels[lab] = {"mean": round(float(col.mean()), 3), "total": int(col.sum())}
            else:
                valid = col[col >= 0]
                labels[lab] = {"rows": int(len(valid)), "positives": int(valid.sum()), "rate": round(float(valid.mean()), 4)}
        manifest["files"][name] = {
            "file": f"{name}.csv", "rows": int(len(df)), "columns": list(df.columns), "labels": labels,
            "ts_from": str(df["ts"].min()), "ts_to": str(df["ts"].max()), "sha256": sha256(path),
        }
        print(f"  {name + '.csv':26s} {len(df):>8,} rows   labels: {labels}")
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    total = sum(len(d) for d in datasets.values())
    print(f"Done: {total:,} rows in {time.time() - t0:.1f}s -> {args.out}")


if __name__ == "__main__":
    main()
