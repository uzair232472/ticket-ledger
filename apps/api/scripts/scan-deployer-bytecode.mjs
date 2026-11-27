// Read-only: lists every contract a wallet created (plain CREATE, by nonce) on a network, and flags any whose
// runtime bytecode matches the compiled TicketLedgerNFT (metadata hash ignored). Uses batched eth_getCode calls.
//   node scripts/scan-deployer-bytecode.mjs <rpcUrl> <deployerAddress> [artifactPath]
import fs from 'node:fs';
import { ethers } from 'ethers';

const [rpc, from, artifactPath = '../../../contracts/artifacts/contracts/TicketLedgerNFT.sol/TicketLedgerNFT.json'] = process.argv.slice(2);
const art = JSON.parse(fs.readFileSync(new URL(artifactPath, import.meta.url)));
// Solidity appends CBOR metadata; its length is the last 2 bytes. Compare code without it.
const strip = (hex) => {
  const h = hex.toLowerCase().replace(/^0x/, '');
  if (h.length < 4) return h;
  const len = parseInt(h.slice(-4), 16);
  return h.length > (len + 2) * 2 ? h.slice(0, h.length - (len + 2) * 2) : h;
};
const target = strip(art.deployedBytecode);
const post = async (body) => {
  for (let tryNo = 0; tryNo < 5; tryNo++) {
    try {
      const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (r.status === 429) throw new Error('rate limited');
      return await r.json();
    } catch (e) {
      await new Promise((res) => setTimeout(res, 1500 * (tryNo + 1)));
      if (tryNo === 4) throw e;
    }
  }
};
const nonce = parseInt((await post({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [from, 'latest'] })).result, 16);
const created = [];
const matches = [];
let errors = 0;
for (let start = 0; start < nonce; start += 50) {
  const batch = [];
  for (let n = start; n < Math.min(nonce, start + 50); n++) batch.push({ jsonrpc: '2.0', id: n, method: 'eth_getCode', params: [ethers.getCreateAddress({ from, nonce: n }), 'latest'] });
  const res = await post(batch);
  for (const r of Array.isArray(res) ? res : []) {
    if (r.error) { errors++; continue; }
    if (r.result && r.result !== '0x') {
      const address = ethers.getCreateAddress({ from, nonce: r.id });
      created.push(address);
      if (strip(r.result) === target) matches.push({ nonce: r.id, address });
    }
  }
  if (!Array.isArray(res)) errors += batch.length;
}
console.log(JSON.stringify({ rpc: new URL(rpc).host, from, nonce, contractsCreated: created.length, ticketLedgerNFTMatches: matches, rpcErrors: errors }));
