# Training datasets (v0, synthetic)

These five files train the **starter (v0) models**. They come from a simulated three-year history of the
platform (`scripts/generate_synthetic_data.py`), shaped exactly like the data the app will export from the
client's database. Production models are retrained on that real data; these files are never used for that.

```
python scripts/generate_synthetic_data.py      # rebuild (same seed -> byte-identical files)
python scripts/validate_datasets.py            # 136 checks; run before any training
```

`manifest.json` records the source tag (`synthetic-v0`), seed, row counts, label counts, time range and a
SHA-256 hash for each file.

## How the data is built

1. **150 organizers.** Each has a hidden reputation and a home city.
2. **5,000 events**, Jan 2023 to Dec 2025. Each has a type, city, venue capacity, 1–4 price tiers, a
   sales-open time and a start time 7–60 days later. Demand depends on things the app records (type,
   price, capacity, weekday, season, the organizer's track record) and on hidden popularity and day-of noise.
3. **20,000 customers.** Each has a home city, a favourite event type and three hidden traits: keenness to
   buy, price sensitivity and reliability (how likely they are to turn up). 45% sign up only just before
   their first activity.
4. **Activity built from the above:** sessions, then orders (plus bot and scalper accounts), then tickets,
   then gate scans. Every row has IDs and a timestamp.

Hidden traits are **not** exported, so no model can score perfectly. This is like real data, where
much of what drives behaviour is never recorded.

## The files

Every row has `ts`, the moment the prediction would be made. Every feature column only uses information
available at `ts`, so nothing from the future leaks in. The last column(s) are the labels.

| File | Rows | One row = | Label(s) | Model(s) |
|---|---|---|---|---|
| `behavior_sequences.csv` | 100,000 | a visitor session for one event | `purchased_7d` (paid order for that event within 7 days); `checkout_abandoned` (1/0 when checkout started, -1 when it didn't) | Purchase intent, Abandonment |
| `fraud_purchases.csv` | 50,000 | a checkout attempt | `is_fraud` (as a reviewer would decide; about 2% of frauds are missed, as in real reviews) | Fraud (flag for review) |
| `event_demand.csv` | 5,000 | an event at sales open | `sales_48h` (tickets sold in the first 48 h) | Demand forecast |
| `attendance_no_show.csv` | 50,000 | a ticket, 24 h before the event | `checked_in` | Attendance |
| `crowd_flow.csv` | ~92,000 | one gate in one 5-minute slot (90 min before to 60 min after start) | `scans` | Crowd flow |

### Global-ready columns (Pakistan-only values for now)
The platform launches in Pakistan and will add other countries later. Every file is already shaped for
that:
- **`country`** (ISO code, `PK`) on every row. **`currency`** (`PKR`) wherever there is money.
  `event_demand` also has the venue's **`timezone`** (`Asia/Karachi`).
- **Timestamps (`ts`, `event_start`) are UTC**, ending in `Z`, as the app stores them.
  **`start_hour`, `day_of_week`, `sales_open_hour` and `start_month` are the venue's local time.** The
  validator checks the two agree.
- **`*_price_rel`** columns divide a price by the country's typical price: the median average price of
  that country's events whose sales opened earlier. A PKR 2,000 ticket and an AED 100 ticket then compare
  fairly. Raw prices stay in local currency for revenue.

When a new country joins, its rows simply get its own code, currency, time zone and typical price. The
models treat a country with little data like a new event type: an "unknown" default until enough of
its events have finished.

### IDs (for time-based splits and keeping customers/events on one side of a split)
`session_id`, `order_id`, `ticket_id`, `customer_id` (`C…` = customer, `B…` = bot account),
`event_id`, `organizer_id`, `gate_id` (`<event_id>-G<n>`).

### Notes per file
- **behavior_sequences:** sessions in the last 7 days before the export are left out, because their
  7-day purchase outcome is not known yet. `customer_prior_*` and `prior_sessions_this_event` count only
  earlier activity.
- **fraud_purchases:** about 3.9% fraud. 60% of fraud orders are naive bots (machine-speed, easy to
  catch) and 40% are sophisticated bots (human-like timing, spread over many accounts, hard to catch).
  Some real customers are fast "power users". `tickets_requested` is capped at 10, the app's limit.
- **event_demand:** only events whose first 48 hours are complete. `organizer_past_*` only counts the
  organizer's earlier events whose 48-hour window had already ended; it is empty for an organizer's
  first event.
- **attendance_no_show:** 50 sampled tickets for each of 1,000 finished events.
  `sample_weight` = tickets sold ÷ 50. Multiply by it when totalling attendance per event.
  `customer_prior_*` counts only events that had already ended.
- **crowd_flow:** the same 1,000 events. Every attendee is scanned exactly once. A gate can't scan more
  than its capacity per 5 minutes, and anyone over that waits for the next slot.

## Quick difficulty check (not the evaluation)

A plain gradient-boosting model with a time-based 80/20 split. This only shows the data is learnable
but not trivially easy (the old formula datasets gave perfect 1.0 scores). The real evaluation, against
baselines, is done by the training pipeline.

| Label | Result |
|---|---|
| purchased_7d | AUC 0.91 |
| checkout_abandoned | AUC 0.63 |
| is_fraud | AUC 0.97 (0.93 on human-speed bots) |
| checked_in | AUC 0.64 |
| sales_48h | weighted error 36% |
| scans | weighted error 33% |

The old formula-generated files are kept in `../dev/legacy-synthetic/`.
