# Stripe test-mode end-to-end verification (steps; not yet run)

The card flow has so far been tested only against a **fake Stripe client** (`test_payment_security.mjs`,
`test_org_profile_checkout.mjs`). These are the exact steps to verify it against Stripe's own **test mode**.
No money moves in test mode.

**Never in this procedure:**
- live keys;
- `STRIPE_MODE=live`;
- the production database;
- real customers' e-mail addresses.

JazzCash and EasyPaisa stay disabled.

## 0. Prerequisites (business owner)

- **A Stripe account.** Test mode is available as soon as the account exists; no business verification is
  needed for test keys. The live account later needs a business in a Stripe-supported country (see
  `ml-step5-data-readiness.md` §11 A).
- **From the Dashboard, in test mode** (Developers → API keys): the test secret key `sk_test_…` and the
  publishable key `pk_test_…`. Store them only in the test environment's secret store or local `.env`, never in
  git.
- **[Stripe CLI](https://docs.stripe.com/stripe-cli)** installed, then `stripe login`.

## 1. A separate test environment

Use a `*_verify` copy of the database (as `scripts/test-server-suites.sh` does) or a staging database. Set:

```
NODE_ENV=development
STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...            # the test key
STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...  # web app (apps/web/.env)
PAYMENT_TEST_CHECKOUT=off                # hide the MOCK checkout: only the card path can pay
SMTP_HOST=mock-smtp SMTP_USER=mock_user  # or a sandbox inbox (Mailtrap / Ethereal); never real SMTP
NFT_MINTER_PRIVATE_KEY=                  # minting simulation
```

Check the configuration (prints no secrets):

```
node apps/api/scripts/payment-config-check.mjs
```

Expected:
- `mode test, key test, card payments available: true, live payments possible: false`;
- `MOCK: unavailable`, `JAZZCASH: unavailable`, `EASYPAISA: unavailable`.

## 2. Webhooks to the local API

```
stripe listen --forward-to http://localhost:5000/api/payments/stripe/webhook \
  --events payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,charge.dispute.created,charge.dispute.closed
```

It prints a signing secret `whsec_…`. Set `STRIPE_WEBHOOK_SECRET` to it, then start the ML service, the API and
the web app. The server log must show no "Payment configuration refused" line.

## 3. Test cases

Use Stripe's test cards, with any future expiry, any CVC and any postcode. Each case lists what must happen.
The SQL for checking the database is in §4.

| # | Case | How | Must happen |
|---|---|---|---|
| T1 | **Successful payment** | Checkout one seat with `4242 4242 4242 4242` | Order `SUCCESSFUL`; `paymentRef` = `paymentTxId` = `pi_…`; exactly **one** `PAYMENT_SERVER_VERIFIED` row with `livemode: false`; one `STRIPE_EVENT` row for `payment_intent.succeeded`; seats SOLD; ticket issued (NFT simulated) |
| T2 | **Webhook re-delivery** | `stripe events resend <evt_id of T1>` | Webhook answers `duplicate: true`; still one `STRIPE_EVENT` and one evidence row |
| T3 | **Declined card** | `4000 0000 0000 0002` | Card error shown; order stays `PENDING` (then expires); `PAYMENT_FAILED_VERIFIED` from the webhook; no evidence row |
| T4 | **Insufficient funds** | `4000 0000 0000 9995` | As T3 |
| T5 | **3-D Secure** | `4000 0025 0000 3155`; complete the challenge, then repeat and **fail** it | Completed: as T1. Failed: as T3 |
| T6 | **Confirm before paying** | Start checkout, then call `POST /api/bookings/confirm` without completing the card | 400 `PAYMENT_NOT_COMPLETED`; order stays `PENDING` |
| T7 | **Another order's payment** | Order B's confirm with `paymentDetails.paymentIntentId` = order A's paid `pi_…` | 400 (the server checks B's own PaymentIntent); A's payment never confirms B |
| T8 | **Stripe unreachable** | Restart the API with `STRIPE_TIMEOUT_MS=1` (or block the network), then confirm a paid order | 503 `PAYMENT_PROVIDER_ERROR` with `retryable: true`; order stays `PENDING`. After restoring the setting the same confirm succeeds |
| T9 | **Payment after the hold expired** | Pay, but let the seat hold expire before confirming (or confirm after expiry) | 409 `ORDER_EXPIRED_REFUNDED`; a Stripe refund `re_…` is created automatically; `PAYMENT_REFUND_VERIFIED` arrives by webhook |
| T10 | **Refund** | Refund a T1 ticket from the admin / organizer refund flow | `Refund` row with `providerRef` `re_…`; `charge.refunded` gives `PAYMENT_REFUND_VERIFIED`; ticket cancelled |
| T11 | **Dispute** | Pay with `4000 0000 0000 0259` (it is disputed automatically) | `PAYMENT_DISPUTE` row; the order is **not** changed by the webhook; the exporter keeps it apart from fraud labels |
| T12 | **Bad signature** | `curl -X POST localhost:5000/api/payments/stripe/webhook -H 'Stripe-Signature: t=1,v1=bad' -d '{}'` | 400 `invalid signature`; nothing recorded |
| T13 | **Unlinked event** | `stripe trigger payment_intent.succeeded` (Stripe creates its own PaymentIntent) | Recorded with `linked: false`; no evidence for any order |
| T14 | **Retry the checkout** | Start checkout twice for the same seats | The same `pi_…` is returned (one payment per order) |
| T15 | **Resale** | Try to buy a resale ticket with `PAYMENT_TEST_CHECKOUT=off` | 503 `RESALE_PAYMENTS_UNAVAILABLE` (resale has no card flow yet) |
| T16 | **Training data stays clean** | `node apps/api/scripts/ml-export-datasets.mjs --out <tmp>` on this database | Test-mode orders are evidence with `livemode: false`: **0** genuine rows; `liveVerifiedOrders: 0` |

## 4. Database checks (on the test database)

```sql
-- One evidence row per paid order, in TEST mode
SELECT "targetId", details->>'livemode' AS livemode, details->>'verifiedVia' AS via, "createdAt"
FROM "AuditLog" WHERE action = 'PAYMENT_SERVER_VERIFIED' ORDER BY "createdAt" DESC LIMIT 10;
-- Webhook events processed once each
SELECT "targetId", details->>'type' AS type, details->>'recorded' AS recorded, details->>'linked' AS linked
FROM "AuditLog" WHERE action = 'STRIPE_EVENT' ORDER BY "createdAt" DESC LIMIT 20;
-- Failures, refunds, disputes, mode mismatches
SELECT action, count(*) FROM "AuditLog"
WHERE action IN ('PAYMENT_FAILED_VERIFIED', 'PAYMENT_REFUND_VERIFIED', 'PAYMENT_DISPUTE', 'STRIPE_WEBHOOK_MODE_MISMATCH')
GROUP BY 1;
-- Card orders: every SUCCESSFUL one has a pi_ id and evidence
SELECT o.id, o.status, o."paymentTxId", (SELECT count(*) FROM "AuditLog" a WHERE a.action = 'PAYMENT_SERVER_VERIFIED' AND a."targetId" = o.id) AS evidence
FROM "Order" o WHERE o."paymentMethod" = 'STRIPE' ORDER BY o."createdAt" DESC LIMIT 10;
```

In the Stripe Dashboard (test mode), each PaymentIntent must show:
- metadata `orderId` only (no e-mail or phone);
- currency **PKR**;
- the order's amount in paisa.

If Stripe refuses PKR for the account, that is a finding for the business (it decides the live set-up).

## 5. Pass criteria and clean-up

- T1–T16 behave as listed, the SQL checks match, and no real e-mail is sent.
- Record the results (case, PaymentIntent id, outcome) in the R1 / staging checklist.
- Afterwards:
  - stop `stripe listen`;
  - remove the test keys from the local `.env`;
  - drop the test database copy.

Live mode is a separate, later step (`ml-step5-data-readiness.md` §11 C–E) and needs the business owner's
authorisation.
