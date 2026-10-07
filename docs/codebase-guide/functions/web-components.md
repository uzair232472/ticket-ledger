# Function catalogue — web components (`apps/web/src/components/`)

[← Function catalogue index](README.md) · Pages that use them: [web pages](web-pages.md) · [Shared code](../08-shared-code.md)

Each entry gives the component's job, its props, its state/effects (inline callbacks are listed under the component), the API or browser services it touches, and who renders it. CSS files beside the components are styling only and are listed in the [file inventory](../04-file-inventory.md).

---

## Root-level components

<a id="web-protectedroute"></a>
### `ProtectedRoute({children, allowedRoles, requireApprovedCompany = false})` — `ProtectedRoute.jsx:11`
Route guard used in `App.jsx`. While `useAuth().loading` → spinner; not signed in → `<Navigate to="/login" state={{from: pathname}}>`; role not in `allowedRoles` → an inline "Access Denied (403)" panel (no redirect); `requireApprovedCompany` and organizer whose `companyStatus !== 'APPROVED'` → `<Navigate to="/company">`; else renders children. **UI only** — the API enforces the same rules (comment `:6`).

<a id="web-holdbar"></a>
### `HoldBar()` — `HoldBar.jsx:14` (rendered once in `App`)
Site-wide reservation countdown. `load()` (`:21`) → `GET /venues/holds/mine` (server clock offset kept). Effects: reload on path change (`:34`); on window `tl:holds-changed`, `focus` and every **30 s** (`:38`); 1 s ticker while a hold exists (`:53`); when the first hold hits 0 drop it and reload (`:63`). Hidden when nothing is held or on that event's own seat page. `clock(seconds)` (`:7`) formats mm:ss. Links back to `/events/:id/seats`.

### `NotificationBell()` — `NotificationBell.jsx:61` — **unused**
Imported by `App.jsx` but never rendered (repository search for `<NotificationBell`). It is the **only** client code listening to the Socket.IO `notification` / `notification_<userId>` events (`:106-107`), so real-time notification pushes currently reach no visible UI; the header polls instead (`HeaderAccount`). Contains `fetchNotifications` (`GET /notifications?limit=6`), `handleMarkAsRead`, `handleMarkAllRead`, `handleNotificationClick`, an outside-click effect, `getNotificationIcon(type)` and `formatTimeAgo(date)`.

<a id="web-staffmanager"></a>
### `StaffManager({companies?, isAdmin?…})` — `StaffManager.jsx:18`
Gate-staff management panel embedded in `OrganizerDashboard` and `SuperAdminDashboard`.
- `request(path, options)` (`:37`, `useCallback`): `fetch(API_URL/api/staff + path)` with the Bearer token; throws with the API message on failure.
- Load callback (`:52`) + effect (`:71`): `GET /staff/events` and `GET /staff` (with `?companyId=` for admins).
- `revokeEvent(staff, event)` (`:76`): confirm dialog → `DELETE /staff/:id/events/:eventId`.
- `run(busyId, fn, okText)` (`:88`): busy flag, call, reload, success/error dialog.
- `handleInvite(e)` (`:103`): validates the email (`validateEmail`) and event → `POST /staff/invites`.
- Inline buttons: deactivate/reactivate (`PATCH /staff/:id/deactivate|reactivate`), resend/cancel invite (`POST /staff/invites/:id/resend`, `DELETE /staff/invites/:id`).
- Helpers `Badge` (`:9`), `formatDate` (`:11`), `initials(name)` (`:118`).

---

## `account/` — customer account pages (wallet, NFT tickets, orders)
| Component / function | Line | Behaviour |
|---|---|---|
| `AccountShell({…, contentKey, children})` | `AccountShell.jsx:38` | Layout for account pages: `HomeHeader`, pinned intro photo, stacked sections, `SiteFooter`. Effects: `initAccountMotion` on mount (layout effect `:45`), refresh scroll scenes when `contentKey` changes (`:51`, `:55`). |
| `AccountPortal({children})`, `hideBroken(e)` | `:14`, `:19` | Portal target so page dialogs render above stacked sections; hides broken images. |
| `AccountSection({…})` | `:129` | One stacked content section. |
| `ChangePasswordCard()` | `ChangePasswordCard.jsx:39` | Form with current/new/confirm; client rules (`test` regex helpers `:7-9`) mirror the API; `submit(e)` (`:51`) → `PUT /users/password`; success/error dialog. `PasswordInput` (`:13`) is a show/hide field. Rendered by `Profile`. |
| `NftTicketCard({ticket, onResell…})` | `NftTicketCard.jsx:14` | On-chain ticket card with price and the 110 % cap, "More" menu (outside-click/Escape effect `:21`), `copyTx()` (`:33`) copies the tx hash (2 s "copied" state). `pkr(n)` formatter (`:8`). Rendered by `MyNFTTickets`. |
| `WalletPass({ticket, …})`, `MoreMenu`, `seatParts(seat)` | `WalletPass.jsx:68`, `:17`, `:10` | Gate pass card: event details + QR stub (`ticket.qr.qrCodeDataUrl`, manual code), actions (download PDF, transfer, more: resale, history, gate check, signed data). GA tickets show the zone without row/seat. Rendered by `DigitalWallet`. |
| `initAccountMotion(root)`, `refreshAccountMotion()` | `accountMotion.js:17`, `:117` | GSAP `matchMedia` scroll scenes (sticky intro, heading reveals, header logo tone switching); returns the instance to `.revert()` on unmount. |

## `auth/AuthShell.jsx`
`AuthShell({title, subtitle, children, footer})` (`:64`) two-panel auth layout with `TicketArt` SVG (`:8`); `Alert({tone, children})` (`:101`); `Field({label, hint, icon, error, type, …})` (`:113`, password show/hide toggle, generated input id); `SubmitButton({loading, loadingText, disabled})` (`:138`); `OtpInput({value, onChange, disabled})` (`:157`) — six boxes; `setDigits` (`:161`), `handleChange` (`:163`, supports pasting the whole code), `handleKeyDown` (`:178`, backspace moves left). Used by all auth pages.

## `basic/BasicShell.jsx`
`BasicShell({…})` (`:12`) plain layout (header, paper background, footer) for Profile and Notifications; effect (`:22`) toggles the header logo when the dark footer reaches it (scroll/resize listener).

## `booking/`
| Item | Line | Behaviour |
|---|---|---|
| `BookingShell({children})` | `BookingShell.jsx:33` | Frame for seat selection/checkout/confirmation. |
| `BookingSteps({current})` | `:16` | Seats → Checkout → Confirmation indicator. |
| `OrderConfirmedModal({order, receipt, onClose})` | `OrderConfirmedModal.jsx:23` | "You're going!" dialog after a successful order: memo (`:27`) groups seats per section (`seatLabel :11`, `unique :17`); effect (`:38`) focuses, locks scroll, Escape closes. Rendered by `Checkout`. |

## `brand/`
`BrandLogo({variant})` (`BrandLogo.jsx:12`) inline SVG mark (`markPaths.js` path data) + "Ticket Ledger" text; colours from CSS variables. Used by `HomeHeader`, `SiteFooter`.

## `dash/` — consoles (organizer, admin, gate staff)
| Item | Line | Behaviour |
|---|---|---|
| <a id="web-dashshell"></a>`DashShell({children})` | `DashShell.jsx:61` | Console layout: header, role nav from `CONSOLES` (`:14` — SUPER_ADMIN, ORGANIZER, GATE_STAFF link lists), aliases (`:51`), studio theme for `STUDIO_ROUTES` (`:54`). Effects: scroll restoration/logo tone (`:71`, `:76`). Wraps every console route in `App.jsx`. |
| `DashHead`, `Segmented`, `DashCard`, `Figure`, `Chip`, `Kpi`, `Tile`, `EventTile`, `EventThumb`, `TicketCard`, `Status`, `Notice`, `DashState` | `:127-344` | Presentational building blocks; `statusTone(status)` (`:326`) maps statuses to colours; `pretty` (`:327`) humanises enums; `formatPlace` (`:254`), `hideBroken` (`:257`). |
| `SetupStepper({current, onSelect, isSelectable})` + `SETUP_STEPS` | `SetupStepper.jsx:18` | Five-step event setup indicator (details → … → venue editor → review & submit). Used by `CreateEvent`, `VenueEditor`, `EventSubmit`. |
| `Studio.jsx` exports (`StudioHead`, `StudioSelect`, `StatCard`, `Panel`, `Badge`, `initials`, `Avatar`, `Pager`, `ScoreBar`, `ApStat`, `UnderlineTabs`, `RecordCard`, `TabStats`, `Directory`) | `:10-212` | Static UI blocks for studio pages (dashboards, analytics, fraud watchlist). |
| `charts.jsx`: `ColumnChart`, `LineChart`, `Legend`, `SplitBar`, `FillGauge`, `ArcGauge`, `Meter`, `Ring`, `byDay`, `formatPkr`, `compactPkr`, `SERIES`, `NEUTRAL` | `:13-341` | Dependency-free SVG charts with hover tooltips and text alternatives. Helpers: `compact` (`:13`), `niceScale` (`:24`, rounds axis max to 1/2/2.5/5×10ⁿ), `useWidth` (`:34`, ResizeObserver-style width via layout effect), `labelEvery` (`:48`), `smoothPath` (`:108`), `polar`/`arcPath` (`:253-257`), `byDay(rows, …)` (`:319`, buckets by date). Used by `OrganizerDashboard`, `SuperAdminDashboard`, analytics pages. |

## `event-detail/`
| Item | Line | Behaviour |
|---|---|---|
| `ContactOrganizer({email, eventName})` | `ContactOrganizer.jsx:8` | Menu: `mailto:` with the event name as subject, or `copy()` (`:28`) to clipboard; outside-click/Escape effect (`:13`). |
| `EventGallery({event})` | `EventGallery.jsx:62` | Wide photo + infinite marquee strip: organizer gallery in saved order, else event image + category photos (`buildCards :37`, `fill :27`, `photo :13`, `sized*` helpers). Effect (`:77`) runs a requestAnimationFrame marquee with pointer drag (`onDown/onMove/onUp`), pauses on reduced motion/visibility. |

## `event-form/` — organizer event form inputs
| Item | Line | Behaviour |
|---|---|---|
| `ImageField({kind, value, onChange})`, `emptyImageValue()`, `imageValueSrc(value)`, `CARD_COPY` | `ImageField.jsx:26`, `:17`, `:20`, `:5` | Single-image placement: `onSelect` (`:41`) → `checkImageFile`; wrong ratio/too big → `ImageCropper`; `acceptFile` (`:37`) stores `{file, previewUrl, action:'replace'}`; remove/undo; effect (`:35`) revokes preview URLs. |
| `GalleryField({value, onChange})`, `galleryItemsFromSaved(images)` | `GalleryField.jsx:21`, `:12` | Ordered gallery (≤12): multi-select with per-file cropping queue (`onSelect :43`), drag-and-drop/arrow reordering (`move :64`, `onDrop :72`), remove; effects revoke unused object URLs (`:34`, `:39`). Produces the list `CreateEvent` turns into `galleryOrder`. |
| `ImageCropper({file, spec, onApply, onCancel})` | `ImageCropper.jsx:18` | Drag/arrow-key positioning, zoom slider; `apply()` (`:97`) draws to a canvas and re-encodes (`toBlob :9`), capping width at 1.5× recommended and staying under `maxBytes` (PNG → JPEG if needed). Escape closes (`:46`). |
| `LocationPicker({value, onChange})`, `parseMapsLink(text)`, `googleMapsUrl` | `LocationPicker.jsx:41`, `:14` | Leaflet map (via `EventMap`) to click/drag a pin; `pick(lat,lng)` (`:60`) then **reverse-geocodes with OpenStreetMap Nominatim** (`fetch …/reverse`, `:66`); `search(q)` (`:125`) uses Nominatim search limited to Pakistan (`:135`); `useLink` (`:155`) parses pasted Google Maps URLs (`@lat,lng`, `?q=`, `!3d…!4d…`, `ll=`). External service calls go **directly from the browser**. |
| `PreviewFrame({spec, src, dimmed, shade})` | `PreviewFrame.jsx:11` | Scaled replica of the display container (same ratio/object-position). |

## `events/`
`EventTile({event, …})` (`EventTile.jsx:31`) Explore tile with cursor-following colour reveal and tilt written to CSS variables (`setVars :41`, pointer handlers `:47-73`); helpers `formatDate`, `formatPlace`, `priceLabel` ("From PKR …"), `finePointer`, `reducedMotion`, `fallback` image. `PixelLoader()` (`PixelLoader.jsx:15`) decorative page-transition grid (random offsets memo `:20`, counter effect `:26`).

## `home/` — homepage, header and footer
| Item | Line | Behaviour |
|---|---|---|
| <a id="web-homeheader"></a>`HomeHeader({tone, minimal, pageRef, onCategories})` | `HomeHeader.jsx:93` | Fixed header with logo, `HeaderAccount` icons and an animated full-screen menu. `useMenuGroups(onCategories)` (`:17`) builds role-specific menu groups mirroring route permissions (Discover, My Tickets, Organize / Gate / Admin, Account). Effects: scroll-state (`:110`); GSAP timeline (`:141`); open/close locks body scroll, makes the page `inert`, focuses the menu and fetches the unread count (`GET /notifications?limit=1`, `:185`); Escape closes (`:222`); cleanup on unmount (`:208`). `onNavigate` (`:247`), `onLogout` (`:253` → `useAuth().logout()` then home). `prefersReducedMotion` (`:11`). Rendered by almost every page. |
| `HeaderAccount({menuOpen, onOpen, onLogout})` | `HeaderAccount.jsx:23` | Cart icon (uses `useCartHolds`: count + countdown, links to `/checkout`), wishlist count (`useWishlist`), notifications popover (`loadNotifications` → `GET /notifications?limit=3`, on load, each page change and **every 60 s**), account popover. `toggle(name)` (`:78`); outside-click/Escape effect (`:61`); `timeAgo` (`:10`). |
| `HeaderIcons.jsx` (`TicketCartIcon`, `TicketBellIcon`, `TicketUserIcon`, `MenuTicketIcon`) | `:7-74` | SVG icons. |
| `SiteFooter({onCategories})`, `organizerAction(user)` | `SiteFooter.jsx:26`, `:7` | Footer links; organizer CTA depends on role/company status. |
| `EventCard({event, …})` | `EventCard.jsx:17` | Homepage card (price, few-seats-left hint, wishlist heart). |
| `CategoryCard({category, count})` | `CategoryCard.jsx:8` | Category panel. |
| `EventMap({events, …})`, `hasPin(e)`, `CITY_COORDS` | `EventMap.jsx:89`, `:10`, `:13` | Leaflet map of Pakistan: exact pins or city centres fanned out (`anchorFor :51`); hover card built with DOM `textContent` (`buildCard :59`, safe from markup injection); click/Enter navigates to the event; wheel zoom only with Ctrl (`onWheel :132`). Also used inside `LocationPicker`. |
| `homeData.js` | — | Static media URLs (hero video in `public/web visuals/`, Unsplash images), `CATEGORIES`, `ALL_CATEGORIES`, `categoryName(type)`. |
| `homeMotion.js` (`initHomeMotion`, `staggerTo`, `coverScene`, `jumpToProgress`, `refreshScrollScenes`, `TICKET_HOLE_RADIUS`) | `:27-367` | GSAP ScrollTrigger scenes for the homepage (hero, collage trail following the pointer `initTrail :49`, slide-over sections, closing ticket "punch-hole" zoom `holeCoverScale :15`). Pure animation. |

## `motion/` — global behaviours
| Item | Line | Behaviour |
|---|---|---|
| `SmoothScroll()` | `SmoothScroll.jsx:17` | Creates a Lenis instance (effect `:18`), drives GSAP ScrollTrigger, exposes `window.__lenis`, pauses when `body` is scroll-locked, disabled for reduced motion and touch. |
| `SplashScreen()` | `SplashScreen.jsx:19` | First-visit intro animation; shown once per browser session (`sessionStorage.tl_splash_seen`; `?splash=1` forces it); replayable via window event `tl:replay-splash`; Escape skips. |
| `AwayTitle()` | `AwayTitle.jsx:10` | After 5 s on another tab changes `document.title` to a nudge; restores it on return (`visibilitychange`). |
| `stackSections(sections, opts)` | `stackSections.js:21` | Sticky "slide-over" sections with scrubbed timelines; returns a cleanup. Used by account and resale motion. |

## `resale/`
`resaleContent.js` — copy and constants that mirror API rules (`RESALE_CAP_PERCENT = 110`, steps, FAQs, cities). `initResaleMotion(root)` (`resaleMotion.js:17`) — scroll scenes for the resale page (listings and dialogs are never transformed).

## `scanner/`
<a id="web-qrcamera"></a>`QrCamera({onDecode, paused, facing})` (`QrCamera.jsx:11`) — effect (`:24`): requires a **secure context** (HTTPS or localhost) and `getUserMedia`; opens the rear camera (1280×720 ideal); uses the browser `BarcodeDetector` for `qr_code` when available, otherwise **jsQR** on a downscaled canvas (≤640 px wide); `emit(text)` (`:86`) ignores the same code for 2.5 s; `loop()` (`:94`) runs per animation frame unless `paused`; friendly errors for blocked/missing/busy camera; `toggleTorch()` (`:133`) when the track supports torch. Cleanup stops all tracks. Used by `GateScanner`.

## `ui/`
| Item | Line | Behaviour |
|---|---|---|
| <a id="web-dialogprovider"></a>`DialogProvider({children})`, `useDialog()` | `DialogProvider.jsx:25`, `:107` | Promise-based replacements for `alert()`/`confirm()`: `dialog.alert({tone, title, message})` resolves when closed; `dialog.confirm({…confirmLabel, cancelLabel})` resolves `true/false`. `themeFor()` (`:12`) picks the theme from the page. `Dialog` (`:53`) traps focus, Escape cancels, destructive confirms focus Cancel first. Used by ~20 pages/components. |
| `SelectEnhancer()` | `SelectEnhancer.jsx:36` | Global: intercepts opening of any native `<select>` (mouse, keyboard, tap) and shows a themed list; choosing sets the value and dispatches native `input`/`change` events so page logic is unchanged; `data-native` opts out. `readOptions` (`:16`) keeps optgroups; positioning layout effect (`:117`); keyboard navigation (`:169`). |

## `venue/` — attendee seat map (shared with the editor preview)
| Item | Line | Behaviour |
|---|---|---|
| <a id="web-venuebooking"></a>`VenueBooking({adapter, isAuthenticated, userId, preview, eventId, onLoaded})` | `VenueBooking.jsx:59` | See detailed entry below. |
| `SeatLegend`, `LegendSeat` | `:42`, `:21` | Legend of seat states (colour **and** symbol). |
| `liveAdapter(eventId)` | `adapters.js:8` | `{live:true, load, hold, release}` → `GET /venues/event/:id`, `POST …/holds`, `POST …/holds/release`; errors re-thrown with the API message (`unwrap :9`). Created by `SeatMap`. |
| `previewAdapter({layout, tiers, event})` | `adapters.js:28` | Same interface over the **unsaved** draft: in-memory holds (`held` Map), snapshot built from `layoutInventory`, 180 ms fake latency (`wait :71`), enforces the 10-ticket limit and GA availability; nothing is sent to the server. Created by `VenueEditor`'s attendee preview. |
| `VenueMap(props, ref)` | `VenueMap.jsx:146` | SVG plan: sections (`shapePath`), feature (`VenueFeature`), seats/tables of the focused section with level of detail (`lodFor :9`, seat facing `seatAngles :19`), labels fitted to space (`labelSpace :261`, `fitText :268`); imperative handle `fitAll`, `fitSection`, `svg` (`:212-223`); click/hover/focus delegation (`handleClick :233`, `hoverFrom :244`, `focusFrom :251`). Sub-components `Chair`, `SeatSymbol`, `SectionDetail`. |
| `useCamera(…)` | `useCamera.js:17` | Pan/zoom by writing the SVG `viewBox` directly (no React re-render): drag, pinch, Ctrl/⌘+wheel; animated `fit` with GSAP; `wasDrag()` lets clicks ignore pan ends; `onScale` reports pixels-per-unit for LOD. |
| `VenueFeature({feature})`, `VenueDefs()` | `VenueFeature.jsx:7`, `:103` | Pitch/ground/court/ring/stage drawings; shared SVG defs. |
| `BookingSummary.jsx`: `summaryLines(mine, …)`, `groupByTier`, `lineTitle`, `lineDetail`, `formatClock`, `HoldTimer`, `MyTicketsButton`, `MyTicketsPanel` (default) | `:6-79` | Groups holds into lines (assigned seats, GA quantities, whole tables), groups by tier (priciest first), countdown, "Get tickets" panel (dropdown on desktop, bottom sheet on phones; Escape effect `:86`). Also imported by `Checkout`. |
| `SeatPopover({info, onSelect, onRemove, onClose})` | `SeatPopover.jsx:12` | Seat/table details; buttons depend on `info.state` (`available` → Select, `mine` → Remove, `checkout` → Close). Focus trap and Escape (`:17`, `:22`). |
| `venueTheme.js`: `tierPalette(tiers)`, `TIER_COLORS`, `SEAT_STATES`, `formatPkr`, `generated(section)` (cached `generateSection` per section object), `sectionBox`, `layoutBox`, `geometryBox`, `reducedMotion` | `:10-80` | Shared colours and geometry helpers for map, booking and editor. |
| `editor/EditorOverlay({section, …})` | `EditorOverlay.jsx:8` | Drag handles inside the SVG: move, resize rect corners, arc radii/angles, polygon vertices (add on edge "+", double-click removes), rotation knob; window-level pointer listeners (`drag :11`); each drag = one undo step. Uses `moveShape`, `rotate`, `polar`. |
| `editor/SectionInspector({section, tiers, onChange, …})` | `SectionInspector.jsx:62` | Form for the selected section: name, tier, booking type, shape fields (`ShapeFields :26`), rows/seats/aisles/numbering, tables, GA capacity; "fit seats" via `fitRows`/`maxRows`; live stats from `generateSection` (`Stat :7`, `Group :14`). |
| `editor/fields.jsx`: `Field`, `NumberField` (commits only valid numbers, tolerates empty input), `TextField`, `SelectField`, `Segmented`, `ConfirmDialog` (in-page confirm with Escape) | `:5-88` | Inputs for the editor. |
| `editor/MiniPlan({layout})` | `MiniPlan.jsx:7` | Static thumbnail (template cards, saved layouts). |

### `VenueBooking` in detail
- **State:** loaded `data` (= `getAvailability` payload), focused section, `pending` keys (in-flight), notices/announcements (screen-reader live text), popover, panel open flags, `now` ticker, server clock `offset`.
- `load()` (`:85`): `adapter.load()`; computes clock offset; **detects holds that lapsed** (in the previous `mine` but not the new one, past expiry) and warns; dispatches `tl:holds-changed` so `HoldBar`/`useCartHolds` refresh; stores data.
- **Live updates** (effect `:117`, live adapter only): Socket.IO connection; `seat:status_change` and `seat:status_batch` for this event **patch** the `unavailable` map immediately (ignoring changes made by this user) and schedule a debounced re-fetch after 700 ms (`scheduleRefetch :111`); `venue:published` reloads; a reconnect reloads.
- **Countdown:** earliest `lockedUntil` among `mine` (`:150-161`); at 0 → reload.
- **Derived data:** `sectionInfo(s)` (`:180`, availability/price/sold-out per section — whole tables count tables whose chairs are all free), `seatStates`/`tableStates` for the focused section (`:213`, `:223`), text descriptions for accessibility.
- `requireLogin(pendingHold)` (`:248`): signed-out → stores the intended hold in `sessionStorage['tl-pending-hold']` (30-minute TTL) and navigates to `/login`; on return the resume effect (`:379`) re-opens the section and places the hold.
- `run(busyKey, fn, okText)` (`:262`): marks pending, calls the adapter, reloads, announces success/error.
- `toggleSeat(key)` / `toggleTable(key)` (`:280`, `:294`): ignore pending/unavailable seats (announce why); otherwise open the `SeatPopover` — **nothing is reserved until "Select"**.
- `selectFromPop()` (`:357`): login check, client-side 10-ticket check, `adapter.hold({key}|{tableKey})`. `removeFromPop()` (`:366`): `adapter.release(keys)`. `setGa(section, qty)` (`:372`): `adapter.hold({sectionId, quantity})`.
- `openSection` / `backToVenue` (`:400`, `:414`) animate the camera; `onMapKeyDown` (`:427`) gives arrow-key seat navigation following row geometry, Enter selects, Escape returns.
- `getTickets()` (`:475`): re-loads from the server and refuses to continue if no holds remain, some selected seats are no longer held, any hold is about to lapse (≤ 5 s), or more than 10 are held; otherwise navigates to `/events/:id/checkout`.

---

## Small helpers and inline callbacks (by component)

| Component / file | Items (line) | Behaviour |
|---|---|---|
| `NotificationBell.jsx` | `handleNewNotification` (`:95`), `handleClickOutside` (`:116`) | Prepend the pushed notification (keep 6), +1 unread, 5-second toast; close the dropdown on outside mousedown. |
| `accountMotion.js` | `setTone` (`:24`), `onToggle` (`:42`, `:48`), `end` (`:74`) | Track which light sections are under the header to switch the logo tone; mark header at footer; scroll length of the pinned intro track. |
| `BasicShell.jsx`, `DashShell.jsx` | `update` (`:26`, `:80`) | Scroll/resize listener: `header.dataset.atFooter = footer top ≤ 80 px`. |
| `charts.jsx` | `trim` (`:15`), `clamp` (`:110`), `wave` (`:234`) | Number trimming for compact labels ("1.2M"); keep spline control points inside the plot; SVG wave path for `FillGauge`. |
| `EventGallery.jsx` | `photoId` (`:19`), `sizedWide` (`:22`), `sizedCard` (`:24`), `wrap` (`:87`), `tick` (`:90`), `onToggle` (`:107`), `onUpdate` (`:110`), `renderList` (`:162`) | De-duplicate Unsplash photos by id; request 1800/1400 px Unsplash sizes; wrap marquee position; per-frame marquee step (paused off-screen or while dragging); visibility from ScrollTrigger; scroll velocity boosts speed; render one copy of the strip (second copy `aria-hidden`). |
| `GalleryField.jsx` | `newItem` (`:14`), `itemSrc` (`:15`) | Create a new-file item with an object-URL preview; image source for saved or new items. |
| `ImageCropper.jsx` | `clamp` (`:7`), `clampCenter` (`:59`), `onLoad` (`:62`), `onPointerDown`, `onPointerMove`, `onPointerUp` (`:70-80`), `onKeyDown` (`:83`), `onZoom` (`:90`) | Keep the crop window inside the image; read natural size and centre the crop; drag to move; arrow keys move (Shift ×4); zoom slider keeps the centre valid. |
| `LocationPicker.jsx` | `fix` (`:9`), `choose` (`:146`) | Round coordinates to 6 decimals (~10 cm); pick a search result (sets pin + address). |
| `PreviewFrame.jsx` | `sentence` (`:4`) | Turns a fallback label into a sentence ("The category artwork shown here" → "Category artwork"). |
| `EventTile.jsx` | `onPointerMove`, `onPointerEnter`, `onPointerLeave` (`:47-73`) | Fine-pointer only: write cursor position/tilt to CSS variables via rAF; reset on leave. |
| `EventMap.jsx` | `img.onerror` (`:65`), `showCard` (`:155`), `card.reposition` (`:168`), `hideCard` (`:186`) | Mark broken card images; show the hover card for a marker; keep it next to the marker on pan/zoom; hide it. |
| `HomeHeader.jsx` | `handleScroll` (`:112`) | rAF-throttled scroll state (header background after scrolling). |
| `homeData.js` | `unsplash(id, w, h)` (`:4`), `clip(name, crop)` (`:35`) | Build Unsplash URLs; reference a video in `public/web visuals/`. |
| `homeMotion.js` | `tick` (`:63`), `onLeave` (`:88`), `setTone` (`:120`), `onFocusIn` (`:134`), `onToggle` (`:142`, `:143`, `:152`, `:348`), `panelInset` (`:171`), `end` (`:191`, `:258`, `:310`), `start` (`:344`) | Pointer-trail animation frame; hide trail on leave; header tone switching; jump the scroll scene to a focused element (keyboard accessibility); category/footer/closing toggles; hero panel inset size; scroll lengths of pinned tracks; closing-scene start offset. |
| `SmoothScroll.jsx` | `easing` (`:22`), `prevent` (`:26`), `tick` (`:31`), `sync` (`:36`) | Exponential ease; keep native wheel inside own-scroll areas; drive Lenis from the GSAP ticker; pause Lenis while `body` is `overflow:hidden` (MutationObserver). |
| `SplashScreen.jsx` | `handleReplay` (`:41`), `onComplete` (`:77`), `onUpdate` (`:148`) | Replay on `tl:replay-splash`; finish (mark seen, unlock scroll); update the progress counter. |
| `stackSections.js` | `setStickTop` (`:25`), `onRefreshInit` (`:30`), `onRefresh` (`:31`) | Sticky offset per section height; measure unstuck layout during ScrollTrigger refresh. |
| `resaleMotion.js` | `setTone` (`:25`), `onFocusIn` (`:42`), `onToggle` (`:55`, `:63`), `end` (`:86`, `:127`), `onEnter` (`:151`) | Same patterns as `homeMotion` for the resale page; batch fade-in of cards. |
| `QrCamera.jsx` | `stop` (`:29`), `start` (`:35`) | Stop the frame loop and camera tracks; request the camera and start decoding (see main entry). |
| `SelectEnhancer.jsx` | `themeOf(el)` (`:9`), `onPointer` (`:65`), `onMouseDown` (`:68`), `onKeyDown` (`:76`), `onTouchStart` (`:86`), `onTouchEnd` (`:90`), `place` (`:119`) | Pick theme from ancestors; remember pointer type; intercept native select opening (mouse, Space/Enter/Alt+↓, tap without scroll); position the list under/above the select. |
| `BookingSummary.jsx` | `pad` (`:5`) | Two-digit padding for `formatClock`. |
| `SeatPopover.jsx` | `onKeyDown` (`:22`) | Escape closes; Tab cycles inside the popover. |
| `VenueBooking.jsx` | `priceOf(section)` (`:233`), `removeLine(line)` (`:467`) | Tier price of a section; remove a line from My tickets (GA → quantity 0, else release keys). |
| `VenueMap.jsx` | `centre(list)` (`:26`) | Average position of seats (row direction / front side for seat facing). |
| `adapters.js` | `view(s)` (`:33`), `room(n)` (`:46`) | Preview hold record; 10-ticket limit check. |
| `editor/EditorOverlay.jsx` | `up` (`:16`), `H` (`:27`), `corner` (`:48`, `:102`), `angleAt` (`:150`), `dist` (`:160`) | End a drag (remove window listeners, commit undo step); handle circle element; rotated rect corner positions (section and feature); angle of a point around the arc centre (snapped near the previous value); distance from centre for radius handles. |
| `editor/SectionInspector.jsx` | `set(patch, key)` (`:67`), `setRows(patch, key)` (`:68`) | Merge a change into the section (with an undo-coalescing key); same for `rows`. |
| `useCamera.js` | `size` (`:30`), `pxPerUnit` (`:34`), `fitScale` (`:35`), `clamp` (`:63`), `onUpdate` (`:83`), `zoomIn` / `zoomOut` (`:236-237`), `scale` (`:241`) | Container size; pixels per layout unit; scale that fits the content; keep the view inside content bounds; apply animated view; zoom ×1.6 / ÷1.6; current pixels-per-unit. |
