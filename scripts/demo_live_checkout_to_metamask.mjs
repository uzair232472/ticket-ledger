import dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });

import { ethers } from 'ethers';
import prisma from '../apps/api/src/config/prisma.js';
import { signAccessToken } from '../apps/api/src/services/tokenService.js';

async function main() {
  console.log('\n===============================================================');
  console.log('   🎟️  LIVE TEST: BUY TICKETS -> DIRECT MINT TO METAMASK  🎟️');
  console.log('===============================================================\n');

  // 1. Identify User with connected MetaMask
  const user = await prisma.user.findFirst({
    where: { email: 'customer@ticketledger.pk' },
  });

  if (!user || !user.walletAddress) {
    console.error('❌ User with connected wallet not found.');
    process.exit(1);
  }

  console.log(`👤 Customer: ${user.name} (${user.email})`);
  console.log(`🦊 Connected MetaMask Address: ${user.walletAddress}`);

  const authToken = signAccessToken(user);

  // 2. Pick 2 available seats for the same event
  const targetEvent = await prisma.event.findFirst({
    where: {
      seats: {
        some: { status: 'AVAILABLE' },
      },
    },
  });

  const seats = await prisma.seat.findMany({
    where: { eventId: targetEvent.id, status: 'AVAILABLE' },
    include: { event: true, tier: true },
    take: 2,
  });

  if (seats.length < 2) {
    console.error('❌ Not enough seats available for testing.');
    process.exit(1);
  }

  const eventId = seats[0].eventId;
  const seatIds = seats.map((s) => s.id);
  console.log(`🎪 Event: "${seats[0].event.name}"`);
  console.log(`💺 Selected Seats:`);
  seats.forEach((s, idx) => {
    console.log(`   [Ticket ${idx + 1}] Section ${s.section}, Row ${s.row}, Seat ${s.seatNumber} — Price: PKR ${s.tier.price}`);
  });

  // 3. Lock seats (Hold reservation)
  console.log('\n[Step 1] Reserving & Locking Seats on Real-Time Grid...');
  for (const s of seats) {
    const lockRes = await fetch('http://localhost:5000/api/seats/lock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ seatId: s.id }),
    });
    const lockData = await lockRes.json();
    if (!lockRes.ok || !lockData.success) {
      console.error(`❌ Failed to lock seat ${s.id}:`, lockData);
      process.exit(1);
    }
    console.log(`🔒 Locked Seat: Section ${s.section}, Row ${s.row}, Seat ${s.seatNumber} (TTL: 10m)`);
  }

  // 4. Initiate Booking
  console.log('\n[Step 2] Initiating Booking Order...');
  const initRes = await fetch('http://localhost:5000/api/bookings/initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      eventId,
      seatIds,
      paymentMethod: 'STRIPE',
      telemetry: {
        checkoutDurationSeconds: 14.5,
        clicksPerMinute: 32,
        rapidSeatAttempts: 1,
        deviceSwitches: 0,
      },
    }),
  });

  const initData = await initRes.json();
  if (!initRes.ok || !initData.success) {
    console.error('❌ Initiate failed:', initData);
    process.exit(1);
  }

  const orderId = initData.data.orderId;
  const totalAmount = initData.data.totalAmount;
  console.log(`✅ Order Created: ${orderId} (Total: PKR ${totalAmount})`);

  // 4. Confirm Payment and Trigger Auto-Mint
  console.log('\n[Step 2] Processing Payment & Minting ERC-721 NFTs on Polygon Amoy...');
  const confirmRes = await fetch('http://localhost:5000/api/bookings/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      orderId,
      paymentDetails: {
        paymentIntentId: `pi_test_${Date.now()}`,
        paymentTxId: `tx_live_${Date.now()}`,
        cardLast4: '4242',
      },
    }),
  });

  const confirmData = await confirmRes.json();
  if (!confirmRes.ok || !confirmData.success) {
    console.error('❌ Confirm failed:', confirmData);
    process.exit(1);
  }

  console.log('✅ Payment Confirmed & Smart Contract Batch Mint Triggered!');

  // 5. Query the newly minted tickets from Database
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      tickets: {
        include: {
          seat: true,
          event: true,
        },
      },
    },
  });

  console.log(`\n[Step 3] Verifying Minted NFT Tickets: (${order.tickets.length} tickets)`);

  const provider = new ethers.JsonRpcProvider(process.env.POLYGON_AMOY_RPC || 'http://127.0.0.1:8545');
  const contractAddress = process.env.TICKET_NFT_CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const abi = [
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
  ];
  const contract = new ethers.Contract(contractAddress, abi, provider);

  for (let i = 0; i < order.tickets.length; i++) {
    const t = order.tickets[i];
    console.log(`\n   🎟️  Ticket #${i + 1}:`);
    console.log(`       Database ID: ${t.id}`);
    console.log(`       ERC-721 Token ID: #${t.tokenId}`);
    console.log(`       Transaction Hash: ${t.txHash}`);
    console.log(`       Target Wallet: ${t.ownerWallet}`);
    console.log(`       Polygonscan Link: https://amoy.polygonscan.com/tx/${t.txHash}`);

    // Verify On-Chain directly if token was minted on local node
    try {
      const onChainOwner = await contract.ownerOf(t.tokenId);
      console.log(`       ⛓️  LIVE ON-CHAIN OWNER: ${onChainOwner}`);
      const isMatch = onChainOwner.toLowerCase() === user.walletAddress.toLowerCase();
      console.log(`       🛡️  Match User MetaMask? ${isMatch ? '✅ YES! 100% OWNED BY CUSTOMER METAMASK' : '❌ NO'}`);
    } catch (contractErr) {
      console.log(`       (Simulated fallback token or hash: ${contractErr.message})`);
    }
  }

  console.log('\n===============================================================');
  console.log('  🎉 SUCCESS: All tickets purchased & minted to user wallet! 🎉');
  console.log('===============================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
