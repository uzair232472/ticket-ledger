# Crowd flow (scans per gate per 5 min) (`crowd`)

**Status: PASSED**

Data: `crowd_flow.csv`, 92,100 rows, 2023-01-24 to 2025-12-30, source `synthetic-v0`.
Split by time: train 58,320 / validation 12,390 / test 13,980 rows (test from 2025-08-19); 60 rows purged at the cuts; 100 groups held out entirely. Leakage checks: passed.

## Main measure
average error in scans per gate per 5 minutes (lower is better), newest 15% of the data:

| | Value |
|---|---|
| Model | 17.8339 |
| Baseline (current rule / strategy baseline) | 21.5511 |
| Improvement | 3.7171 (95% interval 2.6222 to 4.9639) |

## Model complexity (chosen on the validation period only)
| Level | validation error | Train vs validation | Not memorising |
|---|---|---|---|
| flexible | 17.5468 | 0.6797 | no |
| moderate | 17.2269 | 0.8108 | yes |
| simple (chosen) | 17.1301 | 0.9286 | yes |

## Must not get worse
| Check | Value | Limit | |
|---|---|---|---|
| train error / test error (memorising) | 0.8920 | >= 0.7 | pass |
| peak-time error vs baseline | -9.5247 | <= 0 (not worse) | pass |

## Known vs unseen customers / events, segments
| Group | Rows | Model | Baseline |
|---|---|---|---|

## Learning curve (test error (lower is better))
| Share of training data | Rows | Value |
|---|---|---|
| 10% | 5,832 | 18.3908 |
| 25% | 14,580 | 17.8336 |
| 50% | 29,160 | 17.784 |
| 100% | 58,320 | 17.8339 |

Reading: score has levelled off: more data of the same kind adds little.

_Duration 25.3 s._
