# Function catalogue — API companies & gate staff

[← Function catalogue index](README.md) · Module walkthrough: [Companies, staff & roles](../02-modules/companies-staff.md)

Files: `apps/api/src/controllers/companyController.js`, `apps/api/src/controllers/staffController.js`.

**Background:** an `ORGANIZER` user owns at most one `Company` (`Company.userId` is unique). A Super Admin must approve the company before the organizer may create events. Gate staff (`GATE_STAFF`) are created only through email invites and belong to the inviting company via `User.companyId`; their per-event scanning rights live in `StaffEventAssignment`.

---

## `companyController.js` (`/api/companies`, all behind `authenticateJWT`)

<a id="api-company-registercompany"></a>
### `registerCompany` — `POST /api/companies/register` — `:25`
- **Middleware:** `requireRole('ORGANIZER','SUPER_ADMIN')`, `multer.memoryStorage()` single file field `document` (10 MB). **Caller:** `pages/CompanyRegistration.jsx:109` (multipart form).
- **Steps:**
  1. Zod-validate `{companyName, ownerName, phone (≥8), email, city, ntnCnic (≥5), documentUrl?}`.
  2. If a file was uploaded → [`uploadFile(req.file, 'company_docs')`](api-core.md#api-utils-uploadfile) (Cloudinary or `uploads/company_docs/`). No file and no `documentUrl` → placeholder path `/uploads/company_docs/sample_ntn_certificate.pdf` (that file is not created by this code).
  3. Existing company for this user: `APPROVED` → **400** (cannot re-submit); otherwise **update** all fields and reset to `PENDING`, clearing rejection/review fields. No company → **create** with `PENDING`.
  4. **Update `User.companyId`** to the company id (used later for staff and event ownership).
  5. **Notification** `ORGANIZER_REGISTRATION` (emailed by the Prisma hook) and **AuditLog** `COMPANY_SUBMITTED`.
  6. **201** `{company}`.
- **Failure:** Zod → 400; other → 500. The file type is **not** validated (any file up to 10 MB is accepted).

### `getMyCompany` — `GET /api/companies/my-company` — `:139`
Company of the caller with its events (`id, name, status, date`), or `company: null`. Callers: `CompanyRegistration.jsx:51` (status screen), `CreateEvent.jsx:167`.

### `getAllCompanies` — `GET /api/companies/admin/all?status=` — `:168` (SUPER_ADMIN)
Optional status filter (case-insensitive). Returns companies with owner user summary and `_count.events`, plus five separate `count` queries for tab badges. Caller: `pages/AdminCompanies.jsx:44`.

<a id="api-company-updatestatus"></a>
### `updateCompanyStatus` — `PATCH /api/companies/admin/:id/status` — `:225` (SUPER_ADMIN)
1. Validate `{status ∈ APPROVED|REJECTED|SUSPENDED, rejectionReason?}`; 404 if the company is missing.
2. `REJECTED` without a reason → **400**.
3. **Update** status, `rejectionReason` (only kept for REJECTED), `reviewedBy = admin email`, `reviewedAt`.
4. **Notification** `ORGANIZER_STATUS_UPDATE` to the owner with status-specific text; **AuditLog** `COMPANY_<STATUS>` with previous/new status.
- **Effect elsewhere:** organizer event creation (`requireApprovedOrganizer`), venue editing and staff invites check `status === 'APPROVED'`; `buildAuthUser.companyStatus` drives the web redirects. Suspending a company does **not** unpublish its events (no such code).
- Callers: `AdminCompanies.jsx:76, :104, :133` (approve, suspend, reject modal).

<a id="api-company-requireapprovedorganizer"></a>
### `requireApprovedOrganizer` — `:317`
Alias of [`requireApprovedCompany`](api-core.md) from `middlewares/auth.js` (kept for existing imports). Used by `POST /api/events` and `GET /api/companies/guard-check` (inline handler at `companyRoutes.js:34` that echoes `req.company`; only used by test scripts).

---

## `staffController.js` (`/api/staff`, all behind `authenticateJWT`)

Private helpers:

| Helper | Line | Behaviour |
|---|---|---|
| `inviteSchema`, `listSchema` | `:12`, `:17` | `{email (lower-cased), eventId}`; list filters `{eventId?, companyId?, status?}`. |
| `INVITE_INCLUDE` | `:23` | Prisma include for event, company, inviter. |
| `serializeInvite({tokenHash, …})` | `:30` | Removes `tokenHash` before sending to the client. |
| `handleError(res, error, context)` | `:32` | Zod → 400, else 500. |
| `resolveCompanyScope(user)` | `:44` | `null` for SUPER_ADMIN (all companies); otherwise the owned company id or `''` (matches nothing). |
| `canManageCompany(scope, companyId)` | `:49` | `scope === null \|\| scope === companyId`. |
| `newInviteToken()` | `:51` | 32 random bytes (base64url) → `{raw, hash: sha256(raw), expiresAt: now + 72 h}`. Only the hash is stored. |
| `sendInvite(invite, rawToken, inviter)` | `:56` | Calls `sendStaffInviteEmail`. |
| `expireStaleInvites(where)` | `:66` | `updateMany` PENDING invites past `expiresAt` → `EXPIRED` (lazy expiry on list). |

All endpoints are called from `components/StaffManager.jsx` through its `request(path, options)` helper (`:36`), which is embedded in `OrganizerDashboard` and `SuperAdminDashboard`.

<a id="api-staff-createinvite"></a>
### `createInvite` — `POST /api/staff/invites` — `:75` (ORGANIZER, SUPER_ADMIN)
1. Validate; load event + company (404 if missing).
2. **Ownership:** `canManageCompany(scope, event.companyId)` else **403** `INVITE_NOT_OWN_EVENT`. Organizer whose company is not approved → 403.
3. **Email already registered:**
   - not `GATE_STAFF` → 409 "already registered with another account type";
   - staff of another company → 409; `DEACTIVATED` → 409 (reactivate first); other non-ACTIVE → 409 (blocked by TicketLedger);
   - same-company active staff → **upsert `StaffEventAssignment`** and return 200 `{assignedExisting:true}` (no email).
4. New email → **transaction:** cancel any PENDING invite for the same email+event, create `StaffInvite` with the token hash.
5. Send the email (never throws) → **201** `{invite, emailSent}` with a message telling the organizer to resend if mail failed.

### `listStaff` — `GET /api/staff` — `:156`
Scope: organizer = own company; admin = optional `companyId` filter. Lazily expires stale invites, then in parallel loads invites (filtered by event/status) and GATE_STAFF users (filtered by company/assigned event) with their assignments. Returns `{staff, invites}`.

### `listInvitableEvents` — `GET /api/staff/events` — `:209`
Events in scope (ordered by date) and, for admins only, the list of companies that have events (for the filter dropdown).

### `resendInvite` — `POST /api/staff/invites/:id/resend` — `:244`
404/403 checks; only `PENDING` or `EXPIRED` invites; refuses if the email has since registered (409). Generates a **new** token (old link stops working because the stored hash changes), resets expiry to 72 h and status to PENDING, emails it.

### `cancelInvite` — `DELETE /api/staff/invites/:id` — `:281`
404/403; refuses `ACCEPTED` (409 — deactivate the account instead); sets `CANCELLED`; **204**.

<a id="api-staff-deactivate"></a>
### `deactivateStaff` — `PATCH /api/staff/:id/deactivate` — `:304`
Only `GATE_STAFF` users in scope. Sets `status = DEACTIVATED` (one of `BLOCKED_STATUSES`, so `authenticateJWT` rejects their requests immediately), **revokes every refresh token**, writes AuditLog `STAFF_DEACTIVATED`.

<a id="api-staff-revokeeventaccess"></a>
### `revokeEventAccess` — `DELETE /api/staff/:id/events/:eventId` — `:344`
Checks staff and event are both in scope. Deletes the `StaffEventAssignment` (200 with "wasn't assigned" if none). Writes AuditLog `STAFF_EVENT_ACCESS_REVOKED`, a `STAFF_ACCESS_REVOKED` notification, and emits Socket.IO **`staff:access-revoked` `{eventId}`** to room `user_<staffId>`. The open `GateScanner` page listens for it and wipes its offline pack (`GateScanner.jsx:283`). From then on `getScopedEventIds` no longer includes the event, so scans, packs and sync uploads for it are refused (see [check-in](api-tickets-qr-gate.md)).

### `reactivateStaff` — `PATCH /api/staff/:id/reactivate` — `:394`
Already ACTIVE → 200 no-op. Organizers may only undo `DEACTIVATED` (their own action); other blocked states need a Super Admin (409 otherwise). Sets `ACTIVE`, AuditLog `STAFF_REACTIVATED`, notification `STAFF_REACTIVATED`.

### `getMyGateEvents` — `GET /api/staff/my-events` — `:445` (GATE_STAFF, ORGANIZER, SUPER_ADMIN)
`getScopedEventIds(req.user)` → events in scope (all for admins) with display fields, ordered by date. Caller: `pages/StaffEvents.jsx:26` (the gate staff landing page).
