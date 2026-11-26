# Demand forecast (48-hour sales) (`demand`)

**Status: PASSED**

Data: `event_demand.csv`, 5,000 rows, 2023-01-01 to 2025-12-19, source `synthetic-v0`.
Split by time: train 3,108 / validation 662 / test 751 rows (test from 2025-07-15); 18 rows purged at the cuts; 15 groups held out entirely. Leakage checks: passed.

## Main measure
weighted % error of 48-hour sales (lower is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 0.3546 |
| Baseline (current rule / strategy baseline) | 0.4119 |
| Improvement | 0.0573 (95% interval 0.0329 to 0.0816) |

## Model complexity (chosen on the validation period only)
| Level | validation error | Train vs validation | Not memorising |
|---|---|---|---|
| flexible (chosen) | 0.3338 | 0.8026 | yes |
| moderate | 0.3423 | 0.9211 | yes |
| simple | 0.3582 | 0.9517 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train error / test error (memorising) | 0.7556 | >= 0.7 | pass |
| range holds the real number | 0.8003 | >= 0.75 | pass |
| range coverage vs baseline range | 0.0346 | >= -0.02 | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| organizers_known | 663 | 0.3518 | 0.4065 |
| organizers_unseen | 88 | 0.3765 | 0.4549 |
| organizer_first_event | 0 | - | - |

## Learning curve (test weighted % error (lower is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 310 | 0.3623 |
| 25% | 777 | 0.3584 |
| 50% | 1,554 | 0.3515 |
| 100% | 3,108 | 0.3546 |

Reading: score has levelled off: more data of the same kind adds little.

## Compared with the deployed model
NO_DEPLOYED_MODEL

## Recommendation (not acted on automatically)
KEEP_CURRENT: trained on synthetic data

## Details
```json
{
  "model_mae_tickets": 1365.9,
  "baseline_mae_tickets": 1586.7,
  "range_width_share": 0.1559
}
```

_Duration 2.9 s._
