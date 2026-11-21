# Attendance baseline: historical average vs current fixed rule

**Recommendation: replace**

Fixed rule (today, `organizerDashboardService`): 92.4% cricket, 86.8% music, 89.1% kabaddi, 88.5% otherwise, +2 points in Lahore/Karachi. Historical average: tickets sold x average show rate of past finished events of the same type (all types until 200 tickets of history; before any history, the fixed rule itself), computed as of each event.

Caveat: on synthetic data the fixed rule's percentages do not match the simulated show rate, so part of its error is built in. What this shows is that the historical average corrects itself to the actual show rate and the fixed rule cannot; the client's check-ins decide the real numbers.

Measure: average error in people attending per event (lower is better). Same leakage-free split as the models; 95% bootstrap over events.

| Period | Events | Historical average | Fixed rule | Improvement (95% interval) | Bias hist. / fixed | Clearly better |
|---|---|---|---|---|---|---|
| test period (newest 15%) | 150 | 432.8 | 638.7 | 205.9 (102.0 to 301.5) | +18.4 / +533.2 | yes |
| all events after the first 15% (burn-in) | 850 | 449.5 | 579.9 | 130.4 (88.8 to 175.5) | -37.0 / +469.7 | yes |

Bias = average (predicted - actual) people per event; positive means over-predicting attendance.

Synthetic data: this shows the method is sound and leakage-free. The client's own check-ins decide the real show rates once events have run.
