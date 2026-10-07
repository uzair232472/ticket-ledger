# Function catalogue — tickets, QR passes, PDF & gate check-in

[← Function catalogue index](README.md) · Module walkthroughs: [Tickets, QR & PDF](../02-modules/tickets-qr.md) · [Gate check-in](../02-modules/gate-checkin.md)

Files: `apps/api/src/controllers/ticketController.js`, `services/qrPassService.js`, `services/qrTicketService.js`, `services/ticketPdf.js`, `services/checkinService.js`, `controllers/checkinController.js`, `controllers/gateController.js`.

> **Two QR systems exist** (observed):
> | | Current system | Legacy system |
> |---|---|---|
> | Format | Text `TL1.<ticketId>.<eventId>.<qrVersion>.<Ed25519 signature>` + manual code `TL-XXXX-XXXX` | JSON with `ticketId, eventId, tokenId, nonce, timeStep/issuedAt, qrVersion, signature` (HMAC-SHA256) |
> | Code | `qrPassService.js`, `checkinService.js` | `qrTicketService.js` (`createSignedQRPayload`, `createDynamicQRPayload`, `verifyOfflineHMAC`, `verifyTicketQR`, `processGateScan`) |
> | Invalidation after transfer | `Ticket.qrVersion` +1 and `manualCode` reset | `Ticket.qrNonce` replaced |
> | Endpoints | `/api/tickets/wallet`, `/api/tickets/:id/qr`, `/api/tickets/:id/pdf`, `/api/tickets/verify-qr`, `/api/checkin/*` | `/api/gate/*` |
> | Web caller | `DigitalWallet`, `GateScanner` | **none** (only `test_gate_scanner.mjs`, `test_staff_invites.mjs`, `test_transfer_resale.mjs`) |
> | Scan log table | `CheckIn` (+ a mirrored `GateScan` row) | `GateScan` |

---

## `qrPassService.js` — current signed passes

<a id="api-qrpass-loadkeys"></a>
### `loadKeys()` — `:23` (private, memoised)
1. Uses `QR_SIGNING_PRIVATE_KEY` (PKCS#8 PEM; `\n` escapes converted).
2. Without it: production → throws; development → reads `apps/api/.keys/qr-ed25519.pem`, or **generates an Ed25519 key pair once and writes it there** (mode 600; folder is git-ignored) so passes stay valid across restarts.
3. Derives the public key, its raw 32-byte form (base64url, from JWK `x`) for WebCrypto in the scanner, and SPKI PEM.

| Function | Line | Behaviour |
|---|---|---|
| `getPublicKey()` | `:49` | `{alg:'Ed25519', raw, pem}` — shipped to gate devices in the offline pack. Public key can verify but never create passes. |
| <a id="api-qrpass-signpass"></a>`signPass(ticket)` | `:55` | Signs `TL1.<id>.<eventId>.<qrVersion>` with the private key; returns `payload.<base64url sig>`. Generated on demand, never stored. Contains no personal data. |
| <a id="api-qrpass-verifypass"></a>`verifyPass(raw)` | `:65` | Splits on `.`; needs 5 parts with prefix `TL1`, non-empty ids, integer version ≥1; verifies the signature over the first four parts. Returns `{ok, ticketId, eventId, qrVersion}` or `{ok:false, reason}`. |
| `randomCode()` *(private)* | `:84` | `TL-XXXX-XXXX` from an alphabet without `0 O 1 I L` (8 random bytes mod 31). |
| `normaliseManualCode(raw)` | `:91` | Upper-cases, strips non-alphanumerics and a leading `TL`; needs exactly 8 chars → `TL-XXXX-XXXX`, else `null`. |
| `looksLikeManualCode(raw)` | `:96` | Normalisable and contains no `.` (so it is not a signed pass). |
| `assignManualCode(ticketId, tx)` | `:99` | Writes a new random code; retries up to 5 times on unique-constraint clash (`P2002`). |
| `ensureManualCodes(tickets)` | `:112` | Assigns codes to tickets that have none (lazy migration for older tickets, and after transfers which set `manualCode = null`). |
| <a id="api-qrpass-passfor"></a>`passFor(ticket)` | `:120` | Ensures a manual code, returns `{code: signPass(ticket), manualCode, qrVersion}`. Callers: `getCustomerWallet`, `getTicketQR`, `buildTicketPDF`. |

---

## `checkinService.js` — gate verification (current)

Helpers: `ticketInclude` (`:15`), `firstName(name)` (`:23`), `seatLabel(seat)` (`:24` — GA shows the zone name), `timeOf(d)` (`:29`, Karachi time), `ticketView(t)` (`:31` — minimal data shown on the scanner: tier, seat, holder's first name, event), `LEGACY_RESULT` (`:87` — GREEN/YELLOW/RED → `GateScanResult`), `response(verdict, extra)` (`:147`).

<a id="api-checkin-evaluate"></a>
### `evaluate(raw, eventId)` — `:43` (read-only)
Returns `{result: 'GREEN'|'YELLOW'|'RED', reason, ticket?, firstScan?, qrVersion?}` after checks **in this order**:
1. Manual code? Look the ticket up by `manualCode` (codes are replaced on transfer, so a match is the current code). Otherwise `verifyPass` (signature) → RED on failure; load by id; RED if missing or `eventId` inside the pass differs from the ticket's.
2. Scanning a specific event and the ticket is for another → RED "different event".
3. Pass `qrVersion` ≠ ticket `qrVersion` → RED "Old QR: this ticket was transferred".
4. Order not `SUCCESSFUL` → RED "never paid for" (placeholder tickets of unfinished checkouts).
5. Event `CANCELLED` → RED.
6. Ticket `CANCELLED` → RED; `TRANSFERRED`/`RESOLD` → RED.
7. Ticket `SCANNED` → **YELLOW** "Already scanned at 7:42 PM, Gate B" with `firstScan`.
8. Otherwise **GREEN** "Entry allowed".
Callers: `scan`, `syncOffline`, `ticketController.verifyTicketQRPost` (with `eventId = null`).

### `logScan({verdict, eventId, staffId, deviceId, gate, offline, scannedAt, conflict})` — `:89` (private)
**Writes a `CheckIn` row for every scan** (admitted or not; `ticketId` null for junk codes; `syncedAt` set for offline uploads) and, when a ticket was identified, a mirrored **`GateScan`** row (the older table still feeds dashboard turnout figures — comment `:106`).

<a id="api-checkin-eventstats"></a>
### `eventStats(eventId)` — `:115`
Paid tickets (`order SUCCESSFUL`, status `ACTIVE|SCANNED`) → `sold`, `entered` (SCANNED), `remaining`, per-gate entered counts (groupBy `Ticket.gate`), scan result counts from `CheckIn`, and offline `conflicts` count.

### `broadcast(eventId, ticket)` — `:135` (private)
Emits `ticket:checked-in {ticketId, checkedInAt, gate}` to room `user_<holder>` (the holder's open wallet greys out the QR — `DigitalWallet.jsx:86`), then computes `eventStats` and emits `checkin:stats` to room `event_<eventId>` (other scanners) and to the organizer's `user_<id>` room (`OrganizerDashboard.jsx:191`).

<a id="api-checkin-scan"></a>
### `scan({code, eventId, staffId, gate, deviceId, scannedAt})` — `:156`
1. `evaluate`.
2. GREEN → **atomic admission:** `ticket.updateMany({id, status:'ACTIVE', qrVersion} → SCANNED, checkedInAt, checkedInById, gate})`. If `count === 0`, another gate admitted it first (or it changed): re-evaluate → YELLOW (or RED "Ticket changed while scanning").
3. `logScan`; GREEN → `broadcast`.
4. Returns `{result, reason, ticket: ticketView, firstScan}`.
**Why:** the conditional update means two gates scanning the same ticket at the same moment cannot both admit it (comment `:11-12`).

<a id="api-checkin-syncoffline"></a>
### `syncOffline({scans, eventId, staffId, deviceId})` — `:183`
Processes queued offline scans **sorted by `scannedAt`** (earliest admission wins):
- Server says GREEN but the device turned the person away (`localResult` ≠ GREEN) → recorded with the device's result (only an admission marks a ticket used).
- GREEN → same atomic admission using the *offline* `scannedAt` as `checkedInAt`.
- Server says YELLOW but the device admitted it (`localResult === 'GREEN'`) → **conflict** (two devices admitted the same ticket offline). If this offline admission happened earlier than the recorded one, the ticket's `checkedInAt/gate/staff` are rewritten to it.
- Every scan is logged with `offline:true`; returns per-scan results with `clientId` and `conflict`. Broadcasts `ticket:checked-in` per admitted ticket and one stats update.

<a id="api-checkin-eventpack"></a>
### `eventPack(eventId)` — `:236`
Offline pack for scanners: event summary, `getPublicKey()`, `generatedAt`, and every paid ticket `{id, status: VALID|USED|CANCELLED, qrVersion, manualCode, type, seat, holder first name, checkedInAt, gate}` (assigns missing manual codes first). Stored by the browser in IndexedDB (`lib/gateOffline.js`).

---

## `checkinController.js` (`/api/checkin`, all: `authenticateJWT` + `requireRole('GATE_STAFF','ORGANIZER','SUPER_ADMIN')`)

`canScan(user, eventId)` (`:6`) = event in [`getScopedEventIds`](api-auth-accounts.md#api-access-getscopedeventids) (or admin). `fail` (`:11`) maps Zod → 400, else 500.

| Handler | Route | Behaviour | Web caller |
|---|---|---|---|
| `myEvents` (`:18`) | `GET /events` | Scoped events with status `PUBLISHED|PAUSED|COMPLETED`, by date. | `GateScanner.jsx:148` |
| `pack` (`:33`) | `GET /events/:id/pack` | `canScan` (403) → `eventPack` (404 if no event). | `GateScanner.jsx:183` |
| `scanTicket` (`:52`) | `POST /scan` | Validate `{code 4–400, eventId, gate?, deviceId?}` → `canScan` → `scan`. Always HTTP 200 with the verdict in `data` (RED is not an HTTP error). | `GateScanner.jsx:316` (6 s timeout; on timeout the scanner falls back to offline verification) |
| `syncScans` (`:82`) | `POST /sync` | Validate up to 500 scans → `canScan` → `syncOffline`; returns `{results, conflicts}`. | `GateScanner.jsx:220` |
| `stats` (`:94`) | `GET /events/:id/stats` | `eventStats`. | `GateScanner.jsx:204` |
| `recent` (`:104`) | `GET /events/:id/recent?limit` | Latest `CheckIn` rows (≤50) with staff name and holder first name. | `GateScanner.jsx:204` |

Revoking a staff member's assignment (`staffController.revokeEventAccess`) makes `canScan` fail immediately for scans, packs and sync uploads.

---

## `ticketController.js` (`/api/tickets`, all behind `requireAuth`)

Imports `createSignedQRPayload` (used since `fad6f72` to add a legacy HMAC `qr.payload` to each wallet ticket) and `verifyTicketQR` (used by the fallback branch of `verifyTicketQRPost`) from `qrTicketService`.

### `mintOrderNFTs` — `POST /api/tickets/mint/:orderId` — `:15`
Owner or admin; order must be `SUCCESSFUL`; `nftService.batchMintOrderTickets`. No web caller (minting happens automatically in `confirmBooking` and lazily in the wallet).

### `getMyNFTTickets` — `GET /api/tickets/my-nfts` — `:58`
All of the user's tickets with status ≠ `CANCELLED` (**not filtered by order status**, so placeholder tickets of an unpaid checkout are included). For each without `tokenId/txHash`, calls `nftService.mintTicketNFT` (simulated unless configured — see [NFT](api-resale-transfer-nft.md#api-nft-mintticketnft)). Adds `resalePriceCap = floor(price × 1.10)`, blockchain block (`isLiveOnChain` = both `POLYGON_PRIVATE_KEY` and `TICKET_NFT_CONTRACT_ADDRESS` set), active resale listing. Caller: `MyNFTTickets.jsx:58`.

### `getNFTTicketById` — `GET /api/tickets/nft/:id` — `:175`
Ticket + owner name/wallet + blockchain fields. **No ownership check** (any signed-in user can read any ticket by id). No web caller.

<a id="api-ticket-wallet"></a>
### `getCustomerWallet` — `GET /api/tickets/wallet` — `:224`
Paid tickets only (`order.status = SUCCESSFUL`). For each: lazy mint if needed, [`passFor`](#api-qrpass-passfor) (signed code + manual code), `generateQRDataUrl(pass.code)` (PNG data URL, error correction H), resale cap, NFT badge, check-in info, active listing. The `qr` object (`:320`) holds `code`, `manualCode`, `qrVersion`, `qrCodeDataUrl` and, since `fad6f72`, `nonce` plus `payload` = legacy HMAC JSON from `createSignedQRPayload({id, eventId, tokenId, qrNonce})`; `qrNonce` is also repeated at the top level. The web wallet does not use `payload` (it shows and checks `code`). Callers: `DigitalWallet.jsx:96`, `Profile.jsx:350`.

### `downloadTicketPDF` — `GET /api/tickets/:id/pdf` — `:359`
Owner or admin → sets PDF headers → [`buildTicketPDF`](#api-qr-buildticketpdf) streams it. Errors after streaming started cannot return JSON. Caller: `DigitalWallet.jsx:133` (fetch → blob download).

### `getTicketQR` — `GET /api/tickets/:id/qr` — `:396`
Owner only (admins too are refused); order must be paid (409); returns code, manual code, version and QR image. No web caller found.

<a id="api-ticket-verifyqr"></a>
### `verifyTicketQRPost` — `POST /api/tickets/verify-qr` — `:446`
Read-only; nothing is marked used. Since `fad6f72` it routes the body's `payload` three ways:
1. a **string starting with `TL1:`** (colon) → `evaluate(payload, null)`;
2. an **object with a string `code`** → `evaluate(payload.code, null)`;
3. anything else → legacy [`verifyTicketQR`](#api-qr-verifyticketqr) (HMAC JSON, string or object).
Response `{success, valid, result, reason, message}` with **200 when valid, 400 otherwise** (previously always 200).

**Observed mismatch:** signed passes are written `TL1.<ticketId>.…` (dots — see [`signPass`](#api-qrpass-signpass)), so a real pass string never matches branch 1. The wallet's "check my pass" (`DigitalWallet.jsx:161`) sends `{payload: ticket.qr.code}` (a `TL1.` string), which falls to branch 3, where `JSON.parse` fails → `PARSING_ERROR` → the wallet reports the pass as invalid. Sending `{payload: {code}}` or fixing the prefix test to `TL1.` would restore the read-only check. The gate scanner (`/api/checkin/scan`) is unaffected.

---

## `qrTicketService.js` — QR images, PDF, and the legacy HMAC system

| Function | Line | Status | Behaviour |
|---|---|---|---|
| `QR_SECRET` | `:8` | legacy | `QR_HMAC_SECRET` → `JWT_SECRET` → hard-coded fallback. |
| `createSignedQRPayload(ticket)` | `:14` | legacy (wallet `qr.payload` only) | HMAC over `ticketId:eventId:tokenId:nonce:issuedAt:1.0`. |
| `generateQRDataUrl(payload)` | `:43` | **current** | `qrcode` → PNG data URL (320 px, ECC H). Used by wallet and `getTicketQR`, and legacy dynamic QR. |
| `generateQRBuffer(payload)` | `:58` | **current** | PNG buffer (300 px) for the PDF. |
| `ROTATION_WINDOW_SECONDS` | `:66` | legacy | 30 s. |
| `createDynamicQRPayload(ticket, timestamp)` | `:71` | legacy | Time-step (30 s) HMAC payload with `expiresAt`. Used by `gateController.getDynamicRotatingQR` and tests. |
| `verifyOfflineHMAC(payload, now)` | `:104` | legacy | Parses JSON; dynamic payloads older than one step → `EXPIRED_SCREENSHOT`; recomputes HMAC and compares with `!==` (not constant-time). |
| <a id="api-qr-verifyticketqr"></a>`verifyTicketQR(raw)` | `:157` | legacy (fallback of `verifyTicketQRPost`) | HMAC check (`verifyOfflineHMAC`, `JSON.parse` for strings) + DB nonce/status check. |
| `processGateScan({payload, staffId, gateNumber, offlineMode, allowedEventIds})` | `:209` | legacy | HMAC → load ticket → event scope → nonce → `SCANNED` → double entry (logs `GateScan ALREADY_SCANNED`) → non-active → **transaction** (`ticket.update` SCANNED + `gateScan.create VALID_FIRST_SCAN`). The status update is **not conditional**, so two concurrent scans could both succeed (unlike `checkinService.scan`). Does not check order payment. Used by `gateController.scanTicket`. |
| <a id="api-qr-buildticketpdf"></a>`buildTicketPDF(ticket, res)` | `:354` | **current** | Creates an A4 `PDFDocument`; **before** piping, prepares `passFor` (signed code + manual code), `generateQRBuffer`, and `loadEventPhoto` (so failures can still return JSON); then pipes to the response and calls `drawTicketPdf`. |

## `ticketPdf.js` — PDF drawing

| Symbol | Line | Behaviour |
|---|---|---|
| `MARK`, `ICONS`, `C`, `CATEGORY`, `FALLBACK_PHOTO`, `STATUS_STYLE` | `:11-46`, `:128` | Vector paths, palette, per-category fallback photos (Unsplash URLs), status pill colours. |
| `unsplash(id)` | `:45` | Builds an Unsplash image URL. |
| `isImage(buf)` | `:55` | JPEG/PNG magic-byte check. |
| `loadEventPhoto(event)` | `:59` | Tries `bannerUrl`, `cardImageUrl`, then the category fallback; http(s) URLs are fetched with a 4 s timeout, local paths read from `process.cwd()/uploads/…`; returns the first valid image buffer or `null`. **Makes outbound HTTP requests** during PDF generation. |
| `drawIcon`, `drawMark`, `arcText`, `star`, `label` | `:80-126` | Drawing helpers (icons, logo, text on an arc, stars, small caps labels). |
| `drawTicketPdf(doc, ticket, {qrBuffer, photo, manualCode})` | `:139` | Lays out header (logo, tagline, status pill), event banner/photo, event and seat facts, the QR image and manual code, tear line and footer. Pure drawing — no I/O. |

---

## `gateController.js` (`/api/gate`) — **legacy, no web caller**

| Handler | Route & guards | Behaviour |
|---|---|---|
| `scanTicket` (`:15`) | `POST /scan` (GATE_STAFF, SUPER_ADMIN, ORGANIZER) | `processGateScan` with scoped event ids; GREEN → behaviour `GATE_CHECKED_IN` (the `userId` it passes is usually `null` because the result's ticket has no `attendee.id`/`userId` field). 200 when valid, 400 otherwise. |
| `getDynamicRotatingQR` (`:68`) | `GET /dynamic-qr/:ticketId` (any signed-in user) | Owner, Super Admin **or any GATE_STAFF** (not scoped to their events) may fetch the 30-second rotating legacy QR. |
| `getRecentScans` (`:111`) | `GET /recent-scans` | `GateScan` rows: staff see their own; organizers limited to their events; optional `eventId` (403 if outside scope). |
| `getEventGateStats` (`:162`) | `GET /stats/:eventId` | Scope check (403) → loads the event with **all** its tickets (including unpaid placeholders) → `totalTickets`, `admittedAttendees` (SCANNED), `pendingAttendees` (ACTIVE), `attendanceRate` string → counts `GateScan` rows by result (`validEntries`, `doubleEntryAttemptsBlocked`, `counterfeitOrExpiredRejected`). |
