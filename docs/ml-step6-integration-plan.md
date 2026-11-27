# Step 6: AI integration plan (approved 2026-11-22)

Status: **approved with conditions on 2026-11-22; implementation local only.** Nothing is pushed, deployed or
promoted. Live payments stay off; JazzCash / EasyPaisa are not implemented.

Related: `docs/ml-step5-data-readiness.md`, `docs/ml-real-data-retraining.md`, `docs/platform-readiness-plan.md`.

## Approved decisions

| # | Decision |
|---|---|
| 1 | Customer recommendations are built behind `ML_REC_DISPLAY=false` (off by default). CONTROL and PERSONALISED look identical. |
| 2 | Organizers see aggregate summaries only, never an individual customer's experimental score or prediction. |
| 3 | Legacy ML endpoints require SUPER_ADMIN and are rate-limited; anonymous access is verified to fail. |
| 4 | The checkout-block wording no longer says "AI"; the security rules keep working exactly as before. |
| 5 | v0 models: check the development database first; register only verified artifacts, as SHADOW. `registry.json` is tracked; the artifacts must be reproducible or retrievable. Synthetic models are never validated or READY. |
| 6 | No index is added automatically: demonstrate the need, explain the index, ask before any migration. |

Conditions: all eight features stay shadow/development; predictions never control payments, bookings, refunds,
ticket admission, gate operations, pricing or accounts; no synchronous ML call in checkout or other critical
journeys; demand what-ifs never apply prices or publish; fraud review stays blind; existing rules and fallbacks
remain; the application behaves identically with the ML service unavailable (tested); no accuracy or performance
figure is shown without enough real outcomes.

## 0. Starting point (review of 2026-11-22)

| Feature | Decides today (stays in control) | Model available | In the app before Step 6 |
|---|---|---|---|
| A. Purchase intent | `intentRule` (visits.js), the rule score in `intentAnalyticsService` | v0 synthetic, SHADOW | behind `COMING_SOON.purchaseIntent` |
| B. Abandoned checkout | rules + organizer-triggered reminders | v0 synthetic (`abandonment`); `checkout_abandonment` none | `AbandonedIntentDashboard` (rules) |
| C. Fraud | `/fraud/score` rules-only; rules block checkout at CRITICAL_BOT | v0 REJECTED, kept in shadow | blind review + watchlist |
| D. Customer behaviour | no model; reports | none | behind `COMING_SOON.behaviorAnalysis` |
| E. Recommendations | rules ranking with CONTROL / PERSONALISED | none (rules) | not displayed |
| F. Demand | rule baseline (flat 78%) | v0 synthetic, SHADOW | behind `COMING_SOON.demandForecast` |
| G. Attendance | historical show rate | none | not displayed |
| H. Crowd flow | per gate x 5-minute rule baseline | v0 synthetic, SHADOW | not displayed |

Issues found: the checkout block said "blocked by TicketLedger AI"; the publish-time advice claimed
"historical telemetry" (hardcoded text); a comment called the intent rule "ML"; the legacy ML endpoints accepted
anonymous calls and, in development, could answer from a synthetic model; `models/v0/` was untracked.

## 1. Principles

1. Rules decide everything; decision code never reads model output (tested).
2. AI output appears only as display, labelled "Experimental: not used for any decision", with source,
   status and `validated: false`.
3. No new synchronous model call on any request path except the demand what-if (one call, 300 ms, never
   stored, never applied).
4. Organizers: aggregates only.
5. Fraud review stays blind; fraud model figures are SUPER_ADMIN aggregates only.
6. Off by default in production.

## 2. Data flow

Request path (unchanged): rules decide → response. `recordShadow` (setImmediate) and the 15-minute jobs log
RULES + SHADOW rows into `MlPrediction`; outcomes are attached later. New, read-only: `services/ml/insights.js`
and `services/ml/monitor.js` read those rows and serve `/api/ml/insights/*` and `/api/ml/monitor*`.

Every insight response:

```json
{
  "decision_source": "rules",
  "rules": {},
  "experimental": { "status": "SHADOW", "may_serve_decisions": false, "validated": false,
                    "model": "demand", "version": "v0", "source": "synthetic-v0", "sha256_12": "…",
                    "value": {}, "unavailable_reason": null },
  "evaluation": { "status": "NOT_ENOUGH_DATA", "rows_with_outcome": 0 }
}
```

## 3. Backend

Endpoints:

| Endpoint | Guard | Feature |
|---|---|---|
| `GET /api/ml/flags` | public | flags |
| `GET /api/ml/monitor` | SUPER_ADMIN | all |
| `GET /api/ml/insights/events/:id/intent` | `attendee.view`, own organization | A |
| `GET /api/ml/insights/events/:id/abandonment` | `attendee.view`, own organization | B |
| `GET /api/ml/insights/events/:id/demand` (+ what-if) | `event.pricing`, own organization | F |
| `GET /api/ml/insights/events/:id/attendance` | `event.view`, own organization | G |
| `GET /api/ml/insights/events/:id/crowd` | `gate.supervise`, own organization | H |
| `GET /api/ml/insights/behaviour` | SUPER_ADMIN | D |
| `GET /api/ml/insights/fraud` | SUPER_ADMIN | C (aggregates) |
| `POST /api/events/recommendations/:listId/rendered` | optional auth | E |

Flags: `ML_INSIGHTS_ENABLED` (dev true, production false), `ML_INSIGHTS_ORGANIZER` (false),
`ML_REC_DISPLAY` (false); existing `ML_SHADOW_ENABLED`, `ML_SNAPSHOTS_ENABLED`.

Changes: checkout-block wording (`blockedByRules`, `blockedByAI` kept one release, deprecated); demand copy
relabelled as rule estimates; legacy ML endpoints SUPER_ADMIN + rate limit; recommendation impressions counted
on render.

## 4. ML service

`GET /v2/health` (registry, fingerprints, scikit-learn match, source class) and `GET /v2/metrics` (in-memory
counters). `may_serve_decisions: false` everywhere. No change to training, gates, registry format or
`/fraud/score`.

## 5. Screens

New `/admin/ai-monitor`; PurchaseIntentAnalytics, BehaviorProfile and DemandForecast un-gated with honest
content; aggregate panels on AbandonedIntentDashboard, EventTools (attendance), GateManagement (crowd);
recommendation rows on home, event page and wishlist behind `ML_REC_DISPLAY`. AdminFraudReview unchanged.

## 6. Fallbacks

ML down / slow / 409 / no model / too few outcomes / insights error / flag off: rules continue, panels say why
or hide; the monitor shows error rates and stale jobs. No figure without enough outcomes.

## 7. Tests

Static decision-path guard extended; envelope invariants; fraud blindness on new endpoints; RBAC and
organization scope; flags; ML-down equivalence of checkout, gate and payment results; per-feature tests;
ML service contract tests; frontend helper tests, offline renders and `vite build`; full regression.

## 8. Phases

6.1 guards and wording → 6.2 backend insights / monitor → 6.3 ML service health / metrics → 6.4 AI Monitor →
6.5 staff screens → 6.6 recommendation display (flag off) → 6.7 full tests and docs. One final report; no
commit until approved.
