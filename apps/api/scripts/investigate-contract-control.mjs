// Read-only: which TicketLedger-style contracts exist on Polygon Amoy / mainnet, and who controls them.
// Checks known addresses, plus every contract created by the given deployer wallets (CREATE addresses by nonce).
// Sends no transactions and uses no private key.
//   node scripts/investigate-contract-control.mjs [--deployer 0x...] [--rpc-amoy URL] [--rpc-polygon URL] [--json]
import { ethers } from 'ethers';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const NETWORKS = [
  { name: 'Polygon Amoy', chainId: 80002, rpc: arg('--rpc-amoy', 'https://rpc-amoy.polygon.technology') },
  { name: 'Polygon mainnet', chainId: 137, rpc: arg('--rpc-polygon', 'https://polygon-rpc.com') },
];
// Hardhat / Anvil default accounts: their private keys are published, so anything they control is public
const PUBLIC_ACCOUNTS = {
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266': 'Hardhat #0',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8': 'Hardhat #1',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC': 'Hardhat #2',
};
const DEPLOYERS = [...new Set([...process.argv.flatMap((a, i) => (process.argv[i - 1] === '--deployer' ? [a] : [])), ...Object.keys(PUBLIC_ACCOUNTS)])];
const KNOWN = {
  '0x9a8F463F83C1c513dBd743aEb2F30113D1a30F21': 'nftService default / 20 tickets',
  '0x5FbDB2315678afecb367f032d93F642f64180aa3': '.env TICKET_NFT_CONTRACT_ADDRESS / 2 tickets',
  '0x62957777413D3ebB340d87fa06E982F72d34F234': 'adminService display fallback',
  '0x71C8366420A094715FE4245b0a3A7e3848EaF220': 'hardcoded custodian wallet',
};
const ABI = [
  'function owner() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function authorizedMinters(address) view returns (bool)',
  'function seatToTokenId(string) view returns (uint256)',
];
const MAX_NONCES = Number(arg('--max-nonces', 60));
const TIMEOUT = 20000;
const timed = (p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), TIMEOUT))]);
const safe = async (fn) => {
  try {
    return await timed(fn());
  } catch (e) {
    return { error: e.shortMessage || e.message };
  }
};
const label = (a) => (a && !a.error ? PUBLIC_ACCOUNTS[ethers.getAddress(a)] || a : a?.error || a);

async function inspect(provider, address, source) {
  const code = await safe(() => provider.getCode(address));
  if (code?.error) return { address, source, error: code.error };
  if (code === '0x') return { address, source, contract: false };
  const c = new ethers.Contract(address, ABI, provider);
  const [owner, name, symbol, seatProbe] = await Promise.all([safe(() => c.owner()), safe(() => c.name()), safe(() => c.symbol()), safe(() => c.seatToTokenId('probe-probe'))]);
  const minters = {};
  for (const [a, n] of Object.entries(PUBLIC_ACCOUNTS)) {
    const m = await safe(() => c.authorizedMinters(a));
    minters[n] = m?.error ? 'n/a' : m;
  }
  for (const d of DEPLOYERS.filter((d) => !PUBLIC_ACCOUNTS[d])) {
    const m = await safe(() => c.authorizedMinters(d));
    minters[d] = m?.error ? 'n/a' : m;
  }
  const ownerAddr = owner?.error ? null : owner;
  return {
    address,
    source,
    contract: true,
    ticketLedgerLike: !seatProbe?.error,
    name: name?.error ? null : name,
    symbol: symbol?.error ? null : symbol,
    owner: ownerAddr,
    ownerLabel: label(ownerAddr),
    ownerIsPublicKey: ownerAddr ? Boolean(PUBLIC_ACCOUNTS[ethers.getAddress(ownerAddr)]) : null,
    publicKeyIsMinter: Object.entries(minters).some(([k, v]) => k.startsWith('Hardhat') && v === true),
    minters,
  };
}

const report = [];
for (const net of NETWORKS) {
  const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: ethers.Network.from(net.chainId) });
  const chain = await safe(() => provider.send('eth_chainId', []));
  const entry = { network: net.name, chainId: net.chainId, reachable: !chain?.error, error: chain?.error, wallets: [], contracts: [] };
  report.push(entry);
  if (chain?.error) continue;

  const seen = new Set();
  for (const [address, source] of Object.entries(KNOWN)) {
    seen.add(address.toLowerCase());
    entry.contracts.push(await inspect(provider, address, source));
  }
  for (const from of DEPLOYERS) {
    const nonce = await safe(() => provider.getTransactionCount(from));
    const balance = await safe(() => provider.getBalance(from));
    const w = { address: from, label: PUBLIC_ACCOUNTS[from] || 'given deployer', nonce, balance: balance?.error ? balance : ethers.formatEther(balance), created: [] };
    entry.wallets.push(w);
    if (typeof nonce !== 'number') continue;
    // Contracts created by this wallet with plain CREATE live at getCreateAddress(from, n)
    for (let n = 0; n < Math.min(nonce, MAX_NONCES); n++) {
      const address = ethers.getCreateAddress({ from, nonce: n });
      const code = await safe(() => provider.getCode(address));
      if (!code || code.error || code === '0x') continue;
      w.created.push(address);
      if (!seen.has(address.toLowerCase())) {
        seen.add(address.toLowerCase());
        entry.contracts.push(await inspect(provider, address, `created by ${w.label} (nonce ${n})`));
      }
    }
    w.scannedNonces = Math.min(nonce, MAX_NONCES);
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const e of report) {
    console.log(`\n=== ${e.network} (${e.chainId}) reachable: ${e.reachable}${e.error ? ` (${e.error})` : ''}`);
    for (const w of e.wallets) console.log(`wallet ${w.label} ${w.address}: nonce ${JSON.stringify(w.nonce)}, balance ${JSON.stringify(w.balance)}, contracts created (first ${w.scannedNonces ?? 0} nonces): ${w.created.length}`);
    for (const c of e.contracts) {
      if (!c.contract) {
        console.log(`  ${c.address} [${c.source}]: ${c.error ? `error ${c.error}` : 'no contract'}`);
        continue;
      }
      console.log(`  ${c.address} [${c.source}]: ${c.name || '?'} ${c.symbol || ''} ticketLedgerLike=${c.ticketLedgerLike} owner=${c.ownerLabel} ownerIsPublicKey=${c.ownerIsPublicKey} publicKeyIsMinter=${c.publicKeyIsMinter} minters=${JSON.stringify(c.minters)}`);
    }
  }
}
