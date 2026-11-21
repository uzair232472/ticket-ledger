# The 43 server-dependent test failures: causes and classification (R0 closure, 2026-11-22)

Run with `apps/api/scripts/test-server-suites.sh`: sandboxed full server, fresh `*_verify` database copy,
in-memory mail, simulated minting, no Stripe, no Cloudinary. The preflight passed and the server log shows no
external activity.

**Result:** 153 tests, **110 pass, 43 fail**.
- The same 43 fail on the code before R0 (`8c837d1`), so R0 introduced none of them.
- **Counting:** 33 individual tests, plus their 10 module tests (class W below). A module test fails whenever one
  of its tests fails, so the module tests are not separate causes.
- **None is skipped or silenced.** No test was changed to pass by weakening it.

## Summary and reconciliation

**43 = 33 failing tests + 10 module tests.**
- Each of the 10 failing files is one top-level module test (`test('MODULE …')`) containing numbered subtests.
- Node counts both levels (e.g. abandoned_intent_dashboard: 9 tests = 1 module + 8 subtests).
- A module test fails whenever one of its subtests fails. So the 10 module entries have no cause of their own:
  they are the 33 failures seen one level up.
- The **2 application issues (C1, C2) are not additional failing tests.** They were found while investigating
  A5 and A8, whose tests still fail because their expectations are obsolete. Adding 27 + 6 + 2 = 35 counts these
  two twice and leaves out the 10 module entries.

| Class | Entries | Meaning |
|---|---|---|
| **A. Obsolete test expectations** | 27 | The application changed on purpose (later features, Stage 3–4 hardening, the current seed); the test still expects the old behaviour or data |
| **B. Environment-dependent** | 6 | Need live testnet NFT minting, deliberately not configured in development or the sandbox. With minting simulated, the app correctly reports "simulated" and no contract |
| **W. Module tests** | 10 | The parent of each failing file's subtests; fails because those subtests fail |
| **Total** | **43** | |
| C. Application issues (found, fixed) | 2 | Not failing tests: found during A5 and A8. C1 fixed with a new regression test; C2 changed the status code |

The three that were "not yet explained" in the R0 report are now explained: A1 (two tests) and A5 (one test).

### Every failing entry (from the sandbox run logs, `server_suites_srv3`)

| # | File | Failing entry | Class |
|---|---|---|---|
| 1 | abandoned_intent_dashboard | MODULE 18 - Abandoned Intent Dashboard Integration Test Suite | W: module test (fails because a subtest below it fails) |
| 2 | abandoned_intent_dashboard | 7. Send recovery reminder to specific abandoned customer | A1 |
| 3 | abandoned_intent_dashboard | 8. Batch dispatch recovery reminders for all eligible abandoned prospects | A1 |
| 4 | ai_anti_scalping | MODULE 12 - AI Anti-Scalping, Bot Detection & Behavioral Analytics Tests | W: module test (fails because a subtest below it fails) |
| 5 | ai_anti_scalping | 3. Verify Python FastAPI ML Service Health & 3 Loaded Models | A7 |
| 6 | behavior_system | MODULE 13 - Behavior Tracking & User Behavioral Profile Tests | W: module test (fails because a subtest below it fails) |
| 7 | behavior_system | 6. Generate User Behavioral Profile with action counts, timeline, and ML scores | A2 |
| 8 | digital_wallet | MODULE 9 - Digital Ticket and QR Wallet Tests | W: module test (fails because a subtest below it fails) |
| 9 | digital_wallet | 3. Each ticket card includes event, date, seat, tier, price, status, NFT tokenId, txHash | B |
| 10 | digital_wallet | 4. Ticket displays verified NFT ownership badge | B |
| 11 | fastapi_ml_service | MODULE 15 - FastAPI ML Service & Node.js Score Persistence Tests | W: module test (fails because a subtest below it fails) |
| 12 | fastapi_ml_service | 2. FastAPI ML Service - Direct Endpoints Health Check | A7 |
| 13 | fastapi_ml_service | 3. FastAPI ML Service - Direct POST /intent/predict returns real score | A6 |
| 14 | fastapi_ml_service | 4. FastAPI ML Service - Direct POST /fraud/score returns real score | A6 |
| 15 | fastapi_ml_service | 5. FastAPI ML Service - Direct POST /forecast/demand returns real forecast | A6 |
| 16 | fastapi_ml_service | 6. FastAPI ML Service - Direct POST /train/fraud hot-retrains model | A6 |
| 17 | fastapi_ml_service | 10. Super Admin triggers model retraining via Node.js Express | A8 (C2 fixed: 500 → 403) |
| 18 | final_master_suite | MODULE 20 - TicketLedger Final Master Verification Suite (All 20 Modules) | W: module test (fails because a subtest below it fails) |
| 19 | final_master_suite | 1. Verify Seeded Role Logins: Admin, Approved & Pending Organizers, Staff, Customers | A9 |
| 20 | final_master_suite | 3. Retrieve and inspect the 3 Pakistani Events (PSL, Concert, Festival) | A9 |
| 21 | final_master_suite | 4. Inspect Ticket Tiers and Stadium Seats for PSL Match | A9 (needs the PSL event from 3) |
| 22 | final_master_suite | 7. Verify P2P Resale Listing and 110% Price Cap Compliance | A9 |
| 23 | final_master_suite | 8. Verify Scalper Bot Ring User is FROZEN and Flagged by ML | A9 |
| 24 | final_master_suite | 9. Verify Abandoned Checkout Prospect and 1-Click Recovery | A9 (needs the PSL event from 3) |
| 25 | final_master_suite | 10. Verify FastAPI ML Inference (Intent, Fraud, Demand) | A6 |
| 26 | nft_minting | MODULE 8 - Smart Contract, Polygon Amoy NFT Minting & Anti-Scalping Tests | W: module test (fails because a subtest below it fails) |
| 27 | nft_minting | 4. Confirm booking and verify automatic Polygon Amoy ERC721 NFT minting | B |
| 28 | nft_minting | 5. Explicit mint endpoint is idempotent for already minted tickets | B |
| 29 | nft_minting | 6. Customer retrieves Web3 NFT tickets gallery with on-chain metadata | B |
| 30 | nft_minting | 7. Single NFT ticket verification returns tamper-proof credentials | B |
| 31 | prelaunch_demand_forecast | MODULE 17 - Pre-Launch Demand Forecast & Pricing Adjustment Tests | W: module test (fails because a subtest below it fails) |
| 32 | prelaunch_demand_forecast | 6. Organizer adjusts ticket tier prices before publishing | A5 (investigation found C1, fixed) |
| 33 | resale | MODULE 9 - P2P Resale Marketplace & Anti-Scalping Rules Tests | W: module test (fails because a subtest below it fails) |
| 34 | resale | 2. Authenticate Buyer (Customer 2) | A3 |
| 35 | resale | 9. Seller relists, and Buyer 2 purchases verified resale ticket | A3 (needs the buyer from 2) |
| 36 | resale | 10. Atomic Ownership Transfer: Seller no longer holds ticket and listing is SOLD | A3 (needs the buyer from 2) |
| 37 | transfer_resale | MODULE 11 - Ticket Transfer, Controlled Resale & Anti-Scalping Tests | W: module test (fails because a subtest below it fails) |
| 38 | transfer_resale | 3. Register fresh Customer B account (Recipient / Buyer) | A4 |
| 39 | transfer_resale | 5. Customer B joins event waitlist | A4 (needs customer B from 3) |
| 40 | transfer_resale | 8. Customer B purchases resale ticket; transfers ownership & invalidates old QR | A4 (needs customer B from 3) |
| 41 | transfer_resale | 9. Customer B directly transfers ticket to Customer A via email | A4 (needs customer B from 3) |
| 42 | transfer_resale | 10. Verify complete Ticket Provenance / Transfer History | A4 (needs customer B from 3) |
| 43 | transfer_resale | 12. Gate check rejects the invalidated old QR code from the previous owner | A4 (needs customer B from 3) |

## A. Obsolete test expectations (27)

| # | Tests | Cause (verified) | Recommended action |
|---|---|---|---|
| A1 | abandoned_intent_dashboard 7, 8 | The reminders carry made-up discount codes (`RECOVER10`, `BATCH15`). Since commit `38db753` a reminder may only carry an **existing, active** code of that organization for that event, or a new personal code (`discountPercent`). The server answers 400: *"RECOVER10" is not an active discount code for this event*. Correct, deliberate behaviour (a reminder must never promise a code that does not work) | Create the code in the test first, or use `discountPercent` |
| A2 | behavior_system 6 | Expects a numeric ML fraud score in the behaviour profile. Since Stage 4 hardening the profile shows the score as **unavailable** (an object explaining why) instead of a fake number | Assert the "unavailable" shape |
| A3 | resale 2 (and 9, 10, which need that buyer) | Registers `buyer_…@ticketledger.pk`. Sign-up accepts only addresses from **known e-mail providers** (Gmail, Yahoo, Outlook, Hotmail, iCloud and others), so it returns 400 and the later steps have no buyer | Use a provider-domain address in the test |
| A4 | transfer_resale 3 (and 5, 8, 9, 10, 12, which need that customer) | Same sign-up rule as A3 | Same as A3 |
| A5 | prelaunch_demand_forecast 6 | Takes the event's tiers from the **public** event list, which omits sold-out tiers (the event has 4 tiers, the list shows 2). It changes those 2, and the cheapest untouched tier (500) stays first. Verified in-process on a copy. The pricing update itself works | Read the tiers from the organizer's view of the event. This investigation also found C1 |
| A6 | fastapi_ml_service 3, 4, 5, 6; final_master_suite 10 | Call the ML service directly **without the service token**. The service requires `ML_SERVICE_TOKEN` (service authentication added in earlier stages), so it answers 401 | Send the token from the environment |
| A7 | fastapi_ml_service 2; ai_anti_scalping 3 | Expect the three **legacy synthetic models** loaded. They are disabled in production mode on purpose (no synthetic model may serve) | Assert that legacy models are off |
| A8 | fastapi_ml_service 10 | Expects `POST /api/ml/train/fraud` to retrain. Legacy synthetic training is **disabled on purpose**: models come only from the gated pipeline (`python -m ml.train`) and are never promoted automatically. The application issue part (500 instead of a clear refusal) is C2 | Assert 403 `TRAINING_DISABLED` |
| A9 | final_master_suite 1, 3, 4, 7, 8, 9 | Written for an **older seed**. The current `src/seed.js` creates no `customer2@ticketledger.pk`, no event named "PSL 10 Final" and no FROZEN bot-ring user. 4 and 9 then fail on the missing PSL event. 7: the only active resale listing belongs to an event whose date has passed, so the market does not show it | Rewrite the suite for the current seed (or a fixture it creates itself) |

**Total in A:** 2 + 1 + 3 + 6 + 1 + 5 + 2 + 1 + 6 = **27**.

## B. Environment-dependent (6)

| Tests | Cause | Would pass when |
|---|---|---|
| digital_wallet 3, 4; nft_minting 4, 5, 6, 7 | Expect a contract address, an on-chain transaction, a "verified NFT" badge and on-chain verification. In simulation mode tickets are marked "NFT simulated (not on-chain)" with no contract address, and verification answers "cannot verify in simulation mode" (404). This is correct behaviour for simulation | A testnet deployment (Polygon Amoy) with a minter key is configured in a separate test environment. That is a deliberate decision: it sends real testnet transactions, which this sandbox must never do |

## C. Application issues found and fixed (2)

| # | Issue | Fix | Test |
|---|---|---|---|
| C1 | **Cross-organizer price changes.** `PUT /events/:id/pricing` and `POST /events/:id/publish` updated every tier id in the body without checking that it belongs to that event. An organizer could change **another organizer's** ticket prices through their own event | Every tier id must belong to the event in the URL; otherwise 400 `TIER_NOT_IN_EVENT`, checked before anything is written. Updates are scoped by `eventId` | New `test_pricing_tier_ownership.mjs`: **fails on the old code** (the other organizer's price changed, 200) and passes now |
| C2 | Disabled legacy training answered **500** (looks like a server failure) | The ML service's refusal is passed on as 403 `TRAINING_DISABLED` with its message; an invalid model type is 400 | Seen in the sandbox server log |

## Also worth deciding before the beta (not a test failure)

- **Sign-up and company e-mail:** the sign-up provider allow-list (A3/A4) also refuses company domains.
  Invited organizers who use their business address cannot register. Documented with a proposed
  invitation-based solution in `docs/organizer-invitations.md` (required before the beta).
- **Recommended next step:** fix the obsolete tests (A1–A9), so the suite again tests the current product. A
  failing suite that everyone has learned to ignore hides new failures.
