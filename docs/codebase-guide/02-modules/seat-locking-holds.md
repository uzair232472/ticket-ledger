# Module: Seat locking & holds

[← Modules](README.md) · Functions: [venues & seats](../functions/api-venues-seats.md) · [`config/redis.js`](../functions/api-core.md#api-config-redis) · [VenueBooking](../functions/web-components.md#web-venuebooking) · Journey: [seat selection](../03-journeys.md#journey-4--choose-seats-hold-and-checkout)

## Overview

A **hold** (also called a lock) reserves a seat for one customer for **10 minutes** (`HOLD_SECONDS = 600`) while they go to checkout. At most **10** seats per customer at a time. The hold is stored **in PostgreSQL on the `Seat` row** (`status = LOCKED`, `lockedByUserId`, `lockedUntil`). Redis plays a minor, optional role only in the legacy per-seat flow.

There are two entry points:

| Flow | Used when | Endpoint | Lock storage |
|---|---|---|---|
| **Venue-plan holds** (current) | Event has a published venue plan | `POST /api/venues/event/:eventId/holds` and `/holds/release` | PostgreSQL only |
| **Legacy per-seat lock** | Event still on the old grid (`SeatMap` → `LegacySeatMap`) | `POST /api/seats/lock`, `/unlock` | Redis key `seat:lock:<seatId>` (or in-memory map) **and** PostgreSQL |

## Behind the scenes

### The atomic hold (both flows)
The key idea is a single SQL statement that checks and writes at once (`venueService.FREE_SQL`):

```sql
UPDATE "Seat" s SET status='LOCKED', "lockedByUserId"=$user,
       "lockedUntil" = now() + 600 seconds
WHERE s.id = $seat AND (
  s.status = 'AVAILABLE'
  OR (s.status = 'LOCKED' AND s."lockedUntil" < now()
      AND NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."seatId" = s.id)))
RETURNING s.id
```
If two customers click the same seat at the same moment, PostgreSQL serialises the two updates on that row; the second finds the seat no longer free and returns no row → 409 "Someone else is holding this seat". A **lapsed** hold counts as free unless a checkout ticket references it (an in-progress payment keeps its seats).

### Venue-plan hold sequence
```mermaid
sequenceDiagram
  participant U as VenueBooking (browser)
  participant C as venueController.createHold
  participant S as venueService
  participant DB as PostgreSQL
  participant IO as Socket.IO
  U->>U: click seat → SeatPopover → "Select"
  U->>C: POST /venues/event/E/holds {key}
  C->>S: holdSeat(E, key, user)
  S->>DB: assertBookable (event PUBLISHED + published plan)
  S->>DB: expireStaleHolds(E) (fail stale checkouts, free lapsed locks)
  S->>DB: find seat by (eventId, layoutKey); already mine? → return
  S->>DB: count my live holds (≤10)
  S->>DB: atomic UPDATE … FREE_SQL RETURNING
  S->>IO: emit seat:status_batch {eventId, seats}
  S-->>U: {holds:[…lockedUntil]}
  U->>U: load() → refresh plan, countdown, dispatch tl:holds-changed
  IO-->>U: other browsers patch their maps
```

| # | Step | File → function |
|---|---|---|
| 1 | Seat click opens popover (nothing reserved yet) | `VenueBooking.toggleSeat` |
| 2 | Select → hold request (login check, ≤10 check) | `VenueBooking.selectFromPop` → `liveAdapter.hold` |
| 3 | Body dispatch | `venueController.createHold` (`holdSchema`) |
| 4 | Event bookable | `venueService.assertBookable` |
| 5 | Lazy cleanup | `venueService.expireStaleHolds` |
| 6 | Limit | `assertRoom` / `myOpenHoldCount` |
| 7 | Atomic lock | `holdSeat` (`$queryRaw` with `FREE_SQL`); tables: `holdTable` (transaction, all-or-nothing); GA: `setGaQuantity` (`FOR UPDATE SKIP LOCKED`) |
| 8 | Broadcast | `emitSeatChanges` → `seat:status_batch` |
| 9 | Client refresh | `VenueBooking.load`, `HoldBar`, `useCartHolds` via `tl:holds-changed` |

### Release and expiry
- **Explicit release:** `releaseHolds(eventId, keys, user)` — expands whole tables, retires the user's unpaid checkout that contains those seats (order → FAILED, tickets deleted, tier counts restored), then frees the seats and broadcasts.
- **Expiry:** there is **no timer on the server**. Lapsed holds are simply treated as free by `FREE_SQL`, and `expireStaleHolds` physically resets them (and fails checkouts whose holds ended more than **120 s** ago — a grace period for in-flight payments) whenever someone loads the plan, holds a seat, opens the legacy map or starts a checkout for that event.
- **Client timers:** `VenueBooking`, `Checkout`, `HoldBar`, `useCartHolds` count down from server `lockedUntil` corrected by the server/client clock offset and reload at 0.

### Legacy per-seat lock (`seatController.lockSeat`)
1. Reject sold/blocked/GA/whole-table; return the existing hold if it is mine and live.
2. `acquireSeatLock(seatId, user, 600)` → Redis `SET seat:lock:<id> <user> NX EX 600` (or memory map). Failure → check holder → 409 unless mine.
3. Same atomic PostgreSQL `UPDATE … FREE_SQL`; if it fails, release the Redis key → 409.
4. Emit `seat:status_change`, track `seat_selected` + `seat_locked`.
Booking later accepts a seat if it is locked by the user **in the DB or in Redis** (`initiateBooking`).

## Redis keys

| Key | Value | TTL | Written by | Read by | Deleted by |
|---|---|---|---|---|---|
| `seat:lock:<seatId>` | user id | 600 s (`EX`) | `acquireSeatLock` ← `lockSeat` | `checkSeatLock` ← `lockSeat`, `initiateBooking` | `releaseSeatLock` ← `unlockSeat`, `lockSeat` (rollback), `confirmBooking`, `cancelBooking` |

With Redis offline, the same semantics run in a process-local `Map` (lost on restart, not shared between processes). Behaviour difference: with Redis, re-locking your own seat via `NX` fails (the code then checks the holder and continues); the memory map extends the TTL.

## Concurrency and cleanup summary

| Risk | Protection |
|---|---|
| Two users, one seat | Single atomic `UPDATE … WHERE free` |
| Two users, last GA places | `FOR UPDATE SKIP LOCKED` + count check inside a transaction |
| Partial whole table | Transaction rolls back unless every chair locked |
| Hold lapses during payment | 120 s grace; ticket existence keeps the seat out of `FREE_SQL` |
| Plan published during holds | `publishDraft` row-locks event + seats; refuses changes to protected seats |
| Abandoned checkout | `expireStaleHolds` (lazy) or `releaseHolds`/`cancelBooking` |
| Seat sold twice | `Ticket.seatId` unique constraint |

## Failure behaviour
Redis down → warning, memory fallback. DB conflict → clear 409 messages (`explainUnavailable`). Socket down → clients still correct on next `load()` (the booking component re-fetches on reconnect and at countdown end). Hold limit → 409 "at most 10".

## Worked example (fictional)
Event E (published plan, section `sec_a`, seat key `sec_a/B/7`, tier PKR 3,000).
1. 19:00:00 Hina selects B-7 → `UPDATE` returns row → seat `LOCKED`, `lockedUntil` 19:10:00, `lockedByUserId=Hina` → socket batch → Omar's map shows B-7 as held ("H").
2. 19:00:01 Omar clicks B-7 → popover not offered (state held) → if he raced the request: `UPDATE` returns nothing → 409 "Someone else is holding this seat right now."
3. Hina goes to checkout at 19:06 → `initiateBooking` creates order O (PENDING) + ticket on B-7 → `availableQuantity` −1.
4. Hina never pays. At 19:12:30 Omar opens the plan → `expireStaleHolds`: lockedUntil (19:10) < now − 120 s (19:10:30) → O → FAILED, ticket deleted, tier +1, seat AVAILABLE → batch event → B-7 free for Omar.
