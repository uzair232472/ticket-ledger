const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deploying TicketLedgerNFT contract with account:", deployer.address);

  const TicketLedgerNFT = await hre.ethers.getContractFactory("TicketLedgerNFT");
  const ticketNFT = await TicketLedgerNFT.deploy(deployer.address);
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
