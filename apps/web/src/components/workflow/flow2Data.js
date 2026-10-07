/**
 * Corrected TicketLedger workflows for flow2.html: every module as the code works at commit 323a885
 * (7 October 2026). Pages that show "Coming soon" in the app are marked status: 'In progress' and drawn as
 * short flows. Same data format as flowData.js, rendered by the same engine.
 */
export function buildWorkflowData() {
  const S = (actor, title, note, detail) => ({ actor, title, note, detail });
  const BASIS = 'Code-verified · commit 323a885 · 7 October 2026';
  const PROGRESS = 'In progress';

  const flows = [
    // ---------------- Account & access ----------------
    {
      id: 'signup', group: 'Account & access', label: 'Sign-up & email verification', basis: BASIS + ' · customer or organizer',
      steps: [
        S('Browser', 'Fill in sign-up form', 'Customer or organizer', 'Signup.jsx checks name, e-mail, Pakistani mobile number, password strength and the terms box, then AuthContext.signup sends POST /api/auth/signup.'),
        S('API', 'Validate details', 'Zod · e-mail must be new', 'Invalid fields return 400; an e-mail that already has an account returns 409. The phone number may be shared with another account.'),
        S('Database', 'Save pending user', 'PENDING_VERIFICATION', 'The password is hashed with bcrypt and the User is created as CUSTOMER or ORGANIZER; a signed pending-signup cookie lets the browser correct the details.'),
        S('Email service', 'Send 6-digit code', '10-minute expiry · resend cooldown', 'issueOtp stores an HMAC of the code, cancels earlier codes and e-mails the new one.'),
        S('Browser → API', 'Enter the code', 'POST /api/auth/verify-otp', 'VerifyOtp.jsx sends the code; consumeOtp checks expiry, the attempt limit and single use.'),
        S('Database', 'Activate account', 'ACTIVE · emailVerifiedAt', 'A valid code is consumed and the account becomes ACTIVE.'),
        S('API → Browser', 'Start session', 'Access token + refresh cookie', 'startSession returns a 15-minute access token and sets the httpOnly refresh cookie.'),
        S('Browser', 'Open next page', 'Organizer → company registration', 'Customers continue to the site; organizers are sent to register their company before they can create events.'),
      ],
    },
    {
      id: 'login', group: 'Account & access', label: 'Login & protected access', basis: BASIS + ' · active account',
      steps: [
        S('Browser', 'Submit credentials', 'POST /api/auth/login', 'Login.jsx sends the e-mail and password (demo logins can fill them in).'),
        S('API', 'Check password', 'bcrypt comparison', 'Unknown e-mail and wrong password both return the same 401 response.'),
        S('API + Database', 'Check account status', 'Active / pending / blocked', 'Pending accounts are sent to e-mail verification; suspended, banned or deactivated accounts get 403 and the Suspended page.'),
        S('API → Browser', 'Issue session', 'Token in memory; cookie set', 'For an active account the API stores a refresh-token row and returns the access token.'),
        S('API + Database', 'Link guest activity', 'Session ID → user ID', 'trackLogin links anonymous BehaviorEvent rows to the signed-in user.'),
        S('Browser → API', 'Request protected data', 'Authorization: Bearer token', 'The axios interceptor adds the in-memory access token to protected requests.'),
        S('API', 'Check user and role', 'authenticateJWT → requireRole', 'The API reloads the user and enforces role permissions before the action runs.'),
      ],
    },
    {
      id: 'refresh', group: 'Account & access', label: 'Restore & refresh session', basis: BASIS + ' · valid refresh cookie',
      steps: [
        S('Browser', 'Restore session', 'Page load or token expiry', 'AuthContext refreshes on start-up and before the access token expires; a 30-minute idle session signs out instead.'),
        S('Browser → API', 'Send refresh cookie', 'POST /api/auth/refresh', 'The browser automatically includes the httpOnly tl_refresh cookie.'),
        S('API + Database', 'Find hashed token', 'SHA-256 lookup', 'rotateRefreshToken checks the stored token, its expiry, revocation and the idle limit; a reused token revokes the whole family.'),
        S('Database', 'Rotate refresh token', 'Revoke old; create new', 'A conditional update lets only one concurrent rotation win; a new token row is created.'),
        S('API → Browser', 'Return new session', 'New cookie + access token', 'The API replaces the refresh cookie and returns the current user and access token.'),
        S('Browser', 'Resume request', 'Retry at most once', 'A request that failed with an expired token is retried once with the new token.'),
      ],
    },
    {
      id: 'reset', group: 'Account & access', label: 'Forgot password & reset', basis: BASIS + ' · eligible account',
      steps: [
        S('Browser → API', 'Request password reset', 'POST /forgot-password', 'The user submits an e-mail; the endpoint always answers with the same generic message.'),
        S('API → Email', 'Issue reset code', 'RESET_PASSWORD OTP', 'For an eligible account the API creates a reset code and e-mails it.'),
        S('Browser → API', 'Submit code + password', 'POST /reset-password', 'ResetPassword.jsx sends the 6-digit code and the new password.'),
        S('API', 'Consume valid OTP', 'Single use + expiry checks', 'consumeOtp validates the reset code before the password can change.'),
        S('Database', 'Update password hash', 'Revoke all refresh tokens', 'The new bcrypt hash is stored and every refresh session is revoked.'),
        S('Browser', 'Sign in again', 'Use the new password', 'Old sessions no longer work; the user signs in again.'),
      ],
    },
    {
      id: 'invite', group: 'Account & access', label: 'Gate-staff invitation', basis: BASIS + ' · invitation accepted',
      steps: [
        S('Organizer', 'Invite gate staff', 'POST /api/staff/invites', 'StaffManager sends the e-mail address and the events the staff member may scan.'),
        S('Database', 'Store invitation', 'Hashed token · 72 hours', 'A StaffInvite stores the hash of a random invitation token.'),
        S('Email service', 'Deliver invite link', '/invite/<token>', 'The e-mail links to AcceptInvite.jsx; organizers can resend or cancel pending invites.'),
        S('Browser → API', 'Accept invitation', 'POST /accept-invite', 'The recipient opens the link, sees the company and events, sets a password and accepts.'),
        S('Database', 'Create staff + assignment', 'Single transaction', 'The invite becomes ACCEPTED; a verified GATE_STAFF user and StaffEventAssignment rows are created.'),
        S('API → Browser', 'Start staff session', 'Scanner opens', 'The staff member is signed in and sees only the events assigned to them.'),
      ],
    },
    {
      id: 'logout', group: 'Account & access', label: 'Logout & idle expiry', basis: BASIS,
      steps: [
        S('Browser', 'Logout triggered', 'Manual or 30-minute idle', 'AuthContext.logout runs after a user action or the client idle check.'),
        S('Browser → API', 'Request logout', 'POST /api/auth/logout', 'The browser sends the logout request with its refresh cookie.'),
        S('API + Database', 'Revoke refresh token', 'revokeRefreshToken', 'The current refresh-token row is revoked so it cannot create a new access token.'),
        S('Browser', 'Clear local session', 'Signed-out view', 'The access token and user are dropped and the signed-out view is shown.'),
      ],
    },

    // ---------------- Events & tickets ----------------
    {
      id: 'company', group: 'Events & tickets', label: 'Company registration & approval', basis: BASIS + ' · 1 to 4 documents',
      steps: [
        S('Organizer', 'Fill company details', 'Name, owner, contact, city, NTN/CNIC', 'CompanyRegistration.jsx collects the company details.'),
        S('Organizer', 'Attach 1–4 documents', 'PDF, PNG, JPG or WebP · 10 MB each', 'Files are dragged in or chosen; each can be removed before submitting.'),
        S('API', 'Validate upload', 'Fields + 1–4 files', 'Zod checks the fields; multer rejects more than 4 files, files over 10 MB and other types (400). At least one document is required.'),
        S('Storage', 'Store documents', 'Cloudinary or local uploads/', 'uploadFile stores each document; the URLs are saved in Company.documentUrls.'),
        S('Database', 'Company PENDING', 'Organizer linked · notified', 'registerCompany creates or resets the Company to PENDING, links the organizer, and writes a notification and an audit log.'),
        S('Super Admin', 'Review application', 'AdminCompanies', 'The admin sees the details and opens every document.'),
        S('API', 'Approve company', 'APPROVED · notification + e-mail', 'The organizer is told by notification and e-mail and can now create events.'),
      ],
    },
    {
      id: 'publish', group: 'Events & tickets', label: 'Create, review & publish an event', basis: BASIS + ' · approved company',
      steps: [
        S('Organizer', 'Create event', 'Details, banner, gallery, map pin, tiers', 'CreateEvent.jsx checks image sizes and ratios and sends POST /api/events; an APPROVED company is required.'),
        S('Database', 'Save draft event', 'Event DRAFT + TicketTiers', 'The event and its ticket tiers are stored as a draft.'),
        S('Organizer', 'Draw seating plan', 'Venue editor', 'The venue editor publishes a seating plan, which creates the seats.'),
        S('Organizer', 'Submit for review', 'POST /api/events/:id/submit', 'EventSubmit shows what is ready and submits the event.'),
        S('Database', 'Pending approval', 'PENDING_APPROVAL', 'Super Admins are notified that an event is waiting for review.'),
        S('Super Admin', 'Review event', 'AdminEventApprovals', 'The admin approves, or rejects with a comment; a second decision on the same submission returns 409.'),
        S('API', 'Publish event', 'PUBLISHED · organizer notified', 'The event goes on sale and appears in browse, search and the map.'),
      ],
    },
    {
      id: 'venue', group: 'Events & tickets', label: 'Venue plan editor', basis: BASIS,
      steps: [
        S('Organizer', 'Open venue editor', 'Template or blank canvas', 'GET /api/venues/event/:id/editor returns tiers, the draft, the published plan and protected seats.'),
        S('Organizer', 'Draw sections', 'Seats, tables, GA · tiers', 'Sections are drawn on the canvas; venue-core generates seat keys and geometry.'),
        S('API', 'Save draft', 'PUT /draft', 'The VenueLayout draft is stored and can be discarded.'),
        S('Organizer', 'Publish plan', 'POST /publish', 'The organizer publishes the draft.'),
        S('API', 'Check protected seats', 'Sold / held / in checkout', 'publishDraft refuses to remove or move seats that are sold, held or in a checkout (409 with the conflicts).'),
        S('Database', 'Generate seats', 'Seat rows + tier totals', 'Seats are created or updated from the plan in a transaction; the layout becomes PUBLISHED.'),
      ],
    },
    {
      id: 'seats', group: 'Events & tickets', label: 'Seat selection & holds', basis: BASIS + ' · published plan',
      steps: [
        S('Attendee', 'Open event', 'Event page', 'EventDetails shows the sale state; the visit is tracked as event_view.'),
        S('Browser', 'Load seat map', 'GET /api/venues/event/:id', 'Lapsed holds are expired first; the plan shows available, held and sold seats and updates live over Socket.IO.'),
        S('Attendee', 'Pick seat, table or GA', 'Venue map', 'Signed-out picks are kept and held automatically after login.'),
        S('API', 'Request hold', 'POST /holds', 'venueController.createHold dispatches to a seat, whole-table or GA hold.'),
        S('Database', 'Hold atomically', '10 minutes · max 10', 'A single conditional UPDATE holds the seat; a taken seat or the 10-hold limit returns 409.'),
        S('API', 'Broadcast & track', 'seat:status_batch', 'Other viewers see the seat as held; seat_selected and seat_locked are recorded.'),
        S('Attendee', 'Go to checkout', 'Hold bar / cart', 'Get tickets re-checks the holds and opens Checkout. Releasing a hold records checkout_abandoned.'),
      ],
    },
    {
      id: 'checkout', group: 'Events & tickets', label: 'Checkout, anti-bot check & payment', basis: BASIS + ' · Stripe test mode when configured',
      steps: [
        S('Browser', 'Open checkout', 'Holds + server prices', 'Checkout loads the held seats with server prices and records checkout_started.'),
        S('Attendee', 'Choose payment', 'Card, JazzCash, EasyPaisa, test', 'Card details go into Stripe’s CardElement and never reach the API.'),
        S('Browser → API', 'Send order + telemetry', 'POST /bookings/initiate', 'Seconds on the page and click rate are sent with the order.'),
        S('API', 'Anti-bot check', 'ML service or fallback rules', 'A CRITICAL_BOT score (75+) returns 403 with the anomaly signals and an audit log.'),
        S('API', 'Validate holds', 'Still held by this user?', 'An expired hold, a sold seat or another customer’s checkout returns 409.'),
        S('Database', 'Create pending order', 'Order PENDING · placeholder tickets', 'Tier counts drop; the seats stay held while payment runs.'),
        S('Payment', 'Pay', 'Stripe card / wallet OTP', 'With STRIPE_SECRET_KEY a real PaymentIntent is confirmed in the browser; JazzCash, EasyPaisa and test payments are simulated.'),
        S('API', 'Verify payment', 'POST /bookings/confirm', 'The payment is checked; on failure the order stays PENDING so the customer can retry.'),
        S('Database', 'Confirm order', 'SUCCESSFUL · seats SOLD', 'A notification and e-mail are sent; other viewers see the seats as sold.'),
        S('API', 'Mint NFT tickets', 'Errors never fail the order', 'batchMintOrderTickets runs after confirmation.'),
        S('Browser', 'Show confirmation', 'Order confirmed', 'The confirmation modal opens; tickets appear in the wallet.'),
      ],
    },
    {
      id: 'wallet', group: 'Events & tickets', label: 'Ticket wallet & QR pass', basis: BASIS + ' · paid tickets',
      steps: [
        S('Customer', 'Open wallet', 'GET /api/tickets/wallet', 'DigitalWallet lists the customer’s tickets, active first.'),
        S('API', 'Load paid tickets', 'Order SUCCESSFUL only', 'Placeholder tickets of an unfinished checkout are not shown.'),
        S('API', 'Mint if missing', 'Lazy NFT mint', 'A ticket without token data is minted (or simulated) on the way.'),
        S('API', 'Sign pass', 'Ed25519 · TL1 code + manual code', 'passFor signs ticket, event and QR version; it is generated on demand and never stored.'),
        S('Browser', 'Show QR pass', 'QR image · PDF download', 'The pass greys out live when it is scanned at the gate.'),
        S('Customer', 'Present at gate', 'Screen or PDF', 'The QR (or the TL-XXXX-XXXX code) is scanned by gate staff.'),
      ],
    },
    {
      id: 'gate', group: 'Events & tickets', label: 'Gate check-in (QR scan)', basis: BASIS + ' · green / yellow / red',
      steps: [
        S('Gate staff', 'Choose event & gate', 'Assigned events only', 'GateScanner lists the events the staff member is assigned to.'),
        S('Device', 'Download offline list', 'Refreshed every 3 min', 'A signed ticket pack lets the device check passes without a connection.'),
        S('Gate staff', 'Scan pass', 'Camera, QR image or manual code', 'The camera reads the QR; a dropped or chosen image is decoded the same way; the code can be typed.'),
        S('Device', 'Connection available?', 'Online check', 'Online scans are decided by the server.'),
        S('API', 'Check signature & ticket', 'Right event, paid, current QR', 'A bad signature, another event, an unpaid or transferred ticket gives a red result.'),
        S('API', 'Check not used', 'First entry?', 'A ticket already admitted gives a yellow result with the first entry time, gate and staff.'),
        S('Database', 'Admit atomically', 'Ticket SCANNED · CheckIn row', 'The ticket is marked used in one conditional update, so two scanners cannot both admit it.'),
        S('API', 'Broadcast', 'Live stats · wallet update', 'Organizer stats update live and the holder’s pass greys out.'),
        S('Device', 'Show green card', 'ENTRY APPROVED', 'Holder, ticket type, seat, ticket code and check-in time are shown.'),
      ],
    },
    {
      id: 'transfer', group: 'Events & tickets', label: 'Ticket transfer', basis: BASIS,
      steps: [
        S('Owner', 'Enter recipient e-mail', 'POST /api/tickets/transfer', 'The owner sends a ticket from the wallet.'),
        S('API', 'Check ticket & recipient', 'Owned, active, registered recipient', 'The ticket must be the sender’s, ACTIVE and unscanned; the recipient must have an account and cannot be the sender.'),
        S('Database', 'Move ownership', 'qrVersion + 1 · listing cancelled', 'Any active resale listing is cancelled, the old QR stops working at once, and a transfer-history row is written.'),
        S('API', 'Notify both', 'Notifications + e-mail', 'Sender and recipient are notified.'),
        S('Recipient', 'Ticket in wallet', 'New QR pass', 'The recipient’s wallet shows the ticket with a new pass.'),
      ],
    },
    {
      id: 'resale', group: 'Events & tickets', label: 'Controlled ticket resale', basis: BASIS + ' · 110% price cap',
      steps: [
        S('Owner', 'List ticket', 'Price ≤ 110% of face value', 'The wallet or My NFTs page sends POST /api/resale/list.'),
        S('API', 'Check price & ticket', '110% cap', 'Prices above 110% of the original price, or tickets that cannot be sold, are rejected.'),
        S('Database', 'Listing ACTIVE', 'Waitlist notified', 'Customers on the event waitlist are told a ticket is available.'),
        S('Buyer', 'Browse marketplace', 'Search, city, max price', 'ResaleMarketplace lists active listings.'),
        S('Buyer', 'Buy ticket', 'POST /api/resale/buy/:id', 'No payment is taken at this stage (the purchase is simulated).'),
        S('Database', 'Transfer to buyer', 'qrVersion + 1 · listing SOLD', 'The seller’s QR stops working and the buyer gets a new pass.'),
        S('API', 'Notify seller & buyer', 'Notifications + e-mail', 'Both parties are notified of the sale.'),
      ],
    },
    {
      id: 'nft', group: 'Events & tickets', label: 'NFT ticket minting', basis: BASIS + ' · simulated unless a chain is configured',
      steps: [
        S('API', 'Mint requested', 'After payment or wallet load', 'confirmBooking and the wallet ask nftService to mint.'),
        S('API', 'Not minted yet?', 'tokenId + txHash present?', 'An already-minted ticket returns its existing token.'),
        S('API', 'Build metadata', 'data: URI · keccak fingerprint', 'Name, seat, event and the 110% resale cap are embedded; the recipient is the linked wallet or the platform custodian.'),
        S('API', 'Chain configured?', 'POLYGON_PRIVATE_KEY + contract', 'Without a signer and contract the mint is simulated.'),
        S('Blockchain', 'mintTicket on contract', 'Polygon Amoy or local Hardhat', 'The ERC-721 contract rejects a second mint for the same seat.'),
        S('Database', 'Save token', 'tokenId, txHash · audit log', 'The ticket stores its token data and an NFT_TICKET_MINTED audit log is written.'),
      ],
    },
    {
      id: 'notifications', group: 'Events & tickets', label: 'Notifications & e-mail', basis: BASIS,
      steps: [
        S('API', 'Feature creates notification', 'Booking, approval, transfer…', 'Features write a Notification row for the user.'),
        S('Database', 'Notification row', 'Prisma $extends hook', 'Every new notification passes through the e-mail hook.'),
        S('API', 'E-mail enabled?', 'User preference', 'Users can switch e-mail notifications off in their profile.'),
        S('Email service', 'Send e-mail', 'Branded template', 'The e-mail is sent after the request finishes, so it never slows it down.'),
        S('Browser', 'Show in header', 'Polls every 60 s', 'The header badge and the Notifications page show unread items.'),
        S('User', 'Mark as read', 'One or all', 'Read state is saved; notifications can be deleted.'),
      ],
    },
    {
      id: 'dashboards', group: 'Events & tickets', label: 'Organizer & admin dashboards', basis: BASIS,
      steps: [
        S('Organizer / Admin', 'Open dashboard', 'Organizer or Super Admin console', 'Each role sees its own console.'),
        S('API', 'Aggregate metrics', 'Sales, revenue, events, users', 'Dashboard services read orders, tickets, check-ins and audit logs.'),
        S('Socket.IO', 'Live check-ins', 'checkin:stats', 'Entry counts update while gates are scanning.'),
        S('Browser', 'Show charts & tables', 'Events, staff, approvals', 'Organizers manage events and staff; admins manage companies, events, users and logs.'),
      ],
    },

    // ---------------- Behavior & analytics ----------------
    {
      id: 'tracking', group: 'Behavior & analytics', label: 'Behavior tracking & guest linking', basis: BASIS,
      steps: [
        S('Browser', 'Visitor acts', 'View, category, checkout', 'Pages report actions such as event_view, category_view, checkout_started and checkout_abandoned.'),
        S('Browser → API', 'Send event', 'POST /api/behavior/track', 'Each request carries the browser’s x-session-id.'),
        S('API', 'Record server events', 'Login, holds, booking, payment', 'Controllers also record actions such as seat_locked, payment_completed and ticket_transferred.'),
        S('Database', 'BehaviorEvent row', 'User or guest session', 'Rows store the action, event, session and metadata.'),
        S('API', 'Link guest on login', 'attachSessionToUser', 'Anonymous rows from the same browser are linked to the account after login.'),
      ],
    },
    {
      id: 'profile', group: 'Behavior & analytics', label: 'Customer behavior profile', basis: BASIS + ' · Profile → Behaviour tab',
      steps: [
        S('Customer', 'Open behaviour tab', 'Profile page', 'The customer’s Profile shows Client Telemetry & Affinity Metrics.'),
        S('API', 'Load recent activity', 'Last 100 events', 'GET /api/behavior/profile reads the customer’s latest behaviour rows.'),
        S('API', 'Count actions', '15 action types', 'Views, seat selections, checkouts and payments are counted.'),
        S('API', 'Rule-based scores', 'Intent formula · fraud LOW', 'The ML calls here fall back to rules, so the scores come from fixed formulas.'),
        S('Browser', 'Show tiles & timeline', 'Exact time per activity', 'The timeline shows each activity with its date and time.'),
      ],
    },
    {
      id: 'abandoned', group: 'Behavior & analytics', label: 'Abandoned checkout → reminder', basis: BASIS,
      steps: [
        S('Organizer', 'Open Abandoned intents', 'Dashboard → Abandoned intents', 'Organizers see their own events; admins see all.'),
        S('API', 'Load behaviour rows', 'Per event', 'Behaviour and order data are read for the events.'),
        S('API', 'Find drop-offs', 'Held or started, not bought', 'Visitors who held seats or started checkout without paying are listed.'),
        S('API', 'Score & reason', 'Rule-based', 'Views, seats, checkout and cart value give a score and a likely reason.'),
        S('Organizer', 'Send reminder', 'One or batch', 'The organizer sends a reminder to one visitor or to many.'),
        S('API', 'Notify customer', 'Notification + e-mail', 'The reminder arrives as a notification and an e-mail.'),
      ],
    },
    {
      id: 'fraud', group: 'Behavior & analytics', label: 'Fraud scoring API & watchlist', basis: BASIS,
      steps: [
        S('Client', 'Submit telemetry', 'POST /api/ml/fraud/score', 'A separate scoring endpoint; the checkout runs its own anti-bot check.'),
        S('API', 'Call ML service', 'Model, heuristic or fallback', 'The Python service scores the request; Node rules are used if it is unavailable.'),
        S('Database', 'Store evaluation', 'AI_BOT_EVALUATION', 'Every score is stored; bots are flagged in the audit log.'),
        S('Super Admin', 'Review watchlist', 'Fraud watchlist page', 'The admin sees flagged users and scores.'),
        S('Super Admin', 'Freeze account?', 'Manual decision', 'Freezing suspends the user and revokes their sessions.'),
        S('API', 'Suspend & revoke', 'Account SUSPENDED', 'The user can no longer sign in until unfrozen.'),
      ],
    },
    // In progress: these pages show "Coming soon" in the app
    {
      id: 'intent', group: 'Behavior & analytics', status: PROGRESS, label: 'Purchase-intent analytics', basis: 'In progress · page shows “Coming soon” in the app',
      steps: [
        S('Organizer / Admin', 'Open Purchase intent', 'Dashboard menu', 'The menu item and dashboard tile still link to the page.'),
        S('Browser', 'Coming soon page', 'COMING_SOON.purchaseIntent', 'App.jsx shows the Coming soon page while the feature is finished.'),
        S('API', 'Scoring endpoint ready', 'GET /api/analytics/intent/:id', 'The rule-based funnel and intent scores already exist on the server.'),
      ],
    },
    {
      id: 'demand', group: 'Behavior & analytics', status: PROGRESS, label: 'Pre-launch demand forecast', basis: 'In progress · page shows “Coming soon” in the app',
      steps: [
        S('Organizer / Admin', 'Open Demand forecast', 'Dashboard menu', 'The menu item and dashboard tile still link to the page.'),
        S('Browser', 'Coming soon page', 'COMING_SOON.demandForecast', 'App.jsx shows the Coming soon page while the feature is finished.'),
        S('ML service', 'Forecast ready', '/forecast/demand · 78% fallback', 'The forecast endpoint and its fallback already exist.'),
      ],
    },
    {
      id: 'behavior', group: 'Behavior & analytics', status: PROGRESS, label: 'Behavioral analysis (admin)', basis: 'In progress · page shows “Coming soon” in the app',
      steps: [
        S('Super Admin', 'Open Behavior', 'Admin menu', 'The admin console still links to the page.'),
        S('Browser', 'Coming soon page', 'COMING_SOON.behaviorAnalysis', 'App.jsx shows the Coming soon page while the feature is finished.'),
        S('API', 'Profile API ready', 'GET /api/behavior/user/:id', 'Per-user behaviour profiles can already be read by admins.'),
      ],
    },
  ];

  flows.unshift({ id: 'authentication', group: 'Account & access', label: 'Authentication', basis: 'Account lifecycle · login, protected access, then logout', steps: [] });
  flows.push({ id: 'session', group: 'Account & access', label: 'Start a session', basis: BASIS, steps: [
    S('API', 'Account authenticated', 'startSession', 'A login, a verified sign-up or an accepted invite starts a session.'),
    S('API', 'Create refresh token', 'Random 48-byte token', 'The session service creates the refresh token used to restore access.'),
    S('Database', 'Store token hash', 'SHA-256', 'Only the hash of the refresh token is stored.'),
    S('API → Browser', 'Set refresh cookie', 'httpOnly · /api/auth · 7 days', 'The API sets tl_refresh, scoped to /api/auth.'),
    S('API → Browser', 'Return access token', '15-minute JWT', 'The browser keeps the access token in memory and sends it with protected requests.'),
  ] });
  flows.push({ id: 'access', group: 'Account & access', label: 'Protected access & roles', basis: BASIS, steps: [
    S('Browser → API', 'Send protected request', 'Bearer access token', 'The access token goes in the Authorization header.'),
    S('API', 'Verify access token', 'authenticateJWT', 'The middleware verifies the JWT and its type.'),
    S('API + Database', 'Load current user', 'Status checked each request', 'Blocked statuses are enforced on every protected request.'),
    S('API', 'Check allowed role', 'requireRole', 'The route checks the user’s role (customer, organizer, gate staff, super admin).'),
    S('API', 'Run requested action', 'Authorized request', 'Only a permitted request reaches the handler.'),
  ] });

  const specs = {
    signup: { input: [0, 3, 4], links: { 6: 'session', 7: 'company' }, decisions: { 1: { label: 'Details valid, e-mail new?', no: 'Fix details', retry: 0, detail: 'Invalid fields return 400; an e-mail that already has an account returns 409. Phone numbers may be shared.' }, 4: { label: 'Code valid?', no: 'Code rejected', retry: 4, detail: 'Wrong, expired or used codes do not activate the account; a new code can be requested after the cooldown.' } }, end: 'Signed in' },
    login: { input: [0], links: { 3: 'session', 4: 'tracking', 5: 'access', 6: 'access' }, decisions: { 1: { label: 'Password correct?', no: 'Login error', retry: 0, detail: 'Unknown e-mail and wrong password receive the same 401 response.' }, 2: { label: 'Account active?', no: 'Verify or suspended', detail: 'Pending users go to e-mail verification; blocked users get 403 and the Suspended page.' } }, end: 'Access granted' },
    refresh: { input: [1, 4], links: { 5: 'access' }, decisions: { 2: { label: 'Refresh valid?', no: 'Sign in again', target: 'login', detail: 'Missing, expired, idle, reused or revoked tokens cannot restore the session.' } }, end: 'Session restored' },
    reset: { input: [0, 1, 2], links: { 5: 'login' }, decisions: { 3: { label: 'Reset code valid?', no: 'Reset rejected', retry: 2, detail: 'A valid, unused reset code is required before the password changes.' } }, end: 'Reset complete' },
    invite: { input: [0, 2, 3], links: { 5: 'session' }, decisions: { 3: { label: 'Invite valid?', no: 'No new account', detail: 'An expired, cancelled or already-used invitation cannot create a staff account.' } }, end: 'Staff signed in' },
    logout: { input: [0, 1], end: 'Signed out' },
    company: { input: [0, 1], links: { 6: 'publish' }, decisions: { 2: { label: 'Form & 1–4 files valid?', no: 'Fix and resubmit', retry: 0, detail: 'Over 4 files, a file over 10 MB, a wrong file type or no document at all returns 400.' }, 5: { label: 'Admin approves?', no: 'Rejected with reason', retry: 0, detail: 'A rejection stores a reason; the organizer corrects the details and resubmits.' } }, end: 'Company approved' },
    publish: { input: [0, 3], links: { 2: 'venue', 6: 'seats' }, decisions: { 3: { label: 'Ready to submit?', no: 'Finish seating', retry: 2, detail: 'Submission needs a published seating plan and valid tiers (400 otherwise).' }, 5: { label: 'Admin approves?', no: 'Rejected with comment', retry: 0, detail: 'The organizer sees the comment, edits the event and submits again.' } }, end: 'Event on sale' },
    venue: { input: [0, 3], decisions: { 4: { label: 'Protected seats kept?', no: 'Publish blocked', retry: 1, detail: 'Sold, held or in-checkout seats cannot be removed or moved (409 lists the conflicts).' } }, end: 'Plan published' },
    seats: { input: [0, 2, 6], links: { 6: 'checkout' }, decisions: { 4: { label: 'Seat free & under 10 holds?', no: 'Choose other seats', retry: 2, detail: 'A seat taken by someone else or the 10-hold limit returns 409 and nothing is held.' } }, end: 'Seats held 10 min' },
    checkout: { input: [1, 2, 6], links: { 9: 'nft', 10: 'wallet' }, decisions: { 3: { label: 'Human (score < 75)?', no: 'Blocked by AI', detail: '403 blockedByAI with the anomaly signals; the attempt is written to the audit log.' }, 4: { label: 'Holds still yours?', no: 'Choose seats again', target: 'seats', detail: 'An expired hold, a sold seat or another customer’s checkout returns 409.' }, 7: { label: 'Payment verified?', no: 'Retry payment', retry: 6, detail: 'A failed payment leaves the order PENDING so the customer can try again before the hold runs out.' } }, end: 'Tickets issued' },
    wallet: { input: [0, 4, 5], links: { 2: 'nft', 5: 'gate' }, end: 'Ready for entry' },
    gate: { input: [0, 2, 8], decisions: { 3: { label: 'Connection available?', no: 'Check on device', detail: 'Offline, the device checks the signature against its downloaded list, shows the result and queues the scan to sync later.' }, 4: { label: 'Signature & ticket valid?', no: 'RED · Invalid ticket', detail: 'Bad signature, another event, unpaid, transferred (old QR version) or cancelled.' }, 5: { label: 'Not used yet?', no: 'YELLOW · Already used', detail: 'Shows the first entry time, gate and staff; do not admit again.' } }, end: 'Attendee enters' },
    transfer: { input: [0, 4], links: { 4: 'wallet' }, decisions: { 1: { label: 'Transfer allowed?', no: 'Transfer refused', retry: 0, detail: 'Not the owner (403), ticket not ACTIVE (400), no account for the recipient e-mail (404) or sending to yourself (400).' } }, end: 'Recipient owns ticket' },
    resale: { input: [0, 3, 4], decisions: { 1: { label: 'Within 110% cap?', no: 'Listing rejected', retry: 0, detail: 'Listings above 110% of the original price are refused.' } }, end: 'New holder owns ticket' },
    nft: { input: [4], decisions: { 1: { label: 'Not minted yet?', no: 'Return existing token', detail: 'A ticket with a tokenId and txHash keeps its token.' }, 3: { label: 'Chain configured?', no: 'Simulated token', detail: 'Without a signer and contract, the token id comes from the ticket hash and the transaction hash is random.' } }, end: 'NFT recorded' },
    notifications: { input: [3, 4], decisions: { 2: { label: 'E-mail enabled?', no: 'In-app only', detail: 'Users who turned e-mails off still see the notification in the app.' } }, end: 'Read' },
    dashboards: { input: [0, 3], end: 'Dashboard shown' },
    tracking: { input: [0, 1], end: 'Activity recorded' },
    profile: { input: [0, 4], end: 'Profile displayed' },
    abandoned: { input: [0, 4], end: 'Reminder delivered' },
    fraud: { input: [0, 3], decisions: { 4: { label: 'Freeze account?', no: 'No action', detail: 'The admin may leave the account active; nothing changes automatically.' } }, end: 'Admin decision made' },
    intent: { input: [0], end: 'In progress' },
    demand: { input: [0], end: 'In progress' },
    behavior: { input: [0], end: 'In progress' },
    session: { input: [3, 4], end: 'Session active' },
    access: { input: [0], decisions: { 1: { label: 'Access token valid?', no: '401 response', target: 'refresh', detail: 'An expired access token triggers one refresh-and-retry.' }, 2: { label: 'User active?', no: '403 response', detail: 'Blocked account statuses are rejected on protected requests.' }, 3: { label: 'Role permitted?', no: '403 response', detail: 'A valid session does not grant every role-specific route.' } }, end: 'Response returned' },
  };

  const N = (id, label, kind, col, row, detail, target, status) => ({ id, label, kind, col, row, detail, target, status });
  const E = (from, to, label = '', route = 'auto') => ({ from, to, label, route });
  const linearGraph = (flow) => {
    const spec = specs[flow.id] || {};
    const nodes = [N('start', 'Start', 'terminal', 0, 0, 'Begin ' + flow.label.toLowerCase() + '.')];
    const edges = [];
    const trace = ['start'];
    flow.steps.forEach((s, i) => {
      const d = (spec.decisions || {})[i];
      const target = (spec.links || {})[i];
      nodes.push(N('s' + i, d ? d.label : s.title, d ? 'decision' : (spec.input || []).includes(i) ? 'input' : 'process', 0, i + 1, s.detail, target));
      trace.push('s' + i);
      if (d) nodes.push(N('no' + i, d.no, d.target ? 'process' : d.retry !== undefined ? 'input' : 'terminal', 1, i + 1, d.detail, d.target));
    });
    nodes.push(N('end', spec.end || 'End', 'terminal', 0, flow.steps.length + 1, flow.status ? 'This module is still in development.' : 'End of this illustrated path.'));
    trace.push('end');
    for (let i = 0; i < trace.length - 1; i++) {
      const source = nodes.find((n) => n.id === trace[i]);
      edges.push(E(trace[i], trace[i + 1], source.kind === 'decision' ? 'Yes' : ''));
    }
    for (const [i, d] of Object.entries(spec.decisions || {})) {
      edges.push(E('s' + i, 'no' + i, 'No'));
      if (d.retry !== undefined) edges.push(E('no' + i, 's' + d.retry, 'Retry', 'return-right'));
    }
    return { nodes, edges, trace };
  };
  const graphs = new Map(flows.map((f) => [f.id, linearGraph(f)]));

  // Authentication overview (same structure as flow.html)
  graphs.set('authentication', {
    nodes: [
      N('start', 'Start', 'terminal', 0, 0, 'An existing user opens TicketLedger.'),
      N('login', 'Login', 'input', 0, 1, 'Open the detailed login and protected-access workflow.', 'login'),
      N('allowed', 'Login allowed?', 'decision', 0, 2, 'The credentials and account status must permit access.'),
      N('denied', 'Access denied', 'terminal', 1, 2, 'Wrong credentials or a blocked account stop this path.'),
      N('session', 'Start session', 'process', 0, 3, 'Create the refresh session and issue the access token.', 'session'),
      N('use', 'Protected access', 'process', 0, 4, 'Protected requests verify the token, user status and role.', 'access'),
      N('logout-question', 'Logout clicked?', 'decision', 0, 5, 'Yes opens the logout path; otherwise the session continues.'),
      N('logout', 'Logout', 'process', 1, 5, 'Open the logout workflow.', 'logout'),
      N('signed-out', 'Signed out', 'terminal', 1, 6, 'The local session is cleared.'),
      N('refresh-question', 'Refresh needed?', 'decision', 0, 6, 'The browser refreshes near token expiry or after an expired-token response.'),
      N('refresh', 'Refresh session', 'process', 0, 7, 'Open token validation, rotation and retry.', 'refresh'),
    ],
    edges: [E('start', 'login'), E('login', 'allowed'), E('allowed', 'session', 'Yes'), E('allowed', 'denied', 'No'), E('session', 'use'), E('use', 'logout-question'), E('logout-question', 'logout', 'Yes'), E('logout', 'signed-out'), E('logout-question', 'refresh-question', 'No'), E('refresh-question', 'refresh', 'Yes'), E('refresh-question', 'use', 'No', 'return-left'), E('refresh', 'use', '', 'return-left')],
    trace: ['start', 'login', 'allowed', 'session', 'use', 'logout-question', 'logout', 'signed-out'],
  });

  const names = {
    authentication: 'Authentication', signup: 'Sign-up & verification', login: 'Login & access', refresh: 'Session refresh', reset: 'Password reset', invite: 'Staff invitations', logout: 'Logout', session: 'Start a session', access: 'Protected access',
    company: 'Company approval', publish: 'Event publishing', venue: 'Venue plan editor', seats: 'Seat selection', checkout: 'Checkout & payment', wallet: 'Ticket wallet & QR', gate: 'Gate check-in', transfer: 'Ticket transfer', resale: 'Ticket resale', nft: 'NFT minting', notifications: 'Notifications', dashboards: 'Dashboards',
    tracking: 'Behavior tracking', profile: 'Behavior profile', abandoned: 'Abandoned checkout', fraud: 'Fraud scoring', intent: 'Purchase intent', demand: 'Demand forecast', behavior: 'Behavioral analysis',
  };
  names.overall = 'Overall flow';
  const moduleCount = flows.length;
  const flowMap = new Map(flows.map((f) => [f.id, f]));
  const O = (id, x, y) => ({ ...N(id, names[id], 'process', 0, 0, flowMap.get(id).basis, id, flowMap.get(id).status), x, y });
  const OE = (from, to, detail, extra = {}) => ({ ...E(from, to), detail, ...extra });
  const overview = {
    nodes: [
      O('signup', 110, 65), O('authentication', 355, 65), O('login', 600, 65), O('session', 845, 65), O('access', 1090, 65),
      O('reset', 110, 155), O('invite', 355, 155), O('refresh', 845, 155), O('logout', 1090, 155),
      O('company', 110, 282), O('publish', 355, 282), O('seats', 600, 282), O('checkout', 845, 282), O('wallet', 1090, 282),
      O('venue', 355, 378), O('nft', 845, 378), O('transfer', 1090, 378),
      O('demand', 110, 474), O('notifications', 600, 474), O('resale', 845, 474), O('gate', 1090, 474),
      O('tracking', 110, 600), O('profile', 355, 600), O('intent', 600, 600), O('abandoned', 845, 600), O('fraud', 1090, 600),
      O('behavior', 110, 696), O('dashboards', 1090, 696),
    ],
    edges: [
      OE('authentication', 'login', 'Authentication opens the login workflow. Click any module for its detailed flow.'),
      OE('login', 'session', 'A successful login starts a refresh session and issues an access token.'),
      OE('session', 'access', 'The browser uses its access token for protected actions.'),
      OE('access', 'seats', 'Attendees continue to browsing events and choosing seats.', { fromSide: 'right', toSide: 'top', via: [[1204, 65], [1204, 216], [600, 216]], label: 'Attendee' }),
      OE('company', 'publish', 'An approved company can create events and submit them for review.'),
      OE('publish', 'venue', 'Organizers draw the seating plan; publishing it creates the seats.'),
      OE('publish', 'seats', 'A published event is on sale and attendees can hold seats.'),
      OE('seats', 'checkout', 'Held seats continue to checkout, the anti-bot check and payment.'),
      OE('checkout', 'wallet', 'A confirmed order puts signed QR passes in the wallet.'),
      OE('wallet', 'gate', 'The QR pass is scanned at the gate: green, yellow or red.', { fromSide: 'right', toSide: 'right', via: [[1212, 282], [1212, 474]] }),
      OE('checkout', 'nft', 'Confirmed tickets are minted as NFTs (simulated unless a chain is configured).', { related: true }),
      OE('checkout', 'notifications', 'The confirmation is sent as a notification and an e-mail.', { fromSide: 'bottom', toSide: 'top', via: [[845, 345], [600, 345]], related: true }),
      OE('wallet', 'transfer', 'A holder can transfer a ticket; the old QR stops working.', { related: true }),
      OE('transfer', 'gate', 'The new holder presents the new pass at the gate.', { related: true }),
      OE('wallet', 'resale', 'A holder can list a ticket for resale at up to 110% of the price.', { fromSide: 'right', toSide: 'bottom', via: [[1230, 282], [1230, 520], [845, 520]], related: true }),
      OE('resale', 'gate', 'The buyer presents their new pass at the gate.', { related: true }),
      OE('company', 'demand', 'Demand forecasting for organizers is in progress.', { fromSide: 'bottom', toSide: 'top', related: true }),
      OE('signup', 'session', 'A verified sign-up starts a session without a separate login.', { fromSide: 'bottom', toSide: 'bottom', via: [[110, 110], [845, 110]], related: true }),
      OE('signup', 'company', 'Organizer accounts register their company next.', { fromSide: 'left', toSide: 'left', via: [[6, 65], [6, 282]], related: true }),
      OE('reset', 'login', 'After a password reset, the user signs in again.', { fromSide: 'bottom', toSide: 'bottom', via: [[110, 203], [600, 203]], related: true }),
      OE('invite', 'session', 'Accepting a staff invitation starts a session.', { fromSide: 'right', toSide: 'bottom', via: [[510, 155], [510, 119], [845, 119]], related: true }),
      OE('session', 'refresh', 'The refresh cookie renews the access token.', { fromSide: 'bottom', toSide: 'top', related: true }),
      OE('refresh', 'access', 'A successful refresh restores authorized requests.', { fromSide: 'right', toSide: 'left', via: [[976, 155], [976, 65]], related: true }),
      OE('access', 'logout', 'Logout revokes the refresh session and clears the browser.', { fromSide: 'bottom', toSide: 'top' }),
      OE('seats', 'tracking', 'Views, holds and checkouts are recorded as behaviour events.', { fromSide: 'bottom', toSide: 'top', via: [[600, 331], [14, 331], [14, 560], [110, 560]], related: true }),
      OE('tracking', 'profile', 'Recorded behaviour feeds the customer’s profile tab.', { related: true }),
      OE('profile', 'intent', 'Purchase-intent analytics is in progress.', { related: true }),
      OE('tracking', 'behavior', 'Admin behavioral analysis is in progress.', { related: true }),
      OE('tracking', 'abandoned', 'Abandoned-checkout analysis lists drop-offs and sends reminders.', { fromSide: 'bottom', toSide: 'bottom', via: [[110, 650], [845, 650]], related: true }),
      OE('tracking', 'fraud', 'Telemetry can be scored by the separate fraud API; results appear in the admin watchlist.', { fromSide: 'bottom', toSide: 'left', via: [[110, 656], [968, 656], [968, 600]], related: true, label: 'Separate scoring API', labelPos: { x: 690, y: 674, anchor: 'middle' } }),
      OE('fraud', 'dashboards', 'The admin console shows fraud alerts, gate scans and audit logs.', { related: true }),
    ],
    trace: [],
  };
  graphs.set('overall', overview);
  flows.unshift({ id: 'overall', group: 'Overview', label: 'Overall flow — all modules', basis: 'All ' + moduleCount + ' modules · Solid arrows show journeys; dotted arrows show optional or supporting workflows; amber = in progress.', steps: [] });
  flowMap.set('overall', flows[0]);
  for (const g of graphs.values()) for (const n of g.nodes) if (n.target && !flowMap.has(n.target)) delete n.target;

  return {
    flows,
    graphs,
    names,
    flowMap,
    moduleCount,
    layouts: {
      authentication: { start: [130, 100], login: [380, 100], allowed: [630, 100], session: [880, 100], use: [1130, 100], denied: [630, 232], 'logout-question': [1130, 342], logout: [880, 342], 'signed-out': [630, 342], 'refresh-question': [1130, 486], refresh: [880, 486] },
    },
    lanes: { labels: [['ACCOUNT & ACCESS', 14], ['EVENTS & TICKETS', 232], ['BEHAVIOR & ANALYTICS', 548]], line: [21, 530, 1179, 530] },
    overallDescription: 'All ' + moduleCount + ' TicketLedger modules and their relationships, as implemented. Amber modules are in progress (Coming soon in the app). Click a module or choose it from the dropdown to open its flow.',
  };
}
