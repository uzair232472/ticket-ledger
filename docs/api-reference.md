# TicketLedger API Reference

All requests and responses use JSON (`application/json`). Authentication uses Bearer JWT tokens in the `Authorization: Bearer <token>` header.

## Base URL
- Local: `http://localhost:5000/api`

---

## 1. System & Health Endpoints
- `GET /api/health` - Check health status of API, Redis, and environment.

---

## 2. Authentication & Users (Module 2 & 3)
- `POST /api/auth/register` - Register customer / organizer / staff.
- `POST /api/auth/login` - Authenticate with email/password, returns JWT.
- `POST /api/auth/otp/send` - Send OTP (mocked / SMS ready).
- `POST /api/auth/otp/verify` - Verify OTP.
- `GET /api/users/profile` - Get logged-in user profile.
- `PUT /api/users/wallet` - Connect / update MetaMask wallet address (`0x...`).

---

## 3. Organizer Company Registration (Module 4)
- `POST /api/companies/register` - Submit company credentials, NTN/CNIC, and document URL.
- `GET /api/companies/status` - View company verification status.
- `GET /api/admin/companies` - Admin view all pending/approved companies.
- `PATCH /api/admin/companies/:id/status` - Super Admin approve/reject/suspend organizer.

---

## 4. Events & Ticketing (Module 5 & 6)
- `POST /api/events` - Organizer creates event and tiers.
- `GET /api/events` - Public event discovery (filters: type, city, date, price).
- `GET /api/events/:id` - Detailed event info and tiers.
- `GET /api/events/:id/seatmap` - Real-time seat map layout with statuses.
- `POST /api/seats/lock` - Lock seat for 10 minutes via Redis atomic lock.
- `POST /api/seats/unlock` - Release locked seat before expiration.

---

## 5. Orders, Payments & Blockchain (Module 7 & 8)
- `POST /api/orders/checkout` - Create order for locked seats.
- `POST /api/orders/:id/pay` - Process payment (Mock, Stripe, JazzCash, EasyPaisa).
- `POST /api/blockchain/mint` - Trigger ERC721 NFT minting on Polygon Amoy.

---

## 6. Tickets, QR & Gate Scanner (Module 9, 10, 11)
- `GET /api/tickets/my-tickets` - Customer ticket wallet.
- `GET /api/tickets/:id/qr` - Dynamic cryptographic QR payload.
- `GET /api/tickets/:id/pdf` - Download PDF ticket with QR code.
- `POST /api/gate/validate` - Gate staff scanner dual validation (DB + Blockchain).
- `POST /api/tickets/transfer` - Peer-to-peer ticket transfer.
- `POST /api/marketplace/list` - List ticket for resale (<= 110% cap).
- `POST /api/marketplace/buy` - Purchase resale ticket.

---

## 7. Analytics & ML (Module 13 - 18)
- `POST /api/behavior/track` - Real-time behavioral event tracking.
- `GET /api/analytics/organizer/funnel/:eventId` - Purchase intent conversion funnel.
- `POST /api/ml/forecast-demand` - 48h pre-launch event demand forecast.
- `GET /api/analytics/abandoned-intent` - Abandoned cart/intent recovery feed.
