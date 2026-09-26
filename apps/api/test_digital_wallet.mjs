import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 9 - Digital Ticket and QR Wallet Tests', async (t) => {
  let customerToken = null;
  let customerId = null;
  let walletTickets = [];
  let testTicket = null;

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
    assert.equal(data.success, true);
    customerToken = data.data.token;
    customerId = data.data.user.id;
  });

  // 2. Fetch Customer Digital Wallet
  await t.test('2. Customer retrieves Digital Ticket & QR Wallet with all purchased tickets', async () => {
    const res = await fetch(`${BASE_URL}/tickets/wallet`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.data.tickets), 'Must return tickets array');
    assert.ok(data.data.tickets.length > 0, 'Customer must have at least 1 ticket');

    walletTickets = data.data.tickets;
    testTicket = walletTickets.find((t) => t.status === 'ACTIVE') || walletTickets[0];
  });

  // 3. Verify Ticket Card Metadata (event, date, seat, tier, price, status, NFT tokenId, txHash)
  await t.test('3. Each ticket card includes event, date, seat, tier, price, status, NFT tokenId, txHash', async () => {
    assert.ok(testTicket.id, 'Must have ticket id');
    assert.ok(testTicket.event?.name, 'Must have event name');
    assert.ok(testTicket.event?.date, 'Must have event date');
    assert.ok(testTicket.event?.venue, 'Must have venue');
    assert.ok(testTicket.seat?.tierName, 'Must have seat tier name');
    assert.ok(testTicket.seat?.row, 'Must have row');
    assert.ok(testTicket.seat?.seatNumber, 'Must have seat number');
    assert.ok(testTicket.price > 0, 'Must have price');
    assert.ok(testTicket.status, 'Must have ticket status');

    // NFT details
    assert.ok(testTicket.nft, 'Must have NFT object');
    assert.ok(testTicket.nft.tokenId !== undefined, 'Must have NFT tokenId');
    assert.ok(testTicket.nft.txHash, 'Must have txHash');
    assert.ok(testTicket.nft.contractAddress, 'Must have contractAddress');
    assert.ok(testTicket.nft.network.includes('Polygon Amoy'), 'Network must be Polygon Amoy');
  });

  // 4. Verify NFT Ownership Badge
  await t.test('4. Ticket displays verified NFT ownership badge', async () => {
    const badge = testTicket.nft.ownershipBadge;
    assert.ok(badge, 'Must have ownershipBadge');
    assert.equal(badge.isOwner, true);
    assert.equal(badge.network, 'Polygon Amoy');
    assert.equal(badge.label, 'Verified ERC721 NFT Pass');
    assert.ok(badge.wallet, 'Must show owner wallet address');
  });

  // 5. Verify Cryptographic QR Payload structure & Base64 QR generation
  await t.test('5. Generate QR code with ticketId, eventId, tokenId, nonce, issuedAt, qrVersion, signature', async () => {
    assert.ok(testTicket.qr, 'Must have QR object');
    assert.ok(testTicket.qr.qrCodeDataUrl.startsWith('data:image/png;base64,'), 'QR data URL must be base64 PNG');

    const payload = testTicket.qr.payload;
    assert.equal(payload.ticketId, testTicket.id);
    assert.equal(payload.eventId, testTicket.event.id);
    assert.equal(payload.tokenId, testTicket.nft.tokenId);
    assert.equal(payload.nonce, testTicket.qr.nonce);
    assert.ok(payload.issuedAt > 0, 'Must have issuedAt timestamp');
    assert.equal(payload.qrVersion, '1.0');
    assert.ok(payload.signature.length >= 64, 'Must have 64-char HMAC-SHA256 signature');
  });

  // 6. Verify QR Gate Validation Success
  await t.test('6. Cryptographic QR verification accepts valid authentic payload', async () => {
    const res = await fetch(`${BASE_URL}/tickets/verify-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ payload: testTicket.qr.payload }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.valid, true);
    assert.match(data.message, /verified/i);
  });

  // 7. Anti-Forgery: Tampered payload is rejected
  await t.test('7. Anti-Forgery: Tampered or forged QR payload is strictly rejected', async () => {
    const tamperedPayload = {
      ...testTicket.qr.payload,
      tokenId: 999999, // tampered token ID
    };

    const res = await fetch(`${BASE_URL}/tickets/verify-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ payload: tamperedPayload }),
    });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.equal(data.valid, false);
    assert.equal(data.reason, 'INVALID_SIGNATURE');
  });

  // 8. PDF Ticket Download using PDFKit
  await t.test('8. PDF Ticket download using PDFKit streams valid PDF document', async () => {
    const res = await fetch(`${BASE_URL}/tickets/${testTicket.id}/pdf`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');

    const buffer = await res.arrayBuffer();
    const pdfBytes = new Uint8Array(buffer);
    assert.ok(pdfBytes.length > 5000, 'PDF size must be substantial (>5KB)');

    // Verify PDF header magic bytes %PDF-
    const headerString = String.fromCharCode(...pdfBytes.slice(0, 5));
    assert.equal(headerString, '%PDF-');
  });

  // 9. Old QR Invalidation after Nonce Rotation (Transfer or Resale)
  await t.test('9. Old QR is permanently invalidated after ticket transfer or resale', async () => {
    // Save the original QR payload
    const oldPayload = { ...testTicket.qr.payload };

    // Simulate transfer/resale by rotating ticket's nonce directly in DB or via API
    const prismaModule = await import('./src/config/prisma.js');
    const prisma = prismaModule.default;

    const newNonce = `rotated_nonce_${Date.now()}`;
    await prisma.ticket.update({
      where: { id: testTicket.id },
      data: { qrNonce: newNonce },
    });

    // Attempt to verify the OLD QR payload with the previous nonce
    const res = await fetch(`${BASE_URL}/tickets/verify-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ payload: oldPayload }),
    });
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.valid, false);
    assert.equal(data.reason, 'INVALIDATED_OLD_QR');
    assert.match(data.message, /invalidated/i);

    // Restore original nonce so future operations remain intact
    await prisma.ticket.update({
      where: { id: testTicket.id },
      data: { qrNonce: oldPayload.nonce },
    });
  });
});
