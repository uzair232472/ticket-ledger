# Function catalogue — API authentication & accounts

[← Function catalogue index](README.md) · Module walkthrough: [Authentication & sessions](../02-modules/authentication.md) · Journeys: [Sign-up, login, reset](../03-journeys.md#journey-1--sign-up-verify-email-and-first-login)

Files: `apps/api/src/controllers/authController.js`, `apps/api/src/services/tokenService.js`, `apps/api/src/services/otpService.js`, `apps/api/src/services/accessService.js`, `apps/api/src/controllers/userController.js`.

Terms used here: **access token** = short-lived JWT (15 min) sent as `Authorization: Bearer …`; **refresh token** = random 48-byte string stored only as a SHA-256 hash in table `RefreshToken`, delivered as httpOnly cookie `tl_refresh` scoped to path `/api/auth`; **OTP** = one-time 6-digit code (table `OtpCode`, only an HMAC is stored).

---

## `tokenService.js`

<a id="api-token-sha256"></a>
### `sha256(value)` — `services/tokenService.js:16`
Hex SHA-256 of a string. Used to hash refresh tokens (`issueRefreshToken`, `rotateRefreshToken`, `revokeRefreshToken`), staff invite tokens (`authController.findUsableInvite`, `staffController`) and in `userController.changePassword`.

### `signAccessToken(user)` — `:18`
Signs `{userId, role, typ:'access'}` with [`getJwtSecret()`](api-core.md#api-config-getjwtsecret), `expiresIn: '15m'`. Called by `authController.startSession` and `authController.refresh`.

<a id="api-token-verifyaccesstoken"></a>
### `verifyAccessToken(token)` — `:22`
`jwt.verify` (throws `TokenExpiredError` / `JsonWebTokenError`) and additionally throws if `typ !== 'access'` — this rejects old 7-day tokens issued before refresh tokens existed and pending-signup cookies. Called by `authenticateJWT` and `optionalAuth`.

### `cookieOptions()` — `:28` (private)
`{httpOnly:true, secure: production || sameSite==='none', sameSite: COOKIE_SAMESITE || 'lax', path:'/api/auth'}`. The `/api/auth` path means the browser sends the refresh cookie **only** to auth endpoints.

### `readCookie(req, name)` — `:40` (private) / `readRefreshCookie(req)` — `:50`
Manual parsing of the `Cookie` header (no `cookie-parser` dependency); returns the decoded value or `null`.

### `setPendingSignupCookie(res, userId)` — `:60`
Signs `{userId, typ:'pending_signup'}` for 24 h and sets cookie `tl_pending_signup`. Lets the same browser correct an unverified signup without being able to claim someone else's account (ownership is never taken from client-sent email/id — comment `:52-56`).

### `clearPendingSignupCookie(res)` — `:67` · `clearRefreshCookie(res)` — `:83`
Clear the respective cookies with matching options.

### `readPendingSignupUserId(req)` — `:72`
Verifies the pending-signup cookie; returns `userId` only if `typ === 'pending_signup'`, else `null` (errors swallowed).

<a id="api-token-issuerefreshtoken"></a>
### `issueRefreshToken(res, userId)` — `:90`
1. `crypto.randomBytes(48).toString('base64url')` → raw token.
2. **DB write:** `RefreshToken.create({userId, tokenHash: sha256(raw), expiresAt: now + 7 days})`.
3. Sets cookie `tl_refresh` (maxAge 7 days).
Called by `startSession` (login/verify/accept-invite) and `rotateRefreshToken`.

<a id="api-token-rotaterefreshtoken"></a>
### `rotateRefreshToken(req, res)` — `:107`
- **Trigger:** `authController.refresh` (`POST /api/auth/refresh`).
- **Out:** the `userId` when the session is valid and rotated, else `null`.
- **Steps:**
  1. No cookie → `null`.
  2. Look up by `tokenHash`; missing or past `expiresAt` → `null`.
  3. **Idle timeout:** if not revoked and `now - createdAt > 30 min` → revoke it and return `null`. Because every successful refresh creates a *new* row, `createdAt` of the current row is the time of the last refresh, so this measures inactivity.
  4. **Reuse detection:** if already revoked → if revoked more than 30 s ago (`ROTATION_GRACE_MS`) call `revokeAllRefreshTokens(userId)` (assumed token theft: every session of that user ends); either way return `null`. Within 30 s it is treated as two tabs refreshing at once.
  5. **Single winner:** `updateMany({id, revokedAt:null} → revokedAt=now)`; if `count === 0` another concurrent request already rotated it → `null`.
  6. `issueRefreshToken(res, userId)` and return `userId`.

### `revokeRefreshToken(raw)` — `:138`
Marks the row with that hash revoked (no-op if `raw` falsy). Used by `logout`.

<a id="api-token-revokeall"></a>
### `revokeAllRefreshTokens(userId)` — `:149`
Revokes every un-revoked refresh token of a user. **Callers:** `rotateRefreshToken` (reuse), `authController.refresh` (blocked user), `authController.resetPassword`, `adminService` user-status change (`adminService.js:198`, reached from `adminController.updateUserStatus`), `mlController.freezeUserAccount` (`:324`), `staffController.deactivateStaff` (`:321`). Access tokens already issued stay cryptographically valid up to 15 min, but `authenticateJWT` re-reads the user status on every request, so blocked users are stopped immediately.

---

## `otpService.js`

| Helper | Line | Behaviour |
|---|---|---|
| `generateCode()` | `:13` | `crypto.randomInt(0, 1_000_000)` padded to 6 digits (CSPRNG). |
| `hashCode(code)` | `:14` | HMAC-SHA256 keyed with the JWT secret. |
| `codeMatches(code, storedHash)` | `:15` | Constant-time comparison (`crypto.timingSafeEqual`) of hashes. |

### `otpCooldownRemaining(userId, purpose)` — `:24`
Latest `OtpCode` for the user+purpose; returns seconds until `createdAt + 60 s` (0 when allowed or no code exists). Used by `signup` path (via `updatePendingSignup`), `resendOtp`, `login`, `forgotPassword`.

### `getOtpTiming(userId, purpose)` — `:38`
Returns ISO strings `{otpExpiresAt, resendAvailableAt, serverTime}` for the OTP screen countdowns. A consumed or locked (≥5 attempts) code is reported as expiring *now*. With no code: `otpExpiresAt:null`, resend available now. Used by `signup`, `getPendingSignup`, `updatePendingSignup`; consumed by the web `VerifyOtp` page (`loadTiming`).

<a id="api-otp-issueotp"></a>
### `issueOtp(user, purpose)` — `:59`
1. Generate a code.
2. **Transaction:** mark all unconsumed codes for that user+purpose consumed (so older codes stop working) and create a new row `{codeHash, expiresAt: now+10 min}`.
3. `await sendOtpEmail({to, name, otpCode, purpose})` — this never throws; on SMTP failure the code is printed to the console in non-production.
Callers: `signup`, `updatePendingSignup` (email changed), `resendOtp`, `login` (unverified account), `forgotPassword`.

<a id="api-otp-consumeotp"></a>
### `consumeOtp(userId, purpose, code)` — `:83`
- **Out:** `{ok:true}` or `{ok:false, message}`.
- **Steps:** (1) newest unconsumed code for the user (none if `userId` is undefined — unknown emails get the same "expired" answer). (2) Missing / expired / attempts ≥ 5 → `OTP_EXPIRED`. (3) Wrong code → increment `attempts`; message "Incorrect code. N attempts left." or `OTP_EXPIRED` when none left. (4) Correct → conditional `updateMany({id, consumedAt:null})` so two concurrent requests cannot both succeed; `count===0` → `OTP_EXPIRED`.
- Callers: `verifyOtp`, `resetPassword`.

---

## `accessService.js`

<a id="api-access-getscopedeventids"></a>
### `getScopedEventIds(user)` — `services/accessService.js:10`
Returns the event ids a user may operate on: `null` (= unrestricted) for `SUPER_ADMIN`; all events of the owned company for `ORGANIZER`; assigned events (`StaffEventAssignment`) for `GATE_STAFF`; `[]` otherwise. Used by gate/check-in code and staff management (see [tickets, QR & gate](api-tickets-qr-gate.md) and [companies & staff](api-companies-staff.md)).

### `getOwnedCompanyId(userId)` — `:35`
Id of the company the user owns, or `null`. Ownership is always derived server-side, never from a client-sent `companyId`.

---

## `authController.js`

Private helpers (top of file):

| Helper | Line | Behaviour |
|---|---|---|
| Zod schemas | `:6-71` | `emailSchema` (trim, lowercase, email), `nameSchema` (2–50), `passwordSchema` (≥8, a letter, a digit), `codeSchema` (6 digits), `phoneSchema` (strips spaces/dashes, `03…` → `+923…`, must match `^\+923\d{9}$`), `signupSchema`, `pendingSignupUpdateSchema` (password optional/blank), `loginSchema`, `verifyOtpSchema`, `resendOtpSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `acceptInviteSchema`. |
| `ACCOUNT_TYPE_TO_ROLE` | `:23` | `customer→CUSTOMER`, `organizer→ORGANIZER`. Public signup can never create `GATE_STAFF` or `SUPER_ADMIN`. |
| `withCodeAlias(body)` | `:66` | Accepts legacy field `otpCode` as `code`. |
| `isBlocked(user)` | `:93` | `BLOCKED_STATUSES.includes(user.status)`. |
| `suspendedResponse(res)` | `:95` | **403** `{code:'ACCOUNT_SUSPENDED'}`. |
| `handleError(res, error, context)` | `:98` | `ZodError` → **400** with the first message and all errors; else logs and **500** "Server error during …". |
| `startSession(res, userId)` | `:145` | `buildAuthUser` + `issueRefreshToken` + `signAccessToken` → `{user, token}`. |
| `trackLogin(req, userId, method, email)` | `:151` | If the client sent `x-session-id` (or `body.sessionId`), links that anonymous behaviour session to the user (`behaviorService.attachSessionToUser`), then records a `LOGIN` behaviour event with `{method, email}`. Fire-and-forget (not awaited). See [behaviour module](../02-modules/behavior-analytics-ml.md). |
| `findPendingSignupUser(req)` | `:228` | User from the pending-signup cookie, only if still `PENDING_VERIFICATION`. |
| `noPendingSignup(res)` | `:235` | **401** `{code:'NO_PENDING_SIGNUP'}`. |
| `findUsableInvite(rawToken)` | `:522` | `StaffInvite` by `sha256(token)` incl. event & company; returns `null` unless `PENDING` and unexpired; an expired `PENDING` invite is updated to `EXPIRED` (DB write during a GET). |

<a id="api-auth-buildauthuser"></a>
### `buildAuthUser(userId)` — `:115` (exported)
Loads the user with `company` (owned) and `memberOfCompany` (staff employer) and returns the **session user object** used everywhere in the web app: `id, name, email, phone, role, status, walletAddress, city, emailVerifiedAt, createdAt, companyId, companyName, companyStatus, companyRejectionReason`. `companyStatus` is `NONE|PENDING|APPROVED|REJECTED|SUSPENDED` for organizers (so the web app can route them without an extra request) and `null` for other roles. Returns `null` if the user is gone.

<a id="api-auth-signup"></a>
### `signup` — `POST /api/auth/signup` (also legacy `POST /register`) — `:167`
- **Middleware:** `authRateLimiter`. **Caller:** web `AuthContext.signup` from `Signup.handleSubmit`.
- **In:** `{name, email, password, phone, accountType?, walletAddress?}`.
- **Steps:**
  1. If this browser already has a pending (unverified) signup cookie → delegate to `updatePendingSignup` (prevents a second account).
  2. Validate with `signupSchema` (normalises email and phone).
  3. If a wallet address was sent and another user has it (lower-cased) → **400**.
  4. Email or phone already used → **409** (`EMAIL_EXISTS` or "phone already exists").
  5. `bcrypt.hash(password, 10)`; **create `User`** with `role` from `accountType`, `status: PENDING_VERIFICATION`.
  6. `issueOtp(user, 'VERIFY_EMAIL')` (DB + email), set pending-signup cookie, `trackLogin(... 'REGISTRATION_PENDING_OTP')`.
  7. **201** `{requiresOtp:true, data:{email, otpExpiresAt, resendAvailableAt, serverTime}}`. **No session is issued** until the email is verified.
- **Failure:** Prisma unique violation `P2002` (race) → **409**; Zod → **400**; else **500**.

### `getPendingSignup` — `GET /api/auth/pending-signup` — `:245`
Returns `{name, email, phone, accountType}` + OTP timing for the cookie's pending user, else **401** `NO_PENDING_SIGNUP`. Callers: web `Signup` (restore form on mount) and `VerifyOtp.loadTiming`.

### `updatePendingSignup` — `PATCH /api/auth/pending-signup` — `:270`
1. Requires a pending user from the cookie (else 401).
2. Validates (password may be blank = keep current).
3. Rejects email/phone already used by **other** users (409).
4. If the email changes and the 60 s cooldown has not passed → **429** with `retryAfter`.
5. **Updates `User`** (name, email, phone, role, optional new password hash; clears `emailVerifiedAt` if email changed).
6. Email changed → `issueOtp` to the new address (cancels the old code). Re-sets the cookie.
7. **200** `{requiresOtp:true, data:{email, emailChanged, …timing}}`. `P2002` race → 409 naming phone or email.

<a id="api-auth-verifyotp"></a>
### `verifyOtp` — `POST /api/auth/verify-otp` (legacy `/otp/verify`) — `:334`
1. Validate `{email, code}` (purpose fixed to `VERIFY_EMAIL`).
2. Blocked user → 403 suspended.
3. `consumeOtp(user?.id, 'VERIFY_EMAIL', code)`; failure → **400** with the message.
4. **Update `User`:** set `emailVerifiedAt` (if not set) and `status: ACTIVE` if it was pending.
5. `trackLogin(… 'EMAIL_OTP_VERIFIED')`, clear pending cookie, `startSession` (refresh row + cookie + access token).
6. **200** `{data:{user, token}}`. Caller: `AuthContext.verifyOtp` (applies the session) from `VerifyOtp.handleVerify`.

### `resendOtp` — `POST /api/auth/resend-otp` (legacy `/otp/send`) — `:366`
Eligible = user exists, not blocked, and (purpose is `RESET_PASSWORD` **or** the account is still pending). Eligible + cooldown active → **429** `retryAfter`; eligible → `issueOtp`. Everyone (eligible or not) receives the same **200** generic message, so the endpoint does not reveal which emails exist. Callers: `VerifyOtp.handleResend`, `ResetPassword.handleResend`.

<a id="api-auth-login"></a>
### `login` — `POST /api/auth/login` — `:399`
1. Validate `{email, password}`.
2. Load user; `bcrypt.compare` (skipped if no user). Unknown email and wrong password give the same **401** `Invalid email or password.`.
3. Blocked → **403** `ACCOUNT_SUSPENDED`.
4. `PENDING_VERIFICATION` → send a fresh OTP unless one was sent in the last 60 s, set the pending-signup cookie (the correct password proves ownership), **403** `{needsVerification:true, data:{email}}`. The web `Login` page redirects to `/verify`.
5. `trackLogin(… 'PASSWORD')`, `startSession`, **200** `{data:{user, token}}`.

<a id="api-auth-refresh"></a>
### `refresh` — `POST /api/auth/refresh` — `:438`
- **Trigger:** web `AuthContext.refreshSession` — on page load (session restore), ~1 minute before access-token expiry, and when any API call returns `TOKEN_EXPIRED`.
- **Steps:** `rotateRefreshToken` → no user id → clear cookie, **401**. `buildAuthUser`; missing or blocked user → revoke all tokens, clear cookie, **403** suspended / **401**. Else **200** `{data:{user, token: signAccessToken(user)}}`.
- No middleware: the httpOnly cookie is the credential.

### `logout` — `POST /api/auth/logout` — `:462`
Revokes the cookie's refresh token, clears the cookie, **204**. Callers: `AuthContext.logout`, `AuthContext` idle sign-out and startup idle check.

### `forgotPassword` — `POST /api/auth/forgot-password` — `:475`
If the user exists, is not blocked and the cooldown allows, `issueOtp(user,'RESET_PASSWORD')`. Always **200** with the generic message. Caller: `ForgotPassword.handleSubmit`.

### `resetPassword` — `POST /api/auth/reset-password` — `:493`
Validate `{email, code, newPassword}` → blocked check → `consumeOtp(…'RESET_PASSWORD')` → **update `User`** (new bcrypt hash; marks email verified and activates a pending account, since receiving the code proves the inbox) → `revokeAllRefreshTokens` (signs out every device) → **200**. Caller: `ResetPassword.handleSubmit` (then navigates to `/login`).

### `getInvite` — `GET /api/auth/invite/:token` — `:541`
`findUsableInvite`; unusable → **410** `INVITE_INVALID`; else `{email, eventName, eventDate, venue, companyName}`. Caller: `AcceptInvite` mount effect.

<a id="api-auth-acceptinvite"></a>
### `acceptInvite` — `POST /api/auth/accept-invite` — `:565`
1. Validate `{token, name, password}`; `findUsableInvite` (410 if unusable).
2. The invited email already has an account → **409** `INVITE_EMAIL_TAKEN`.
3. **Transaction:** conditional `staffInvite.updateMany({id, status:'PENDING'} → ACCEPTED)` (single-use; `count===0` → abort with `null`), **create `User`** `{role: GATE_STAFF, status: ACTIVE, emailVerifiedAt: now, companyId: invite.companyId}`, **create `StaffEventAssignment`** for the invite's event.
4. `null` → 410. Else `trackLogin(…'STAFF_INVITE_ACCEPTED')`, `startSession`, **201**.

### `getMe` — `GET /api/auth/me` — `:618`
`authenticateJWT` → `buildAuthUser(req.user.id)`. Caller: `AuthContext.refreshUser` (used by `CompanyRegistration` after registering a company).

### Role test routes — `routes/authRoutes.js:47-61`
Four inline handlers (`/role-test/admin|organizer|staff|customer`) that echo `req.user` after `requireRole`. Used only by the HTTP test scripts (`test_auth.mjs`); not called by the web app.

---

## `userController.js` — profile & account settings (`/api/users/*`, all behind `authenticateJWT`)

### `getProfile` — `GET /api/users/profile` — `:30`
Loads profile fields + owned company summary. Builds role stats: CUSTOMER `{ticketCount, orderCount}`; ORGANIZER `{companyStatus, eventsHosted}`; GATE_STAFF `{totalScans}` (counts **`GateScan`**, the legacy scan table — scans made through the newer `/api/checkin` path are recorded in `CheckIn` and are **not** counted here); SUPER_ADMIN `{totalUsers, pendingCompanies}`. Then for every role overwrites/adds `ticketCount` (non-cancelled tickets) and `orderCount`. Returns `{profile, stats}`. Caller: web `Profile` page.

### `updateProfile` — `PUT /api/users/profile` — `:117`
Validates optional `name` (≥2), `phone`, `city` (phone is **not** normalised or uniqueness-checked here; a duplicate phone triggers a Prisma unique error → 500). Updates `User`; creates a `PROFILE_UPDATED` **Notification** (which is also emailed by the [Prisma extension](api-core.md#api-config-emailnotifications)) and an **AuditLog** row. Returns the updated user.

### `changePassword` — `PUT /api/users/password` (rate-limited) — `:199`
Validates current/new (new must differ). Wrong current password → **400**. Updates the hash, then revokes every refresh token **except** the one in this request's cookie (`tokenHash: {not: sha256(current)}`) — note the cookie is path-scoped to `/api/auth`, so on a normal browser request to `/api/users/password` the cookie is **not sent**, `current` is `null`, and **all** sessions including the current one are revoked (inferred from the cookie `path`; the current tab keeps working until its access token expires or its next refresh fails). Creates `PASSWORD_CHANGED` notification + audit log. Caller: `components/account/ChangePasswordCard.jsx`.

### `updateWallet` — `PUT /api/users/wallet` — `:236`
Validates `0x` + 40 hex (or empty/null to unlink). Lower-cases; rejects an address linked to another user (**400**). Updates `walletAddress`; writes audit log `WALLET_CONNECTED|WALLET_DISCONNECTED`; tracks behaviour `WALLET_CONNECTED`; creates a `WALLET_UPDATED` notification. Caller: web `pages/Profile.jsx:293` (wallet section).

### `updateNotifications` — `PUT /api/users/notifications` — `:332`
Updates `emailNotifications`, `pushNotifications`, `smsNotifications` booleans. `emailNotifications=false` stops the automatic notification emails. Any error → 400 with the raw message.

### `getAccountHistory` — `GET /api/users/history` — `:364`
Latest 20 `AuditLog` rows of the user.

---

## Small helpers (config/auth.js)
| Helper | Line | Behaviour |
|---|---|---|
| `MESSAGES.OTP_INCORRECT(left)` | `config/auth.js:34` | "Incorrect code. N attempt(s) left." (singular when 1). Used by `consumeOtp`. |
| `MESSAGES.OTP_COOLDOWN(seconds)` | `config/auth.js:36` | "Please wait N seconds before requesting a new code." Used by `resendOtp`, `updatePendingSignup`. |
