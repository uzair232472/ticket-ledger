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

## Compared with the deployed model
NO_DEPLOYED_MODEL

## Recommendation (not acted on automatically)
KEEP_CURRENT: trained on synthetic data

## Details
```json
{
  "error_by_minutes_from_start": {
    "-90": {
      "model": 15.25,
      "baseline": 16.416,
      "rows": 466
    },
    "-85": {
      "model": 14.901,
      "baseline": 17.286,
      "rows": 466
    },
    "-80": {
      "model": 14.651,
      "baseline": 18.082,
      "rows": 466
    },
    "-75": {
      "model": 13.887,
      "baseline": 18.32,
      "rows": 466
    },
    "-70": {
      "model": 13.821,
      "baseline": 18.868,
      "rows": 466
    },
    "-65": {
      "model": 13.838,
      "baseline": 19.502,
      "rows": 466
    },
    "-60": {
      "model": 13.35,
      "baseline": 19.867,
      "rows": 466
    },
    "-55": {
      "model": 13.358,
      "baseline": 20.489,
      "rows": 466
    },
    "-50": {
      "model": 13.128,
      "baseline": 21.125,
      "rows": 466
    },
    "-45": {
      "model": 12.934,
      "baseline": 21.333,
      "rows": 466
    },
    "-40": {
      "model": 12.646,
      "baseline": 21.431,
      "rows": 466
    },
    "-35": {
      "model": 12.229,
      "baseline": 21.382,
      "rows": 466
    },
    "-30": {
      "model": 12.501,
      "baseline": 20.931,
      "rows": 466
    },
    "-25": {
      "model": 13.106,
      "baseline": 20.85,
      "rows": 466
    },
    "-20": {
      "model": 13.816,
      "baseline": 20.358,
      "rows": 466
    },
    "-15": {
      "model": 14.869,
      "baseline": 20.118,
      "rows": 466
    },
    "-10": {
      "model": 16.273,
      "baseline": 20.336,
      "rows": 466
    },
    "-5": {
      "model": 17.234,
      "baseline": 20.194,
      "rows": 466
    },
    "0": {
      "model": 19.086,
      "baseline": 20.629,
      "rows": 466
    },
    "5": {
      "model": 20.103,
      "baseline": 20.766,
      "rows": 466
    },
    "10": {
      "model": 21.469,
      "baseline": 21.7,
      "rows": 466
    },
    "15": {
      "model": 22.157,
      "baseline": 22.446,
      "rows": 466
    },
    "20": {
      "model": 23.484,
      "baseline": 23.487,
      "rows": 466
    },
    "25": {
      "model": 24.221,
      "baseline": 24.614,
      "rows": 466
    },
    "30": {
      "model": 25.036,
      "baseline": 25.721,
      "rows": 466
    },
    "35": {
      "model": 25.412,
      "baseline": 26.038,
      "rows": 466
    },
    "40": {
      "model": 25.468,
      "baseline": 25.986,
      "rows": 466
    },
    "45": {
      "model": 25.743,
      "baseline": 26.161,
      "rows": 466
    },
    "50": {
      "model": 25.523,
      "baseline": 26.072,
      "rows": 466
    },
    "55": {
      "model": 25.529,
      "baseline": 26.024,
      "rows": 466
    }
  },
  "error_by_event_type": {
    "BOXING": {
      "model": 15.699,
      "baseline": 15.342,
      "rows": 300
    },
    "CONFERENCE": {
      "model": 2.527,
      "baseline": 2.355,
      "rows": 660
    },
    "CRICKET_MATCH": {
      "model": 21.862,
      "baseline": 27.052,
      "rows": 6120
    },
    "FOOTBALL_MATCH": {
      "model": 18.387,
      "baseline": 25.233,
      "rows": 1050
    },
    "HOCKEY_MATCH": {
      "model": 13.78,
      "baseline": 16.562,
      "rows": 630
    },
    "KABADDI": {
      "model": 14.008,
      "baseline": 14.047,
      "rows": 960
    },
    "MUSIC_CONCERT": {
      "model": 21.761,
      "baseline": 24.379,
      "rows": 1920
    },
    "MUSIC_FESTIVAL": {
      "model": 17.125,
      "baseline": 22.81,
      "rows": 1140
    },
    "QAWWALI": {
      "model": 7.923,
      "baseline": 7.813,
      "rows": 600
    },
    "THEATRE": {
      "model": 2.756,
      "baseline": 2.759,
      "rows": 600
    }
  },
  "error_by_day_of_week": {
    "Friday": {
      "model": 14.642,
      "baseline": 17.723,
      "rows": 1440
    },
    "Monday": {
      "model": 15.68,
      "baseline": 20.393,
      "rows": 2760
    },
    "Saturday": {
      "model": 16.042,
      "baseline": 22.112,
      "rows": 2670
    },
    "Sunday": {
      "model": 18.961,
      "baseline": 22.008,
      "rows": 2070
    },
    "Thursday": {
      "model": 18.655,
      "baseline": 22.575,
      "rows": 1140
    },
    "Tuesday": {
      "model": 20.823,
      "baseline": 23.264,
      "rows": 2280
    },
    "Wednesday": {
      "model": 21.07,
      "baseline": 22.287,
      "rows": 1620
    }
  },
  "gate_level": {
    "gates": 466,
    "gates_where_model_better": 310
  }
}
```

_Duration 21.8 s._
