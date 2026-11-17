import { ethers } from 'ethers';

/*
 * Blockchain configuration for NFT issuance, and the checks that keep the API's key separate from the
 * contract owner.
 *
 * Roles (never the same key):
 *   - Contract owner: deploys TicketLedgerNFT and calls setMinterStatus. Kept offline / in a multisig; the
 *     API never has it. Hardhat reads it as DEPLOYER_PRIVATE_KEY (contracts/hardhat.config.cjs) only.
 *   - API minter: NFT_MINTER_PRIVATE_KEY. May only mint and invalidate (onlyMinterOrOwner). Checked on start:
 *     it must be an authorized minter and must NOT be the owner.
 *   - Custodian: PLATFORM_CUSTODIAN_WALLET, a wallet the platform controls, receives NFTs of customers with no
 *     wallet. No default: a made-up address would make those NFTs unrecoverable.
 *
 * Modes:
 *   live        key + contract + custodian configured and every check passed
 *   simulation  development only, no key configured: fake token IDs, marked simulated, never "verified"
 *   disabled    anything else (bad config, failed checks, production without a key): nothing is minted, tickets
 *               stay "NFT pending" and admins see why. Production never falls back to simulation.
 */

// Hardhat / Anvil default accounts (mnemonic "test test … junk"): their private keys are published
export const PUBLIC_TEST_ACCOUNTS = new Set(
  [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
    '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
    '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
  ].map((a) => a.toLowerCase()),
);
export const LOCAL_CHAIN_IDS = new Set([31337, 1337]);

const isProduction = () => process.env.NODE_ENV === 'production';

/** A checksummed address, or null. Mixed-case input with a wrong checksum is rejected (it was not copied from a real deployment). */
export const parseAddress = (value) => {
  if (!value) return null;
  try {
    return ethers.getAddress(value);
  } catch {
    return null;
  }
};

/** The configuration from the environment, before any network check. Never includes the key itself. */
export function readChainConfig() {
  const problems = [];
  const rpcUrl = process.env.POLYGON_AMOY_RPC || 'https://rpc-amoy.polygon.technology';
  const chainId = Number(process.env.NFT_CHAIN_ID || 80002);
  const rawKey = process.env.NFT_MINTER_PRIVATE_KEY || '';
  const contractAddress = parseAddress(process.env.TICKET_NFT_CONTRACT_ADDRESS);
  const custodian = parseAddress(process.env.PLATFORM_CUSTODIAN_WALLET);

  if (process.env.POLYGON_PRIVATE_KEY) {
    problems.push('POLYGON_PRIVATE_KEY is set but no longer read by the API (it was also the deployer key). Use a separate NFT_MINTER_PRIVATE_KEY.');
  }

  let minterAddress = null;
  let key = null;
  if (rawKey) {
    try {
      minterAddress = new ethers.Wallet(rawKey).address;
      key = rawKey;
    } catch {
      problems.push('NFT_MINTER_PRIVATE_KEY is not a valid private key.');
    }
  }
  const publicKey = minterAddress && PUBLIC_TEST_ACCOUNTS.has(minterAddress.toLowerCase());
  if (publicKey && (isProduction() || !LOCAL_CHAIN_IDS.has(chainId))) {
    problems.push(`The minter key belongs to a public test account (${minterAddress}); its private key is published. It is only accepted on a local chain outside production.`);
  }
  if (key && !contractAddress) problems.push('TICKET_NFT_CONTRACT_ADDRESS is missing or not a valid checksummed address.');
  if (key && !custodian) problems.push('PLATFORM_CUSTODIAN_WALLET is missing or not a valid checksummed address.');

  let mode;
  if (!key) mode = isProduction() || rawKey ? 'disabled' : 'simulation';
  else mode = problems.some((p) => !p.startsWith('POLYGON_PRIVATE_KEY')) ? 'disabled' : 'pending-checks';
  if (!key && isProduction()) problems.push('NFT_MINTER_PRIVATE_KEY is not set: minting is disabled in production (never simulated).');

  return { mode, rpcUrl, chainId, contractAddress, custodian, minterAddress, key, publicKey, problems };
}

/**
 * Network checks before going live (read-only): the RPC is on the expected chain, the contract exists, the
 * minter is authorized and is not the owner. Returns { ok, owner, problems }.
 */
export async function checkOnChain(config, provider, { timeoutMs = 15000 } = {}) {
  const problems = [];
  const timed = (p, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`${what} timed out`)), timeoutMs))]);
  let owner = null;
  try {
    const network = await timed(provider.send('eth_chainId', []), 'eth_chainId');
    if (Number(network) !== config.chainId) problems.push(`The RPC is on chain ${Number(network)}, expected ${config.chainId} (NFT_CHAIN_ID).`);
    const code = await timed(provider.getCode(config.contractAddress), 'getCode');
    if (code === '0x') {
      problems.push(`No contract is deployed at ${config.contractAddress} on chain ${config.chainId}.`);
    } else {
      const c = new ethers.Contract(config.contractAddress, ['function owner() view returns (address)', 'function authorizedMinters(address) view returns (bool)'], provider);
      owner = await timed(c.owner(), 'owner()');
      if (owner.toLowerCase() === config.minterAddress.toLowerCase()) {
        problems.push('The API minter key is the contract owner. Use a separate minter wallet authorized with setMinterStatus; keep the owner key off the server.');
      }
      if (PUBLIC_TEST_ACCOUNTS.has(owner.toLowerCase()) && !LOCAL_CHAIN_IDS.has(config.chainId)) {
        problems.push(`The contract owner ${owner} is a public test account: anyone can control this contract.`);
      }
      if (!(await timed(c.authorizedMinters(config.minterAddress), 'authorizedMinters()'))) {
        problems.push(`The minter ${config.minterAddress} is not authorized on the contract (the owner must call setMinterStatus).`);
      }
    }
  } catch (e) {
    problems.push(`Chain check failed: ${e.shortMessage || e.message}`);
  }
  return { ok: problems.length === 0, owner, problems };
}
