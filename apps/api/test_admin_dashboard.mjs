import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 19 - Super Admin & Organizer Analytics Dashboard Integration Test Suite', async (t) => {
  let adminToken = null;
  let adminUser = null;
  let customerToken = null;
  let customerUser = null;
  let organizerToken = null;
  let organizerUser = null;

  // 1. Authenticate All Key Roles
  await t.test('1. Authenticate Super Admin, Customer, and Organizer', async () => {
    // Admin login
    const adminRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ticketledger.pk', password: 'Password@123' }),
    });
    const adminData = await adminRes.json();
    assert.equal(adminRes.status, 200, 'Admin login should succeed');
    adminToken = adminData.data.token;
    adminUser = adminData.data.user;

    // Customer login
    const custRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@ticketledger.pk', password: 'Password@123' }),
    });
    const custData = await custRes.json();
    assert.equal(custRes.status, 200, 'Customer login should succeed');
    customerToken = custData.data.token;
    customerUser = custData.data.user;

    // Organizer login
    const orgRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'organizer@ticketledger.pk', password: 'Password@123' }),
    });
    const orgData = await orgRes.json();
    assert.equal(orgRes.status, 200, 'Organizer login should succeed');
    organizerToken = orgData.data.token;
    organizerUser = orgData.data.user;
  });

  // 2. Enforce RBAC on Super Admin Endpoints
  await t.test('2. Enforce RBAC: Non-admin customer blocked from all admin endpoints', async () => {
    const endpoints = [
      '/admin/metrics',
      '/admin/users',
      '/admin/events',
      '/admin/transactions',
      '/admin/blockchain-logs',
      '/admin/fraud-alerts',
      '/admin/gate-scans',
      '/admin/audit-logs',
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${BASE_URL}${ep}`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      assert.equal(res.status, 403, `Customer must receive 403 on ${ep}`);
    }
  });

  // 3. Super Admin Overview Metrics
  await t.test('3. Fetch Super Admin system-wide overview metrics', async () => {
    const res = await fetch(`${BASE_URL}/admin/metrics`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.data.users, 'Users summary should exist');
    assert.ok(json.data.users.total >= 3, 'Should track at least 3 users');
    assert.ok(json.data.companies, 'Companies summary should exist');
    assert.ok(json.data.events, 'Events summary should exist');
    assert.ok(json.data.ticketing, 'Ticketing summary should exist');
    assert.ok(json.data.financials, 'Financials summary should exist');
    assert.ok(json.data.operations, 'Operations summary should exist');
  });

  // 4. User Directory & Filtering
  await t.test('4. Fetch and filter users directory by role and status', async () => {
    // Filter by role CUSTOMER
    const res = await fetch(`${BASE_URL}/admin/users?role=CUSTOMER&limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.data.users.length > 0);
    for (const u of json.data.users) {
      assert.equal(u.role, 'CUSTOMER');
    }

    // Filter by status ACTIVE
    const activeRes = await fetch(`${BASE_URL}/admin/users?status=ACTIVE&limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const activeJson = await activeRes.json();
    assert.equal(activeRes.status, 200);
    for (const u of activeJson.data.users) {
      assert.equal(u.status, 'ACTIVE');
    }
  });

  // 5. Freeze User Mutation & Audit Log
  await t.test('5. Freeze user account and verify audit log record', async () => {
    const freezeRes = await fetch(`${BASE_URL}/admin/users/${customerUser.id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'SUSPENDED',
        reason: 'Temporary freeze due to automated script velocity detection',
      }),
    });
    const freezeJson = await freezeRes.json();

    assert.equal(freezeRes.status, 200);
    assert.equal(freezeJson.success, true);
    assert.equal(freezeJson.user.status, 'SUSPENDED');

    // Verify Audit Log
    const auditRes = await fetch(`${BASE_URL}/admin/audit-logs?action=USER_SUSPENDED&limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const auditJson = await auditRes.json();
    assert.equal(auditRes.status, 200);
    assert.ok(auditJson.data.auditLogs.length > 0);
    const log = auditJson.data.auditLogs[0];
    assert.equal(log.action, 'USER_SUSPENDED');
    assert.equal(log.targetId, customerUser.id);
  });

  // 6. Unfreeze User Mutation
  await t.test('6. Unfreeze user account back to ACTIVE state', async () => {
    const unfreezeRes = await fetch(`${BASE_URL}/admin/users/${customerUser.id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'ACTIVE',
        reason: 'Identity verified via NADRA CNIC match',
      }),
    });
    const unfreezeJson = await unfreezeRes.json();

    assert.equal(unfreezeRes.status, 200);
    assert.equal(unfreezeJson.success, true);
    assert.equal(unfreezeJson.user.status, 'ACTIVE');
  });

  // 7. Blacklist User Mutation & Revert
  await t.test('7. Blacklist user account and verify permanent lock', async () => {
    const blacklistRes = await fetch(`${BASE_URL}/admin/users/${customerUser.id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'BANNED',
        reason: 'Confirmed bot farm ticket scalp operation',
      }),
    });
    const blacklistJson = await blacklistRes.json();

    assert.equal(blacklistRes.status, 200);
    assert.equal(blacklistJson.success, true);
    assert.equal(blacklistJson.user.status, 'BANNED');

    // Revert back to ACTIVE so customer user remains functional
    await fetch(`${BASE_URL}/admin/users/${customerUser.id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE', reason: 'Test suite cleanup' }),
    });
  });

  // 8. Global Events Directory
  await t.test('8. Retrieve global events directory with occupancy and ticket metrics', async () => {
    const res = await fetch(`${BASE_URL}/admin/events?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.data.events.length > 0);
    const ev = json.data.events[0];
    assert.ok(ev.company, 'Company details should be included');
    assert.ok(ev.totalCapacity >= 0, 'Capacity should be computed');
    assert.ok(typeof ev.occupancyRate === 'number', 'Occupancy rate should be numeric');
  });

  // 9. Financial Transactions Directory
  await t.test('9. Retrieve global payment transactions directory', async () => {
    const res = await fetch(`${BASE_URL}/admin/transactions?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data.transactions));
  });

  // 10. Blockchain Smart Contract Logs
  await t.test('10. Retrieve Polygon Amoy smart contract on-chain logs', async () => {
    const res = await fetch(`${BASE_URL}/admin/blockchain-logs?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data.blockchainLogs));
    if (json.data.blockchainLogs.length > 0) {
      const log = json.data.blockchainLogs[0];
      assert.ok(log.network.includes('Polygon Amoy'));
      assert.ok(log.contractAddress);
    }
  });

  // 11. ML Fraud Alerts
  await t.test('11. Retrieve ML fraud and bot alert telemetry', async () => {
    const res = await fetch(`${BASE_URL}/admin/fraud-alerts?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data.alerts));
  });

  // 12. Gate Scan Logs
  await t.test('12. Retrieve turnstile gate check-in logs', async () => {
    const res = await fetch(`${BASE_URL}/admin/gate-scans?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data.scans));
  });

  // 13. System Audit Logs
  await t.test('13. Retrieve immutable system audit trail', async () => {
    const res = await fetch(`${BASE_URL}/admin/audit-logs?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.data.auditLogs.length > 0);
  });

  // 14. Organizer Analytics Dashboard Metrics
  await t.test('14. Fetch Organizer Dashboard analytics and attendance prediction', async () => {
    const res = await fetch(`${BASE_URL}/organizer/organizer-dashboard`, {
      headers: { Authorization: `Bearer ${organizerToken}` },
    });
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);

    if (json.data.hasCompany) {
      assert.ok(json.data.metrics, 'Metrics summary must be present');
      assert.ok(typeof json.data.metrics.totalRevenuePkr === 'number');
      assert.ok(typeof json.data.metrics.totalTicketsSold === 'number');

      // Sales graph
      assert.ok(Array.isArray(json.data.salesGraph), 'Sales graph must be an array');

      // Tier breakdown
      assert.ok(Array.isArray(json.data.tierBreakdown), 'Tier breakdown must be an array');

      // Live gate pacing
      assert.ok(json.data.liveGatePacing, 'Live gate pacing must be present');
      assert.ok(typeof json.data.liveGatePacing.scanned === 'number');

      // Attendance prediction model
      assert.ok(json.data.attendancePrediction, 'Attendance prediction model must be present');
      assert.ok(json.data.attendancePrediction.rate >= 60 && json.data.attendancePrediction.rate <= 100);
      assert.ok(json.data.attendancePrediction.noShowRisk >= 0);

      // Fraud feed
      assert.ok(Array.isArray(json.data.fraudFeed), 'Fraud feed must be an array');
    }
  });
});
