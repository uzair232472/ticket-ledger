# Attendance (no-show) (`attendance`)

**Status: REJECTED**

Reasons:
- not clearly better than the baseline: 95% interval of the improvement is [-31.9056, 123.0016]

Data: `attendance_no_show.csv`, 50,000 rows, 2023-01-23 to 2025-12-29, source `synthetic-v0`.
Split by time: train 31,408 / validation 6,611 / test 7,500 rows (test from 2025-08-15); 200 rows purged at the cuts; 1,491 groups held out entirely. Leakage checks: passed.

## Main measure
average error in people attending per event (lower is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 393.3550 |
| Baseline (current rule / strategy baseline) | 432.7696 |
| Improvement | 39.4146 (95% interval -31.9056 to 123.0016) |

## Model complexity (chosen on the validation period only)
| Level | validation AUC | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 0.6297 | 0.1104 | no |
| moderate | 0.6323 | 0.059 | no |
| simple (chosen) | 0.6379 | 0.0372 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train AUC - test AUC (memorising) | 0.0351 | <= 0.05 | pass |
| calibration error (ECE) | 0.0200 | <= 0.05 | pass |
| per-ticket balanced accuracy vs baseline (0.5) | 0.6084 | >= 0.5 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| customers_known | 4,850 | 328.7770 | 2413.9402 |
| customers_unseen | 2,650 | 209.2200 | 4404.0150 |
| first_time_attendees | 1,694 | 168.5725 | 5258.1215 |

## Learning curve (test AUC (higher is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 3,140 | 0.5886 |
| 25% | 7,852 | 0.623 |
| 50% | 15,704 | 0.6273 |
| 100% | 31,408 | 0.64 |

Reading: more data would likely still help.

## Details
```json
{
  "test_auc": 0.638,
  "test_brier": 0.1298,
  "current_fixed_rule_error": 638.7,
  "no_show_threshold": 0.8507,
  "average_event_attendance": 6781.1
}
```

_Duration 7.5 s._
