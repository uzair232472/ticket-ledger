// Owner-only: authorize (or revoke) the API's minter wallet on TicketLedgerNFT.
// Dry run by default: prints what it would do and checks the current state, sends nothing.
//   NFT_CONTRACT=0x… MINTER=0x… npx hardhat run scripts/set-minter.cjs --network amoy            (dry run)
//   NFT_CONTRACT=0x… MINTER=0x… REVOKE=1 EXECUTE=1 npx hardhat run scripts/set-minter.cjs --network amoy
// Rotation: authorize the new minter, switch the API's NFT_MINTER_PRIVATE_KEY, let the queue drain, revoke the old.
const hre = require("hardhat");

async function main() {
  const contractAddress = hre.ethers.getAddress(process.env.NFT_CONTRACT || "");
  const minter = hre.ethers.getAddress(process.env.MINTER || "");
  const status = !process.env.REVOKE;
  const [signer] = await hre.ethers.getSigners();
  const nft = await hre.ethers.getContractAt("TicketLedgerNFT", contractAddress, signer);

  const owner = await nft.owner();
  const current = await nft.authorizedMinters(minter);
  console.log({ network: hre.network.name, contractAddress, owner, signer: signer.address, minter, currentlyAuthorized: current, wantAuthorized: status });
  if (owner.toLowerCase() === minter.toLowerCase()) throw new Error("The minter must not be the contract owner.");
  if (signer.address.toLowerCase() !== owner.toLowerCase()) throw new Error("Run this with the owner's key (DEPLOYER_PRIVATE_KEY).");
  if (current === status) return console.log("Nothing to do.");
  if (!process.env.EXECUTE) return console.log("Dry run: set EXECUTE=1 to send setMinterStatus.");

  const tx = await nft.setMinterStatus(minter, status);
  console.log("Sent", tx.hash);
  await tx.wait();
  console.log("Confirmed. authorizedMinters =", await nft.authorizedMinters(minter));
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
