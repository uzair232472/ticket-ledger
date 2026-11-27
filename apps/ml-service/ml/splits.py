"""
Time-based train / validation / test splits with leakage control.

  oldest ------------------------------------------------------------------ newest
  [          train 70%          ][  validation 15%  ][       test 15%       ]

* Rows are split by time, never at random: the test set is the most recent data, as in real use.
* Purging: a training row whose label only became known after validation starts is removed (and
  likewise validation rows whose label reaches into the test period). Otherwise the model would learn
  from outcomes that were not yet known at the cut.
* split_group (e.g. an event's gate slots or tickets) keeps related rows on one side of every cut.
* Holdout: a random 10% of customers (or organizers / events) are removed from training and
  validation entirely, so the test set has guaranteed "unseen" groups to report on.

`assert_no_leakage` re-checks all of this and raises LeakageError; a run that fails it is rejected.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .schema import ModelSpec


class LeakageError(AssertionError):
    pass


@dataclass
class Split:
    train: np.ndarray        # row positions
    val: np.ndarray
    test: np.ndarray
    val_start: pd.Timestamp
    test_start: pd.Timestamp
    holdout_groups: set
    purged_train: int
    purged_val: int

    def summary(self):
        return {
            "train_rows": int(len(self.train)), "val_rows": int(len(self.val)), "test_rows": int(len(self.test)),
            "val_start": self.val_start.isoformat(), "test_start": self.test_start.isoformat(),
            "purged_train_rows": int(self.purged_train), "purged_val_rows": int(self.purged_val),
            "holdout_groups": int(len(self.holdout_groups)),
        }


def _split_time(df: pd.DataFrame, spec: ModelSpec) -> pd.Series:
    if spec.split_group:
        return df.groupby(spec.split_group)["ts"].transform("min")
    return df["ts"]


def time_split(df: pd.DataFrame, spec: ModelSpec, fractions=(0.70, 0.15, 0.15), holdout_frac=0.10, seed=0) -> Split:
    assert abs(sum(fractions) - 1.0) < 1e-9
    t = _split_time(df, spec)
    val_start = t.quantile(fractions[0])
    test_start = t.quantile(fractions[0] + fractions[1])
    horizon = pd.Timedelta(days=spec.label_horizon_days)
    # When the label is known; for grouped rows, when the group's last label is known (purge whole groups)
    last_ts = df.groupby(spec.split_group)["ts"].transform("max") if spec.split_group else df["ts"]
    known_at = last_ts + horizon

    is_train = (t < val_start).to_numpy()
    is_val = ((t >= val_start) & (t < test_start)).to_numpy()
    is_test = (t >= test_start).to_numpy()

    purge_train = is_train & (known_at > val_start).to_numpy()
    purge_val = is_val & (known_at > test_start).to_numpy()
    is_train &= ~purge_train
    is_val &= ~purge_val

    rng = np.random.default_rng(seed)
    groups = df[spec.holdout_group].dropna().unique()
    groups = np.sort(groups)
    holdout = set(rng.choice(groups, size=int(round(len(groups) * holdout_frac)), replace=False)) if len(groups) else set()
    in_holdout = df[spec.holdout_group].isin(holdout).to_numpy()
    is_train &= ~in_holdout
    is_val &= ~in_holdout

    return Split(
        train=np.flatnonzero(is_train), val=np.flatnonzero(is_val), test=np.flatnonzero(is_test),
        val_start=val_start, test_start=test_start, holdout_groups=holdout,
        purged_train=int(purge_train.sum()), purged_val=int(purge_val.sum()),
    )


ROW_IDS = ("session_id", "order_id", "ticket_id")


def assert_no_leakage(df: pd.DataFrame, split: Split, spec: ModelSpec):
    parts = {"train": split.train, "val": split.val, "test": split.test}
    # 1. no row in two parts
    seen = set()
    for name, idx in parts.items():
        s = set(idx.tolist())
        if seen & s:
            raise LeakageError(f"rows appear in more than one split (found in {name})")
        seen |= s
    # 2. no duplicated record (same session / order / ticket / gate slot) across parts
    ids = [c for c in ROW_IDS if c in df] or (["gate_id", "ts"] if "gate_id" in df else ["event_id"])
    keys = df[ids].astype(str).agg("|".join, axis=1)
    for a, b in (("train", "val"), ("train", "test"), ("val", "test")):
        overlap = set(keys.iloc[parts[a]]) & set(keys.iloc[parts[b]])
        if overlap:
            raise LeakageError(f"{len(overlap)} records appear in both {a} and {b}, e.g. {next(iter(overlap))}")
    # 3. order in time, and labels known before the next part starts
    horizon = pd.Timedelta(days=spec.label_horizon_days)
    t = _split_time(df, spec)
    if len(split.train) and (df["ts"].iloc[split.train] + horizon).max() > split.val_start:
        raise LeakageError("a training label only became known after validation starts")
    if len(split.val) and (df["ts"].iloc[split.val] + horizon).max() > split.test_start:
        raise LeakageError("a validation label only became known after the test period starts")
    if len(split.train) and len(split.test) and t.iloc[split.train].max() >= t.iloc[split.test].min():
        raise LeakageError("training data is not entirely older than the test data")
    # 4. related rows stay together
    if spec.split_group:
        g = {name: set(df[spec.split_group].iloc[idx]) for name, idx in parts.items()}
        for a, b in (("train", "val"), ("train", "test"), ("val", "test")):
            if g[a] & g[b]:
                raise LeakageError(f"{spec.split_group} values split across {a} and {b}")
    # 5. held-out groups never trained on
    trained = set(df[spec.holdout_group].iloc[np.concatenate([split.train, split.val])])
    if trained & split.holdout_groups:
        raise LeakageError(f"held-out {spec.holdout_group} values found in training or validation")
    return True
