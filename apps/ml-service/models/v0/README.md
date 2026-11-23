# v0 shadow models (synthetic data, shadow only)

The eight artifacts **and** `registry.json` are tracked in git (Step 6, portability Option 1), so every machine has
exactly the same files and fingerprints. `.gitignore` excepts only these files from `*.joblib`; every other
`.joblib` / `.pkl` (for example the legacy `apps/ml-service/models/*_model.joblib`) stays ignored.
`.gitattributes` marks them `binary`, so line-ending conversion never changes their bytes.

| File | Feature | SHA-256 (first 12) | Offline evaluation (synthetic data) | AI vs current rule |
|---|---|---|---|---|
| `intent.joblib` | A. Purchase intent | `5b1f3f56d07e` | PASSED | 82.7% vs 79.2% buyers in the top 10% |
| `abandonment.joblib` | B. Abandoned checkout (visit) | `3e30d171b25b` | PASSED | 51.6% vs 34.7% abandons in the top 10% |
| `checkout_abandonment.joblib` | B. Abandoned checkout (checkout start) | `5642e2102ffb` | PASSED | 50.8% vs 34.7% abandons in the top 10% |
| `fraud.joblib` | C. Fraud | `64280eaa9f22` | REJECTED (shadow only, recorded decision) | precision 80.6% vs 99.4%; catches 80.5% of frauds vs 33.4%; false flags 1.27% (limit 1%) |
| `demand.joblib` | F. Demand (first 48 h) | `68db22d6fa39` | PASSED | 35.5% vs 41.2% weighted error |
| `demand_hourly.joblib` | F. Demand (hourly, next 24 h) | `41769019da89` | REJECTED (shadow only, recorded decision) | 18.9% vs 67.3% weighted error; fails the memorising guard (0.64, needs 0.70) |
| `attendance.joblib` | G. Attendance (no-show) | `ecbffe07b529` | PASSED | 428 vs 479 average error in people per event |
| `crowd.joblib` | H. Crowd flow | `19c67dfbcd5c` | PASSED | 17.8 vs 21.6 scans error per gate per 5 min |

Trained on the synthetic datasets in `apps/ml-service/data/` (generator 2.2.0, training seed 0, scikit-learn 1.6.1,
Python 3.13). Generator 2.2.0 (2026-11-23) left `behavior_sequences`, `event_demand` and `crowd_flow` byte-identical,
so intent, abandonment, demand and crowd were not retrained. It added human-speed fraud (card testing / account
takeover), 3x the attendance events, and the `checkout_abandonment` and `demand_hourly` datasets; fraud, attendance
and the two new models were trained on it. All are **SHADOW** only: they score in the background, never decide
anything, and are never marked validated or READY. The two REJECTED models run in shadow by recorded decision
(`SHADOW_DECISIONS` in `ml/train.py`); the gates in `ml/gates.py` were not changed.

## Teammate setup (from a clean checkout)

Verified on 2026-11-22 from a clean export of the repository with a fresh virtual environment and an empty
database built from the migrations only. No retraining is needed.

    cd apps/ml-service
    python -m venv .venv
    .venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt     (macOS/Linux: .venv/bin/python)
    .venv\Scripts\python scripts\verify_v0_artifacts.py         # all eight "OK" (fingerprints + scikit-learn version)

    cd ../api
    npx prisma migrate deploy                                   # creates the MlModel / MlPrediction tables
    node scripts/ml-register-models.mjs                         # registers the eight as SHADOW in YOUR database

Start the ML service (`uvicorn main:app --port 8000`) with the same `ML_SERVICE_TOKEN` as the API's `.env`. The AI
monitor (`/admin/ai-monitor`) shows each model as SHADOW with "fingerprint verified".

The registration script only ever creates SHADOW rows with `mayServeDecisions=false`; re-running it changes
nothing. Without this setup the application still works: rules decide everything, the AI panels say "No
experimental model exists for this yet", and the tests that need artifacts skip.

**Do not run `python -m ml.train --allow-synthetic` without `--artifacts <another dir>`:** by default it writes into
this folder and would replace the committed files and `registry.json` with a rebuild that has different
fingerprints (`git status` would then show all six files modified; restore them with
`git restore apps/ml-service/models/v0`).

## Rebuild and compare (only to check reproducibility)

    python -m ml.train --allow-synthetic --artifacts <dir> --reports <reports dir>
    python scripts/verify_v0_artifacts.py --rebuilt <dir>

A rebuild is functionally identical to the committed files (same predictions on 20,000 rows per model, same
thresholds, features and evaluation; verified 2026-11-22) but not byte-identical (`created_at`, pickle byte order),
so its fingerprints differ.

## Replacing the committed artifacts (a reviewed change)

Only after a decision to replace them: copy the new files and `registry.json` here, commit all six together, and
run `node apps/api/scripts/ml-register-models.mjs` on each database. It retires the old SHADOW rows and registers
the new files, again as SHADOW only. Rollback: restore the previous six files from git and run the script with
`--restore`.
