# Shared code reference

[← Start here](README.md) · Related: [file inventory](04-file-inventory.md) (reverse import graph) · [function catalogue](functions/README.md)

"Shared" = used by more than one module. For each item: what it provides, who uses it, how callers customise it, and what could break if you change it. Relationship kinds are labelled: **import** (static ES import), **call** (function actually invoked), **route** (registered as Express middleware/handler), **event** (DOM/window or Socket.IO subscription), **dynamic** (cannot be verified statically).

Importer counts come from a static parse of every `import` statement (see [coverage](12-coverage.md#method)).

## 1. Backend (API)

| Item | Provides | Used by (kind) | Customisation | Change impact |
|---|---|---|---|---|
| `config/prisma.js` default `prisma` | Single Prisma client + notification e-mail hook | 45 files (import) | — | Every DB call; the hook affects all notification e-mails |
| `middlewares/auth.js` `authenticateJWT` / `requireAuth` | JWT verification, user reload, block rules | 12 + 6 route files (route) | — | All protected endpoints; changing error `code`s breaks the web refresh/suspend interceptors |
| `requireRole(...roles)` | Role gate | 12 route files (route) | role list (array or args) | Access control everywhere |
| `optionalAuth` | Guest-or-user | 5 route files (route) | — | Public discovery, tracking, contact |
| `requireApprovedCompany` / `requireApprovedOrganizer` | Approved company gate + `req.company` | `eventRoutes`, `companyRoutes` (route) | — | Event creation |
| `middlewares/rateLimit.js` limiters | Per-IP limits | `authRoutes`, `userRoutes`, `contactRoutes` (route) | `AUTH_RATE_LIMIT_MAX` | Login/signup UX and tests |
| `utils/eventAccess.canManageEvent(user, event, {requireApproved})` | Owner-or-admin rule | event, review, seat, venue controllers (call) | `requireApproved` flag | Who can edit/view drafts, seating, submission |
| `services/accessService.getScopedEventIds` / `getOwnedCompanyId` | Role → event scope; owned company | check-in, gate, staff controllers (call) | — | Scanner permissions and staff management |
| `utils/storage.uploadFile(file, folder, {extension})` | Cloudinary or local upload | company, venue controllers, eventMediaService (call) | folder, extension | All uploads; URL format consumed by `resolveMediaUrl` on the web |
| `utils/imageInspect.inspectImage` | Real image type/size | eventMediaService, tests (call) | — | Image validation |
| `config/socket.getIO` | Socket.IO server | booking, seat, staff controllers; check-in, notification, venue services (call) | — | All realtime events |
| `config/redis.*SeatLock` | Redis/memory locks | seatController, bookingController (call) | TTL | Legacy seat flow only |
| `services/behaviorService` (`trackBehavior`, `attachSessionToUser`, `BEHAVIOR_ACTIONS`) | Telemetry | 9 controllers (call, fire-and-forget) | action, metadata | Analytics dashboards (action names are matched by string in analytics) |
| `services/notificationService.dispatchNotification` | Row + socket + mock push | adminService, intentAnalyticsService, notificationController (call) | sendEmail/sendPush flags | Reminders, admin alerts |
| `services/emailService` / `emailLayout` | Transport, templates | Prisma hook, otpService, staffController, contactController | `action` button, copy | All e-mails |
| `services/mlService` | ML HTTP client + fallbacks | booking, event, ml controllers; behavior/intent services (import) | parameters | Forecast/fraud results; fallbacks hide outages |
| `services/venueService.expireStaleHolds`, `FREE_SQL`, `HOLD_SECONDS` | Hold expiry and the free-seat rule | bookingController, seatController, venueController (call) | — | Seat availability correctness |
| `services/qrPassService.passFor` | Signed pass + manual code | ticketController, qrTicketService (call) | — | Wallet, PDF, gate verification compatibility |
| `config/auth.js` constants | TTLs, statuses, messages | auth middleware, controllers, token/otp services | env `JWT_SECRET` | Session lengths, lockouts, wording |
| `apps/venue-core` (`validateLayout`, `layoutInventory`, `generateSection`, templates, geometry) | Venue maths | venueService, venueController, scripts, seeds, web editor/map (import, **both runtimes**) | section settings | **Changing seat generation changes seat keys** → mismatches with existing `Seat.layoutKey` rows; publish would treat seats as new |

## 2. Frontend (web)

| Item | Provides | Used by | Customisation | Change impact |
|---|---|---|---|---|
| `context/AuthContext` `useAuth()` | `user`, `token`, auth actions | 39 files (import + call) | — | Every protected screen; route guards |
| `lib/session.js` | In-memory token, fetch/axios interceptors, `getHomeRoute`, `API_URL` | AuthContext, `utils/api`, some pages (import; interceptors **monkey-patch `window.fetch`** globally — dynamic) | — | Silent refresh and suspension handling for all requests |
| `utils/api.js` default `api` | axios client with Bearer + `x-session-id` | 25 files | per-call options | Base URL / headers for most calls |
| `trackClientBehavior` | Client telemetry | EventDetails, Events, SeatMap, BehaviorProfile | action, metadata | Behaviour data volume |
| `components/ui/DialogProvider` `useDialog()` | alert/confirm | 17 files | tone, labels | All confirmations |
| `context/WishlistContext` `useWishlist()` | Saved ids, toggle | 5 files | — | Hearts across the site |
| `hooks/useCartHolds` | Holds + countdown | HeaderAccount | — | Header cart |
| `ProtectedRoute` | UI guard | App.jsx routes | `allowedRoles`, `requireApprovedCompany` | Navigation access |
| Layout shells (`HomeHeader` 13 importers, `SiteFooter` 11, `AuthShell` 6, `AccountShell` 4, `BookingShell` 3, `BasicShell` 2, `DashShell` via App) | Page frames | pages | props (`tone`, `minimal`, `pageRef`) | Visual consistency |
| `utils/eventMedia.getEventVisual` | Banner/card image choice | 14 files | — | Images everywhere |
| `utils/eventTime.formatEventDate/Time` | Date/time display | 13 / 12 files | options | Dates (UTC calendar day, PKT time) |
| `components/venue/venueTheme` (`formatPkr`, `tierPalette`, `generated`) | Money format, tier colours, cached generation | 10 / 2 / 4 files | — | Prices and seat maps |
| `components/venue/VenueBooking` + `adapters` | Booking UI on live or preview data | SeatMap (live), VenueEditor (preview) | adapter object `{live, load, hold, release}` | Both attendee booking and organizer preview |
| `lib/validation` | Form rules | auth pages, StaffManager | — | Must stay in sync with API Zod schemas |
| `utils/eventImageSpecs` | Image specs & checks | event-form components | spec | Must stay in sync with `apps/api/src/config/eventMedia.js` |
| `components/dash/charts`, `Studio`, `DashShell` blocks | Console UI | dashboards, analytics pages | props | Console visuals |

## 3. Window and socket subscriptions (event relationships)

| Event | Emitted by | Subscribed by |
|---|---|---|
| `tl:holds-changed` (window) | `VenueBooking.load`, `Checkout.release/submit`, `useCartHolds` | `HoldBar`, `useCartHolds` |
| `tl:replay-splash` (window) | — (no emitter in source) | `SplashScreen` |
| Socket `seat:status_change` | `seatController`, `bookingController` | `VenueBooking`, `LegacySeatMap` |
| Socket `seat:status_batch` | `venueService.emitSeatChanges` | `VenueBooking` |
| Socket `venue:published` | `venueService.publishDraft` | `VenueBooking` |
| Socket `ticket:checked-in` | `checkinService` | `DigitalWallet` |
| Socket `checkin:stats` | `checkinService.broadcast` | `GateScanner`, `OrganizerDashboard` |
| Socket `staff:access-revoked` | `staffController.revokeEventAccess` | `GateScanner` |
| Socket `notification`, `notification_<id>` | `notificationService.dispatchNotification` | `NotificationBell` (**not rendered**) |

## 4. Duplicated logic to keep in sync

| Logic | Copies |
|---|---|
| Manual-code normalisation and pass checks | `qrPassService` + `checkinService.evaluate` (server) / `gateOffline.normaliseManualCode` + `evaluateOffline` (browser) |
| Image specs | `api/src/config/eventMedia.js` / `web/src/utils/eventImageSpecs.js` |
| Validation rules | `authController` Zod / `web/src/lib/validation.js` |
| Role → menu/console | `App.jsx` routes / `HomeHeader.useMenuGroups` / `DashShell.CONSOLES` / API role guards |
| Resale cap (110 %) | `resaleController` / `nftService` / `ticketController` / contract / `resaleContent.js` |
| Free-seat rule | `venueService.FREE_SQL` (SQL) / client availability from server only |
