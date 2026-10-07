# Function catalogue — API events, approval, media & wishlist

[← Function catalogue index](README.md) · Module walkthrough: [Events, approval & media](../02-modules/events.md)

Files: `apps/api/src/controllers/eventController.js`, `controllers/eventReviewController.js`, `services/eventMediaService.js`, `controllers/wishlistController.js`. Waitlist handlers live in `ticketTransferController.js` (see [resale & transfers](api-resale-transfer-nft.md#api-waitlist)).

**Event status life-cycle** (enum `EventStatus`): `DRAFT` / `PRELAUNCH_ANALYSIS` → (organizer submits) `PENDING_APPROVAL` → (admin) `PUBLISHED` or `REJECTED` → (organizer fixes, resubmits) … `PUBLISHED` ⇄ `PAUSED`; terminal `COMPLETED`, `CANCELLED`. Only `PUBLISHED`, `PAUSED`, `COMPLETED`, `CANCELLED` are visible to the public.

---

## `eventController.js`

Schemas (top of file): `ticketTierSchema` (`name`, positive `price`, positive integer `totalQuantity`), `createEventSchema` (`:16` — name ≥3, description ≥10, `type` enum, parseable `date`, `time`, `city`, `venue`, optional `status` default `PUBLISHED`, optional `latitude`/`longitude` (multipart strings converted to numbers, empty → undefined), `locationAddress` ≤300, `contactEmail` (trimmed, lower-cased, empty → `null`), `bannerUrl` must start with `http(s)://` or `/`), `updateEventDetailsSchema` (`:58`, partial subset of details), `SINGLE_IMAGE_FIELDS` (`:62` — form field → DB column → image kind), `galleryOrderSchema` (`:68` — array of `{id}` or `{upload:n}`, max 12).

<a id="api-event-createevent"></a>
### `createEvent` — `POST /api/events` — `:76`
- **Middleware chain:** `authenticateJWT` → `requireRole('ORGANIZER','SUPER_ADMIN')` → `requireApprovedOrganizer` (sets `req.company`; refuses unapproved companies and admins without a company) → `eventMediaUpload` (multer memory storage for fields `banner`, `cardImage`, `galleryWide`, `galleryImages`×12; multer errors become 400 with readable text, `eventRoutes.js:47`).
- **Caller:** `pages/CreateEvent.jsx:311` (multipart `FormData`, `tiers` as a JSON string).
- **Steps:**
  1. Parse `req.body.tiers` if it is a string (invalid JSON → 400); require ≥1 tier; validate tiers and event fields.
  2. Build an upload list (banner, card, wide, gallery files). More than 12 gallery files → `MediaValidationError`.
  3. [`uploadEventImages`](#api-media-uploadeventimages) — validates **all** files from their bytes first, then uploads them one by one.
  4. Resolve URLs: uploaded banner, else a provided `bannerUrl`, else `null` (the web shows category artwork).
  5. **Transaction:** create `Event` (with nested `EventGalleryImage` rows in order) — status: Super Admin gets the requested status (and `approvedAt` if `PUBLISHED`); organizers always get `DRAFT` (or `PRELAUNCH_ANALYSIS` if requested) because going on sale requires approval; create each `TicketTier` with `availableQuantity = totalQuantity`; create `AuditLog EVENT_CREATED`; re-read with tiers, gallery, company.
  6. **Notification** `EVENT_CREATED` ("saved privately; set up seating, then send for approval").
  7. **201** `{event}`.
- **Failure:** Zod / media errors → 400; others → 500. Files uploaded before a failed DB write are left in storage.

<a id="api-event-getevents"></a>
### `getEvents` — `GET /api/events` — `:226` (`optionalAuth`)
- **Query:** `type, city, search, startDate, endDate, minPrice, maxPrice, status` (`limit` is sent by some pages but **ignored**).
- **Steps:** status forced to `PUBLISHED` unless `PUBLISHED|COMPLETED|PAUSED` requested; case-insensitive city; `search` matches name/venue/description (`contains`, insensitive); date range; price range via `tiers.some`. Loads tiers (price asc), company summary, `_count` of tickets and seats; orders by date. Adds `pricing:{minPrice, maxPrice, totalAvailable}` (sum of tier `availableQuantity`). If `type` was given, records behaviour `CATEGORY_VIEW` (fire-and-forget).
- **Callers:** `Dashboard.jsx:136` (home), `Events.jsx:127` (explore with filters), `Categories.jsx:22`, `PurchaseIntentAnalytics.jsx:58`, `AbandonedIntentDashboard.jsx:86`.

<a id="api-event-geteventbyid"></a>
### `getEventById` — `GET /api/events/:id` — `:326` (`optionalAuth`)
Loads tiers, ordered gallery, company contact fields, counts. Adds `organizerContactEmail` = event `contactEmail` → company email → organizer account email (then deletes `company.user` from the payload). Non-public statuses: returns **404** unless [`canManageEvent`](api-core.md#api-utils-canmanageevent) (owner or admin), who get `{event, preview:true}` and **no** view tracking. Public events record behaviour `EVENT_VIEW` (with `eventId`) — this feeds intent analytics. Caller: `EventDetails.jsx:143`.

### `getOrganizerEvents` — `GET /api/events/organizer/my-events` — `:398` (ORGANIZER, SUPER_ADMIN)
Admin: all events; organizer: own company's (or `[]` if no company). Includes tiers and counts of tickets/orders/seats, newest first. Caller: `DemandForecast.jsx:53`.

### `updateEventStatus` — `PATCH /api/events/:id/status` — `:439`
Only `authenticateJWT` on the route; ownership checked inside (owner company or admin). Organizer rules: may set `PUBLISHED` **only** to resume a `PAUSED` event (otherwise 403 "Send the event for approval"); may pause only a `PUBLISHED` event; may return to `DRAFT`/`PRELAUNCH_ANALYSIS` only from `DRAFT`/`PRELAUNCH_ANALYSIS`/`REJECTED`. `COMPLETED` and `CANCELLED` are allowed from any state. Admin publishing sets `approvedAt` if unset. **No web caller** in `apps/web/src` (used by test scripts); `PENDING_APPROVAL`/`REJECTED` are not in its accepted list.

<a id="api-event-prelaunchforecast"></a>
### `getPreLaunchDemandForecast` — `GET /api/events/:id/prelaunch-forecast` — `:517` (ORGANIZER, SUPER_ADMIN)
- **Query (what-if):** `simulatedPrice`, `simulatedCapacity`, `simulatedMarketingTier`.
- **Steps:** ownership check → capacity = simulated or `max(sum of tier quantities, 15000)` → average price = simulated or mean of tier prices (2500 if none) → day of week and weekend flag (Fri/Sat/Sun = 1) → **`mlService.forecastEventDemand({...publishHour: 18})`** (calls the Python ML service or a local fallback; see [ML catalogue](api-analytics-ml.md#api-ml-forecast)) → suggested publish time from fixed rules by event type (sports: Thursday 6:30 PM; music: Friday 7 PM; other: Wednesday 5 PM) → pricing warning: benchmark 3000 (cricket) / 4000 (music) / 1500 (kabaddi) / 2500 otherwise; `> 1.35×` benchmark → `HIGH_PRICE_WARNING`; `< 0.70×` with sellout probability ≥ 0.65 → `UNDERPRICED_WARNING`; else `OPTIMAL_PRICE`.
- **Note:** the warning texts contain fixed claims (e.g. "~18% deceleration") that are not computed. The suggested time and the pricing rules are **rule-based**, not model output.
- **Out:** `{predicted_48h_sales, expected_revenue_pkr, demand_level, demand_tier, sellout_probability, suggested_publish_time, suggested_window_reason, pricing_warning, pricing_recommendation, tiers, …}`. Caller: `DemandForecast.jsx:82`.

### `updateEventPricing` — `PUT /api/events/:id/pricing` — `:660` (ORGANIZER, SUPER_ADMIN)
Body `{tiers:[{id, price}]}`. Ownership is checked for the **event**, then each tier with `id` and truthy `price` is updated **by tier id without checking that the tier belongs to this event** (observed; a crafted request could change another event's tier). Updates run sequentially (the comment says "in parallel"). Returns the event with tiers. Caller: `DemandForecast.jsx:132`.

### `publishEventWithPricing` — `POST /api/events/:id/publish` — `:719` (ORGANIZER, SUPER_ADMIN)
Despite the name it **does not publish**: it applies the same tier price updates (same caveat), writes an AuditLog (`EVENT_PRICES_UPDATED` if live, else `EVENT_PRICES_SET_AFTER_PRELAUNCH_ANALYSIS`) and returns a message. For a live event the message now ends "Event is PUBLISHED." (since `fad6f72`; it only reports the existing status); for a draft it tells the organizer to set up seating and submit for approval. Caller: `DemandForecast.jsx:157`.

### `getEventForEdit` — `GET /api/events/:id/manage` — `:795`
Any status; `canManageEvent` (403 otherwise); returns event with tiers and gallery. No view tracking. Caller: `CreateEvent.jsx:184` (edit mode).

<a id="api-event-updateevent"></a>
### `updateEvent` — `PUT /api/events/:id` — `:830`
- **Middleware:** `authenticateJWT`, `requireRole('ORGANIZER','SUPER_ADMIN')`, `eventMediaUpload`. Ownership with `canManageEvent(..., {requireApproved:true})`.
- **Multipart contract** (doc comment `:816-829`): omitted detail fields stay unchanged; for each single image `banner|cardImage|galleryWide` send a file to replace, or `<field>Action=remove` to clear (`keep` default; `replace` without a file → 400); `galleryImages` = new files, `galleryOrder` = JSON list of `{id}` (keep existing) and `{upload:n}` (n-th new file) in final order.
- **Steps:** parse provided detail keys → build image changes → validate gallery plan (every id must be an existing image of this event, no duplicates, every new upload placed exactly once; without `galleryOrder`, new files are appended, max 12) → upload all new files (validated first) → **transaction:** update event; if a gallery plan exists, delete images not kept, update positions of kept ones, create new ones; AuditLog `EVENT_UPDATED` → **Notification** `EVENT_UPDATED`.
- **Design note (from comment):** files are uploaded before any DB write and old files are never deleted, so a failed save never breaks the live page.
- **Caller:** `CreateEvent.jsx:361`.

<a id="api-event-deleteevent"></a>
### `deleteEvent` — `DELETE /api/events/:id` — `:969` (ORGANIZER, SUPER_ADMIN)
`canManageEvent` → counts `SUCCESSFUL` and `PENDING` orders; any → **409** (paid orders: "cancel instead"; pending: "a customer is paying right now"). Otherwise **transaction:** delete remaining (failed) orders — their tickets cascade — then the event (tiers, seats, layouts, gallery, wishlist items, waitlist, invites, assignments cascade via the schema). AuditLog `EVENT_DELETED`; if an admin deleted someone else's event, the organizer gets an `EVENT_DELETED` notification. Callers: `OrganizerDashboard.jsx:132`, `SuperAdminDashboard.jsx:100`.

---

## `eventReviewController.js` — admin approval workflow

| Helper | Line | Behaviour |
|---|---|---|
| `SUBMITTABLE` | `:11` | `['DRAFT','PRELAUNCH_ANALYSIS','REJECTED']`. |
| `when(d)` | `:12` | Medium date in `Asia/Karachi` for notification text. |
| `seatingReady(eventId)` | `:15` | `true` if a `PUBLISHED` `VenueLayout` exists **or** any `Seat` rows exist (older grid generator). |

### `getSubmissionStatus` — `GET /api/events/:id/submission` — `:24`
`canManageEvent`; returns `{event, seating:{published, version, sections, seats}, canSubmit}` where `canSubmit` = submittable status and seating ready. Caller: `EventSubmit.jsx:47`.

<a id="api-review-submit"></a>
### `submitEventForReview` — `POST /api/events/:id/submit` — `:54`
`canManageEvent(..., {requireApproved:true})` → already `PENDING_APPROVAL` → 409; not submittable → 409; no seating → 400 → **update** `status=PENDING_APPROVAL, submittedAt=now` → `createMany` notifications: `EVENT_REVIEW_REQUEST` to every active Super Admin and `EVENT_SUBMITTED` to the submitter (all emailed by the hook) → AuditLog `EVENT_SUBMITTED_FOR_REVIEW`. Caller: `EventSubmit.jsx:63`.

### `listEventsForReview` — `GET /api/admin/event-reviews?status=` — `:100` (SUPER_ADMIN)
`status` ∈ `PENDING_APPROVAL` (default, oldest submission first) | `REJECTED` | `PUBLISHED` (only those with `approvedAt`, i.e. approved through review; newest review first); max 100; plus `groupBy` counts for pending/rejected. Caller: `AdminEventApprovals.jsx`.

<a id="api-review-reviewevent"></a>
### `reviewEvent` — `POST /api/admin/event-reviews/:id` — `:132` (SUPER_ADMIN)
Validate `{decision: APPROVE|REJECT, comment}` (reject needs ≥5 chars) → must be `PENDING_APPROVAL` (409) → **conditional `updateMany`** on `status: PENDING_APPROVAL` so two admins cannot both review (second gets 409) → sets `PUBLISHED` + `approvedAt` or `REJECTED`, `reviewedAt`, `reviewedBy` (admin email), `reviewComment` → notification `EVENT_APPROVED` / `EVENT_REJECTED` to the organizer → AuditLog. **Approval is what puts an organizer's event on sale.**

---

## `eventMediaService.js`

### `class MediaValidationError extends Error` — `:5`
Carries `status = 400`; controllers map it to a 400 response.

`mb(bytes)` (`:12`) formats sizes for messages.

<a id="api-media-validateeventimage"></a>
### `validateEventImage(file, kind)` — `:18`
Using `EVENT_IMAGE_SPECS[kind]`: (1) size ≤ `maxBytes`; (2) [`inspectImage`](api-core.md#api-utils-inspectimage) must recognise JPEG/PNG/WebP from bytes; (3) each side ≤ 8000 px and ≤ 40 MP; (4) minimum size (for any-ratio `venuePlan`, compared as long side/short side so portrait works); (5) ratio within ±10 % of the target. Returns `{format, mime, ext, width, height}` or throws `MediaValidationError` with a user-facing message. Callers: `uploadEventImages`, `venueController.uploadPlanImage`.

<a id="api-media-uploadeventimages"></a>
### `uploadEventImages(entries)` — `:45`
Validates every `{file, kind}` first (so one bad file aborts before anything is stored), then sequentially calls `uploadFile(file, 'event_media', {extension: info.ext})` — the stored extension comes from the sniffed type, not the client filename. Returns URLs in input order. Callers: `createEvent`, `updateEvent`.

---

## `wishlistController.js` (`/api/wishlist`, all behind `authenticateJWT`)

`PUBLIC_STATUSES` (`:7`) = `PUBLISHED, PAUSED, COMPLETED, CANCELLED`.

| Handler | Route | Behaviour | Caller |
|---|---|---|---|
| `getWishlistIds` (`:10`) | `GET /ids` | Event ids the user saved, limited to public events. | `WishlistContext` on sign-in (`:28`) |
| `getWishlist` (`:24`) | `GET /` | Saved public events with tiers, company, counts, `savedAt` and the same `pricing` summary as `getEvents`, newest save first. | `pages/Wishlist.jsx:34` |
| `addToWishlist` (`:59`) | `POST /:eventId` | 404 unless the event is public; idempotent `upsert` on the `(userId, eventId)` unique key; 201. | `WishlistContext.toggle` (`:59`) |
| `removeFromWishlist` (`:78`) | `DELETE /:eventId` | `deleteMany` scoped to the caller (idempotent). | `WishlistContext.toggle` (`:60`) |

## Small helpers
| Helper | Line | Behaviour |
|---|---|---|
| `MediaValidationError.constructor(message)` | `eventMediaService.js:6` | Calls `super(message)` and sets `this.status = 400`. |
