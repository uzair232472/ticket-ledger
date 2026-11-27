import { ethers } from 'ethers';
import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { readChainConfig, checkOnChain } from '../config/chain.js';
import { notifyAdmins } from './notificationService.js';
import { nftState } from './ticketStatus.js';

/*
 * NFT ticket issuance with recovery, verification and an admin resolution workflow.
 *
 * Payment and entry come first: once an order is paid its tickets are valid at the gate (the signed QR pass does
 * not depend on the chain). Minting is a separate step tracked on each ticket (Ticket.mintStatus):
 *
 *   PENDING ──claim──▶ MINTING ──ok──▶ MINTED ──read back from chain──▶ verified (nftVerifiedAt)
 *      ▲                  │
 *      └──retry later─────┤ failed (attempt < MAX_MINT_ATTEMPTS, backoff 1 min … 2 h)
 *                         └──────────▶ FAILED ──admin: RETRY / REISSUE / WAIVE (note required)
 *
 * Coordination: a live mint (or reissue step) runs inside an in-process queue AND a Postgres advisory lock keyed
 * on the minter wallet, so several API instances never send transactions from one wallet at once. The ticket is
 * claimed only while the lock is held, so a claim never outlives its attempt (STALE_CLAIM_MS > LOCK_TX_TIMEOUT_MS).
 *
 * Partial transactions: every transaction hash is saved before waiting, and every step starts by asking the chain
 * whether it already happened (seat already minted with this ticket's fingerprint → adopt; old token already
 * invalidated → skip), so a crash or timeout part-way is resumed without sending anything twice.
 *
 * Modes (config/chain.js): live, simulation (development without a key: tokens marked simulated, never
 * verified), disabled (bad config, or production without a key: nothing is minted, tickets stay "NFT pending").
 */

export const MAX_MINT_ATTEMPTS = 8;
export const ALERT_AFTER_ATTEMPTS = 3;
// Wait before the next try, by the number of attempts made so far (1 min, 2, 5, 15, 30 min, 1 h, 2 h)
const BACKOFF_MINUTES = [1, 2, 5, 15, 30, 60, 120];
const RPC_TIMEOUT_MS = 30 * 1000;
const TX_WAIT_TIMEOUT_MS = 120 * 1000;
// The advisory-lock transaction bounds one locked unit of work (a mint: ≤ ~4 min; a reissue: ≤ ~8 min)
const lockWaitMs = () => Number(process.env.NFT_LOCK_WAIT_MS) || 60 * 1000;
const LOCK_TX_TIMEOUT_MS = 12 * 60 * 1000;
const STALE_CLAIM_MS = 15 * 60 * 1000;
export const MIN_NOTE_LENGTH = 10;

// Tickets that should carry an NFT: paid, and not cancelled or refunded
export const MINTABLE = {
  status: { not: 'CANCELLED' },
  order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] } },
};

const TICKET_NFT_ABI = [
  'function mintTicket(address recipient, string tokenURI, string eventId, string tierId, string seatId, uint256 originalPrice, bytes32 ticketHash) returns (uint256)',
  'function invalidateTicket(uint256 tokenId, string reason)',
  'function seatToTokenId(string seatKey) view returns (uint256)',
  'function tickets(uint256 tokenId) view returns (uint256 tokenId, string eventId, string tierId, string seatId, uint256 originalPrice, uint256 resalePriceCap, bytes32 ticketHash, bool isInvalidated, uint256 mintedAt)',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

/** A mint failure. `permanent` ones go straight to FAILED; `code` says why (SEAT_CONFLICT, …). */
export class MintError extends Error {
  constructor(message, { permanent = false, code = null, conflictTokenId = null } = {}) {
    super(message);
    this.permanent = permanent;
    this.code = code;
    this.conflictTokenId = conflictTokenId;
  }
}
export class ResolutionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const withTimeout = (promise, label, ms = RPC_TIMEOUT_MS) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new MintError(`Polygon RPC: ${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
const isLockBusy = (e) => /lock timeout|55P03|lock_not_available|canceling statement due to lock timeout/i.test(`${e?.code || ''} ${e?.message || ''} ${e?.meta?.code || ''}`);

/** The fingerprint stored on-chain with a ticket's token. */
export const ticketFingerprint = (ticket) => ethers.keccak256(ethers.toUtf8Bytes(`${ticket.id}:${ticket.eventId}:${ticket.seatId}:${Number(ticket.price)}`));
/** The contract's seat key for this ticket's current issuance. */
export const seatKeyOf = (ticket) => `${ticket.eventId}-${ticket.chainSeatId || ticket.seatId}`;

/** Backwards-compatible view used by older callers: the NFT state plus isMinted. */
export function mintView(ticket) {
  const nft = nftState(ticket);
  return { ...nft, isMinted: ['RECORDED', 'VERIFIED', 'SIMULATED'].includes(nft.status) };
}

export class NFTService {
  constructor() {
    this.mode = 'uninitialized';
    this.config = null;
    this.problems = [];
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.lockKey = null;
    this.configuring = null;
    // Live work runs one at a time in this process; the advisory lock does the same across processes
    this.queue = Promise.resolve();
  }

  /** Reads the configuration and, for live mode, checks the chain (read-only). Safe to call again. */
  async configure({ check = true } = {}) {
    const config = readChainConfig();
    this.problems = [...config.problems];
    this.provider = this.signer = this.contract = null;
    if (config.mode === 'pending-checks') {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: ethers.Network.from(config.chainId) });
      const result = check ? await checkOnChain({ ...config }, provider) : { ok: true, problems: [] };
      this.problems.push(...result.problems);
      if (result.ok) {
        this.provider = provider;
        this.signer = new ethers.Wallet(config.key, provider);
        this.contract = new ethers.Contract(config.contractAddress, TICKET_NFT_ABI, this.signer);
        this.mode = 'live';
      } else {
        this.mode = 'disabled';
      }
    } else {
      this.mode = config.mode;
    }
    const { key, ...rest } = config; // the key lives only inside the signer
    void key;
    this.config = rest;
    this.lockKey = BigInt.asIntN(64, BigInt(`0x${crypto.createHash('sha256').update(`ticketledger-mint:${rest.chainId}:${(rest.minterAddress || 'sim').toLowerCase()}`).digest('hex').slice(0, 16)}`));
    const line = `[NFT] minting mode: ${this.mode}${this.mode === 'live' ? ` (chain ${rest.chainId}, contract ${rest.contractAddress}, minter ${rest.minterAddress})` : ''}`;
    if (this.problems.length) console.warn(`${line}\n${this.problems.map((p) => `  - ${p}`).join('\n')}`);
    else console.log(line);
    return this.status();
  }

  /** Configures once on first use (scripts, tests); the server configures explicitly at start. */
  ready() {
    if (this.mode !== 'uninitialized') return Promise.resolve();
    this.configuring ||= this.configure().catch((e) => {
      this.mode = 'disabled';
      this.problems.push(`Configuration failed: ${e.message}`);
    });
    return this.configuring;
  }

  status() {
    return {
      mode: this.mode,
      chainId: this.config?.chainId ?? null,
      contractAddress: this.config?.contractAddress ?? null,
      minterAddress: this.config?.minterAddress ?? null,
      custodian: this.config?.custodian ?? null,
      problems: this.problems,
    };
  }

  get isLive() {
    return this.mode === 'live' && Boolean(this.contract && this.signer);
  }

  /** Tests: run live against a stand-in contract. */
  useContractForTesting({ contract, provider = null, chainId = 31337, contractAddress = '0x000000000000000000000000000000000000dEaD', minterAddress = ethers.Wallet.createRandom().address, custodian = '0x0000000000000000000000000000000000000002' }) {
    // A random minter by default: separate wallets have separate locks, so parallel test files don't contend
    this.contract = contract;
    this.signer = { testing: true, provider };
    this.mode = contract ? 'live' : 'simulation';
    this.config = { chainId, contractAddress, minterAddress, custodian, mode: this.mode };
    this.lockKey = BigInt.asIntN(64, BigInt(`0x${crypto.createHash('sha256').update(`ticketledger-mint:${chainId}:${minterAddress.toLowerCase()}`).digest('hex').slice(0, 16)}`));
    this.problems = [];
  }

  serialize(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Runs fn holding the cluster-wide advisory lock for this minter wallet (live mode). */
  async underLock(fn) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${Math.floor(lockWaitMs())}ms'`);
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${this.lockKey})`;
        return fn();
      },
      { maxWait: 30 * 1000, timeout: LOCK_TX_TIMEOUT_MS },
    );
  }

  /** Live work: in-process queue + advisory lock. Elsewhere: run directly. */
  coordinated(fn, busyResult) {
    if (!this.isLive) return fn();
    return this.serialize(() =>
      this.underLock(fn).catch((e) => {
        if (isLockBusy(e)) return busyResult;
        throw e;
      }),
    );
  }

  async audit(data) {
    try {
      await prisma.auditLog.create({ data });
    } catch (e) {
      console.error(`[NFT] audit log ${data.action} for ${data.targetId} not written:`, e.message);
    }
  }

  generateMetadata({ ticket, event, seat, tier, resaleCap }) {
    return {
      name: `${event.name} — Pass #${ticket.id.substring(0, 6)}`,
      description: `Official ERC721 NFT Admission Ticket for ${event.name} held at ${event.venue}, ${event.city}.`,
      image: event.bannerUrl || 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80',
      external_url: `https://ticketledger.pk/tickets/${ticket.id}`,
      attributes: [
        { trait_type: 'Event', value: event.name },
        { trait_type: 'City', value: event.city },
        { trait_type: 'Venue', value: event.venue },
        { trait_type: 'Date', value: new Date(event.date).toISOString().split('T')[0] },
        { trait_type: 'Section', value: seat.section },
        { trait_type: 'Row', value: seat.row },
        { trait_type: 'Seat Number', value: seat.seatNumber },
        { trait_type: 'Tier', value: tier.name },
        { trait_type: 'Original Price (PKR)', value: Number(ticket.price) },
        { trait_type: 'Anti-Scalping Resale Cap (PKR)', value: resaleCap },
      ],
    };
  }

  /** The token holding this seat key, or null. Throws SEAT_CONFLICT if it carries another ticket's fingerprint. */
  async findExistingToken(seatKey, fingerprint) {
    const tokenId = Number(await withTimeout(this.contract.seatToTokenId(seatKey), 'seatToTokenId'));
    if (!tokenId) return null;
    const onChain = await withTimeout(this.contract.tickets(tokenId), 'tickets');
    if (onChain.ticketHash !== fingerprint) {
      throw new MintError(`Seat key ${seatKey} is already minted on-chain as token #${tokenId} for a different ticket.`, { permanent: true, code: 'SEAT_CONFLICT', conflictTokenId: tokenId });
    }
    return tokenId;
  }

  /** Mints one claimed ticket. Returns { tokenId, txHash, ownerWallet, resaleCap, tokenURI, adopted, simulated }. */
  async mintOnChainOrSimulate(ticket) {
    const { event, seat, user } = ticket;
    const tier = seat.tier;
    const originalPrice = Number(ticket.price);
    const resaleCap = Math.floor((originalPrice * 110) / 100);
    const fingerprint = ticketFingerprint(ticket);
    const chainSeatId = ticket.chainSeatId || seat.id;
    const seatKey = seatKeyOf(ticket);
    const metadata = this.generateMetadata({ ticket, event, seat, tier, resaleCap });
    const tokenURI = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;

    // Test / demo switch: fail the first N attempts of every ticket
    const failFirst = Number(process.env.NFT_MINT_FAIL_ATTEMPTS || 0);
    if (failFirst > 0 && ticket.mintAttempts <= failFirst) {
      throw new MintError(`Simulated minting failure (attempt ${ticket.mintAttempts} of ${failFirst} set by NFT_MINT_FAIL_ATTEMPTS).`);
    }

    if (!this.isLive) {
      return {
        tokenId: Number(BigInt(fingerprint) % 1000000n) + 1000,
        txHash: `0x${crypto.randomBytes(32).toString('hex')}`,
        ownerWallet: user.walletAddress || null,
        resaleCap,
        tokenURI,
        adopted: false,
        simulated: true,
      };
    }

    // Recipient: the customer's wallet, or the platform custodian (configured, never a made-up default)
    let recipient = ethers.getAddress(this.config.custodian);
    if (user.walletAddress) {
      try {
        recipient = ethers.getAddress(user.walletAddress.toLowerCase());
      } catch {
        // an invalid profile wallet falls back to the custodian
      }
    }
    // A token an earlier attempt minted: its owner is whoever the chain says
    const adopt = async (tokenId) => ({
      tokenId,
      txHash: ticket.txHash || null,
      ownerWallet: await withTimeout(this.contract.ownerOf(tokenId), 'ownerOf'),
      resaleCap,
      tokenURI,
      adopted: true,
      simulated: false,
    });

    try {
      const existing = await this.findExistingToken(seatKey, fingerprint);
      if (existing) return adopt(existing);

      const tx = await withTimeout(this.contract.mintTicket(recipient, tokenURI, event.id, tier.id, chainSeatId, originalPrice, fingerprint), 'mintTicket');
      // Keep the hash at once: if the wait below times out, the next attempt adopts the token with it
      await prisma.ticket.update({ where: { id: ticket.id }, data: { txHash: tx.hash } });
      const receipt = await tx.wait(1, TX_WAIT_TIMEOUT_MS);
      if (!receipt || receipt.status !== 1) throw new MintError('The mint transaction was reverted on-chain.');
      const transfer = receipt.logs.find((log) => log.topics[0] === ethers.id('Transfer(address,address,uint256)'));
      const tokenId = transfer ? Number(BigInt(transfer.topics[3])) : Number(await withTimeout(this.contract.seatToTokenId(seatKey), 'seatToTokenId'));
      if (!tokenId) throw new MintError('The mint transaction did not return a token ID.');
      return { tokenId, txHash: receipt.hash, ownerWallet: recipient, resaleCap, tokenURI, adopted: false, simulated: false };
    } catch (error) {
      if (error instanceof MintError) throw error;
      const reason = error.shortMessage || error.reason || error.message;
      if (/Seat already minted/i.test(reason)) {
        // An earlier transaction that timed out here may have been mined meanwhile: adopt it if it is ours
        const existing = await this.findExistingToken(seatKey, fingerprint);
        if (existing) return adopt(existing);
      }
      throw new MintError(`Polygon RPC: ${reason}`);
    }
  }

  /**
   * Reads a minted ticket back from the chain: the token exists, carries this ticket's fingerprint, holds the
   * ticket's seat key and is not invalidated. Records "NFT verified" only when every check passes.
   */
  async verifyTicket(ticketId, { record = true } = {}) {
    await this.ready();
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) return { ok: false, problems: ['Ticket not found'] };
    if (!this.isLive) return { ok: false, problems: [`Cannot verify in ${this.mode} mode`] };
    if (ticket.tokenId == null) return { ok: false, problems: ['No token recorded'] };
    const problems = [];
    let owner = null;
    try {
      owner = await withTimeout(this.contract.ownerOf(ticket.tokenId), 'ownerOf');
      const onChain = await withTimeout(this.contract.tickets(ticket.tokenId), 'tickets');
      if (onChain.ticketHash !== ticketFingerprint(ticket)) problems.push('Fingerprint on-chain does not match this ticket');
      if (onChain.isInvalidated) problems.push('Token is invalidated on-chain');
      const seatToken = Number(await withTimeout(this.contract.seatToTokenId(seatKeyOf(ticket)), 'seatToTokenId'));
      if (seatToken !== ticket.tokenId) problems.push(`Seat key holds token #${seatToken || 'none'}, not #${ticket.tokenId}`);
    } catch (e) {
      problems.push(e.shortMessage || e.message);
    }
    const ok = problems.length === 0;
    if (ok && record) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { nftVerifiedAt: new Date(), nftVerifiedOwner: owner, nftVerifiedChainId: this.config.chainId, nftVerifiedContract: this.config.contractAddress },
      });
    }
    return { ok, owner, problems };
  }

  /** Mints one ticket's NFT if it is due (coordinated). Never throws for a mint failure. */
  async mintTicketNFT(ticketId, options = {}) {
    await this.ready();
    return this.coordinated(() => this.mintOne(ticketId, options), { ticketId, outcome: 'SKIPPED', reason: 'Another API instance is minting; it will be retried' });
  }

  /** The unit of work. Live callers must hold the lock (mintTicketNFT / runReissue do). */
  async mintOne(ticketId, { force = false, dueOnly = false } = {}) {
    if (this.mode === 'disabled') return { ticketId, outcome: 'SKIPPED', reason: `Minting is disabled: ${this.problems[0] || 'configuration'}` };
    const now = new Date();
    const claimable = force ? ['PENDING', 'FAILED'] : ['PENDING'];
    const claimed = await prisma.ticket.updateMany({
      where: {
        id: ticketId,
        ...MINTABLE,
        mintStatus: { in: claimable },
        ...(dueOnly ? { OR: [{ mintNextAttemptAt: null }, { mintNextAttemptAt: { lte: now } }] } : {}),
      },
      data: force
        ? { mintStatus: 'MINTING', mintAttempts: 1, mintError: null, mintErrorCode: null, mintConflictTokenId: null, mintNextAttemptAt: null }
        : { mintStatus: 'MINTING', mintAttempts: { increment: 1 }, mintNextAttemptAt: null },
    });

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { event: true, user: true, seat: { include: { tier: true } } } });
    if (!ticket) return { ticketId, outcome: 'SKIPPED', reason: 'Ticket not found' };
    const base = { ticketId, orderId: ticket.orderId, userId: ticket.userId, eventId: ticket.eventId, eventName: ticket.event?.name };

    if (!claimed.count) {
      if (ticket.mintStatus === 'MINTED') return { ...base, outcome: 'ALREADY_MINTED', tokenId: ticket.tokenId, txHash: ticket.txHash };
      return { ...base, outcome: 'SKIPPED', reason: ticket.mintStatus === 'MINTING' ? 'Already being minted' : 'Not due or not mintable', mintStatus: ticket.mintStatus };
    }

    let minted;
    try {
      minted = await this.mintOnChainOrSimulate(ticket);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          tokenId: minted.tokenId,
          txHash: minted.txHash,
          contractAddress: minted.simulated ? null : this.config.contractAddress,
          ownerWallet: minted.ownerWallet,
          mintStatus: 'MINTED',
          mintSimulated: minted.simulated,
          mintError: null,
          mintErrorCode: null,
          mintConflictTokenId: null,
          mintNextAttemptAt: null,
          mintedAt: new Date(),
        },
      });
    } catch (error) {
      return this.recordFailure(ticket, base, error);
    }

    await this.audit({
      userId: ticket.userId,
      action: 'NFT_TICKET_MINTED',
      targetType: 'Ticket',
      targetId: ticket.id,
      details: {
        tokenId: minted.tokenId,
        txHash: minted.txHash,
        chainId: minted.simulated ? null : this.config.chainId,
        contractAddress: minted.simulated ? null : this.config.contractAddress,
        seatKey: seatKeyOf(ticket),
        ownerWallet: minted.ownerWallet,
        attempts: ticket.mintAttempts,
        adoptedExistingToken: minted.adopted,
        simulated: minted.simulated,
      },
    });

    // Read it back: only a chain read earns "NFT verified" (a failed read leaves it "recorded, not verified")
    let verified = false;
    if (!minted.simulated) verified = (await this.verifyTicket(ticket.id).catch(() => ({ ok: false }))).ok;

    return {
      ...base,
      outcome: 'MINTED',
      attempts: ticket.mintAttempts,
      tokenId: minted.tokenId,
      txHash: minted.txHash,
      ownerWallet: minted.ownerWallet,
      simulated: minted.simulated,
      verified,
    };
  }

  /** A failed attempt: retry later with backoff, or give up. A database outage here propagates (the claim stays
   *  MINTING and is released after STALE_CLAIM_MS). */
  async recordFailure(ticket, base, error) {
    const message = (error.message || 'Minting failed.').slice(0, 500);
    const gaveUp = error.permanent || ticket.mintAttempts >= MAX_MINT_ATTEMPTS;
    const code = error.code || (gaveUp ? 'RETRIES_EXHAUSTED' : null);
    const waitMin = BACKOFF_MINUTES[Math.min(ticket.mintAttempts, BACKOFF_MINUTES.length) - 1];
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: gaveUp
        ? { mintStatus: 'FAILED', mintError: message, mintErrorCode: code, mintConflictTokenId: error.conflictTokenId || null, mintNextAttemptAt: null }
        : { mintStatus: 'PENDING', mintError: message, mintErrorCode: code, mintNextAttemptAt: new Date(Date.now() + waitMin * 60 * 1000) },
    });
    await this.audit({
      userId: ticket.userId,
      action: gaveUp ? 'NFT_MINT_GAVE_UP' : 'NFT_MINT_FAILED',
      targetType: 'Ticket',
      targetId: ticket.id,
      details: { attempt: ticket.mintAttempts, error: message, code, conflictTokenId: error.conflictTokenId || null, nextRetryMinutes: gaveUp ? null : waitMin },
    });
    console.warn(`⚠️ NFT mint failed for ticket ${ticket.id} (attempt ${ticket.mintAttempts}${gaveUp ? ', giving up' : `, retry in ${waitMin} min`}): ${message}`);
    return { ...base, outcome: gaveUp ? 'FAILED' : 'RETRY', attempts: ticket.mintAttempts, error: message, code, permanent: Boolean(error.permanent) };
  }

  /** Mints the given tickets one at a time, then sends the customer and admin notices. */
  async processMints(ticketIds, options = {}) {
    const results = [];
    for (const id of ticketIds) results.push(await this.mintTicketNFT(id, options));
    await this.notifyOutcomes(results);
    const count = (...outcomes) => results.filter((r) => outcomes.includes(r.outcome)).length;
    return { results, minted: count('MINTED', 'ALREADY_MINTED'), retrying: count('RETRY'), failed: count('FAILED'), skipped: count('SKIPPED') };
  }

  async notifyOutcomes(results) {
    const byOrder = (list) => {
      const groups = new Map();
      for (const r of list) groups.set(r.orderId, [...(groups.get(r.orderId) || []), r]);
      return [...groups.values()];
    };
    for (const group of byOrder(results.filter((r) => r.outcome === 'MINTED' && r.attempts > 1))) {
      const { userId, eventName } = group[0];
      await prisma.notification.create({
        data: {
          userId,
          type: 'TICKET_ISSUED',
          title: `NFT tickets issued for “${eventName}”`,
          message: `${plural(group.length, 'NFT ticket')} for “${eventName}” ${group.length === 1 ? 'is' : 'are'} now issued. Nothing changes at the gate: your QR pass works as before.`,
          link: '/my-nfts',
        },
      });
    }
    for (const group of byOrder(results.filter((r) => r.outcome === 'FAILED'))) {
      const { userId, eventName } = group[0];
      await prisma.notification.create({
        data: {
          userId,
          type: 'TICKET_ISSUANCE_DELAYED',
          title: `Your tickets for “${eventName}” are valid; the NFT is delayed`,
          message: `Your payment and your ${plural(group.length, 'ticket')} for “${eventName}” are confirmed and your QR pass works at the gate. Issuing the NFT is taking longer than usual; our team has been alerted. You don’t need to do anything.`,
          link: '/wallet',
        },
      });
    }
    const alert = results.filter((r) => r.outcome === 'FAILED' || (r.outcome === 'RETRY' && r.attempts === ALERT_AFTER_ATTEMPTS));
    if (alert.length) {
      const events = [...new Set(alert.map((r) => `“${r.eventName}”`))].join(', ');
      const stopped = alert.some((r) => r.outcome === 'FAILED');
      await notifyAdmins({
        type: 'ADMIN_MINT_FAILED',
        title: `${plural(alert.length, 'paid ticket')} not minted yet`,
        message: `${events}: ${alert[0].error}. The tickets are paid and valid at the gate. ${stopped ? 'Some need a decision: resolve them from Event approvals → Ticket issuance (a note is required).' : `They are being retried automatically (up to ${MAX_MINT_ATTEMPTS} attempts).`}`,
        link: '/admin/event-approvals?tab=issuance',
      });
    }
  }

  async batchMintOrderTickets(orderId, options = {}) {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { tickets: { select: { id: true } } } });
    if (!order) throw new Error(`Order not found: ${orderId}`);
    const summary = await this.processMints(order.tickets.map((t) => t.id), options);
    return {
      orderId,
      totalMinted: summary.minted,
      pending: summary.retrying + summary.skipped,
      failed: summary.failed,
      nfts: summary.results.filter((r) => ['MINTED', 'ALREADY_MINTED'].includes(r.outcome)),
      results: summary.results,
    };
  }

  /** Background job: release stale claims, resume stalled reissues, mint every paid ticket whose attempt is due. */
  async retryDueMints({ userId = null, limit = 50 } = {}) {
    await this.ready();
    if (this.mode === 'disabled') return { minted: 0, retrying: 0, failed: 0, skipped: 0, disabled: true };
    const now = new Date();
    await prisma.ticket.updateMany({
      where: { mintStatus: 'MINTING', updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
      data: { mintStatus: 'PENDING', mintError: 'Interrupted while minting.' },
    });
    const stalled = await prisma.mintResolution.findMany({
      where: { action: 'REISSUE', status: 'IN_PROGRESS', updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) }, ...(userId ? { ticket: { userId } } : {}) },
      select: { id: true },
      take: 10,
    });
    for (const r of stalled) await this.runReissue(r.id).catch((e) => console.error('[NFT] reissue resume failed:', e.message));

    const due = await prisma.ticket.findMany({
      where: {
        ...MINTABLE,
        // Leave an order paid in the last minute to its own confirm request
        order: { ...MINTABLE.order, updatedAt: { lt: new Date(now.getTime() - 60 * 1000) } },
        ...(userId ? { userId } : {}),
        mintStatus: 'PENDING',
        OR: [{ mintNextAttemptAt: null }, { mintNextAttemptAt: { lte: now } }],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (!due.length) return { minted: 0, retrying: 0, failed: 0, skipped: 0 };
    return this.processMints(due.map((t) => t.id), { dueOnly: true });
  }

  retryDueMintsLater(options) {
    setImmediate(() => this.retryDueMints(options).catch((e) => console.error('[NFT] retry failed:', e.message)));
  }

  // ── Permanent failure resolution (admin) ─────────────────────────────────────────────────────────────

  /**
   * An admin's decision on a ticket whose NFT failed permanently (or was waived). The note is required and kept
   * on the resolution and in the audit log. RETRY and REISSUE run now; REISSUE is resumable if it stops part-way.
   */
  async resolve({ ticketId, action, note, adminId }) {
    await this.ready();
    const text = String(note || '').trim();
    if (!['RETRY', 'REISSUE', 'WAIVE'].includes(action)) throw new ResolutionError(400, 'Unknown action.');
    if (text.length < MIN_NOTE_LENGTH) throw new ResolutionError(400, `A note of at least ${MIN_NOTE_LENGTH} characters is required.`);
    if (action !== 'WAIVE' && this.mode === 'disabled') throw new ResolutionError(409, `Minting is disabled: ${this.problems[0] || 'configuration'}`);

    const resolution = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: ticketId, ...MINTABLE } });
      if (!ticket) throw new ResolutionError(404, 'Ticket not found, not paid, or cancelled.');
      const allowed = action === 'WAIVE' ? ['FAILED'] : ['FAILED', 'WAIVED'];
      if (!allowed.includes(ticket.mintStatus)) throw new ResolutionError(409, `This ticket's NFT is ${ticket.mintStatus.toLowerCase()}; only failed${action === 'WAIVE' ? '' : ' or waived'} ones can be resolved this way.`);
      const open = await tx.mintResolution.count({ where: { ticketId, status: { in: ['IN_PROGRESS', 'FAILED'] }, action: 'REISSUE' } });
      if (open) throw new ResolutionError(409, 'A reissue for this ticket is already open; continue it instead.');
      return tx.mintResolution.create({ data: { ticketId, action, note: text, adminId, oldTokenId: action === 'REISSUE' ? ticket.mintConflictTokenId : null } });
    });
    await this.audit({ userId: adminId, action: `ADMIN_MINT_${action}`, targetType: 'Ticket', targetId: ticketId, details: { resolutionId: resolution.id, note: text } });

    if (action === 'WAIVE') {
      const t = await prisma.ticket.update({ where: { id: ticketId }, data: { mintStatus: 'WAIVED', mintNextAttemptAt: null }, include: { event: { select: { name: true } } } });
      await prisma.notification.create({
        data: {
          userId: t.userId,
          type: 'TICKET_NFT_WAIVED',
          title: `Your ticket for “${t.event.name}” is valid`,
          message: `We couldn’t issue an NFT for one of your tickets to “${t.event.name}”. Your ticket and payment are not affected and your QR pass works at the gate.`,
          link: '/wallet',
        },
      });
      return this.finish(resolution.id, 'COMPLETED');
    }
    if (action === 'RETRY') {
      const result = await this.mintTicketNFT(ticketId, { force: true });
      await this.notifyOutcomes([result]);
      return this.finish(resolution.id, ['MINTED', 'ALREADY_MINTED'].includes(result.outcome) ? 'COMPLETED' : 'FAILED', { error: result.error || result.reason || null, newTokenId: result.tokenId ?? null });
    }
    return this.runReissue(resolution.id);
  }

  async finish(id, status, data = {}) {
    return prisma.mintResolution.update({ where: { id }, data: { status, completedAt: status === 'COMPLETED' ? new Date() : null, ...data } });
  }

  /** Continues a reissue that stopped (error, crash, timeout). Every step checks the chain first. */
  async continueResolution(id, adminId) {
    const r = await prisma.mintResolution.findUnique({ where: { id } });
    if (!r) throw new ResolutionError(404, 'Resolution not found.');
    if (r.action !== 'REISSUE' || r.status === 'COMPLETED') throw new ResolutionError(409, 'Only an unfinished reissue can be continued.');
    await this.audit({ userId: adminId, action: 'ADMIN_MINT_REISSUE_CONTINUED', targetType: 'Ticket', targetId: r.ticketId, details: { resolutionId: id } });
    return this.runReissue(id);
  }

  /**
   * REISSUE, as resumable steps (all under the chain lock in live mode):
   *   A. find the token holding the ticket's current seat key; refuse if it belongs to a ticket that is still valid
   *   B. invalidate it on-chain (skipped if the chain already shows it invalidated; a saved tx hash is checked first)
   *   C. pick and save a new seat key `${seatId}~r<n>` on the resolution and the ticket (before minting)
   *   D. mint under the new key (adopts the token if an earlier try already minted it)
   */
  async runReissue(id) {
    await this.ready();
    const busy = { id, status: 'IN_PROGRESS', error: 'Another API instance holds the minting lock; continue later.' };
    return this.coordinated(async () => {
      let r = await prisma.mintResolution.update({ where: { id }, data: { status: 'IN_PROGRESS', error: null } });
      try {
        const ticket = await prisma.ticket.findUnique({ where: { id: r.ticketId } });
        const fingerprint = ticketFingerprint(ticket);

        // A. The token on the current seat key
        if (r.oldTokenId == null) {
          const tokenId = this.isLive ? Number(await withTimeout(this.contract.seatToTokenId(seatKeyOf(ticket)), 'seatToTokenId')) : ticket.mintConflictTokenId || 0;
          r = await prisma.mintResolution.update({ where: { id }, data: { oldTokenId: tokenId || 0 } });
        }
        if (r.oldTokenId) {
          if (this.isLive) {
            const onChain = await withTimeout(this.contract.tickets(r.oldTokenId), 'tickets');
            if (onChain.ticketHash === fingerprint) throw new ResolutionError(409, `Token #${r.oldTokenId} is this ticket's own token; use Retry (it will be adopted), not Reissue.`);
          }
          // Never invalidate a token that a still-valid ticket was issued
          const minted = await prisma.auditLog.findMany({ where: { action: 'NFT_TICKET_MINTED', details: { path: ['tokenId'], equals: r.oldTokenId } }, select: { targetId: true, details: true } });
          // Same contract and chain only (token IDs are per contract); entries that don't say count, to be safe
          const sameContract = (d) => (!d?.contractAddress || d.contractAddress.toLowerCase() === this.config.contractAddress.toLowerCase()) && (d?.chainId == null || Number(d.chainId) === this.config.chainId);
          const holders = minted.filter((m) => m.targetId !== ticket.id && !m.details?.simulated && sameContract(m.details)).map((m) => m.targetId);
          if (holders.length) {
            const live = await prisma.ticket.findFirst({ where: { id: { in: holders }, status: { in: ['ACTIVE', 'SCANNED'] }, order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] } } }, select: { id: true } });
            if (live) throw new ResolutionError(409, `Token #${r.oldTokenId} belongs to ticket ${live.id}, which is still valid. It must not be invalidated.`);
          }

          // B. Invalidate the old token (idempotent)
          if (!r.invalidatedAt) {
            if (this.isLive) {
              let invalidated = (await withTimeout(this.contract.tickets(r.oldTokenId), 'tickets')).isInvalidated;
              if (!invalidated && r.invalidateTxHash) {
                // A transaction from an earlier try: wait for it rather than sending another
                const receipt = await withTimeout(this.signer.provider.waitForTransaction(r.invalidateTxHash, 1, TX_WAIT_TIMEOUT_MS), 'waitForTransaction', TX_WAIT_TIMEOUT_MS + 5000).catch(() => null);
                invalidated = receipt?.status === 1 && (await withTimeout(this.contract.tickets(r.oldTokenId), 'tickets')).isInvalidated;
              }
              if (!invalidated) {
                const tx = await withTimeout(this.contract.invalidateTicket(r.oldTokenId, `TicketLedger reissue ${id}`), 'invalidateTicket');
                r = await prisma.mintResolution.update({ where: { id }, data: { invalidateTxHash: tx.hash } });
                const receipt = await tx.wait(1, TX_WAIT_TIMEOUT_MS);
                if (!receipt || receipt.status !== 1) throw new MintError('The invalidate transaction was reverted.');
                if (!(await withTimeout(this.contract.tickets(r.oldTokenId), 'tickets')).isInvalidated) throw new MintError('The old token is still not invalidated on-chain.');
              }
            }
            r = await prisma.mintResolution.update({ where: { id }, data: { invalidatedAt: new Date() } });
            await this.audit({ userId: r.adminId, action: 'NFT_TOKEN_INVALIDATED', targetType: 'Ticket', targetId: ticket.id, details: { resolutionId: id, tokenId: r.oldTokenId, txHash: r.invalidateTxHash, simulated: !this.isLive } });
          }
        }

        // C. New seat key, saved before minting so every retry uses the same one
        if (!r.newChainSeatId) {
          const earlier = await prisma.mintResolution.count({ where: { ticketId: ticket.id, action: 'REISSUE', newChainSeatId: { not: null } } });
          let n = earlier + 1;
          let key = `${ticket.seatId}~r${n}`;
          if (this.isLive) {
            // A key someone else already used would conflict again: take the next free one
            while (Number(await withTimeout(this.contract.seatToTokenId(`${ticket.eventId}-${key}`), 'seatToTokenId'))) key = `${ticket.seatId}~r${++n}`;
          }
          await prisma.$transaction([
            prisma.mintResolution.update({ where: { id }, data: { newChainSeatId: key } }),
            prisma.ticket.update({ where: { id: ticket.id }, data: { chainSeatId: key, mintStatus: 'PENDING', mintAttempts: 0, mintError: null, mintErrorCode: null, mintConflictTokenId: null, mintNextAttemptAt: null } }),
          ]);
          r = await prisma.mintResolution.findUnique({ where: { id } });
        }

        // D. Mint under the new key (we already hold the lock: call the unit of work directly)
        const result = await this.mintOne(ticket.id, { force: true });
        await this.notifyOutcomes([result]);
        if (!['MINTED', 'ALREADY_MINTED'].includes(result.outcome)) throw new MintError(result.error || result.reason || 'Minting under the new seat key failed.');
        await this.audit({ userId: r.adminId, action: 'NFT_TICKET_REISSUED', targetType: 'Ticket', targetId: ticket.id, details: { resolutionId: id, oldTokenId: r.oldTokenId || null, newTokenId: result.tokenId, seatKey: `${ticket.eventId}-${r.newChainSeatId}` } });
        return this.finish(id, 'COMPLETED', { newTokenId: result.tokenId ?? null, error: null });
      } catch (e) {
        await prisma.mintResolution.update({ where: { id }, data: { status: 'FAILED', error: (e.message || 'Reissue failed').slice(0, 500) } });
        if (e instanceof ResolutionError) throw e;
        return prisma.mintResolution.findUnique({ where: { id } });
      }
    }, busy);
  }
}

export default new NFTService();
