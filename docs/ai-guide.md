# TicketLedger AI: how it works, what each screen shows, how to demonstrate it, and how to run the app

Plain-language guide (2026-11-22). Technical details: `docs/ml-step6-integration.md`.

---

## 1. The idea in one minute

TicketLedger has **eight AI features**. In every one of them, **fixed rules make the real decisions** (block a bot
checkout, show an estimate, rank events). The AI models only **watch in the background** ("shadow mode"):

1. Something happens in the app (a customer views an event, starts a checkout, a gate scans a ticket).
2. The **rule** decides or estimates, and the app uses that answer immediately.
3. Every 15 minutes a background job writes two rows: what the **rule** said and what the **AI model would have
   said**, with the exact inputs.
4. Later the **real outcome** is attached (did they buy, was it fraud, how many came through the gate).
5. Staff screens show the rule's figures first and the model's view in a grey "Experimental" box.
6. Once enough *real customer* outcomes exist, the models are evaluated offline. Until then they cannot be
   trusted, and they are **never allowed to decide anything**.

Why: the current models were trained on **synthetic (made-up) data**. They must prove themselves on real data first.
Today there are no genuine customers yet, so every feature says **"No real outcomes logged yet"**. That is expected.

**The ML service is optional.** If it is switched off, the app behaves exactly the same; only the experimental boxes
say "ML service unavailable".

---

## 2. Who sees what

| Role | AI-related screens | What they can do there |
|---|---|---|
| **Super admin** | AI monitor, Customer behaviour, Purchase intent, Abandoned intents, Demand forecast, Gates (Live tab) | See rule figures **and** the experimental model figures; see model health; nothing here changes the app |
| **Organizer** (owner, admin, event manager) | Purchase intent, Abandoned intents, Demand forecast, Gates (Live tab), for **their own events only** | See the **rule figures only**; the experimental box says "shown to platform admins only". Send reminders, edit and save prices, set up gates, as before |
| **Gate staff** | Scanner and their assigned events only | **No AI at all.** Scanning and admission use ticket rules only. (Gate staff do not have the "supervise gates" permission, so they do not see the Gates Live panels) |
| **Customer** | Nothing labelled AI. "Activity & interests" on the profile is a rule-based summary of their own activity. Recommendation rows only if switched on (off by default) | Browse and buy as normal |

No screen ever shows an individual customer's AI score. Fraud reviewers never see any score.

**Addresses.** Organizers open the shared insight pages at `/organizer/purchase-intent`,
`/organizer/demand-forecast` and `/organizer/abandoned-intents`; super admins at the same names under `/admin/`. It
is the same page; the API decides what each role sees. An organizer who opens an old `/admin/...` link is sent to
the organizer address. The "Activity & interests" profile tab (your own activity summary, rules only) is shown to
customers only.

---

## 3. The eight features: what, how, where, how to demonstrate

Legend: **Rule** = what the app uses. **Model** = the experimental shadow model (synthetic training data).

### A. Purchase intent: "how likely is this visitor to buy?"

- **Rule:** a visit is the activity on one event, ending after 30 minutes of inactivity. Its score is
  40 points, +15 for 3 or more page views, +20 if a seat was chosen, and +25 if checkout was started, kept between
  10 and 99. HIGH means 75 or more, MODERATE 55 or more, otherwise LOW.
  - The Purchase intent page lists people per event with a similar rule: −10 if they abandoned a checkout, 95 if
    they already bought. "Likely to buy" means a score of 55 or more. The card's note says "≥ 60"; that note is
    slightly off, the code uses 55.
- **Model:** v0 intent model (gradient boosting). It gives a purchase probability from the visit's views, seat
  choices, checkout start, time on site, price compared with similar events, timing and customer history.
- **Where:** Purchase intent page → **Visit scoring summary**.
  - Visits scored; High / Moderate / Low counts (rule).
  - For admins, the experimental box adds:
    - "Scored by model", "Skipped (missing inputs)" and "Failed calls";
    - the average probability, and probability bands (under 25%, 25–50%, 50–75%, 75% and over);
    - "Points the same way as the rule": the share of visits where the model's 50% line agrees with the rule's HIGH.
      This is agreement, not accuracy.
- **Demonstrate:**
  1. As a customer, open an event, view it a few times, pick a seat, start checkout and leave.
  2. After 30 minutes of no activity the visit counts as finished, and within the next 15-minute job it is scored.
     To score immediately, see section 7.
  3. As admin, open Purchase intent and pick the event: the summary counts it.

### B. Abandoned checkout: "who left without paying?"

- **Rule:**
  - **Background score:** 100 minus the visit's intent score.
  - **Abandoned intents page:** each person's score is 45, +10 for 2 or more views, +15 for a seat, +20 for a
    checkout start, −10 if abandoned, kept between 15 and 95.
  - **"Likely reason":** a fixed rule. A payment problem leads to "Offer payment help"; a cart over PKR 7,000 to a
    price note; a seat held but no checkout to a seat-hold note; 4 or more views to comparison shopping.
- **Model:** v0 abandonment model. It gives a probability that a visit that reached checkout ends unpaid.
- **Where:** Abandoned intents page.
  - Summary cards: abandoned users, recoverable revenue, average score (rule), top reason.
  - Choose one event to see **Checkout scoring summary**: checkout visits scored, checkouts logged, ended unpaid,
    completed, plus the experimental box for admins.
- **What you can do:** organizers send reminders, optionally with a personal discount code. The AI never sends or
  chooses reminders.
- **Demonstrate:** start a checkout and let the seat hold expire. It appears on the Abandoned intents page
  straight away (rule). The background scoring follows after the visit ends.

### C. Fraud / scalper bots: "is this checkout a bot?"

- **Rule (this one really decides):** at checkout the security rules score the attempt.
  - Base 10; +55 if the checkout took under 3 seconds; +25 for more than 150 clicks per minute; +20 for 5 or more
    rapid seat-lock attempts. The maximum is 99.
  - 75 or more: **checkout blocked** ("stopped by our automated security checks").
  - 45 or more: suspicious, but allowed.
  - These rules run inside the API, so the result is the same whether or not the ML service is running.
- **Model:** v0 fraud model. It **failed** its offline test (it was less precise than the rules: 0.893 against
  0.994), so it is kept in shadow only, by recorded decision. It logs a probability and "would flag yes/no".
  "Would flag" only decides which group an order falls in for the **blind review sample**. People review those
  orders without seeing any score.
- **Where:**
  - AI monitor → **C. Fraud**: rule decisions by type, checkouts blocked, and for the shadow model "would flag /
    would not flag / failed". Totals only.
  - Fraud review (admins with the fraud permission): blind review, unchanged.
  - Fraud watchlist: unchanged.
- **Demonstrate:**
  1. As a customer, go to checkout for any event and **add `?bot` to the end of the checkout page address**
     (for example `...checkout?bot`), then press pay.
  2. The checkout is blocked with the security message, because the page sends bot-like activity data
     (0.4 seconds, 240 clicks per minute).
  3. The AI monitor's "Checkouts blocked by the rules" goes up by one.

### D. Customer behaviour: "what are customers doing?"

- **Rule / description only (no model):**
  - customer accounts and buyers;
  - first-time buyers (1 order) vs returning buyers (2 or more);
  - orders per buyer;
  - activity in the last 30 days by type;
  - the event categories viewed.
- **Where:** admin menu → **Behavior** (Customer behaviour page).
- **Demonstrate:** browse and buy as a customer, then refresh this page; the counts move.

### E. Recommendations: "events you might like"

- **Rule (no model):** each visitor is placed in one of two groups, permanently.
  - **Control:** the most popular upcoming events (tickets sold in the last 30 days).
  - **Personalised:** events matching the categories and cities the visitor viewed, wishlisted or bought
    (purchases count 5 times more than views). A first-time visitor gets the popular list.
  - Both lists keep one slot for a little-shown event. Both groups see **identical** rows, so the comparison is fair.
- **Where:**
  - Customers see a "You might like" row on Events, the event page and the wishlist, **only when
    `ML_REC_DISPLAY=true`** (off by default).
  - AI monitor → **E. Recommendations**: lists served, lists actually seen on screen (at least half visible for
    one second) and clicks, per group.
- **Demonstrate:**
  1. Set `ML_REC_DISPLAY=true` in `apps/api/.env` and restart the backend.
  2. Open Events as a customer and scroll to the row.
  3. The monitor's "Seen on screen" goes up.
  4. Set it back to `false` afterwards.

### F. Demand forecast: "how many tickets in the first 48 hours?"

- **Rule:** a **fixed assumption**: 78% of capacity sells in the first 48 hours, for every event. The page labels
  it as a rule.
  - Revenue is that number × the average tier price.
  - "Share of capacity" is that 78%.
  - The demand level comes from the same rule.
  - The publish-time suggestion and the price notes are rules of thumb (fixed category benchmarks), not measured.
- **Model:** v0 demand model. It predicts first-48-hour sales with a range (low–high), from the event type, city,
  capacity, prices compared with similar events, timing and organizer history.
- **Where:** **Demand forecast** page. The rule cards come first; then the **Experimental demand model** panel.
  - Latest logged model forecast with its range.
  - When you move a price slider (admin): a **what-if** at the edited average price, marked "not saved, not
    applied".
  - Prices change **only** when you press Save; publishing is your button too.
- **Demonstrate:** as admin, open Demand forecast for an event and drag a tier price. The rule estimate updates,
  and the what-if line appears in the experimental panel. The ML service must be running for the what-if.

### G. Attendance: "how many ticket holders will actually come?"

- **Rule:** the show rate.
  - If past events of the same type have at least 200 tickets: the share of them that were checked in.
  - Otherwise: all past events.
  - Otherwise: a fixed standard estimate.
  - Expected attendance = live tickets × show rate.
- **Model:** none yet (the v0 attendance model failed its offline test), so the box says "No experimental model
  exists for this yet".
- **Where:** Organizer Gates page → choose the event → **Live** tab → **Expected attendance**: tickets, expected to
  attend, checked in so far, and after the event the final attended count. The basis line explains where the rate
  came from.
- **Demonstrate:** open the Live tab for an event with tickets, scan a ticket, and "checked in so far" goes up.
  Admission never uses this number.

### H. Crowd flow: "how many arrivals per gate, per 5 minutes?"

- **Rule:** tickets sold × show rate × the usual arrival curve (from 90 minutes before the start to 55 minutes
  after) × the gate's share of total gate capacity.
- **Model:** v0 crowd model. It predicts scans per gate per 5 minutes, shown as a grey line next to the rule.
- **Where:** Gates → Live tab → **Expected arrivals per gate**: one chart per gate.
  - The rule line is green.
  - Actual scans are amber after the event.
  - The experimental model line is grey (admins).
  - If a gate has no "capacity per hour" set, the panel says so. Set it in the Gates tab.
- **Demonstrate:**
  1. Create gates with a capacity per hour for an event starting within the next 26 hours.
  2. Open the Live tab: the rule chart appears straight away.
  3. The model line follows after the next background job.

---

## 4. The AI monitor (admin → AI monitor), card by card

| Card / section | What it means | Normal today |
|---|---|---|
| Warnings (amber/red bars) | Problems: ML service down, jobs not running, too many failed shadow calls, a model in the wrong state or a fingerprint mismatch | Possibly "ML service unavailable" if it isn't running |
| **ML service** | Reachable or not, the scikit-learn version and mode. If unavailable, the rules keep working | Reachable when the ML service window is running |
| **Background jobs** | When the 15-minute job last finished on this server and how many times it has run | "Not run yet" for about 3 minutes after the backend starts |
| **Switches** | Shadow on/off, snapshots, organizer insights, recommendations shown/hidden | Shadow on, recommendations hidden |
| **Model cards** (A, B, C, F, G, H) | Version, data source and fingerprint; **status SHADOW**; rows logged (rules vs shadow, total and last 24 h); shadow results (scored, skipped, failed, with reasons); the ML service's file check; the evaluation line | Synthetic v0, SHADOW, "No real outcomes logged yet". Attendance, checkout-start abandonment and hourly demand show "Rules only" |
| **Evaluation line** | Logged real outcomes against the minimum needed before a fair test (for example "12 of 100 positives"). **No accuracy number is ever shown**: models are tested offline on genuine data only | "No real outcomes logged yet" |
| **E. Recommendations** | Lists served, seen on screen and clicks, per group (control / personalised) | Zeros while the display is off |
| **D. Customer behaviour** | Genuine-use start date, and a link to the behaviour page | "not set (no genuine customers yet)" |
| **C. Fraud** | Rule decisions, checkouts blocked, and the shadow model's would-flag counts | Small numbers from your own tests |

### Words used in the experimental boxes

| Text | Meaning |
|---|---|
| "Shadow model view: not used for any decision" | Everything inside is for comparison only |
| SHADOW | The only state a model can have: scores in the background, decides nothing |
| PASSED / REJECTED (offline) | Result of the test on synthetic data. PASSED does **not** mean validated |
| "No experimental model exists for this yet" | Nothing is registered for this feature |
| "has not scored anything for this event yet" | The background job hasn't reached this event yet |
| "shown to platform admins only" | You're an organizer; you see the rule figures |
| "ML service is unavailable" / "did not answer in time" | The ML service is off or slow; the rules are unaffected |
| "different model file … refused" | The model file doesn't match its registered fingerprint; run the verify command (section 6) |
| "Not enough real outcomes to evaluate: X of Y" | How far the feature is from a fair test |

---

## 5. Switches (in `apps/api/.env`; restart the backend after changing)

| Setting | Default | What it does |
|---|---|---|
| `ML_SERVICE_URL` | `http://localhost:8000` | Where the ML service runs |
| `ML_SERVICE_TOKEN` | empty | Shared secret with the ML service; **required in production** (both sides) |
| `ML_SHADOW_ENABLED` | `true` | Ask the models for shadow predictions |
| `ML_SNAPSHOTS_ENABLED` | `true` | Log rule snapshots (training data) |
| `ML_INSIGHTS_ENABLED` | on in development, off in production | The insight panels and AI monitor |
| `ML_INSIGHTS_ORGANIZER` | `false` | Also show organizers the experimental aggregates |
| `ML_REC_DISPLAY` | `false` | Show customers the recommendation rows |

None of these lets a model make a decision.

---

## 6. Running the whole app (Windows, Command Prompt)

### Requirements
- Node.js 18 or newer.
- Python **3.13**.
- PostgreSQL: the URL is in `apps/api/.env`, `DATABASE_URL`.
- Redis is optional: without it the API uses an in-memory seat-lock store.

### First-time setup (once per machine)

```bat
cd /d D:\ticket-ledger
npm install

:: Backend settings (copy, then fill in DATABASE_URL, JWT secret etc.)
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env

:: Database tables
cd apps\api
npx prisma generate
npx prisma migrate deploy

:: A super admin account (password via environment variable)
set ADMIN_PASSWORD=ChooseAStrongPassword1!
node scripts\create-super-admin.mjs --email you@example.com --name "Your Name"
set ADMIN_PASSWORD=

:: ML service: Python environment and the five committed models
cd ..\ml-service
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\python.exe scripts\verify_v0_artifacts.py

:: Register the models (as SHADOW) in your database
cd ..\api
node scripts\ml-register-models.mjs
```

`verify_v0_artifacts.py` must end with "all artifacts verified". The registration prints five rows marked SHADOW.
Running it again changes nothing.

### Every day: three Command Prompt windows

```bat
:: Window 1 - backend (http://localhost:5000)
cd /d D:\ticket-ledger\apps\api
npm run dev

:: Window 2 - frontend (http://localhost:5173)
cd /d D:\ticket-ledger\apps\web
npm run dev

:: Window 3 - ML service (http://localhost:8000), optional
cd /d D:\ticket-ledger\apps\ml-service
.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

Stop any of them with Ctrl+C. (The root shortcut `npm run dev:ml` doesn't work; use the Window 3 command.)

### Check that everything works

| Open | You should see |
|---|---|
| `http://localhost:5173` | The website |
| `http://localhost:5000/api/health` | The backend health answer |
| `http://localhost:8000/health` | `"status": "healthy"` |
| `http://localhost:8000/v2/health` | The five models, each `"fingerprint_ok": true`, `"may_serve_decisions": false` |
| `http://localhost:8000/docs` | The ML service's list of endpoints |
| `http://localhost:5173/admin/ai-monitor` (as super admin) | ML service "Reachable", five models SHADOW |

`http://localhost:8000/...` only has the addresses above. App pages such as `/admin/ai-monitor` are on **5173**.
Opening them on 8000 gives `{"detail": "Not Found"}`.

### Tests

```bat
:: ML service (about 5 minutes)
cd /d D:\ticket-ledger\apps\ml-service
.venv\Scripts\python.exe -m pytest -q

:: Frontend
cd /d D:\ticket-ledger\apps\web
npm test

:: Backend AI safety tests (no server needed)
cd /d D:\ticket-ledger\apps\api
node --test --test-concurrency=1 test_ml_step6_unit.mjs test_ml_hardening_unit.mjs
```

The database-writing tests only run on a copy whose name ends in `_verify` (see `docs/ml-step6-integration.md`).

---

## 7. Demonstration script (about 15 minutes)

1. **Start** all three windows (section 6). Open the AI monitor and point out:
   - ML service Reachable;
   - five models in SHADOW;
   - "No real outcomes logged yet", and why: synthetic training, no genuine customers yet.
2. **Fraud (C):** as a customer, open checkout with `?bot` added to the address and pay. It's blocked by the security
   rules. Back in the monitor, "Checkouts blocked by the rules" has gone up. Stop the ML service and repeat: still
   blocked, showing the rules don't depend on the AI.
3. **Demand (F):** open Demand forecast and drag a price slider.
   - The rule estimate changes, and the experimental what-if appears with "not saved, not applied".
   - Show that nothing changes until Save.
4. **Attendance and crowd (G, H):** Gates → an event → Live tab.
   - Expected attendance (rule).
   - The arrivals chart per gate: the rule line, plus the grey model line once scored.
5. **Intent and abandonment (A, B):**
   - As a customer, browse an event, choose a seat, start checkout and leave.
   - The Abandoned intents page shows it straight away (rule).
   - To see the background scoring without waiting 30 + 15 minutes, run the jobs once from `apps/api`. They are
     the same jobs the server runs every 15 minutes, and they only write prediction rows:
     ```bat
     node -e "import('./src/services/ml/jobs.js').then(m=>m.runMlJobs()).then(r=>{console.log(JSON.stringify(r,null,1));process.exit(0)})"
     ```
     A visit only counts as finished 30 minutes after its last action, so a visit you just made is scored on a
     later run.
6. **Organizer view:** sign in as an organizer and open Purchase intent. The rule figures are shown, and the box
   says "shown to platform admins only".
7. **Behaviour (D):** admin → Behavior. Show first-time vs returning buyers and the activity charts.
8. **Recommendations (E, optional):** switch on `ML_REC_DISPLAY`, show the row on Events, then switch it off.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `{"detail": "Not Found"}` | You opened an app page on port 8000; use 5173 |
| Monitor: "ML service unavailable" | Window 3 isn't running, or `ML_SERVICE_URL` is wrong |
| Model card: "No model registered" | Run `node scripts\ml-register-models.mjs` in `apps\api` |
| "different model file … refused" / fingerprint warning | Run `verify_v0_artifacts.py`; restore the committed files with `git restore apps/ml-service/models/v0` |
| Background jobs "Not run yet" | Normal for the first ~3 minutes after the backend starts |
| Everything says "No real outcomes logged yet" | Expected until genuine customers use the app |
| Panels missing entirely | `ML_INSIGHTS_ENABLED=false`, or you're not allowed to see that event |
| Never run `python -m ml.train --allow-synthetic` without `--artifacts <another folder>` | It would overwrite the committed models and their fingerprints |
