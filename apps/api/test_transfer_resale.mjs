import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from './src/config/prisma.js';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 11 - Ticket Transfer, Controlled Resale & Anti-Scalping Tests', async (t) => {
  let customerAToken = null;
  let customerAUser = null;
  let customerBToken = null;
  let customerBUser = null;
  let staffToken = null;
  let testTicketA = null;
  let testTicketB = null;
  let activeEventId = null;
  let resaleListingId = null;
  let originalPrice = 0;
  let oldTicketNonce = null;

  // 1. Authenticate Customer A
  await t.test('1. Authenticate Customer A (Original Ticket Holder)', async () => {
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
    assert.ok(data.data.token);
    customerAToken = data.data.token;
    customerAUser = data.data.user;
  });

  // 2. Authenticate Gate Staff
  await t.test('2. Authenticate Gate Staff for turnstile scanner checks', async () => {
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
    staffToken = data.data.token;
  });

  // 3. Register Customer B (Recipient / Buyer)
  await t.test('3. Register fresh Customer B account (Recipient / Buyer)', async () => {
    const uniqueEmail = `buyer_${Date.now()}@ticketledger.pk`;
    const randomPhone = `+92${Math.floor(3000000000 + Math.random() * 99999999)}`;
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail,
        password: 'Password@123',
        name: 'Bilal Khan',
        phone: randomPhone,
      }),
    });
    assert.equal(regRes.status, 201);

    // Registration no longer returns a session; mark the email verified directly, then log in
    await prisma.user.update({ where: { email: uniqueEmail }, data: { emailVerifiedAt: new Date(), status: 'ACTIVE' } });
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail, password: 'Password@123' }),
    });
    const loginData = await loginRes.json();
    assert.equal(loginRes.status, 200);
    customerBToken = loginData.data.token;
    customerBUser = loginData.data.user;
  });

  // 4. Customer A identifies active tickets and cancels any active listing on it to ensure clean slate
  await t.test('4. Identify active tickets in Customer A wallet', async () => {
    // Check and cancel any existing active resale listings for Customer A
    const listingsRes = await fetch(`${BASE_URL}/resale/my-listings`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    });
    const listingsData = await listingsRes.json();
    if (listingsData.data?.listings) {
      for (const listing of listingsData.data.listings) {
        if (listing.status === 'ACTIVE') {
          await fetch(`${BASE_URL}/resale/cancel/${listing.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${customerAToken}` },
          });
        }
      }
    }

    const res = await fetch(`${BASE_URL}/tickets/wallet`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.tickets.length >= 1, 'Customer A should have at least 1 ticket');

    // Pick an active ticket
    const activeTickets = data.data.tickets.filter((tk) => tk.status === 'ACTIVE');
    assert.ok(activeTickets.length >= 1, 'Customer A should have at least 1 active ticket');
    testTicketA = activeTickets[0];
    activeEventId = testTicketA.event.id;
    originalPrice = Number(testTicketA.price);
    oldTicketNonce = testTicketA.qr.nonce;

    assert.ok(testTicketA.id);
    assert.ok(activeEventId);
    assert.ok(originalPrice > 0);
  });

  // 5. Customer B joins the waitlist for this event
  await t.test('5. Customer B joins event waitlist', async () => {
    const res = await fetch(`${BASE_URL}/events/${activeEventId}/waitlist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerBToken}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.waitlistId);

    // Verify waitlist status check endpoint
    const statusRes = await fetch(`${BASE_URL}/events/${activeEventId}/waitlist`, {
      headers: { Authorization: `Bearer ${customerBToken}` },
    });
    const statusData = await statusRes.json();
    assert.equal(statusRes.status, 200);
    assert.equal(statusData.data.onWaitlist, true);
    assert.ok(statusData.data.totalWaitlistCount >= 1);
  });

  // 6. Anti-Scalping Enforcement: Attempt listing ticket above 110% price ceiling
  await t.test('6. Enforce 110% Anti-Scalping cap (Reject price > 110%)', async () => {
    const predatoryPrice = Math.floor(originalPrice * 1.5); // 150%
    const res = await fetch(`${BASE_URL}/resale/list`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerAToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticketId: testTicketA.id,
        resalePrice: predatoryPrice,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.match(data.message, /Anti-scalping violation/i);
  });

  // 7. Legitimate resale listing within 110% cap triggers waitlist notification
  await t.test('7. List ticket within 110% ceiling and notify waitlist users', async () => {
    const compliantPrice = Math.floor(originalPrice * 1.05); // 105%
    const res = await fetch(`${BASE_URL}/resale/list`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerAToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticketId: testTicketA.id,
        resalePrice: compliantPrice,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.success, true);
    assert.ok(data.data.listing.id);
    resaleListingId = data.data.listing.id;
  });

  // 8. Customer B purchases the resale ticket
  await t.test('8. Customer B purchases resale ticket; transfers ownership & invalidates old QR', async () => {
    const res = await fetch(`${BASE_URL}/resale/buy/${resaleListingId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerBToken}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.ticket.userId, customerBUser.id);

    // Nonce must have changed to invalidate seller's QR pass
    assert.notEqual(data.data.ticket.qrNonce, oldTicketNonce);
    testTicketB = data.data.ticket;
  });

  // 9. Customer B transfers ticket directly back to Customer A via email
  await t.test('9. Customer B directly transfers ticket to Customer A via email', async () => {
    const previousNonce = testTicketB.qrNonce;
    const res = await fetch(`${BASE_URL}/tickets/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerBToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticketId: testTicketB.id,
        recipientEmail: customerAUser.email,
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.newOwner.email, customerAUser.email);
    assert.equal(data.data.oldNonceInvalidated, previousNonce);
    assert.ok(data.data.newNonceIssued);
    assert.notEqual(data.data.newNonceIssued, previousNonce);
  });

  // 10. Verify ticket transfer audit history (complete provenance chain)
  await t.test('10. Verify complete Ticket Provenance / Transfer History', async () => {
    const res = await fetch(`${BASE_URL}/tickets/${testTicketA.id}/transfer-history`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.totalTransfers >= 2);

    const history = data.data.history;
    const directTransfer = history.find((h) => h.transferType === 'DIRECT_TRANSFER');
    const p2pResale = history.find((h) => h.transferType === 'P2P_RESALE');

    assert.ok(directTransfer, 'Direct transfer record must exist in history');
    assert.ok(p2pResale, 'P2P Resale record must exist in history');
    assert.equal(directTransfer.toUserId, customerAUser.id);
    assert.equal(p2pResale.toUserId, customerBUser.id);
  });

  // 11. Verify personal transfer history for user
  await t.test('11. Customer retrieves personal transfer history (sent & received)', async () => {
    const res = await fetch(`${BASE_URL}/tickets/my-transfers`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.sentCount >= 0);
    assert.ok(data.data.receivedCount >= 1);
  });

  // 12. Invalidate old QR code: Gate turnstile scanner rejects old invalidated QR payload
  await t.test('12. Gate turnstile rejects invalidated old QR code from previous owner', async () => {
    // Generate forged or outdated dynamic payload using the old invalidated nonce
    const serviceModule = await import('./src/services/qrTicketService.js');
    const { createDynamicQRPayload } = serviceModule;

    const outdatedTicket = {
      ...testTicketA,
      qrNonce: oldTicketNonce, // OUTDATED NONCE!
    };
    const outdatedPayload = createDynamicQRPayload(outdatedTicket);

    const res = await fetch(`${BASE_URL}/gate/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        payload: outdatedPayload,
        gateNumber: 'GATE_NORTH_3',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.equal(data.reason, 'INVALIDATED_OLD_QR');
    assert.match(data.message, /transferred or resold|revoked/i);
  });
});
