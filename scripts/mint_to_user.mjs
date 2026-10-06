// scripts/mint_to_user.mjs
import { ethers } from 'ethers';

async function mintToUser() {
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const signer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);

  const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const ABI = [
    'function mintTicket(address recipient, string tokenURI, string eventId, string tierId, string seatId, uint256 originalPrice, bytes32 ticketHash) returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
  ];

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  const recipient = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // The user's active MetaMask address
  const eventId = 'psl-final-2026';
  const tierId = 'vip-enclosure';
  const seatId = 'seat-V01';
  const originalPrice = 5000;
  const ticketHash = ethers.keccak256(ethers.toUtf8Bytes('ticket-metamask-user-01'));
  const tokenURI = 'data:application/json;base64,' + Buffer.from(JSON.stringify({
    name: 'PSL 10 Final VIP Pass #2',
    description: 'Official TicketLedger NFT Admission Ticket',
    image: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80',
    attributes: [
      { trait_type: 'Event', value: 'PSL 10 Grand Final' },
      { trait_type: 'Seat', value: 'VIP Row A, Seat 1' },
      { trait_type: 'Resale Cap', value: 'PKR 5500 (110%)' }
    ]
  })).toString('base64');

  console.log(`Minting NFT directly to your MetaMask address: ${recipient}...`);
  const tx = await contract.mintTicket(recipient, tokenURI, eventId, tierId, seatId, originalPrice, ticketHash);
  const receipt = await tx.wait();

  console.log('✅ Tx Hash:', receipt.hash);
  const owner = await contract.ownerOf(2);
  console.log('✅ Token ID #2 verified owner:', owner);
}

mintToUser();
