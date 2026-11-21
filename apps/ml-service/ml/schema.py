"""
One specification per model: which dataset, which label, which columns are features, how long the
label takes to become known, and how rows are grouped for leakage control.

Only columns listed in `cat` / `num` reach a model. IDs, timestamps, raw local-currency prices and
labels never do.
"""

from dataclasses import dataclass, field
from typing import Callable, Optional

import pandas as pd


@dataclass(frozen=True)
class ModelSpec:
    name: str                      # model / feature name used in reports and the app
    title: str
    dataset: str                   # CSV in data/
    label: str
    kind: str                      # "binary" | "regression" | "count"
    cat: tuple                     # categorical feature columns
    num: tuple                     # numeric feature columns
    label_horizon_days: float      # how long after `ts` the label becomes known (purge window)
    holdout_group: str             # column whose values are held out entirely ("unseen" test)
    known_groups: tuple            # columns used to report known vs unseen results
    split_group: Optional[str] = None   # rows sharing this value are kept on one side of every split
    row_filter: Optional[Callable[[pd.DataFrame], pd.Series]] = None
    segments: dict = field(default_factory=dict)   # name -> function(df) -> bool mask, reported separately


GEO = ("event_type", "city", "country")

SPECS = {
    "intent": ModelSpec(
        name="intent", title="Purchase intent", dataset="behavior_sequences", label="purchased_7d", kind="binary",
        cat=GEO,
        num=("event_views", "seat_selections", "checkout_started", "session_duration_seconds", "ticket_price_rel",
             "tier_count", "hours_since_sales_open", "days_until_event", "customer_prior_sessions",
             "customer_prior_purchases", "prior_sessions_this_event", "account_age_days"),
        label_horizon_days=7, holdout_group="customer_id", known_groups=("customer_id", "event_id"),
        segments={"first_time_visitors": lambda d: d["customer_prior_sessions"] == 0},
    ),
    "abandonment": ModelSpec(
        name="abandonment", title="Abandoned checkout", dataset="behavior_sequences", label="checkout_abandoned",
        kind="binary",
        cat=GEO,
        num=("event_views", "seat_selections", "session_duration_seconds", "ticket_price_rel", "tier_count",
             "hours_since_sales_open", "days_until_event", "customer_prior_sessions", "customer_prior_purchases",
             "prior_sessions_this_event", "account_age_days"),
        label_horizon_days=1, holdout_group="customer_id", known_groups=("customer_id", "event_id"),
        row_filter=lambda d: d["checkout_started"] == 1,
        segments={"first_time_visitors": lambda d: d["customer_prior_sessions"] == 0},
    ),
    "fraud": ModelSpec(
        name="fraud", title="Fraud (flag for review)", dataset="fraud_purchases", label="is_fraud", kind="binary",
        cat=GEO + ("payment_method",),
        num=("tickets_requested", "unit_price_rel", "checkout_duration_seconds", "clicks_per_minute",
             "rapid_seat_attempts", "time_on_seatmap_seconds", "device_switches", "account_age_days",
             "customer_prior_orders", "orders_last_24h", "failed_payments_30d", "prior_resale_listings",
             "hours_since_sales_open"),
        label_horizon_days=14,   # reviewers decide within two weeks
        holdout_group="customer_id", known_groups=("customer_id", "event_id"),
        segments={"human_speed": lambda d: (d["checkout_duration_seconds"] > 4) & (d["clicks_per_minute"] < 140)},
    ),
    "demand": ModelSpec(
        name="demand", title="Demand forecast (48-hour sales)", dataset="event_demand", label="sales_48h",
        kind="regression",
        cat=GEO + ("day_of_week",),
        num=("venue_capacity", "tier_count", "min_price_rel", "avg_price_rel", "max_price_rel", "start_hour",
             "sales_open_hour", "lead_days", "start_month", "organizer_past_events",
             "organizer_past_sell_through_48h"),
        label_horizon_days=2, holdout_group="organizer_id", known_groups=("organizer_id",),
        segments={"organizer_first_event": lambda d: d["organizer_past_events"] == 0},
    ),
    "attendance": ModelSpec(
        name="attendance", title="Attendance (no-show)", dataset="attendance_no_show", label="checked_in",
        kind="binary",
        cat=GEO + ("day_of_week",),
        num=("start_hour", "tier_rank", "ticket_price_rel", "tickets_in_order", "days_before_event_purchased",
             "is_transferred", "is_resold", "customer_prior_tickets", "customer_prior_attended",
             "customer_prior_no_shows"),
        label_horizon_days=2, holdout_group="customer_id", known_groups=("customer_id",),
        split_group="event_id",
        segments={"first_time_attendees": lambda d: d["customer_prior_tickets"] == 0},
    ),
    "crowd": ModelSpec(
        name="crowd", title="Crowd flow (scans per gate per 5 min)", dataset="crowd_flow", label="scans",
        kind="count",
        cat=GEO + ("day_of_week",),
        num=("minutes_from_start", "start_hour", "tickets_sold", "gate_count", "gate_capacity_per_hour",
             "gate_capacity_share", "baseline_scans"),
        label_horizon_days=1, holdout_group="event_id", known_groups=(),
        split_group="event_id",
    ),
}

# Inputs that may legitimately be empty (also empty in training): an organizer's first event has no history
NULLABLE_FEATURES = {"demand": {"organizer_past_sell_through_48h"}}

ID_COLUMNS = {"session_id", "order_id", "ticket_id", "customer_id", "event_id", "organizer_id", "gate_id"}
