import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 10 - Dynamic Rotating QR & Gate Validation Tests', async (t) => {
  let customerToken = null;
  let staffToken = null;
  let testTicket = null;
  let dynamicPayload = null;
  let eventId = null;

  // 1. Authenticate Customer
  await t.test('1. Authenticate Customer', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer@ticketledger.pk',
        password: 'Password@123',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    customerToken = data.data.token;
  });

  // 2. Authenticate Gate Staff
  await t.test('2. Authenticate Gate Staff', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'staff@ticketledger.pk',
        password: 'Password@123',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.user.role, 'GATE_STAFF');
    staffToken = data.data.token;
  });

  // 3. Customer identifies an active ticket
  await t.test('3. Identify active ticket for gate testing', async () => {
    const res = await fetch(`${BASE_URL}/tickets/wallet`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);

    const activeTickets = data.data.tickets.filter((t) => t.status === 'ACTIVE');
    assert.ok(activeTickets.length > 0, 'Customer must have at least 1 ACTIVE ticket');

    testTicket = activeTickets[0];
    eventId = testTicket.event.id;
  });

  // 4. Fetch Real-Time Dynamic Rotating QR (TOTP)
  await t.test('4. Fetch Real-Time Dynamic Rotating QR with 30s window and timeStep', async () => {
    const res = await fetch(`${BASE_URL}/gate/dynamic-qr/${testTicket.id}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    dynamicPayload = data.data.payload;
    assert.equal(dynamicPayload.ticketId, testTicket.id);
    assert.ok(dynamicPayload.timeStep > 0, 'Must have timeStep integer');
    assert.ok(dynamicPayload.expiresAt > Date.now(), 'expiresAt must be in future');
    assert.equal(data.data.windowSeconds, 30);
    assert.ok(data.data.qrCodeDataUrl.startsWith('data:image/png;base64,'), 'Must return base64 QR');
  });

  // 5. Offline Mathematical HMAC Validation
  await t.test('5. Offline Mathematical HMAC Validation verifies signature without database calls', async () => {
    const serviceModule = await import('./src/services/qrTicketService.js');
    const { verifyOfflineHMAC } = serviceModule;

    const offlineResult = verifyOfflineHMAC(dynamicPayload);
    assert.equal(offlineResult.valid, true);
    assert.match(offlineResult.message, /offline hmac signature mathematically verified/i);
  });

  // 6. Gate Staff Turnstile Scan (First Valid Entry)
  await t.test('6. Gate Staff scans valid dynamic QR: Access Granted and status updated to SCANNED', async () => {
    const res = await fetch(`${BASE_URL}/gate/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        payload: dynamicPayload,
        gateNumber: 'Gaddafi Gate 3 - First Class Turnstile',
      }),
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.result, 'VALID_FIRST_SCAN');
    assert.match(data.message, /access granted/i);
    assert.equal(data.ticket.status, 'SCANNED');
    assert.ok(data.ticket.attendee.name);
  });

  // 7. Double-Entry Rejection (Attempting to scan the same ticket at another gate)
  await t.test('7. Double-Entry Prevention: Scanning already used ticket is strictly blocked', async () => {
    const res = await fetch(`${BASE_URL}/gate/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        payload: dynamicPayload,
        gateNumber: 'Gaddafi Gate 1 - Pavilion Turnstile',
      }),
    });
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.equal(data.result, 'ALREADY_SCANNED');
    assert.match(data.message, /double entry rejected/i);
    assert.match(data.message, /already scanned/i);
  });

  // 8. Anti-Screenshot Protection: Expired Dynamic QR is rejected
  await t.test('8. Anti-Screenshot Security: Expired dynamic QR (older than window) is strictly rejected', async () => {
    const serviceModule = await import('./src/services/qrTicketService.js');
    const { createDynamicQRPayload } = serviceModule;

    // Simulate an old screenshot from 10 minutes ago
    const staleTimestamp = Date.now() - (10 * 60 * 1000);
    const expiredPayload = createDynamicQRPayload(testTicket, staleTimestamp);

    const res = await fetch(`${BASE_URL}/gate/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        payload: expiredPayload,
        gateNumber: 'Gate 2',
      }),
    });
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.equal(data.reason, 'EXPIRED_SCREENSHOT');
    assert.match(data.message, /expired/i);
  });

  // 9. Tampered QR Rejection
  await t.test('9. Counterfeit Protection: Tampered payload signature is rejected', async () => {
    const tamperedPayload = {
      ...dynamicPayload,
      seatId: 'counterfeit-seat',
      signature: '0000000000000000000000000000000000000000000000000000000000000000',
    };

    const res = await fetch(`${BASE_URL}/gate/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        payload: tamperedPayload,
        gateNumber: 'Gate 2',
      }),
    });
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.equal(data.reason, 'INVALID_SIGNATURE');
  });

  // 10. Event Gate Check-In Statistics
  await t.test('10. Event Gate Check-In Statistics report admitted count & double-entry blocks', async () => {
    const res = await fetch(`${BASE_URL}/gate/stats/${eventId}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.admittedAttendees >= 1, 'Admitted attendees count must be >= 1');
    assert.ok(data.data.audit.doubleEntryAttemptsBlocked >= 1, 'Double entry blocked count must be >= 1');
    assert.ok(data.data.attendanceRate);
  });

  // 11. Staff Recent Scans Feed
  await t.test('11. Gate Staff retrieves live recent scans feed with turnstile audit logs', async () => {
    const res = await fetch(`${BASE_URL}/gate/recent-scans?limit=10`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data.scans), 'Must return scans array');
    assert.ok(data.data.scans.length >= 1, 'Must have at least 1 recent scan record');
    assert.ok(data.data.scans[0].ticket?.event?.name);
    assert.ok(data.data.scans[0].gateNumber);
  });
});
