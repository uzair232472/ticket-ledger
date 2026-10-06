// scripts/test_live_mint.mjs
import nftService from '../apps/api/src/services/nftService.js';
import prisma from '../apps/api/src/config/prisma.js';

async function testLiveMint() {
  console.log('--- Testing Live EVM Blockchain Minting ---');
  const ticket = await prisma.ticket.findFirst({
    include: { event: true, seat: { include: { tier: true } }, user: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!ticket) {
    console.error('No ticket found');
    process.exit(1);
  }

  console.log(`Target Ticket ID: ${ticket.id}`);
  console.log(`Event: ${ticket.event.name}`);

  // Reset to test fresh mint
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { tokenId: null, txHash: null },
  });

  console.log('Sending transaction to EVM smart contract at 0x5FbDB2315678afecb367f032d93F642f64180aa3...');
  const result = await nftService.mintTicketNFT(ticket.id);

  console.log('\n🎉 SUCCESS! Real on-chain EVM NFT Ticket Minted:');
  console.log(`  • Token ID: #${result.tokenId}`);
  console.log(`  • Transaction Hash: ${result.txHash}`);
  console.log(`  • Contract Address: ${result.contractAddress}`);
  console.log(`  • Owner Wallet: ${result.ownerWallet}`);
  console.log(`  • 110% Resale Cap: PKR ${result.resaleCap}`);

  await prisma.$disconnect();
}

testLiveMint().catch((err) => {
  console.error('Error during mint test:', err);
  process.exit(1);
});
