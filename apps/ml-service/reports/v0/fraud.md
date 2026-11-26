# Fraud (flag for review) (`fraud`)

**Status: REJECTED**

Reasons:
- not clearly better than the baseline: 95% interval of the improvement is [-0.1482, -0.0879]

Data: `fraud_purchases.csv`, 51,500 rows, 2023-01-01 to 2025-12-31, source `synthetic-v0`.
Split by time: train 31,872 / validation 6,358 / test 7,725 rows (test from 2025-08-02); 1,346 rows purged at the cuts; 1,518 groups held out entirely. Leakage checks: passed.

## Main measure
share of flagged orders that are fraud (precision) (higher is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 0.8770 |
| Baseline (current rule / strategy baseline) | 0.9938 |
| Improvement | -0.1168 (95% interval -0.1482 to -0.0879) |

## Model complexity (chosen on the validation period only)
| Level | validation AUC | Train vs validation | Not memorising |
|---|---|---|---|
| flexible (chosen) | 0.9898 | 0.0096 | yes |
| moderate | 0.9895 | 0.009 | yes |
| simple | 0.9886 | 0.0073 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train AUC - test AUC (memorising) | 0.0083 | <= 0.05 | pass |
| false flags among legitimate orders | 0.0086 | <= 0.01 | pass |
| share of frauds caught vs rules | 0.5945 | >= 0 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| customers_known | 4,930 | 0.9189 | 0.9934 |
| customers_unseen | 2,795 | 0.8327 | 1.0000 |
| events_known | 324 | - | too few cases to measure |
| events_unseen | 7,401 | 0.8785 | 0.9938 |
| human_speed | 7,552 | 0.8157 | 0.0000 |
| first_time_customers | 1,684 | 0.6321 | 0.0000 |
| returning_customers | 6,041 | 0.9422 | 0.9938 |

## Learning curve (test AUC (higher is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 3,187 | 0.9834 |
| 25% | 7,968 | 0.9894 |
| 50% | 15,936 | 0.9911 |
| 100% | 31,872 | 0.9911 |

Reading: score has levelled off: more data of the same kind adds little.

## Separate measures (not combined)
| Measure | Model (shadow) | Current rules | Role |
|---|---|---|---|
| Precision: flags confirmed as fraud | 0.877 | 0.9938 | main measure |
| False flags among legitimate orders | 0.0086 | 0.0001 | limit <= 0.01 |
| Recall: frauds caught | 0.9286 | 0.334 | tracked capability |
| Share of orders flagged | 0.0652 | 0.0207 | reviewer workload |

## Compared with the deployed model
NO_DEPLOYED_MODEL

## Recommendation (not acted on automatically)
KEEP_CURRENT: the candidate did not pass the evaluation gates

## Decision
Option 1: the existing rules stay the active decision-making system; the v0 fraud model runs in shadow only. The precision benchmark is not changed to let a synthetic-trained model pass. (2026-11-20)

- Keep: improved fraud recall and bot-detection capability (incl. human-speed bots) - tracked, not used
- Record: every shadow prediction, compared against verified fraud and verified legitimate outcomes
- Re-evaluate: on real client data once enough reviewed cases exist (minimums in ml/gates.py)
- Measures: precision (main), false-flag rate among legitimate orders (separate limit, <= 1%), recall (tracked) - reported separately, never combined

## Details
```json
{
  "test_auc": 0.9907,
  "test_brier": 0.007,
  "baseline_auc": 0.6806,
  "threshold": 0.1136,
  "sampling_weighted": false,
  "baseline_is_logged_rule_decision": false,
  "model_flags": {
    "precision": 0.877,
    "false_flag_rate": 0.0086,
    "recall": 0.9286,
    "flag_rate": 0.0652
  },
  "rule_flags": {
    "precision": 0.9938,
    "false_flag_rate": 0.0001,
    "recall": 0.334,
    "flag_rate": 0.0207
  }
}
```

## Final model
Refitted with the same settings on all 51,500 rows (2023-01-01 to 2025-12-31). Calibration: isotonic, 5-fold (CalibratedClassifierCV). It starts in shadow mode: it must also beat the rules on live data before an admin can promote it.

_Duration 33.0 s._
