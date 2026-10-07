# Module: Authentication, sessions & roles

[← Modules](README.md) · Functions: [API auth & accounts](../functions/api-auth-accounts.md) · [web core (AuthContext, session)](../functions/web-core.md#srccontextauthcontextjsx--authentication-state) · Journeys: [1–2](../03-journeys.md#journey-1--sign-up-verify-email-and-first-login)

## Overview

Users sign up with name, e-mail, Pakistani mobile number and password, prove their e-mail with a 6-digit code, and then hold a **session** made of two tokens:

- an **access token** (JWT, 15 minutes) kept **only in browser memory** and sent as `Authorization: Bearer …`;
- a **refresh token** (random 48 bytes, 7 days) kept in an **httpOnly cookie** `tl_refresh` that JavaScript cannot read and that the browser sends only to `/api/auth/*`. The database stores only its SHA-256 hash and rotates it on every use.

Roles: `CUSTOMER`, `ORGANIZER` (public signup), `GATE_STAFF` (invite only), `SUPER_ADMIN` (script only). A blocked status (`SUSPENDED`, `BANNED`, `DEACTIVATED`, `FROZEN`, `BLACKLISTED`) stops every request immediately because the API re-reads the user on each call.

## Behind the scenes

### Sign-up and verification
1. `Signup.jsx` validates locally (`lib/validation.js`), then `AuthContext.signup` → `POST /api/auth/signup`.
2. `authController.signup` checks for an existing pending signup cookie (→ edit instead), validates with Zod (normalises e-mail to lower case and phone to `+923…`), rejects duplicates (409), hashes the password (bcrypt cost 10), creates the user as `PENDING_VERIFICATION`.
3. `otpService.issueOtp` cancels older codes and stores an **HMAC** of a CSPRNG 6-digit code (expires 10 min), then `emailService.sendOtpEmail` sends it (or prints it to the console in development when SMTP is not configured/fails).
4. A signed cookie `tl_pending_signup` (24 h) lets this browser correct the details (`PATCH /pending-signup`) without proving anything else.
5. `VerifyOtp.jsx` shows server-driven countdowns (`getOtpTiming`), then `POST /verify-otp` → `consumeOtp` (max 5 attempts, constant-time compare, single-use via conditional update) → user `ACTIVE` → `startSession` issues refresh cookie + access token.

### Login
`POST /login`: bcrypt compare (same 401 for unknown e-mail and wrong password) → blocked → 403 `ACCOUNT_SUSPENDED` → pending → new OTP (cooldown 60 s), pending cookie, 403 `needsVerification` → otherwise session. `trackLogin` links the anonymous behaviour session.

### Session restore, refresh and expiry
```mermaid
sequenceDiagram
  participant B as Browser (AuthProvider)
  participant API as /api/auth
  participant DB as RefreshToken table
  B->>B: page load: idle > 30 min? → POST /logout, stay signed out
  B->>API: POST /refresh (cookie tl_refresh)
  API->>DB: find by sha256(cookie)
  alt missing/expired/idle>30min/revoked
    API-->>B: 401 (clear cookie); reuse >30 s after rotation → revoke ALL sessions
  else valid
    API->>DB: conditional revoke (one winner) + create new row
    API-->>B: Set-Cookie new tl_refresh; {user, token}
  end
  B->>B: token in memory; timer = exp − 60 s → refresh again
  Note over B: any API call → 401 TOKEN_EXPIRED → interceptor refreshes once and retries
```

| Step | File → function |
|---|---|
| Restore on load | `AuthContext.jsx:113` startup effect → `refreshSession` (`:84`, single-flight) |
| Refresh endpoint | `authController.refresh` → `tokenService.rotateRefreshToken` → `issueRefreshToken` |
| Proactive refresh | `AuthContext.jsx:146` timer from `tokenExpiry` |
| Reactive refresh | `lib/session.js` `installAxiosInterceptor` / `installFetchInterceptor` on `401 TOKEN_EXPIRED` |
| Suspension | interceptors on `403 ACCOUNT_SUSPENDED` → `handleSuspended` → `/suspended` |
| Idle sign-out (client) | `AuthContext.jsx:156` activity listeners, 15 s checks, shared `localStorage.tl_last_active` |
| Idle sign-out (server) | `rotateRefreshToken` refuses a token whose `createdAt` (= last refresh) is > 30 min old |
| Logout | `AuthContext.logout` → `POST /logout` → `revokeRefreshToken` |
| Per-request check | `middlewares/auth.js authenticateJWT` (verify JWT `typ:'access'`, load user, block statuses) |
| Role gate | `requireRole(...)` (API), `ProtectedRoute` (UI only) |

### Password reset and change
- Forgot: `POST /forgot-password` always answers the same generic message; issues a `RESET_PASSWORD` OTP when eligible.
- Reset: `POST /reset-password` → `consumeOtp` → new hash → **revoke all refresh tokens** (every device signed out).
- Change while signed in: `PUT /api/users/password` (rate-limited) → checks current password → revokes refresh tokens other than the current cookie (but the cookie is path-scoped to `/api/auth`, so in practice the request carries none and all sessions are revoked; the current tab works until its next refresh).

### Gate-staff invites
Organizer → `POST /api/staff/invites` creates a `StaffInvite` with a hashed random token (72 h) and e-mails `FRONTEND_URL/invite/<token>`. `AcceptInvite.jsx` → `GET /invite/:token` → `POST /accept-invite` → transaction: invite PENDING→ACCEPTED (single use), create `GATE_STAFF` user (verified, `companyId` set), create `StaffEventAssignment` → session.

## Data changed

| Action | Tables |
|---|---|
| Signup | `User` (create), `OtpCode` (consume old + create), `BehaviorEvent` |
| Verify | `OtpCode` (attempts / consumedAt), `User` (status, emailVerifiedAt), `RefreshToken` (create) |
| Login | `RefreshToken`, `BehaviorEvent` (+ `OtpCode` if pending) |
| Refresh | `RefreshToken` (revoke + create) |
| Reset | `OtpCode`, `User`, `RefreshToken` (revoke all) |
| Invite accept | `StaffInvite`, `User`, `StaffEventAssignment`, `RefreshToken` |

## Security properties and gaps (observed)

| Property | Implementation |
|---|---|
| Token theft via XSS | Access token never in storage; refresh token httpOnly. |
| Refresh token replay | Rotation + reuse detection (revokes all sessions after 30 s grace). |
| Brute force | Rate limits per IP (auth 5/min in production; code checks 20/min); 5 attempts per OTP. |
| Account enumeration | Generic answers for forgot/resend; same login error. |
| Immediate bans | User re-read per request. |
| **Gaps** | Socket.IO rooms (`user_<id>`) are joined without authentication; `POST /api/notifications/test` lets any user notify any user id; development JWT secret fallback when `JWT_SECRET` is missing (refused in production); rate-limit counters are per process (in memory). |

## Failure behaviour

| Case | Result |
|---|---|
| SMTP down | OTP printed to server console (non-production); signup still succeeds. |
| Network error during refresh | State kept; next request retries. |
| Two tabs refresh at once | Single-flight per tab; across tabs the 30 s grace + one retry after 300 ms on startup. |
| Expired access token in a request | One silent retry; second failure surfaces to the page. |

## Worked example (fictional)

1. 10:00 Ali signs up (`ali@example.com`, `0300 1234567`) → user created `PENDING_VERIFICATION`, phone stored as `+923001234567`, OTP row (hash, expires 10:10), cookie `tl_pending_signup`.
2. 10:02 Ali types the wrong code twice → attempts 2 → "Incorrect code. 3 attempts left."
3. 10:03 correct code → user `ACTIVE`; `RefreshToken` row R1 (created 10:03); response `{user:{role:'CUSTOMER', companyStatus:null…}, token}` (exp 10:18).
4. 10:17 timer refreshes → R1 revoked, R2 created, new access token (exp 10:32).
5. Ali leaves the tab idle; at 10:48 (30 min after R2) the client check signs him out; even without the client, a refresh after 10:47 would be refused by the server.
