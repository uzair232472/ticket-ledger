# Company e-mail registration: the limitation, and an invitation-based solution (PROPOSAL)

**Status:** proposal, not implemented. **Must be in place before the real-user beta (R4).** Written at R0 closure,
2026-11-22. Nothing in the application was changed for this document.

## The limitation (verified in code)

- **Public sign-up** (`POST /api/auth/register`, `authController.js` → `signupEmailSchema`) accepts only addresses
  at a fixed list of public mailbox providers (`SIGNUP_EMAIL_DOMAINS` in `config/auth.js`): Gmail, Yahoo,
  Outlook/Hotmail/Live/MSN, iCloud, AOL, Proton, Zoho.
  - **Refused:** any company domain, e.g. `events@company.pk`, with *"Use an email from a known provider…"*.
  - **Who it applies to:** both account types, customer and organizer.
  - **Why it exists:** it keeps out throw-away and mistyped domains on an open sign-up form.
- **Organization invitations** (`orgService.acceptInvitation`, `POST /api/auth/accept-invite`) already accept
  **any** valid address.
  - The single-use invite link was sent to that address, so opening it proves control of the inbox.
  - The account is created already verified and joins the inviting organization.
  - So **colleagues of an approved organizer** can join with company addresses today.
- **The gap is the organization owner.** The first person of a new organizer company has nobody on the platform
  who can invite them, and the public form refuses their business address. Invited beta organizers who use
  their company e-mail cannot register at all. Their only options are a personal Gmail-type account (poor for
  the business and for support) or nothing.
- **Customers** with work addresses hit the same rule. That is acceptable for the beta (customers normally use
  personal mail), but the same mechanism below can cover invited customers if wanted.

## Proposed solution: platform invitations from TicketLedger admins, with approved organizer domains

### 1. Organizer invitation (the main path)

A super admin (or a new `PLATFORM_ONBOARDING` permission) invites a named person to become an organizer.

- **Created by the admin:** e-mail, name, organization name, optional note, and expiry (default 7 days, at most
  14).
- **Token:** a random 256-bit token sent by e-mail; only its SHA-256 is stored (the same pattern as `StaffInvite`).
  It is single use, the claim is the first write (as in `acceptInvitation`), and it can be revoked and re-sent.
- **Accepting:**
  - **New account:** the person sets their name and password (`passwordSchema`, the same rules as sign-up). The
    account is created as `ORGANIZER` for the **invited address only**, exactly as typed by the admin. The
    e-mail is marked verified, because the link proves control of the inbox.
  - **Already signed in:** the account's verified e-mail must equal the invited one (`INVITE_EMAIL_MISMATCH`
    otherwise).
- **The provider list is not consulted** for an invited address. That is the only rule the invitation relaxes.
- **Everything else stays as it is:**
  - the company profile, the verification documents and the **admin approval of the company** before any event
    can be published;
  - payout details and their checks;
  - the rate limits on authentication.
- **Audit:** created, sent, re-sent, revoked, accepted and expired, with actor, e-mail and organization.

### 2. Approved organizer domains (optional, for organizations with several staff)

After an organizer company is **approved**, an admin may approve its domain, e.g. `company.pk`. The record
holds:
- the domain and company;
- who approved it and when;
- the evidence noted (for example "domain on the company registration documents");
- optionally, a revocation.

What an approved domain allows:
- the **company owner** can invite further members at that domain (already possible today with any domain);
- **platform admins** see the domain as trusted when inviting people.

It does **not** open public self-sign-up for the domain. An address is accepted only through an invitation sent
to it, so approving a domain can never let a stranger register as that company.

Checks when approving a domain:
- normalised lower-case;
- internationalised domains stored as punycode (no look-alike Unicode domains);
- exact match only, with subdomains approved separately;
- the domain must have MX records;
- known public, disposable and free-mail domains can never be approved as a company domain.

### 3. Data model (new; a migration with the usual backup and rehearsal)

```
PlatformInvite   id, email (lower-case), name, organizationName, role ORGANIZER (CUSTOMER for beta customers),
                 tokenHash (unique), status PENDING|ACCEPTED|REVOKED|EXPIRED, expiresAt, invitedById,
                 acceptedUserId, acceptedAt, revokedById, createdAt, note
ApprovedDomain   id, domain (unique), companyId, approvedById, approvedAt, evidence, revokedAt, revokedById
```

### 4. API (new)

| Endpoint | Who | Does |
|---|---|---|
| `POST /api/admin/platform-invites` | super admin | Create and send (rate-limited; refuses an e-mail that already has an account and suggests signing in) |
| `POST /api/admin/platform-invites/:id/resend`, `/revoke` | super admin | New token / revoke |
| `GET /api/auth/platform-invite/:token` | anyone with the link | Shows the organization name and invited e-mail (not the token's validity details) |
| `POST /api/auth/accept-platform-invite` | the invitee | Create the account, or attach to the signed-in account with the same verified e-mail |
| `POST/DELETE /api/admin/approved-domains` | super admin | Approve / revoke a company domain (approved company only) |

### 5. Security checklist

- Tokens are random, hashed at rest, single use, expiring and bound to one address.
- Acceptance is rate-limited, and errors do not reveal whether an address has an account.
- The role is fixed by the invitation, never by the client.
- Accepting never skips company approval: an invited organizer cannot publish or sell before an admin approves
  the company.
- No wildcard or self-service domain approval; every approval is attributable and revocable.
- Revoking a domain stops new invitations at that domain. Existing accounts stay and are reviewed by an admin;
  they are not deleted automatically.
- Invitation e-mails go out only once the e-mail blockers E1–E3 (`docs/email-readiness.md`) are done. Before
  that, a delivered link cannot be relied on.

### 6. Tests to add with the implementation

- **Acceptance:**
  - an invited company address creates a verified `ORGANIZER` account;
  - the same address on the public form is still refused.
- **Token rules:** expired, revoked, re-used or tampered tokens are refused; two parallel acceptances give
  exactly one account.
- **Address binding:** a signed-in account with a different e-mail cannot accept; the role cannot be changed by
  the request.
- **After acceptance:** no event can be published before company approval.
- **Domain approval:** only for an approved company; never for public or disposable domains; punycode
  normalisation; revocation.
- **Audit:** a row for every step.

### 7. Effort and order

- **Schema and API:** small to medium. It reuses the `StaffInvite` token and acceptance code paths.
- **Screens:** the admin screen and the acceptance page.
- **Order:** do it in R4 preparation, after the e-mail blockers E1–E3, before the first beta organizers are
  invited.
