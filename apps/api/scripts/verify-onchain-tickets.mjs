// Read-only, ticket by ticket: is each ticket's recorded NFT really on a chain, owned and fingerprinted as the
// database says? Checks every network given (default: Polygon Amoy, Polygon mainnet, local Hardhat) against the
// contract address stored on each ticket. Sends no transactions, uses no private key, writes nothing to the
// database. Writes a JSON and a Markdown report.
//   node scripts/verify-onchain-tickets.mjs [--out DIR] [--net name=chainId=rpcUrl ...]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import prisma from '../src/config/prisma.js';
import { ticketStates } from '../src/services/ticketStatus.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const nets = args.flatMap((a, i) => (args[i - 1] === '--net' ? [a] : []));
const NETWORKS = (nets.length ? nets : [
  'amoy=80002=https://polygon-amoy-bor-rpc.publicnode.com',
  'polygon=137=https://polygon-bor-rpc.publicnode.com',
  'hardhat-local=31337=http://127.0.0.1:8545',
]).map((s) => {
  const [name, chainId, ...rest] = s.split('=');
  return { name, chainId: Number(chainId), rpc: rest.join('=') };
});
const OUT = opt('--out', '.');
const ABI = [
  'function seatToTokenId(string) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tickets(uint256) view returns (uint256 tokenId, string eventId, string tierId, string seatId, uint256 originalPrice, uint256 resalePriceCap, bytes32 ticketHash, bool isInvalidated, uint256 mintedAt)',
];
const T = 15000;
const timed = (p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), T))]);
const safe = async (fn) => {
  try {
    return { ok: true, value: await timed(fn()) };
  } catch (e) {
    return { ok: false, error: e.shortMessage || e.code || e.message };
  }
};
const validAddress = (a) => {
  try {
    return ethers.getAddress(a);
  } catch {
    return null;
  }
};

// Network reachability, and whether each recorded contract has code there
const tickets = await prisma.ticket.findMany({ include: { order: { select: { status: true } }, event: { select: { name: true } }, seat: { select: { section: true, row: true, seatNumber: true } } }, orderBy: { createdAt: 'asc' } });
const contracts = [...new Set(tickets.map((t) => t.contractAddress).filter(Boolean))];
const networks = [];
for (const n of NETWORKS) {
  const provider = new ethers.JsonRpcProvider(n.rpc, n.chainId, { staticNetwork: ethers.Network.from(n.chainId) });
  const chain = await safe(() => provider.send('eth_chainId', []));
  const entry = { ...n, rpc: new URL(n.rpc).host, provider, reachable: chain.ok && Number(chain.value) === n.chainId, error: chain.ok ? null : chain.error, code: {} };
  if (entry.reachable) {
    for (const c of contracts) {
      const addr = c.toLowerCase();
      const code = await safe(() => provider.getCode(addr));
      entry.code[c] = code.ok ? code.value !== '0x' : `error: ${code.error}`;
    }
  }
  networks.push(entry);
}

const rows = [];
for (const t of tickets) {
  const fingerprint = ethers.keccak256(ethers.toUtf8Bytes(`${t.id}:${t.eventId}:${t.seatId}:${Number(t.price)}`));
  const states = ticketStates(t);
  const row = {
    ticketId: t.id,
    event: t.event.name,
    seat: `${t.seat.section} ${t.seat.row}${t.seat.seatNumber}`,
    payment: states.payment.label,
    entry: states.entry.label,
    nftRecordedState: states.nft.label,
    mintStatus: t.mintStatus,
    mintSimulated: t.mintSimulated,
    tokenId: t.tokenId,
    tokenIdPattern: t.tokenId == null ? 'none' : t.tokenId >= 1000 ? 'simulation-style (≥1000)' : 'contract-style (<1000)',
    contractAddress: t.contractAddress,
    contractChecksumValid: t.contractAddress ? Boolean(validAddress(t.contractAddress)) : null,
    txHash: t.txHash,
    dbOwner: t.ownerWallet,
    perNetwork: {},
  };
  for (const n of networks) {
    if (!n.reachable) {
      row.perNetwork[n.name] = { checked: false, reason: `unreachable (${n.error || 'wrong chain'})` };
      continue;
    }
    const r = { checked: true, contractHasCode: t.contractAddress ? n.code[t.contractAddress] : null };
    if (t.txHash) {
      const tx = await safe(() => n.provider.getTransaction(t.txHash));
      r.txFound = tx.ok ? Boolean(tx.value) : `error: ${tx.error}`;
    }
    if (r.contractHasCode === true && t.tokenId != null) {
      const c = new ethers.Contract(t.contractAddress.toLowerCase(), ABI, n.provider);
      const owner = await safe(() => c.ownerOf(t.tokenId));
      const data = await safe(() => c.tickets(t.tokenId));
      const seatToken = await safe(() => c.seatToTokenId(`${t.eventId}-${t.chainSeatId || t.seatId}`));
      r.tokenExists = owner.ok;
      r.chainOwner = owner.ok ? owner.value : null;
      r.ownerMatchesDb = owner.ok && t.ownerWallet ? owner.value.toLowerCase() === t.ownerWallet.toLowerCase() : null;
      r.fingerprintMatches = data.ok ? data.value.ticketHash === fingerprint : null;
      r.invalidated = data.ok ? data.value.isInvalidated : null;
      r.seatHoldsToken = seatToken.ok ? Number(seatToken.value) === t.tokenId : null;
    }
    r.verified = Boolean(r.tokenExists && r.fingerprintMatches && r.seatHoldsToken && !r.invalidated);
    row.perNetwork[n.name] = r;
  }
  const checked = Object.values(row.perNetwork).filter((x) => x.checked);
  const verifiedOn = Object.entries(row.perNetwork).filter(([, x]) => x.verified).map(([k]) => k);
  const unchecked = Object.entries(row.perNetwork).filter(([, x]) => !x.checked).map(([k]) => k);
  if (t.tokenId == null) row.verdict = 'NO TOKEN RECORDED';
  else if (verifiedOn.length) row.verdict = `VERIFIED on ${verifiedOn.join(', ')}`;
  else if (checked.length && checked.every((x) => x.contractHasCode !== true && x.txFound !== true)) {
    row.verdict = `NOT FOUND on ${Object.entries(row.perNetwork).filter(([, x]) => x.checked).map(([k]) => k).join(', ')}${unchecked.length ? ` (not checkable: ${unchecked.join(', ')})` : ''}`;
  } else row.verdict = 'INCONSISTENT (see per-network details)';
  rows.push(row);
}
await prisma.$disconnect();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const summary = {};
for (const r of rows) summary[r.verdict] = (summary[r.verdict] || 0) + 1;
const report = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  networks: networks.map(({ provider, ...n }) => n),
  summary,
  tickets: rows,
};
fs.mkdirSync(OUT, { recursive: true });
const jsonPath = path.join(OUT, `onchain-verification-${stamp}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

const md = [
  `# On-chain verification of recorded NFT tickets`,
  ``,
  `Generated ${report.generatedAt}. Read-only: no transactions, no database writes.`,
  ``,
  `## Networks`,
  ``,
  `| Network | Chain | RPC | Reachable | Recorded contracts with code |`,
  `|---|---|---|---|---|`,
  ...report.networks.map((n) => `| ${n.name} | ${n.chainId} | ${n.rpc} | ${n.reachable ? 'yes' : `no (${n.error || 'wrong chain'})`} | ${n.reachable ? Object.entries(n.code).map(([a, v]) => `${a.slice(0, 10)}…: ${v === true ? 'YES' : v === false ? 'no' : v}`).join('<br>') : '—'} |`),
  ``,
  `## Summary`,
  ``,
  ...Object.entries(summary).map(([k, v]) => `- **${v}** × ${k}`),
  ``,
  `## Tickets`,
  ``,
  `| # | Ticket | Event · seat | Payment | Entry | NFT (as recorded) | Token | Pattern | Contract (checksum) | Tx found on any chain | Verdict |`,
  `|---|---|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r, i) => {
    const txAny = Object.values(r.perNetwork).some((x) => x.txFound === true);
    return `| ${i + 1} | \`${r.ticketId.slice(0, 8)}\` | ${r.event} · ${r.seat} | ${r.payment} | ${r.entry} | ${r.nftRecordedState} | ${r.tokenId ?? '—'} | ${r.tokenIdPattern} | \`${r.contractAddress ? `${r.contractAddress.slice(0, 10)}…` : '—'}\` (${r.contractChecksumValid === false ? 'INVALID' : r.contractChecksumValid ? 'valid' : '—'}) | ${txAny ? 'yes' : 'no'} | ${r.verdict} |`;
  }),
];
const mdPath = path.join(OUT, `onchain-verification-${stamp}.md`);
fs.writeFileSync(mdPath, md.join('\n'));
console.log(JSON.stringify({ jsonPath, mdPath, summary, networks: report.networks.map((n) => ({ name: n.name, reachable: n.reachable, code: n.code })) }, null, 2));
