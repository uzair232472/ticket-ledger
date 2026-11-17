# Improvements progress

Status of the planned improvements: **A. Organization management**, **B. Booking and checkout**, **D. Customer support**, **E. Event management**, **G. Gate management** and **H. Admin dashboard**.
Last updated: 18 November 2026 (sections E and H added).

Legend: ✅ done · 🟡 partly done · ⬜ not started

---

## A. Organization management

| Improvement | Status | What exists |
|---|---|---|
| Multiple organization members (not just gate staff) | ✅ | `OrganizationMember` model; Team page (`/organizer/team`) |
| Owner and administrator roles | ✅ | Roles: Owner, Organization Admin, Event Manager, Finance Manager, Staff, Gate Staff |
| Invite employees through email | ✅ | Invitations (create, resend, revoke; one-time link valid 72 h) |
| Custom permissions for employees | ✅ | Per-member granted / revoked permissions on top of the role's defaults |
| Organization profile and document management | ✅ | Organization page → **Profile** and **Documents** tabs |
| Organization financial information | ✅ | Organization page → **Payouts & tax** tab; admin review on Approvals |
| Organization activity logs | ✅ | Team → Activity (filter, CSV export) |
| Transfer ownership | ✅ | Team → Members → Transfer ownership (password required) |
| Multiple branches or operating locations | ✅ | Organization page → **Branches** tab |

### Profile & documents
- Public profile (description, website, logo, address, support email / phone) editable by owners and admins at any time.
- Verified identity (legal name, owner name, NTN/CNIC) is locked once TicketLedger approves the company.
- Document library: type, title, expiry date (flagged 30 days before), archive / restore, uploader shown. PDF, PNG, JPG, WebP, up to 10 MB each, 50 active documents.
- Registration documents are copied into the library automatically.

### Payout & tax details
- Bank transfer (IBAN, validated with the mod-97 checksum) or JazzCash / EasyPaisa wallet; payout schedule; NTN, STRN, filer status, billing contact.
- Account and wallet numbers are **encrypted at rest** (AES-256-GCM, `FINANCE_ENCRYPTION_KEY`) and only shown as `•••• 1234`. Showing the full numbers is recorded in the activity log.
- Saving requires the user's password. Changing where money goes resets the status to *Pending*, notifies the owners and sends it to the Super Admin's **Payout details to check** panel (Approvals page): verify, or reject with a reason.

### Branches
- Name, city, address, contacts, manager (an active member), one head office per organization.
- Events can be assigned to a branch. A branch with events can't be deleted (deactivate it instead); the head office can't be deactivated.
- Every organization starts with a "Head office" branch.

### New permissions
| Permission | Default roles |
|---|---|
| `finance.manage` (change payout & tax details) | Owner, Admin, Finance Manager |
| `org.documents` (see / upload / archive documents) | Owner, Admin, Finance Manager |
| `discount.manage` (discount codes) | Owner, Admin, Event Manager (own events only) |
| `org.settings` (profile and branches) | Owner, Admin |
| `support.respond` (answer support requests about the organization's events) | Owner, Admin, Event Manager (own events) |
| `gate.supervise` (gates, gate staff, devices, exceptions, reversals, reports) | Owner, Admin, Event Manager |

---

## B. Booking and checkout

| Improvement | Status | Notes |
|---|---|---|
| Payment-to-ticket issuance recovery | ✅ | Booking is kept, ticket valid, NFT retried with backoff (8 tries), admins alerted after 3; admin Retry / Reissue / Waive |
| Payment retry without creating duplicate bookings | ✅ | See below |
| Promo and discount codes | ✅ | Discount codes page (`/organizer/discounts`) + code field at checkout |
| Abandoned cart recovery | ✅ | Reminders carry real codes (personal single-use, existing, or none), sent by hand or **automatically** (Abandoned intents → Automatic reminders) |
| Checkout price breakdown | ✅ | Tickets, discount (code or group), service fee, tax and total: shown at checkout, stored on the order, printed on the invoice |
| Shopping cart with multiple ticket categories | ✅ | One checkout takes several ticket types of an event; the **cart** (`/cart`) pays for several events with one payment |
| Group bookings | ✅ | Automatic group discount per event (N+ tickets → X% off), and handing each ticket of a booking to a group member |
| Gift tickets | ✅ | My bookings → Send as a gift: to an account at once, or a claim link by email for someone without one |
| Maximum tickets per customer | ✅ | Per event (Checkout settings), counted across all of a customer's orders for it |
| Tax and service fee configuration | ✅ | Per organization (Checkout settings): service fee as a percent or per ticket, tax percent and name, tax registration number |
| Booking modification where policy permits | ✅ | Seat changes: to another free seat of the same type, when the event allows it, until a cut-off before the start (up to 3 per ticket) |
| Downloadable booking invoices | ✅ | PDF invoice per paid booking (INV-2026-000123), from My bookings |

### Payment retry without duplicates
- Retrying checkout for the same seats (and code) **reuses the open order and its existing payment**: no second order, no second Stripe PaymentIntent.
- Checkout sends an `Idempotency-Key`; double clicks and parallel requests get the same single order.
- One payment confirms one order: a transaction id already used for another booking is refused; a Stripe payment must belong to that order and match its amount.
- If an earlier checkout of the same seats was already paid, it is confirmed instead of charging again.
- A real card payment that arrives after the seat hold expired is **refunded automatically**; admins are alerted if the refund fails.

### Discount codes
- Percentage (1–90%) or fixed PKR amount; all events or one event; total uses, uses per customer, minimum tickets, start / end time; turn on / off.
- A use counts while its order is waiting for payment and once paid; lapsed or cancelled checkouts give the use back. Parallel checkouts can't both take the last use.
- A code never makes an order free (at least PKR 1 is paid).
- A used code can't be deleted, only turned off.

### Abandoned cart recovery
- Abandoned intents → choose the offer: **Personal code** (made per customer, single use, 48 hours, only they can use it), **Existing code**, or **No discount**.
- Codes that don't exist are refused (the old hard-coded `RECOVER10` was never a real code).
- The reminder link (`/events/:id?code=…`) fills the code in at checkout automatically.

- **Automatic reminders** (Abandoned intents → Automatic reminders): wait N hours after a checkout lapses unpaid, then one reminder with an optional personal code; at most one per customer and event a week (manual sends count too), never after they bought, never for events no longer on sale. The panel shows the last 30 days: reminders sent, customers who bought afterwards, codes used.

### Fees, tax and checkout rules (studio → Checkout settings)
- **Organization:** service fee (none, percent of tickets up to 30%, or PKR per ticket), tax percent (up to 30%), the tax's name on receipts and an optional tax registration number. A worked example shows what a PKR 2,000 ticket costs.
- **Each event:** maximum tickets per customer (counted across all their orders, including tickets they gave away), automatic group discount (N+ tickets → X% off; codes and group discounts don't stack, the bigger applies), seat changes on/off with a cut-off in hours before the start.
- Price order: tickets − discount + service fee (on discounted tickets) + tax (on tickets after discount plus fee). Every line is stored on the order; paid orders never change when settings change.

### Invoices
- Each paid booking gets a number from one sequence (INV-2026-000123) and a PDF invoice: seller (organizer, NTN, tax registration), customer, event, lines per ticket type, discount, group discount, service fee, tax, total paid, refunds, payment reference. Download from My bookings; only the buyer (or a Super Admin) can.

### Gifts and group tickets (My bookings)
- **Send as a gift:** chosen tickets go to one email, with an optional message. **Give tickets to my group:** each ticket to its own member.
- An account with that email gets the ticket at once; anyone else gets an email with a one-time claim link (`/gifts/…`) and claims it after signing in or up with that email. Until then the sender keeps the ticket and can cancel.
- The old QR and manual code stop working when a ticket moves; the move is in the ticket's transfer history.

### Seat changes (booking modification)
- When the event allows it and before its cut-off: move a paid ticket to another free seat of the same ticket type, free, up to 3 times per ticket. The old seat goes back on sale and the ticket gets a new QR.
- The ticket's NFT stays valid: it keeps its original chain seat key, and the next buyer of the freed seat gets a fresh key automatically, so the two never clash on-chain.

### Cart: several events, one payment (`/cart`)
- Seats held for several events appear together (the hold bar links there when more than one event is held). Each event becomes an order priced with its own fees and discounts; one payment (test, JazzCash or EasyPaisa) confirms them all.
- Retrying reuses the same checkout and payment. If a reservation expires before the payment arrives, that event is left out and a real card payment for it is refunded at once.
- Card payments and discount codes go through each event's own checkout.

### Payouts
- One payout per ended event: ticket sales after discounts + service fees + tax collected − refunds − 5% platform fee.
- Scheduled by the organization's payout schedule (3 days after the event · the Monday after · the 1st of next month); on hold while payout details aren't verified; recalculated when due (so late refunds count); then the finance team transfers the money and marks it paid with the reference (Admin → Payouts). Failed, held and released payouts are recorded; owners and finance managers are told at each step.
- Organizers see paid, on-the-way and on-hold totals, each payout's breakdown, and what upcoming events have earned so far (Organization → Payouts).

---

## D. Customer support (helpdesk)

| Improvement | Status | What exists |
|---|---|---|
| Customer creates a support ticket | ✅ | **Help & Support** page (`/support`, in the account menu; linked from Contact us) |
| Selects an issue category | ✅ | Bookings, payments, refunds, ticket access, event, account, organizers, technical, other |
| Attaches screenshots or documents | ✅ | Images or PDF, 5 MB each, 5 per message (on the request and every reply) |
| Receives a ticket / reference number | ✅ | e.g. `SUP-261117-7K3Q`, shown at once and in a notification + email |
| Tracks complaint status | ✅ | Open · In progress · Waiting for your reply · Escalated · Resolved · Closed |
| Replies to support staff | ✅ | Thread on `/support/SUP-…`; a reply reopens a resolved request (within 14 days) |
| Support staff assign and resolve | ✅ | **Support desk** (`/support/desk`): queues (needs a reply, mine, unassigned, escalated, all, closed), assign, status, priority, resolve |
| Admin escalates unresolved issues | ✅ | Admins escalate with a reason (priority raised, admins notified); **automatic escalation** hourly: no answer within 24 h, or a customer reply waiting 48 h |
| Complete communication history | ✅ | Every message, attachment and change (status, assignment, priority, escalation) is in the thread; staff-only internal notes; audit log entries |

- **Support agents:** admins add or remove them on the desk's *Agents* tab (by account email). Admins are always agents. Removing an agent unassigns their open requests.
- Agents see the linked booking / event next to the conversation. Customers only see an agent's first name.
- Resolved requests close automatically after 14 days.
- **Organizers** with `support.respond` see requests about their events (studio → Support requests) and reply; their replies show as "<organization> (event organizer)". They don't see internal notes and can't change status, assignment or escalation.
- **Attachments are private:** stored outside the public folder (or as authenticated Cloudinary files) and opened only through a link signed for that viewer, valid for one hour.
- **Who is told (in-app + email):** the customer when the request is received, on every agent reply, and when it is resolved or closed (always emailed, even with email notifications turned off). Every agent and admin on a new request; the assigned agent on a customer reply (every agent if nobody is assigned); the assignee when a request is assigned to them; every admin on an escalation.
- Customers see status changes in the history, but not who it is assigned to, the priority, or why it was escalated (those lines are staff only).

---

## E. Event management

| Improvement | Status | What exists |
|---|---|---|
| Event duplication / cloning | ✅ | Event tools → Copies & dates → Duplicate: a new **draft** with new records for details, images, ticket types, sale phases, the **venue plan** (ticket types remapped), gates and checkout rules. No sales, seats or approvals are copied; the copy is sent for approval like any new event |
| Recurring events | ✅ | Repeat daily / weekly / monthly (every N, up to 52 more), same time of day and length; dates the venue is already booked for are skipped and listed |
| Multiple sessions for one event | ✅ | All dates are grouped in a series; each can have a session name ("Evening show"); the event page shows a date picker |
| Multiple ticket sale phases | ✅ | Per ticket type, up to 6 phases (early bird → regular → late) by start/end time or by tickets sold; the current phase's price becomes the ticket's price everywhere (checked every 5 minutes and before each checkout) |
| Scheduled publication | ✅ | "Publish at": approved events stay hidden until then, then go public automatically (owners notified) |
| Scheduled sales opening and closing | ✅ | Sales open / close times: seat holds and checkout are refused outside the window; the event page says when sales open or that they closed |
| Event capacity management | ✅ | A ticket cap for the event (below the seats on the plan); checkout refuses beyond it; "X of Y still available" |
| Event-specific terms and policies | ✅ | Terms (versioned), refund policy, minimum age; shown on the event page; customers accept the terms at checkout (and in the cart); the order stores the version they accepted |
| Event announcements | ✅ | Posted to ticket holders (in-app + email) and optionally on the event page |
| Event staff assignments | ✅ | Event tools → Staff: add or remove event managers, staff and gate staff for this event (organization-wide roles cover every event) |
| Event change history | ✅ | Every edit with before → after values, settings, sale phases, staff, announcements, reviews (Event tools → History) |
| Event performance exports | ✅ | Tickets sold per type, revenue, discounts, fees, tax, refunds, check-ins and no-shows, sales by day; CSV download |

The **Tools** link on each event in the organizer dashboard opens `/organizer/events/:id/manage`.

---

## G. Gate management

| Improvement | Status | What exists |
|---|---|---|
| Gate-level assignments | ✅ | Gates page → *Gate staff*: tick the gates each person may scan at (none ticked = every gate) |
| Multiple entry and exit types | ✅ | Gates are *Entry only*, *Exit only* or *Entry & exit*; a gate can admit only some ticket types (e.g. VIP entrance); scanner has an entries / exits switch |
| Re-entry policies | ✅ | Per event: no re-entry, unlimited, or limited to N re-entries (after an exit scan) |
| Check-in reversal by authorized supervisors | ✅ | *Check-ins* → Reverse (reason required); the ticket becomes valid again; only the latest admission can be reversed |
| Manual exception approval with audit logs | ✅ | Scanner: "Ask a supervisor to approve" on a refused scan → *Exceptions* tab: approve (admits the ticket) or deny, note required; audited |
| Device registration | ✅ | A phone / tablet registers on its first scan (who, when), can be renamed |
| Device revocation | ✅ | *Devices* → Revoke (reason required): the device can't scan, sync or download lists, and wipes its copy; can be restored |
| Gate capacity monitoring | ✅ | Capacity per hour per gate; *Live* tab shows the last-15-minute rate, load %, and warns at 90%; people inside now |
| Scanner synchronization status | ✅ | Devices report every 30 s: in sync, uploading, offline, offline with scans not uploaded, not seen; waiting scans, last upload, list age |
| Gate-specific attendance reports | ✅ | *Reports* tab + CSV: entries, re-entries, exits, turned away, duplicates, exceptions, reversed, busiest 15 minutes, first/last scan, top staff per gate |

- **Who supervises:** new permission `gate.supervise` (Owner, Admin, Event Manager by default). Page: `/organizer/gates` ("Gates" in the studio menu).
- Events without gates keep working as before (staff type a gate name). Once gates are added, every scan must name one of them.
- Offline mode follows the same rules on the device (gate ticket types, exits, re-entry) and uploads them in order.

---

## H. Admin dashboard

| Improvement | Status | What exists |
|---|---|---|
| Dedicated finance management section | ✅ | Admin → **Finance**: collected, ticket sales, discounts, fees, tax, refunds, platform fee, payouts by status, things needing attention, daily sales, payment methods, top organizations, CSV downloads; plus Admin → Payouts |
| Support ticket management | ✅ | Admin → Support desk (helpdesk, section D) |
| Organization employee management | ✅ | Admin → Organization teams: any organization's members, invitations, roles and activity (access is recorded in its activity log) |
| Admin permission management | ✅ | Admin → Platform → **Admins**: roles Owner, Finance, Support, Moderator, Analyst, plus single extra permissions; adding an admin needs your password and their typed email; there is always at least one Owner; admins created before roles exist are Owners |
| System configuration | ✅ | Admin → Platform → **Settings**: platform fee %, support escalation times, abandoned-checkout reminder spacing, whether new organizers can register, a site-wide banner |
| Platform-wide notification management | ✅ | Admin → Platform → **Messages**: to everyone, customers, organizers, organization owners, gate staff, support agents or admins, optionally one city, now or scheduled, in-app with optional email; recipient count before sending; history and cancelling scheduled ones |
| Data export | ✅ | Admin → Platform → **Exports**: users, organizations, events, orders, refunds, payouts, support requests, audit log as CSV with a date range; every export is recorded |
| Suspicious account investigation history | ✅ | Admin → **Investigations**: a case per account with notes, evidence, the actions taken on the account (added automatically), risk, status and outcome |
| Admin action confirmation for destructive operations | ✅ | The admin types a phrase to confirm: suspending / banning / deactivating an account (its email), freezing from the fraud watchlist, suspending a company (its name), sensitive settings ("CHANGE"), a message to everyone, adding or removing an admin |
| Reversible administrative actions | ✅ | Admin → Platform → **Admin actions**: account status, company status, payout-detail checks, payout holds and settings can be undone for 30 days if nothing changed them since; the undo is logged too |

Admin permissions are checked by the API on every admin route; the console only shows what each admin's role allows.

---

## Checks still to do

- [ ] Commit the work (still uncommitted).
- [ ] Click through the new screens once in the browser: Organization (Profile, Documents, Payouts & tax, Branches), Discount codes, Checkout with a code, Abandoned intents reminder, Admin → Approvals payout panel.
- [ ] Helpdesk: open a request as a customer (with a screenshot), answer it from Support desk as admin, add an agent.
- [ ] Gates: add gates for an event, set re-entry, scan entries and exits on a phone, raise and approve an exception, revoke and restore the device, download the report.
- [ ] Production: set `FINANCE_ENCRYPTION_KEY` (the server refuses to start without it). Keep it with the database backups: changing it makes stored account numbers unreadable.
- [ ] Production / other machines: apply all migrations (`npm run prisma:deploy` in `apps/api`); today's add org profile/finance/discounts, helpdesk & gates, private attachments, organizer support, abandoned-checkout automation, and checkout fees/gifts/cart/payouts.
- [ ] Checkout: set fees/tax and event rules (Checkout settings), buy with a group discount, download the invoice, send a ticket as a gift, change a seat, pay two events in the cart.
- [ ] Payouts: verify an organization's payout details, let an event end, mark its payout paid in Admin → Payouts.
- [ ] Admin: add a Finance admin and sign in as them (only finance links); change a setting and undo it; suspend an account (type its email) and undo it; open an investigation; send a message to one city; download an export.
- [ ] Events: duplicate an event (check its seating plan), add weekly dates, set a sales window and terms, add early-bird and regular phases, post an announcement, open History and Report.

## Gaps fixed (17 November 2026)

- **Payout engine** — one payout per ended event (sales after discounts + service fees + tax − refunds − 5% platform fee), scheduled by the organization's payout schedule, held until payout details are verified, then paid by the finance team and recorded with the bank reference (Admin → Payouts; organizers: Organization → Payouts).
- **Helpdesk for organizers** — members with `support.respond` (owners, admins, event managers for their events) see and answer requests about their events (studio → Support requests). Status, assignment, escalation and internal notes stay with TicketLedger support.
- **Private support attachments** — stored outside the public folder (or as authenticated Cloudinary files) and opened only through links signed for one viewer, valid for an hour.
- **Automatic abandoned-checkout reminders** — per organization: wait N hours after a checkout lapses, then one reminder (optionally a personal code); never twice in a week per customer and event, never after they bought. Results (reminders sent, customers who then bought) on the Abandoned intents page.
- **Outdated tests** — every in-process test file passes again. Along the way: the **venue editor and venue publishing were broken** for everyone (`req is not defined` in `venueController.editorPayload`); fixed.
- **Checkout** — all remaining items of section B (see the table above).

## Fixed along the way (18 November 2026)

- The fraud watchlist's "freeze" could suspend another admin and skipped every safeguard; it now needs the fraud permission and the typed email, refuses admins, and is undoable.
- Event edits now record before → after values (for the change history).

## Known gaps / next steps


1. **Payouts are recorded, not sent** — TicketLedger has no bank API: the finance team makes the transfer and records its reference.
2. **Seat changes keep the price** — moving to a seat of a different (dearer) ticket type with payment of the difference is not built.
3. **The cart takes wallet and test payments** — card payments and discount codes go through each event's own checkout.
4. **Refunds return ticket prices** — the service fee and tax are not refunded automatically.
5. **One order is still at most 10 tickets** — a group larger than 10 books twice.
6. **Sale phase prices change the ticket type's price** — orders already placed keep theirs; seats held before a change are priced at checkout with the new price.
7. **Recurring dates are separate events** — each is approved on its own (they go to the approvals queue together).
8. **Older admin pages** (dashboard, companies, watchlist) keep their look; new admin pages use the studio cards.

## Tests

Every in-process test file passes: 18 files, 232 checks (last full run: 18 November 2026). The main ones for this work:

- `apps/api/test_org_profile_checkout.mjs` (16 checks): profile, documents, payout details, branches, discount codes, checkout retries, recovery codes, automatic reminders, fees/tax/group discount/limits/invoices, gifts and group tickets, seat changes, the cart, payouts.
- `apps/api/test_helpdesk_gates.mjs` (14 checks): helpdesk (incl. private attachments and organizer replies) and gate management.
- `apps/api/test_admin_events.mjs` (12 checks): admin roles, settings with confirmation and undo, account actions and investigations, platform messages, exports, admins; event duplicate, dates, sales window, terms, capacity, sale phases, scheduled publication, announcements, staff, history, report.

```
cd apps/api
$env:NODE_ENV="test"; node --test test_org_profile_checkout.mjs test_helpdesk_gates.mjs test_admin_events.mjs
```

Also passing: `test_auth`, `test_company`, `test_events`, `test_venue_layouts`, `test_email_otp_signup`, `test_pending_signup`, `test_event_media`, `test_user_profile`, `test_health`, `test_org_membership`, `test_staff_invites`, `test_seats`, `test_mint_recovery`, `test_mint_failure_modes`, `test_mint_resolution`. (Older scripts like `test_booking.mjs` call a running server on port 5000 instead of starting the app; they weren't part of this.)

## Where the code is

| Area | Backend | Frontend |
|---|---|---|
| Profile, documents, payouts, branches | `services/orgProfileService.js`, `services/financeCrypto.js`, `routes/orgRoutes.js` | `pages/OrganizerOrganization.jsx`, `components/PayoutReviews.jsx` |
| Discount codes | `services/discountService.js`, `routes/orgRoutes.js` (`/org/discounts`), `POST /bookings/discount/quote` | `pages/OrganizerDiscounts.jsx`, `pages/Checkout.jsx` |
| Checkout retries | `controllers/bookingController.js` (`initiateBooking`, `confirmBooking`), `services/paymentService.js` | `pages/Checkout.jsx` |
| Recovery reminders | `services/intentAnalyticsService.js` | `pages/AbandonedIntentDashboard.jsx` |
| Helpdesk | `services/supportService.js`, `controllers/supportController.js`, `routes/supportRoutes.js` (`/api/support`), hourly job in `server.js` | `pages/Support.jsx`, `pages/SupportTicketPage.jsx`, `pages/SupportDesk.jsx`, `components/support/` |
| Gate management | `services/gateService.js`, `services/checkinService.js`, `controllers/checkinController.js`, `routes/checkinRoutes.js` (`/api/checkin/manage/…`) | `pages/GateManagement.jsx`, `pages/GateScanner.jsx`, `lib/gateOffline.js` |
| Organizer support, private attachments | `services/supportService.js` (viewers, `attachmentLink`, `openAttachment`), `utils/storage.js` (`uploadPrivateFile`) | `pages/OrganizerSupport.jsx`, `components/support/SupportThread.jsx` |
| Automatic reminders | `services/recoveryService.js` (15-minute job in `server.js`), `/org/recovery` | `pages/AbandonedIntentDashboard.jsx` (`AutoRecovery`) |
| Fees, tax, checkout rules | `services/pricingService.js`, `services/checkoutSettingsService.js`, `POST /bookings/quote` | `pages/OrganizerCheckoutSettings.jsx`, `pages/Checkout.jsx` |
| Invoices | `services/invoiceService.js`, `GET /bookings/:id/invoice` | `components/account/BookingTools.jsx` |
| Gifts, group tickets, seat changes | `services/giftService.js`, `services/seatChangeService.js`, `controllers/ticketExtrasController.js`, `routes/giftRoutes.js` | `components/account/BookingTools.jsx`, `pages/MyBookings.jsx`, `pages/GiftClaim.jsx` |
| Cart | `bookingController.js` (`checkoutCart`, `confirmCart`, `finalizePaidOrder`) | `pages/Cart.jsx`, `components/HoldBar.jsx` |
| Payouts | `services/payoutService.js` (hourly job), `/org/payouts`, `/companies/admin/payouts` | `pages/AdminPayouts.jsx`, `pages/OrganizerOrganization.jsx` (Payouts tab) |
| Admin permissions, settings, undo, confirmations | `services/adminAccess.js`, `services/systemConfig.js`, `services/adminActions.js`, `controllers/adminConsoleController.js`, `routes/adminRoutes.js` | `pages/AdminPlatform.jsx`, `lib/typedConfirm.js`, `components/SiteBanner.jsx` |
| Admin finance, messages, exports, investigations | `services/financeOverviewService.js`, `services/broadcastService.js`, `services/exportService.js`, `services/investigationService.js` | `pages/AdminFinance.jsx`, `pages/AdminPlatform.jsx`, `pages/AdminInvestigations.jsx` |
| Event tools | `services/eventToolsService.js` (5-minute job in `server.js`), `/org/events/:id/…`, `GET /events/:id/extras` | `pages/EventTools.jsx`, `components/event-detail/EventExtras.jsx`, `pages/Checkout.jsx` (terms) |
| Database | `prisma/schema.prisma`, migrations from `20261117000000_…` to `20261118010000_ticket_phase_activation` | — |
