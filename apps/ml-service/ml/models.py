"""
Model construction. One family for every feature: gradient-boosted trees (scikit-learn
HistGradientBoosting), CPU-only, fast, handles missing values natively.

Safeguards against memorising:
  * shallow trees (max_leaf_nodes 31), at least 40 rows per leaf, L2 regularisation;
  * early stopping on an internal validation slice;
  * the evaluation reports the train-vs-test gap and rejects large gaps.

Unknown / rare categories (a new event type, city or country):
  * categories seen fewer than 20 times are grouped as "infrequent";
  * categories never seen become "missing" at prediction time;
  * during training 3% of category values are blanked at random ("category dropout"), so the model has
    learned what to do when the category is unknown instead of guessing a neighbour.
"""

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

from .schema import ModelSpec

TREE_PARAMS = dict(learning_rate=0.06, max_iter=500, max_leaf_nodes=31, min_samples_leaf=40,
                   l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
                   n_iter_no_change=30, random_state=0)

# Model complexity levels, most flexible first. Chosen per model on the VALIDATION period only (see
# evaluate._select_complexity); the test period is never used for this choice. Fixed in advance.
COMPLEXITY = [
    {"name": "flexible", "max_leaf_nodes": 31, "min_samples_leaf": 40, "l2_regularization": 1.0},
    {"name": "moderate", "max_leaf_nodes": 15, "min_samples_leaf": 200, "l2_regularization": 3.0},
    {"name": "simple", "max_leaf_nodes": 7, "min_samples_leaf": 800, "l2_regularization": 10.0},
]


class CategoryDropout(BaseEstimator, TransformerMixin):
    """Blanks a small share of category values while fitting only; prediction passes data through."""

    def __init__(self, columns=(), rate=0.03, seed=0):
        self.columns = columns
        self.rate = rate
        self.seed = seed

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return X

    def fit_transform(self, X, y=None, **fit_params):
        X = X.copy()
        rng = np.random.default_rng(self.seed)
        for c in self.columns:
            mask = rng.random(len(X)) < self.rate
            X[c] = X[c].astype(object)
            X.loc[mask, c] = np.nan
        return X


def _preprocess(spec: ModelSpec):
    enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=np.nan, encoded_missing_value=np.nan,
                         min_frequency=20, max_categories=250, dtype=np.float64)
    return ColumnTransformer([("cat", enc, list(spec.cat))], remainder="passthrough",
                             verbose_feature_names_out=False)


def feature_frame(df: pd.DataFrame, spec: ModelSpec) -> pd.DataFrame:
    X = df[list(spec.cat) + list(spec.num)].copy()
    for c in spec.cat:
        X[c] = X[c].astype(object)
    for c in spec.num:
        X[c] = pd.to_numeric(X[c], errors="coerce").astype(float)
    return X


def build(spec: ModelSpec, seed=0, complexity=None) -> Pipeline:
    cat_mask = [True] * len(spec.cat) + [False] * len(spec.num)
    params = dict(TREE_PARAMS, random_state=seed)
    if complexity:
        params.update({k: v for k, v in complexity.items() if k != "name"})
    if spec.kind == "binary":
        est = HistGradientBoostingClassifier(categorical_features=cat_mask, **params)
    elif spec.kind == "count":
        est = HistGradientBoostingRegressor(categorical_features=cat_mask, loss="poisson", **params)
    else:
        est = HistGradientBoostingRegressor(categorical_features=cat_mask, loss="squared_error", **params)
    return Pipeline([
        ("dropout", CategoryDropout(columns=tuple(spec.cat), seed=seed)),
        ("prep", _preprocess(spec)),
        ("model", est),
    ])


class WeightedCalibrated:
    """A fitted pipeline + an isotonic calibrator, behaving like a calibrated classifier (predict_proba).
    Used when rows carry sampling weights (fraud from reviewed samples), where CalibratedClassifierCV would
    drop the weights from the inner fit."""

    def __init__(self, estimator, calibrator):
        self.estimator = estimator
        self.calibrator = calibrator
        self.classes_ = np.array([0, 1])

    def predict_proba(self, X):
        p = self.calibrator.predict(self.estimator.predict_proba(X)[:, 1])
        return np.column_stack([1 - p, p])


def target(df: pd.DataFrame, spec: ModelSpec) -> np.ndarray:
    """What the model learns. Demand learns the sell-through share (sales / capacity) so a model trained
    on 30,000-seat stadiums still makes sense for a 300-seat theatre; predictions are scaled back."""
    if spec.name == "demand":
        return (df["sales_48h"] / df["venue_capacity"]).to_numpy(dtype=float)
    return df[spec.label].to_numpy(dtype=float)


def predict(model, df: pd.DataFrame, spec: ModelSpec) -> np.ndarray:
    X = feature_frame(df, spec)
    if spec.kind == "binary":
        return model.predict_proba(X)[:, 1]
    p = model.predict(X)
    if spec.name == "demand":
        return np.clip(p, 0.0, 1.0) * df["venue_capacity"].to_numpy(dtype=float)
    return np.maximum(p, 0.0)
