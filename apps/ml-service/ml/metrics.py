"""Metrics in the AI strategy's terms. Higher-is-better unless the name says error."""

import numpy as np
from sklearn.metrics import roc_auc_score


def top_share(y, score, frac=0.10):
    """Share of actual positives among the top `frac` highest-scored rows.

    Rule scores have many ties; rows tied at the cut-off count proportionally (the expected result of
    picking among them at random), so a tie-heavy rule is neither flattered nor punished by row order.
    """
    y = np.asarray(y, dtype=float)
    s = np.asarray(score, dtype=float)
    n = len(y)
    k = max(1, int(round(n * frac)))
    order = np.argsort(-s, kind="stable")
    cutoff = s[order[k - 1]]
    above = s > cutoff
    tied = s == cutoff
    take_from_tied = k - above.sum()
    pos = y[above].sum() + (y[tied].mean() * take_from_tied if tied.any() else 0.0)
    return float(pos / k)


def auc(y, score, w=None):
    y = np.asarray(y)
    if len(np.unique(y)) < 2:
        return float("nan")
    return float(roc_auc_score(y, score, sample_weight=w))


def ece(y, p, bins=10):
    """Expected calibration error with equal-count bins: average |predicted - actual| rate.
    0.30 abandonment predicted should mean about 30% abandoned."""
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    order = np.argsort(p, kind="stable")
    total = 0.0
    for chunk in np.array_split(order, bins):
        if len(chunk):
            total += len(chunk) * abs(p[chunk].mean() - y[chunk].mean())
    return float(total / len(y))


def brier(y, p):
    y = np.asarray(y, dtype=float)
    return float(np.mean((np.asarray(p, dtype=float) - y) ** 2))


def balanced_accuracy(y, pred):
    y = np.asarray(y).astype(int)
    pred = np.asarray(pred).astype(int)
    tpr = (pred[y == 1] == 1).mean() if (y == 1).any() else np.nan
    tnr = (pred[y == 0] == 0).mean() if (y == 0).any() else np.nan
    return float(np.nanmean([tpr, tnr]))


def wape(y, yhat):
    """Weighted % error: total absolute error / total actual. Works when some actuals are zero."""
    y = np.asarray(y, dtype=float)
    return float(np.abs(np.asarray(yhat, dtype=float) - y).sum() / max(y.sum(), 1e-9))


def wape_safe(y, yhat):
    """Weighted % error with zero sales handled: total |error| / total actual. When every actual is zero the
    ratio is undefined, so the mean absolute error (tickets) is returned with a note instead of infinity."""
    y = np.asarray(y, dtype=float)
    err = np.abs(np.asarray(yhat, dtype=float) - y).sum()
    if y.sum() <= 0:
        return float(err / max(len(y), 1)), "all actual sales were zero: mean absolute error in tickets instead"
    return float(err / y.sum()), None


def mae(y, yhat):
    return float(np.mean(np.abs(np.asarray(yhat, dtype=float) - np.asarray(y, dtype=float))))


def coverage(y, lo, hi):
    y = np.asarray(y, dtype=float)
    return float(np.mean((y >= np.asarray(lo)) & (y <= np.asarray(hi))))


def flag_stats(y, flagged, w=None):
    """Precision of flags (share confirmed as fraud), false-flag rate among legitimate orders, recall.

    w: sampling weights (1 / inclusion probability of each reviewed order). Real fraud labels come from a
    stratified review sample, so unweighted rates would describe the sample, not all orders."""
    y = np.asarray(y).astype(int)
    f = np.asarray(flagged).astype(bool)
    w = np.ones(len(y)) if w is None else np.asarray(w, dtype=float)
    def rate(num_mask, den_mask):
        den = w[den_mask].sum()
        return float(w[num_mask & den_mask].sum() / den) if den > 0 else 0.0
    return {"precision": rate(y == 1, f), "false_flag_rate": rate(f, y == 0), "recall": rate(f, y == 1),
            "flag_rate": rate(f, np.ones(len(y), dtype=bool))}


def weighted_quantile(x, q, w=None):
    x = np.asarray(x, dtype=float)
    if w is None:
        return float(np.quantile(x, q))
    w = np.asarray(w, dtype=float)
    order = np.argsort(x, kind="stable")
    cw = np.cumsum(w[order])
    return float(x[order][min(len(x) - 1, int(np.searchsorted(cw, q * cw[-1])))])
