# Module: Frontend shell — routing, layouts, global behaviours

[← Modules](README.md) · Functions: [web core](../functions/web-core.md) · [components](../functions/web-components.md) · [pages](../functions/web-pages.md)

## Overview
The web app is a single-page React application. `App.jsx` wires providers (auth, dialogs, wishlist), global behaviours (smooth scroll, splash, page loader, themed selects, tab title), and the route table. Pages are grouped by audience and each picks a layout shell:

| Shell | Used by | Provides |
|---|---|---|
| `HomeHeader` + `SiteFooter` directly | homepage, Explore, event details, categories, resale | Fixed header with role-aware menu and icons (cart/holds, notifications, account) |
| `AuthShell` | login, signup, verify, reset, invite | Two-panel auth card |
| `BookingShell` | seat selection, checkout, confirmation | Progress steps Seats → Checkout → Confirmation |
| `AccountShell` | wallet, NFT tickets, orders | Animated stacked sections |
| `BasicShell` | profile, notifications | Plain layout |
| `DashShell` | organizer, admin and gate consoles | Role console navigation (`CONSOLES`) |
| `SiteChrome` (in `App`) | `/suspended`, legal/about/contact, access-denied cases | Adds the site header/footer to pages without their own |

## Global behaviours (mounted once in `App`)
| Component | Effect |
|---|---|
| `AuthProvider` | Session restore, token refresh, idle sign-out ([authentication](authentication.md)) |
| `DialogProvider` | Promise-based `alert`/`confirm` dialogs |
| `WishlistProvider` | Saved event ids, optimistic toggling |
| `SelectEnhancer` | Themed dropdown for every native `<select>` |
| `SmoothScroll` | Lenis smooth scrolling + GSAP ScrollTrigger sync; `window.__lenis` |
| `AwayTitle` | Tab title nudge after 5 s away |
| `SplashScreen` | Once-per-session intro (`sessionStorage.tl_splash_seen`) |
| `ScrollToTop` | Scroll to top on new navigation (not on back/forward) |
| `RouteLoader` → `PixelLoader` | Page transition animation |
| `HoldBar` | Reservation countdown on every page |

## Browser storage keys

| Key | Storage | Written by | Purpose |
|---|---|---|---|
| `tl_session_id` | localStorage | `utils/api.getClientSessionId` | Behaviour session id sent as `x-session-id` |
| `tl_last_active` | localStorage | `AuthContext` | Cross-tab idle timer |
| `tl_token` | localStorage | (legacy) | Removed at startup |
| `tl_pending_email` | sessionStorage | `Login`, `Signup`, `VerifyOtp` | E-mail for the verify screen |
| `tl-pending-hold` | sessionStorage | `VenueBooking.requireLogin` | Seat picked while signed out (30 min) |
| `tl_splash_seen` | sessionStorage | `SplashScreen` | Splash shown once per session |
| `tl-home-scroll` | sessionStorage | `Dashboard` | Restore scroll on reload |
| Explore return key | sessionStorage | `Events.rememberPosition` | Restore filters/scroll on Back |
| Resale scroll key | sessionStorage | `ResaleMarketplace` | Restore scroll |
| `tl-gate-<eventId>` | localStorage | `GateScanner` | Chosen gate |
| `tl-gate-device`, `tl-gate-last-online` | localStorage | `gateOffline` | Device id, offline lock |
| `tl_salutation`, `tl_organisation`, `tl_avatar` | localStorage | `Profile` | Profile extras kept **only in the browser** |
| IndexedDB `tl-gate` (`packs`, `used`, `queue`) | IndexedDB | `gateOffline` | Offline scanner data |

Cookies (`tl_refresh`, `tl_pending_signup`) are httpOnly and set by the API.

## Window events used between components
`tl:holds-changed` (dispatched by `VenueBooking`, `Checkout`, `useCartHolds`; heard by `HoldBar`, `useCartHolds`), `tl:replay-splash` (heard by `SplashScreen`).

## Route table
Generated from `apps/web/src/App.jsx` (50 routes). "Guard" lists `ProtectedRoute allowedRoles`; "signed in" = any role. Guards are UI-only; the API re-checks everything.

| Route | Line | Page component | Guard | Layout |
|---|---|---|---|---|
| `/` | `App.jsx:138` | Dashboard | public | page’s own |
| `/events` | `App.jsx:139` | Events | public | page’s own |
| `/categories` | `App.jsx:140` | Categories | public | page’s own |
| `/terms` | `App.jsx:141` | Legal (doc="terms") | public | page’s own |
| `/privacy` | `App.jsx:142` | Legal (doc="privacy") | public | page’s own |
| `/about` | `App.jsx:143` | About | public | page’s own |
| `/contact` | `App.jsx:144` | Contact | public | page’s own |
| `/wishlist` | `App.jsx:145` | Wishlist | signed in | page’s own |
| `/events/:id` | `App.jsx:146` | EventDetails | public | page’s own |
| `/events/:id/seats` | `App.jsx:147` | SeatMap | public | page’s own |
| `/events/:id/checkout` | `App.jsx:148` | Checkout | public | page’s own |
| `/checkout` | `App.jsx:149` | Checkout | public | page’s own |
| `/cart` | `App.jsx:151` | redirect → /checkout | public | page’s own |
| `/booking-success/:orderId` | `App.jsx:152` | BookingSuccess | signed in | page’s own |
| `/booking-success/:id` | `App.jsx:153` | BookingSuccess | signed in | page’s own |
| `/bookings/:orderId/confirmation` | `App.jsx:154` | BookingSuccess | signed in | page’s own |
| `/bookings/:id/confirmation` | `App.jsx:155` | BookingSuccess | signed in | page’s own |
| `/resale` | `App.jsx:156` | ResaleMarketplace | CUSTOMER, SUPER_ADMIN | page’s own |
| `/login` | `App.jsx:157` | Login | public | page’s own |
| `/signup` | `App.jsx:158` | Signup | public | page’s own |
| `/verify` | `App.jsx:159` | VerifyOtp | public | page’s own |
| `/forgot-password` | `App.jsx:160` | ForgotPassword | public | page’s own |
| `/reset-password` | `App.jsx:161` | ResetPassword | public | page’s own |
| `/invite/:token` | `App.jsx:162` | AcceptInvite | public | page’s own |
| `/suspended` | `App.jsx:163` | Suspended | public | page’s own |
| `/company` | `App.jsx:164` | CompanyRegistration | public | page’s own |
| `/wallet` | `App.jsx:167` | DigitalWallet | CUSTOMER, SUPER_ADMIN | page’s own |
| `/my-bookings` | `App.jsx:168` | MyBookings | CUSTOMER, SUPER_ADMIN | page’s own |
| `/my-nfts` | `App.jsx:169` | MyNFTTickets | CUSTOMER, SUPER_ADMIN | page’s own |
| `/profile` | `App.jsx:170` | Profile | signed in | page’s own |
| `/notifications` | `App.jsx:171` | Notifications | signed in | page’s own |
| `/staff/events` | `App.jsx:174` | StaffEvents | GATE_STAFF, ORGANIZER, SUPER_ADMIN | DashShell |
| `/scanner` | `App.jsx:175` | GateScanner | GATE_STAFF, ORGANIZER, SUPER_ADMIN | DashShell |
| `/organizer/dashboard` | `App.jsx:178` | OrganizerDashboard | ORGANIZER, SUPER_ADMIN + approved company | DashShell |
| `/organizer/create-event` | `App.jsx:179` | CreateEvent | ORGANIZER, SUPER_ADMIN + approved company | DashShell |
| `/organizer/events/:id/venue` | `App.jsx:180` | VenueEditor | ORGANIZER, SUPER_ADMIN + approved company | DashShell |
| `/organizer/events/:id/edit` | `App.jsx:181` | CreateEvent | ORGANIZER, SUPER_ADMIN + approved company | DashShell |
| `/organizer/events/:id/submit` | `App.jsx:182` | EventSubmit | ORGANIZER, SUPER_ADMIN + approved company | DashShell |
| `/admin/dashboard` | `App.jsx:185` | SuperAdminDashboard | SUPER_ADMIN | DashShell |
| `/admin/companies` | `App.jsx:186` | AdminCompanies | SUPER_ADMIN | DashShell |
| `/admin/event-approvals` | `App.jsx:187` | AdminEventApprovals | SUPER_ADMIN | DashShell |
| `/admin/fraud-watchlist` | `App.jsx:188` | AdminFraudWatchlist | SUPER_ADMIN | DashShell |
| `/admin/demand-forecast` | `App.jsx:189` | DemandForecast | SUPER_ADMIN, ORGANIZER | DashShell |
| `/demand-forecast` | `App.jsx:190` | DemandForecast | SUPER_ADMIN, ORGANIZER | DashShell |
| `/admin/behavior-profile` | `App.jsx:191` | BehaviorProfile | SUPER_ADMIN | DashShell |
| `/admin/purchase-intent` | `App.jsx:192` | PurchaseIntentAnalytics | SUPER_ADMIN, ORGANIZER | DashShell |
| `/analytics/intent/:id` | `App.jsx:193` | PurchaseIntentAnalytics | SUPER_ADMIN, ORGANIZER | DashShell |
| `/analytics/intent` | `App.jsx:194` | PurchaseIntentAnalytics | SUPER_ADMIN, ORGANIZER | DashShell |
| `/admin/abandoned-intents` | `App.jsx:195` | AbandonedIntentDashboard | SUPER_ADMIN, ORGANIZER | DashShell |
| `*` | `App.jsx:198` | NotFound | public | page’s own |

Duplicate patterns: `/booking-success/:orderId` and `/booking-success/:id` (and the same for `/bookings/.../confirmation`) — React Router picks the first; `BookingSuccess` reads either param. `/demand-forecast` and `/analytics/intent` are aliases of the admin-prefixed paths (also used by organizers).
