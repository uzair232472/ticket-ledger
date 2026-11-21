# Legacy formula-generated datasets (superseded)

These are the original Module 14 datasets and their generator (`generate_synthetic_data_v1.py`).

**Do not use them to train production models.** Each label was calculated from the same columns the
model trained on, so a model only learns the formula back. That is why the old scores were nearly
perfect (fraud F1 = 1.0, demand R² = 0.996). The files also have no IDs or timestamps, so time-based
tests and leakage checks are impossible. Some columns (weather, marketing score, IP-city mismatch) are
not recorded by the app.

The `test_*.csv` files are the held-out 15% copies written by the old training scripts. They are not
extra data.

They are kept only because the legacy endpoints (`main.py` → `/train/*`, via
`scripts/train_*_model.py` and `scripts/evaluate_models.py`) still read them. The new training
pipeline replaces those endpoints.

The current datasets are in `../../data/` (see its README).
