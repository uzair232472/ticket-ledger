# Module: Gate check-in (QR verification, offline scanning)

[← Modules](README.md) · Functions: [check-in service & controller](../functions/api-tickets-qr-gate.md#checkinservicejs--gate-verification-current) · [gateOffline](../functions/web-core.md#srclibgateofflinejs--scanner-offline-store-indexeddb-tl-gate) · [GateScanner page](../functions/web-pages.md#web-gatescanner-check) · Journey: [6](../03-journeys.md#journey-6--gate-scanning-online-and-offline)

## Overview

Gate staff (or the organizer/admin) open `/scanner`, choose an event they are assigned to and a gate, and scan passes with the phone camera or type the manual code. The server returns **GREEN** (admit), **YELLOW** (already used) or **RED** (invalid), and the screen fills with that colour, a tone and a vibration. Every scan is logged. When the network is down, the phone decides on its own from a downloaded **offline pack** and uploads the scans later; offline scanning locks after 2 hours without a connection.

## Behind the scenes (online scan)

```mermaid
sequenceDiagram
  participant Cam as QrCamera / manual input
  participant GS as GateScanner.check
  participant API as POST /api/checkin/scan
  participant SVC as checkinService.scan
  participant DB as PostgreSQL
  participant IO as Socket.IO
  Cam->>GS: decoded text (same code ignored for 2.5 s)
  GS->>API: {code, eventId, gate, deviceId} (6 s timeout)
  API->>API: authenticateJWT, role, canScan(user,event) via getScopedEventIds
  API->>SVC: scan(...)
  SVC->>DB: evaluate: manual code lookup OR verifyPass(Ed25519) → ticket → event → qrVersion → paid → event cancelled → status
  alt GREEN
    SVC->>DB: updateMany(id, status ACTIVE, qrVersion) → SCANNED, checkedInAt, checkedInById, gate
    alt 0 rows (someone else admitted first)
      SVC->>DB: evaluate again → YELLOW
    end
  end
  SVC->>DB: CheckIn row (+ GateScan mirror)
  SVC->>IO: ticket:checked-in → user_<holder>; checkin:stats → event_<id> + organizer
  API-->>GS: {result, reason, ticket:{type, seat, holder first name}, firstScan}
  GS->>GS: Verdict overlay, tone/vibration, markUsedLocally if GREEN
```

### Checks in order (`checkinService.evaluate`)
| # | Check | Verdict on failure |
|---|---|---|
| 1 | Manual code exists **or** pass format + Ed25519 signature valid | RED "No ticket has this code" / "Not a TicketLedger pass" / "signature check failed" |
| 2 | Ticket exists and pass event = ticket event | RED "not found" |
| 3 | Scanning for this event | RED "different event (name)" |
| 4 | Pass `qrVersion` = ticket `qrVersion` | RED "Old QR: this ticket was transferred" |
| 5 | Order `SUCCESSFUL` | RED "never paid for" |
| 6 | Event not `CANCELLED` | RED |
| 7 | Ticket not `CANCELLED` / `TRANSFERRED` / `RESOLD` | RED |
| 8 | Ticket not `SCANNED` | **YELLOW** "Already scanned at 7:42 PM, Gate B" |
| 9 | — | **GREEN** "Entry allowed" |

### Offline mode
| Step | File → function |
|---|---|
| Download pack (public key + all paid tickets with status, qrVersion, manual code) every 3 min while online | `GateScanner.refreshPack` → `GET /checkin/events/:id/pack` → `checkinService.eventPack`; stored with `savePack` (IndexedDB, tagged with the staff user id) |
| Network failure during a scan | `GateScanner.check` → `decideOffline` |
| Local verdict | `gateOffline.evaluateOffline` (WebCrypto Ed25519; same order of checks; device-local "used" list) |
| Queue | `enqueue({clientId, code, gate, scannedAt, localResult, localReason})` |
| Upload | `syncQueue` every 30 s and on reconnect, batches of 200 → `POST /checkin/sync` → `checkinService.syncOffline` |
| Server reconciliation | Sorted by `scannedAt`; earliest admission wins; a device that admitted an already-used ticket is flagged `conflict` and the earlier offline admission becomes the recorded check-in |
| Lock | `offlineTooLong()` > 2 h without a successful request |
| Revocation | `staff:access-revoked` socket event or a 403 → `wipeEvent` (pack, queue, local admissions removed) |

**Browsers without WebCrypto Ed25519:** `verifySignature` returns `null` and the offline check continues without signature verification (it still requires the ticket id to be in the pack and the qrVersion to match).

## Data
Writes: `Ticket` (status SCANNED, checkedInAt/By, gate), `CheckIn` (every scan; `ticketId` null for junk), `GateScan` (mirror for dashboards), `Ticket.manualCode` (pack build). Reads: `Ticket`, `Order`, `Event`, `Seat`, `TicketTier`, `User` (first name), `StaffEventAssignment`/`Company` (scope).

## Legacy scanner API
`/api/gate/*` (`gateController` + `qrTicketService.processGateScan`) verifies the old HMAC JSON passes and writes only `GateScan`; its admission is not conditional (race-prone) and payment is not checked. Not used by the web app.

## Failure behaviour
| Case | Behaviour |
|---|---|
| No camera / insecure origin | Friendly error; manual code input still works |
| Server says 403 (assignment revoked) | Wipe and lock event |
| Server error with response | RED with the server message |
| No response / timeout | Offline decision + queue |
| No pack and offline | RED "No connection and no offline list yet" |
| Same ticket at two gates simultaneously (online) | Conditional update → second gets YELLOW |
| Same ticket admitted on two offline devices | Both GREEN locally; on sync the later one is flagged `conflict` (counted in stats for the organizer) |

## Worked example (fictional)
Gate B, online: Omar's pass `TL1.T1.E1.2.<sig>` → GREEN "Omar · Front Rows · Row C · Seat 5" → `CheckIn GREEN`, ticket SCANNED 19:42 Gate B; Omar's wallet greys out; organizer dashboard turnout +1. 19:50 Hina shows her old screenshot `TL1.T1.E1.1.<sig>` → RED "Old QR: this ticket was transferred" (logged as RED with ticket id). 20:05 network drops; a friend's ticket T2 is scanned at Gate A (GREEN locally, queued) and at Gate C on another phone (GREEN locally). On reconnect both sync: Gate A (20:05:10) wins; Gate C (20:06) is stored YELLOW with `conflict: true`.
