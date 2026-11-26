"""
Explanations and reference profiles for shadow models. Nothing here makes or changes a decision.

Reference profile (stored in every artifact, built from the rows the final model was trained on):
  * `typical`: the median of each numeric input and the most common value of each category. Explanations
    compare a row with this "typical" row;
  * `numeric`: decile bin edges and the share of training rows in each bin; `categorical`: the share of the
    most common values (+ "other"). The API compares live inputs with these shares (PSI) to spot drift.

Reasons for one prediction ("why is this forecast high?"): for each input, the prediction is recomputed with
that one input set to its typical value. The difference is that input's effect on THIS prediction. The three
largest effects are reported with their direction.

Limits (stated wherever the reasons are shown): effects are one-at-a-time, so they do not add up to the
prediction and ignore interactions; a calibrated probability can move in steps, so small effects may read 0.
"""

import numpy as np
import pandas as pd

from .models import feature_frame, predict
from .schema import ModelSpec

# Plain-language names for the reasons shown to staff
LABELS = {
    "event_type": "event type", "city": "city", "country": "country", "day_of_week": "day of the week",
    "payment_method": "payment method",
    "event_views": "event page views", "seat_selections": "seats selected", "checkout_started": "checkout started",
    "session_duration_seconds": "time on site", "ticket_price_rel": "price vs typical", "tier_count": "number of ticket types",
    "hours_since_sales_open": "hours since sales opened", "days_until_event": "days until the event",
    "customer_prior_sessions": "earlier visits", "customer_prior_purchases": "earlier purchases",
    "prior_sessions_this_event": "earlier visits to this event", "account_age_days": "account age",
    "tickets_requested": "tickets in the order", "unit_price_rel": "price vs typical",
    "checkout_duration_seconds": "checkout speed", "clicks_per_minute": "clicks per minute",
    "rapid_seat_attempts": "rapid seat attempts", "time_on_seatmap_seconds": "time on the seat map",
    "device_switches": "device switches", "customer_prior_orders": "earlier orders", "orders_last_24h": "orders in the last 24 h",
    "failed_payments_30d": "failed payments (30 days)", "prior_resale_listings": "earlier resale listings",
    "linked_accounts": "accounts sharing a phone or browser", "linked_accounts_confirmed_fraud": "linked accounts with confirmed fraud",
    "linked_orders_same_event_24h": "linked accounts' orders for this event (24 h)",
    "venue_capacity": "venue capacity", "min_price_rel": "cheapest ticket vs typical", "avg_price_rel": "average price vs typical",
    "max_price_rel": "dearest ticket vs typical", "start_hour": "start time", "sales_open_hour": "hour sales open",
    "lead_days": "days on sale before the event", "start_month": "month", "organizer_past_events": "organizer's past events",
    "organizer_past_sell_through_48h": "organizer's past 48-hour sell-through",
    "tier_rank": "ticket tier", "tickets_in_order": "tickets in the order", "days_before_event_purchased": "days bought in advance",
    "is_transferred": "transferred ticket", "is_resold": "resold ticket", "customer_prior_tickets": "earlier tickets",
    "customer_prior_attended": "earlier events attended", "customer_prior_no_shows": "earlier no-shows",
    "minutes_from_start": "minutes from the start", "tickets_sold": "tickets sold", "gate_count": "number of gates",
    "gate_capacity_per_hour": "gate capacity per hour", "gate_capacity_share": "gate's share of capacity",
    "baseline_scans": "rule estimate for the slot",
    "customer_prior_expired_checkouts": "earlier expired checkouts", "first_time": "first-time customer",
    "visit_event_views": "event views in this visit", "visit_seat_selections": "seats selected in this visit",
    "sold_so_far": "tickets sold so far", "sold_last_24h": "tickets sold in the last 24 h", "sell_through_so_far": "share sold so far",
}

UNITS = {"binary": "probability points", "regression": "tickets", "count": "scans"}
MAX_CATEGORIES = 20


def _clean(v):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v


def reference_profile(df: pd.DataFrame, spec: ModelSpec) -> dict:
    """Typical values and training distributions of every input (see module docstring)."""
    X = feature_frame(df, spec)
    typical, numeric, categorical = {}, {}, {}
    for c in spec.num:
        col = X[c].dropna()
        if col.empty:
            typical[c] = None
            continue
        typical[c] = round(float(col.median()), 4)
        edges = np.unique(np.quantile(col, np.linspace(0.1, 0.9, 9)))
        idx = np.searchsorted(edges, col.to_numpy(), side="right")
        shares = np.bincount(idx, minlength=len(edges) + 1) / len(col)
        numeric[c] = {"edges": [round(float(e), 6) for e in edges], "shares": [round(float(s), 6) for s in shares],
                      "missing_share": round(float(X[c].isna().mean()), 6)}
    for c in spec.cat:
        col = X[c].astype(object).where(X[c].notna(), "(missing)")
        vc = col.value_counts(normalize=True)
        typical[c] = str(vc.index[0]) if len(vc) else None
        top = vc.head(MAX_CATEGORIES)
        categorical[c] = {"shares": {str(k): round(float(v), 6) for k, v in top.items()},
                          "other_share": round(float(max(0.0, 1.0 - top.sum())), 6)}
    return {"rows": int(len(df)), "typical": typical, "numeric": numeric, "categorical": categorical}


def _output(model, df, spec, transform):
    out = predict(model, df, spec)
    return transform(out, df) if transform else out


def reasons(model, rows: pd.DataFrame, spec: ModelSpec, reference: dict, top=3, transform=None, base=None):
    """Top `top` one-at-a-time effects per row. Returns one list per row:
    [{feature, label, value, typical, effect, direction}], effect in the model's output units."""
    typical = reference.get("typical", {})
    feats = [c for c in list(spec.cat) + list(spec.num) if typical.get(c) is not None]
    rows = rows.reset_index(drop=True)
    n = len(rows)
    if n == 0 or not feats:
        return [[] for _ in range(n)]
    # `base`: the caller's own predictions for these rows (saves one model call), else computed here
    base = np.asarray(base, dtype=float) if base is not None else _output(model, rows, spec, transform)
    # One batch: every row repeated once per input, with that input set to its typical value
    alt = pd.concat([rows] * len(feats), ignore_index=True)
    for k, c in enumerate(feats):
        sl = slice(k * n, (k + 1) * n)
        if c in spec.cat:
            alt[c] = alt[c].astype(object)
        elif alt[c].dtype.kind in "iub":
            alt[c] = alt[c].astype(float)      # a typical value can be fractional (median 26.5)
        alt.loc[alt.index[sl], c] = typical[c]
    alt_out = _output(model, alt, spec, transform).reshape(len(feats), n)
    effects = base[None, :] - alt_out                                  # + = this input pushes the prediction up
    scale = 100.0 if spec.kind == "binary" else 1.0                    # probabilities as percentage points
    result = []
    for i in range(n):
        order = np.argsort(-np.abs(effects[:, i]), kind="stable")[:top]
        items = []
        for k in order:
            e = float(effects[k, i]) * scale
            if abs(e) < 0.05:
                continue
            c = feats[k]
            items.append({"feature": c, "label": LABELS.get(c, c.replace("_", " ")), "value": _clean(rows.at[i, c]),
                          "typical": _clean(typical[c]), "effect": round(e, 2), "direction": "up" if e > 0 else "down"})
        result.append(items)
    return result


def explanation_note(spec: ModelSpec) -> str:
    unit = "percentage points" if spec.kind == "binary" else UNITS.get(spec.kind, "units")
    return (f"Each reason is the change in this prediction ({unit}) when that one input is set to its typical value. "
            "One input at a time: effects do not add up to the prediction and ignore interactions.")
