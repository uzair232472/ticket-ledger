import prisma from '../config/prisma.js';
import nftService, { MAX_MINT_ATTEMPTS, MINTABLE, MIN_NOTE_LENGTH, ResolutionError, seatKeyOf } from '../services/nftService.js';
import { ticketStates } from '../services/ticketStatus.js';

const STATES = ['FAILED', 'PENDING', 'MINTING', 'MINTED', 'WAIVED'];
const fail = (res, error, fallback) => {
  if (error instanceof ResolutionError) return res.status(error.status).json({ success: false, message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};

/** GET /admin/mints?status=FAILED: paid tickets by issuance state, with their resolution history and the minting mode. */
export const listMints = async (req, res) => {
  try {
    await nftService.ready();
    const status = STATES.includes(req.query.status) ? req.query.status : 'FAILED';
    const [tickets, counts, openResolutions] = await Promise.all([
      prisma.ticket.findMany({
        where: { ...MINTABLE, mintStatus: status },
        include: {
          event: { select: { id: true, name: true, date: true } },
          user: { select: { id: true, name: true, email: true, walletAddress: true } },
          seat: { select: { section: true, row: true, seatNumber: true, kind: true } },
          order: { select: { status: true, paymentMethod: true, createdAt: true } },
          mintResolutions: { orderBy: { createdAt: 'desc' }, take: 10, include: { admin: { select: { name: true, email: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      prisma.ticket.groupBy({ by: ['mintStatus'], where: MINTABLE, _count: true }),
      prisma.mintResolution.count({ where: { status: { in: ['IN_PROGRESS', 'FAILED'] }, action: 'REISSUE' } }),
    ]);
    return res.json({
      success: true,
      data: {
        tickets: tickets.map((t) => ({
          id: t.id,
          orderId: t.orderId,
          price: t.price,
          status: t.status,
          tokenId: t.tokenId,
          txHash: t.txHash,
          mintStatus: t.mintStatus,
          mintAttempts: t.mintAttempts,
          mintError: t.mintError,
          mintErrorCode: t.mintErrorCode,
          mintConflictTokenId: t.mintConflictTokenId,
          mintNextAttemptAt: t.mintNextAttemptAt,
          mintedAt: t.mintedAt,
          seatKey: seatKeyOf(t),
          states: ticketStates(t),
          event: t.event,
          user: t.user,
          seat: t.seat,
          order: { paymentMethod: t.order.paymentMethod, createdAt: t.order.createdAt },
          resolutions: t.mintResolutions,
        })),
        counts: Object.fromEntries(counts.map((c) => [c.mintStatus, c._count])),
        openResolutions,
        maxAttempts: MAX_MINT_ATTEMPTS,
        minNoteLength: MIN_NOTE_LENGTH,
        minting: nftService.status(),
      },
    });
  } catch (error) {
    return fail(res, error, 'Failed to load ticket issuance.');
  }
};

/** POST /admin/mints/retry { ids? }: mint tickets that are still retrying automatically, now. Failed ones need a resolution. */
export const retryMints = async (req, res) => {
  try {
    const requested = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids.map(String).slice(0, 200) : null;
    const ids = (await prisma.ticket.findMany({ where: { ...MINTABLE, mintStatus: 'PENDING', ...(requested ? { id: { in: requested } } : {}) }, select: { id: true }, take: 200 })).map((t) => t.id);
    const result = await nftService.processMints(ids);
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'ADMIN_MINT_RETRY_PENDING', targetType: 'Ticket', targetId: ids.length === 1 ? ids[0] : null, details: { ticketIds: ids, minted: result.minted, retrying: result.retrying, failed: result.failed } },
    });
    const parts = [`${result.minted} minted`];
    if (result.retrying) parts.push(`${result.retrying} failed again and will be retried automatically`);
    if (result.failed) parts.push(`${result.failed} failed permanently and need a decision`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    return res.json({ success: true, message: `${parts.join(', ')}.`, data: { minted: result.minted, retrying: result.retrying, failed: result.failed, skipped: result.skipped } });
  } catch (error) {
    return fail(res, error, 'Failed to retry minting.');
  }
};

/** POST /admin/mints/:ticketId/resolve { action: RETRY|REISSUE|WAIVE, note }: decide on a permanently failed NFT. */
export const resolveMint = async (req, res) => {
  try {
    const resolution = await nftService.resolve({ ticketId: req.params.ticketId, action: req.body?.action, note: req.body?.note, adminId: req.user.id });
    const ok = resolution.status === 'COMPLETED';
    return res.status(ok ? 200 : 202).json({
      success: true,
      message: ok ? 'Resolved.' : `Recorded, but not finished: ${resolution.error || 'see the resolution'}. You can continue it.`,
      data: { resolution },
    });
  } catch (error) {
    return fail(res, error, 'Failed to resolve.');
  }
};

/** POST /admin/mint-resolutions/:id/continue: resume a reissue that stopped part-way. */
export const continueMintResolution = async (req, res) => {
  try {
    const resolution = await nftService.continueResolution(req.params.id, req.user.id);
    return res.json({ success: true, message: resolution.status === 'COMPLETED' ? 'Reissue completed.' : `Not finished: ${resolution.error || 'try again later'}.`, data: { resolution } });
  } catch (error) {
    return fail(res, error, 'Failed to continue the reissue.');
  }
};

/** POST /admin/mints/:ticketId/verify: read the ticket's token back from the chain; records "NFT verified" only if it matches. */
export const verifyMint = async (req, res) => {
  try {
    const result = await nftService.verifyTicket(req.params.ticketId, { record: true });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_NFT_VERIFY', targetType: 'Ticket', targetId: req.params.ticketId, details: result } });
    return res.json({ success: true, message: result.ok ? 'NFT verified on-chain.' : `Not verified: ${result.problems.join('; ')}`, data: result });
  } catch (error) {
    return fail(res, error, 'Failed to verify.');
  }
};
