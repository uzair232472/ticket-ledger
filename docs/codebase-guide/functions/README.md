# Function catalogue

[← Start here](../README.md) · Coverage method: [checklist](../12-coverage.md)

Every function, method, React component, hook, middleware, route handler, event handler and background task in the project, grouped by area. Entries explain the trigger, inputs/outputs, steps in order, branches, data changes, async behaviour, failure paths and callers. Inline callbacks and effects are documented under their enclosing component (each page ends with a "small helpers and inline callbacks" table).

| Page | Covers |
|---|---|
| [API core](api-core.md) | `server.js`, `app.js`, config, middleware, utils |
| [Auth & accounts](api-auth-accounts.md) | `authController`, `tokenService`, `otpService`, `accessService`, `userController` |
| [Notifications & e-mail](api-notifications-email.md) | `notificationService/Controller`, `fcmService`, `emailService`, `emailLayout`, `contactController` |
| [Companies & staff](api-companies-staff.md) | `companyController`, `staffController` |
| [Events](api-events.md) | `eventController`, `eventReviewController`, `eventMediaService`, `wishlistController` |
| [Venues & seats](api-venues-seats.md) | `apps/venue-core`, `venueService`, `venueController`, `seatController` |
| [Booking & payment](api-booking-payment.md) | `bookingController`, `paymentService` |
| [Tickets, QR & gate](api-tickets-qr-gate.md) | `ticketController`, `qrPassService`, `qrTicketService`, `ticketPdf`, `checkinService/Controller`, `gateController` |
| [Resale, transfer & NFT](api-resale-transfer-nft.md) | `ticketTransferController`, `resaleController`, `nftService`, Solidity contract |
| [Analytics & ML (API)](api-analytics-ml.md) | `behaviorService/Controller`, `mlService/Controller`, `intentAnalytics*`, `adminService/Controller`, `organizerDashboardService` |
| [ML service (Python)](ml-service.md) | `main.py`, training/data/evaluation scripts |
| [Scripts, tests & infra](scripts-tests-infra.md) | seeds, maintenance scripts, root demo `scripts/`, test files, docker-compose |
| [Web core](web-core.md) | entry, `App.jsx`, contexts, hook, lib, utils |
| [Web components](web-components.md) | everything in `apps/web/src/components/` |
| [Web pages](web-pages.md) | everything in `apps/web/src/pages/` |

Route registrations (method + path + middleware + handler) are in the [API catalogue](../06-api-catalogue.md); inline route handlers (health check, role tests, guard check) are described there and in [API core](api-core.md#api-app).

## How to read an entry

Most entries follow: **Where** (file:line) · **Trigger** (route, caller, event) · **In → Out** · **Steps** (numbered, in execution order) · **Side effects / data** · **Failure** · **Used by**. Short helpers are summarised in tables. "Observed" means read from the code; "inferred" marks intent or behaviour deduced but not directly visible.

## Symbol index

Every named function found by the static parser (JavaScript/JSX via Babel; Python and Solidity added by hand), with its line and the page that documents it. Anonymous inline callbacks (e.g. `onClick={() => …}` or `.then(...)`) are not listed individually — 3,624 function nodes exist in total, of which the named ones below are tracked; anonymous ones are described in prose under their component. Use the search box (HTML) or your editor's find to locate a name.

| File | Documented in | Functions (`name:line`; `*` = nested inside another function) |
|---|---|---|
| `apps/api/prisma/seed.js` | [Scripts & tests](scripts-tests-infra.md) | `main:7` |
| `apps/api/scripts/create-super-admin.mjs` | [Scripts & tests](scripts-tests-infra.md) | `arg:15` |
| `apps/api/scripts/migrate-auth-overhaul.mjs` | [Scripts & tests](scripts-tests-infra.md) | `columnExists:24` `enumHasValue:33` `prePush:42` `push:72` `postPush:78` |
| `apps/api/scripts/migrate-legacy-venues.mjs` | [Scripts & tests](scripts-tests-infra.md) | `slug:26` `rowsFor:30` `mappable:48` `buildLayout:62` `planFor:94` `main:132` |
| `apps/api/seed_venue_layouts.js` | [Scripts & tests](scripts-tests-infra.md) | `publishLayoutForEvent:4` `publishAllLayouts:123` |
| `apps/api/src/config/auth.js` | [Auth & accounts](api-auth-accounts.md) | `getJwtSecret:6` `OTP_INCORRECT:34` `OTP_COOLDOWN:36` |
| `apps/api/src/config/cors.js` | [API core](api-core.md) | `corsOrigin:7` |
| `apps/api/src/config/prisma.js` | [API core](api-core.md) | `FRONTEND:4` `actionFor:15` `emailNotifications:36` `create:68` `createMany:73` |
| `apps/api/src/config/redis.js` | [API core](api-core.md) | `retryStrategy:9` `connectRedis:27` `acquireSeatLock:43` `releaseSeatLock:79` `checkSeatLock:109` |
| `apps/api/src/config/socket.js` | [API core](api-core.md) | `setIO:3` `getIO:7` |
| `apps/api/src/controllers/adminController.js` | [Analytics & ML](api-analytics-ml.md) | `getSuperAdminMetrics:7` `getUsersList:20` `updateUserStatus:34` `getAllEventsAdmin:59` `getAllTransactionsAdmin:73` `getBlockchainLogs:87` `getFraudAlerts:101` `getGateScanLogs:115` `getAuditLogs:129` `getOrganizerDashboard:143` |
| `apps/api/src/controllers/authController.js` | [Auth & accounts](api-auth-accounts.md) | `withCodeAlias:66` `isBlocked:93` `suspendedResponse:95` `handleError:98` `buildAuthUser:115` `startSession:145` `trackLogin:151` `signup:167` `findPendingSignupUser:228` `noPendingSignup:235` `getPendingSignup:245` `updatePendingSignup:270` `verifyOtp:334` `resendOtp:366` `login:399` `refresh:438` `logout:462` `forgotPassword:475` `resetPassword:493` `findUsableInvite:522` `getInvite:541` `acceptInvite:565` `getMe:618` |
| `apps/api/src/controllers/behaviorController.js` | [Analytics & ML](api-analytics-ml.md) | `recordClientEvent:7` `getMyBehaviorProfile:41` `getUserBehaviorProfileById:60` `linkSessionToUser:87` |
| `apps/api/src/controllers/bookingController.js` | [Booking & payment](api-booking-payment.md) | `initiateBooking:38` `confirmBooking:327` `cancelBooking:555` `getMyBookings:678` `getBookingById:729` |
| `apps/api/src/controllers/checkinController.js` | [Tickets, QR & gate](api-tickets-qr-gate.md) | `canScan:6` `fail:11` `myEvents:18` `pack:33` `scanTicket:52` `syncScans:82` `stats:94` `recent:104` |
| `apps/api/src/controllers/companyController.js` | [Companies & staff](api-companies-staff.md) | `registerCompany:25` `getMyCompany:139` `getAllCompanies:168` `updateCompanyStatus:225` |
| `apps/api/src/controllers/contactController.js` | [Notifications & e-mail](api-notifications-email.md) | `supportInbox:21` `sendContactMessage:28` |
| `apps/api/src/controllers/eventController.js` | [Events](api-events.md) | `createEvent:76` `getEvents:226` `getEventById:326` `getOrganizerEvents:398` `updateEventStatus:439` `getPreLaunchDemandForecast:517` `updateEventPricing:660` `publishEventWithPricing:719` `getEventForEdit:795` `updateEvent:830` `deleteEvent:969` |
| `apps/api/src/controllers/eventReviewController.js` | [Events](api-events.md) | `when:12` `seatingReady:15` `getSubmissionStatus:24` `submitEventForReview:54` `listEventsForReview:100` `reviewEvent:132` |
| `apps/api/src/controllers/gateController.js` | [Tickets, QR & gate](api-tickets-qr-gate.md) | `scanTicket:15` `getDynamicRotatingQR:68` `getRecentScans:111` `getEventGateStats:162` |
| `apps/api/src/controllers/intentAnalyticsController.js` | [Analytics & ML](api-analytics-ml.md) | `getEventIntentAnalytics:6` `sendAttendeeReminder:27` `sendBatchAttendeeReminders:61` `getAbandonedDashboard:86` `sendAbandonedReminder:113` `sendBatchAbandonedReminders:144` |
| `apps/api/src/controllers/mlController.js` | [Analytics & ML](api-analytics-ml.md) | `checkFraud:8` `forecastDemand:72` `scoreIntent:117` `trainModel:159` `getPredictionHistory:198` `getFraudWatchlist:242` `freezeUserAccount:307` `unfreezeUserAccount:353` |
| `apps/api/src/controllers/notificationController.js` | [Notifications & e-mail](api-notifications-email.md) | `getMyNotifications:8` `markNotificationAsRead:43` `markAllNotificationsAsRead:78` `deleteNotification:100` `registerFCMToken:133` `sendTestNotification:162` `previewEmailHTML:199` |
| `apps/api/src/controllers/resaleController.js` | [Resale, transfer & NFT](api-resale-transfer-nft.md) | `listTicketForResale:15` `cancelResaleListing:183` `getMarketListings:234` `getMyListings:356` `buyResaleTicket:385` |
| `apps/api/src/controllers/seatController.js` | [Venues & seats](api-venues-seats.md) | `getEventSeatMap:25` `lockSeat:128` `unlockSeat:296` `generateSeatGrid:356` |
| `apps/api/src/controllers/staffController.js` | [Companies & staff](api-companies-staff.md) | `serializeInvite:30` `handleError:32` `resolveCompanyScope:44` `canManageCompany:49` `newInviteToken:51` `sendInvite:56` `expireStaleInvites:66` `createInvite:75` `listStaff:156` `listInvitableEvents:209` `resendInvite:244` `cancelInvite:281` `deactivateStaff:304` `revokeEventAccess:344` `reactivateStaff:394` `getMyGateEvents:445` |
| `apps/api/src/controllers/ticketController.js` | [Tickets, QR & gate](api-tickets-qr-gate.md) | `mintOrderNFTs:15` `getMyNFTTickets:58` `getNFTTicketById:175` `getCustomerWallet:224` `downloadTicketPDF:359` `getTicketQR:396` `verifyTicketQRPost:446` |
| `apps/api/src/controllers/ticketTransferController.js` | [Resale, transfer & NFT](api-resale-transfer-nft.md) | `transferTicketDirectly:14` `joinEventWaitlist:187` `getEventWaitlistStatus:234` `getTicketTransferHistory:262` `getMyTransferHistory:290` |
| `apps/api/src/controllers/userController.js` | [Auth & accounts](api-auth-accounts.md) | `getProfile:30` `updateProfile:117` `changePassword:199` `updateWallet:236` `updateNotifications:332` `getAccountHistory:364` |
| `apps/api/src/controllers/venueController.js` | [Venues & seats](api-venues-seats.md) | `fail:21` `managedEvent:30` `listTemplates:39` `getEventVenue:51` `getMyHolds:60` `createHold:74` `releaseHold:105` `editorPayload:127` `getEditor:147` `saveDraft:169` `discardDraft:185` `publish:195` `uploadPlanImage:217` `createTier:230` `listReusable:242` |
| `apps/api/src/controllers/wishlistController.js` | [Events](api-events.md) | `getWishlistIds:10` `getWishlist:24` `addToWishlist:59` `removeFromWishlist:78` |
| `apps/api/src/middlewares/auth.js` | [API core](api-core.md) | `readBearer:17` `authenticateJWT:27` `requireRole:80` `requireApprovedCompany:108` `optionalAuth:131` |
| `apps/api/src/middlewares/rateLimit.js` | [API core](api-core.md) | `isTestRun:6` `tooManyRequests:8` |
| `apps/api/src/routes/eventRoutes.js` | [Events](api-events.md) | `eventMediaUpload:47` |
| `apps/api/src/routes/mlRoutes.js` | [Analytics & ML](api-analytics-ml.md) | `optionalAuth:17` |
| `apps/api/src/routes/venueRoutes.js` | [Venues & seats](api-venues-seats.md) | `planUpload:24` |
| `apps/api/src/seed.js` | [Scripts & tests](scripts-tests-infra.md) | `seedUsers:5` |
| `apps/api/src/server.js` | [API core](api-core.md) | `startServer:46` |
| `apps/api/src/services/accessService.js` | [Auth & accounts](api-auth-accounts.md) | `getScopedEventIds:10` `getOwnedCompanyId:35` |
| `apps/api/src/services/adminService.js` | [Analytics & ML](api-analytics-ml.md) | `getSuperAdminMetrics:9` `getUsersList:89` `updateUserStatus:158` `getAllEventsAdmin:247` `getAllTransactionsAdmin:319` `getBlockchainLogs:376` `getFraudAlerts:446` `getGateScanLogs:505` `getAuditLogs:554` |
| `apps/api/src/services/behaviorService.js` | [Analytics & ML](api-analytics-ml.md) | `extractSessionId:26` `trackBehavior:45` `attachSessionToUser:88` `getUserBehavioralProfile:112` |
| `apps/api/src/services/checkinService.js` | [Tickets, QR & gate](api-tickets-qr-gate.md) | `firstName:23` `seatLabel:24` `timeOf:29` `ticketView:31` `evaluate:43` `logScan:89` `eventStats:115` `broadcast:135` `response:147` `scan:156` `syncOffline:183` `eventPack:236` |
| `apps/api/src/services/emailLayout.js` | [Notifications & e-mail](api-notifications-email.md) | `logoAttachment:29` `frontendUrl:35` `esc:37` `wordmark:40` `tearLine:51` `factCard:57` `button:75` `codePanel:83` `notice:92` `paragraph:97` `renderEmail:103` |
| `apps/api/src/services/emailService.js` | [Notifications & e-mail](api-notifications-email.md) | `MAIL_FROM:12` `FRONTEND_URL:14` `logForLocalDev:17` `getTransporter:22` `escapeHtml:69` `generateEmailHTML:75` `sendEmailNotification:94` `getLastSentEmail:125` `subject:135` `text:136` `subject:142` `text:143` `sendOtpEmail:147` `sendStaffInviteEmail:215` `mailFrom:259` |
| `apps/api/src/services/eventMediaService.js` | [Events](api-events.md) | `constructor:6` `mb:12` `validateEventImage:18` `uploadEventImages:45` |
| `apps/api/src/services/fcmService.js` | [Notifications & e-mail](api-notifications-email.md) | `registerDeviceToken:9` `getUserDeviceTokens:21` `sendFCMPushNotification:29` |
| `apps/api/src/services/intentAnalyticsService.js` | [Analytics & ML](api-analytics-ml.md) | `getEventIntentAnalytics:8` `sendAttendeeReminder:286` `sendBatchAttendeeReminders:367` `getAbandonedIntentDashboard:415` `sendAbandonedCartReminder:691` `sendBatchAbandonedCartReminders:769` |
| `apps/api/src/services/mlService.js` | [Analytics & ML](api-analytics-ml.md) | `checkFraudRisk:9` `mlEventType:108` `forecastEventDemand:110` `scorePurchaseIntent:177` `triggerModelTraining:241` |
| `apps/api/src/services/nftService.js` | [Resale, transfer & NFT](api-resale-transfer-nft.md) | `constructor:20` `initProvider:27` `generateMetadata:42` `mintTicketNFT:67` `batchMintOrderTickets:198` |
| `apps/api/src/services/notificationService.js` | [Notifications & e-mail](api-notifications-email.md) | `dispatchNotification:22` |
| `apps/api/src/services/organizerDashboardService.js` | [Analytics & ML](api-analytics-ml.md) | `getOrganizerDashboardMetrics:7` |
| `apps/api/src/services/otpService.js` | [Auth & accounts](api-auth-accounts.md) | `generateCode:13` `hashCode:14` `codeMatches:15` `otpCooldownRemaining:24` `getOtpTiming:38` `issueOtp:59` `consumeOtp:83` |
| `apps/api/src/services/paymentService.js` | [Booking & payment](api-booking-payment.md) | `initiatePayment:16` `verifyPayment:103` |
| `apps/api/src/services/qrPassService.js` | [Tickets, QR & gate](api-tickets-qr-gate.md) | `loadKeys:23` `getPublicKey:49` `signPass:55` `verifyPass:65` `randomCode:84` `normaliseManualCode:91` `looksLikeManualCode:96` `assignManualCode:99` `ensureManualCodes:112` `passFor:120` |
| `apps/api/src/services/qrTicketService.js` | [Tickets, QR & gate](api-tickets-qr-gate.md) | `createSignedQRPayload:14` `generateQRDataUrl:43` `generateQRBuffer:58` `createDynamicQRPayload:71` `verifyOfflineHMAC:104` `verifyTicketQR:157` `processGateScan:209` `buildTicketPDF:354` |
| `apps/api/src/services/ticketPdf.js` | [Tickets, QR & gate](api-tickets-qr-gate.md) | `unsplash:45` `isImage:55` `loadEventPhoto:59` `drawIcon:80` `drawMark:86` `arcText:99` `star:115` `label:125` `drawTicketPdf:139` |
| `apps/api/src/services/tokenService.js` | [Auth & accounts](api-auth-accounts.md) | `sha256:16` `signAccessToken:18` `verifyAccessToken:22` `cookieOptions:28` `readCookie:40` `readRefreshCookie:50` `setPendingSignupCookie:60` `clearPendingSignupCookie:67` `readPendingSignupUserId:72` `clearRefreshCookie:83` `issueRefreshToken:90` `rotateRefreshToken:107` `revokeRefreshToken:138` `revokeAllRefreshTokens:149` |
| `apps/api/src/services/venueService.js` | [Venues & seats](api-venues-seats.md) | `constructor:13` `emitSeatChanges:23` `expireStaleHolds:46` `myOpenHoldCount:86` `assertRoom:92` `assertBookable:99` `holdView:107` `explainUnavailable:121` `holdSeat:130` `holdTable:153` `setGaQuantity:179` `releaseHolds:222` `autoProvisionVenueLayout:267` `getAvailability:362` `activeHoldsForUser:411` `publishDraft:468` `protectedKeys:576` |
| `apps/api/src/utils/eventAccess.js` | [API core](api-core.md) | `canManageEvent:7` |
| `apps/api/src/utils/imageInspect.js` | [API core](api-core.md) | `inspectPng:13` `inspectJpeg:21` `inspectWebp:39` `inspectImage:60` |
| `apps/api/src/utils/storage.js` | [API core](api-core.md) | `uploadFile:31` |
| `apps/api/test_auth.mjs` | [Scripts & tests](scripts-tests-infra.md) | `json:8` `refreshCookieOf:15` |
| `apps/api/test_email_otp_signup.mjs` | [Scripts & tests](scripts-tests-infra.md) | `json:8` |
| `apps/api/test_event_media.mjs` | [Scripts & tests](scripts-tests-infra.md) | `crc32:19` `chunk:24` `png:33` `file:47` `banner:49` `card:50` `wide:51` `square:52` |
| `apps/api/test_resale.mjs` | [Scripts & tests](scripts-tests-infra.md) | `registerVerifiedCustomer:8` |
| `apps/api/test_venue_layouts.mjs` | [Scripts & tests](scripts-tests-infra.md) | `png:11` `rect:41` |
| `apps/ml-service/main.py` | [ML service](ml-service.md) | `load_models:47` `execute_fraud_score:149` `execute_demand_forecast:234` `execute_intent_predict:307` `read_root:362` `health_check:384` `get_model_metrics:398` `post_fraud_score:409` `post_predict_fraud_alias:413` `post_forecast_demand:417` `post_predict_demand_alias:421` `post_intent_predict:425` `post_predict_intent_alias:429` `post_train_intent:436` `post_train_fraud:455` `post_train_demand:474` |
| `apps/ml-service/scripts/evaluate_models.py` | [ML service](ml-service.md) | `evaluate_all:28` |
| `apps/ml-service/scripts/generate_synthetic_data.py` | [ML service](ml-service.md) | `check_huggingface_datasets:45` `generate_behavior_sequences:64` `generate_fraud_purchases:134` `generate_event_demand:215` `generate_attendance_no_show:303` `main:353` |
| `apps/ml-service/scripts/train_demand_model.py` | [ML service](ml-service.md) | `train_demand:27` |
| `apps/ml-service/scripts/train_fraud_model.py` | [ML service](ml-service.md) | `train_fraud:31` |
| `apps/ml-service/scripts/train_intent_model.py` | [ML service](ml-service.md) | `train_intent:27` |
| `apps/ml-service/test_health.py` | [ML service](ml-service.md) | `test_root:6` `test_health:11` |
| `apps/ml-service/train_models.py` | [ML service](ml-service.md) | `train_fraud_model:25` `train_demand_model:68` `train_intent_model:135` |
| `apps/venue-core/src/generate.js` | [Venues & seats](api-venues-seats.md) | `rowsOf:45` `tablesOf:46` `gaOf:47` `rowLabel:49` `seatCountForRow:61` `aislesBefore:66` `rowOffsets:69` `rowTracks:81` `at:97*` `labelAt:101*` `toWorld:123*` `toWorld:134*` `at:154*` `labelAt:161*` `maxSeatsInRow:173` `fitRows:183` `maxRows:192` `generateRows:200` `generateTables:256` `generateSection:313` |
| `apps/venue-core/src/geometry.js` | [Venues & seats](api-venues-seats.md) | `polar:9` `rotate:11` `round:19` `shapePolygon:22` `shapePath:51` `bounds:65` `boxesOverlap:79` `pointInPolygon:81` `polygonCentroid:91` `shapeAnchor:109` `moveShape:128` `shapeBounds:144` `widestChord:149` |
| `apps/venue-core/src/index.js` | [Venues & seats](api-venues-seats.md) | `layoutInventory:12` |
| `apps/venue-core/src/templates.js` | [Venues & seats](api-venues-seats.md) | `newSectionId:11` `seats:13` `ga:14` `tables:15` `arc:16` `rect:17` `cricket:19` `football:37` `S:38*` `corner:39*` `hockey:56` `arena:69` `S:70*` `concert:85` `qawwali:99` `theatre:114` `conference:131` `B:132*` `general:140` `custom:153` `build:161` `build:162` `suggestTemplate:185` `assignTiers:188` `buildTemplate:198` |
| `apps/venue-core/src/validate.js` | [Venues & seats](api-venues-seats.md) | `finite:5` `shapeError:7` `segmentsCross:30` `o:31*` `polygonsOverlap:35` `validateLayout:48` |
| `apps/web/src/App.jsx` | [Web core](web-core.md) | `SiteChrome:77` `ScrollToTop:93` `RouteLoader:106` `App:121` |
| `apps/web/src/components/HoldBar.jsx` | [Web components](web-components.md) | `clock:7` `HoldBar:14` `onChange:39*` |
| `apps/web/src/components/NotificationBell.jsx` | [Web components](web-components.md) | `getNotificationIcon:23` `formatTimeAgo:50` `NotificationBell:61` `fetchNotifications:70*` `handleNewNotification:95*` `handleClickOutside:116*` `handleMarkAsRead:125*` `handleMarkAllRead:138*` `handleNotificationClick:148*` |
| `apps/web/src/components/ProtectedRoute.jsx` | [Web components](web-components.md) | `ProtectedRoute:11` |
| `apps/web/src/components/StaffManager.jsx` | [Web components](web-components.md) | `Badge:9` `formatDate:11` `StaffManager:18` `revokeEvent:76*` `run:88*` `handleInvite:103*` `initials:118*` |
| `apps/web/src/components/account/AccountShell.jsx` | [Web components](web-components.md) | `AccountPortal:14` `hideBroken:19` `AccountShell:38` `AccountSection:129` |
| `apps/web/src/components/account/ChangePasswordCard.jsx` | [Web components](web-components.md) | `test:7` `test:8` `test:9` `PasswordInput:13` `ChangePasswordCard:39` `submit:51*` |
| `apps/web/src/components/account/NftTicketCard.jsx` | [Web components](web-components.md) | `pkr:8` `NftTicketCard:14` `copyTx:33*` |
| `apps/web/src/components/account/WalletPass.jsx` | [Web components](web-components.md) | `seatParts:10` `MoreMenu:17` `WalletPass:68` |
| `apps/web/src/components/account/accountMotion.js` | [Web components](web-components.md) | `initAccountMotion:17` `setTone:24*` `onToggle:42*` `onToggle:48*` `cleanup:54*` `end:74*` `revert:105*` `refreshAccountMotion:117` |
| `apps/web/src/components/auth/AuthShell.jsx` | [Web components](web-components.md) | `TicketArt:8` `AuthShell:64` `Alert:101` `Field:113` `SubmitButton:138` `OtpInput:157` `setDigits:161*` `handleChange:163*` `handleKeyDown:178*` |
| `apps/web/src/components/basic/BasicShell.jsx` | [Web components](web-components.md) | `BasicShell:12` `update:26*` |
| `apps/web/src/components/booking/BookingShell.jsx` | [Web components](web-components.md) | `BookingSteps:16` `BookingShell:33` |
| `apps/web/src/components/booking/OrderConfirmedModal.jsx` | [Web components](web-components.md) | `seatLabel:11` `unique:17` `OrderConfirmedModal:23` |
| `apps/web/src/components/brand/BrandLogo.jsx` | [Web components](web-components.md) | `BrandLogo:12` |
| `apps/web/src/components/dash/DashShell.jsx` | [Web components](web-components.md) | `DashShell:61` `update:80*` `DashHead:127` `Segmented:156` `DashCard:171` `Figure:195` `Chip:208` `Kpi:220` `Tile:231` `formatPlace:254` `hideBroken:257` `EventTile:263` `EventThumb:289` `TicketCard:301` `statusTone:326` `pretty:327` `Status:330` `Notice:334` `DashState:344` |
| `apps/web/src/components/dash/SetupStepper.jsx` | [Web components](web-components.md) | `SetupStepper:18` |
| `apps/web/src/components/dash/Studio.jsx` | [Web components](web-components.md) | `StudioHead:10` `StudioSelect:33` `StatCard:46` `Panel:65` `Badge:89` `initials:98` `Avatar:102` `Pager:111` `ScoreBar:131` `ApStat:142` `UnderlineTabs:156` `RecordCard:169` `TabStats:195` `Directory:212` |
| `apps/web/src/components/dash/charts.jsx` | [Web components](web-components.md) | `compact:13` `trim:15*` `formatPkr:20` `compactPkr:21` `niceScale:24` `useWidth:34` `labelEvery:48` `ColumnChart:51` `smoothPath:108` `clamp:110*` `LineChart:125` `onMove:140*` `Legend:199` `SplitBar:214` `FillGauge:230` `wave:234*` `polar:253` `arcPath:257` `ArcGauge:264` `Meter:308` `byDay:319` `Ring:341` |
| `apps/web/src/components/event-detail/ContactOrganizer.jsx` | [Web components](web-components.md) | `ContactOrganizer:8` `copy:28*` |
| `apps/web/src/components/event-detail/EventGallery.jsx` | [Web components](web-components.md) | `photo:13` `photoId:19` `sizedWide:22` `sizedCard:24` `fill:27` `buildCards:37` `EventGallery:62` `wrap:87*` `render:88*` `tick:90*` `onToggle:107*` `onUpdate:110*` `onMove:121*` `onUp:131*` `hideBroken:161*` `renderList:162*` |
| `apps/web/src/components/event-form/GalleryField.jsx` | [Web components](web-components.md) | `galleryItemsFromSaved:12` `newItem:14` `itemSrc:15` `GalleryField:21` `onSelect:43*` `move:64*` `onDrop:72*` |
| `apps/web/src/components/event-form/ImageCropper.jsx` | [Web components](web-components.md) | `clamp:7` `toBlob:9` `ImageCropper:18` `clampCenter:59*` `onLoad:62*` `onPointerDown:70*` `onPointerMove:75*` `onPointerUp:80*` `onKeyDown:83*` `onZoom:90*` `apply:97*` |
| `apps/web/src/components/event-form/ImageField.jsx` | [Web components](web-components.md) | `emptyImageValue:17` `imageValueSrc:20` `ImageField:26` `acceptFile:37*` `onSelect:41*` |
| `apps/web/src/components/event-form/LocationPicker.jsx` | [Web components](web-components.md) | `fix:9` `parseMapsLink:14` `LocationPicker:41` `pick:60*` `search:125*` `choose:146*` `useLink:155*` |
| `apps/web/src/components/event-form/PreviewFrame.jsx` | [Web components](web-components.md) | `sentence:4` `PreviewFrame:11` |
| `apps/web/src/components/events/EventTile.jsx` | [Web components](web-components.md) | `formatDate:11` `formatPlace:14` `priceLabel:17` `finePointer:23` `reducedMotion:24` `EventTile:31` `onPointerMove:47*` `onPointerEnter:65*` `onPointerLeave:73*` `fallback:79*` |
| `apps/web/src/components/events/PixelLoader.jsx` | [Web components](web-components.md) | `PixelLoader:15` `step:33*` |
| `apps/web/src/components/home/CategoryCard.jsx` | [Web components](web-components.md) | `hideBroken:5` `CategoryCard:8` |
| `apps/web/src/components/home/EventCard.jsx` | [Web components](web-components.md) | `formatPlace:12` `formatDate:15` `EventCard:17` |
| `apps/web/src/components/home/EventMap.jsx` | [Web components](web-components.md) | `hasPin:10` `formatDate:45` `anchorFor:51` `buildCard:59` `onerror:65*` `EventMap:89` `onWheel:132*` `showCard:155*` `reposition:168*` `hideCard:186*` `show:222*` |
| `apps/web/src/components/home/HeaderAccount.jsx` | [Web components](web-components.md) | `timeAgo:10` `HeaderAccount:23` `toggle:78*` |
| `apps/web/src/components/home/HeaderIcons.jsx` | [Web components](web-components.md) | `TicketCartIcon:7` `TicketBellIcon:30` `TicketUserIcon:52` `MenuTicketIcon:74` |
| `apps/web/src/components/home/HomeHeader.jsx` | [Web components](web-components.md) | `prefersReducedMotion:11` `useMenuGroups:17` `HomeHeader:93` `handleScroll:112*` `onNavigate:247*` `onLogout:253*` |
| `apps/web/src/components/home/SiteFooter.jsx` | [Web components](web-components.md) | `organizerAction:7` `SiteFooter:26` |
| `apps/web/src/components/home/homeData.js` | [Web components](web-components.md) | `unsplash:4` `clip:35` `categoryName:77` |
| `apps/web/src/components/home/homeMotion.js` | [Web components](web-components.md) | `holeCoverScale:15` `staggerTo:27` `coverScene:35` `initTrail:49` `show:58*` `tick:63*` `onMove:77*` `onLeave:88*` `jumpToProgress:99` `initHomeMotion:112` `setTone:120*` `onFocusIn:134*` `onToggle:142*` `onToggle:143*` `onToggle:152*` `panelInset:171*` `end:191*` `end:258*` `end:310*` `start:344*` `onToggle:348*` `refreshScrollScenes:367` |
| `apps/web/src/components/motion/AwayTitle.jsx` | [Web components](web-components.md) | `AwayTitle:10` `onChange:15*` |
| `apps/web/src/components/motion/SmoothScroll.jsx` | [Web components](web-components.md) | `SmoothScroll:17` `easing:22*` `prevent:26*` `tick:31*` `sync:36*` |
| `apps/web/src/components/motion/SplashScreen.jsx` | [Web components](web-components.md) | `SplashScreen:19` `handleReplay:41*` `onComplete:77*` `onUpdate:148*` `handleKeyDown:217*` |
| `apps/web/src/components/motion/stackSections.js` | [Web components](web-components.md) | `stackSections:21` `setStickTop:25*` `onRefreshInit:30*` `onRefresh:31*` |
| `apps/web/src/components/resale/resaleMotion.js` | [Web components](web-components.md) | `initResaleMotion:17` `setTone:25*` `onFocusIn:42*` `onToggle:55*` `onToggle:63*` `cleanup:69*` `end:86*` `end:127*` `onEnter:151*` |
| `apps/web/src/components/scanner/QrCamera.jsx` | [Web components](web-components.md) | `QrCamera:11` `stop:29*` `start:35*` `emit:86*` `loop:94*` `toggleTorch:133*` |
| `apps/web/src/components/ui/DialogProvider.jsx` | [Web components](web-components.md) | `themeFor:12` `DialogProvider:25` `close:40*` `Dialog:53` `useDialog:107` |
| `apps/web/src/components/ui/SelectEnhancer.jsx` | [Web components](web-components.md) | `themeOf:9` `readOptions:16` `SelectEnhancer:36` `onPointer:65*` `onMouseDown:68*` `onKeyDown:76*` `onTouchStart:86*` `onTouchEnd:90*` `place:119*` `step:172*` |
| `apps/web/src/components/venue/BookingSummary.jsx` | [Web components](web-components.md) | `pad:5` `formatClock:6` `summaryLines:9` `groupByTier:38` `lineTitle:51` `lineDetail:53` `HoldTimer:55` `MyTicketsButton:65` `MyTicketsPanel:79` |
| `apps/web/src/components/venue/SeatPopover.jsx` | [Web components](web-components.md) | `SeatPopover:12` `onKeyDown:22*` |
| `apps/web/src/components/venue/VenueBooking.jsx` | [Web components](web-components.md) | `LegendSeat:21` `SeatLegend:42` `VenueBooking:59` `patch:121*` `priceOf:233*` `requireLogin:248*` `run:262*` `toggleSeat:280*` `toggleTable:294*` `selectFromPop:357*` `removeFromPop:366*` `setGa:372*` `onMapKeyDown:427*` `removeLine:467*` `getTickets:475*` |
| `apps/web/src/components/venue/VenueFeature.jsx` | [Web components](web-components.md) | `VenueFeature:7` `VenueDefs:103` |
| `apps/web/src/components/venue/VenueMap.jsx` | [Web components](web-components.md) | `lodFor:9` `seatAngles:19` `centre:26*` `Chair:60` `SeatSymbol:69` `SectionDetail:83` `VenueMap:146` `fitAll:212*` `fitSection:213*` `svg:223*` `handleClick:233*` `hoverFrom:244*` `focusFrom:251*` `labelSpace:261*` `fitText:268*` |
| `apps/web/src/components/venue/adapters.js` | [Web components](web-components.md) | `liveAdapter:8` `unwrap:9*` `load:18*` `hold:19*` `release:20*` `previewAdapter:28` `view:33*` `room:46*` `snapshot:49*` `wait:71*` `load:74*` `hold:75*` `release:104*` |
| `apps/web/src/components/venue/editor/EditorOverlay.jsx` | [Web components](web-components.md) | `EditorOverlay:8` `drag:11*` `move:15*` `up:16*` `H:27*` `corner:48*` `corner:102*` `angleAt:150*` `dist:160*` |
| `apps/web/src/components/venue/editor/MiniPlan.jsx` | [Web components](web-components.md) | `MiniPlan:7` |
| `apps/web/src/components/venue/editor/SectionInspector.jsx` | [Web components](web-components.md) | `Stat:7` `Group:14` `ShapeFields:26` `SectionInspector:62` `set:67*` `setRows:68*` |
| `apps/web/src/components/venue/editor/fields.jsx` | [Web components](web-components.md) | `Field:5` `NumberField:16` `TextField:43` `SelectField:52` `Segmented:65` `ConfirmDialog:88` |
| `apps/web/src/components/venue/useCamera.js` | [Web components](web-components.md) | `useCamera:17` `size:30*` `pxPerUnit:34*` `fitScale:35*` `clamp:63*` `onUpdate:83*` `onMove:178*` `onUp:207*` `onWheel:214*` `zoomIn:236*` `zoomOut:237*` `wasDrag:240*` `scale:241*` |
| `apps/web/src/components/venue/venueTheme.js` | [Web components](web-components.md) | `tierPalette:10` `formatPkr:19` `generated:33` `sectionBox:43` `layoutBox:53` `geometryBox:64` `reducedMotion:80` |
| `apps/web/src/context/AuthContext.jsx` | [Web core](web-core.md) | `readLastActive:12` `writeLastActive:19` `tokenExpiry:27` `authRequest:40` `AuthProvider:59` `onActivity:159*` `check:166*` `onVisible:179*` `login:189*` `signup:195*` `getPendingSignup:198*` `updatePendingSignup:200*` `verifyOtp:202*` `resendOtp:208*` `forgotPassword:210*` `resetPassword:212*` `getInvite:215*` `acceptInvite:218*` `refreshUser:225*` `logout:234*` `useAuth:270` |
| `apps/web/src/context/WishlistContext.jsx` | [Web core](web-core.md) | `WishlistProvider:13` `useWishlist:80` |
| `apps/web/src/hooks/useCartHolds.js` | [Web core](web-core.md) | `useCartHolds:6` `onChange:36*` |
| `apps/web/src/lib/gateOffline.js` | [Web core](web-core.md) | `openDb:17` `tx:34` `savePack:45` `loadPack:46` `markUsedLocally:50` `usedLocally:51` `enqueue:52` `queued:53` `dequeue:57` `wipeEvent:64` `safeGet:75` `safeSet:82` `deviceId:89` `noteOnline:97` `lastOnline:98` `offlineTooLong:99` `b64urlToBytes:105` `normaliseManualCode:111` `isManualCode:115` `importKey:118` `verifySignature:126` `timeOf:137` `evaluateOffline:143` |
| `apps/web/src/lib/session.js` | [Web core](web-core.md) | `getAccessToken:12` `setAccessToken:13` `setSessionHandlers:18` `refreshAccessToken:23` `isApiRequest:25` `installFetchInterceptor:33` `installAxiosInterceptor:61` `getHomeRoute:95` |
| `apps/web/src/lib/validation.js` | [Web core](web-core.md) | `validateName:3` `validateEmail:10` `validatePhone:14` `validatePassword:21` `validateOtp:28` `firstError:31` |
| `apps/web/src/pages/AbandonedIntentDashboard.jsx` | [Web pages](web-pages.md) | `reasonOf:33` `intentOf:34` `Journey:37` `AbandonedIntentDashboard:58` `fetchEvents:84*` `fetchDashboardData:97*` `setFilter:124*` `handleSendReminder:133*` `handleBatchSendReminders:162*` |
| `apps/web/src/pages/About.jsx` | [Web pages](web-pages.md) | `About:21` |
| `apps/web/src/pages/AcceptInvite.jsx` | [Web pages](web-pages.md) | `AcceptInvite:9` `update:29*` `handleSubmit:34*` |
| `apps/web/src/pages/AdminCompanies.jsx` | [Web pages](web-pages.md) | `AdminCompanies:26` `loadCompanies:40*` `handleApprove:69*` `handleSuspend:97*` `submitRejection:125*` |
| `apps/web/src/pages/AdminEventApprovals.jsx` | [Web pages](web-pages.md) | `pkr:11` `ReviewCard:19` `decide:27*` `AdminEventApprovals:114` |
| `apps/web/src/pages/AdminFraudWatchlist.jsx` | [Web pages](web-pages.md) | `riskOf:28` `AdminFraudWatchlist:30` `fetchWatchlist:41*` `handleToggleFreezeUser:61*` |
| `apps/web/src/pages/BehaviorProfile.jsx` | [Web pages](web-pages.md) | `actionInfo:48` `test:54` `test:55` `test:56` `test:57` `test:58` `test:59` `formatTimeAgo:62` `ScoreCard:70` `BehaviorProfile:87` `fetchProfile:99*` `handleSimulate:115*` `setFilter:148*` |
| `apps/web/src/pages/BookingSuccess.jsx` | [Web pages](web-pages.md) | `seatFacts:13` `BookingSuccess:25` `head:73*` |
| `apps/web/src/pages/Categories.jsx` | [Web pages](web-pages.md) | `Categories:12` `focusGrid:36*` |
| `apps/web/src/pages/Checkout.jsx` | [Web pages](web-pages.md) | `digits:29` `normalizePhone:31` `loadReservation:37` `paymentDetailsFor:53` `validate:60` `Field:73` `CheckoutContent:89` `handleGlobalClick:97*` `simulateBot:99*` `release:200*` `removeLine:231*` `discardAll:232*` `setField:250*` `submit:255*` `Checkout:664` |
| `apps/web/src/pages/CompanyRegistration.jsx` | [Web pages](web-pages.md) | `CompanyRegistration:27` `loadCompany:48*` `handleChange:85*` `handleSubmit:89*` |
| `apps/web/src/pages/Contact.jsx` | [Web pages](web-pages.md) | `Contact:19` `set:36*` `submit:41*` `field:62*` |
| `apps/web/src/pages/CreateEvent.jsx` | [Web pages](web-pages.md) | `emptyImages:59` `toTimeInput:67` `fromTimeInput:75` `todayIso:81` `Field:86` `Tips:96` `CreateEvent:121` `checkCompanyStatus:164*` `update:213*` `setImage:218*` `handleAddTier:226*` `handleRemoveTier:227*` `handleTierChange:232*` `validateStep:240*` `goTo:262*` `createEvent:284*` `saveEdits:331*` |
| `apps/web/src/pages/Dashboard.jsx` | [Web pages](web-pages.md) | `hideBroken:20` `CollageTile:23` `useCollageClips:49` `tileAt:57*` `stop:64*` `start:70*` `onMove:81*` `onUp:86*` `onLeave:92*` `Strips:104` `Dashboard:110` `onChange:123*` `save:163*` `skipIntro:201*` `foldOnPhones:234*` `setFilter:244*` `clearMapFilters:249*` `submitSearch:251*` |
| `apps/web/src/pages/DemandForecast.jsx` | [Web pages](web-pages.md) | `DemandForecast:29` `fetchEvents:51*` `fetchPreLaunchForecast:69*` `handlePriceChange:120*` `handleSavePrices:127*` `handlePublishEvent:152*` |
| `apps/web/src/pages/DigitalWallet.jsx` | [Web pages](web-pages.md) | `DigitalWallet:43` `fetchWallet:92*` `copyToClipboard:124*` `handleDownloadPDF:130*` `handleSimulateGateScan:157*` `handleExecuteTransfer:189*` `handleExecuteResaleListing:228*` `handleOpenTicketHistory:275*` `handleOpenMyTransfers:296*` |
| `apps/web/src/pages/EventDetails.jsx` | [Web pages](web-pages.md) | `reducedMotion:34` `formatPkr:35` `getSaleState:38` `getStartingPrice:59` `prices:60*` `pickRelated:69` `score:71*` `EventDetails:79` `Row:84` `EventDetailsPage:94` `onBack:124*` `joinWaitlist:207*` `onToggle:236*` `onComplete:260*` `shareEvent:305*` `bookingAction:330*` |
| `apps/web/src/pages/EventSubmit.jsx` | [Web pages](web-pages.md) | `pkr:15` `CheckRow:19` `EventSubmit:35` `submit:59*` |
| `apps/web/src/pages/Events.jsx` | [Web pages](web-pages.md) | `labelOf:47` `sortEvents:49` `price:50*` `time:51*` `Events:60` `clearFilters:99*` `rememberPosition:184*` `pickCategory:210*` `onToggle:224*` |
| `apps/web/src/pages/ForgotPassword.jsx` | [Web pages](web-pages.md) | `ForgotPassword:8` `handleSubmit:17*` |
| `apps/web/src/pages/GateScanner.jsx` | [Web pages](web-pages.md) | `readGate:22` `writeGate:29` `ago:36` `clock:41` `feedback:45` `Verdict:68` `EventPicker:84` `GateScanner:117` `chooseGate:172*` `goOnline:249*` `goOffline:255*` `check:268*` `submitManual:343*` `manualForm:366*` |
| `apps/web/src/pages/Legal.jsx` | [Web pages](web-pages.md) | `Legal:167` |
| `apps/web/src/pages/Login.jsx` | [Web pages](web-pages.md) | `Login:29` `handleSubmit:66*` |
| `apps/web/src/pages/MyBookings.jsx` | [Web pages](web-pages.md) | `MyBookings:21` `fetchBookings:28*` |
| `apps/web/src/pages/MyNFTTickets.jsx` | [Web pages](web-pages.md) | `MyNFTTickets:37` `fetchNFTs:54*` `copyToClipboard:77*` `handleOpenResaleModal:83*` `handleListTicket:90*` `handleCancelListing:132*` |
| `apps/web/src/pages/NotFound.jsx` | [Web pages](web-pages.md) | `Art:9` `NotFound:73` |
| `apps/web/src/pages/Notifications.jsx` | [Web pages](web-pages.md) | `Notifications:40` `fetchNotifications:53*` `handleMarkAsRead:73*` `handleMarkAllRead:85*` `handleDelete:95*` `handleSimulateNotification:106*` `getIcon:148*` `toneOf:152*` |
| `apps/web/src/pages/OrganizerDashboard.jsx` | [Web pages](web-pages.md) | `dayLabel:38` `eventDate:39` `place:41` `startOfToday:52` `totalsByEvent:59` `EventCard:72` `OrganizerDashboard:119` `deleteEvent:122*` `load:153*` `fetchDashboard:164*` `changeEvent:256*` |
| `apps/web/src/pages/Profile.jsx` | [Web pages](web-pages.md) | `Profile:58` `loadProfile:107*` `loadHistory:140*` `loadBehaviorProfile:155*` `handleAvatarFile:181*` `onload:184*` `handleUpdateProfile:192*` `connectMetaMask:232*` `switchToPolygonAmoy:261*` `saveWalletToBackend:291*` `handleDisconnectWallet:317*` `handleSaveNotifications:323*` `goTab:356*` `getBreadcrumbLabel:372*` |
| `apps/web/src/pages/PurchaseIntentAnalytics.jsx` | [Web pages](web-pages.md) | `levelTone:27` `stageLabel:28` `actionLabel:30` `PurchaseIntentAnalytics:35` `fetchEvents:56*` `fetchAnalytics:72*` `handleSelectEvent:99*` `handleSendReminder:106*` `handleBatchReminder:133*` `reminderButton:165*` |
| `apps/web/src/pages/ResaleMarketplace.jsx` | [Web pages](web-pages.md) | `hideBroken:37` `rupees:38` `markupLabel:40` `ResaleMarketplace:42` `fetchListings:72*` `handleSearchSubmit:101*` `handleReset:106*` `handleBuyTicket:114*` `openPurchase:154*` `save:180*` `PurchaseDialog:566` |
| `apps/web/src/pages/ResetPassword.jsx` | [Web pages](web-pages.md) | `ResetPassword:10` `handleSubmit:32*` `handleResend:60*` |
| `apps/web/src/pages/SeatMap.jsx` | [Web pages](web-pages.md) | `SeatMap:33` `LegacySeatMap:92` `getAuthHeaders:115*` `fetchSeatMap:124*` `handleSeatClick:261*` `updateLocalSeatStatus:341*` `formatTimer:371*` |
| `apps/web/src/pages/Signup.jsx` | [Web pages](web-pages.md) | `Signup:14` `update:54*` `validate:60*` `handleSubmit:72*` |
| `apps/web/src/pages/StaffEvents.jsx` | [Web pages](web-pages.md) | `startOfToday:9` `StaffEvents:18` |
| `apps/web/src/pages/SuperAdminDashboard.jsx` | [Web pages](web-pages.md) | `shortDate:61` `shortTime:62` `Loading:64` `Table:73` `SuperAdminDashboard:87` `deleteEvent:90*` `getJson:141*` `fetchMetrics:147*` `fetchOverview:160*` `fetchTabData:183*` `countOf:224*` `fetchTabStats:232*` `openTab:257*` `runSearch:263*` `handleUpdateStatusConfirm:269*` `dateOf:301*` `pick:301*` `dateOf:306*` `pick:306*` `dash:343*` `refreshAll:345*` `searchBox:351*` `pagerProps:359*` `onPage:365*` |
| `apps/web/src/pages/Suspended.jsx` | [Web pages](web-pages.md) | `Suspended:7` |
| `apps/web/src/pages/VenueEditor.jsx` | [Web pages](web-pages.md) | `json:35` `Banner:37` `PlanSources:58` `SectionIcon:109` `VenueEditor:114` `warn:174*` `undo:197*` `redo:205*` `updateSection:213*` `liveShape:216*` `liveFeature:220*` `commitDrag:224*` `replaceLayout:287*` `apply:288*` `chooseTemplate:313*` `openReuse:315*` `chooseReuse:323*` `uploadPlan:331*` `uniqueName:362*` `addSection:368*` `finishDrawing:391*` `mapClickPoint:418*` `toggleBlocked:424*` `saveDraft:437*` `publish:464*` `onConfirm:492*` `discard:519*` `onConfirm:525*` `addTier:537*` `shift:867*` `onConfirm:877*` |
| `apps/web/src/pages/VerifyOtp.jsx` | [Web pages](web-pages.md) | `formatClock:9` `VerifyOtp:14` `handleVerify:71*` `handleResend:98*` |
| `apps/web/src/pages/Wishlist.jsx` | [Web pages](web-pages.md) | `Wishlist:22` `load:31*` |
| `apps/web/src/utils/api.js` | [Web core](web-core.md) | `getClientSessionId:14` `trackClientBehavior:40` |
| `apps/web/src/utils/eventImageSpecs.js` | [Web core](web-core.md) | `formatMb:77` `specHelperText:80` `specLimitText:84` `ratioMatches:89` `readImageSize:92` `checkImageFile:112` |
| `apps/web/src/utils/eventMedia.js` | [Web core](web-core.md) | `resolveMediaUrl:94` `getEventVisual:96` |
| `apps/web/src/utils/eventTime.js` | [Web core](web-core.md) | `formatEventDate:8` `formatEventTime:12` `eventDayEnd:15` |
| `apps/web/src/utils/maps.js` | [Web core](web-core.md) | `googleMapsUrl:2` |
| `contracts/contracts/TicketLedgerNFT.sol` | [Resale, transfer & NFT](api-resale-transfer-nft.md) | `constructor:65` `setMinterStatus:76` `mintTicket:84` `batchMintTickets:126` `validateResalePrice:181` `getTicketDetails:191` `invalidateTicket:216` `onlyMinterOrOwner (modifier):57` |
| `contracts/scripts/deploy.cjs` | [Resale, transfer & NFT](api-resale-transfer-nft.md) | `main:3` |
| `scripts/demo_live_checkout_to_metamask.mjs` | [Scripts & tests](scripts-tests-infra.md) | `main:8` |
| `scripts/mint_to_user.mjs` | [Scripts & tests](scripts-tests-infra.md) | `mintToUser:4` |
| `scripts/simulate_scalper_bot.js` | [Scripts & tests](scripts-tests-infra.md) | `run:6` |
| `scripts/test_blockchain_scenarios.mjs` | [Scripts & tests](scripts-tests-infra.md) | `runBlockchainVerification:10` |
| `scripts/test_live_mint.mjs` | [Scripts & tests](scripts-tests-infra.md) | `testLiveMint:5` |
