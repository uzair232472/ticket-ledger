# Email readiness before genuine customer communication (R0 review, 2026-11-22)

Reviewed: `apps/api/src/services/emailService.js`, `otpService.js`, `notificationService.js`, `broadcastService.js`,
`recoveryService.js`, `config/brand.js`, `.env.example`. **Nothing was changed by this review**; it lists what
must be done before invited real users receive e-mail. No e-mail was sent while preparing it.

**Status (R0 closure, 2026-11-22):** open. E1–E3 (blocking) and E4–E7 (high) must be completed before the
real-user beta (platform-readiness-plan.md R4). Nothing here has been changed yet.

## How e-mail works today

- **One sender:** `emailService.js`, using nodemailer.
- **Transport choice:**
  - real SMTP when `SMTP_HOST` and `SMTP_USER` are set and not "mock" (Gmail through `service: 'gmail'`,
    anything else through host/port);
  - otherwise nodemailer's in-memory JSON transport, which sends nothing;
  - automated test runs (`NODE_ENV=test` or the Node test runner) never use real SMTP.
- **From address:** `MAIL_FROM`, then `FROM_EMAIL` or `EMAIL_FROM`, else a default built from a Gmail address
  hard-coded as `OFFICIAL_EMAIL` in `config/brand.js`.
- **Message types:**
  - OTP codes (sign-up, password reset);
  - staff and organization invites;
  - notification e-mails (tickets, refunds, event changes and others; they respect the user's notification
    preferences in `notificationService.js`);
  - admin broadcasts (optionally e-mailed);
  - automatic abandoned-checkout reminders (organizations that opted in).
- **Sending:** inline in the request or job, with no queue and no retry. Failures are logged.

## What remains before genuine customer e-mail

| # | Item | Why | Severity |
|---|---|---|---|
| E1 | **Sending domain.** A TicketLedger domain with SPF, DKIM and DMARC, sent through a transactional provider (or the domain's own mail service). Set `MAIL_FROM` to an address on that domain | A personal Gmail account is the default sender today. Gmail limits sending per day (the code already notes "550 5.4.5 Daily user sending limit exceeded"), and mail from an unauthenticated or mismatched domain lands in spam or is rejected under DMARC | Blocking |
| E2 | **Remove the hard-coded personal address** as the default sender and contact address in `config/brand.js`; production should refuse to start without `MAIL_FROM` | A personal address in source is shown to customers and used whenever the setting is missing | Blocking |
| E3 | **Development must not send real mail.** `apps/api/.env` currently holds real Gmail SMTP credentials. Use a sandbox inbox (Mailtrap, Ethereal) or the mock values in development; keep real credentials only in the production secret store | Any locally started server sends real e-mail to whatever addresses the database holds, including from background jobs (reminders, broadcasts). `scripts/test-server-suites.sh` overrides this, but a plain `npm run dev` does not | Blocking |
| E4 | **OTP delivery failures must be visible.** `sendOtpEmail` returns `success: true, fallback: true` when SMTP fails, and `issueOtp` ignores it, so the customer is told a code was sent | Invited users would be stuck at sign-up with no error; support cannot tell why | High |
| E5 | **A send queue with retries** for transactional mail (tickets, receipts, refunds, event changes), with failure alerts to admins | Today a failed send is only logged. A ticket or refund e-mail that fails is lost | High |
| E6 | **Bounce and complaint handling** (provider webhooks): mark addresses that bounce hard or complain, stop sending to them, and show this to admins | Repeated sends to bad addresses harm the domain's reputation | High |
| E7 | **Unsubscribe for non-transactional mail** (broadcasts, abandoned-checkout reminders): an unsubscribe link and `List-Unsubscribe` / one-click headers, honoured by the notification preferences | Required by bulk-sender rules of large mailbox providers, and by law in many places. Transactional mail (tickets, receipts, OTP) stays exempt | High |
| E8 | **Consent and frequency for reminders:** only customers who allowed marketing-type messages get abandoned-checkout reminders; a cap per customer | Reminders are commercial messages | Medium |
| E9 | **Links:** set `FRONTEND_URL` to the production web address. E-mail text falls back to `http://localhost:5173` when it is missing | Broken links in real e-mail | Medium (configuration) |
| E10 | **Test hooks:** `getLastSentEmail()` keeps the last OTP code in memory. It is not exposed by any route today; remove it, or make sure it can never be, in production | Defence in depth | Low |
| E11 | **Content review:** sender name, footer with the business's legal name and address, support contact, privacy-policy link, and plain-text versions (present) checked for every template | Trust and legal basics | Medium |
| E12 | **Monitoring:** delivery counts, failure rate and bounce rate per message type on the admin side | To notice problems before customers report them | Medium |

## Verification before invites

1. Configure the domain and the provider with the business. Send to seed inboxes (Gmail, Outlook, Yahoo) and check
   that SPF, DKIM and DMARC all pass in the headers.
2. Trigger each message type once on staging: OTP, invite, ticket confirmation, refund, event change, broadcast,
   reminder. Check rendering, links, sender and unsubscribe.
3. Simulate an SMTP outage on staging: the sign-up must show an error (E4) and transactional mail must be retried
   (E5).
4. Bounce a test address on purpose and check that it is suppressed (E6).
