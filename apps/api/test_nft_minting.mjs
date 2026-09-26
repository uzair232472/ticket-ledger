import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 8 - Smart Contract, Polygon Amoy NFT Minting & Anti-Scalping Tests', async (t) => {
  let customerToken = null;
  let eventId = null;
  let selectedSeat = null;
  let orderId = null;
  let mintedTicketId = null;

  // 1. Authenticate Customer
  await t.test('1. Authenticate Customer with connected Web3 wallet', async () => {
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
  });

  // 2. Find available seat on PSL 2026 Final
  await t.test('2. Identify available seat for NFT issuance', async () => {
    const eventsRes = await fetch(`${BASE_URL}/events?search=PSL`);
    const eventsData = await eventsRes.json();
    eventId = eventsData.data.events[0].id;

    const seatsRes = await fetch(`${BASE_URL}/seats/event/${eventId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const seatsData = await seatsRes.json();
    const available = seatsData.data.seats.filter((s) => s.status === 'AVAILABLE');
    assert.ok(available.length > 0, 'Must have at least 1 available seat');
    selectedSeat = available[0];
  });

  // 3. Lock seat and initiate booking
  await t.test('3. Lock seat and initiate booking', async () => {
    // Lock seat
    const lockRes = await fetch(`${BASE_URL}/seats/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ seatId: selectedSeat.id }),
    });
    assert.equal(lockRes.status, 200);

    // Initiate
    const initRes = await fetch(`${BASE_URL}/bookings/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        eventId,
        seatIds: [selectedSeat.id],
        paymentMethod: 'MOCK',
      }),
    });
    const initData = await initRes.json();
    assert.equal(initRes.status, 201);
    orderId = initData.data.orderId;
    assert.ok(orderId);
  });

  // 4. Confirm booking and verify automatic Polygon Amoy NFT minting
  await t.test('4. Confirm booking and verify automatic Polygon Amoy ERC721 NFT minting', async () => {
    const confirmRes = await fetch(`${BASE_URL}/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        orderId,
        paymentDetails: { paymentTxId: `TX_MOCK_${Date.now()}` },
      }),
    });

    const confirmData = await confirmRes.json();
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmData.success, true);
    assert.match(confirmData.message, /ERC721 NFT tickets minted/i);

    const nfts = confirmData.data.nftTickets;
    assert.ok(Array.isArray(nfts));
    assert.ok(nfts.length > 0);

    const firstNFT = nfts[0];
    assert.ok(firstNFT.tokenId > 0);
    assert.match(firstNFT.txHash, /^0x[a-fA-F0-9]{64}$/);
    assert.match(firstNFT.contractAddress, /^0x[a-fA-F0-9]{40}$/);
    assert.match(firstNFT.polygonscanUrl, /amoy\.polygonscan\.com/);

    mintedTicketId = confirmData.data.order.tickets[0].id;
  });

  // 5. Explicit Batch Mint endpoint is idempotent
  await t.test('5. Explicit mint endpoint is idempotent for already minted tickets', async () => {
    const mintRes = await fetch(`${BASE_URL}/tickets/mint/${orderId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
    });

    const mintData = await mintRes.json();
    assert.equal(mintRes.status, 200);
    assert.equal(mintData.success, true);
    assert.equal(mintData.data.totalMinted, 1);
    assert.equal(mintData.data.nfts[0].alreadyMinted, true);
  });

  // 6. Retrieve customer's Web3 NFT collection
  await t.test('6. Customer retrieves Web3 NFT tickets gallery with on-chain metadata', async () => {
    const nftsRes = await fetch(`${BASE_URL}/tickets/my-nfts`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const nftsData = await nftsRes.json();
    assert.equal(nftsRes.status, 200);
    assert.equal(nftsData.success, true);
    assert.ok(nftsData.data.tickets.length > 0);

    const targetTicket = nftsData.data.tickets.find((t) => t.id === mintedTicketId);
    assert.ok(targetTicket);
    assert.equal(targetTicket.blockchain.isMinted, true);
    assert.equal(targetTicket.blockchain.network, 'Polygon Amoy Testnet');
    assert.equal(targetTicket.blockchain.chainId, 80002);
    assert.ok(targetTicket.blockchain.polygonscanTxUrl);

    // Anti-Scalping resale cap check: price * 1.10
    const expectedCap = Math.floor(targetTicket.price * 1.1);
    assert.equal(targetTicket.resalePriceCap, expectedCap);
  });

  // 7. Retrieve single NFT verification
  await t.test('7. Single NFT ticket verification returns tamper-proof credentials', async () => {
    const singleRes = await fetch(`${BASE_URL}/tickets/nft/${mintedTicketId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const singleData = await singleRes.json();
    assert.equal(singleRes.status, 200);
    assert.equal(singleData.success, true);

    const ticket = singleData.data.ticket;
    assert.equal(ticket.id, mintedTicketId);
    assert.ok(ticket.blockchain.tokenId);
    assert.ok(ticket.blockchain.txHash);
    assert.match(ticket.blockchain.polygonscanUrl, /amoy\.polygonscan\.com\/tx\/0x/);
  });
});
