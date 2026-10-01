import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from './src/config/prisma.js';

const BASE_URL = 'http://localhost:5000/api';

// Registration no longer returns a session; mark the email verified directly, then log in
async function registerVerifiedCustomer(details) {
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(details),
  });
  assert.equal(regRes.status, 201);
  await prisma.user.update({ where: { email: details.email.toLowerCase() }, data: { isVerified: true } });

  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: details.email, password: details.password }),
  });
  assert.equal(loginRes.status, 200);
  return (await loginRes.json()).data;
}

test('MODULE 9 - P2P Resale Marketplace & Anti-Scalping Rules Tests', async (t) => {
  let sellerToken = null;
  let sellerId = null;
  let buyerToken = null;
  let buyerId = null;
  let testTicket = null;
  let listingId = null;
  let relistedId = null;

  // 1. Authenticate Seller (Customer 1)
  await t.test('1. Authenticate Seller (Customer 1)', async () => {
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
    sellerToken = data.data.token;
    sellerId = data.data.user.id;
  });

  // 2. Authenticate Buyer (Customer 2)
  await t.test('2. Authenticate Buyer (Customer 2)', async () => {
    const buyerEmail = `buyer_${Date.now()}@ticketledger.pk`;
    const data = await registerVerifiedCustomer({
      name: 'Usman Buyer',
      email: buyerEmail,
      password: 'Password@123',
    });
    buyerToken = data.token;
    buyerId = data.user.id;
    assert.notEqual(sellerId, buyerId);
  });

  // 3. Seller identifies an owned ticket
  await t.test('3. Seller identifies an owned active ticket', async () => {
    const res = await fetch(`${BASE_URL}/tickets/my-nfts`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.tickets.length > 0, 'Seller must have at least 1 ticket');
    testTicket = data.data.tickets[0];
  });

  // 4. Anti-Scalping Enforcement: Reject listing exceeding 110% cap
  await t.test('4. Anti-Scalping Enforcement: Attempting to list above 110% ceiling is strictly rejected', async () => {
    const originalPrice = Number(testTicket.price);
    const scalpedPrice = Math.floor(originalPrice * 1.50); // 150% of price (50% markup)

    const res = await fetch(`${BASE_URL}/resale/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        ticketId: testTicket.id,
        resalePrice: scalpedPrice,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.match(data.message, /anti-scalping violation/i);
    assert.match(data.message, /110% of original price/i);
  });

  // 5. Valid Resale Listing within 110% ceiling
  await t.test('5. Seller successfully lists ticket at regulated price (<= 110%)', async () => {
    const originalPrice = Number(testTicket.price);
    const compliantPrice = Math.floor(originalPrice * 1.05); // 105% (legal 5% markup)

    const res = await fetch(`${BASE_URL}/resale/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        ticketId: testTicket.id,
        resalePrice: compliantPrice,
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.success, true);
    assert.ok(data.data.listing.id);
    assert.equal(data.data.listing.status, 'ACTIVE');
    assert.equal(Number(data.data.listing.resalePrice), compliantPrice);
    listingId = data.data.listing.id;
  });

  // 6. Prevent Duplicate Resale Listing
  await t.test('6. Anti-Duplicate: Seller cannot list the same ticket twice', async () => {
    const res = await fetch(`${BASE_URL}/resale/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        ticketId: testTicket.id,
        resalePrice: Number(testTicket.price),
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 409);
    assert.match(data.message, /already actively listed/i);
  });

  // 7. Public Secondary Market Discovery
  await t.test('7. Public marketplace discovery returns active verified listings', async () => {
    const res = await fetch(`${BASE_URL}/resale/market`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.data.listings.length > 0);

    const found = data.data.listings.find((l) => l.id === listingId);
    assert.ok(found);
    assert.equal(found.seller.id, sellerId);
    assert.equal(found.status, 'ACTIVE');
    assert.ok(found.markupPercent <= 10);
  });

  // 8. Seller cancels listing
  await t.test('8. Seller cancels active resale listing', async () => {
    const res = await fetch(`${BASE_URL}/resale/cancel/${listingId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.listing.status, 'CANCELLED');
  });

  // 9. Relist and Buyer 2 purchases secondary ticket
  await t.test('9. Seller relists, and Buyer 2 purchases verified resale ticket', async () => {
    const compliantPrice = Math.floor(Number(testTicket.price) * 1.08);

    // Relist
    const listRes = await fetch(`${BASE_URL}/resale/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sellerToken}`,
      },
      body: JSON.stringify({
        ticketId: testTicket.id,
        resalePrice: compliantPrice,
      }),
    });
    const listData = await listRes.json();
    assert.equal(listRes.status, 201);
    relistedId = listData.data.listing.id;

    // Seller cannot buy their own ticket
    const selfBuyRes = await fetch(`${BASE_URL}/resale/buy/${relistedId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    assert.equal(selfBuyRes.status, 400);

    // Buyer 2 purchases ticket
    const buyRes = await fetch(`${BASE_URL}/resale/buy/${relistedId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const buyData = await buyRes.json();
    assert.equal(buyRes.status, 200);
    assert.equal(buyData.success, true);
    assert.equal(buyData.data.ticket.userId, buyerId);
    assert.notEqual(buyData.data.ticket.qrNonce, testTicket.qrNonce, 'QR nonce must be regenerated to revoke seller access');
  });

  // 10. Verify seller no longer owns ticket and listing is marked SOLD
  await t.test('10. Atomic Ownership Transfer: Seller no longer holds ticket and listing is SOLD', async () => {
    // Seller's NFT list should not include this ticket anymore
    const sellerNFTsRes = await fetch(`${BASE_URL}/tickets/my-nfts`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    const sellerNFTsData = await sellerNFTsRes.json();
    const stillPresentForSeller = sellerNFTsData.data.tickets.find((t) => t.id === testTicket.id);
    assert.equal(stillPresentForSeller, undefined);

    // Buyer's NFT list must include this ticket
    const buyerNFTsRes = await fetch(`${BASE_URL}/tickets/my-nfts`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const buyerNFTsData = await buyerNFTsRes.json();
    const nowOwnedByBuyer = buyerNFTsData.data.tickets.find((t) => t.id === testTicket.id);
    assert.ok(nowOwnedByBuyer);

    // Attempting to buy an already SOLD listing fails
    const secondBuyRes = await fetch(`${BASE_URL}/resale/buy/${relistedId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    assert.equal(secondBuyRes.status, 400);
  });
});
