# Attendance (no-show) (`attendance`)

**Status: PASSED**

Data: `attendance_no_show.csv`, 150,000 rows, 2023-01-10 to 2025-12-29, source `synthetic-v0`.
Split by time: train 94,552 / validation 20,016 / test 22,500 rows (test from 2025-07-30); 550 rows purged at the cuts; 1,795 groups held out entirely. Leakage checks: passed.

## Main measure
average error in people attending per event (lower is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 428.3900 |
| Baseline (current rule / strategy baseline) | 478.5691 |
| Improvement | 50.1792 (95% interval 11.5599 to 86.6236) |

## Model complexity (chosen on the validation period only)
| Level | validation AUC | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 0.6755 | 0.0325 | yes |
| moderate | 0.677 | 0.0117 | yes |
| simple (chosen) | 0.6777 | 0.0066 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train AUC - test AUC (memorising) | 0.0005 | <= 0.05 | pass |
| calibration error (ECE) | 0.0069 | <= 0.05 | pass |
| per-ticket balanced accuracy vs baseline (0.5) | 0.6363 | >= 0.5 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| customers_known | 17,264 | 355.8413 | 1660.6101 |
| customers_unseen | 5,236 | 177.6430 | 5160.5132 |
| first_time_attendees | 2,106 | 99.4435 | 6093.1094 |
| returning_attendees | 20,394 | 396.7822 | 787.1622 |

## Learning curve (test AUC (higher is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 9,455 | 0.6658 |
| 25% | 23,638 | 0.6742 |
| 50% | 47,276 | 0.6768 |
| 100% | 94,552 | 0.6838 |

Reading: more data would likely still help.

## Compared with the deployed model
NO_DEPLOYED_MODEL

## Recommendation (not acted on automatically)
KEEP_CURRENT: trained on synthetic data

## Details
```json
{
  "test_auc": 0.6835,
  "test_brier": 0.1228,
  "current_fixed_rule_error": 673.9,
  "no_show_threshold": 0.8574,
  "average_event_attendance": 6685.4
}
```

_Duration 42.8 s._
