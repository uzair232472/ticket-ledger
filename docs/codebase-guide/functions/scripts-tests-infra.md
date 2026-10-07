# Function catalogue — seeds, maintenance scripts, tests & infrastructure

[← Function catalogue index](README.md) · Related: [File inventory](../04-file-inventory.md) · [Database](../07-database.md)

---

## Database seeding

There is **no `prisma/migrations` folder**: the schema is applied with `npx prisma db push` (`apps/api/package.json` script `prisma:push`), and data-moving changes are done by one-off scripts (below).

### `apps/api/prisma/seed.js` — `main()` (`:7`)
- **Run:** `npm run seed` in `apps/api` (also registered as Prisma's `seed` command).
- **What it creates (idempotent: each block checks whether its data exists first):** sections are numbered in the source comments —
  1. Super Admin; 2. approved organizer + company; 3. pending organizer (since `fad6f72` also given a **PENDING company**, "Karachi Kings Sports & Festivals", so the admin approval queue has an entry); 4. gate staff; 5. five customers; 6. a "fraud-like bot" user (status suspended in the audit seed); 7. an "abandoned checkout" user;
  8. three Pakistani events with tiers; 9. a legacy seat grid for the PSL event; 10. completed orders and tickets; 11. `GateScan` rows (one valid, one duplicate); 12. one resale listing at exactly 110 %;
  13. a behaviour clickstream for the abandoned user (`event_view → seat_selected → checkout_started → checkout_abandoned`, with `cartValue` and `reason: payment_hesitation`);
  14. **seed-only fraud signals**: `bot_risk_flagged` (fraudScore 92, anomaly factors) and `rapid_clicks` behaviour rows — these are what the organizer dashboard fraud feed and the admin fraud alerts display, since no runtime code writes these action names;
  15. initial audit logs; then `publishAllLayouts()` (below).
- Demo accounts use the e-mails shown on the login page (`Login.jsx` `DEMO_ACCOUNTS`) and a shared demo password defined in this file.

### `apps/api/src/seed.js` — `seedUsers()` (`:5`)
A second, smaller seeder (demo users, a few events with tiers, then `publishAllLayouts`). It runs only when executed directly (`node src/seed.js`, check at `:275`). Not referenced by any npm script. **Overlaps** with `prisma/seed.js`; which one is canonical is not stated in the code (the npm `seed` script uses `prisma/seed.js`).

### `apps/api/seed_venue_layouts.js`
| Function | Line | Behaviour |
|---|---|---|
| `publishLayoutForEvent(eventId)` | `:4` | Skips events without tiers or with a published layout. Builds the suggested template for the event type (`buildTemplate` + `validateLayout` + `layoutInventory`), archives published layouts, creates a `PUBLISHED` layout v1, **deletes every unticketed seat** (including legacy grid seats), creates the layout seats, then **re-points existing tickets to the first N new `SEAT` positions in query order** — so seeded tickets end up on different section/row/seat values than they were sold with — and recomputes tier totals. Development/seed use only; it bypasses `publishDraft`'s protections. |
| `publishAllLayouts()` | `:123` | Runs `publishLayoutForEvent` for every event. Called by both seeders and when the file is run directly. |

---

## One-off maintenance scripts (`apps/api/scripts/`)

### `create-super-admin.mjs`
- **Run:** `ADMIN_PASSWORD=… node scripts/create-super-admin.mjs --email <e> --name "<n>"` (also `npm run create-admin`).
- `arg(name)` (`:15`) reads `--name value` pairs. Validates presence and password strength (≥8, letter, digit), then `upsert`s the user as `SUPER_ADMIN`, `ACTIVE`, verified, `companyId: null`, bcrypt cost 12. Super Admins cannot be created through the API (comment `:2`).

### `migrate-auth-overhaul.mjs` (Oct 2026 auth overhaul)
| Function | Line | Behaviour |
|---|---|---|
| `columnExists(table, column)` | `:24` | `information_schema.columns` lookup. |
| `enumHasValue(type, value)` | `:33` | Checks a PostgreSQL enum label. |
| `prePush()` | `:42` | Renames `FROZEN→SUSPENDED`, `BLACKLISTED→BANNED`, adds `PENDING_VERIFICATION`, `DEACTIVATED`; adds and back-fills `User.emailVerifiedAt` from the old `isVerified`. |
| `push()` | `:72` | `npx prisma db push --accept-data-loss --skip-generate` (creates `OtpCode`, `RefreshToken`, `StaffInvite`, `StaffEventAssignment`; drops old OTP columns). |
| `postPush()` | `:78` | Unverified `ACTIVE` users → `PENDING_VERIFICATION`; links organizers' `companyId`. |
Top-level code runs the three phases in order (with the API stopped) and asks you to run `npx prisma generate` afterwards.

### `migrate-legacy-venues.mjs`
Gives events still on the legacy grid a published venue plan **without recreating seats** (sold seats, tickets, checkouts and holds keep their rows; seats are linked in place via `layoutKey`/`sectionKey`). Dry run by default; `--apply` writes.
| Function | Line | Behaviour |
|---|---|---|
| `slug(s)` | `:26` | Section id fragment. |
| `rowsFor(sectionSeats)` | `:30` | Row labels (natural sort), widest row, per-row seat counts, blocked positions (`numbers(row)` helper at `:34`). |
| `mappable(labels, sectionSeats)` | `:48` | Only rows numbered 1…n without gaps can be mirrored. |
| `buildLayout(event, sections)` | `:62` | One rectangular `seats` section per legacy section (ordered by price), spacing 16/18. |
| `planFor(event)` | `:94` | Skips events already on a plan or with unmappable sections; validates the plan; maps each legacy seat to its inventory key by `section|row|number`. |
| `main()` | `:132` | Iterates events, prints the plan, and with `--apply` creates the layout, updates seat links and recounts tier totals. |

---

<a id="root-scripts-folder-manual-demo-scripts"></a>
## Root `scripts/` folder (manual demo scripts)

Added between `cc26c42` and `1a91b0d`. None is referenced by an npm script, a test runner or the app; each is run by hand with `node scripts/<file>` from the repository root, against a running API on `http://localhost:5000` and/or a local Hardhat node on `http://127.0.0.1:8545`. They rely on the seeded demo customer.

| File | What it does | Talks to | Notes |
|---|---|---|---|
| `simulate_scalper_bot.js` — `run()` | Logs in as the demo customer, picks the first event and an available legacy seat, then calls `POST /api/bookings/initiate` with bot telemetry `{0.38 s, 240 clicks/min, 6 attempts, 2 device switches}` and prints the 403 `blockedByAI` verdict. | API (`/auth/login`, `/events`, `/seats/event/:id`, `/bookings/initiate`) | Does not lock the seat first, but the bot check runs before the hold check, so the block is still shown. The printed "seat holds revoked" line is not what the API does. Contains the demo password in plain text (seed credential). |
| `demo_live_checkout_to_metamask.mjs` — `main()` | Loads `apps/api/.env`, finds the demo customer **with a linked wallet**, signs an access token directly with `tokenService.signAccessToken`, locks 2 seats (`/seats/lock`), initiates a STRIPE order with human telemetry, confirms with a fake `pi_test_…` id, then reads the order's tickets and checks `ownerOf(tokenId)` on the contract. | Prisma (direct), API, JSON-RPC (`POLYGON_AMOY_RPC` or localhost) | With a real `STRIPE_SECRET_KEY`, retrieving the fake intent fails, but because the script also sends a `paymentTxId` the lenient fallback accepts it — the order is confirmed without any payment ([Stripe verification gap](api-booking-payment.md#stripe-verification-gap)). |
| `test_live_mint.mjs` — `testLiveMint()` | Takes the newest ticket, **clears its `tokenId`/`txHash`**, and calls `nftService.mintTicketNFT` to re-mint it. | Prisma, `nftService` | Mutates data in whatever database `DATABASE_URL` points at. |
| `test_blockchain_scenarios.mjs` — `runBlockchainVerification()` | Prints minted tickets, demonstrates the 110 % cap arithmetic and the keccak fingerprint locally, shows the customer's wallet, lists recent `NFT_TICKET_MINTED` audit logs. | Prisma (read-only) | Scenario 2 and 3 only compute values in JavaScript; they do not call the contract. |
| `mint_to_user.mjs` — `mintToUser()` | Mints one demo token straight through the contract to a fixed address, then reads `ownerOf(2)`. | Local Hardhat node | Hard-codes Hardhat's **public development account** key and the first-deployment contract address; assumes token id 2. Development-only. |

## Automated tests

### API HTTP test scripts (`apps/api/test_*.mjs`, 26 files)
All use Node's built-in test runner (`node:test`) and `assert`. Two styles exist:

| Style | Files | How they reach the API |
|---|---|---|
| **In-process** — import `./src/app.js`, start it on a random port with `http.createServer(app)` | `test_auth`, `test_company`, `test_email_otp_signup`, `test_event_media`, `test_events`, `test_health`, `test_pending_signup`, `test_seats`, `test_staff_invites`, `test_user_profile`, `test_venue_layouts` | Need PostgreSQL (and the seeded data for some); Redis optional. |
| **Against a running server** — `fetch('http://localhost:5000/api/…')` | `test_abandoned_intent_dashboard`, `test_admin_dashboard`, `test_ai_anti_scalping`, `test_behavior_system`, `test_booking`, `test_digital_wallet`, `test_fastapi_ml_service`, `test_final_master_suite`, `test_gate_scanner`, `test_nft_minting`, `test_notification_system`, `test_prelaunch_demand_forecast`, `test_purchase_intent_analytics`, `test_resale`, `test_transfer_resale` | Need `npm run dev` running and the seed data (e.g. log in as the demo customer). `test_fastapi_ml_service` also expects the Python service. |

Helpers defined inside tests (documented here, not in module pages): `json(res)`, `refreshCookieOf(res)` (`test_auth.mjs:8,15`); `getToken` (several files); `crc32`, `chunk`, `png`, `file`, `banner`, `card`, `wide`, `square` (`test_event_media.mjs:19-52` — build valid PNG files of exact sizes in memory to exercise image validation); `png`, `rect`, `makeUser`, `login`, `call`, `venue`, `hold`, `seatByKey` (`test_venue_layouts.mjs`); `registerVerifiedCustomer` (`test_resale.mjs:8`); `call`, `backdateCodes` (`test_pending_signup.mjs`); `call`, `login` (`test_staff_invites.mjs`); `resend` (`test_email_otp_signup.mjs:51`).

**How to run:** `node --test test_auth.mjs` (one file at a time, from `apps/api`). The npm script `npm test` runs `node --test` with no file list; Node's default discovery looks for names like `*.test.mjs`, `test-*.mjs` or a `test/` folder, so the `test_*.mjs` files are **probably not picked up** by `npm test` (inferred from Node's documented patterns; not executed). The rate limiters and real SMTP are disabled automatically under the test runner (`NODE_TEST_CONTEXT`).

The tests were **not executed** while writing this guide.

### Smart-contract tests — `contracts/test/TicketLedgerNFT.test.cjs`
Six Hardhat/Chai tests (deploy state, mint with cap, resale-price ceiling, duplicate seat rejection, batch mint, invalidation). `npx hardhat test` in `contracts/`.

### ML service test — `apps/ml-service/test_health.py`
See [ML service](ml-service.md#test_healthpy) (the root-endpoint assertion does not match the current code).

---

## Infrastructure

### `infra/docker-compose.yml`
- `postgres` (16-alpine) with user/password/db from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (defaults `ticketledger_user` / `ticketledger_secret` / `ticketledger_db`), port 5432, volume `postgres_data`, `pg_isready` health check.
- `redis` (7-alpine) with append-only persistence, port 6379, volume `redis_data`, `redis-cli ping` health check.
- **Not included:** the API, the web app and the ML service (run them with npm/python). Note that `apps/api/.env.example`'s `DATABASE_URL` uses `postgres:postgres@…/ticketledger_db`, which does **not** match the compose defaults — adjust one of them.

### Root `package.json`
npm **workspaces** `apps/*` (covers `api`, `web`, `venue-core`; `ml-service` has no package.json). Scripts: `dev:web`, `dev:api`, `build:web`, `build:api` (`apps/api` has no `build` script, so `build:api` fails), `dev:ml` (points to a missing script — see [ML service](ml-service.md)).

### Other root files
`.gitignore` (dependencies, builds, env files, Python artifacts, `*.joblib`, Hardhat cache/artifacts, DB data, the QR signing key folder `apps/api/.keys/`), `.gitattributes` (line-ending normalisation), `.tl_venue.log` (a local log file, git-ignored by `*.log`, not read by any code), `README.md` (project overview).
