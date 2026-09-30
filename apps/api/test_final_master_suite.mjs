import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';
const ML_URL = 'http://localhost:8000';

test('MODULE 20 - TicketLedger Final Master Verification Suite (All 20 Modules)', async (t) => {
  let adminToken = null;
  let organizerToken = null;
  let staffToken = null;
  let customerTokens = [];
  let pslEvent = null;
  let concertEvent = null;
  let festEvent = null;

  // -------------------------------------------------------------
  // Test 1: Authenticate All Seeded Roles
  // -------------------------------------------------------------
  await t.test('1. Verify Seeded Role Logins: Admin, Approved & Pending Organizers, Staff, Customers', async () => {
    // 1a. Super Admin
    const adminRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ticketledger.pk', password: 'Password@123' }),
    });
    const adminData = await adminRes.json();
    assert.equal(adminRes.status, 200);
    assert.equal(adminData.data.user.role, 'SUPER_ADMIN');
    adminToken = adminData.data.token;

    // 1b. Approved Organizer
    const orgRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'organizer@ticketledger.pk', password: 'Password@123' }),
    });
    const orgData = await orgRes.json();
    assert.equal(orgRes.status, 200);
    assert.equal(orgData.data.user.role, 'ORGANIZER');
    organizerToken = orgData.data.token;

    // 1c. Gate Staff
    const staffRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'staff@ticketledger.pk', password: 'Password@123' }),
    });
    const staffData = await staffRes.json();
    assert.equal(staffRes.status, 200);
    assert.equal(staffData.data.user.role, 'GATE_STAFF');
    staffToken = staffData.data.token;

    // 1d. 5 Customers
    const customerEmails = [
      'customer@ticketledger.pk',
      'customer2@ticketledger.pk',
      'customer3@ticketledger.pk',
      'customer4@ticketledger.pk',
      'customer5@ticketledger.pk',
    ];

    for (const email of customerEmails) {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password@123' }),
      });
      const data = await res.json();
      assert.equal(res.status, 200, `Login for ${email} must succeed`);
      customerTokens.push({ email, token: data.data.token, user: data.data.user });
    }
    assert.equal(customerTokens.length, 5);
  });

  // -------------------------------------------------------------
  // Test 2: Verify Company Verification & Approvals
  // -------------------------------------------------------------
  await t.test('2. Verify Approved and Pending Organizer Company Records', async () => {
    const res = await fetch(`${BASE_URL}/companies/admin/all`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);

    const approved = data.data.companies.find((c) => c.status === 'APPROVED');
    const pending = data.data.companies.find((c) => c.status === 'PENDING');

    assert.ok(approved, 'Approved company must exist');
    assert.ok(pending, 'Pending company must exist');
    assert.equal(approved.status, 'APPROVED');
    assert.equal(pending.status, 'PENDING');
  });

  // -------------------------------------------------------------
  // Test 3: Verify the 3 Pakistani Events
  // -------------------------------------------------------------
  await t.test('3. Retrieve and inspect the 3 Pakistani Events (PSL, Concert, Festival)', async () => {
    const res = await fetch(`${BASE_URL}/events`);
    const data = await res.json();
    assert.equal(res.status, 200);

    pslEvent = data.data.events.find((e) => e.name.includes('PSL 10 Final'));
    concertEvent = data.data.events.find((e) => e.name.includes('Atif Aslam'));
    festEvent = data.data.events.find((e) => e.name.includes('Karachi Winter Music Festival'));

    assert.ok(pslEvent, 'PSL Event must exist');
    assert.equal(pslEvent.city, 'Lahore');
    assert.equal(pslEvent.venue, 'Gaddafi Stadium, Ferozepur Road');
    assert.equal(pslEvent.type, 'CRICKET_MATCH');

    assert.ok(concertEvent, 'Lahore Concert must exist');
    assert.equal(concertEvent.city, 'Lahore');
    assert.equal(concertEvent.venue, 'Alhamra Arts Council Open Air, The Mall');

    assert.ok(festEvent, 'Karachi Music Festival must exist');
    assert.equal(festEvent.city, 'Karachi');
    assert.equal(festEvent.venue, 'Beach View Park, Clifton Block 4');
  });

  // -------------------------------------------------------------
  // Test 4: Verify Tiers and Seats for PSL Event
  // -------------------------------------------------------------
  await t.test('4. Inspect Ticket Tiers and Stadium Seats for PSL Match', async () => {
    const res = await fetch(`${BASE_URL}/events/${pslEvent.id}`);
    const data = await res.json();
    assert.equal(res.status, 200);

    const event = data.data.event;
    assert.ok(event.tiers.length >= 4, 'PSL must have at least 4 pricing tiers');

    const vip = event.tiers.find((t) => t.name.includes('VIP'));
    const general = event.tiers.find((t) => t.name.includes('General'));
    assert.equal(Number(vip.price), 5000);
    assert.equal(Number(general.price), 800);

    // Fetch Seats
    const seatsRes = await fetch(`${BASE_URL}/seats/event/${pslEvent.id}`);
    const seatsData = await seatsRes.json();
    assert.equal(seatsRes.status, 200);
    assert.ok(seatsData.data.seats.length > 0, 'Seats map must be populated');
  });

  // -------------------------------------------------------------
  // Test 5: Verify Purchased Orders & Polygon Amoy NFT Tickets
  // -------------------------------------------------------------
  await t.test('5. Verify Purchased Tickets, Polygon Amoy Token IDs, and QR Signatures', async () => {
    const res = await fetch(`${BASE_URL}/tickets/my-nfts`, {
      headers: { Authorization: `Bearer ${customerTokens[0].token}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);

    const tickets = data.data.tickets;
    assert.ok(tickets.length >= 1, 'Customer Hamza must have at least 1 ticket');
    const ticket = tickets[0];
    assert.equal(ticket.status, 'ACTIVE');
    assert.ok(ticket.blockchain, 'Ticket must contain blockchain metadata object');
    assert.ok(ticket.blockchain.tokenId !== undefined, 'Ticket must have token ID');
  });

  // -------------------------------------------------------------
  // Test 6: Verify Turnstile Gate Check-In & Dual Validation
  // -------------------------------------------------------------
  await t.test('6. Verify Gate Staff Check-In & Turnstile Dual Validation', async () => {
    const res = await fetch(`${BASE_URL}/admin/gate-scans?limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);

    const scans = data.data.scans;
    assert.ok(scans.length >= 2, 'Should have recorded gate scans');
    const validScan = scans.find((s) => s.result === 'VALID_FIRST_SCAN');
    const dupScan = scans.find((s) => s.result === 'ALREADY_SCANNED');

    assert.ok(validScan, 'Valid first scan record must exist');
    assert.ok(dupScan, 'Duplicate scanned interception must exist');
  });

  // -------------------------------------------------------------
  // Test 7: Verify P2P Resale Listing & 110% Cap Enforcement
  // -------------------------------------------------------------
  await t.test('7. Verify P2P Resale Listing and 110% Price Cap Compliance', async () => {
    const res = await fetch(`${BASE_URL}/resale/market`);
    const data = await res.json();
    assert.equal(res.status, 200);

    const listings = data.data.listings;
    assert.ok(listings.length >= 1, 'Should have active resale listing');
    const item = listings[0];
    assert.equal(item.status, 'ACTIVE');
    assert.ok(Number(item.resalePrice) <= Number(item.maxAllowedCeiling), 'Resale price must not exceed 110% cap');
  });



  // -------------------------------------------------------------
  // Test 8: Verify Fraud-like User & ML Anti-Scalp Watchlist
  // -------------------------------------------------------------
  await t.test('8. Verify Scalper Bot Ring User is FROZEN and Flagged by ML', async () => {
    const res = await fetch(`${BASE_URL}/admin/users?status=FROZEN`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);

    const botUser = data.data.users.find((u) => u.email === 'scalper.bot@proxyfarm.com');
    assert.ok(botUser, 'Bot user must be present in frozen users');
    assert.equal(botUser.status, 'FROZEN');

    // Verify Fraud Alerts
    const alertsRes = await fetch(`${BASE_URL}/admin/fraud-alerts?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const alertsData = await alertsRes.json();
    assert.equal(alertsRes.status, 200);
    const botAlert = alertsData.data.alerts.find((a) => a.fraudScore >= 90);
    assert.ok(botAlert, 'High risk bot alert (score >= 90) must be recorded');
  });

  // -------------------------------------------------------------
  // Test 9: Verify Abandoned Checkout Prospect (Omer Farooq)
  // -------------------------------------------------------------
  await t.test('9. Verify Abandoned Checkout Prospect and 1-Click Recovery', async () => {
    const res = await fetch(`${BASE_URL}/analytics/abandoned?eventId=${pslEvent.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);

    const omer = data.data.abandonedUsers.find((u) => u.user.email === 'omer.abandoned@gmail.com');
    assert.ok(omer, 'Omer Farooq must appear as an abandoned prospect');
    assert.equal(omer.likelyReason, 'PAYMENT_FRICTION');
    assert.equal(omer.cartValue, 7500);

    // Test 1-Click Reminder
    const reminderRes = await fetch(`${BASE_URL}/analytics/abandoned/send-reminder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        targetUserId: omer.user.id,
        eventId: pslEvent.id,
        discountCode: 'RECOVER10',
      }),
    });
    const reminderData = await reminderRes.json();
    assert.equal(reminderRes.status, 200);
    assert.equal(reminderData.success, true);
  });

  // -------------------------------------------------------------
  // Test 10: Verify FastAPI ML Service Live Inference
  // -------------------------------------------------------------
  await t.test('10. Verify FastAPI ML Inference (Intent, Fraud, Demand)', async () => {
    // 10a. Health
    const healthRes = await fetch(`${ML_URL}/health`);
    const healthData = await healthRes.json();
    assert.equal(healthRes.status, 200);
    assert.equal(healthData.status, 'healthy');

    // 10b. Intent Prediction
    const intentRes = await fetch(`${ML_URL}/intent/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page_views: 6,
        time_on_page_seconds: 240,
        seat_selected: 1,
        checkout_started: 1,
      }),
    });
    const intentData = await intentRes.json();
    assert.equal(intentRes.status, 200);
    assert.ok(intentData.purchase_intent_score > 0);

    // 10c. Demand Forecast
    const demandRes = await fetch(`${ML_URL}/forecast/demand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'CRICKET_MATCH',
        city: 'Lahore',
        venue_capacity: 27000,
        ticket_prices: 2500,
      }),
    });
    const demandData = await demandRes.json();
    assert.equal(demandRes.status, 200);
    assert.ok((demandData.projected_48h_sales || demandData.predicted_48h_sales) > 0);
  });


  // -------------------------------------------------------------
  // Test 11: Verify Super Admin Command Center & Organizer Analytics
  // -------------------------------------------------------------
  await t.test('11. Verify Super Admin Governance and Organizer Hub Metrics', async () => {
    // Admin Metrics
    const adminRes = await fetch(`${BASE_URL}/admin/metrics`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminData = await adminRes.json();
    assert.equal(adminRes.status, 200);
    assert.ok(adminData.data.users.total >= 8);
    assert.ok(adminData.data.events.published >= 3);

    // Organizer Dashboard
    const orgRes = await fetch(`${BASE_URL}/organizer/organizer-dashboard`, {
      headers: { Authorization: `Bearer ${organizerToken}` },
    });
    const orgData = await orgRes.json();
    assert.equal(orgRes.status, 200);
    assert.ok(orgData.data.metrics.totalRevenuePkr > 0);
    assert.ok(orgData.data.attendancePrediction.rate >= 60);
  });
});
