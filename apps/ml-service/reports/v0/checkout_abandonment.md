# Abandoned checkout (checkout-based) (`checkout_abandonment`)

**Status: PASSED**

Data: `checkout_abandonment.csv`, 19,318 rows, 2023-01-01 to 2025-12-24, source `synthetic-v0`.
Split by time: train 12,265 / validation 2,592 / test 2,898 rows (test from 2025-07-31); 31 rows purged at the cuts; 900 groups held out entirely. Leakage checks: passed.

## Main measure
share of actual abandons among the top 10% scored checkouts (higher is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 0.5075 |
| Baseline (current rule / strategy baseline) | 0.3468 |
| Improvement | 0.1606 (95% interval 0.1078 to 0.2061) |

## Model complexity (chosen on the validation period only)
| Level | validation AUC | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 0.6035 | 0.1473 | no |
| moderate | 0.615 | 0.0656 | no |
| simple (chosen) | 0.6179 | 0.0351 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train AUC - test AUC (memorising) | 0.0027 | <= 0.05 | pass |
| calibration error (ECE) | 0.0271 | <= 0.05 | pass |
| first-time customers/visitors: top-10% share vs rule | 0.1958 | >= 0 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| customers_known | 1,455 | 0.4589 | 0.3262 |
| customers_unseen | 1,443 | 0.5720 | 0.3661 |
| events_known | 193 | 0.6510 | 0.3362 |
| events_unseen | 2,705 | 0.5034 | 0.3477 |
| first_time_customers | 1,186 | 0.5697 | 0.3739 |
| returning_customers | 1,712 | 0.4592 | 0.3257 |

## Learning curve (test AUC (higher is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 1,226 | 0.5 |
| 25% | 3,066 | 0.6338 |
| 50% | 6,132 | 0.6442 |
| 100% | 12,265 | 0.6502 |

Reading: score has levelled off: more data of the same kind adds little.

## Compared with the deployed model
NO_DEPLOYED_MODEL

## Recommendation (not acted on automatically)
KEEP_CURRENT: trained on synthetic data

## Details
```json
{
  "test_auc": 0.6479,
  "test_brier": 0.1968,
  "baseline_auc": 0.5658,
  "model_top10_false_predictions": {
    "false_alarm_share": 0.4828,
    "completed_checkouts_flagged": 0.0686,
    "abandons_missed": 0.825
  },
  "rule_top10_false_predictions": {
    "false_alarm_share": 0.6621,
    "completed_checkouts_flagged": 0.0941,
    "abandons_missed": 0.8856
  },
  "calibration_error_ece": 0.0271
}
```

_Duration 4.0 s._
