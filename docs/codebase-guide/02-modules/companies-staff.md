# Module: Companies (organizer verification) & gate staff

[← Modules](README.md) · Functions: [companies & staff](../functions/api-companies-staff.md) · Journeys: [3](../03-journeys.md#journey-3--organizer-company-approval-event-creation-and-submission), [10](../03-journeys.md#journey-10--gate-staff-onboarding-and-revocation)

## Overview
An organizer must register a **company** (name, owner, phone, e-mail, city, NTN/CNIC, verification document) and be **approved** by a Super Admin before creating events, editing seating or inviting staff. Organizers then invite **gate staff** per event by e-mail; staff belong to the company and can only scan their assigned events.

## Behind the scenes

```mermaid
sequenceDiagram
  participant O as Organizer (CompanyRegistration)
  participant API as companyController
  participant A as Admin (AdminCompanies)
  participant S as StaffManager
  participant SC as staffController
  participant G as Gate staff (AcceptInvite)
  O->>API: POST /companies/register (multipart document)
  API->>API: uploadFile → Company PENDING, User.companyId, notification, audit
  A->>API: PATCH /companies/admin/:id/status APPROVED|REJECTED(reason)|SUSPENDED
  API-->>O: notification + e-mail; refreshUser → companyStatus APPROVED → studio unlocked
  S->>SC: POST /staff/invites {email, eventId}
  SC->>SC: ownership (own company), company approved, existing account rules
  SC-->>G: e-mail link /invite/<raw token> (hash stored, 72 h)
  G->>SC: (auth) POST /auth/accept-invite → GATE_STAFF user + StaffEventAssignment
  S->>SC: DELETE /staff/:id/events/:eventId → socket staff:access-revoked
```

| Step | File → function | Tables |
|---|---|---|
| Register / resubmit | `companyController.registerCompany` | `Company`, `User.companyId`, `Notification`, `AuditLog` |
| Admin list / decide | `getAllCompanies`, `updateCompanyStatus` | `Company`, `Notification`, `AuditLog` |
| Guard for event creation | `requireApprovedCompany` (alias `requireApprovedOrganizer`) | `Company` |
| Ownership helper | `utils/eventAccess.canManageEvent`, `accessService.getOwnedCompanyId`, `getScopedEventIds` | `Company`, `Event`, `StaffEventAssignment` |
| Invite / resend / cancel | `staffController.createInvite`, `resendInvite`, `cancelInvite` | `StaffInvite`, `StaffEventAssignment` (existing staff) |
| Accept | `authController.acceptInvite` | `StaffInvite`, `User`, `StaffEventAssignment`, `RefreshToken` |
| Deactivate / reactivate | `deactivateStaff` (revokes sessions), `reactivateStaff` | `User`, `RefreshToken`, `AuditLog`, `Notification` |
| Revoke one event | `revokeEventAccess` | `StaffEventAssignment`, `AuditLog`, `Notification` + socket |
| Staff landing | `getMyGateEvents` → `StaffEvents.jsx` | `Event` |

**Role rules:** company ownership is always derived from the signed-in user, never from a client-sent id. Super Admins see/manage all companies' staff. Organizers can only undo their own `DEACTIVATED`; platform blocks need a Super Admin.

## Failure behaviour
Approved company re-registration → 400; reject without reason → 400; invite to an e-mail with another role → 409; invite e-mail failure → invite still created (`emailSent:false`, resend available); expired invites become `EXPIRED` lazily.

## Gaps (observed)
Document file type is not validated; suspending a company does not hide its events; `CompanyRegistration` has no panel for `SUSPENDED`.

## Worked example (fictional)
Tariq registers "Tariq Events" → PENDING → admin rejects ("NTN unreadable") → Tariq resubmits (status back to PENDING) → approved → invites `gate1@example.com` for *Lahore Night Run* → invite row (hash, expires in 72 h) and e-mail → Bilal accepts with a password → GATE_STAFF account assigned to that event → after the event Tariq revokes access; Bilal's open scanner wipes its offline data.
