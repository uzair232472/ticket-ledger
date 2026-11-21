# Proposed next phase: invited real users, safe genuine-data collection, path to validating the eight AI features

**Status: R0 approved and implemented locally (2026-11-22); R1–R6 not started, each still needs approval.** Written 2026-11-21 after the Step 5
final verification. Every item that touches production, payments, real users or external services needs
explicit authorisation at the step where it happens.

The goal is not to "turn on AI". It is to let a small number of invited, real customers buy real tickets
safely, so that genuine, verified data starts to accumulate. Every model stays shadow-only throughout this
phase; rules keep making every decision.

## Phase R0: blockers that must be fixed in code first (local, testable, no deployment)

> **R0 status (2026-11-22):**
>
> | Item | Status |
> |---|---|
> | R0.1–R0.3 | Done: fail-closed Stripe, disabled wallets and test checkout, startup check, idempotency, metadata |
> | R0.4 | Done: the 153 server tests were run in the sandbox. 110 pass, the same as before R0; the 43 earlier failures are listed in ml-step5 §13 |
> | R0.5 | Done: `ML_GENUINE_FROM`. The staff/invited-tester lists use the existing `ML_EXPORT_EXCLUDE_USERS` and internal domains |
> | R0.6 | Group stability done; impressions-on-render belongs with display (Step 6) |
> | R0.7 | Done; migration `20261124120000` applied to the main development database (2026-11-22: verified backup, rehearsal, business data unchanged) |
> | R0.8 | Reviewed: docs/email-readiness.md. **E1–E3 must be completed before the real-user beta (R4)**; E4–E7 are also needed for it |
| Closure | 43 server-test failures classified (docs/server-test-failures.md); cross-organizer pricing fixed; Stripe test-mode end-to-end steps in docs/stripe-test-mode-e2e.md (not yet run) |
>
> Resale purchases, which had no payment step at all, are now refused wherever real payments are required. A
> Stripe resale payment flow is new work.

| # | Item | Why it blocks |
|---|---|---|
| R0.1 | Payment verification fails closed in live mode (doc §11 B1); simulated JazzCash / EasyPaisa disabled when live | Today a "Stripe" order can be marked paid without Stripe |
| R0.2 | Startup refuses inconsistent payment configuration (§11 B2) | Prevents test keys in production and live keys in test |
| R0.3 | Database-enforced webhook idempotency (§11 B3); PaymentIntent metadata reduced to `orderId` (§11 B4) | Double processing; personal data sent to Stripe needlessly |
| R0.4 | Run the 153 unverified server tests with `scripts/test-server-suites.sh`, fix real failures | They are unverified, so the main purchase, resale, notification and minting flows are untested here |
| R0.5 | Explicit "genuine use began" date (`ML_GENUINE_FROM`), and staff and invited-tester account lists | Staff test purchases must not define the start, or enter datasets |
| R0.6 | Recommendation variant stability across login (§12.5); impressions logged on render (§12.2) | Otherwise the control comparison is contaminated |
| R0.7 | Exporter batching and indexes (§10), proven byte-identical on the fixtures | Required before data grows, not before the first invites |
| R0.8 | Email: production sender (domain with SPF, DKIM and DMARC, or a transactional provider), not a personal Gmail account | Gmail sending limits and deliverability; invites and receipts must arrive |

## Phase R1: a staging environment (separate from development and production)

- **Hosting:**
  - the API, the web app and the ML service on a host with HTTPS and a real domain;
  - managed PostgreSQL with automated, restore-tested backups;
  - Redis.
- **Secrets:** in the host's secret store, never in the repository; rotate the development secrets.
  `NODE_ENV=production` checks already require the QR signing key, the finance key and a strong JWT secret.
- **Payments:** test mode only, with its own Stripe sandbox and webhook secret. No real JazzCash / EasyPaisa.
- **Minting:** simulation or testnet only, decided separately.
- **Monitoring:** error tracking, uptime, an alert on payment-verification failures and webhook refusals, and
  the job logs (ML jobs, refunds, payouts).
- **Rehearsal:** the full checkout, refund, gate scan and resale flows by the team, the migrations, and a
  restore drill from backup.

## Phase R2: legal and data-protection basics (business decisions)

- **Customer documents:** terms of sale, refund policy and a privacy policy that says what is collected:
  - behaviour events, search text, sessions;
  - the guest-to-account link at login;
  - data used to improve services, with no automated decisions about the customer.
- **Retention:** how long behaviour events and IP / user-agent metadata are kept (today kept indefinitely),
  and a deletion request process.
- **Consent:** for analytics cookies, if the target jurisdiction requires it.
- **Organizers:** agreements for the invited organizers, covering payouts, fees and event content
  responsibility.

## Phase R3: live payments (needs explicit business authorisation)

1. Choose the provider path (§11 A: Stripe needs an entity in a supported country, or a real local gateway
   integration).
2. Live configuration and webhook (§11 C, D) on the production environment only.
3. The controlled staff purchase and refund verification (§11 E), excluded from the data.

## Phase R4: invited real users (closed beta)

- **Size:** a small number of invited organizers (e.g. 2–5) with real events, and invite-only customer
  sign-up (invite codes or an allow-list) that the admin can widen gradually.
- **Event guards:** every event goes through the existing approval flow, and gate capacities must be set
  (crowd data needs them).
- **Support:** a help-desk path (existing support module) and a clear way to report a problem.
- **Kill switches:**
  - pause sales per event;
  - disable a payment method;
  - stop recommendations;
  - stop ML jobs (`ML_SNAPSHOTS_ENABLED`, `ML_SHADOW_ENABLED`).

## Phase R5: genuine-data collection and monitoring (automatic once R3 and R4 run)

- **Exports:** a weekly export against a restored backup or a read replica, never the primary. It is
  validated by `validate_datasets.py` and `auto_retrain.py` without a schedule on production data until
  authorised.
- **Data-quality dashboard:**
  - genuine rows per dataset, and exclusions by source class;
  - snapshot exactness rate, capture lag, and missing snapshots (e.g. server down at sales open);
  - label completion: reviews done, unresolved, exposed.
- **Fraud review:** blind reviews keep running at the sampling rates; the reviewer workload is planned
  (sampled orders per week).
- **Recommendations:** displayed with the control group once approved in Step 6.

## Phase R6: path to validating the eight features (no promotion without a separate decision)

Each feature is evaluated only when its own minimums (ml/gates.py, unchanged) are met on genuine data. It
is compared on the same rows with the rules and the deployed shadow model, with first-time and returning
customers reported separately. A passing evaluation produces a **recommendation**, not a deployment.

| Feature | First data | Likely time to minimums (depends on volume) | Notes |
|---|---|---|---|
| E. Recommendations | first sessions after display | weeks | CTR / purchase uplift vs control; needs Step 6 display |
| A. Purchase intent, B. Abandoned checkout | first visits and checkouts | 1–3 months | 800 buyers / 800 non-buyers for intent |
| D. Customer behaviour | first repeat customers | months | Reports first; no model decisions |
| G. Attendance | first finished events with check-ins | months (needs many events) | Gate check-ins must be used for every entry |
| H. Crowd flow | finished events with gate capacities | months | Gate-level scan data |
| F. Demand | events past their first 48 h / hourly | many months (800 events) | Many organizers needed |
| C. Fraud | blind reviews | longest (400 confirmed frauds) | May never reach the minimum at small scale; rules stay |

## What approval is needed for

1. Starting R0 (local code fixes and running the sandboxed server tests). This is the only part that can
   start without external accounts.
2. R1 hosting choices and costs.
3. R2 documents (business or legal).
4. R3 live payments: the provider decision and the live keys, by the business owner.
5. R4 invitations and their size.
6. Step 6: recommendation display and any change to what customers see.
