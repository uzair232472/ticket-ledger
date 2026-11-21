# Fraud (flag for review) (`fraud`)

**Status: REJECTED**

Reasons:
- not clearly better than the baseline: 95% interval of the improvement is [-0.1422, -0.0662]

Data: `fraud_purchases.csv`, 50,000 rows, 2023-01-01 to 2025-12-31, source `synthetic-v0`.
Split by time: train 30,717 / validation 6,279 / test 7,500 rows (test from 2025-08-03); 1,248 rows purged at the cuts; 1,473 groups held out entirely. Leakage checks: passed.

## Main measure
share of flagged orders that are fraud (precision) (higher is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 0.8929 |
| Baseline (current rule / strategy baseline) | 0.9938 |
| Improvement | -0.1009 (95% interval -0.1422 to -0.0662) |

## Model complexity (chosen on the validation period only)
| Level | validation AUC | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 0.9746 | 0.0236 | yes |
| moderate | 0.9783 | 0.0162 | yes |
| simple (chosen) | 0.9784 | 0.0132 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train AUC - test AUC (memorising) | 0.0150 | <= 0.05 | pass |
| false flags among legitimate orders | 0.0033 | <= 0.01 | pass |
| share of frauds caught vs rules | 0.1399 | >= 0 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|
| customers_known | 4,930 | 0.9457 | 0.9931 |
| customers_unseen | 2,570 | 0.6500 | 1.0000 |
| events_known | 304 | - | too few cases to measure |
| events_unseen | 7,196 | 0.8929 | 0.9938 |
| human_speed | 7,327 | 0.5490 | 0.0000 |

## Learning curve (test AUC (higher is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 3,071 | 0.9312 |
| 25% | 7,679 | 0.9564 |
| 50% | 15,358 | 0.973 |
| 100% | 30,717 | 0.9765 |

Reading: score has levelled off: more data of the same kind adds little.

## Separate measures (not combined)
| Measure | Model (shadow) | Current rules | Role |
|---|---|---|---|
| Precision: flags confirmed as fraud | 0.8929 | 0.9938 | main measure |
| False flags among legitimate orders | 0.0033 | 0.0001 | limit <= 0.01 |
| Recall: frauds caught | 0.6826 | 0.5427 | tracked capability |
| Share of orders flagged | 0.0299 | 0.0213 | reviewer workload |

## Decision
Option 1: the existing rules stay the active decision-making system; the v0 fraud model runs in shadow only. The precision benchmark is not changed to let a synthetic-trained model pass. (2026-11-20)

- Keep: improved fraud recall and bot-detection capability (incl. human-speed bots) - tracked, not used
- Record: every shadow prediction, compared against verified fraud and verified legitimate outcomes
- Re-evaluate: on real client data once enough reviewed cases exist (minimums in ml/gates.py)
- Measures: precision (main), false-flag rate among legitimate orders (separate limit, <= 1%), recall (tracked) - reported separately, never combined

## Details
```json
{
  "test_auc": 0.9748,
  "test_brier": 0.0127,
  "baseline_auc": 0.7934,
  "threshold": 0.2394,
  "model_flags": {
    "precision": 0.8929,
    "false_flag_rate": 0.0033,
    "recall": 0.6826,
    "flag_rate": 0.0299
  },
  "rule_flags": {
    "precision": 0.9938,
    "false_flag_rate": 0.0001,
    "recall": 0.5427,
    "flag_rate": 0.0213
  }
}
```

## Final model
Refitted with the same settings on all 50,000 rows (2023-01-01 to 2025-12-31). Calibration: isotonic, 5-fold (CalibratedClassifierCV). It starts in shadow mode: it must also beat the rules on live data before an admin can promote it.

_Duration 24.3 s._
