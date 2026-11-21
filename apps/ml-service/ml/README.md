# Training pipeline (`ml/`)

```
python scripts/validate_datasets.py          # runs automatically before training too
python -m ml.train --allow-synthetic         # v0: all six models on data/ (synthetic)
python -m ml.train --data <export dir>       # production: data exported from the database
python -m pytest tests -q                    # pipeline tests
python scripts/auto_retrain.py --data <export dir>   # real data: candidates only, never promoted
```

Real-data retraining (export, verified labels, sufficiency, comparison with the deployed model) is described in
`docs/ml-real-data-retraining.md`.

Reports are written to `reports/v0/` (`README.md` summary, plus a `.md` and `.json` per model).
Artifacts of PASSED models go to `models/v0/<model>.joblib`, which is git-ignored and rebuilt by the
command above. Training all six takes about 1-2 minutes on a CPU.

## What happens for each model

| Step | Where | What |
|---|---|---|
| 1 | `evaluate.load` | Read the dataset; add the as-of baseline columns |
| 2 | `splits.time_split` | Split by time: oldest 70% train / next 15% validation / newest 15% test. Purge rows whose label reaches past a cut. Hold out 10% of customers (organizers, events) entirely |
| 3 | `splits.assert_no_leakage` | Re-check everything in step 2. Any failure stops the run |
| 4 | `evaluate._select_complexity` | Choose the model complexity (flexible / moderate / simple) using **validation only**: the best one that doesn't memorise |
| 5 | `evaluate._prepare_context` | Using validation only: probability calibration (isotonic), fraud flag threshold (1% false flags), no-show threshold, demand range width (split-conformal 80%) |
| 6 | `evaluate.main_measure` | Model vs baseline on the newest 15%, in the AI strategy's measures |
| 7 | `evaluate.bootstrap_improvement` | 95% interval of the improvement, resampling whole events. It must be above zero |
| 8 | `evaluate._guards` | Must-not-get-worse checks, train-vs-test gap, first-time visitors, false flags, range coverage, peak times |
| 9 | `evaluate._known_unseen` | Results for known vs unseen customers and events, plus segments |
| 10 | `evaluate._learning_curve` | Scores with 10/25/50/100% of the training data: is more data still helping? |
| 11 | `evaluate._final_artifact` | PASSED only: refit on **all** rows with the chosen settings. The model then starts in shadow mode in the app |

The gates in `gates.py` were fixed before any model was evaluated and are copied into every report.
The baselines in `baselines.py` are the rules the app uses today, or the strategy's stated baselines.
They are computed "as of" each row; tests prove that changing future data never changes them.

## Unknown event types, cities and countries
Categories seen fewer than 20 times are grouped as "infrequent". Unseen ones become "missing". While
training, 3% of category values are blanked at random, so the model has learned a sensible default
instead of guessing a neighbouring category.
