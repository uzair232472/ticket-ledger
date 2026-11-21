# The 43 server-dependent test failures: causes and classification (R0 closure, 2026-11-22)

Run with `apps/api/scripts/test-server-suites.sh`: sandboxed full server, fresh `*_verify` database copy,
in-memory mail, simulated minting, no Stripe, no Cloudinary. The preflight passed and the server log shows no
external activity.

**Result:** 153 tests, **110 pass, 43 fail**.
- The same 43 fail on the code before R0 (`8c837d1`), so R0 introduced none of them.
- **Counting:** 33 individual tests, plus 10 module wrappers. A wrapper fails whenever one of its tests fails,
  so they are not separate causes.
- **None is skipped or silenced.** No test was changed to pass by weakening it.

## Summary

| Class | Tests | Meaning |
|---|---|---|
| **A. Obsolete test expectations** | 27 | The application changed on purpose (later features, Stage 3–4 hardening, the current seed); the test still expects the old behaviour or data |
| **B. Environment-dependent** | 6 | Need live testnet NFT minting, which is deliberately not configured anywhere in development or the sandbox. With minting simulated, the app correctly reports "simulated" and no contract |
| **C. Application issues** | 2 found, both fixed in this closure | Surfaced while investigating; neither is what the test was asserting |

The three that were "not yet explained" in the R0 report are now explained: A1 (two tests) and A5 (one test).

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
  Invited organizers who use their business address cannot register. Decide whether organizers (or invited
  users) may use any domain that passes verification.
- **Recommended next step:** fix the obsolete tests (A1–A9), so the suite again tests the current product. A
  failing suite that everyone has learned to ignore hides new failures.
