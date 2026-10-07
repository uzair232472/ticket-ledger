# Function catalogue — API notifications, email, push & contact

[← Function catalogue index](README.md) · Module walkthrough: [Notifications & email](../02-modules/notifications-email.md)

Files: `apps/api/src/services/notificationService.js`, `controllers/notificationController.js`, `services/fcmService.js`, `services/emailService.js`, `services/emailLayout.js`, `controllers/contactController.js`, plus the automatic email hook in [`config/prisma.js`](api-core.md#api-config-prisma).

> **Key fact:** there are two ways a notification is created.
> 1. **Directly** with `prisma.notification.create(...)` — used by almost every feature (21 call sites). This writes the row and, through the Prisma extension, emails it. It does **not** emit a Socket.IO event.
> 2. Through [`dispatchNotification`](#api-notif-dispatch) — used only by `adminService` (`:226`), `intentAnalyticsService` (`:321`, `:724`) and the `POST /api/notifications/test` endpoint. This writes the row (so it is emailed too), emits Socket.IO events and calls the **mock** FCM push.

---

## `notificationService.js`

`NOTIFICATION_TYPES` (`:6`) — ten string constants (`BOOKING_CONFIRMATION`, `PAYMENT_CONFIRMATION`, `TICKET_ISSUED`, `EVENT_REMINDER`, `TICKET_TRANSFERRED`, `RESALE_AVAILABLE`, `ORGANIZER_APPROVAL`, `ORGANIZER_REJECTION`, `FRAUD_ALERT`, `ABANDONED_CHECKOUT_REMINDER`). Most features use **other** type strings directly (e.g. `BOOKING_CONFIRMED`, `RESALE_TICKET_SOLD`, `EVENT_SUBMITTED` — full list in the [module page](../02-modules/notifications-email.md#notification-types-in-use)). `adminService.js:228` references `NOTIFICATION_TYPES.SYSTEM_ALERT`, which does not exist, so it falls back to the literal `'SYSTEM_ALERT'`.

<a id="api-notif-dispatch"></a>
### `dispatchNotification({userId, type, title, message, data = {}, sendEmail = true, sendPush = true})` — `:22`
- **Callers:** `notificationController.sendTestNotification`, `adminService` (user status change alert), `intentAnalyticsService.sendAttendeeReminder` / `sendAbandonedReminder` (organizer reminder buttons).
- **Steps:**
  1. Throws if `userId` is missing.
  2. Loads the user's `email, name, emailNotifications, pushNotifications`; throws if not found.
  3. **DB write:** `prisma.notification.create({userId, type, title, message, isRead:false})` → the Prisma hook schedules the email.
  4. **Socket.IO:** if `getIO()` returns a server, emits `notification` to room `user_<userId>` **and** broadcasts `notification_<userId>` to **all** connected clients (any client can listen to another user's channel name). Socket errors only log.
  5. Email channel: only *reports* `{success:true, via:'notification hook'}` when the user has email on; the actual sending happened in step 3's hook.
  6. Push channel: if `sendPush && user.pushNotifications`, awaits [`sendFCMPushNotification`](#api-fcm-send) (mock). Failures are caught into the summary.
  7. Returns `{notification, channels:{inApp, socket, email, fcm}}`.
- **Failure:** missing user / DB errors throw to the caller.

---

## `notificationController.js` (`/api/notifications`, all except preview behind `requireAuth`)

| Handler | Route | Behaviour |
|---|---|---|
| `getMyNotifications` (`:8`) | `GET /` | Query `limit` (default 30) and `page` (default 1). In parallel: page of the user's notifications (newest first), total count, unread count. Returns `{total, unreadCount, page, notifications}`. Callers: `pages/Notifications.jsx` (`limit=50`), `components/home/HeaderAccount.jsx` (`limit=3`), `components/home/HomeHeader.jsx` (`limit=1`, for the unread badge), unused `NotificationBell.jsx` (`limit=6`). |
| `markNotificationAsRead` (`:43`) | `PATCH /:id/read` | 404 if missing; 403 unless owner or `SUPER_ADMIN`; sets `isRead=true`. |
| `markAllNotificationsAsRead` (`:78`) | `PATCH /read-all` | `updateMany({userId, isRead:false} → true)`, returns the count. |
| `deleteNotification` (`:100`) | `DELETE /:id` | Same ownership check; deletes the row. |
| `registerFCMToken` (`:133`) | `POST /fcm-token` | Requires `fcmToken`; stores it in the **in-memory** map (`fcmService.registerDeviceToken`) and sets `User.pushNotifications=true`. No web caller (repository search). |
| <a id="api-notif-sendtest"></a>`sendTestNotification` (`:162`) | `POST /test` | Validates `type` against `NOTIFICATION_TYPES`; target = `body.targetUserId` **or** the caller. **No role check:** any signed-in user can send a test notification (and therefore an email) to any user id they know. Calls `dispatchNotification`. Caller: "Simulate notification" panel in `pages/Notifications.jsx:111`. |
| `previewEmailHTML` (`:199`) | `GET /preview-email?type=` (public) | Dynamically imports `emailService` and returns `generateEmailHTML` output with hard-coded sample data, as `text/html`. Linked from `pages/Notifications.jsx:257`. |

---

## `fcmService.js` — **mock push provider**

No Firebase SDK is installed (`apps/api/package.json` has no `firebase-admin`). Everything here is simulated.

| Function | Line | Behaviour |
|---|---|---|
| `registerDeviceToken(userId, fcmToken)` | `:9` | Adds the token to a process-local `Map<userId, Set<token>>`; returns `{success, totalTokens}`. Lost on restart. |
| `getUserDeviceTokens(userId)` | `:21` | Array of stored tokens. |
| <a id="api-fcm-send"></a>`sendFCMPushNotification({userId, token, title, body, data})` | `:29` | Picks `token` → first registered token → a random `fcm_mock_device_token_…`; builds an FCM v1-shaped payload (stringified `data`, Android/APNs options) and returns `{success:true, messageId:'projects/ticketledger-fyp/messages/fcm_<uuid>', status:'DELIVERED', fcmPayload}`. **No network call is made.** |

---

## `emailService.js`

Module state: `transporter` (lazy singleton), `lastSentEmail` (last message metadata, used by tests via `getLastSentEmail`), `isDevTransport` (true when mail goes to nodemailer's JSON transport). `dotenv.config()` is called at import (`:4`).

<a id="api-email-gettransporter"></a>
### `getTransporter()` — `:22`
Creates the nodemailer transport once:
- **Real SMTP** when `SMTP_HOST` is set and does not contain `mock`, `SMTP_USER` is set and not mock-like, and this is not a test run. A host containing `gmail` uses `service:'gmail'`; others use host/port (`SMTP_PORT` or 587)/`SMTP_SECURE`.
- Otherwise **`jsonTransport: true`** — messages are serialised in memory and never leave the machine; `isDevTransport = true`.
Used by every send function and `contactController`.

### `escapeHtml(value)` — `:69`
Replaces `& < > " '` with entities. Used by the Prisma email hook for user-written titles/messages.

### `generateEmailHTML({type, title, message, data, action})` — `:75`
Builds a notification email via `renderEmail`: label = type with spaces, body = `paragraph(message)` + a `factCard` of `data` entries (camelCase keys split into words, values escaped/JSON-stringified) + a `button` (`action` or "Open your tickets" → `/wallet`). Used by `sendEmailNotification` and `previewEmailHTML`.

<a id="api-email-sendemailnotification"></a>
### `sendEmailNotification({to, subject, type, title, message, data, action})` — `:94`
Generates HTML, sends with text fallback and the inline logo attachment, records `lastSentEmail`, returns `{success, messageId, preview}`. **Throws** on SMTP failure (the Prisma hook catches and logs it). Caller: [`emailNotifications`](api-core.md#api-config-emailnotifications) hook.

### `sendOtpEmail({to, name, otpCode, purpose})` — `:147`
Picks copy for `VERIFY_EMAIL` or `RESET_PASSWORD` (`OTP_EMAIL_COPY`, `:130`), renders a code panel, sends. On success logs; when using the dev JSON transport, prints `[LOCAL DEV OTP] … code … is: 123456` (non-production only). On SMTP failure it **does not throw**: logs a warning, prints the code (non-production) and returns `{success:true, fallback:true}`. Caller: [`issueOtp`](api-auth-accounts.md#api-otp-issueotp).

### `sendStaffInviteEmail({to, inviteToken, eventName, companyName, inviterName})` — `:215`
Builds `FRONTEND_URL/invite/<token>`, sends the invite email (72-hour, single-use wording), records `lastSentEmail` (including the raw token — used by test scripts), prints the link in dev, returns `{success}` or `{success:false, fallback:true}` without throwing. Caller: `staffController.createInvite` / `resendInvite`.

`getLastSentEmail()` (`:125`), `mailFrom()` (`:259`) — accessors. `MAIL_FROM()` (`:12`) prefers `MAIL_FROM`, `FROM_EMAIL`, `EMAIL_FROM`, then `"TicketLedger" <OFFICIAL_EMAIL>`. `FRONTEND_URL()` (`:14`) takes the first entry of `FRONTEND_URL`. `logForLocalDev(line)` (`:17`) prints only outside production.

---

## `emailLayout.js` — HTML building blocks (pure functions returning strings)

| Function | Line | Output |
|---|---|---|
| `logoAttachment()` | `:29` | Nodemailer attachment for `src/assets/email/tl-mark.png` with CID `tl-mark@ticketledger` (logo travels inside the email). |
| `frontendUrl()` | `:35` | First `FRONTEND_URL` entry without trailing slash. |
| `esc(value)` | `:37` | HTML escaping (same as `escapeHtml`). |
| `wordmark(size, home)` | `:40` | Logo + "Ticket**Ledger**" linked to the home page. |
| `tearLine()` | `:51` | Dashed "perforation" row. |
| `factCard(rows)` | `:57` | White card of label/value rows; `''` when no rows. Labels are escaped; **values are inserted as HTML** (callers escape them). |
| `button({label, url})` | `:75` | Green call-to-action button. |
| `codePanel(code, note)` | `:83` | Large monospace OTP panel. |
| `notice(html)` | `:92` | Green left-bordered note. |
| `paragraph(html)` | `:97` | Styled `<p>`. |
| `renderEmail({preheader, label, title, body, footnote})` | `:103` | Full table-based email document (inline styles only for Gmail/Outlook compatibility): hidden preheader, header logo + label, dark-green banner with `title` (inserted as HTML), body, footnote, footer. |

Used by `emailService`, `contactController`, and `ticketPdf`/other mailers if any (search shows `emailService.js` and `contactController.js` only).

---

## `contactController.js`

### `sendContactMessage` — `POST /api/contact` — `:28`
- **Middleware:** `contactRateLimiter`, `optionalAuth`. **Caller:** `pages/Contact.jsx` form.
- **Steps:** Zod-validate `{name (2–80), email, topic ∈ BOOKING|PAYMENT|ORGANIZER|ACCOUNT|OTHER, message (10–3000)}` → render an email with a fact card (adds "Signed in as" when `req.user` exists) → send to `SUPPORT_EMAIL` or the official address with `Reply-To` set to the sender. No confirmation email is sent to the typed address (comment `:23-26`: prevents using the form to email strangers).
- **Failure:** validation → 400; send failure → **502** "We couldn't send your message right now".
- **Note:** with the dev JSON transport the "send" always succeeds locally and nothing is delivered.

## Small helpers
| Helper | Line | Behaviour |
|---|---|---|
| `supportInbox()` | `contactController.js:21` | `SUPPORT_EMAIL` env or the official address; destination of contact-form e-mails. |
