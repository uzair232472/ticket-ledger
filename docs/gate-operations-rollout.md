# Gate operations: rollout and rollback runbook

Covers the gate-operations improvement phases. Each phase adds its own section.

## Phase 1: device identity and socket authentication

### What changes

- **Device tokens.** Scanners enroll with `POST /api/checkin/devices/enroll` (signed-in staff with `gate.scan` for
  the event) and receive a random token. Only its SHA-256 is stored (`GateDevice.tokenHash`). The token is sent as
  `X-Device-Token` with the device id on `scan`, `sync`, `pack` and `heartbeat`. On the scanner it is kept
  encrypted (non-extractable AES-GCM key) in the IndexedDB database `tl-gate-cred`. The offline scan database
  `tl-gate` is not touched in this phase.
- **Device id required** on scan, sync, pack and heartbeat in every mode. Omitting it used to skip the revocation
  check. Every deployed scanner already sends it.
- **Revocation** deletes the device's token hash. A revoked scanner deletes its ticket list and credential but
  **keeps** scans that had not uploaded yet (previously it deleted them). Uploading those for supervisor review
  (quarantine) arrives with the sync phase; until then they stay on the device.
- **Supervisor actions:** Gate management → Devices shows each device's credential state, rejected-credential
  count and "Reset enrollment". A reset needs a reason and is audited; the device re-enrolls automatically.
- **`POST /api/gate/scan` is retired (410).** The web app did not call it any more. `GET /api/gate/dynamic-qr`,
  `/api/gate/stats` and `/api/gate/recent-scans` are read-only and still served.
- **Sockets** accept the access token (`auth: { token }`). `user_<id>` rooms only take that user, event rooms
  only take members with gate access, and exception requests go to an `event_<id>_supervisors` room. Users are
  taken out of event rooms when their access changes. Notifications are no longer broadcast to every socket.
  Anonymous sockets still receive public seat-map broadcasts.

### Flag

| `GATE_DEVICE_AUTH` | Behaviour |
|---|---|
| `warn` (default) | Enrolled devices must use their token. Devices that never enrolled still work by id, and each request is counted (`legacyRequests`). |
| `enforce` | A token is required. Un-enrolled devices get `401 DEVICE_ENROLLMENT_REQUIRED`. |
| `off` | Emergency rollback: tokens are ignored. The device id and revocation are still enforced. |

`GATE_DEVICE_AUTH_DEADLINE` (default `2026-12-31T23:59:59Z`): from this moment `warn` and `off` behave as
`enforce`, so the unauthenticated path cannot stay open by accident. Unknown flag values also mean `enforce`. The
API logs the effective mode at startup.

### Deployment order

1. Back up the database.
2. `npm run prisma:deploy` applies the additive migration `20261118120000_gate_device_tokens` (new nullable or
   defaulted columns plus one unique index; no data rewritten).
3. Deploy the API with `GATE_DEVICE_AUTH=warn`. Already-deployed scanners keep working unchanged. This is covered
   by `test_helpdesk_gates.mjs`, which drives un-enrolled scanners.
4. Deploy the web app. Each scanner enrolls silently the next time it is online.
5. Watch Gate management → Devices: the header line counts devices that have not enrolled yet.
6. When no active device is still using the legacy path, set `GATE_DEVICE_AUTH=enforce` before the deadline. If
   it isn't set, the deadline enforces anyway.

### Rollback

- **Scanners locked out after enforcement:** set `GATE_DEVICE_AUTH=warn` (before the deadline) or `off`, then
  restart the API. No data changes are needed.
- **One device stuck** (for example its browser data was cleared and it shows "credential is missing"): a
  supervisor clicks Reset enrollment.
- **Web app rollback:** the previous web build works against the new API in `warn` or `off` mode (it sends the
  device id without a token). The `tl-gate-cred` IndexedDB database is simply unused by it.
- **API rollback to before this phase:** set `GATE_DEVICE_AUTH=off` and deploy the previous API. The added columns
  are ignored by the old code, so the migration can stay. Only if the columns must go, run
  `prisma/rollbacks/20261118120000_gate_device_tokens.down.sql`, then
  `npx prisma migrate resolve --rolled-back 20261118120000_gate_device_tokens`. Issued tokens are discarded and
  devices re-enroll after the next upgrade.

### Known limits

- A browser can't prove it is the same physical device. Someone with valid staff credentials can enroll a fresh
  browser profile as a new device. Revocation stops a specific enrolled device. To stop a person, remove their
  staff access.
- The client-side encryption protects a copied or exported storage record. It does not protect against code
  running in the page (XSS) or a fully compromised device. Server-side revocation covers those cases.

## Phase 2: durable offline scan records

### What changes

- Every scan decided on the device is written to IndexedDB `tl-gate-scans` (store `scans`) **before** its verdict
  is shown. Writes use strict durability where supported. If the write fails, the verdict is red ("could not save
  the scan; do not admit").
- Each record holds:
  - scan id (UUID v4; the same id is sent with the online attempt and reused if that attempt fails)
  - per-device sequence number, device id, event, ticket, gate id and name, direction
  - device time (kept as evidence), the device's verdict and reason, the staff member, app version
  - sync state, attempts, last error, and the server's acknowledgement
- Sync states: `PENDING → UPLOADING → SYNCED | CONFLICT`. A connection, server or credential failure returns the
  batch to `PENDING`. A request refused as invalid marks it `FAILED`; it is kept and can be retried with "Retry
  failed". A page closed mid-upload leaves `UPLOADING`, which is put back to `PENDING` before the next upload.
- One uploader at a time across tabs (Web Locks). Scans go oldest sequence first, 200 per request.
- The scanner asks the browser for persistent storage. "Scans on this device" shows whether it was granted, the
  records with their state and failure reason, Upload now, Retry failed and Export (JSON).
- Retention: `SYNCED` records are removed after 30 days. Pending, uploading, failed and conflict records are
  never pruned.

### Migration of the old queue (backup, verify, then delete)

Runs every time the scanner opens:

1. Old queue items (`tl-gate` / `queue`) not yet in the new store are snapshotted into `tl-gate-scans/backups`
   with a SHA-256 checksum, and copied into `scans` in **one** transaction.
2. The copy is read back and compared field by field with the snapshot, and the snapshot's checksum is
   re-computed. The result is stored in `meta['migration:last']`. If it can't be verified, the scanner shows a
   warning and nothing is removed.
3. **The migration deletes nothing.** An old queue item is removed only after the server acknowledged that scan
   (`SYNCED` or `CONFLICT`).

### Rollback

- `tl-gate` stays at IndexedDB version 1, so the previous scanner build still opens it.
- Every scan not yet processed by the server is mirrored into the old `queue` store. A rolled-back scanner
  therefore uploads exactly the unprocessed scans, and nothing already acknowledged is uploaded again.
- The new database is ignored by the old build and is picked up again after re-deploying.
- If a device needs manual recovery, "Export (JSON)" downloads its scans, the backups and the migration result.
- The mirror is written right after the record itself (best effort). If the browser dies between the two writes,
  that one scan is only in the new store until the new build runs again.

No server or database changes in this phase. The server ignores the extra upload fields (`seq`, `ticketId`,
`deviceScannedAt`, `clientScanId`) until Phase 3 stores them.

## Phase 3: idempotent synchronization

### What changes

- **One record per scan per device.** `CheckIn` stores the scanner's scan id (`clientScanId`), the device
  (`deviceRecordId` = `GateDevice.id`), its sequence number, its clock reading as sent and its own verdict.
  `@@unique([deviceRecordId, clientScanId])` plus one transaction per scan means:
  - the ticket change, the `CheckIn` and its `GateScan` row are written together or not at all;
  - a repeated upload (retry, lost response, two requests at once) rolls back and gets the first result
    (`ALREADY_PROCESSED`);
  - the same id from another device is a separate scan.

  Online scans send the same id, so an online attempt whose response was lost and its offline fallback are one
  scan.
- **Per-scan acknowledgements** from `POST /api/checkin/sync`: `ACCEPTED`, `ALREADY_PROCESSED`, `REJECTED`
  (unreadable; stored in `QuarantinedScan` with reason `INVALID`) or `RETRY` (server error on that scan only).
  The response also carries `lastAckedSeq`, kept on the device as `GateDevice.lastSeqAcked`. One bad scan no
  longer fails the batch.
- **Ordering and clocks.** Scans are processed in device sequence order (device clock only for older scanners).
  A device time in the future is replaced by receipt time; the raw reading is kept in `deviceScannedAt`.
  **"Earliest offline admission wins" is removed:** an offline admission of a ticket already used is logged and
  flagged as a conflict and never rewrites the recorded check-in (Decision 1).
- **Evidence (Decision 2).** `POST /api/checkin/evidence` (signed in only): a revoked device, or staff who lost
  the event, hand in the scans they still hold. They are stored as `QuarantinedScan` (`DEVICE_REVOKED` /
  `ACCESS_REMOVED`), audited, idempotent, and never admit anyone. The scanner does this automatically when it is
  revoked and marks those scans `QUARANTINED`.
- **Reversal (Decision 5).** `GateScan` rows are no longer deleted: they get `reversedAt`, `reversedById` and
  `reversalReason`, and are left out of organizer turnout and `/api/gate/stats` admitted counts.
- **Exception approval** is one transaction with conditional updates. Two supervisors approving at once, or a
  scan changing the ticket meanwhile, gives `409` instead of a double admission.
- **Client.** Automatic uploads back off after consecutive failures (30 s doubling to 10 min, ±20 % jitter).
  "Upload now" and the connection coming back skip the wait.
- **Rate limit** on `/sync` and `/evidence`: 120 requests per minute per user in production.

### Deployment and rollback

- Migration `20261118140000_gate_sync_idempotency` is additive: new nullable columns, one table, two enums and
  indexes. Existing rows have no scan id and are not constrained (NULLs are distinct).
- Older scanners (Phase 1 build or earlier) keep working. Their queue items always carried `clientId`, so their
  re-sent batches become idempotent too. They ignore the new `status` field, so a rejected scan simply leaves
  their queue: it is kept on the server in quarantine.
- Rolling back the API: the previous API ignores the new columns. Note that it would delete `GateScan` rows on
  reversal again. Removing the columns is only needed with
  `prisma/rollbacks/20261118140000_gate_sync_idempotency.down.sql`. Export `QuarantinedScan` first, and delete
  reversed `GateScan` rows first if counts matter.
- Expected log noise: when two uploads of the same scan race, Prisma logs a `Unique constraint failed on
  (deviceRecordId, clientScanId)` error for the losing transaction. That is the protection working: the request
  answers `ALREADY_PROCESSED`.

## Phase 4: multi-device conflict detection and resolution

### Business rules (`apps/api/src/services/scanConflictService.js`)

1. The server's ticket state is authoritative for attendance. A conflicting offline scan never changes the ticket:
   attendance is counted once, presence is not moved, and a refunded ticket stays refunded.
2. Device clocks are evidence only. The scan already applied on the server stays the recorded check-in.
3. Every scan is kept, including the earlier admission it conflicts with. Both are linked to the conflict
   (`CheckIn.conflictId`).
4. Nothing is resolved automatically. A supervisor (`gate.supervise`) picks a decision allowed for the type and
   gives a reason of at least 10 characters. The decision is recorded once (conditional update; simultaneous
   attempts get `409`), audited as `GATE_CONFLICT_RESOLVED` with `ticketChanged: false`, and changes no ticket.
   Corrections use the existing audited tools (Check-ins → Reverse, exceptions).
5. While a conflict of a type is open for a ticket, further disagreeing scans join it
   (`GATE_CONFLICT_SCAN_ADDED`). After it is resolved, a new disagreement opens a new conflict.

### Detection

An offline scan the device decided GREEN that the server does not admit:

| Server verdict | Conflict type | Allowed decisions |
|---|---|---|
| Entry, ticket already used | `DUPLICATE_ADMISSION` | single entry · multiple entry (suspected fraud) · device error · dismissed |
| Cancelled, transferred, old QR, unpaid, event cancelled | `TICKET_INVALIDATED` | accept · reject · device error · dismissed |
| Re-entry not allowed or limit reached | `REENTRY_LIMIT` | accept · reject · device error · dismissed |
| Exit, ticket not inside or never entered | `ORDERING` | device error · dismissed |
| Anything else (wrong gate, unknown ticket) | `RULE_MISMATCH` | accept · reject · device error · dismissed |

Scans the device turned away are never conflicts. Server verdicts now carry a machine-readable `code` (for example
`ALREADY_USED` or `CANCELLED`), which is what the classification uses.

Each conflict stores an evidence snapshot taken at detection: the ticket state, both verdicts, and the prior
admission (device, gate, time, online or offline). Every scan shows its device, sequence number, gate, device
clock, receipt time and both verdicts.

### API and UI

- `GET /api/checkin/manage/events/:id/conflicts` (`?status`, `?type`, `?format=csv`),
  `GET …/conflicts/:conflictId`, and `POST …/conflicts/:conflictId/resolve { resolution, reason }`.
- Live stats include `openConflicts`. Supervisors receive `gate:conflict` and `gate:conflict-resolved` on the
  supervisors-only socket room.
- Gate management has a Conflicts tab: open or resolved list, scans with devices, gates and times, ticket state,
  decision form, history, and CSV export of open conflicts.

### Deployment and rollback

- Migration `20261118160000_gate_scan_conflicts` is additive: the `ScanConflict` table, three enums and
  `CheckIn.conflictId`. Rollback script: `prisma/rollbacks/20261118160000_gate_scan_conflicts.down.sql`. Export
  conflicts first.
- Behaviour change: an offline admission of a refunded or cancelled ticket is now labelled
  "Admitted offline, but the ticket is not valid (…)" and flagged (`conflict: true`). Before, it was logged RED
  with no flag.

## Phase 5: scanner diagnostics and operational recovery

### Device health (`apps/api/src/services/gateDiagnosticsService.js`)

Every 30 seconds the scanner's heartbeat now also reports: failed, stuck, conflict and pending counts, the oldest
unprocessed scan, its last scan, app version, whether the browser keeps the storage, its clock (the server works
out the difference), and the last upload problem. With what the server sees (last request, last upload, upload
log, rejected credentials, open conflicts), each device gets:

- **Connection:** `ONLINE`, `OFFLINE` (reported), `NOT_SEEN` (no heartbeat for 2 minutes) or `REVOKED`.
- **Health:**
  - `CRITICAL`: stuck scans (unprocessed for 15+ minutes or retried 5+ times); not seen for 10 minutes while
    holding scans; not enrolled under `enforce`; revoked while holding scans.
  - `ATTENTION`: failed uploads; open conflicts; an upload problem in the last 15 minutes; rejected credentials
    in the last 15 minutes; not enrolled (`warn`); ticket list older than 30 minutes; storage the browser may
    clear; clock off by more than 5 minutes.
  - `HEALTHY`: none of these.
- **Sync health:** `OK`, `BEHIND` (scans waiting) or `FAILING`.

Every upload request (sync or evidence) is logged in `GateSyncBatch` with counts by outcome, duration and error.
A problem becomes the device's `lastSyncError`; a clean upload clears it.

### Controls

- **Scanner:** "Test connection" (`GET /api/checkin/ping`, device-authenticated) shows latency, credential state
  and clock difference. It also shows recovered interrupted uploads, failed attempts and the next automatic
  retry, and an "Upload problem" badge.
- **Supervisor**, Gate management → Devices → Details & actions: Test connection, Upload now, Retry failed
  uploads, Show pending scans (`POST …/devices/:id/actions`). The request reaches the scanner over its user's
  socket room; the scanner does the work itself and the panel refreshes. Requests are audited
  (`GATE_DEVICE_ACTION_REQUESTED`), report whether the device was connected, and are refused for revoked devices.
- **Pending scans:** the scanner sends a list of its unprocessed scans (`POST /api/checkin/devices/manifest`, at
  most 200). The list holds no ticket codes.
- **Evidence review** (Gate management → Evidence): quarantined scans can be marked reviewed with a note
  (`GATE_QUARANTINE_REVIEWED`, `admitted: 0`). They never become admissions.

### Recovery scenarios

| Situation | What happens |
|---|---|
| Connection lost mid-upload, or server down | Batch goes back to PENDING; backoff retries; interrupted uploads are recovered under the upload lock; the server answers repeats `ALREADY_PROCESSED`. |
| Device restarts with pending scans | Records are durable; they are uploaded on the next start. |
| Scan stuck in the queue | Counted as stuck (15 min or 5 attempts): the device turns CRITICAL; a supervisor can ask it to upload or retry, and to send its pending list. |
| Upload keeps failing | Per-scan REJECTED (kept in quarantine) or RETRY; FAILED scans stay on the device, show in the failed-scans report and can be retried. |
| Device revoked while offline | Its credential is gone; on reconnect it is refused, deletes its ticket list and hands its scans in as evidence (quarantined, never admitted). |
| Two devices upload conflicting scans | A conflict for supervisor review (Phase 4). |
| Ticket changed before an offline scan reconnects | A `TICKET_INVALIDATED` conflict; the ticket is not changed. |

## Phase 6: Gate Management and scanner UI

- **Live → Gate operations dashboard** (`GET …/operations`, every 30 s and with live updates): registered,
  online, offline and not-seen devices; devices needing attention (critical count); scans waiting, stuck and
  failed; upload problems in the last hour; open conflicts; evidence to review; attendance; gate capacity
  against the current rate (busy gates); and the list of devices needing attention with their reasons. Tiles open
  the matching tab.
- **Devices:** health and connection column with the top reasons, and a details panel (refreshes every 10 s)
  showing:
  - the four actions;
  - status, last heartbeat, upload and scan; waiting, failed and stuck counts; oldest waiting scan;
  - conflicts, evidence, last acknowledged sequence, app version, storage, clock difference, ticket-list age;
  - the scans the device recorded;
  - the device's pending scans, the latest 50 uploads (problems highlighted), and the device's history.
- **Conflicts** (Phase 4) and a new **Evidence** tab.
- **Reports:** CSV downloads for device synchronization, failed scans, unresolved conflicts, device activity and
  recovery history (`GET …/reports/:kind?format=csv`; JSON without `format`), next to the existing attendance
  report.
- **Scanner:**
  - offline admissions say "Valid on this device (offline) · checked against the other gates when it uploads";
  - "Upload problem" badge; failed and conflict badges (Phase 2);
  - Test connection; recovery and backoff status;
  - supervisor requests are announced ("Supervisor … asked this device to upload now").

### Deployment and rollback

- Migration `20261118180000_gate_diagnostics` is additive: diagnostics columns on `GateDevice` and the
  `GateSyncBatch` table. Rollback script: `prisma/rollbacks/20261118180000_gate_diagnostics.down.sql`.
- Older scanners send the old heartbeat. The new fields are optional, so those devices simply show fewer
  diagnostics.
- `GateSyncBatch` grows by one row per upload request. Plan a retention job before large-scale use (not added
  yet).
