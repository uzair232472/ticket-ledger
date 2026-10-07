# TicketLedger codebase handbook — start here

A guide to how the TicketLedger code works, written from the code at commit `1ac4075` (2026-10-07; first edition at `cbe37ba`, see [what changed](12-coverage.md#changes-since-the-first-edition-cbe37ba--1ac4075)). It explains the architecture, follows each feature through the code, locates every function, and shows how the modules work together. Wherever the code is incomplete, simulated, unused or disconnected, the guide says so.

**Two ways to read it**
- These Markdown pages (render on GitHub or in any Markdown viewer; diagrams use Mermaid).
- [`index.html`](index.html), the same content as one offline file: open it straight from disk in a browser (no server needed). It has a sidebar, search, collapsible sections and rendered diagrams. To rebuild it after editing the Markdown, see [`_build/README.md`](_build/README.md).

## What TicketLedger is (in one minute)

A ticketing platform for Pakistani sports and concerts:
- **Customers** browse events, pick seats on an interactive venue plan, hold them for 10 minutes, check out (card payments through Stripe in test mode when configured; JazzCash/EasyPaisa simulated) after an automatic anti-bot check, and get signed QR passes in a wallet. They can transfer tickets or resell them at no more than 110 % of the price.
- **Organizers** register a company (approved by an admin), create events, draw seating plans, submit events for approval, invite gate staff and watch sales and entry live.
- **Gate staff** scan passes with a phone camera, including offline.
- **Super Admins** approve companies and events, manage users and view platform data.
- Supporting pieces: e-mail notifications, behaviour tracking with rule-based analytics, a Python ML service (demand forecast actually used), and an ERC-721 contract (minting simulated by default).

## Recommended reading order

| Step | Read | Why |
|---|---|---|
| 1 | [Architecture & startup](01-architecture.md) | The parts, how they talk, what happens when each starts |
| 2 | [Modules overview](02-modules/README.md) | One page per feature, "behind the scenes" |
| 3 | [Authentication](02-modules/authentication.md) → [Seat locking](02-modules/seat-locking-holds.md) → [Booking & payment](02-modules/booking-payment.md) → [Tickets & QR](02-modules/tickets-qr.md) → [Gate check-in](02-modules/gate-checkin.md) | The core ticket life-cycle |
| 4 | [User journeys](03-journeys.md) | End-to-end paths per role, including failures |
| 5 | [Behaviour analysis & AI](02-modules/behavior-analytics-ml.md) | What is real ML and what is rules |
| 6 | [Database](07-database.md) and [API catalogue](06-api-catalogue.md) | Tables, relationships, every endpoint |
| 7 | [Function catalogue](functions/README.md) | Look up any function |
| 8 | [Where do I look if I want to change…?](10-change-index.md) | Practical index for tasks |

## All sections

| Section | Contents |
|---|---|
| [01 Architecture & startup](01-architecture.md) | Responsibilities, diagram, communication, startup sequences (API, web, ML, data, contract), request lifecycle, browser/backend/DB/external boundaries |
| [02 Modules](02-modules/README.md) | [Authentication](02-modules/authentication.md) · [Companies & staff](02-modules/companies-staff.md) · [Events](02-modules/events.md) · [Venue plans](02-modules/venues-seating.md) · [Seat locking](02-modules/seat-locking-holds.md) · [Booking & payment](02-modules/booking-payment.md) · [Tickets & QR](02-modules/tickets-qr.md) · [Gate check-in](02-modules/gate-checkin.md) · [Transfers & resale](02-modules/transfers-resale.md) · [Blockchain / NFT](02-modules/blockchain-nft.md) · [Behaviour & AI](02-modules/behavior-analytics-ml.md) · [Notifications](02-modules/notifications-email.md) · [Dashboards](02-modules/dashboards-admin.md) · [Frontend shell](02-modules/frontend-shell.md) |
| [03 Journeys](03-journeys.md) | 11 role-based journeys with success and failure paths |
| [04 File inventory](04-file-inventory.md) | Annotated tree; every tracked file with purpose, module, exports, dependencies, users |
| [05 Function catalogue](functions/README.md) | Every function/component/handler, plus a full symbol index |
| [06 API catalogue](06-api-catalogue.md) | Method, path, middleware, handler, tables, web callers |
| [07 Database](07-database.md) | ER diagram, enums, tables, integrity mechanisms, read/write map |
| [08 Shared code](08-shared-code.md) | Reusable pieces, who uses them, change impact, event subscriptions |
| [09 State, realtime & config](09-state-realtime-config.md) | Frontend/auth state, Redis keys, Socket.IO events, background work, integrations, env variables |
| [10 Change index](10-change-index.md) | "Where do I look if I want to change…?" |
| [11 Glossary](11-glossary.md) | Terms used in this guide |
| [12 Coverage](12-coverage.md) | Revision, method, coverage results, unresolved items, notable findings |

## Conventions

- Paths are relative to the repository root; `file.js:123` means line 123 at commit `1ac4075` (the committed version; a local formatting edit to `Checkout.jsx` is ignored).
- **Observed** = read in the code. **Inferred** = deduced (marked explicitly). Examples use fictional data; outputs are hand-computed unless stated as produced by running code.
- Secret values (`.env`, keys) are never reproduced; only variable names.
- Labels used: *unused* (no caller), *legacy* (superseded but still mounted), *simulated/mock* (stands in for a real service), *gap* (missing check or behaviour).
