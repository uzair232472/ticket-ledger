# Function catalogue — web app core (entry, routing, contexts, hooks, lib, utils)

[← Function catalogue index](README.md) · Related: [Architecture & startup](../01-architecture.md#4-startup-sequences) · [State, realtime & config](../09-state-realtime-config.md) · [Shared code](../08-shared-code.md)

Files: `apps/web/index.html`, `src/main.jsx`, `src/App.jsx`, `src/context/AuthContext.jsx`, `src/context/WishlistContext.jsx`, `src/hooks/useCartHolds.js`, `src/lib/*.js`, `src/utils/*.js`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `.env.example`.

---

## Build and entry

| File | Role |
|---|---|
| `vite.config.js` | React plugin; alias **`@venue-core` → `../venue-core/src/index.js`** (so the browser uses the exact seat-generation code the API uses); dev server port 5173, `host: true`. |
| `tailwind.config.js`, `postcss.config.js` | Tailwind 3 + Autoprefixer. Most styling is in hand-written CSS files next to components; Tailwind utility classes are used inline in older pages. |
| `.env.example` | `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_ML_SERVICE_URL` (not read by any source file), `VITE_POLYGON_CHAIN_ID` (not read by any source file). |
| `index.html` | Loads Google Fonts (Fraunces, JetBrains Mono, Plus Jakarta Sans, Space Grotesk) and `/src/main.jsx` into `#root`. |
| `src/main.jsx` | `ReactDOM.createRoot(#root).render(<React.StrictMode><App/></React.StrictMode>)` and imports global `index.css`. StrictMode runs effects twice in development, which is why several effects guard with `alive`/`active` flags. |

## `src/App.jsx`

### `App()` — `:121` (default export)
Provider and layout tree, **outermost first**: `BrowserRouter` → `AuthProvider` (session restore) → `DialogProvider` (promise-based confirm/alert dialogs) → `WishlistProvider` → global behaviours (`SelectEnhancer`, `SmoothScroll` (Lenis), `AwayTitle`, `SplashScreen`, `ScrollToTop`, `RouteLoader`) → page frame with `SiteChrome`-wrapped `HomeHeader`, `<Routes>`, `SiteChrome`-wrapped `SiteFooter`, and the global `HoldBar`.

**Routes** (50 `<Route>` elements; full table in [Modules → Frontend shell](../02-modules/frontend-shell.md#route-table)). Protection is applied per route with [`ProtectedRoute`](web-components.md#web-protectedroute) (`allowedRoles`, `requireApprovedCompany`); studio routes are wrapped in `DashShell`. Duplicate route definitions exist for `/booking-success/:orderId` vs `/:id` and `/bookings/:orderId/confirmation` vs `/:id` (React Router uses the first match; the second of each pair is unreachable). `/cart` redirects to `/checkout`.

**Imported but never rendered:** `NotificationBell` (the header uses `HeaderAccount` instead), `BrandLogo` (used by other components, not App), and most `lucide-react` icons in the import list. `MyBookings` is routed (`/my-bookings`).

| Inner component | Line | Behaviour |
|---|---|---|
| `SiteChrome({children})` | `:77` | Renders its children (the site header/footer) **only** on `/suspended`, customer-only pages viewed by a non-customer role, `/profile` and `/notifications` while signed out, and `/terms`, `/privacy`, `/about`, `/contact`. Every other page brings its own header. |
| `ScrollToTop()` | `:93` | `useLayoutEffect` on path change: unless the navigation is a browser back/forward (`POP`), scroll to top — through Lenis (`window.__lenis.scrollTo(0, {immediate, force})`) when present. |
| `RouteLoader()` | `:106` | Shows `PixelLoader` keyed by pathname on each page change; skips the very first page of a visit when the splash screen has not been seen yet (`sessionStorage.tl_splash_seen`). |

---

## `src/context/AuthContext.jsx` — authentication state

<a id="web-auth-provider"></a>
### `AuthProvider({children})` — `:59`
- **State:** `user` (the [`buildAuthUser`](api-auth-accounts.md#api-auth-buildauthuser) object), `token` (access JWT, mirrored into `lib/session.js` memory), `loading` (true until the startup restore finishes), `refreshInFlight` ref.
- **Context value:** `user, token, loading, isAuthenticated, role, login, signup, getPendingSignup, updatePendingSignup, verifyOtp, resendOtp, forgotPassword, resetPassword, getInvite, acceptInvite, refreshUser, logout`.

Helpers outside the component:

| Helper | Line | Behaviour |
|---|---|---|
| `REFRESH_LEAD_MS` / `IDLE_TIMEOUT_MS` / `ACTIVITY_KEY` | `:8-11` | 60 s before expiry; 30 min idle (matches the API); localStorage key `tl_last_active` shared by all tabs. |
| `readLastActive()` / `writeLastActive(t)` | `:12`, `:19` | Safe localStorage access. |
| `tokenExpiry(token)` | `:27` | Decodes the JWT payload (base64url) and returns `exp × 1000` or null. **No signature check** (not needed client-side). |
| <a id="web-auth-authrequest"></a>`authRequest(path, {method, body})` | `:40` | `fetch(API_URL/api/auth + path, {credentials:'include'})` so the httpOnly cookies are sent; parses JSON (204 → `{}`); on non-OK throws an `Error` carrying `status`, `code`, `needsVerification`, `data` so pages can branch. |

Functions and effects inside `AuthProvider`:

| Item | Line | Trigger → behaviour |
|---|---|---|
| `applySession(session)` | `:66` | Stores token in `lib/session` and state, sets `user`. Called after login, OTP verification, invite acceptance and every refresh. |
| `clearSession()` | `:72` | Nulls token (both places) and user. |
| `handleSuspended()` | `:78` | `clearSession` + navigate to `/suspended`. Registered as the global "account suspended" handler. |
| <a id="web-auth-refreshsession"></a>`refreshSession()` | `:84` | **Single-flight**: concurrent callers share one `POST /api/auth/refresh` promise (important because the refresh token rotates and a second concurrent use would look like reuse). OK → `applySession`, return new token. Error response → `clearSession`, go to `/suspended` if `ACCOUNT_SUSPENDED`, return null. Network error → keep state, return null. |
| effect (`:108`) | on mount/changes | `setSessionHandlers({onRefresh: refreshSession, onSuspended: handleSuspended})` — wires the axios/fetch interceptors to this provider. |
| **startup effect** (`:113`) | once | 1. Removes legacy `localStorage.tl_token`. 2. If `tl_last_active` is older than 30 min → `POST /logout`, mark active now, stop (`loading=false`) — a session idle across closed tabs is not restored. 3. Otherwise mark active and `refreshSession()`; if it fails, wait 300 ms and retry once (another tab may have rotated the cookie at the same moment). 4. `loading=false`. **This is how a page reload restores authentication** — the access token is never persisted. |
| refresh timer effect (`:146`) | when `token` changes | `setTimeout(refreshSession, exp − now − 60 s)`. |
| idle effect (`:156`) | while signed in | Listens to `pointerdown, keydown, wheel, touchstart, scroll, mousemove` (capture, passive) and writes `tl_last_active` at most every 15 s; every 15 s and on tab visibility, `check()` signs out (POST `/logout`, `clearSession`, navigate `/login` with a notice) if 30 min passed. |
| `login(email, password)` | `:189` | `authRequest('/login')` → `applySession`. Throws for 401/403 (`needsVerification`, `ACCOUNT_SUSPENDED`). |
| `signup(form)` | `:195` | `POST /signup` (no session). |
| `getPendingSignup()` / `updatePendingSignup(form)` | `:198`, `:200` | `GET`/`PATCH /pending-signup`. |
| `verifyOtp(email, code)` | `:202` | `POST /verify-otp` → `applySession`. |
| `resendOtp(email, purpose)` | `:208` | `POST /resend-otp`. |
| `forgotPassword(email)` / `resetPassword(email, code, newPassword)` | `:210`, `:212` | `POST /forgot-password`, `/reset-password`. |
| `getInvite(token)` / `acceptInvite(token, name, password)` | `:215`, `:218` | `GET /invite/:token`; `POST /accept-invite` → `applySession`. |
| `refreshUser()` | `:225` | `GET /api/auth/me` with the current token, replaces `user`. Used by `CompanyRegistration` after a company changes status. |
| `logout()` | `:234` | `POST /logout` (errors ignored) then `clearSession`. Caller: `HomeHeader.onLogout`, `AcceptInvite`. |

### `useAuth()` — `:270`
Returns the context; throws if used outside `AuthProvider`. Used by ~40 components/pages.

---

## `src/lib/session.js` — in-memory token and interceptors

Module state: `accessToken`, `refreshHandler`, `suspendedHandler`. `API_URL` = `VITE_API_URL` or `http://localhost:5000`.

| Function | Line | Behaviour |
|---|---|---|
| `getAccessToken()` / `setAccessToken(t)` | `:12-13` | Memory only — never localStorage (comment `:1-3`), so an XSS cannot read a stored token and a reload must use the refresh cookie. |
| `setSessionHandlers({onRefresh, onSuspended})` | `:18` | Called by `AuthProvider`. |
| `refreshAccessToken()` | `:23` | Calls the registered handler or resolves `null`. |
| `isApiRequest(url)` | `:25` | URL starts with `API_URL` and is **not** an `/api/auth/` call (auth calls are never retried). |
| <a id="web-session-interceptors"></a>`installFetchInterceptor()` | `:33` | Replaces `window.fetch` once. For API URLs answering 401/403: `403 ACCOUNT_SUSPENDED` → suspended handler; `401 TOKEN_EXPIRED` on a string URL that carried an `Authorization` header → refresh and **retry once** with the new token. Lets the many pages that call `fetch` with `token` from `useAuth()` survive the 15-minute expiry. |
| `installAxiosInterceptor(instance)` | `:61` | Same logic as an axios response interceptor (marks `config._retried`). Installed on the global `axios` (`:91`) and on the shared `api` instance (`utils/api.js`). |
| `getHomeRoute(user)` | `:95` | Landing page per role: SUPER_ADMIN `/admin/dashboard`; ORGANIZER `/organizer/dashboard` if company approved else `/company`; GATE_STAFF `/staff/events`; others `/events`. Callers: `Signup`, `VerifyOtp`, `AcceptInvite`. |
Both interceptors are installed **at import time** (`:90-91`).

## `src/utils/api.js` — shared axios client

| Symbol | Line | Behaviour |
|---|---|---|
| `api` (default) | `:6` | `axios.create({baseURL: API_URL + '/api', JSON headers})`. |
| request interceptor | `:23` | Adds `Authorization: Bearer <in-memory token>` and **`x-session-id`** on every request (used by behaviour tracking and login attribution). |
| `installAxiosInterceptor(api)` | `:37` | Silent refresh/suspension handling. |
| <a id="web-api-getclientsessionid"></a>`getClientSessionId()` | `:14` | Reads/creates `localStorage.tl_session_id` = `sess_<random>_<base36 time>` (persists across visits until storage is cleared). |
| <a id="web-api-trackclientbehavior"></a>`trackClientBehavior(action, eventId, metadata)` | `:40` | `POST /behavior/track` with the session id; errors are swallowed (`console.debug`). Callers: `EventDetails` (`event_view`), `Events` (`category_view`), `SeatMap` (`seat_selected`), `BehaviorProfile` (simulator). |

Not every page uses `api`: many use `fetch(`${API_URL}/api/...`, {headers:{Authorization:`Bearer ${token}`}})` or `axios.get(...)` directly (e.g. `Profile`, `DigitalWallet`, `SeatMap`, `MyBookings`, admin pages). Those still benefit from the global interceptors but do not send `x-session-id`.

## `src/lib/validation.js` — form rules mirroring the API
`validateName` (2–50), `validateEmail` (simple pattern), `validatePhone` (optional; `03…` or `+923…` after removing spaces/dashes), `validatePassword` (≥8, letter, digit), `validateOtp` (6 digits), `firstError(...errors)`. Return an error string or `null`. Callers: auth pages.

## `src/lib/site.js`
Constants `OFFICIAL_EMAIL`, `SUPPORT_EMAIL`, `ORGANIZER_EMAIL` (all the same address), `SUPPORT_HOURS`. Used by Contact, About, Legal, Suspended, footer.

## `src/lib/gateOffline.js` — scanner offline store (IndexedDB `tl-gate`)
| Function | Line | Behaviour |
|---|---|---|
| `openDb()` | `:17` | Opens DB v1 with stores `packs` (key eventId), `used` (key `eventId:ticketId`), `queue` (keyPath `clientId`). Memoised promise. |
| `tx(store, mode, fn)` | `:34` | Runs one request in a transaction and resolves with its result on `complete`. |
| `savePack(eventId, pack, ownerId)` / `loadPack(eventId, ownerId)` | `:45-46` | Stores the server pack tagged with the staff user id; `loadPack` returns it **only for the same user** (another account on the device cannot use it). |
| `markUsedLocally`, `usedLocally` | `:50-51` | Device-local admissions (so a second scan on this device is yellow). |
| `enqueue`, `queued(eventId)`, `dequeue(ids)` | `:52-57` | Offline scan queue sorted by `scannedAt`. |
| `wipeEvent(eventId)` | `:64` | Drops queued scans, the pack and local admissions for an event (after access revocation); returns how many scans were dropped. |
| `safeGet`, `safeSet` | `:75-82` | localStorage with try/catch. |
| `deviceId()` | `:89` | Persistent `tl-gate-device` id (`gate-<uuid>`). |
| `noteOnline()`, `lastOnline()`, `offlineTooLong()` | `:97-99` | `tl-gate-last-online` timestamp; offline > **2 h** (`OFFLINE_LIMIT_MS`) locks scanning. |
| `b64urlToBytes`, `normaliseManualCode`, `isManualCode` | `:105-115` | Same normalisation as the server. |
| `importKey(raw)` | `:118` | WebCrypto `importKey('raw', …, Ed25519, verify)`; cached; resolves `null` if the browser lacks Ed25519. |
| `verifySignature(pack, payload, sig)` | `:126` | `true/false`, or `null` when the browser cannot verify. |
| `timeOf(d)` | `:137` | Local time label. |
| <a id="web-gate-evaluateoffline"></a>`evaluateOffline(pack, raw, gate)` | `:143` | Device-side verdict mirroring `checkinService.evaluate`: manual code lookup or `TL1` parse → signature (a `null` "cannot verify" result is **not** treated as a failure, so on browsers without Ed25519 support the signature is effectively skipped offline) → event match → ticket in pack → `qrVersion` → `CANCELLED` → already used (locally or in the pack) → GREEN and mark used locally. Does not check payment (the pack only contains paid tickets). |

## `src/context/WishlistContext.jsx`
### `WishlistProvider({children})` — `:13`
- State `ids: Set<eventId>`. Effect (`:21`) reloads `GET /wishlist/ids` whenever the signed-in user changes, clears on sign-out.
- `isSaved(eventId)` (`:36`).
- <a id="web-wishlist-toggle"></a>`toggle(eventId)` (`:38`): signed-out → confirm dialog "Sign in to save events" → navigate to `/login` with `from`; signed-in → **optimistic** add/remove in the Set, then `POST`/`DELETE /wishlist/:eventId`; on failure the change is undone and an error dialog shown. Returns `true/false`.
- Value `{ids, count, isSaved, toggle}`.
### `useWishlist()` — `:80`
Consumers: `Dashboard`, `Events`, `EventDetails`, `Wishlist`, `HeaderAccount` (count badge), event tiles.

## `src/hooks/useCartHolds.js` — `useCartHolds()` (`:6`)
The signed-in user's seat holds across events (the "cart").
- `load()` (`:14`): `GET /venues/holds/mine`; stores `holds` and the server/client clock `offset`.
- Effects: reload on path change (`:31`); reload on window `tl:holds-changed` (dispatched by Checkout/booking code after changes), on `focus`, and every 20 s (`:35`); 1-second ticker while a hold exists (`:50`); when the earliest hold reaches 0 s, drop it locally and reload (`:59`).
- `releaseAll(eventId, keys)` (`:66`) and `deleteItem(eventId, seat)` (`:80` — venue key, legacy `seatId` via `/seats/unlock`, or a raw key string) → then dispatch `tl:holds-changed` and reload.
- Returns `{holds, first, totalCount, secondsLeft, releasing, releaseAll, deleteItem, refresh}`.
- Consumer: `components/home/HeaderAccount.jsx` (cart drop-down). `HoldBar` has its own simpler polling.

## `src/utils/` — formatting and media helpers
| File / function | Line | Behaviour | Main users |
|---|---|---|---|
| `eventImageSpecs.js` `EVENT_IMAGE_SPECS`, constants | `:1-75` | Browser copy of the API's image specs plus preview `frames`; must match `apps/api/src/config/eventMedia.js`. | event form components |
| `specHelperText(spec)`, `specLimitText(spec)` | `:80`, `:84` | Help text lines. | `ImageField`, `GalleryField` |
| `ratioMatches(w, h, spec)` | `:89` | ±10 % ratio check. | `checkImageFile`, cropper |
| `readImageSize(file)` | `:92` | Decodes via an object URL `Image` to get natural size. | `checkImageFile` |
| `checkImageFile(file, spec)` | `:112` | Type, decodability, max/min size, ratio (`needsCrop`), file size (`needsCrop` — the cropper re-encodes smaller). Mirrors the server checks so most problems are caught before upload. | `ImageField`, `GalleryField` |
| `eventMedia.js` `EVENT_VISUALS` | `:1-90` | Per event type label, colours, default/alt Unsplash images. | cards, tiles, details |
| `resolveMediaUrl(url)` | `:94` | Prefixes `/uploads/…` with the API URL (files served by the API); other paths stay web-relative. | everywhere images are shown |
| `getEventVisual(event, index)` | `:96` | Picks banner (organizer banner → title keyword-based Unsplash image → type default/alt) and card image (organizer card → banner). | cards, details, checkout, PDF-like views |
| `eventTime.js` `formatEventDate(date, opts)` | `:8` | Formats in **UTC** so the stored calendar day never shifts by timezone. | everywhere dates show |
| `formatEventTime(time)` | `:12` | Strips trailing `PST`/`PKT`. | same |
| `eventDayEnd(date)` | `:15` | End of the event day in Pakistan (UTC+5) as epoch ms — used to treat events as ended. | lists, details |
| `maps.js` `googleMapsUrl({latitude, longitude, venue, city})` | `:2` | Exact-pin search URL or a venue+city text search. | `EventDetails`, maps |

---

## Small helpers and inline callbacks
| Item | Where | Behaviour |
|---|---|---|
| `onActivity()` | `AuthContext.jsx:159` (idle effect) | On pointer/key/wheel/touch/scroll/mousemove, writes `tl_last_active` at most every 15 s. |
| `onVisible()` | `AuthContext.jsx:179` | When the tab becomes visible, runs the idle `check()` immediately. |
| `check()` | `AuthContext.jsx:166` | If idle > 30 min: `POST /logout`, clear session, navigate to `/login` with a notice. |
| `onChange()` | `useCartHolds.js:36` | Reloads holds on `tl:holds-changed` and window `focus`. |
| `formatMb(bytes)` | `eventImageSpecs.js:77` | Bytes → MB with one decimal for help texts. |
