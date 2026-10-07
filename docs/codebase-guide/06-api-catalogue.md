# API catalogue

[← Start here](README.md) · Handler details: [function catalogue](functions/README.md) · Tables: [database](07-database.md) · Realtime events: [state, realtime & config](09-state-realtime-config.md#3-socketio-events)

All endpoints are served by the Express app in `apps/api/src/app.js` on port 5000 (`PORT`). Request/response bodies are JSON (`{ success, message?, data? }`) except multipart uploads (`POST/PUT /api/events`, `POST /api/companies/register`, `POST /api/venues/event/:eventId/plan-image`) and binary/HTML responses (`GET /api/tickets/:id/pdf`, `GET /api/notifications/preview-email`). The Python ML service has its own small HTTP API, documented in [ML service](functions/ml-service.md#http-endpoints); it is called only by the Node API.

## How to read the table

- **Middleware (in order)** — exactly as registered. Router-wide `router.use(...)` middleware is shown first. Aliases defined inside route files:

  | Alias | File | Expands to |
  |---|---|---|
  | `superAdminGuard` | `adminRoutes.js:20` | `authenticateJWT → requireRole(['SUPER_ADMIN'])` |
  | `organizerOrAdminGuard` | `adminRoutes.js:21` | `authenticateJWT → requireRole(['ORGANIZER','SUPER_ADMIN'])` |
  | `organizerGuard` | `intentAnalyticsRoutes.js:15` | `authenticateJWT → requireRole(['ORGANIZER','SUPER_ADMIN'])` |
  | `scanners` | `checkinRoutes.js:7` | `requireRole('GATE_STAFF','ORGANIZER','SUPER_ADMIN')` |
  | `manager` | `staffRoutes.js:24` | `requireRole('ORGANIZER','SUPER_ADMIN')` |
  | `...organizer` | `venueRoutes.js:21` | `authenticateJWT → requireRole('ORGANIZER','SUPER_ADMIN')` |
  | `optionalAuth` in `mlRoutes.js:17` and the inline function in `seatRoutes.js:13` | — | Run `authenticateJWT` **only if** a Bearer header is present (an invalid token then fails with 401), unlike `middlewares/auth.js` `optionalAuth`, which silently falls back to guest |
  | `eventMediaUpload` / `planUpload` / `upload.single('document')` | route files | multer (memory storage) upload parsers with readable 400 errors |
  | rate limiters | `middlewares/rateLimit.js` | see [API core](functions/api-core.md#rate-limiters--middlewaresratelimitjs) |

  Role middleware is only the first gate: most handlers also check **ownership** (company owns the event, user owns the ticket/order, staff assigned to the event). Those checks are described per handler in the function catalogue.
- **Writes / Reads** — Prisma tables touched by the handler *and the services it calls* (generated from a static scan; see [database §5](07-database.md#5-who-reads-and-writes-each-table)). Every write to `Notification` also schedules an e-mail through the Prisma extension. `BehaviorEvent` writes are fire-and-forget telemetry.
- **Web callers** — call sites in `apps/web/src` found by a scan that also handles calls split over several lines, chained `api\n.get(...)` calls and helper functions taking `/api/...` literals. "none found" means no static caller in the web app (often used only by test scripts or meant for API clients). Calls whose URL is built from a variable (`AdminFraudWatchlist` freeze/unfreeze, `AdminCompanies` list) were matched by reading the source.
- Error responses follow the pattern described per handler: 400 validation (Zod), 401 authentication, 403 role/ownership/suspended, 404 not found, 409 conflict/state, 410 invite gone, 429 rate limit / OTP cooldown, 500 unexpected.

## Notes on unused or legacy endpoints

| Endpoints | Status |
|---|---|
| `/api/gate/*` | Legacy HMAC-QR scanner; replaced by `/api/checkin/*`; no web caller. |
| `/api/seats/generate-grid`, `PATCH /api/events/:id/status`, `/api/tickets/mint/:orderId`, `/api/tickets/:id/qr`, `/api/tickets/nft/:id`, `/api/resale/my-listings`, `/api/behavior/user/:userId`, `/api/behavior/attach-session`, `/api/ml/fraud/score`, `/api/ml/intent/predict`, `/api/ml/train/:modelType`, `/api/ml/predictions`, `/api/notifications/fcm-token`, `/api/venues/templates`, `/api/companies/guard-check`, `/api/auth/role-test/*`, legacy auth aliases (`/register`, `/otp/send`, `/otp/verify`) | Implemented, no web caller (tests/API clients only). |
| `/api/organizer/*` | Duplicate mount of the admin router: every admin path also answers under `/api/organizer` with the same guards. The web app uses only `/api/organizer/organizer-dashboard`. |

## Endpoints

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/metrics` | `adminRoutes.js:24` | superAdminGuard | `adminController.getSuperAdminMetrics` | — | AuditLog, Company, Event, GateScan, Order, Ticket, User | `pages/SuperAdminDashboard.jsx:150` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/metrics` | `adminRoutes.js:24` | superAdminGuard | `adminController.getSuperAdminMetrics` | — | AuditLog, Company, Event, GateScan, Order, Ticket, User | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/users` | `adminRoutes.js:25` | superAdminGuard | `adminController.getUsersList` | — | User | `pages/SuperAdminDashboard.jsx:191` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/users` | `adminRoutes.js:25` | superAdminGuard | `adminController.getUsersList` | — | User | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| PUT | `/api/admin/users/:id/status` | `adminRoutes.js:26` | superAdminGuard | `adminController.updateUserStatus` | AuditLog, User | — | `pages/SuperAdminDashboard.jsx:273` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| PUT | `/api/organizer/users/:id/status` | `adminRoutes.js:26` | superAdminGuard | `adminController.updateUserStatus` | AuditLog, User | — | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/events` | `adminRoutes.js:27` | superAdminGuard | `adminController.getAllEventsAdmin` | — | Event | `pages/SuperAdminDashboard.jsx:164`, `pages/SuperAdminDashboard.jsx:194`, `pages/SuperAdminDashboard.jsx:249` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/events` | `adminRoutes.js:27` | superAdminGuard | `adminController.getAllEventsAdmin` | — | Event | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/event-reviews` | `adminRoutes.js:29` | superAdminGuard | `eventReviewController.listEventsForReview` | — | Event | `pages/AdminEventApprovals.jsx:125` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/event-reviews` | `adminRoutes.js:29` | superAdminGuard | `eventReviewController.listEventsForReview` | — | Event | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/admin/event-reviews/:id` | `adminRoutes.js:30` | superAdminGuard | `eventReviewController.reviewEvent` | AuditLog, Event, Notification | — | `pages/AdminEventApprovals.jsx:35` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/organizer/event-reviews/:id` | `adminRoutes.js:30` | superAdminGuard | `eventReviewController.reviewEvent` | AuditLog, Event, Notification | — | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/transactions` | `adminRoutes.js:31` | superAdminGuard | `adminController.getAllTransactionsAdmin` | — | Order | `pages/SuperAdminDashboard.jsx:163`, `pages/SuperAdminDashboard.jsx:197`, `pages/SuperAdminDashboard.jsx:234` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/transactions` | `adminRoutes.js:31` | superAdminGuard | `adminController.getAllTransactionsAdmin` | — | Order | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/blockchain-logs` | `adminRoutes.js:32` | superAdminGuard | `adminController.getBlockchainLogs` | — | Ticket | `pages/SuperAdminDashboard.jsx:200`, `pages/SuperAdminDashboard.jsx:238` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/blockchain-logs` | `adminRoutes.js:32` | superAdminGuard | `adminController.getBlockchainLogs` | — | Ticket | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/fraud-alerts` | `adminRoutes.js:33` | superAdminGuard | `adminController.getFraudAlerts` | — | BehaviorEvent | `pages/SuperAdminDashboard.jsx:203`, `pages/SuperAdminDashboard.jsx:241` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/fraud-alerts` | `adminRoutes.js:33` | superAdminGuard | `adminController.getFraudAlerts` | — | BehaviorEvent | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/gate-scans` | `adminRoutes.js:34` | superAdminGuard | `adminController.getGateScanLogs` | — | GateScan | `pages/SuperAdminDashboard.jsx:206`, `pages/SuperAdminDashboard.jsx:245` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/gate-scans` | `adminRoutes.js:34` | superAdminGuard | `adminController.getGateScanLogs` | — | GateScan | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/audit-logs` | `adminRoutes.js:35` | superAdminGuard | `adminController.getAuditLogs` | — | AuditLog | `pages/SuperAdminDashboard.jsx:209` |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/audit-logs` | `adminRoutes.js:35` | superAdminGuard | `adminController.getAuditLogs` | — | AuditLog | none found |

### `/api/admin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/admin/organizer-dashboard` | `adminRoutes.js:38` | organizerOrAdminGuard | `adminController.getOrganizerDashboard` | — | BehaviorEvent, Company, Event, GateScan, Order, TicketTier | none found |

### `/api/organizer` (same router as `/api/admin`)

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/organizer/organizer-dashboard` | `adminRoutes.js:38` | organizerOrAdminGuard | `adminController.getOrganizerDashboard` | — | BehaviorEvent, Company, Event, GateScan, Order, TicketTier | `pages/OrganizerDashboard.jsx:156` |

### `/api/auth`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/signup` | `authRoutes.js:23` | authRateLimiter | `authController.signup` | BehaviorEvent, OtpCode, User | — | `context/AuthContext.jsx:195` `signup` ← `pages/Signup.jsx` |
| POST | `/api/auth/login` | `authRoutes.js:24` | authRateLimiter | `authController.login` | BehaviorEvent, OtpCode, RefreshToken | User | `context/AuthContext.jsx:189` `login` ← `pages/Login.jsx` |
| GET | `/api/auth/pending-signup` | `authRoutes.js:25` | codeCheckRateLimiter | `authController.getPendingSignup` | — | OtpCode, User | `context/AuthContext.jsx:198` `getPendingSignup` ← `pages/Signup.jsx`, `pages/VerifyOtp.jsx` |
| PATCH | `/api/auth/pending-signup` | `authRoutes.js:26` | authRateLimiter | `authController.updatePendingSignup` | OtpCode, User | — | `context/AuthContext.jsx:200` `updatePendingSignup` ← `pages/Signup.jsx` |
| POST | `/api/auth/verify-otp` | `authRoutes.js:27` | codeCheckRateLimiter | `authController.verifyOtp` | OtpCode, RefreshToken, User | — | `context/AuthContext.jsx:202` `verifyOtp` ← `pages/VerifyOtp.jsx` |
| POST | `/api/auth/resend-otp` | `authRoutes.js:28` | authRateLimiter | `authController.resendOtp` | OtpCode | User | `context/AuthContext.jsx:208` `resendOtp` ← `pages/VerifyOtp.jsx`, `pages/ResetPassword.jsx` |
| POST | `/api/auth/forgot-password` | `authRoutes.js:29` | authRateLimiter | `authController.forgotPassword` | OtpCode | User | `context/AuthContext.jsx:210` `forgotPassword` ← `pages/ForgotPassword.jsx` |
| POST | `/api/auth/reset-password` | `authRoutes.js:30` | codeCheckRateLimiter | `authController.resetPassword` | OtpCode, RefreshToken, User | — | `context/AuthContext.jsx:212` `resetPassword` ← `pages/ResetPassword.jsx` |
| GET | `/api/auth/invite/:token` | `authRoutes.js:31` | codeCheckRateLimiter | `authController.getInvite` | StaffInvite | — | `context/AuthContext.jsx:215` `getInvite` ← `pages/AcceptInvite.jsx` |
| POST | `/api/auth/accept-invite` | `authRoutes.js:32` | codeCheckRateLimiter | `authController.acceptInvite` | RefreshToken, StaffEventAssignment, StaffInvite, User | — | `context/AuthContext.jsx:218` `acceptInvite` ← `pages/AcceptInvite.jsx` |
| POST | `/api/auth/refresh` | `authRoutes.js:35` | — (public) | `authController.refresh` | RefreshToken | User | `context/AuthContext.jsx:88` |
| POST | `/api/auth/logout` | `authRoutes.js:36` | — (public) | `authController.logout` | RefreshToken | — | `context/AuthContext.jsx:126`, `context/AuthContext.jsx:169` |
| POST | `/api/auth/register` | `authRoutes.js:39` | authRateLimiter | `authController.signup` | BehaviorEvent, OtpCode, User | — | none found |
| POST | `/api/auth/otp/send` | `authRoutes.js:40` | authRateLimiter | `authController.resendOtp` | OtpCode | User | none found |
| POST | `/api/auth/otp/verify` | `authRoutes.js:41` | codeCheckRateLimiter | `authController.verifyOtp` | OtpCode, RefreshToken, User | — | none found |
| GET | `/api/auth/me` | `authRoutes.js:44` | authenticateJWT | `authController.getMe` | — | User | `context/AuthContext.jsx:227` |
| GET | `/api/auth/role-test/admin` | `authRoutes.js:47` | authenticateJWT → requireRole('SUPER_ADMIN') | inline handler (echoes `req.user` / `req.company`) | — | — | none found |
| GET | `/api/auth/role-test/organizer` | `authRoutes.js:51` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | inline handler (echoes `req.user` / `req.company`) | — | — | none found |
| GET | `/api/auth/role-test/staff` | `authRoutes.js:55` | authenticateJWT → requireRole('GATE_STAFF', 'SUPER_ADMIN') | inline handler (echoes `req.user` / `req.company`) | — | — | none found |
| GET | `/api/auth/role-test/customer` | `authRoutes.js:59` | authenticateJWT → requireRole('CUSTOMER', 'SUPER_ADMIN') | inline handler (echoes `req.user` / `req.company`) | — | — | none found |

### `/api/behavior`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/behavior/track` | `behaviorRoutes.js:13` | optionalAuth | `behaviorController.recordClientEvent` | BehaviorEvent | — | `pages/Checkout.jsx:223`, `pages/Checkout.jsx:241`, `utils/api.js:42` |
| POST | `/api/behavior/attach-session` | `behaviorRoutes.js:16` | requireAuth | `behaviorController.linkSessionToUser` | BehaviorEvent | — | none found |
| GET | `/api/behavior/profile` | `behaviorRoutes.js:19` | requireAuth | `behaviorController.getMyBehaviorProfile` | BehaviorEvent | User | `pages/BehaviorProfile.jsx:102`, `pages/Profile.jsx:158` |
| GET | `/api/behavior/user/:userId` | `behaviorRoutes.js:22` | requireAuth → requireRole('SUPER_ADMIN', 'ORGANIZER') | `behaviorController.getUserBehaviorProfileById` | BehaviorEvent | Order, User | none found |

### `/api/bookings`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/bookings/initiate` | `bookingRoutes.js:16` | requireAuth | `bookingController.initiateBooking` | AuditLog, BehaviorEvent, Order, Seat, Seat (raw SQL), Ticket, TicketTier | Event | `pages/Checkout.jsx:292` |
| POST | `/api/bookings/confirm` | `bookingRoutes.js:17` | requireAuth | `bookingController.confirmBooking` | AuditLog, BehaviorEvent, Notification, Order, Seat, Ticket | — | `pages/Checkout.jsx:351` |
| POST | `/api/bookings/cancel` | `bookingRoutes.js:18` | requireAuth | `bookingController.cancelBooking` | BehaviorEvent, Order, Seat, Ticket, TicketTier | — | none found |
| GET | `/api/bookings/my-bookings` | `bookingRoutes.js:19` | requireAuth | `bookingController.getMyBookings` | — | Order | `pages/MyBookings.jsx:31` |
| GET | `/api/bookings/:id` | `bookingRoutes.js:20` | requireAuth | `bookingController.getBookingById` | — | Order | `pages/BookingSuccess.jsx:42` |

### `/api/checkin`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/checkin/events` | `checkinRoutes.js:9` | authenticateJWT → scanners | `checkinController.myEvents` | — | Company, Event, StaffEventAssignment | `pages/GateScanner.jsx:148` |
| GET | `/api/checkin/events/:id/pack` | `checkinRoutes.js:10` | authenticateJWT → scanners | `checkinController.pack` | Ticket | Event | `pages/GateScanner.jsx:183` |
| GET | `/api/checkin/events/:id/stats` | `checkinRoutes.js:11` | authenticateJWT → scanners | `checkinController.stats` | — | CheckIn, Ticket | `pages/GateScanner.jsx:204` |
| GET | `/api/checkin/events/:id/recent` | `checkinRoutes.js:12` | authenticateJWT → scanners | `checkinController.recent` | — | CheckIn, Company, Event, StaffEventAssignment | `pages/GateScanner.jsx:204` |
| POST | `/api/checkin/scan` | `checkinRoutes.js:13` | authenticateJWT → scanners | `checkinController.scanTicket` | CheckIn, GateScan, Ticket | Event | `pages/GateScanner.jsx:316` |
| POST | `/api/checkin/sync` | `checkinRoutes.js:14` | authenticateJWT → scanners | `checkinController.syncScans` | CheckIn, GateScan, Ticket | — | `pages/GateScanner.jsx:220` |

### `/api/companies`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/companies/register` | `companyRoutes.js:24` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') → upload.single('document') | `companyController.registerCompany` | AuditLog, Company, Notification, User | — | `pages/CompanyRegistration.jsx:109` |
| GET | `/api/companies/my-company` | `companyRoutes.js:31` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | `companyController.getMyCompany` | — | Company | `pages/CompanyRegistration.jsx:51`, `pages/CreateEvent.jsx:167` |
| GET | `/api/companies/guard-check` | `companyRoutes.js:34` | authenticateJWT → requireApprovedOrganizer | inline handler (echoes `req.user` / `req.company`) | — | — | none found |
| GET | `/api/companies/admin/all` | `companyRoutes.js:43` | authenticateJWT → requireRole('SUPER_ADMIN') | `companyController.getAllCompanies` | — | Company | `pages/AdminCompanies.jsx:47` (URL built in a variable at `:43`) |
| PATCH | `/api/companies/admin/:id/status` | `companyRoutes.js:44` | authenticateJWT → requireRole('SUPER_ADMIN') | `companyController.updateCompanyStatus` | AuditLog, Company, Notification | — | `pages/AdminCompanies.jsx:76`, `pages/AdminCompanies.jsx:104`, `pages/AdminCompanies.jsx:133` |

### `/api/contact`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/contact` | `contactRoutes.js:7` | contactRateLimiter → optionalAuth | `contactController.sendContactMessage` | — | — | `pages/Contact.jsx:54` |

### `/api/events`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/events` | `eventRoutes.js:57` | optionalAuth | `eventController.getEvents` | BehaviorEvent | Event | `pages/AbandonedIntentDashboard.jsx:86`, `pages/Categories.jsx:22`, `pages/Dashboard.jsx:136`, `pages/EventDetails.jsx:170`, `pages/Events.jsx:127`, `pages/PurchaseIntentAnalytics.jsx:58` |
| GET | `/api/events/:id` | `eventRoutes.js:58` | optionalAuth | `eventController.getEventById` | BehaviorEvent | Company, Event | `pages/EventDetails.jsx:143` |
| POST | `/api/events/:eventId/waitlist` | `eventRoutes.js:61` | authenticateJWT | `ticketTransferController.joinEventWaitlist` | Waitlist | Event | `pages/EventDetails.jsx:211` |
| GET | `/api/events/:eventId/waitlist` | `eventRoutes.js:62` | authenticateJWT | `ticketTransferController.getEventWaitlistStatus` | — | Waitlist | `pages/EventDetails.jsx:184` |
| POST | `/api/events` | `eventRoutes.js:65` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') → requireApprovedOrganizer → eventMediaUpload | `eventController.createEvent` | AuditLog, Event, Notification, TicketTier | — | `pages/CreateEvent.jsx:311` |
| GET | `/api/events/:id/manage` | `eventRoutes.js:75` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | `eventController.getEventForEdit` | — | Company, Event | `pages/CreateEvent.jsx:184` |
| PUT | `/api/events/:id` | `eventRoutes.js:82` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') → eventMediaUpload | `eventController.updateEvent` | AuditLog, Event, EventGalleryImage, Notification | Company | `pages/CreateEvent.jsx:361` |
| GET | `/api/events/organizer/my-events` | `eventRoutes.js:90` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | `eventController.getOrganizerEvents` | — | Company, Event | `pages/DemandForecast.jsx:53` |
| GET | `/api/events/:id/submission` | `eventRoutes.js:98` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | `eventReviewController.getSubmissionStatus` | — | Company, Event, Seat, VenueLayout | `pages/EventSubmit.jsx:47` |
| POST | `/api/events/:id/submit` | `eventRoutes.js:99` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | `eventReviewController.submitEventForReview` | AuditLog, Event, Notification | Company, Seat, User, VenueLayout | `pages/EventSubmit.jsx:63` |
| DELETE | `/api/events/:id` | `eventRoutes.js:102` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | `eventController.deleteEvent` | AuditLog, Event, Notification, Order | Company | `pages/OrganizerDashboard.jsx:132`, `pages/SuperAdminDashboard.jsx:100` |
| PATCH | `/api/events/:id/status` | `eventRoutes.js:104` | authenticateJWT | `eventController.updateEventStatus` | Event | Company | none found |
| GET | `/api/events/:id/prelaunch-forecast` | `eventRoutes.js:111` | authenticateJWT → requireRole(['ORGANIZER', 'SUPER_ADMIN']) | `eventController.getPreLaunchDemandForecast` | — | Company, Event | `pages/DemandForecast.jsx:82` |
| PUT | `/api/events/:id/pricing` | `eventRoutes.js:118` | authenticateJWT → requireRole(['ORGANIZER', 'SUPER_ADMIN']) | `eventController.updateEventPricing` | TicketTier | Company, Event | `pages/DemandForecast.jsx:132` |
| POST | `/api/events/:id/publish` | `eventRoutes.js:125` | authenticateJWT → requireRole(['ORGANIZER', 'SUPER_ADMIN']) | `eventController.publishEventWithPricing` | AuditLog, TicketTier | Company, Event | `pages/DemandForecast.jsx:157` |

### `/api/gate`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/gate/dynamic-qr/:ticketId` | `gateRoutes.js:13` | requireAuth | `gateController.getDynamicRotatingQR` | — | Ticket | none found |
| POST | `/api/gate/scan` | `gateRoutes.js:16` | requireAuth → requireRole(['GATE_STAFF', 'SUPER_ADMIN', 'ORGANIZER']) | `gateController.scanTicket` | BehaviorEvent, GateScan, Ticket | — | none found |
| GET | `/api/gate/recent-scans` | `gateRoutes.js:17` | requireAuth → requireRole(['GATE_STAFF', 'SUPER_ADMIN', 'ORGANIZER']) | `gateController.getRecentScans` | — | Company, Event, GateScan, StaffEventAssignment | none found |
| GET | `/api/gate/stats/:eventId` | `gateRoutes.js:18` | requireAuth → requireRole(['GATE_STAFF', 'SUPER_ADMIN', 'ORGANIZER']) | `gateController.getEventGateStats` | — | Company, Event, GateScan, StaffEventAssignment | none found |

### `/api/analytics`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/analytics/intent/:eventId` | `intentAnalyticsRoutes.js:18` | organizerGuard | `intentAnalyticsController.getEventIntentAnalytics` | — | BehaviorEvent, Event, Order | `pages/PurchaseIntentAnalytics.jsx:77` |
| POST | `/api/analytics/intent/:eventId/send-reminder` | `intentAnalyticsRoutes.js:19` | organizerGuard | `intentAnalyticsController.sendAttendeeReminder` | AuditLog, Notification | Event, User | `pages/PurchaseIntentAnalytics.jsx:112` |
| POST | `/api/analytics/intent/:eventId/batch-reminder` | `intentAnalyticsRoutes.js:20` | organizerGuard | `intentAnalyticsController.sendBatchAttendeeReminders` | AuditLog, Notification | BehaviorEvent, Event, Order, User | `pages/PurchaseIntentAnalytics.jsx:138` |
| GET | `/api/analytics/abandoned` | `intentAnalyticsRoutes.js:23` | organizerGuard | `intentAnalyticsController.getAbandonedDashboard` | — | BehaviorEvent, Company, Event, Order, Ticket | `pages/AbandonedIntentDashboard.jsx:106` |
| POST | `/api/analytics/abandoned/send-reminder` | `intentAnalyticsRoutes.js:24` | organizerGuard | `intentAnalyticsController.sendAbandonedReminder` | AuditLog, Notification | Event, User | `pages/AbandonedIntentDashboard.jsx:142` |
| POST | `/api/analytics/abandoned/batch-reminders` | `intentAnalyticsRoutes.js:25` | organizerGuard | `intentAnalyticsController.sendBatchAbandonedReminders` | AuditLog, Notification | BehaviorEvent, Company, Event, Order, Ticket, User | `pages/AbandonedIntentDashboard.jsx:175` |

### `/api/ml`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/ml/fraud/score` | `mlRoutes.js:26` | optionalAuth | `mlController.checkFraud` | AuditLog, BehaviorEvent | — | none found |
| POST | `/api/ml/fraud-check` | `mlRoutes.js:27` | optionalAuth | `mlController.checkFraud` | AuditLog, BehaviorEvent | — | none found |
| POST | `/api/ml/forecast/demand` | `mlRoutes.js:29` | optionalAuth | `mlController.forecastDemand` | BehaviorEvent | — | none found |
| POST | `/api/ml/demand-forecast` | `mlRoutes.js:30` | optionalAuth | `mlController.forecastDemand` | BehaviorEvent | — | `pages/DemandForecast.jsx:92` |
| POST | `/api/ml/intent/predict` | `mlRoutes.js:32` | optionalAuth | `mlController.scoreIntent` | BehaviorEvent | — | none found |
| POST | `/api/ml/intent-score` | `mlRoutes.js:33` | optionalAuth | `mlController.scoreIntent` | BehaviorEvent | — | none found |
| POST | `/api/ml/train/:modelType` | `mlRoutes.js:36` | authenticateJWT → requireRole('SUPER_ADMIN') | `mlController.trainModel` | AuditLog | — | none found |
| GET | `/api/ml/predictions` | `mlRoutes.js:39` | authenticateJWT → requireRole('SUPER_ADMIN') | `mlController.getPredictionHistory` | — | BehaviorEvent | none found |
| GET | `/api/ml/fraud-watchlist` | `mlRoutes.js:42` | authenticateJWT → requireRole('SUPER_ADMIN') | `mlController.getFraudWatchlist` | — | BehaviorEvent | `pages/AdminFraudWatchlist.jsx:45` |
| POST | `/api/ml/freeze-user/:userId` | `mlRoutes.js:43` | authenticateJWT → requireRole('SUPER_ADMIN') | `mlController.freezeUserAccount` | AuditLog, RefreshToken, User | — | `pages/AdminFraudWatchlist.jsx:69` (URL in variable `:67`) |
| POST | `/api/ml/unfreeze-user/:userId` | `mlRoutes.js:44` | authenticateJWT → requireRole('SUPER_ADMIN') | `mlController.unfreezeUserAccount` | AuditLog, User | — | `pages/AdminFraudWatchlist.jsx:69` (URL in variable `:67`) |

### `/api/notifications`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/notifications/preview-email` | `notificationRoutes.js:16` | — (public) | `notificationController.previewEmailHTML` | — | — | link (`href`) in `pages/Notifications.jsx:257` |
| GET | `/api/notifications` | `notificationRoutes.js:21` | requireAuth | `notificationController.getMyNotifications` | — | Notification | `components/home/HeaderAccount.jsx:36`, `components/home/HomeHeader.jsx:185`, `components/NotificationBell.jsx:72`, `pages/Notifications.jsx:56` |
| PATCH | `/api/notifications/read-all` | `notificationRoutes.js:22` | requireAuth | `notificationController.markAllNotificationsAsRead` | Notification | — | `components/NotificationBell.jsx:140`, `pages/Notifications.jsx:87` |
| PATCH | `/api/notifications/:id/read` | `notificationRoutes.js:23` | requireAuth | `notificationController.markNotificationAsRead` | Notification | — | `components/NotificationBell.jsx:128`, `pages/Notifications.jsx:75` |
| DELETE | `/api/notifications/:id` | `notificationRoutes.js:24` | requireAuth | `notificationController.deleteNotification` | Notification | — | `pages/Notifications.jsx:97` |
| POST | `/api/notifications/fcm-token` | `notificationRoutes.js:25` | requireAuth | `notificationController.registerFCMToken` | User | — | none found |
| POST | `/api/notifications/test` | `notificationRoutes.js:26` | requireAuth | `notificationController.sendTestNotification` | Notification | User | `pages/Notifications.jsx:111` |

### `/api/resale`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/resale/market` | `resaleRoutes.js:14` | optionalAuth | `resaleController.getMarketListings` | BehaviorEvent | ResaleListing | `pages/EventDetails.jsx:195`, `pages/ResaleMarketplace.jsx:83` |
| POST | `/api/resale/list` | `resaleRoutes.js:17` | requireAuth | `resaleController.listTicketForResale` | AuditLog, BehaviorEvent, Notification, ResaleListing, Waitlist | Ticket | `pages/MyNFTTickets.jsx:108`, `pages/DigitalWallet.jsx:244` |
| POST | `/api/resale/cancel/:listingId` | `resaleRoutes.js:18` | requireAuth | `resaleController.cancelResaleListing` | Notification, ResaleListing | — | `pages/MyNFTTickets.jsx:137` |
| GET | `/api/resale/my-listings` | `resaleRoutes.js:19` | requireAuth | `resaleController.getMyListings` | — | ResaleListing | none found |
| POST | `/api/resale/buy/:listingId` | `resaleRoutes.js:20` | requireAuth | `resaleController.buyResaleTicket` | AuditLog, Notification, ResaleListing, Ticket, TicketTransferHistory | — | `pages/ResaleMarketplace.jsx:127` |

### `/api/seats`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/seats/event/:eventId` | `seatRoutes.js:13` | (req, res, next) => { // If authorization header is provided, attach user; other | `seatController.getEventSeatMap` | Order, Seat, Seat (raw SQL), Ticket, TicketTier | Event | `pages/Checkout.jsx:42`, `pages/SeatMap.jsx:128` |
| POST | `/api/seats/lock` | `seatRoutes.js:23` | authenticateJWT | `seatController.lockSeat` | BehaviorEvent, Seat (raw SQL) | Seat | `pages/SeatMap.jsx:303` |
| POST | `/api/seats/unlock` | `seatRoutes.js:24` | authenticateJWT | `seatController.unlockSeat` | Seat | — | `hooks/useCartHolds.js:87`, `pages/Checkout.jsx:206`, `pages/SeatMap.jsx:288` |
| POST | `/api/seats/generate-grid` | `seatRoutes.js:27` | authenticateJWT → requireRole('ORGANIZER', 'SUPER_ADMIN') | `seatController.generateSeatGrid` | Seat | Event, TicketTier, VenueLayout | none found |

### `/api/staff`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/staff/my-events` | `staffRoutes.js:20` | authenticateJWT → requireRole('GATE_STAFF', 'ORGANIZER', 'SUPER_ADMIN') | `staffController.getMyGateEvents` | — | Company, Event, StaffEventAssignment | `pages/StaffEvents.jsx:26` |
| GET | `/api/staff` | `staffRoutes.js:25` | authenticateJWT → manager | `staffController.listStaff` | StaffInvite | Company, User | `components/StaffManager.jsx:38` |
| GET | `/api/staff/events` | `staffRoutes.js:26` | authenticateJWT → manager | `staffController.listInvitableEvents` | — | Company, Event | `components/StaffManager.jsx:57` |
| POST | `/api/staff/invites` | `staffRoutes.js:27` | authenticateJWT → manager | `staffController.createInvite` | StaffEventAssignment, StaffInvite | Company, Event, User | `components/StaffManager.jsx:111` |
| POST | `/api/staff/invites/:id/resend` | `staffRoutes.js:28` | authenticateJWT → manager | `staffController.resendInvite` | StaffInvite | Company, User | `components/StaffManager.jsx:270`, `components/StaffManager.jsx:418` |
| DELETE | `/api/staff/invites/:id` | `staffRoutes.js:29` | authenticateJWT → manager | `staffController.cancelInvite` | StaffInvite | — | `components/StaffManager.jsx:273`, `components/StaffManager.jsx:428` |
| PATCH | `/api/staff/:id/deactivate` | `staffRoutes.js:30` | authenticateJWT → manager | `staffController.deactivateStaff` | AuditLog, RefreshToken, User | — | `components/StaffManager.jsx:195`, `components/StaffManager.jsx:369` |
| PATCH | `/api/staff/:id/reactivate` | `staffRoutes.js:31` | authenticateJWT → manager | `staffController.reactivateStaff` | AuditLog, Notification, User | — | `components/StaffManager.jsx:205`, `components/StaffManager.jsx:383` |
| DELETE | `/api/staff/:id/events/:eventId` | `staffRoutes.js:32` | authenticateJWT → manager | `staffController.revokeEventAccess` | AuditLog, Notification, StaffEventAssignment | Event, User | `components/StaffManager.jsx:85` |

### `/api/tickets`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| POST | `/api/tickets/transfer` | `ticketRoutes.js:23` | requireAuth | `ticketTransferController.transferTicketDirectly` | AuditLog, BehaviorEvent, Notification, ResaleListing, Ticket, TicketTransferHistory | User | `pages/DigitalWallet.jsx:197` |
| GET | `/api/tickets/my-transfers` | `ticketRoutes.js:24` | requireAuth | `ticketTransferController.getMyTransferHistory` | — | TicketTransferHistory | `pages/DigitalWallet.jsx:301` |
| POST | `/api/tickets/mint/:orderId` | `ticketRoutes.js:25` | requireAuth | `ticketController.mintOrderNFTs` | AuditLog, Ticket | Order | none found |
| GET | `/api/tickets/my-nfts` | `ticketRoutes.js:26` | requireAuth | `ticketController.getMyNFTTickets` | AuditLog, Ticket | — | `pages/MyNFTTickets.jsx:58` |
| GET | `/api/tickets/wallet` | `ticketRoutes.js:27` | requireAuth | `ticketController.getCustomerWallet` | AuditLog, Ticket | — | `pages/Profile.jsx:350`, `pages/DigitalWallet.jsx:96` |
| GET | `/api/tickets/:id/pdf` | `ticketRoutes.js:28` | requireAuth | `ticketController.downloadTicketPDF` | Ticket | — | `pages/DigitalWallet.jsx:133` |
| GET | `/api/tickets/:id/qr` | `ticketRoutes.js:29` | requireAuth | `ticketController.getTicketQR` | Ticket | — | none found |
| POST | `/api/tickets/verify-qr` | `ticketRoutes.js:30` | requireAuth | `ticketController.verifyTicketQRPost` | — | Ticket | `pages/DigitalWallet.jsx:161` |
| GET | `/api/tickets/nft/:id` | `ticketRoutes.js:31` | requireAuth | `ticketController.getNFTTicketById` | — | Ticket | none found |
| GET | `/api/tickets/:ticketId/transfer-history` | `ticketRoutes.js:32` | requireAuth | `ticketTransferController.getTicketTransferHistory` | — | TicketTransferHistory | `pages/DigitalWallet.jsx:281` |

### `/api/users`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/users/profile` | `userRoutes.js:18` | authenticateJWT | `userController.getProfile` | — | Company, Event, GateScan, Order, Ticket, User | `pages/Profile.jsx:110` |
| PUT | `/api/users/profile` | `userRoutes.js:19` | authenticateJWT | `userController.updateProfile` | AuditLog, Notification, User | — | `pages/Profile.jsx:205` |
| PUT | `/api/users/wallet` | `userRoutes.js:20` | authenticateJWT | `userController.updateWallet` | AuditLog, BehaviorEvent, Notification, User | — | `pages/Profile.jsx:294` |
| PUT | `/api/users/notifications` | `userRoutes.js:21` | authenticateJWT | `userController.updateNotifications` | User | — | `pages/Profile.jsx:328` |
| PUT | `/api/users/password` | `userRoutes.js:22` | authenticateJWT → authRateLimiter | `userController.changePassword` | AuditLog, Notification, RefreshToken, User | — | `components/account/ChangePasswordCard.jsx:57` |
| GET | `/api/users/history` | `userRoutes.js:23` | authenticateJWT | `userController.getAccountHistory` | — | AuditLog | `pages/Profile.jsx:142` |

### `/api/venues`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/venues/templates` | `venueRoutes.js:34` | — (public) | `venueController.listTemplates` | — | — | none found |
| GET | `/api/venues/holds/mine` | `venueRoutes.js:37` | authenticateJWT | `venueController.getMyHolds` | — | Seat | `components/HoldBar.jsx:24`, `hooks/useCartHolds.js:20` |
| GET | `/api/venues/event/:eventId` | `venueRoutes.js:38` | optionalAuth | `venueController.getEventVenue` | Order, Seat, Seat (raw SQL), Ticket, TicketTier | Event, VenueLayout | `components/venue/adapters.js:18`, `pages/Checkout.jsx:38` |
| POST | `/api/venues/event/:eventId/holds` | `venueRoutes.js:39` | authenticateJWT | `venueController.createHold` | Order, Seat, Seat (raw SQL), Ticket, TicketTier | Event, VenueLayout | `components/venue/adapters.js:19` |
| POST | `/api/venues/event/:eventId/holds/release` | `venueRoutes.js:40` | authenticateJWT | `venueController.releaseHold` | Order, Seat, Ticket, TicketTier | — | `components/venue/adapters.js:20`, `hooks/useCartHolds.js:70`, `hooks/useCartHolds.js:85`, `hooks/useCartHolds.js:89`, `pages/Checkout.jsx:208` |
| GET | `/api/venues/event/:eventId/editor` | `venueRoutes.js:43` | ...organizer | `venueController.getEditor` | — | Event, Seat, TicketTier, VenueLayout | `pages/VenueEditor.jsx:157` |
| PUT | `/api/venues/event/:eventId/draft` | `venueRoutes.js:44` | ...organizer | `venueController.saveDraft` | VenueLayout | Event, TicketTier | `pages/VenueEditor.jsx:440` |
| DELETE | `/api/venues/event/:eventId/draft` | `venueRoutes.js:45` | ...organizer | `venueController.discardDraft` | VenueLayout | Event | `pages/VenueEditor.jsx:528` |
| POST | `/api/venues/event/:eventId/publish` | `venueRoutes.js:46` | ...organizer | `venueController.publish` | AuditLog, Notification, Seat, Seat (raw SQL), TicketTier, VenueLayout | Event | `pages/VenueEditor.jsx:497` |
| POST | `/api/venues/event/:eventId/plan-image` | `venueRoutes.js:47` | ...organizer → planUpload | `venueController.uploadPlanImage` | — | Event | `pages/VenueEditor.jsx:347` |
| POST | `/api/venues/event/:eventId/tiers` | `venueRoutes.js:48` | ...organizer | `venueController.createTier` | TicketTier | Event | `pages/VenueEditor.jsx:539` |
| GET | `/api/venues/event/:eventId/reusable` | `venueRoutes.js:49` | ...organizer | `venueController.listReusable` | — | Event, VenueLayout | `pages/VenueEditor.jsx:317` |

### `/api/wishlist`

| Method | Path | Route file | Middleware (in order) | Handler | Writes | Reads | Web callers |
|---|---|---|---|---|---|---|---|
| GET | `/api/wishlist` | `wishlistRoutes.js:9` | authenticateJWT | `wishlistController.getWishlist` | — | WishlistItem | `pages/Wishlist.jsx:34` |
| GET | `/api/wishlist/ids` | `wishlistRoutes.js:10` | authenticateJWT | `wishlistController.getWishlistIds` | — | WishlistItem | `context/WishlistContext.jsx:28` |
| POST | `/api/wishlist/:eventId` | `wishlistRoutes.js:11` | authenticateJWT | `wishlistController.addToWishlist` | WishlistItem | Event | `context/WishlistContext.jsx:59` |
| DELETE | `/api/wishlist/:eventId` | `wishlistRoutes.js:12` | authenticateJWT | `wishlistController.removeFromWishlist` | WishlistItem | — | `context/WishlistContext.jsx:60` |
