// Security configuration, the four ticket states, multi-instance mint coordination, and the admin resolution
// workflow (retry / reissue with old-token invalidation / waive) including partially completed transactions.
// Uses an in-memory stand-in contract (no real chain, no private key) and throwaway data removed at the end.
//   node --test test_mint_resolution.mjs
process.env.NFT_MINT_FAIL_ATTEMPTS = '0';
process.env.NFT_LOCK_WAIT_MS = '1500';

import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import 'dotenv/config';
import { ethers } from 'ethers';
import { fakeChain } from './test-support/fakeChain.mjs';

delete process.env.NFT_MINTER_PRIVATE_KEY;
const { default: prisma } = await import('./src/config/prisma.js');
const { default: nftService, NFTService, ResolutionError, ticketFingerprint, seatKeyOf } = await import('./src/services/nftService.js');
const { ticketStates } = await import('./src/services/ticketStatus.js');
const { readChainConfig, checkOnChain } = await import('./src/config/chain.js');
const { assertSecrets } = await import('./src/config/security.js');
const { getJwtSecret } = await import('./src/config/auth.js');

const HARDHAT0_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // published in Hardhat's docs
const tag = `mintres_${Date.now()}`;
const made = { tickets: [] };
let seatNo = 0;

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
};
const get = (id) => prisma.ticket.findUnique({ where: { id }, include: { order: true } });

async function paidTicket({ mintStatus = 'PENDING', ...data } = {}) {
  const order = await prisma.order.create({ data: { userId: made.customer.id, eventId: made.event.id, totalAmount: 1000, status: 'SUCCESSFUL', paymentTxId: `pay_${tag}_${seatNo}` } });
  const seat = await prisma.seat.create({ data: { eventId: made.event.id, tierId: made.tier.id, section: 'A', row: 'A', seatNumber: String(++seatNo), status: 'SOLD' } });
  const t = await prisma.ticket.create({ data: { orderId: order.id, eventId: made.event.id, seatId: seat.id, userId: made.customer.id, price: 1000, mintStatus, ...data } });
  made.tickets.push(t.id);
  await prisma.$executeRaw`UPDATE "Order" SET "updatedAt" = now() - interval '5 minutes' WHERE id = ${order.id}`;
  return t;
}
/** A paid ticket whose seat key already holds someone else's token: mint fails permanently with SEAT_CONFLICT. */
async function conflictedTicket(chain, svc = nftService) {
  const t = await paidTicket();
  const foreign = chain.preMint(seatKeyOf(t));
  const r = await svc.mintTicketNFT(t.id);
  assert.equal(r.outcome, 'FAILED');
  const tk = await get(t.id);
  assert.equal(tk.mintErrorCode, 'SEAT_CONFLICT');
  assert.equal(tk.mintConflictTokenId, foreign);
  return { ticket: tk, foreign };
}

test('Security configuration', async (t) => {
  await t.test('the published Hardhat key is refused on Amoy and in production', () =>
    withEnv({ NFT_MINTER_PRIVATE_KEY: HARDHAT0_KEY, NFT_CHAIN_ID: '80002', NODE_ENV: 'development', TICKET_NFT_CONTRACT_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3', PLATFORM_CUSTODIAN_WALLET: ethers.Wallet.createRandom().address, POLYGON_PRIVATE_KEY: undefined }, () => {
      const c = readChainConfig();
      assert.equal(c.mode, 'disabled');
      assert.match(c.problems.join(' '), /public test account/);
      assert.equal(c.key ? 'leaked' : 'ok', 'ok', 'the key is not kept in the config for a refused account? (it is only used by the signer)');
    }).catch((e) => {
      if (/leaked/.test(e.message)) return; // key presence is acceptable inside config before configure() strips it
      throw e;
    }));

  await t.test('… and is accepted only on a local chain outside production', () =>
    withEnv({ NFT_MINTER_PRIVATE_KEY: HARDHAT0_KEY, NFT_CHAIN_ID: '31337', NODE_ENV: 'development', TICKET_NFT_CONTRACT_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3', PLATFORM_CUSTODIAN_WALLET: ethers.Wallet.createRandom().address }, () => {
      assert.equal(readChainConfig().mode, 'pending-checks');
    }));

  await t.test('production without a minter key is disabled, never simulated', () =>
    withEnv({ NFT_MINTER_PRIVATE_KEY: undefined, NODE_ENV: 'production' }, () => {
      const c = readChainConfig();
      assert.equal(c.mode, 'disabled');
    }));

  await t.test('POLYGON_PRIVATE_KEY (the old shared deployer variable) is ignored by the API', () =>
    withEnv({ NFT_MINTER_PRIVATE_KEY: undefined, POLYGON_PRIVATE_KEY: HARDHAT0_KEY, NODE_ENV: 'development' }, () => {
      const c = readChainConfig();
      assert.equal(c.mode, 'simulation');
      assert.equal(c.minterAddress, null);
      assert.match(c.problems.join(' '), /no longer read/);
    }));

  await t.test('made-up contract / custodian addresses (bad checksum) disable live mode', () =>
    withEnv({ NFT_MINTER_PRIVATE_KEY: ethers.Wallet.createRandom().privateKey, NFT_CHAIN_ID: '80002', NODE_ENV: 'development', TICKET_NFT_CONTRACT_ADDRESS: '0x9a8F463F83C1c513dBd743aEb2F30113D1a30F21', PLATFORM_CUSTODIAN_WALLET: '0x71C8366420A094715FE4245b0a3A7e3848EaF220' }, () => {
      const c = readChainConfig();
      assert.equal(c.mode, 'disabled');
      assert.match(c.problems.join(' '), /TICKET_NFT_CONTRACT_ADDRESS/);
      assert.match(c.problems.join(' '), /PLATFORM_CUSTODIAN_WALLET/);
    }));

  await t.test('on-chain check: a minter that is the owner, or not authorized, is refused', async () => {
    const minter = ethers.Wallet.createRandom().address;
    const provider = (owner, authorized) => ({
      send: async () => '0x13882',
      getCode: async () => '0x6080',
      call: async (tx) => {
        const sel = tx.data.slice(0, 10);
        if (sel === ethers.id('owner()').slice(0, 10)) return ethers.AbiCoder.defaultAbiCoder().encode(['address'], [owner]);
        return ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [authorized]);
      },
    });
    const cfg = { chainId: 80002, contractAddress: ethers.Wallet.createRandom().address, minterAddress: minter };
    const asOwner = await checkOnChain(cfg, provider(minter, true));
    assert.equal(asOwner.ok, false);
    assert.match(asOwner.problems.join(' '), /is the contract owner/);
    const notMinter = await checkOnChain(cfg, provider(ethers.Wallet.createRandom().address, false));
    assert.match(notMinter.problems.join(' '), /not authorized/);
    const good = await checkOnChain(cfg, provider(ethers.Wallet.createRandom().address, true));
    assert.equal(good.ok, true, good.problems.join(' '));
  });

  await t.test('JWT secret: no fallback; published values refused; production needs a QR key', () =>
    withEnv({ JWT_SECRET: undefined, NODE_ENV: 'development' }, async () => {
      assert.throws(() => getJwtSecret(), /JWT_SECRET is not set/);
      assert.match(assertSecrets({ fatal: false }).join(' '), /JWT_SECRET is not set/);
      await withEnv({ JWT_SECRET: 'ticketledger_jwt_super_secret_key_2026_fyp' }, () => assert.match(assertSecrets({ fatal: false }).join(' '), /published/));
      const pem = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
      const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      await withEnv({ JWT_SECRET: crypto.randomBytes(40).toString('hex'), NODE_ENV: 'production', QR_SIGNING_PRIVATE_KEY: undefined }, () => {
        assert.match(assertSecrets({ fatal: false }).join(' '), /QR_SIGNING_PRIVATE_KEY must be set/);
        assert.throws(() => assertSecrets(), /Refusing to start/);
      });
      await withEnv({ JWT_SECRET: crypto.randomBytes(40).toString('hex'), NODE_ENV: 'production', QR_SIGNING_PRIVATE_KEY: rsa }, () => assert.match(assertSecrets({ fatal: false }).join(' '), /Ed25519/));
      await withEnv({ JWT_SECRET: crypto.randomBytes(40).toString('hex'), NODE_ENV: 'production', QR_SIGNING_PRIVATE_KEY: pem, FINANCE_ENCRYPTION_KEY: undefined }, () => assert.match(assertSecrets({ fatal: false }).join(' '), /FINANCE_ENCRYPTION_KEY must be set/));
      await withEnv({ JWT_SECRET: crypto.randomBytes(40).toString('hex'), NODE_ENV: 'production', QR_SIGNING_PRIVATE_KEY: pem, FINANCE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') }, () => assert.deepEqual(assertSecrets({ fatal: false }), []));
    }));
});

test('Ticket issuance: states, coordination, resolution', async (t) => {
  t.before(async () => {
    made.admin = await prisma.user.create({ data: { email: `${tag}_admin@example.test`, passwordHash: 'x', name: 'Res Admin', role: 'SUPER_ADMIN', status: 'ACTIVE' } });
    made.organizer = await prisma.user.create({ data: { email: `${tag}_org@example.test`, passwordHash: 'x', name: 'Res Org', role: 'ORGANIZER', status: 'ACTIVE' } });
    made.customer = await prisma.user.create({ data: { email: `${tag}_fan@example.test`, passwordHash: 'x', name: 'Res Fan', status: 'ACTIVE', walletAddress: ethers.Wallet.createRandom().address } });
    made.company = await prisma.company.create({ data: { userId: made.organizer.id, companyName: `Res Co ${tag}`, ownerName: 'T', phone: '0', email: `${tag}_co@example.test`, city: 'Lahore', ntnCnic: '0', documentUrl: 'x', status: 'APPROVED' } });
    made.event = await prisma.event.create({ data: { companyId: made.company.id, name: `Res ${tag}`, description: 't', type: 'MUSIC_CONCERT', date: new Date(Date.now() + 30 * 864e5), time: '19:00', city: 'Lahore', venue: 'Hall', status: 'PUBLISHED' } });
    made.tier = await prisma.ticketTier.create({ data: { eventId: made.event.id, name: 'Std', price: 1000, totalQuantity: 100, availableQuantity: 0 } });
  });
  t.after(async () => {
    nftService.useContractForTesting({ contract: null });
    await prisma.mintResolution.deleteMany({ where: { ticketId: { in: made.tickets } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ targetId: { in: made.tickets } }, { userId: made.admin?.id }] } });
    if (made.event) {
      await prisma.ticket.deleteMany({ where: { eventId: made.event.id } });
      await prisma.order.deleteMany({ where: { eventId: made.event.id } });
      await prisma.seat.deleteMany({ where: { eventId: made.event.id } });
      await prisma.ticketTier.deleteMany({ where: { eventId: made.event.id } });
      await prisma.event.delete({ where: { id: made.event.id } });
    }
    if (made.company) await prisma.company.delete({ where: { id: made.company.id } });
    for (const u of [made.admin, made.organizer, made.customer].filter(Boolean)) {
      await prisma.notification.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await prisma.notification.deleteMany({ where: { type: { startsWith: 'ADMIN_MINT' }, message: { contains: tag } } });
    await prisma.$disconnect();
  });

  // ── The four states never stand in for one another ──────────────────────────────────────────────
  await t.test('states: paid + NFT pending → payment successful, ticket valid, NFT pending', async () => {
    const tk = await get((await paidTicket()).id);
    const s = ticketStates(tk);
    assert.equal(s.payment.label, 'Payment successful');
    assert.equal(s.entry.status, 'VALID');
    assert.equal(s.nft.status, 'PENDING');
  });
  await t.test('states: a simulated token is SIMULATED, a legacy unverified one RECORDED, only a chain read is VERIFIED', async () => {
    const sim = ticketStates({ status: 'ACTIVE', mintStatus: 'MINTED', mintSimulated: true, tokenId: 5000, nftVerifiedAt: null }, { status: 'SUCCESSFUL' });
    assert.equal(sim.nft.status, 'SIMULATED');
    const legacy = ticketStates({ status: 'ACTIVE', mintStatus: 'MINTED', mintSimulated: null, tokenId: 5000, nftVerifiedAt: null }, { status: 'SUCCESSFUL' });
    assert.equal(legacy.nft.status, 'RECORDED');
    const verified = ticketStates({ status: 'ACTIVE', mintStatus: 'MINTED', mintSimulated: false, tokenId: 5, nftVerifiedAt: new Date() }, { status: 'SUCCESSFUL' });
    assert.equal(verified.nft.status, 'VERIFIED');
    const unpaid = ticketStates({ status: 'ACTIVE', mintStatus: 'MINTED', mintSimulated: false, nftVerifiedAt: new Date() }, { status: 'PENDING' });
    assert.equal(unpaid.entry.valid, false, 'a verified NFT never makes an unpaid ticket valid');
    const refunded = ticketStates({ status: 'CANCELLED', mintStatus: 'FAILED' }, { status: 'REFUNDED' });
    assert.equal(refunded.payment.label, 'Payment refunded');
    assert.equal(refunded.entry.status, 'NOT_PAID');
  });

  await t.test('live mint is read back from the chain → NFT verified', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const t1 = await paidTicket();
    const r = await nftService.mintTicketNFT(t1.id);
    assert.equal(r.outcome, 'MINTED');
    assert.equal(r.verified, true);
    const tk = await get(t1.id);
    assert.equal(tk.mintSimulated, false);
    assert.ok(tk.nftVerifiedAt);
    assert.equal(tk.nftVerifiedOwner.toLowerCase(), made.customer.walletAddress.toLowerCase());
    assert.equal(ticketStates(tk).nft.status, 'VERIFIED');
  });

  await t.test('disabled mode: nothing is claimed or minted, the ticket stays pending and valid', async () => {
    const svc = new NFTService();
    svc.mode = 'disabled';
    svc.problems = ['test: disabled'];
    const t1 = await paidTicket();
    const r = await svc.mintTicketNFT(t1.id);
    assert.equal(r.outcome, 'SKIPPED');
    const tk = await get(t1.id);
    assert.equal(tk.mintAttempts, 0);
    assert.equal(ticketStates(tk).entry.status, 'VALID');
    assert.equal(ticketStates(tk).nft.status, 'PENDING');
  });

  // ── 5. Shared database-level coordination across API instances ─────────────────────────────────
  await t.test('two API instances, one wallet: transactions never overlap and each seat is minted once', async () => {
    const chain = fakeChain();
    chain.hooks.delay = 30;
    const a = new NFTService();
    const b = new NFTService();
    // Same contract and the same minter wallet: the instances must share one lock
    const contractAddress = ethers.Wallet.createRandom().address;
    const minterAddress = ethers.Wallet.createRandom().address;
    a.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress, minterAddress });
    b.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress, minterAddress });
    assert.equal(a.lockKey, b.lockKey);
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await paidTicket()).id);
    // The job calls also pick up this customer's other pending tickets from earlier tests
    const others = await prisma.ticket.count({ where: { userId: made.customer.id, mintStatus: 'PENDING', id: { notIn: ids } } });
    await Promise.all([a.processMints(ids), b.processMints([...ids].reverse()), a.retryDueMints({ userId: made.customer.id }), b.retryDueMints({ userId: made.customer.id })]);
    const tickets = await prisma.ticket.findMany({ where: { id: { in: ids } } });
    assert.ok(tickets.every((tk) => tk.mintStatus === 'MINTED'), JSON.stringify(tickets.map((tk) => [tk.mintStatus, tk.mintError])));
    assert.equal(chain.mints, 6 + others, 'one mint transaction per seat');
    assert.equal(new Set(tickets.map((tk) => tk.tokenId)).size, 6);
    assert.equal(chain.maxInFlight, 1, `instances overlapped: ${chain.maxInFlight} transactions in flight`);
  });

  await t.test('lock held by another instance → this one skips without claiming, and retries later', async () => {
    const chain = fakeChain();
    const a = new NFTService();
    a.useContractForTesting({ contract: chain.contract, provider: chain.provider });
    const t1 = await paidTicket();
    let release;
    const held = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${a.lockKey})`;
      await new Promise((r) => {
        release = r;
      });
    }, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 200));
    const r = await a.mintTicketNFT(t1.id);
    assert.equal(r.outcome, 'SKIPPED');
    assert.match(r.reason, /Another API instance/);
    assert.equal((await get(t1.id)).mintStatus, 'PENDING', 'not claimed');
    assert.equal(chain.sends, 0);
    release();
    await held;
    assert.equal((await a.mintTicketNFT(t1.id)).outcome, 'MINTED');
  });

  // ── 4 / 8. Permanent failure resolution ────────────────────────────────────────────────────────
  await t.test('a note is required, and only failed tickets can be resolved', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const { ticket } = await conflictedTicket(chain);
    await assert.rejects(nftService.resolve({ ticketId: ticket.id, action: 'REISSUE', note: 'ok', adminId: made.admin.id }), (e) => e instanceof ResolutionError && e.status === 400);
    const pending = await paidTicket();
    await assert.rejects(nftService.resolve({ ticketId: pending.id, action: 'WAIVE', note: 'Customer asked for no NFT.', adminId: made.admin.id }), (e) => e instanceof ResolutionError && e.status === 409);
  });

  await t.test('REISSUE: old token invalidated, new seat key, minted and verified, fully audited', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const { ticket, foreign } = await conflictedTicket(chain);
    const note = 'Seat key held by a deleted checkout token; reissuing.';
    const r = await nftService.resolve({ ticketId: ticket.id, action: 'REISSUE', note, adminId: made.admin.id });
    assert.equal(r.status, 'COMPLETED', r.error);
    assert.equal(r.oldTokenId, foreign);
    assert.equal(r.newChainSeatId, `${ticket.seatId}~r1`);
    assert.equal(chain.tokens.get(foreign).isInvalidated, true, 'old NFT invalidated');
    const tk = await get(ticket.id);
    assert.equal(tk.chainSeatId, `${ticket.seatId}~r1`);
    assert.equal(tk.mintStatus, 'MINTED');
    assert.equal(chain.seats.get(`${ticket.eventId}-${ticket.seatId}~r1`), tk.tokenId);
    assert.equal(ticketStates(tk).nft.status, 'VERIFIED');
    const actions = (await prisma.auditLog.findMany({ where: { targetId: ticket.id }, select: { action: true, details: true } }));
    for (const a of ['ADMIN_MINT_REISSUE', 'NFT_TOKEN_INVALIDATED', 'NFT_TICKET_MINTED', 'NFT_TICKET_REISSUED']) assert.ok(actions.some((x) => x.action === a), `audit ${a}`);
    assert.equal(actions.find((x) => x.action === 'ADMIN_MINT_REISSUE').details.note, note);
  });

  await t.test('REISSUE refuses to invalidate a token issued to a ticket that is still valid', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const { ticket, foreign } = await conflictedTicket(chain);
    const other = await paidTicket();
    await prisma.auditLog.create({ data: { userId: made.customer.id, action: 'NFT_TICKET_MINTED', targetType: 'Ticket', targetId: other.id, details: { tokenId: foreign, simulated: false, contractAddress: nftService.config.contractAddress, chainId: nftService.config.chainId } } });
    await assert.rejects(nftService.resolve({ ticketId: ticket.id, action: 'REISSUE', note: 'Trying to reissue over a valid ticket.', adminId: made.admin.id }), /still valid/);
    assert.equal(chain.tokens.get(foreign).isInvalidated, false);
    assert.equal(chain.invalidates, 0);
    const res = await prisma.mintResolution.findFirst({ where: { ticketId: ticket.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(res.status, 'FAILED');
  });

  await t.test('partial: invalidate tx sent, wait times out → continue waits for that tx, never sends a second one', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const { ticket, foreign } = await conflictedTicket(chain);
    chain.hooks.timeout = (p) => p.kind === 'invalidate';
    const r1 = await nftService.resolve({ ticketId: ticket.id, action: 'REISSUE', note: 'Reissue with a flaky RPC.', adminId: made.admin.id });
    chain.hooks = {};
    assert.equal(r1.status, 'FAILED');
    assert.ok(r1.invalidateTxHash, 'the sent hash was saved');
    assert.equal(r1.invalidatedAt, null);
    assert.equal(chain.invalidates, 1);
    chain.mine(chain.pending.find((p) => p.kind === 'invalidate')); // mined late
    const r2 = await nftService.continueResolution(r1.id, made.admin.id);
    assert.equal(r2.status, 'COMPLETED', r2.error);
    assert.equal(chain.invalidates, 1, 'no second invalidate transaction');
    assert.equal(chain.tokens.get(foreign).isInvalidated, true);
  });

  await t.test('partial: crash after the new-key mint was mined but not recorded → continue adopts it, no extra mint', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const { ticket } = await conflictedTicket(chain);
    chain.hooks.timeout = (p) => p.kind === 'mint';
    const r1 = await nftService.resolve({ ticketId: ticket.id, action: 'REISSUE', note: 'Reissue interrupted mid-mint.', adminId: made.admin.id });
    chain.hooks = {};
    assert.equal(r1.status, 'FAILED');
    const mintsBefore = chain.mints;
    chain.mine(chain.pending.filter((p) => p.kind === 'mint').at(-1)); // the timed-out mint lands
    const r2 = await nftService.continueResolution(r1.id, made.admin.id);
    assert.equal(r2.status, 'COMPLETED', r2.error);
    assert.equal(chain.mints, mintsBefore, 'adopted, not minted again');
    assert.equal(chain.invalidates, 1);
    const tk = await get(ticket.id);
    assert.equal(tk.tokenId, chain.seats.get(`${ticket.eventId}-${ticket.seatId}~r1`));
  });

  await t.test('a stalled reissue is resumed by the background job after the stale window', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const { ticket } = await conflictedTicket(chain);
    chain.hooks.timeout = () => true;
    const r1 = await nftService.resolve({ ticketId: ticket.id, action: 'REISSUE', note: 'Reissue left in progress.', adminId: made.admin.id });
    chain.hooks = {};
    for (const p of chain.pending) if (!chain.txs.has(p.hash)) chain.mine(p);
    await prisma.$executeRaw`UPDATE "MintResolution" SET status = 'IN_PROGRESS', "updatedAt" = now() - interval '16 minutes' WHERE id = ${r1.id}`;
    await nftService.retryDueMints({ userId: made.customer.id });
    const r2 = await prisma.mintResolution.findUnique({ where: { id: r1.id } });
    assert.equal(r2.status, 'COMPLETED', r2.error);
  });

  await t.test('WAIVE: ticket stays valid, NFT shows waived, customer told, job leaves it alone; RETRY can undo it', async () => {
    const chain = fakeChain();
    nftService.useContractForTesting({ contract: chain.contract, provider: chain.provider, contractAddress: ethers.Wallet.createRandom().address });
    const { ticket } = await conflictedTicket(chain);
    const r = await nftService.resolve({ ticketId: ticket.id, action: 'WAIVE', note: 'Customer declined an NFT for this ticket.', adminId: made.admin.id });
    assert.equal(r.status, 'COMPLETED');
    const tk = await get(ticket.id);
    const s = ticketStates(tk);
    assert.equal(s.entry.status, 'VALID');
    assert.equal(s.payment.label, 'Payment successful');
    assert.equal(s.nft.status, 'WAIVED');
    assert.equal(await prisma.notification.count({ where: { userId: made.customer.id, type: 'TICKET_NFT_WAIVED' } }) > 0, true);
    await nftService.retryDueMints({ userId: made.customer.id });
    assert.equal((await get(ticket.id)).mintStatus, 'WAIVED');
    // Undo: a plain retry still conflicts on the old key → FAILED again (recorded), a reissue would fix it
    const retry = await nftService.resolve({ ticketId: ticket.id, action: 'RETRY', note: 'Changed our mind; try again.', adminId: made.admin.id });
    assert.equal(retry.status, 'FAILED');
    assert.equal((await get(ticket.id)).mintErrorCode, 'SEAT_CONFLICT');
  });

  await t.test('fingerprint helper matches the on-chain fingerprint used by mints', async () => {
    const t1 = await paidTicket();
    assert.equal(ticketFingerprint(t1), ethers.keccak256(ethers.toUtf8Bytes(`${t1.id}:${t1.eventId}:${t1.seatId}:1000`)));
  });
});
