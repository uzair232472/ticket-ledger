# Abandoned checkout (`abandonment`)

**Status: PASSED**

Data: `behavior_sequences.csv`, 19,318 rows, 2023-01-01 to 2025-12-24, source `synthetic-v0`.
Split by time: train 12,111 / validation 2,584 / test 2,898 rows (test from 2025-07-31); 31 rows purged at the cuts; 900 groups held out entirely. Leakage checks: passed.

## Main measure
share of actual abandons among the top 10% scored checkouts (higher is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 0.5156 |
| Baseline (current rule / strategy baseline) | 0.3468 |
| Improvement | 0.1687 (95% interval 0.1225 to 0.2179) |

## Model complexity (chosen on the validation period only)
| Level | validation AUC | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 0.6166 | 0.1211 | no |
| moderate | 0.622 | 0.0619 | no |
| simple (chosen) | 0.6236 | 0.031 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train AUC - test AUC (memorising) | 0.0066 | <= 0.05 | pass |
| calibration error (ECE) | 0.0239 | <= 0.05 | pass |
| first-time customers/visitors: top-10% share vs rule | 0.1179 | >= 0 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| customers_known | 1,443 | 0.4800 | 0.3214 |
| customers_unseen | 1,455 | 0.5460 | 0.3708 |
| events_known | 194 | 0.5579 | 0.3419 |
| events_unseen | 2,704 | 0.5131 | 0.3473 |
| first_time_visitors | 299 | 0.5132 | 0.3953 |
| returning_visitors | 2,599 | 0.5158 | 0.3408 |

## Learning curve (test AUC (higher is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 1,211 | 0.5 |
| 25% | 3,027 | 0.6191 |
| 50% | 6,055 | 0.6386 |
| 100% | 12,111 | 0.648 |

Reading: more data would likely still help.

## Compared with the deployed model
NO_DEPLOYED_MODEL

## Recommendation (not acted on automatically)
KEEP_CURRENT: trained on synthetic data

## Details
```json
{
  "test_auc": 0.6444,
  "test_brier": 0.1967,
  "baseline_auc": 0.5658
}
```

_Duration 3.9 s._
