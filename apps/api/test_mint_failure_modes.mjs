// Failure modes of NFT issuance (services/nftService.js) against an in-memory stand-in for TicketLedgerNFT
// that behaves like the contract: one token per `${eventId}-${seatId}`, a second mint of a seat reverts.
// No real chain or private key is used. Builds throwaway data and removes it at the end.
//   node --test test_mint_failure_modes.mjs
process.env.POLYGON_PRIVATE_KEY = '';
process.env.NFT_MINT_FAIL_ATTEMPTS = '0';

import assert from 'node:assert/strict';
import test from 'node:test';
import 'dotenv/config';

const { default: prisma } = await import('./src/config/prisma.js');
const { default: nftService } = await import('./src/services/nftService.js');

import { fakeChain } from './test-support/fakeChain.mjs';

const tag = `mintfm_${Date.now()}`;
const made = { seats: [], tickets: [] };
let seatNo = 0;

/** A paid order of `n` tickets, paid long enough ago for the background job to take it. */
async function paidOrder(n) {
  const order = await prisma.order.create({ data: { userId: made.customer.id, eventId: made.event.id, totalAmount: 1000 * n, status: 'SUCCESSFUL', paymentTxId: `pay_${tag}_${seatNo}` } });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const seat = await prisma.seat.create({ data: { eventId: made.event.id, tierId: made.tier.id, section: 'A', row: 'A', seatNumber: String(++seatNo), status: 'SOLD' } });
    const t = await prisma.ticket.create({ data: { orderId: order.id, eventId: made.event.id, seatId: seat.id, userId: made.customer.id, price: 1000 } });
    ids.push(t.id);
    made.tickets.push(t.id);
  }
  await prisma.$executeRaw`UPDATE "Order" SET "updatedAt" = now() - interval '5 minutes' WHERE id = ${order.id}`;
  return { order, ids };
}

const useChain = () => {
  const chain = fakeChain();
  nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider });
  return chain;
};
const get = (id) => prisma.ticket.findUnique({ where: { id } });

/** Makes prisma.ticket.update throw while `when(args)` is true; returns a restore function. */
function failTicketUpdates(when) {
  const original = prisma.ticket.update;
  prisma.ticket.update = async (args) => {
    if (when(args)) throw new Error('simulated database outage');
    return original.call(prisma.ticket, args);
  };
  return () => {
    prisma.ticket.update = original;
  };
}

test('NFT issuance failure modes', async (t) => {
  t.before(async () => {
    made.organizer = await prisma.user.create({ data: { email: `${tag}_org@example.test`, passwordHash: 'x', name: 'FM Organizer', role: 'ORGANIZER', status: 'ACTIVE' } });
    made.customer = await prisma.user.create({ data: { email: `${tag}_fan@example.test`, passwordHash: 'x', name: 'FM Fan', status: 'ACTIVE', walletAddress: (await import('ethers')).ethers.Wallet.createRandom().address } });
    made.company = await prisma.company.create({ data: { userId: made.organizer.id, companyName: `FM Co ${tag}`, ownerName: 'T', phone: '0', email: `${tag}_co@example.test`, city: 'Lahore', ntnCnic: '0', documentUrl: 'x', status: 'APPROVED' } });
    made.event = await prisma.event.create({ data: { companyId: made.company.id, name: `FM ${tag}`, description: 't', type: 'MUSIC_CONCERT', date: new Date(Date.now() + 30 * 864e5), time: '19:00', city: 'Lahore', venue: 'Hall', status: 'PUBLISHED' } });
    made.tier = await prisma.ticketTier.create({ data: { eventId: made.event.id, name: 'Std', price: 1000, totalQuantity: 100, availableQuantity: 0 } });
  });
  t.after(async () => {
    nftService.useContractForTesting({ contract: null });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: made.tickets } } });
    await prisma.mintResolution.deleteMany({ where: { ticketId: { in: made.tickets } } });
    if (made.event) {
      await prisma.ticket.deleteMany({ where: { eventId: made.event.id } });
      await prisma.order.deleteMany({ where: { eventId: made.event.id } });
      await prisma.seat.deleteMany({ where: { eventId: made.event.id } });
      await prisma.ticketTier.deleteMany({ where: { eventId: made.event.id } });
      await prisma.event.delete({ where: { id: made.event.id } });
    }
    if (made.company) await prisma.company.delete({ where: { id: made.company.id } });
    for (const u of [made.organizer, made.customer].filter(Boolean)) {
      await prisma.notification.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await prisma.notification.deleteMany({ where: { type: 'ADMIN_MINT_FAILED', message: { contains: tag } } });
    await prisma.$disconnect();
  });

  // ── 2. Transaction succeeds, database update fails ──────────────────────────────────────────────
  await t.test('2a: mined but the MINTED write fails → next attempt adopts the token, no second mint', async () => {
    const chain = useChain();
    const { ids: [id] } = await paidOrder(1);
    const restore = failTicketUpdates((a) => a.data?.mintStatus === 'MINTED');
    const first = await nftService.mintTicketNFT(id);
    restore();
    assert.equal(first.outcome, 'RETRY');
    assert.equal(chain.sends, 1);
    const mid = await get(id);
    assert.equal(mid.mintStatus, 'PENDING');
    assert.equal(mid.txHash, '0x' + '1'.padStart(64, '0'), 'the sent tx hash was kept');

    const second = await nftService.mintTicketNFT(id);
    assert.equal(second.outcome, 'MINTED');
    assert.equal(chain.sends, 1, 'no second transaction');
    const done = await get(id);
    assert.equal(done.tokenId, 1);
    assert.equal(done.txHash, '0x' + '1'.padStart(64, '0'));
    assert.equal(done.mintStatus, 'MINTED');
  });

  await t.test('2b: mined, then the database is down for every write → claim left MINTING, recovered after restart', async () => {
    const chain = useChain();
    const { ids: [id] } = await paidOrder(1);
    let sent = false;
    chain.hooks.beforeMine = async () => {
      sent = true;
    };
    const restore = failTicketUpdates(() => sent);
    await assert.rejects(nftService.mintTicketNFT(id), /simulated database outage/);
    restore();
    chain.hooks = {};
    assert.equal(chain.sends, 1);
    assert.equal((await get(id)).mintStatus, 'MINTING', 'the claim is all the database knows');

    // "Restart": the claim is older than the 15-minute stale window
    await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = now() - interval '16 minutes' WHERE id = ${id}`;
    await nftService.retryDueMints({ userId: made.customer.id });
    const done = await get(id);
    assert.equal(done.mintStatus, 'MINTED');
    assert.equal(chain.sends, 1, 'adopted, not minted twice');
    assert.equal(done.ownerWallet?.toLowerCase(), made.customer.walletAddress.toLowerCase());
  });

  await t.test('2c: the audit-log write fails after MINTED was saved → status must stay MINTED', async () => {
    useChain();
    const { ids: [id] } = await paidOrder(1);
    const original = prisma.auditLog.create;
    prisma.auditLog.create = async () => {
      throw new Error('simulated audit outage');
    };
    const r = await nftService.mintTicketNFT(id).finally(() => {
      prisma.auditLog.create = original;
    });
    const tk = await get(id);
    assert.equal(tk.mintStatus, 'MINTED', `audit failure must not undo the mint (outcome ${r.outcome}, error ${tk.mintError})`);
    assert.equal(r.outcome, 'MINTED');
  });

  await t.test('2d: wait times out, the tx is mined before the retry → adopted with the original hash', async () => {
    const chain = useChain();
    const { ids: [id] } = await paidOrder(1);
    let held;
    chain.hooks.timeout = (p) => {
      held = p;
      return true;
    };
    const first = await nftService.mintTicketNFT(id);
    chain.hooks = {};
    assert.equal(first.outcome, 'RETRY');
    chain.mine(held); // mined late
    const second = await nftService.mintTicketNFT(id);
    assert.equal(second.outcome, 'MINTED');
    assert.equal(chain.sends, 1);
    assert.equal((await get(id)).txHash, held.hash);
  });

  await t.test('2e: wallet changed between attempts → the recorded owner is the real on-chain owner', async () => {
    const chain = useChain();
    const { ids: [id] } = await paidOrder(1);
    chain.hooks.timeout = () => true;
    await nftService.mintTicketNFT(id);
    chain.hooks = {};
    const [pending] = [...chain.txs.keys()].length ? [] : [null];
    void pending;
    // the timed-out tx mines to the old wallet
    const tk0 = await get(id);
    chain.mine({ hash: tk0.txHash, recipient: made.customer.walletAddress, ticketHash: (await import('ethers')).ethers.keccak256((await import('ethers')).ethers.toUtf8Bytes(`${id}:${tk0.eventId}:${tk0.seatId}:1000`)), seatKey: `${tk0.eventId}-${tk0.seatId}` });
    await prisma.user.update({ where: { id: made.customer.id }, data: { walletAddress: (await import('ethers')).ethers.Wallet.createRandom().address } });
    await nftService.mintTicketNFT(id);
    await prisma.user.update({ where: { id: made.customer.id }, data: { walletAddress: made.customer.walletAddress } });
    const tk = await get(id);
    assert.equal(tk.ownerWallet.toLowerCase(), made.customer.walletAddress.toLowerCase(), 'owner must come from the chain, not the current profile');
  });

  // ── 3. Worker crash during minting, recovery after restart ──────────────────────────────────────
  await t.test('3a: crash after claiming, before sending → a fresh claim is left alone, a stale one is minted once', async () => {
    const chain = useChain();
    const { ids: [id] } = await paidOrder(1);
    await prisma.ticket.update({ where: { id }, data: { mintStatus: 'MINTING', mintAttempts: 1 } }); // the crashed worker's claim
    await nftService.retryDueMints({ userId: made.customer.id });
    assert.equal((await get(id)).mintStatus, 'MINTING', 'a claim younger than 15 min may still be in flight');
    assert.equal(chain.sends, 0);

    await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = now() - interval '16 minutes' WHERE id = ${id}`;
    await nftService.retryDueMints({ userId: made.customer.id });
    const tk = await get(id);
    assert.equal(tk.mintStatus, 'MINTED');
    assert.equal(chain.sends, 1);
    assert.equal(tk.mintAttempts, 2);
  });

  await t.test('3b: crash after the tx was mined, before anything was recorded → adopted after restart', async () => {
    const chain = useChain();
    const { ids: [id] } = await paidOrder(1);
    // The worker claimed, sent and the tx mined; then the process died before even saving the hash
    const restore = failTicketUpdates((a) => Boolean(a.data?.txHash) || a.data?.mintStatus);
    await nftService.mintTicketNFT(id).catch(() => {});
    restore();
    assert.equal(chain.sends, 1);
    chain.mine(chain.lastPending); // the broadcast transaction is mined although the worker died
    await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = now() - interval '16 minutes' WHERE id = ${id}`;
    await nftService.retryDueMints({ userId: made.customer.id });
    const tk = await get(id);
    assert.equal(tk.mintStatus, 'MINTED');
    assert.equal(tk.tokenId, [...chain.seats.values()].at(-1));
    assert.equal(chain.sends, 1);
  });

  // ── 4. Manual retry, booking confirmation and background retry at the same time ────────────────
  await t.test('4: confirm + admin retry + customer retry + job together → each seat minted once, sends serialized', async () => {
    const chain = useChain();
    chain.hooks.delay = 40;
    const { order, ids } = await paidOrder(5);
    const results = await Promise.all([
      nftService.batchMintOrderTickets(order.id), // the confirm request
      nftService.processMints(ids, { force: true }), // admin "Retry all"
      nftService.batchMintOrderTickets(order.id, { dueOnly: true }), // customer's manual retry
      nftService.retryDueMints({ userId: made.customer.id }), // background job
    ]);
    void results;
    const tickets = await prisma.ticket.findMany({ where: { id: { in: ids } } });
    assert.ok(tickets.every((tk) => tk.mintStatus === 'MINTED'), JSON.stringify(tickets.map((tk) => [tk.mintStatus, tk.mintError])));
    assert.equal(new Set(tickets.map((tk) => tk.tokenId)).size, 5, 'distinct tokens');
    assert.equal(chain.sends, 5, 'exactly one transaction per seat');
    assert.ok(tickets.every((tk) => tk.mintAttempts === 1), 'no wasted attempts');
    assert.equal(chain.maxInFlight, 1, `one signer must not have parallel transactions in flight (nonce races); saw ${chain.maxInFlight}`);
  });
});
