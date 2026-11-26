# Demand after publication (next 24 h) (`demand_hourly`)

**Status: REJECTED**

Reasons:
- guard failed: train error / test error (memorising) = 0.6384 (needs >= 0.7)

Data: `demand_hourly.csv`, 60,000 rows, 2023-01-01 to 2025-12-29, source `synthetic-v0`.
Split by time: train 37,128 / validation 6,804 / test 9,000 rows (test from 2025-07-17); 3,036 rows purged at the cuts; 15 groups held out entirely. Leakage checks: passed.

## Main measure
weighted % error of next-24-hour sales (zero sales handled) (lower is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 0.1890 |
| Baseline (current rule / strategy baseline) | 0.6731 |
| Improvement | 0.4842 (95% interval 0.4347 to 0.5342) |

## Model complexity (chosen on the validation period only)
| Level | validation error | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 0.1706 | 0.6552 | no |
| moderate (chosen) | 0.1675 | 0.7204 | yes |
| simple | 0.1999 | 0.9073 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train error / test error (memorising) | 0.6384 | >= 0.7 | FAIL |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| organizers_known | 8,340 | 0.1905 | 0.6739 |
| organizers_unseen | 660 | 0.1684 | 0.6635 |
| first_day_on_sale | 450 | 0.3379 | 1.0771 |
| last_week_before_event | 2,012 | 0.1016 | 0.3154 |

## Learning curve (test weighted % error (lower is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 3,712 | 0.3355 |
| 25% | 9,282 | 0.2254 |
| 50% | 18,564 | 0.1971 |
| 100% | 37,128 | 0.189 |

Reading: more data would likely still help.

## Compared with the deployed model
NO_DEPLOYED_MODEL

## Recommendation (not acted on automatically)
KEEP_CURRENT: the candidate did not pass the evaluation gates

## Decision
Kept in shadow only. On synthetic 2.2.0 data it is far more accurate than the rule (19% vs 67% weighted error) but fails the memorising guard (train/test error 0.64, needs >= 0.70), so it is REJECTED and never serves decisions. The guard is not changed. (2026-11-23)

- Keep: next-24-hour sales forecasts for events on sale - tracked, not used
- Record: every hourly shadow prediction, compared with the real next-24-hour sales
- Re-evaluate: on real exports once 30+ events are in the test period (ml/gates.py)
- Measures: weighted % error of next-24-hour sales (main), memorising guard

## Details
```json
{
  "zero_sales_note": null,
  "test_hours_with_zero_sales": 25
}
```

## Final model
Refitted with the same settings on all 60,000 rows (2023-01-01 to 2025-12-29). Calibration: n/a. It starts in shadow mode: it must also beat the rules on live data before an admin can promote it.

_Duration 24.1 s._
