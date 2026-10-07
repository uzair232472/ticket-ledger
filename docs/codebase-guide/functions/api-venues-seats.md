# Function catalogue — venue plans, seats, holds & seat locking

[← Function catalogue index](README.md) · Module walkthroughs: [Venue plans & seating](../02-modules/venues-seating.md) · [Seat locking & holds](../02-modules/seat-locking-holds.md)

Files: `apps/venue-core/src/*.js` (shared geometry library, imported by the API with a relative path and by the web app through the Vite alias `@venue-core`), `apps/api/src/services/venueService.js`, `controllers/venueController.js`, `controllers/seatController.js`.

**Two seating systems coexist** (observed):
1. **Venue plans (current)** — organizer draws sections in the Venue Editor; publishing turns the plan into `Seat` rows with a `layoutKey`. Attendees book through `/api/venues/*` holds. Locks live **only in PostgreSQL** (`Seat.status = LOCKED`, `lockedUntil`, `lockedByUserId`).
2. **Legacy seat grid** — `POST /api/seats/generate-grid` creates simple A/B/C rows without `layoutKey`; attendees lock seats one by one through `POST /api/seats/lock`, which takes a **Redis (or in-memory) lock first and then the same PostgreSQL lock**. `SeatMap.jsx` and parts of `Checkout.jsx`/`useCartHolds.js` still call these endpoints.

---

## `apps/venue-core/src/geometry.js` — pure 2D maths (SVG coordinates: x right, y down, degrees clockwise)

| Function | Line | What it computes | Main users |
|---|---|---|---|
| `polar(cx, cy, r, deg)` | `:9` | Point at radius/angle. | arcs, tables |
| `rotate([x,y], deg, [cx,cy])` | `:11` | Rotates a point around a centre. | rect/polygon frames |
| `round(v, p=2)` | `:19` | Rounds to `p` decimals. | everywhere |
| `shapePolygon(shape, segments=48)` | `:22` | Closed outline polygon; arcs are sampled (≥4 steps, proportional to sweep), rects rotated, polygons copied. | validation, hit tests, rendering |
| `shapePath(shape)` | `:51` | SVG `d` string; true SVG arcs for arc sections. | web `VenueMap`, editor |
| `bounds(points)` | `:65` | Bounding box `{x,y,w,h,maxX,maxY}`. | validation, camera |
| `boxesOverlap(a,b)` | `:79` | Box intersection test. | `validateLayout` |
| `pointInPolygon([x,y], poly)` | `:81` | Ray-casting inside test. | seat placement checks, overlap |
| `polygonCentroid(poly)` | `:91` | Area centroid (falls back to box centre for degenerate polygons). | labels, polygon frames, tables |
| `shapeAnchor(shape)` | `:109` | Label position and a rotation kept between −90° and 90° so text stays readable. | map labels |
| `moveShape(shape, from, to)` | `:128` | Drag: arcs rotate around their centre (angle delta normalised to ±180°), rects translate, polygons translate every point. | editor drag |
| `shapeBounds(shape)` | `:144` | `bounds(shapePolygon(shape))`. | editor handles |
| `widestChord(poly, y)` | `:149` | Widest horizontal interval inside a polygon at height `y` (pairs sorted edge crossings). | row tracks in custom shapes |

## `apps/venue-core/src/generate.js` — deterministic seat generation

The same configuration always produces the same seats and **stable keys** (`<sectionId>/<rowLabel>/<number>`, tables `<sectionId>/Table N/<chair>`, GA `<sectionId>/GA/<n>`), so the editor preview, the attendee map and the API's `Seat` rows always agree (comment `:3-12`).

| Symbol | Line | Behaviour |
|---|---|---|
| `DEFAULT_ROWS`, `DEFAULT_TABLES`, `DEFAULT_GA` | `:14-31` | Defaults merged into a section's settings. |
| `LIMITS` | `:33` | rows 100, seats/row 200, positions/section 5000, total 60 000, sections 150, tables 200, seats/table 16, whole-table seats 10 (= checkout limit), GA capacity 50 000. |
| `rowsOf`, `tablesOf`, `gaOf` | `:45-47` | Section settings merged with defaults. |
| `rowLabel(index, style, start)` | `:49` | `numbers` → start+index; `letters` → A…Z, AA… (spreadsheet style) from `start`. |
| `seatCountForRow(rows, i)` | `:61` | Per-row override (`perRow[i]`) or `seatsPerRow`, floored, ≥0. |
| `aislesBefore(aisles, p)` *(private)* | `:66` | Number of aisle gaps before position `p`. |
| `rowOffsets(n, rows)` *(private)* | `:69` | Distance of each seat along a row: `p*seatSpacing + aislesBefore*aisleWidth`; returns offsets and total length. |
| `rowTracks(section, rows)` *(private)* | `:81` | One "track" per row (or `null` if the row does not fit the depth). **Arc:** radius `r0 + inset + rowSpacing*(i+0.5)`; usable length = arc length minus margins; seat 0 starts at the higher angle (viewer's left facing the centre). **Rect/polygon:** rotate into a local frame facing up; row line at `y`; chord = full width (rect) or `widestChord` (polygon); optional bow `curve*rowSpacing*2.5` makes row ends move forward; seats centred in the chord. |
| `maxSeatsInRow(section, i)` | `:173` | Largest `n` whose `rowOffsets` length fits the track. |
| `fitRows(section, cap)` | `:183` | Sets `perRow` for every row to its maximum (used by templates and "Fit seats to rows"). |
| `maxRows(section)` | `:192` | Index of the first row track that does not fit. |
| `generateRows(section)` *(private)* | `:200` | For each row: label (duplicate → error), skip/raise errors for rows that do not fit or exceed limits, place seats (`rtl` numbering reverses numbers), flag seats outside non-arc outlines, mark `blocked` from `"row:position"` list, add row label endpoints. |
| `generateTables(section)` *(private)* | `:256` | Arc sections are rejected. Chair ring radius from chairs×pitch; table spacing raised to avoid overlap (warning); tables laid out in a centred grid of `columns`, rotated by the section's facing; each chair gets a key and `tableKey`; chairs outside the outline → error. |
| `generateSection(section)` | `:313` | Dispatches by `booking` (`ga` / `tables` / `seats`) and returns `{seats, rowLabels, tables, issues, seatRadius, stats:{positions, blocked, sellable, guests, tables, sellableUnits, unit}}`. |

## `apps/venue-core/src/validate.js`

| Function | Line | Behaviour |
|---|---|---|
| `shapeError(shape)` *(private)* | `:7` | Text of the first problem: non-numeric values, `r1 ≤ r0`, sweep ≤0 or >360°, non-positive rect size, polygon with <3 or >200 points. |
| `segmentsCross`, `polygonsOverlap` *(private)* | `:30`, `:35` | Orientation test for edge crossings; polygons overlap if a vertex is inside the other or edges cross. |
| <a id="vc-validatelayout"></a>`validateLayout(layout, {tierIds, requireTiers})` | `:48` | Checks plan size (0–5000), ≤150 sections, section id format `^[A-Za-z0-9_-]{3,40}$` and uniqueness, unique case-insensitive names (1–60 chars), booking type, shape, tier assignment (required when publishing; must still exist), table mode, GA capacity; runs `generateSection` for each and turns its issues into errors/warnings; warns when a section leaves the canvas; errors when sections overlap; total positions ≤ 60 000. Returns `{errors, warnings, generated, totals}`. Callers: `venueController.saveDraft` (draft, tiers optional), `venueService.publishDraft` (`requireTiers:true`), `autoProvisionVenueLayout`, web `VenueEditor` (live feedback). |

## `apps/venue-core/src/templates.js`

| Symbol | Line | Behaviour |
|---|---|---|
| `LAYOUT_VERSION` | `:8` | `1`. |
| `newSectionId()` | `:11` | `sec_` + time + counter + random. |
| `seats/ga/tables/arc/rect` helpers *(private)* | `:13-17` | Section and shape constructors. |
| `cricket, football, hockey, arena(kind), concert, qawwali, theatre, conference, general, custom` *(private)* | `:19-155` | Template builders returning `{coordinate, feature, sections}` with `tierHint` (`premium`/`standard`/`value`) per section. Comment `:3-6`: suggestions, not certified plans of real venues. |
| `TEMPLATES` | `:157` | Key → `{label, description, build}`. Served by `GET /api/venues/templates`. |
| `TEMPLATE_FOR_EVENT_TYPE` / `suggestTemplate(type)` | `:171`, `:185` | Event type → template key (default `concert`). |
| `assignTiers(layout, tiers)` | `:188` | Keeps a valid existing `tierId`; otherwise premium → most expensive tier, value → cheapest, standard → middle. |
| `buildTemplate(key, {tiers})` | `:198` | Builds a full layout object `{version, template, coordinate, background:null, feature, sections}` with seat rows auto-fitted, then assigns tiers. |

## `apps/venue-core/src/index.js`

Re-exports all modules and adds <a id="vc-layoutinventory"></a>**`layoutInventory(layout)`** (`:13`): flattens a plan into one entry per bookable position `{sectionId, sectionName, tierId, key, row, number, kind: SEAT|TABLE_SEAT|GA_SLOT, tableKey, wholeTable, blocked}`. GA capacity becomes numbered `GA` slots so the one-ticket-per-seat guarantees (unique `Ticket.seatId`) also cover standing zones. Callers: `venueService.publishDraft`, `autoProvisionVenueLayout`; `scripts/migrate-legacy-venues.mjs`.

---

## `apps/api/src/services/venueService.js`

Constants: `HOLD_SECONDS = 600` (10-minute hold), `MAX_TICKETS_PER_BOOKING = 10`, `PAYMENT_GRACE_SECONDS = 120`.

### `class VenueError(status, message, details)` — `:12`
Error with an HTTP status and optional details (e.g. validation `errors`, publish `conflicts`), turned into a response by `venueController.fail`.

<a id="api-venue-freesql"></a>
### `FREE_SQL` — `:21`
SQL fragment used inside atomic `UPDATE … WHERE` statements: a seat is free if `AVAILABLE`, **or** `LOCKED` with `lockedUntil` in the past **and** no `Ticket` references it (no checkout in progress). Shared by `holdSeat`, `holdTable`, `setGaQuantity` and `seatController.lockSeat`. Because the check and the write happen in **one SQL statement**, two concurrent requests cannot both lock the same seat.

### `emitSeatChanges(eventId, seats)` — `:23`
Broadcasts Socket.IO `seat:status_batch` `{eventId, seats:[{seatId, key, sectionKey, status, lockedUntil, lockedByUserId}]}` to **all** clients (filtered by `eventId` on the client: `VenueBooking.jsx:140`).

<a id="api-venue-expirestaleholds"></a>
### `expireStaleHolds(eventId)` — `:46`
**This is the cleanup mechanism; there is no scheduled job — it runs lazily** at the start of `holdSeat`, `holdTable`, `setGaQuantity`, `getAvailability`, `seatController.getEventSeatMap` and `bookingController.initiateBooking`.
1. Finds `PENDING` orders for the event having a ticket whose seat's `lockedUntil` is older than now − 120 s (grace for an in-flight payment) or whose seat is no longer `LOCKED`.
2. Per order, **transaction:** conditional `PENDING → FAILED` (skip if it was confirmed/cancelled meanwhile), delete its placeholder tickets, add the seats back to each tier's `availableQuantity`, release its seats still locked by that user.
3. Raw SQL: release every lapsed lock with no ticket (`RETURNING` the rows).
4. `emitSeatChanges` for everything released; returns the count.

| Private helper | Line | Behaviour |
|---|---|---|
| `myOpenHoldCount(eventId, userId)` | `:86` | Live holds of the user not yet in a checkout. |
| `assertRoom(eventId, userId, adding)` | `:92` | 409 if holds would exceed 10. |
| `assertBookable(eventId)` | `:99` | 404 if no event; 400 unless `PUBLISHED` and a published layout exists. |
| `holdView(seat)` | `:107` | Client shape `{id, key, sectionId, section, row, seatNumber, kind, tableKey, wholeTable, lockedUntil, tier}`. |
| `explainUnavailable(seat, userId)` | `:121` | Picks the 404/409 message (sold, blocked, someone else holding, in another checkout). |

<a id="api-venue-holdseat"></a>
### `holdSeat(eventId, key, userId)` — `:130`
`assertBookable` → `expireStaleHolds` → find seat by `(eventId, layoutKey)` → reject GA slots and whole-table chairs (400) → **already mine and unexpired: return it without restarting the timer** → `assertRoom(1)` → atomic `UPDATE … SET LOCKED, lockedUntil = now()+600s WHERE id AND FREE_SQL RETURNING` → no row → explain why (409) → re-read, `emitSeatChanges`, return `[holdView]`.

### `holdTable(eventId, tableKey, userId)` — `:153`
All-or-nothing for whole-booking tables: same checks; inside a transaction, lock every free chair of the table; if fewer rows than chairs were updated, throw 409 (the transaction rolls back so no partial table is held).

### `setGaQuantity(eventId, sectionKey, quantity, userId)` — `:179`
Sets the user's held GA places in a zone to `quantity`. More → `assertRoom(diff)` then, in a transaction, lock `diff` free slots chosen by `SELECT … ORDER BY id LIMIT diff FOR UPDATE SKIP LOCKED` (concurrent buyers skip each other's rows instead of waiting); fewer than `diff` → 409 "only N left" / "sold out". Fewer → release the newest surplus holds. Returns all current holds in the zone.

<a id="api-venue-releaseholds"></a>
### `releaseHolds(eventId, keys, userId)` — `:222`
1. Expands keys of whole-table chairs to the whole table.
2. If any of those seats are in the user's **unpaid checkout** (`PENDING` order), retires that checkout: conditional `PENDING → FAILED`, delete its tickets, restore tier counts (other seats of that checkout stay held).
3. Releases the user's locked seats (no ticket) among the keys/tables; emits changes.
4. Returns `{released, inCheckout}`.
Callers: `venueController.releaseHold` ← `VenueBooking` (deselect), `useCartHolds` (remove from cart), `Checkout.jsx` (remove line).

### `autoProvisionVenueLayout(eventId)` — `:267` — **unused**
Builds and publishes a template layout from the event type and tiers, deletes unticketed seats, recreates seats, remaps existing tickets onto new seats by position, recomputes tier totals. **No caller in the repository** (search of `apps/` and scripts). It would bypass the protections in `publishDraft`.

### `getAvailability(eventId, userId)` — `:362`
Event summary + the newest `PUBLISHED` layout (or `layout:null`). Runs `expireStaleHolds`, then reads all layout seats and builds: `sections[sectionKey] = {total, available, held, sold, blocked}`; `unavailable[layoutKey] = 'S'|'B'|'H'` for non-free non-GA seats (only non-free seats are listed, to keep the payload small); `mine` = the caller's live holds and seats in their checkout (`inCheckout`, `orderId`). Also `holdSeconds` and `serverTime` (for client countdowns). Caller: `venueController.getEventVenue` ← `components/venue/adapters.js` (`load`), `Checkout.jsx:31`.

### `activeHoldsForUser(userId)` — `:411`
All live holds of the user across events, grouped by event with `count`, `totalPrice`, seat list, `keys` and earliest `expiresAt`; sorted by expiry. Caller: `GET /api/venues/holds/mine` ← `HoldBar.jsx:24` (site-wide countdown bar), `useCartHolds.js:20` (checkout cart).

<a id="api-venue-publishdraft"></a>
### `publishDraft(eventId, userId)` — `:468`
1. Load the newest `DRAFT` (400 if none) and the event's tiers; `validateLayout(..., {requireTiers:true})` → 400 with `errors`.
2. `desired` = `layoutInventory(draft.data)` keyed by layout key.
3. **Transaction (timeout 60 s):**
   - `SELECT … FROM "Event" … FOR UPDATE` and `SELECT … FROM "Seat" … FOR UPDATE` — row locks so concurrent holds/checkouts wait until publishing finishes.
   - A seat is **protected** if it has a ticket, is `SOLD`, or has an unexpired `LOCKED` hold.
   - Legacy grid seats (no `layoutKey`): any protected → 409 (cannot replace a grid with bookings); otherwise all deleted.
   - For each existing layout seat: not in the new plan → delete (or conflict if protected); identity changed (section name, row, number, kind, table) → delete + recreate (conflict if protected); tier changed, blocked/unblocked or section key changed → update (conflict if protected and tier/identity/blocked changes).
   - Any conflicts → 409 with up to 50 messages and `conflictCount`.
   - Delete in chunks of 5000, apply updates, `createMany` new seats in chunks of 5000.
   - Recompute each tier: `totalQuantity` = non-blocked seats, `availableQuantity` = total − seats with tickets.
   - Archive the current `PUBLISHED` layout, mark the draft `PUBLISHED` with `version = last + 1`, write AuditLog `VENUE_LAYOUT_PUBLISHED`.
4. Emit `venue:published {eventId, version}` (attendee maps reload).
5. Return `{layout, created, removed, updated, totals, warnings}`.

### `protectedKeys(eventId)` — `:576`
Layout keys that are booked (sold/ticketed) or held, as `{key, state}` — sent to the editor so it can warn before an organizer breaks them.

---

## `apps/api/src/controllers/venueController.js` (`/api/venues`)

Helpers: `fail(res, error, fallback)` (`:21`) maps `VenueError`/`MediaValidationError`/`ZodError` to responses, else 500; `managedEvent(req, {write})` (`:30`) loads the event and requires `canManageEvent` (with `requireApproved` for writes); `editorPayload(event)` (`:127`) assembles `{event, suggestedTemplate, tiers (price desc), draft, published, protected (protectedKeys), legacy:{seats, booked}}`; `holdSchema` (`:67`) accepts exactly one of `{key}`, `{tableKey}`, `{sectionId, quantity 0–10}`; `draftSchema` (`:128`) validates the layout envelope (background URL must be http(s) or `/uploads/`).

| Handler | Route & guards | Behaviour | Web caller |
|---|---|---|---|
| `listTemplates` (`:39`) | `GET /templates` (public) | Template keys, labels, descriptions + type→template map. | none found (editor uses `@venue-core` directly) |
| `getEventVenue` (`:51`) | `GET /event/:eventId` (`optionalAuth`) | `getAvailability`. | `adapters.js:18`, `Checkout.jsx:38` |
| `getMyHolds` (`:60`) | `GET /holds/mine` (auth) | `activeHoldsForUser`. | `HoldBar.jsx:24`, `useCartHolds.js:20` |
| `createHold` (`:74`) | `POST /event/:eventId/holds` (auth) | Dispatches to `holdSeat` / `holdTable` / `setGaQuantity` by body shape; then (since `690ea08`) fire-and-forget behaviour `SEAT_SELECTED` + `SEAT_LOCKED` with `{body, holdCount}`. | `adapters.js:19` (from `VenueBooking`) |
| `releaseHold` (`:105`) | `POST /event/:eventId/holds/release` (auth) | 1–50 keys → `releaseHolds`; then behaviour `CHECKOUT_ABANDONED` with `{releasedKeys, reason:'seat_hold_released'}` (every release, including deselects). | `adapters.js:20`, `useCartHolds.js:70,85,89`, `Checkout.jsx:208` |
| `getEditor` (`:147`) | `GET /event/:eventId/editor` (organizer) | `editorPayload`. | `VenueEditor.jsx:157` |
| `saveDraft` (`:169`) | `PUT /event/:eventId/draft` (organizer, approved company; 2 MB JSON limit) | Validate envelope, run `validateLayout` (tiers optional) for feedback only — **a draft with errors is still saved** — create or update the single `DRAFT` row. Returns `{draft, errors, warnings, totals}`. | `VenueEditor.jsx:440` |
| `discardDraft` (`:185`) | `DELETE /event/:eventId/draft` | Deletes `DRAFT` layouts. | `VenueEditor.jsx:528` |
| `publish` (`:195`) | `POST /event/:eventId/publish` | `publishDraft`, notification `EVENT_SEATING_SAVED`, returns result + fresh editor payload. | `VenueEditor.jsx:497` |
| `uploadPlanImage` (`:217`) | `POST /event/:eventId/plan-image` (multer field `plan`, 10 MB) | `validateEventImage(file,'venuePlan')` then `uploadFile(…, 'venue_plans')`; returns `{url, width, height}` for the draft background. | `VenueEditor.jsx:347` |
| `createTier` (`:230`) | `POST /event/:eventId/tiers` | New `TicketTier` with quantity 0 (quantities come from publishing). | `VenueEditor.jsx:539` |
| `listReusable` (`:242`) | `GET /event/:eventId/reusable` | Up to 30 published layouts from the same company's other events (to copy). | `VenueEditor.jsx:317` |

---

## `apps/api/src/controllers/seatController.js` (`/api/seats`) — legacy grid & per-seat locking

<a id="api-seat-geteventseatmap"></a>
### `getEventSeatMap` — `GET /api/seats/event/:eventId` — `:25`
Route uses an inline optional-auth (`seatRoutes.js:13`: a Bearer header makes `authenticateJWT` mandatory-valid). Runs `expireStaleHolds`, loads **all** seats of the event (both systems) ordered by section/row/number, marks `isLockedByMe`, groups into `sections[section].rows[row]`, and returns summary counts. Callers: `SeatMap.jsx:128`, `Checkout.jsx:35` (fallback for events without a venue plan).

<a id="api-seat-lockseat"></a>
### `lockSeat` — `POST /api/seats/lock` — `:128`
1. Validate `seatId` (UUID); 404 if missing; 409 if `SOLD` or `BLOCKED`; 400 for GA slots / whole tables (those use `/api/venues`).
2. Locked by someone else and unexpired → 409; locked by **me** and unexpired → 200 with the remaining TTL (timer not restarted).
3. **Redis step:** `acquireSeatLock(seatId, userId, 600)`. If not acquired, check the holder; unless the holder is this user → 409 "Seat lock collision".
4. **PostgreSQL step (source of truth):** atomic `UPDATE … WHERE id AND FREE_SQL`. No row → release the Redis key and 409.
5. Emit `seat:status_change` to all clients; record behaviour `SEAT_SELECTED` and `SEAT_LOCKED` (with price).
6. 200 `{seat:{…, lockedUntil, ttlSeconds:600}}`.
- **Why two locks:** the comment at `:205-206` states PostgreSQL is the source of truth so a concurrent venue hold, checkout or publish cannot be overwritten; the Redis lock is a fast first gate. Redis keys expire on their own after 600 s.
- Caller: `SeatMap.jsx:304`.

### `unlockSeat` — `POST /api/seats/unlock` — `:296`
403 unless the caller holds it; conditional `updateMany` releases only if no ticket (409 "in your checkout" otherwise); then `releaseSeatLock`; emits `seat:status_change`. Callers: `useCartHolds.js:87`, `Checkout.jsx:182`, `SeatMap.jsx` `LegacySeatMap.handleSeatClick` (`:290`, clicking a seat you hold).

### `generateSeatGrid` — `POST /api/seats/generate-grid` — `:356` (ORGANIZER, SUPER_ADMIN)
Validates `{eventId, section, tierId, rows ≤20, seatsPerRow ≤30}`; `canManageEvent`; tier must belong to the event; refused (409) if a venue plan is published. Upserts seats row by row (`A`, `B`, …) — one query per seat. **No web caller** (used by seeds/tests).

---

## Small helpers and inner closures
| Helper | Where | Behaviour |
|---|---|---|
| `planUpload(req, res, next)` | `routes/venueRoutes.js:24` | Runs multer `upload.single('plan')`; `LIMIT_FILE_SIZE` → 400 "The plan image is larger than 10 MB."; other multer errors → 400 with their message; non-multer errors → `next(err)`. |
| `VenueError.constructor(status, message, details)` | `venueService.js:13` | Stores HTTP `status` and optional `details` (spread into the error response by `venueController.fail`). |
| `labelAt(side)` (arc rows) | `generate.js:101` | Row-label position just inside the arc ends (left = higher angle). |
| `toWorld([x,y])` (rect frame) | `generate.js:123` | Rotates a local-frame point by the rect's rotation and translates to the rect centre. |
| `toWorld([x,y])` (polygon frame) | `generate.js:134` | Rotates a centroid-relative local point back by the polygon's `facing`. |
| `labelAt(side)` (straight rows) | `generate.js:161` | Row-label position at the chord ends, following the row's bow. |
| `corner(name, cx, cy, a0)` | `templates.js:39` | Football template: builds a 74° corner arc section (value tier). |
| `finite(...vals)` | `validate.js:5` | True when every value is a finite number. |
| `o(p, q, r)` | `validate.js:31` | Orientation sign (cross product) used by `segmentsCross`. |
