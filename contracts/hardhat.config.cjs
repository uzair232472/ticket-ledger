require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Remote deploys use DEPLOYER_PRIVATE_KEY (the contract owner's key, kept off the API server). The API never reads
// it: it mints with its own NFT_MINTER_PRIVATE_KEY, authorized by the owner with scripts/set-minter.cjs.
// Hardhat's default accounts have published keys: a contract they own can be taken over by anyone.
const PUBLIC_TEST_ACCOUNTS = new Set([
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65", "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
  "0x976ea74026e726554db657fa54763abd0c3a0aa9", "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
  "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f", "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
]);
function remoteAccounts() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) return [];
  const { Wallet } = require("ethers");
  const address = new Wallet(key).address.toLowerCase();
  if (PUBLIC_TEST_ACCOUNTS.has(address)) {
    throw new Error(`DEPLOYER_PRIVATE_KEY belongs to a public Hardhat test account (${address}); refusing to use it on a remote network.`);
  }
  return [key];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    amoy: {
      url: process.env.POLYGON_AMOY_RPC || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: remoteAccounts(),
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
