# v0 model reports

Data source: `synthetic-v0` (generator 2.3.0, seed 42). Each model is trained on the oldest 70% of its data, tuned on the next 15% and judged on the newest 15% against the rule the app uses today (or the AI strategy's baseline). Gates are in `ml/gates.py`.

| Model | Main measure | Model | Baseline | Improvement (95% interval) | Status |
|---|---|---|---|---|---|
| [Purchase intent](intent.md) | share of actual buyers among the top 10% scored visitors (higher is better) | 0.8272 | 0.7921 | 0.0351 (0.0204 to 0.0518) | **PASSED** |
| [Abandoned checkout](abandonment.md) | share of actual abandons among the top 10% scored checkouts (higher is better) | 0.5156 | 0.3468 | 0.1687 (0.1225 to 0.2179) | **PASSED** |
| [Abandoned checkout (checkout-based)](checkout_abandonment.md) | share of actual abandons among the top 10% scored checkouts (higher is better) | 0.5075 | 0.3468 | 0.1606 (0.1078 to 0.2061) | **PASSED** |
| [Fraud (flag for review)](fraud.md) | share of flagged orders that are fraud (precision) (higher is better) | 0.8770 | 0.9938 | -0.1168 (-0.1482 to -0.0879) | **REJECTED** |
| [Demand forecast (48-hour sales)](demand.md) | weighted % error of 48-hour sales (lower is better) | 0.3546 | 0.4119 | 0.0573 (0.0329 to 0.0816) | **PASSED** |
| [Demand after publication (next 24 h)](demand_hourly.md) | weighted % error of next-24-hour sales (zero sales handled) (lower is better) | 0.1890 | 0.6731 | 0.4842 (0.4347 to 0.5342) | **REJECTED** |
| [Attendance (no-show)](attendance.md) | average error in people attending per event (lower is better) | 428.3900 | 478.5691 | 50.1792 (11.5599 to 86.6236) | **PASSED** |
| [Crowd flow (scans per gate per 5 min)](crowd.md) | average error in scans per gate per 5 minutes (lower is better) | 17.8339 | 21.5511 | 3.7171 (2.6222 to 4.9639) | **PASSED** |

**None of these results authorizes production use.** They come from synthetic data. PASSED models, and the fraud model by recorded decision (Option 1), ship in SHADOW mode only: they score live traffic in the background, every prediction is logged against the real outcome, and the rules keep making every decision. A model can only serve decisions after it passes this evaluation on the client's own data, passes the live shadow check, and an admin approves it.

Attendance baseline: see [attendance_baseline_comparison.md](attendance_baseline_comparison.md).
