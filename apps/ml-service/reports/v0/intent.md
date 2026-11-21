# Purchase intent (`intent`)

**Status: PASSED**

Data: `behavior_sequences.csv`, 100,000 rows, 2023-01-01 to 2025-12-24, source `synthetic-v0`.
Split by time: train 62,656 / validation 13,056 / test 15,000 rows (test from 2025-07-29); 1,178 rows purged at the cuts; 1,746 groups held out entirely. Leakage checks: passed.

## Main measure
share of actual buyers among the top 10% scored visitors (higher is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 0.8272 |
| Baseline (current rule / strategy baseline) | 0.7921 |
| Improvement | 0.0351 (95% interval 0.0204 to 0.0518) |

## Model complexity (chosen on the validation period only)
| Level | validation AUC | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 0.9176 | 0.0188 | yes |
| moderate | 0.9186 | 0.0082 | yes |
| simple (chosen) | 0.9191 | 0.0034 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train AUC - test AUC (memorising) | 0.0071 | <= 0.05 | pass |
| calibration error (ECE) | 0.0080 | <= 0.05 | pass |
| first-time visitors: top-10% share vs rule | 0.0232 | >= 0 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| customers_known | 11,144 | 0.8318 | 0.7897 |
| customers_unseen | 3,856 | 0.8075 | 0.7970 |
| events_known | 940 | 0.8241 | 0.8135 |
| events_unseen | 14,060 | 0.8282 | 0.7906 |
| first_time_visitors | 1,845 | 0.7821 | 0.7590 |

## Learning curve (test AUC (higher is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 6,265 | 0.9092 |
| 25% | 15,664 | 0.9135 |
| 50% | 31,328 | 0.914 |
| 100% | 62,656 | 0.9154 |

Reading: score has levelled off: more data of the same kind adds little.

## Details
```json
{
  "test_auc": 0.9141,
  "test_brier": 0.0703,
  "baseline_auc": 0.8858
}
```

_Duration 16.7 s._
