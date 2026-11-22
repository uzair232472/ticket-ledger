# v0 shadow models (synthetic data, shadow only)

The five artifacts **and** `registry.json` are tracked in git (Step 6, portability Option 1), so every machine has
exactly the same files and fingerprints. `.gitignore` excepts only these five files from `*.joblib`; every other
`.joblib` / `.pkl` (for example the legacy `apps/ml-service/models/*_model.joblib`) stays ignored.
`.gitattributes` marks them `binary`, so line-ending conversion never changes their bytes.

| File | Feature | SHA-256 (first 12) | Offline evaluation (synthetic data) |
|---|---|---|---|
| `intent.joblib` | A. Purchase intent | `5b1f3f56d07e` | PASSED |
| `abandonment.joblib` | B. Abandoned checkout (visit) | `3e30d171b25b` | PASSED |
| `fraud.joblib` | C. Fraud | `6ac94abf8702` | REJECTED (kept in shadow only by recorded decision) |
| `demand.joblib` | F. Demand (first 48 h) | `68db22d6fa39` | PASSED |
| `crowd.joblib` | H. Crowd flow | `19c67dfbcd5c` | PASSED |

Trained on the synthetic v0 datasets in `apps/ml-service/data/` (training seed 0, scikit-learn 1.6.1, Python 3.13).
All are **SHADOW** only: they score in the background, never decide anything, and are never marked validated or
READY. Attendance was evaluated too and REJECTED, so it has no artifact.

## Teammate setup (from a clean checkout)

Verified on 2026-11-22 from a clean export of the repository with a fresh virtual environment and an empty
database built from the migrations only. No retraining is needed.

    cd apps/ml-service
    python -m venv .venv
    .venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt     (macOS/Linux: .venv/bin/python)
    .venv\Scripts\python scripts\verify_v0_artifacts.py         # all five "OK" (fingerprints + scikit-learn version)

    cd ../api
    npx prisma migrate deploy                                   # creates the MlModel / MlPrediction tables
    node scripts/ml-register-models.mjs                         # registers the five as SHADOW in YOUR database

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
