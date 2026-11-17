# Improvements progress

Status of the planned improvements for **A. Organization management** and **B. Booking and checkout**.
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
| Abandoned cart recovery | ✅ | Reminders carry real codes (personal single-use, existing, or none). Sent by the organizer, not automatically |
| Checkout price breakdown | 🟡 | Tickets, discount, service fee (always 0) and total are shown and stored on the order; no configurable fees yet |
| Shopping cart with multiple ticket categories | ⬜ | One checkout already takes seats from several tiers of one event; no multi-event cart |
| Group bookings | ⬜ | |
| Gift tickets | ⬜ | Ticket transfer exists, but not buying for someone else at checkout |
| Maximum tickets per customer | ⬜ | Only the per-order limit (10) exists, not a per-customer limit per event |
| Tax and service fee configuration | ⬜ | |
| Booking modification where policy permits | ⬜ | |
| Downloadable booking invoices | ⬜ | Orders now store subtotal, discount and total, which an invoice can use |

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

## Checks still to do

- [ ] Commit the work (still uncommitted).
- [ ] Click through the new screens once in the browser: Organization (Profile, Documents, Payouts & tax, Branches), Discount codes, Checkout with a code, Abandoned intents reminder, Admin → Approvals payout panel.
- [ ] Production: set `FINANCE_ENCRYPTION_KEY` (the server refuses to start without it). Keep it with the database backups: changing it makes stored account numbers unreadable.
- [ ] Production / other machines: apply the migration `20261117000000_org_profile_finance_branches_discounts` (`npm run prisma:deploy` in `apps/api`).

## Known gaps / next steps

1. **Payout engine** — payout details are stored and verified, but nothing pays organizers yet.
2. **Automatic abandoned-checkout reminders** — e.g. a reminder 2 hours after checkout is abandoned, without the organizer pressing send.
3. **Outdated test scripts** — `test_auth`, `test_company`, `test_events`, `test_venue_layouts` fail because they predate newer rules (stronger passwords, required event end date) and seed data renamed by earlier runs. Not caused by these features; worth updating.
4. Remaining checkout items from section B: invoices, tax / service-fee configuration, maximum tickets per customer, gift tickets, group bookings, multi-event cart, booking modification.

## Tests

`apps/api/test_org_profile_checkout.mjs` (10 checks) covers the profile, documents, payout details, branches, discount codes, checkout retries and recovery codes:

```
cd apps/api
$env:NODE_ENV="test"; node --test test_org_profile_checkout.mjs
```

Also passing: `test_org_membership`, `test_staff_invites`, `test_seats`, `test_mint_recovery`, `test_mint_failure_modes`, `test_mint_resolution`.

## Where the code is

| Area | Backend | Frontend |
|---|---|---|
| Profile, documents, payouts, branches | `services/orgProfileService.js`, `services/financeCrypto.js`, `routes/orgRoutes.js` | `pages/OrganizerOrganization.jsx`, `components/PayoutReviews.jsx` |
| Discount codes | `services/discountService.js`, `routes/orgRoutes.js` (`/org/discounts`), `POST /bookings/discount/quote` | `pages/OrganizerDiscounts.jsx`, `pages/Checkout.jsx` |
| Checkout retries | `controllers/bookingController.js` (`initiateBooking`, `confirmBooking`), `services/paymentService.js` | `pages/Checkout.jsx` |
| Recovery reminders | `services/intentAnalyticsService.js` | `pages/AbandonedIntentDashboard.jsx` |
| Database | `prisma/schema.prisma`, migration `20261117000000_org_profile_finance_branches_discounts` | — |
