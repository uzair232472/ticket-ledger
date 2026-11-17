# Improvements progress

Status of the planned improvements: **A. Organization management**, **B. Booking and checkout**, **D. Customer support** and **G. Gate management**.
Last updated: 17 November 2026.

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
- **Who is told (in-app + email):** the customer when the request is received, on every agent reply, and when it is resolved or closed (always emailed, even with email notifications turned off). Every agent and admin on a new request; the assigned agent on a customer reply (every agent if nobody is assigned); the assignee when a request is assigned to them; every admin on an escalation.
- Customers see status changes in the history, but not who it is assigned to, the priority, or why it was escalated (those lines are staff only).

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

## Checks still to do

- [ ] Commit the work (still uncommitted).
- [ ] Click through the new screens once in the browser: Organization (Profile, Documents, Payouts & tax, Branches), Discount codes, Checkout with a code, Abandoned intents reminder, Admin → Approvals payout panel.
- [ ] Helpdesk: open a request as a customer (with a screenshot), answer it from Support desk as admin, add an agent.
- [ ] Gates: add gates for an event, set re-entry, scan entries and exits on a phone, raise and approve an exception, revoke and restore the device, download the report.
- [ ] Production: set `FINANCE_ENCRYPTION_KEY` (the server refuses to start without it). Keep it with the database backups: changing it makes stored account numbers unreadable.
- [ ] Production / other machines: apply all migrations (`npm run prisma:deploy` in `apps/api`); today's add org profile/finance/discounts, helpdesk & gates, private attachments, organizer support, abandoned-checkout automation, and checkout fees/gifts/cart/payouts.
- [ ] Checkout: set fees/tax and event rules (Checkout settings), buy with a group discount, download the invoice, send a ticket as a gift, change a seat, pay two events in the cart.
- [ ] Payouts: verify an organization's payout details, let an event end, mark its payout paid in Admin → Payouts.

## Gaps fixed (17 November 2026)

- **Payout engine** — one payout per ended event (sales after discounts + service fees + tax − refunds − 5% platform fee), scheduled by the organization's payout schedule, held until payout details are verified, then paid by the finance team and recorded with the bank reference (Admin → Payouts; organizers: Organization → Payouts).
- **Helpdesk for organizers** — members with `support.respond` (owners, admins, event managers for their events) see and answer requests about their events (studio → Support requests). Status, assignment, escalation and internal notes stay with TicketLedger support.
- **Private support attachments** — stored outside the public folder (or as authenticated Cloudinary files) and opened only through links signed for one viewer, valid for an hour.
- **Automatic abandoned-checkout reminders** — per organization: wait N hours after a checkout lapses, then one reminder (optionally a personal code); never twice in a week per customer and event, never after they bought. Results (reminders sent, customers who then bought) on the Abandoned intents page.
- **Outdated tests** — every in-process test file passes again. Along the way: the **venue editor and venue publishing were broken** for everyone (`req is not defined` in `venueController.editorPayload`); fixed.
- **Checkout** — all remaining items of section B (see the table above).

## Known gaps / next steps

1. **Payouts are recorded, not sent** — TicketLedger has no bank API: the finance team makes the transfer and records its reference.
2. **Seat changes keep the price** — moving to a seat of a different (dearer) ticket type with payment of the difference is not built.
3. **The cart takes wallet and test payments** — card payments and discount codes go through each event's own checkout.
4. **Refunds return ticket prices** — the service fee and tax are not refunded automatically.
5. **One order is still at most 10 tickets** — a group larger than 10 books twice.

## Tests

`apps/api/test_org_profile_checkout.mjs` (10 checks) covers the profile, documents, payout details, branches, discount codes, checkout retries and recovery codes:

```
cd apps/api
$env:NODE_ENV="test"; node --test test_org_profile_checkout.mjs
```

`apps/api/test_helpdesk_gates.mjs` (13 checks) covers the helpdesk and gate management:

```
cd apps/api
$env:NODE_ENV="test"; node --test test_helpdesk_gates.mjs
```

Also passing: `test_org_membership`, `test_staff_invites`, `test_seats`, `test_mint_recovery`, `test_mint_failure_modes`, `test_mint_resolution`.

## Where the code is

| Area | Backend | Frontend |
|---|---|---|
| Profile, documents, payouts, branches | `services/orgProfileService.js`, `services/financeCrypto.js`, `routes/orgRoutes.js` | `pages/OrganizerOrganization.jsx`, `components/PayoutReviews.jsx` |
| Discount codes | `services/discountService.js`, `routes/orgRoutes.js` (`/org/discounts`), `POST /bookings/discount/quote` | `pages/OrganizerDiscounts.jsx`, `pages/Checkout.jsx` |
| Checkout retries | `controllers/bookingController.js` (`initiateBooking`, `confirmBooking`), `services/paymentService.js` | `pages/Checkout.jsx` |
| Recovery reminders | `services/intentAnalyticsService.js` | `pages/AbandonedIntentDashboard.jsx` |
| Helpdesk | `services/supportService.js`, `controllers/supportController.js`, `routes/supportRoutes.js` (`/api/support`), hourly job in `server.js` | `pages/Support.jsx`, `pages/SupportTicketPage.jsx`, `pages/SupportDesk.jsx`, `components/support/` |
| Gate management | `services/gateService.js`, `services/checkinService.js`, `controllers/checkinController.js`, `routes/checkinRoutes.js` (`/api/checkin/manage/…`) | `pages/GateManagement.jsx`, `pages/GateScanner.jsx`, `lib/gateOffline.js` |
| Database | `prisma/schema.prisma`, migrations `20261117000000_org_profile_finance_branches_discounts`, `20261117120000_helpdesk_gate_management` | — |
