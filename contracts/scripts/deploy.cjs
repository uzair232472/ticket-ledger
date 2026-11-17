const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deploying TicketLedgerNFT contract with account:", deployer.address);

  // The owner can be a separate wallet (e.g. a multisig): CONTRACT_OWNER_ADDRESS. Never the API's minter wallet.
  const owner = process.env.CONTRACT_OWNER_ADDRESS ? hre.ethers.getAddress(process.env.CONTRACT_OWNER_ADDRESS) : deployer.address;
  if (process.env.NFT_MINTER_ADDRESS && owner.toLowerCase() === process.env.NFT_MINTER_ADDRESS.toLowerCase()) {
    throw new Error("CONTRACT_OWNER_ADDRESS must not be the API minter wallet.");
  }
  console.log("👤 Contract owner:", owner);

  const TicketLedgerNFT = await hre.ethers.getContractFactory("TicketLedgerNFT");
  const ticketNFT = await TicketLedgerNFT.deploy(owner);
  await ticketNFT.waitForDeployment();

  const contractAddress = await ticketNFT.getAddress();
  console.log("✅ TicketLedgerNFT deployed successfully!");
  console.log("📍 Contract Address on Polygon Amoy:", contractAddress);
  console.log("🔗 Polygonscan URL: https://amoy.polygonscan.com/address/" + contractAddress);

  return contractAddress;
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});
