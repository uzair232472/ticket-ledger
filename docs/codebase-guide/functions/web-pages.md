# Function catalogue — web pages (`apps/web/src/pages/`)

[← Function catalogue index](README.md) · Routes: [Frontend shell → route table](../02-modules/frontend-shell.md#route-table) · Components: [web components](web-components.md)

For each page: route(s) and guard, the data it loads (with the API endpoint), its handlers in the order a user meets them, inline effects, and notable behaviour. Inline JSX handlers that only toggle local UI state (open/close, tab switches) are summarised rather than listed one by one.

---

## Public discovery

### `Dashboard()` — `/` — `Dashboard.jsx:110` (the homepage)
- **Load:** `loadEvents()` (`:133`) → `GET /api/events` (all published events) once.
- **Derived:** upcoming events sorted by date (`:184`), featured slice, counts per category (`:191`), cities with counts (`:194`), filtered list for the search/filters panel and map.
- **Effects:** phone media query for the hero film (`:121`); `initHomeMotion` scroll scenes (layout effect `:149`, reverted on unmount); manual scroll restoration across reloads using `sessionStorage['tl-home-scroll']` (`:157`); re-measure scenes after cards load (`:173`); outside-click closes filter popovers (`:236`).
- **Handlers:** `setFilter(key, value)` (`:244`), `clearMapFilters()` (`:249`), `submitSearch(e)` (`:251` → navigates to `/events?search=…`), `skipIntro()` (`:201`), `foldOnPhones` (`:234`), wishlist hearts via `useWishlist().toggle`.
- Helpers: `CollageTile` (`:23`), `useCollageClips(rootRef)` (`:49` — hover/drag-to-play collage videos with pointer listeners), `Strips` (`:104`), `hideBroken`.

### `Events()` — `/events` — `Events.jsx:60` (Explore)
- **Filters live in the URL** (`search, type, city, maxPrice, when, sort`): `setFilter` (`:90`) writes `searchParams` (replace); the search box is debounced 350 ms into the URL (`:105`).
- **Load:** `load()` (`:114`) builds query params (`when` = next N days → `startDate/endDate`) → `GET /api/events?…`; a request counter discards stale responses; a minimum swap delay animates the transition.
- Tracks `category_view` through `trackClientBehavior` when a type filter is set (`:142`) — the server also records it (double count, see [behaviour](api-analytics-ml.md#api-behavior-trackbehavior)).
- `sortEvents(list, sort)` (`:49`, by date/price), `labelOf` (`:47`); "load more" batches; `rememberPosition()` (`:184`) stores query, visible count and scroll in sessionStorage so Back restores them (`saved` memo `:72`); category popover with outside-click/Escape (`:195`); `pickCategory` (`:210`); motion layout effect (`:217`).

### `Categories()` — `/categories` — `Categories.jsx:12`
`GET /api/events` → counts of upcoming events per category for `CategoryCard`s; `focusGrid()` (`:36`) scrolls to the grid.

### `EventDetails()` / `EventDetailsPage()` — `/events/:id` — `EventDetails.jsx:79`, `:94`
`EventDetails` remounts `EventDetailsPage` per id (`key`), so timers and animations restart for each event.
- **Load** (`:139`): `GET /api/events/:id` → event; on success `trackClientBehavior('event_view')` (also recorded server-side). 404 → not-found state; organizers/admins get unpublished events as a preview.
- `getSaleState(event)` (`:38`): decides the call to action — cancelled; ended (`COMPLETED` or past `eventDayEnd`); paused; preview labels for `PENDING_APPROVAL/REJECTED/DRAFT/PRELAUNCH_ANALYSIS`; "Tickets coming soon" if no tiers or **no seats** (`_count.seats`); sold out when the sum of tier `availableQuantity` is 0; otherwise on sale ("Only N left" below a threshold).
- `getStartingPrice(tiers)` (`:59`) cheapest available tier price; `pickRelated(events, current)` (`:69`) same type +2, same city +1, then soonest; related list from `GET /api/events` (`:166`).
- **Sold out only:** waitlist status `GET /api/events/:id/waitlist` (`:180`), resale summary `GET /api/resale/market?eventId=` (`:191`), `joinWaitlist()` (`:207` → `POST /api/events/:id/waitlist`).
- `shareEvent()` (`:305`: Web Share API or clipboard), `bookingAction(where)` (`:330`: "Choose seats" → `/events/:id/seats`, or waitlist anchor), document title effect, GSAP scenes, `ContactOrganizer`, `EventGallery`, map link via `googleMapsUrl`, wishlist heart.

### `Wishlist()` — `/wishlist` (signed in) — `Wishlist.jsx:22`
`load()` (`:31`) → `GET /api/wishlist`; list re-filters when hearts change through `useWishlist` (`:47`).

### `About()`, `Contact()`, `Legal({doc})`, `NotFound()`
- `About` (`About.jsx:21`) static page; sets the title.
- `Contact` (`Contact.jsx:19`): form state `set(k)` (`:36`), `field(...)` renderer (`:62`), `submit(e)` (`:41`) → `POST /api/contact`; sets the page title (`:25`) and pre-fills name/email when signed in (`:32`).
- `Legal` (`Legal.jsx:167`) renders `terms` or `privacy` content defined in the file.
- `NotFound` (`NotFound.jsx:73`) with an `Art` SVG (`:9`); catch-all route.

---

## Authentication pages
| Page | Route | Handlers and behaviour |
|---|---|---|
| `Login` (`Login.jsx:29`) | `/login` | Redirects signed-in users to a **sanitised** `state.from` (internal paths only, no `//`, backslashes, control chars or `/login`). `handleSubmit` (`:66`) → `useAuth().login`; `needsVerification` → stores `sessionStorage.tl_pending_email` and goes to `/verify`; `ACCOUNT_SUSPENDED` → `/suspended`; else error text. "FYP Examiner Demo Logins" panel pre-fills demo accounts. |
| `Signup` (`Signup.jsx:14`) | `/signup` | Mount effect (`:36`) → `getPendingSignup()`; if a pending signup exists the form switches to **edit mode** (password optional). `update` (`:54`), `validate` (`:60`, mirrors API rules; phone required), `handleSubmit` (`:72`) → `signup` or `updatePendingSignup` → `/verify`. `NO_PENDING_SIGNUP` falls back to a fresh signup. |
| `VerifyOtp` (`VerifyOtp.jsx:14`) | `/verify` | `loadTiming` (`:37`) → `getPendingSignup()` for server-driven countdowns with a clock offset; 1 s ticker (`:60`); `handleVerify` (`:71`) → `verifyOtp` → `getHomeRoute(user)`; `handleResend` (`:98`) → `resendOtp`, then reload timing; falls back to email from state/query/sessionStorage. |
| `ForgotPassword` (`ForgotPassword.jsx:8`) | `/forgot-password` | `handleSubmit` (`:17`) → `forgotPassword` → `/reset-password` with the generic notice. |
| `ResetPassword` (`ResetPassword.jsx:10`) | `/reset-password` | Countdown effect (`:26`); `handleSubmit` (`:32`) → `resetPassword` → `/login`; `handleResend` (`:60`) → `resendOtp(email, 'RESET_PASSWORD')`. |
| `AcceptInvite` (`AcceptInvite.jsx:9`) | `/invite/:token` | Mount effect (`:22`) → `getInvite`; signed in as another email → offers sign-out; `handleSubmit` (`:34`) → `acceptInvite` → `/staff/events`; 410 → invite unavailable. |
| `Suspended` (`Suspended.jsx:7`) | `/suspended` | Static notice with the support email. |

---

## Booking flow (customer)

### `SeatMap()` — `/events/:id/seats` — `SeatMap.jsx:33`
Creates `liveAdapter(eventId)`; effect (`:40`) calls `adapter.load()` once: a published layout → **venue mode** (renders [`VenueBooking`](web-components.md#web-venuebooking)); none or error → **`LegacySeatMap`**.

`LegacySeatMap()` (`:92`) — older grid flow:
- `getAuthHeaders()` (`:115`) Bearer + `x-session-id` from localStorage.
- `fetchSeatMap()` (`:124`) → `GET /api/seats/event/:id`; finds the user's locked seats and the earliest expiry.
- Socket effect (`:174`): `seat:status_change` patches the seat in place and adjusts summary counts.
- Countdown effect (`:237`): at 0 shows "Reservation expired" and refetches.
- `handleSeatClick(seat)` (`:261`): signed-out → login; sold/blocked/held-by-other → info dialog; held by me → `POST /api/seats/unlock`; else `POST /api/seats/lock`, then `trackClientBehavior('seat_selected')` (server also tracks) and resets the timer to 600 s.
- `updateLocalSeatStatus` (`:341`), `formatTimer` (`:371`).

### `Checkout()` / `CheckoutContent()` — `/events/:id/checkout` and `/checkout` — `Checkout.jsx:664`, `:89`
Since commit `2208b32` the default export only wraps the real page in Stripe's `<Elements stripe={stripePromise}>` provider (`stripePromise = loadStripe(VITE_STRIPE_PUBLISHABLE_KEY || <hard-coded test publishable key>)`, `:16`); all logic lives in `CheckoutContent` so it can use the `useStripe()` / `useElements()` hooks.
- **Telemetry collection** (`:93-110`): `mountTime` ref and a window `click` listener (`handleGlobalClick`, `:97`) counting clicks; registers `window.simulateBot()` (sets `window.__simulateBot` and clicks the submit button — a console demo switch); cleanup removes them.
- `loadReservation(eventId)` (`:37`): `GET /api/venues/event/:id` → the user's holds (`mine`, server prices); events without a plan fall back to `GET /api/seats/event/:id` and the seats `isLockedByMe`.
- `refresh` callback (`:145`), countdown from the earliest `lockedUntil` corrected by server time (`:176-187`); a changed selection or method clears the server quote (`:189`).
- `release(lineKeys, id)` (`:200`): legacy → `POST /api/seats/unlock` per seat; venue → `POST /api/venues/event/:id/holds/release`; dispatches `tl:holds-changed`, refreshes. `removeLine` (`:231`), `discardAll` (`:232`, confirm dialog; also posts `checkout_abandoned` telemetry `{seatCount, cartValue, reason:'user_discarded_tickets'}`).
- Effect at `:220`: once per page, when holds are loaded and the user is signed in, posts `checkout_started` telemetry `{seatCount, cartValue}` to `/api/behavior/track`.
- `validate(method, form)` (`:60`): phone `03XXXXXXXXX` (required for wallets), 6-digit OTP for JazzCash/EasyPaisa, cardholder name for Stripe (card number/expiry/CVC are entered in Stripe's `CardElement`, not validated by the page) (`normalizePhone :31`, `digits :29`).
- <a id="web-checkout-submit"></a>`submit(e)` (`:255`):
  1. Guards against double submission (`inFlight` ref) and expired holds.
  2. If no order yet (or method/selection changed): builds **`telemetry`** — `checkoutDurationSeconds` = seconds since the page mounted, `clicksPerMinute` = clicks ÷ max(1, seconds) × 60 (capped at 180; 28 if zero), `rapidSeatAttempts: 1`, `deviceSwitches: 0`; if the URL has `?bot` or `window.__simulateBot` is set, a bot profile `{0.4, 240, 6, 2}` instead — and calls `POST /api/bookings/initiate {eventId, seatIds, paymentMethod, customerPhone, telemetry}` (`:292`). If the server total differs from the displayed subtotal, stop and ask the customer to confirm again.
  3. `paymentDetails = paymentDetailsFor(method, params, form)` (`:53` — OTP + reference for wallets; for Stripe `{clientSecret, paymentIntentId, paymentTxId}`; MOCK `mockTxId`).
  4. **Stripe:** if `CardElement` exists and the `clientSecret` does not contain `mock`, `stripe.confirmCardPayment(clientSecret, {payment_method:{card, billing_details}})` (`:319`); an error shows the Stripe message and stops (order kept); success replaces `paymentDetails` with `{paymentIntentId, paymentTxId, cardLast4}`.
  5. `POST /api/bookings/confirm {orderId, paymentDetails}` (`:351`, 45 s timeout).
  6. No response (timeout/network) → navigate to `/bookings/:orderId/confirmation` with `pending: true` (outcome unknown).
  7. `SUCCESSFUL` → `OrderConfirmedModal` over the page and `tl:holds-changed`.
  8. Errors: initiate `blockedByAI` → red notice with the anomaly signals; initiate 409 → reservation problem + refresh; confirm 409/"cancelled or expired" → expired; other confirm errors → "Payment wasn't completed", order kept for retry.
- `Field` (`:73`) input wrapper; `METHODS` (`:22`) — MOCK, JazzCash, EasyPaisa, "Card (Stripe Sandbox)". The Stripe panel renders `CardElement` (postal code hidden) with a focus style and a test-card hint.

### `BookingSuccess()` — `/bookings/:orderId/confirmation` (+ legacy `/booking-success/:id`) — `BookingSuccess.jsx:25`
`fetchOrder` (`:39`) → `GET /api/bookings/:id`; while `PENDING` polls every **3 s for up to 3 minutes** (`:60`), then offers a manual check. `seatFacts` (`:13`), `head` (`:73`).

### `MyBookings()` — `/my-bookings` (CUSTOMER, SUPER_ADMIN) — `MyBookings.jsx:21`
`fetchBookings` (`:28`) → `GET /api/bookings/my-bookings` (axios with token); lists orders with status, seats and totals.

---

## Tickets (customer)

### `DigitalWallet()` — `/wallet` (CUSTOMER, SUPER_ADMIN) — `DigitalWallet.jsx:43`
- Socket effect (`:82`): joins `user_<id>`, on `ticket:checked-in` marks the ticket `SCANNED` (QR greys out live).
- `fetchWallet()` (`:92`) → `GET /api/tickets/wallet`; sorts ACTIVE first.
- `handleDownloadPDF(ticket)` (`:130`) → `GET /api/tickets/:id/pdf` → blob download.
- `handleSimulateGateScan(ticket)` (`:157`) → `POST /api/tickets/verify-qr {payload: ticket.qr.code}` (read-only "check my pass"). **Broken since `fad6f72`:** the API now only treats strings starting with `TL1:` as signed passes, but passes start with `TL1.`, so this string goes to the legacy HMAC branch and is reported invalid (400) — see [verifyTicketQRPost](api-tickets-qr-gate.md#api-ticket-verifyqr).
- `handleExecuteTransfer(e)` (`:189`) → `POST /api/tickets/transfer {ticketId, recipientEmail}` → refresh.
- `handleExecuteResaleListing(e)` (`:228`) → `POST /api/resale/list {ticketId, resalePrice}` (client shows the 110 % cap).
- `handleOpenTicketHistory(ticket)` (`:275`) → `GET /api/tickets/:id/transfer-history`; `handleOpenMyTransfers()` (`:296`) → `GET /api/tickets/my-transfers`; `copyToClipboard` (`:124`).
- Renders `WalletPass` cards inside `AccountShell`.

### `MyNFTTickets()` — `/my-nfts` (CUSTOMER, SUPER_ADMIN) — `MyNFTTickets.jsx:37`
`fetchNFTs()` (`:54`) → `GET /api/tickets/my-nfts` (triggers lazy simulated minting server-side); `handleOpenResaleModal` (`:83`); `handleListTicket()` (`:90`) → `POST /api/resale/list`; `handleCancelListing(id)` (`:132`, confirm) → `POST /api/resale/cancel/:id`; `copyToClipboard`. Renders `NftTicketCard`.

### `ResaleMarketplace()` — `/resale` (CUSTOMER, SUPER_ADMIN) — `ResaleMarketplace.jsx:42`
`fetchListings()` (`:72`) → `GET /api/resale/market?search&city&maxPrice`; `handleSearchSubmit`, `handleReset`; `openPurchase(item)` (`:154`, login check); `handleBuyTicket()` (`:114`) → `POST /api/resale/buy/:id` with `{paymentMethod}` — **the API ignores `paymentMethod`; no payment is taken** — then refreshes listings (also on failure, since it may have just sold). `PurchaseDialog` (`:566`, focus/Escape effects). Scroll position saved across reloads (`:173`); `initResaleMotion` (`:165`). Helpers `rupees`, `markupLabel`, `hideBroken`.

---

## Account

### `Profile()` — `/profile` (signed in) — `Profile.jsx:58`
Tabbed account page (overview, edit profile, security, wallet, notifications, history, behaviour).
- `loadProfile` (`:107`) → `GET /api/users/profile`; `loadHistory` (`:140`) → `GET /api/users/history`; `loadBehaviorProfile` (`:155`) → `GET /api/behavior/profile` (customers); ticket summary → `GET /api/tickets/wallet` (`:350`).
- `handleUpdateProfile` (`:192`) → `PUT /api/users/profile` (name, phone, city). **Salutation, organisation and avatar are stored only in `localStorage`** (`tl_salutation`, `tl_organisation`, `tl_avatar` — the avatar as a data URL via `FileReader`, `handleAvatarFile :181`); they never reach the server.
- `connectMetaMask()` (`:232`): `window.ethereum.request('eth_requestAccounts')` → **`switchToPolygonAmoy()`** (added in `7e93840`; prompts MetaMask to switch to / add Polygon Amoy) → `eth_chainId` → `saveWalletToBackend(address)` (`:291`) → `PUT /api/users/wallet`. **No signature challenge** proves wallet ownership; a manual address field is also accepted. `switchToPolygonAmoy()` (`:261`) calls `wallet_switchEthereumChain` with chain `0x13882` (80002) and, on error 4902, `wallet_addEthereumChain`. `handleDisconnectWallet` (`:317`) saves an empty address. Note: the API's local Hardhat chain (31337) is not offered here, so a wallet linked in the UI points at Amoy while a locally-configured API would mint on the Hardhat node.
- Behaviour KPI tiles (`:996`): intent score/tier and fraud level now read `behaviorProfile.scores.*` first (then the new `summary` object, then defaults); total actions from `totalEventsTracked`.
- `handleSaveNotifications` (`:323`) → `PUT /api/users/notifications`. `ChangePasswordCard` handles the password.
- `goTab` (`:356`), `getBreadcrumbLabel` (`:372`). Developer/API-key style panels in the page are static content.

### `Notifications()` — `/notifications` — `Notifications.jsx:40`
`fetchNotifications` (`:53`) → `GET /api/notifications?limit=50`; `handleMarkAsRead`, `handleMarkAllRead`, `handleDelete` (PATCH/DELETE endpoints); tabs All/Unread; `handleSimulateNotification` (`:106`) → `POST /api/notifications/test` (any signed-in user; creates a real notification + email); link to `/api/notifications/preview-email`. `getIcon`, `toneOf`.

### `CompanyRegistration()` — `/company` — `CompanyRegistration.jsx:27`
`loadCompany` (`:48`) → `GET /api/companies/my-company`; mount effect also calls `refreshUser()` for organizers so `companyStatus` is current (`:74`). Shows a status panel for `APPROVED` (`:235`), `PENDING` (`:253`) or `REJECTED` with the reason (`:270`), and the registration form when there is no company or it was rejected (`:286`). A `SUSPENDED` company gets no dedicated panel or form (observed). `handleChange` (`:85`); `handleSubmit` (`:89`) → `POST /api/companies/register` (multipart with optional `document` file) → `refreshUser()`. Signed-out visitors see an intro with sign-up links.

---

## Organizer studio

### `OrganizerDashboard()` — `/organizer/dashboard` (ORGANIZER approved, SUPER_ADMIN) — `OrganizerDashboard.jsx:119`
- `load(eventId)` (`:153`) → `GET /api/organizer/organizer-dashboard?eventId=`; `fetchDashboard` (`:164`) also loads the all-events tier breakdown once for per-event card totals.
- Socket effect (`:187`): joins `user_<id>`; on `checkin:stats` refreshes turnout quietly (throttled to every 2 s).
- `deleteEvent(ev, after)` (`:122`, confirm) → `DELETE /api/events/:id`.
- `changeEvent(id)` (`:256`) syncs `?eventId=`. Memos derive upcoming/past lists, totals (`totalsByEvent :59`), chart series. Renders `StaffManager`, charts, event cards with links to edit/venue/submit/forecast/intent pages. Helpers `dayLabel`, `eventDate`, `place`, `startOfToday`, `EventCard` (`:72`).

### `CreateEvent()` — `/organizer/create-event` and `/organizer/events/:id/edit` — `CreateEvent.jsx:121`
- Effects: company status `GET /api/companies/my-company` (`:163`); edit mode loads `GET /api/events/:id/manage` and fills the form, images and gallery (`:180`).
- Three steps (details → images & location → tickets); `validateStep(i)` (`:240`) mirrors API rules (past dates refused on create); `goTo(target)` (`:262`) validates every step before the target and focuses the first error.
- `handleAddTier/RemoveTier/TierChange` (`:226-232`); `update(key)` (`:213`, time picker conversion via `toTimeInput/fromTimeInput :67-75`); `setImage(field)` (`:218`).
- <a id="web-createevent-create"></a>`createEvent(status)` (`:284`): validates steps 0–2, builds `FormData` (fields, `status`, `tiers` JSON, location, image files, gallery files) → `POST /api/events` → `PRELAUNCH_ANALYSIS` goes to `/demand-forecast?eventId=…&setup=1`, otherwise to `/organizer/events/:id/venue?setup=1`.
- `saveEdits()` (`:331`): details + location + image actions (`<field>Action=remove`) + `galleryOrder` JSON → `PUT /api/events/:id` → success dialog → event page. **Tiers are not editable here** in edit mode.
- Helpers `emptyImages`, `todayIso`, `Field`, `Tips`, `err`.

### `VenueEditor()` — `/organizer/events/:id/venue` — `VenueEditor.jsx:114`
- `load` (`:155`) → `GET /api/venues/event/:id/editor`; `applyPayload` (`:146`) starts from the draft, else the published plan; resets undo history.
- `beforeunload` warning while unsaved (`:172`).
- **Undo/redo:** `update(next, key)` (`:183`) pushes history (60 steps; edits with the same key within 900 ms are coalesced), `undo` (`:197`), `redo` (`:205`); drags update live (`liveShape :216`, `liveFeature :220`) and commit one step (`commitDrag :224`).
- **Validation (debounced 180 ms, `:241`):** `validateLayout(..., {requireTiers:true})` from `@venue-core` + local **conflict check** against `protected` keys (held/booked seats must not disappear, become blocked or change tier).
- Plan sources: templates (`chooseTemplate :313` → `buildTemplate` + `assignTiers`), reuse another event's layout (`openReuse :315` → `GET /api/venues/event/:id/reusable`, `chooseReuse` re-matches tiers), upload a background image (`uploadPlan` → client checks then `POST /api/venues/event/:id/plan-image`). `replaceLayout(next, what)` (`:287`) confirms before replacing.
- Editing: `addSection(kind)` (arc/block/GA/tables with defaults), polygon drawing (`mapClickPoint`, `finishDrawing`, keyboard Enter/Escape/Backspace), `toggleBlocked(key, section)` (refuses protected seats), `updateSection`, inspector panels, `EditorOverlay` handles.
- `saveDraft({quiet})` → `PUT /api/venues/event/:id/draft {data: layout}`.
- `publish()`: blocks while errors/conflicts exist → confirmation with per-tier sellable totals → saves the draft if dirty → `POST /api/venues/event/:id/publish` → updates editor payload; in setup mode continues to Review & submit. Discard → `DELETE …/draft`; add tier → `POST …/tiers`.
- **Attendee preview:** `previewAdapter({layout, tiers, event})` feeds a `VenueBooking` in preview mode (simulated holds, nothing sent).
- Helpers `json` (`:35`), `Banner`, `PlanSources`, `SectionIcon`, `uniqueName`.

### `EventSubmit()` — `/organizer/events/:id/submit` — `EventSubmit.jsx:35`
`load` (`:45`) → `GET /api/events/:id/submission` (readiness: status, tiers, published seating); `CheckRow` list; `submit()` (`:59`) → `POST /api/events/:id/submit` → success state. `pkr` formatter.

### `DemandForecast()` — `/admin/demand-forecast`, `/demand-forecast` (ORGANIZER, SUPER_ADMIN) — `DemandForecast.jsx:29`
- `fetchEvents` (`:51`) → `GET /api/events/organizer/my-events`.
- `fetchPreLaunchForecast(eventId, simulatedPrice, customTiers)` (`:69`) → `GET /api/events/:id/prelaunch-forecast?simulatedPrice=` (only the price is simulated from the UI). **Fallback** when that fails: `POST /api/ml/demand-forecast` with **hard-coded** inputs (cricket, Lahore, HIGH marketing, capacity 27 000) — not the selected event's data.
- `handlePriceChange` (`:120`), `handleSavePrices` (`:127`) → `PUT /api/events/:id/pricing`, `handlePublishEvent` (`:152`) → `POST /api/events/:id/publish` (saves prices; does not publish — see [API](api-events.md)).

### `StaffEvents()` — `/staff/events` (GATE_STAFF, ORGANIZER, SUPER_ADMIN) — `StaffEvents.jsx:18`
`GET /api/staff/my-events` → upcoming/past assigned events with links to `/scanner?eventId=`. `startOfToday` helper.

### `GateScanner()` — `/scanner` — `GateScanner.jsx:117`
See [gate check-in module](../02-modules/gate-checkin.md). Key functions: `EventPicker` (`:84`, `GET /api/checkin/events`), gate choice persisted in `localStorage['tl-gate-<eventId>']` (`readGate/writeGate :22-29`, `chooseGate :172`); `revoke()` (wipe offline data on `403` or `staff:access-revoked`); `refreshPack()` (`GET /api/checkin/events/:id/pack` → `savePack`, cached copy when offline; every 3 min); `loadStats()` (stats + recent); `syncQueue()` (uploads queued offline scans in batches of 200 to `POST /api/checkin/sync`; every 30 s and on reconnect); online/offline listeners; 2-hour offline lock check; Socket.IO `join_event_room` + `checkin:stats`; `show(verdict)` with `feedback(result)` (`:45`, vibration + Web Audio tones) and `Verdict` overlay (`:68`); `decideOffline(code)` (local `evaluateOffline` + enqueue); <a id="web-gatescanner-check"></a>`check(raw)` — online `POST /api/checkin/scan` (6 s timeout), marks GREEN admissions locally, network failure → offline decision, 403 → revoke; `submitManual` for typed codes; `QrCamera` for camera scanning.

---

## Analytics (organizer & admin)

### `PurchaseIntentAnalytics()` — `/admin/purchase-intent`, `/analytics/intent[/:id]` — `PurchaseIntentAnalytics.jsx:35`
`fetchEvents` (`:56`) → `GET /api/events?limit=20` (**public published events — not filtered to the organizer's own**; choosing someone else's event yields a 403 from the analytics endpoint); `fetchAnalytics(eventId)` (`:72`) → `GET /api/analytics/intent/:eventId`; `handleSelectEvent`; `handleSendReminder(user)` (`:106`) → `POST …/send-reminder`; `handleBatchReminder(audience)` (`:133`) → `POST …/batch-reminder`. Helpers `levelTone`, `stageLabel`, `actionLabel`, `reminderButton`.

### `AbandonedIntentDashboard()` — `/admin/abandoned-intents` — `AbandonedIntentDashboard.jsx:58`
`fetchEvents` (`GET /api/events?limit=50`, same public-list caveat), `fetchDashboardData` (`:97`) → `GET /api/analytics/abandoned?eventId&minScore&reason`; `setFilter` (`:124`); `handleSendReminder(item)` (`:133`) → `POST /api/analytics/abandoned/send-reminder`; `handleBatchSendReminders` (`:162`, confirm) → `POST …/batch-reminders`. `Journey` (`:37`) visualises the funnel steps; `reasonOf`, `intentOf`.

### `BehaviorProfile()` — `/admin/behavior-profile` (SUPER_ADMIN) — `BehaviorProfile.jsx:87`
`fetchProfile` (`:99`) → `GET /api/behavior/profile` — the **signed-in admin's own** profile (the per-user endpoint is not used). `handleSimulate` (`:115`) → `trackClientBehavior(selectedAction)` to add a fake event, then refetch. Scores shown come from the fallback heuristics (see [behaviour service](api-analytics-ml.md#api-behavior-profile)). `ScoreCard`, `actionInfo`, `formatTimeAgo`, filter tabs.

---

## Super Admin

### `SuperAdminDashboard()` — `/admin/dashboard` — `SuperAdminDashboard.jsx:87`
- `getJson(path)` (`:141`) wraps `fetch(API_URL + path)` with the token. `fetchMetrics` (`:147`) → `/api/admin/metrics`; `fetchOverview` (`:160`) → transactions (300) and events (100) for charts.
- Tabs (`openTab :257`, `runSearch :263`): `fetchTabData` (`:183`) → `/api/admin/users|events|transactions|blockchain-logs|fraud-alerts|gate-scans|audit-logs?…`; `fetchTabStats` (`:232`) uses `countOf(path)` (`:224`, reads `total` with `limit=1`) — e.g. "high-risk" uses `minScore=75`, which the API ignores, so it equals the total.
- `handleUpdateStatusConfirm` (`:269`) → `PUT /api/admin/users/:id/status {status, reason}`; `deleteEvent` (`:90`) → `DELETE /api/events/:id`.
- Embeds `StaffManager` (admin mode). Helpers `shortDate`, `shortTime`, `Loading`, `Table`, chart memos (`dateOf`, `pick`).

### `AdminCompanies()` — `/admin/companies` — `AdminCompanies.jsx:26`
`loadCompanies` (`:40`) → `GET /api/companies/admin/all[?status=]`; `handleApprove` (`:69`), `handleSuspend` (`:97`, confirm), `submitRejection` (`:125`, modal with reason) → `PATCH /api/companies/admin/:id/status`.

### `AdminEventApprovals()` — `/admin/event-approvals` — `AdminEventApprovals.jsx:114`
`load` (`:122`) → `GET /api/admin/event-reviews?status=<tab>`; `ReviewCard` (`:19`) with `decide(decision)` (`:27`) → `POST /api/admin/event-reviews/:id {decision, comment}` (reject needs a comment; confirm dialog). `pkr` helper.

### `AdminFraudWatchlist()` — `/admin/fraud-watchlist` — `AdminFraudWatchlist.jsx:30`
`fetchWatchlist` (`:41`) → `GET /api/ml/fraud-watchlist` (only `AI_BOT_EVALUATION` rows); `handleToggleFreezeUser(user, isFrozen)` (`:61`) → `POST /api/ml/freeze-user/:id` or `/unfreeze-user/:id`. `riskOf` helper.

---

## Small helpers and inline callbacks
| Item | Where | Behaviour |
|---|---|---|
| `setField(k)` | `Checkout.jsx:250` | Returns an input handler that updates `form[k]` and clears that field's error. |
| `checkCompanyStatus()` | `CreateEvent.jsx:164` | Effect body: `GET /api/companies/my-company` → `company` state (loading flag around it). |
| `handleRemoveTier(i)` / `handleTierChange(i, field, value)` | `CreateEvent.jsx:227`, `:232` | Remove a tier (never the last one) / update one field (numbers for price & quantity) and clear its error. |
| `tileAt(x, y)`, `start(tile)`, `onMove`, `onUp`, `onLeave` | `Dashboard.jsx:57-92` (`useCollageClips`) | Hit-test the collage tile under the pointer (ignored where the hero film covers it), play that tile's clip and pause the others; mouse uses hover, touch uses tap; leaving stops playback. |
| `onChange(e)` | `Dashboard.jsx:123` | Media-query listener switching portrait/landscape hero film. |
| `save()` | `Dashboard.jsx:163`, `ResaleMarketplace.jsx:180` | On `pagehide`, store the scroll position in sessionStorage for restoration after reload. |
| `reducedMotion()`, `formatPkr(v)` | `EventDetails.jsx:34-35` | Prefers-reduced-motion check; "PKR 1,500" formatting. |
| `score(e)` | `EventDetails.jsx:71` (`pickRelated`) | +2 same type, +1 same city. |
| `Row({label, id, children})` | `EventDetails.jsx:84` | Labelled detail section with a generated heading id. |
| `onBack(e)` | `EventDetails.jsx:124` | If the page was opened from Explore (with `exploreDepth`), steps back through history to restore the list instead of reloading it. |
| `onToggle(self)` (ScrollTrigger) | `EventDetails.jsx:236`, `Events.jsx:224` | Sets `header.dataset.atFooter` so the header logo steps aside over the footer. |
| `onComplete()` | `EventDetails.jsx:260` | After the entry animation, `ScrollTrigger.refresh()` to re-measure scenes. |
| `clearFilters()` | `Events.jsx:99` | Empties the search box and all URL filters. |
| `ago(t)` | `GateScanner.jsx:36` | "just now" / "N min ago" / "H h M min ago" for pack age. |
| `goOnline()` / `goOffline()` | `GateScanner.jsx:249`, `:255` | Browser `online`/`offline` events: on reconnect sync queue, refresh pack and stats. |
| `manualForm(dark)` | `GateScanner.jsx:366` | Renders the manual-code form (light or camera-overlay variant). |
| `reader.onload` | `Profile.jsx:184` | Stores the chosen avatar as a data URL in state and `localStorage.tl_avatar`. |
| `dash(v)`, `refreshAll()`, `searchBox(placeholder)`, `pagerProps(data)`, `onPage(p)` | `SuperAdminDashboard.jsx:343-365` | "…" while metrics load; reload metrics + tab data + stats; search form for a tab; pagination props for `Pager`. |
| `warn(e)` | `VenueEditor.jsx:174` | `beforeunload` handler while there are unsaved changes. |
| `apply()` | `VenueEditor.jsx:288` (`replaceLayout`) | Applies the new layout (undoable), clears selection/tool and closes the sources panel. |
| `onConfirm` (publish) | `VenueEditor.jsx:492` | Save draft if dirty → `POST /publish` → refresh editor payload → continue to Review & submit in setup mode. |
| `discard()` + `onConfirm` | `VenueEditor.jsx:519`, `:525` | Confirm, then `DELETE /draft` and reload the editor. |
| `addTier({name, price})` | `VenueEditor.jsx:537` | `POST /venues/event/:id/tiers` and append the tier to the payload. |
| `shift(shape)` (duplicate) | `VenueEditor.jsx:867` | Offsets a duplicated section (arcs rotate past the original; rects/polygons move 30 units). |
| `onConfirm` (remove section) | `VenueEditor.jsx:877` | Removes the selected section (undoable until publish; warns when it holds protected seats). |
| `formatClock(ms)` | `VerifyOtp.jsx:9` | mm:ss countdown text. |
