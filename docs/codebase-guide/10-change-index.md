# Where do I look if I want to change…?

[← Start here](README.md)

| I want to change… | Start here | Also check |
|---|---|---|
| Password rules / name / phone validation | `apps/api/src/controllers/authController.js` Zod schemas (`:26-91`) | `apps/web/src/lib/validation.js`, `userController.changePasswordSchema` |
| Access token lifetime, refresh lifetime, idle timeout | `apps/api/src/config/auth.js` | `apps/web/src/context/AuthContext.jsx` (`IDLE_TIMEOUT_MS`, `REFRESH_LEAD_MS`) — keep in sync |
| OTP length, expiry, attempts, resend cooldown | `config/auth.js`, `services/otpService.js` | `VerifyOtp.jsx`, `ResetPassword.jsx` (`RESEND_SECONDS`) |
| Who can call an endpoint (roles) | the route file in `apps/api/src/routes/` | ownership checks inside the handler; `App.jsx` `ProtectedRoute` and menus (`HomeHeader.useMenuGroups`, `DashShell.CONSOLES`) |
| Where each role lands after login | `apps/web/src/lib/session.js` `getHomeRoute` | `Login.jsx` redirect |
| Rate limits | `apps/api/src/middlewares/rateLimit.js` | `AUTH_RATE_LIMIT_MAX` |
| E-mail look / wording | `services/emailLayout.js`, `services/emailService.js` | `config/prisma.js` `ACTIONS` (button per notification type) |
| Which notifications are e-mailed | `config/prisma.js` `emailNotifications` | user preference `User.emailNotifications` |
| Add a new notification | call `prisma.notification.create({data:{userId,type,title,message}})` in the feature | add a prefix to `ACTIONS` for the e-mail button; icons in `NotificationBell`/`Notifications.jsx` |
| Hold duration (10 min) or max tickets (10) | `apps/api/src/services/venueService.js` (`HOLD_SECONDS`, `MAX_TICKETS_PER_BOOKING`, `PAYMENT_GRACE_SECONDS`) | `bookingController` schema (max 10), `venue-core` `LIMITS.wholeTableSeats`, `VenueBooking.MAX_TICKETS`, `adapters.js` |
| How seats are generated (spacing, numbering, aisles) | `apps/venue-core/src/generate.js` | ⚠ changing keys breaks published plans' `Seat.layoutKey` mapping |
| Venue templates | `apps/venue-core/src/templates.js` | `TEMPLATE_FOR_EVENT_TYPE` |
| Layout validation rules / limits | `apps/venue-core/src/validate.js`, `generate.js` `LIMITS` | editor messages |
| Publishing rules for seating | `venueService.publishDraft` | `VenueEditor` conflict check |
| Checkout payment methods / mock rules | `services/paymentService.js` | `Checkout.jsx` `METHODS`, `paymentDetailsFor`, `validate` |
| Stripe card checkout (PaymentIntent, Elements) | `paymentService.js` (`stripeClient`, STRIPE branches) | `Checkout.jsx` (`stripePromise`, `CardElement`, `confirmCardPayment` in `submit`), `STRIPE_SECRET_KEY` / `VITE_STRIPE_PUBLISHABLE_KEY`; make `verifyPayment` require a matching intent ([gap](functions/api-booking-payment.md#stripe-verification-gap)); add webhooks (none exist) |
| Integrate JazzCash / EasyPaisa for real | `paymentService.initiatePayment/verifyPayment` | `bookingController.confirmBooking` (verification result), `.env` |
| Checkout anti-bot thresholds / telemetry | `mlService.checkFraudRisk` (Node fallback), `apps/ml-service/main.py` (heuristic/model), `bookingController.initiateBooking` (block at `CRITICAL_BOT`) | `Checkout.jsx` `submit` (telemetry built from page time and clicks; `?bot` demo switch) |
| "Check my pass" in the wallet | `ticketController.verifyTicketQRPost` (prefix test) | `DigitalWallet.handleSimulateGateScan` |
| Local blockchain demo | `contracts/hardhat.config.cjs` (`localhost`), `nftService.js` | root `scripts/*.mjs`, `Profile.jsx` `switchToPolygonAmoy` |
| Booking rules (who can book what) | `bookingController.initiateBooking` | `venueService.FREE_SQL` |
| Ticket pass format / signing key | `services/qrPassService.js` | `checkinService.evaluate`, `lib/gateOffline.js evaluateOffline` (must match) |
| Gate verdict rules / messages | `services/checkinService.js evaluate` | offline copy in `gateOffline.js` |
| Offline scanner limits (2 h, pack refresh, sync) | `lib/gateOffline.js` (`OFFLINE_LIMIT_MS`), `GateScanner.jsx` (`PACK_REFRESH_MS`, sync interval) | — |
| PDF ticket design | `services/ticketPdf.js drawTicketPdf` | `qrTicketService.buildTicketPDF` |
| Resale price cap | `resaleController.listTicketForResale` | `nftService`, `ticketController` (display cap), `resaleContent.js`, contract `mintTicket` |
| Make resale take payment / fix the double-buy race | `resaleController.buyResaleTicket` | `ResaleMarketplace.handleBuyTicket` |
| Event fields | `prisma/schema.prisma` `Event` + `eventController` schemas | `CreateEvent.jsx`, `EventDetails.jsx`, `db push` |
| Image size/ratio rules | `apps/api/src/config/eventMedia.js` | `apps/web/src/utils/eventImageSpecs.js` (keep in sync) |
| Event approval workflow | `eventReviewController.js` | `EventSubmit.jsx`, `AdminEventApprovals.jsx`, `EventStatus` enum |
| Event visibility to the public | `eventController.getEvents/getEventById` (status lists) | `wishlistController.PUBLIC_STATUSES` |
| Company verification | `companyController.js` | `CompanyRegistration.jsx`, `AdminCompanies.jsx`, `requireApprovedCompany` |
| Staff invite expiry / rules | `config/auth.js INVITE_TTL_MS`, `staffController.js` | `authController.acceptInvite` |
| Behaviour actions tracked | callers of `behaviorService.trackBehavior`; `BEHAVIOR_ACTIONS` | analytics match action strings in `intentAnalyticsService` |
| Intent / abandoned scoring rules | `services/intentAnalyticsService.js` | pages `PurchaseIntentAnalytics`, `AbandonedIntentDashboard` |
| Fix behaviour profile ML scoring | `behaviorService.getUserBehavioralProfile` (calls non-existent `predictPurchaseIntent`/`predictFraud`) | `mlService.scorePurchaseIntent` / `checkFraudRisk` |
| Demand forecast rules (launch time, price warnings) | `eventController.getPreLaunchDemandForecast` | `DemandForecast.jsx` |
| ML models / features | `apps/ml-service/scripts/train_*.py`, `main.py execute_*` | `mlService.js` payload mapping; retrain and regenerate `model_metrics.json` |
| ML service URL / timeouts | `services/mlService.js` | `ML_SERVICE_URL` |
| NFT minting / contract address | `services/nftService.js` | `.env` names (`POLYGON_PRIVATE_KEY`, `TICKET_NFT_CONTRACT_ADDRESS`), `contracts/` |
| Smart contract logic | `contracts/contracts/TicketLedgerNFT.sol` | `contracts/test/…`, `nftService` ABI |
| Organizer dashboard figures | `services/organizerDashboardService.js` | `OrganizerDashboard.jsx` |
| Platform fee (5 %) | `organizerDashboardService.js`, `adminService.getSuperAdminMetrics` | — |
| Admin user statuses | `services/adminService.js updateUserStatus` | `config/auth.js BLOCKED_STATUSES`, `SuperAdminDashboard.jsx` |
| CORS / allowed frontends | `config/cors.js` | `FRONTEND_URL` |
| Upload storage | `utils/storage.js` | `CLOUDINARY_*`, `app.js` static `/uploads`, web `resolveMediaUrl` |
| Realtime events | emitters listed in [state & realtime](09-state-realtime-config.md#3-socketio-events) | client listeners |
| Site header menu | `components/home/HomeHeader.jsx useMenuGroups` | `App.jsx` routes |
| Add a page | `apps/web/src/App.jsx` route + `pages/…` | menus, `DashShell.CONSOLES`, `ProtectedRoute` |
| Homepage content / media | `components/home/homeData.js`, `pages/Dashboard.jsx` | `homeMotion.js` |
| Legal text | `pages/Legal.jsx DOCS` | — |
| Support e-mail shown in UI | `apps/web/src/lib/site.js` | `apps/api/src/config/brand.js` |
| Seed / demo data | `apps/api/prisma/seed.js` | `seed_venue_layouts.js`, `Login.jsx DEMO_ACCOUNTS` |
| Database schema | `apps/api/prisma/schema.prisma` → `npx prisma db push` | data migration scripts for renames |
