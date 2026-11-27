import { eventTiming, moveRefusal } from './eventTiming.js';
/*
 * The separate facts about a ticket. They are independent and must never stand in for one another:
 *
 *   payment  Has the customer paid?                 Order.status
 *   entry    Can this ticket get into the event?     Ticket.status (+ paid). Never depends on the NFT.
 *   nft      Where is blockchain issuance?           Ticket.mint* fields:
 *              PENDING     issuance incomplete (waiting, retrying, or minting is disabled)
 *              FAILED      stopped; an admin must resolve it
 *              WAIVED      an admin decided (with a note) that this ticket gets no NFT
 *              SIMULATED   a development-mode fake token: not on any chain
 *              RECORDED    a token and transaction are recorded, but ownership has not been read back from the chain
 *              VERIFIED    ownership and fingerprint were read from the chain and matched
 *
 * "Payment successful" never implies "NFT verified", and "NFT pending" never makes a ticket invalid.
 */

const PAID = ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'];

export function paymentState(order) {
  const status = order?.status || 'PENDING';
  const label = {
    PENDING: 'Payment not completed',
    FAILED: 'Payment failed',
    SUCCESSFUL: 'Payment successful',
    PARTIALLY_REFUNDED: 'Payment successful (partly refunded)',
    REFUNDED: 'Payment refunded',
  }[status] || status;
  return { status, paid: PAID.includes(status), label };
}

export function entryState(ticket, order, event = ticket.event || order?.event, now = new Date()) {
  const paid = ['SUCCESSFUL', 'PARTIALLY_REFUNDED'].includes(order?.status);
  if (!paid) return { status: 'NOT_PAID', valid: false, label: 'Not valid (not paid)' };
  // An unused ticket of an event that has ended (or was cancelled) is expired, whatever its stored status
  if (ticket.status === 'ACTIVE' && event?.status === 'CANCELLED') return { status: 'CANCELLED', valid: false, label: 'Event cancelled' };
  if (ticket.status === 'ACTIVE' && event && (event.startsAt || event.date) && eventTiming(event, now).ended) {
    return { status: 'EXPIRED', valid: false, label: 'Event ended: ticket expired' };
  }
  const status = {
    ACTIVE: 'VALID',
    SCANNED: 'USED',
    CANCELLED: 'CANCELLED',
    TRANSFERRED: 'MOVED',
    RESOLD: 'MOVED',
  }[ticket.status] || ticket.status;
  const label = { VALID: 'Ticket valid', USED: 'Ticket used at the gate', CANCELLED: 'Ticket cancelled', MOVED: 'Ticket moved to another holder' }[status] || status;
  return { status, valid: status === 'VALID', label };
}

export function nftState(ticket) {
  let status;
  if (ticket.mintStatus === 'WAIVED') status = 'WAIVED';
  else if (ticket.mintStatus === 'FAILED') status = 'FAILED';
  else if (ticket.mintStatus !== 'MINTED') status = 'PENDING';
  else if (ticket.mintSimulated === true) status = 'SIMULATED';
  else if (ticket.nftVerifiedAt) status = 'VERIFIED';
  else status = 'RECORDED';
  const label = {
    PENDING: 'NFT pending',
    FAILED: 'NFT issuance delayed',
    WAIVED: 'No NFT (ticket still valid)',
    SIMULATED: 'NFT simulated (not on-chain)',
    RECORDED: 'NFT recorded, not verified',
    VERIFIED: 'NFT verified',
  }[status];
  return {
    status,
    label,
    tokenId: ticket.tokenId ?? null,
    verifiedAt: ticket.nftVerifiedAt || null,
    verifiedOwner: ticket.nftVerifiedOwner || null,
    attempts: ticket.mintAttempts || 0,
    nextAttemptAt: status === 'PENDING' ? ticket.mintNextAttemptAt || null : null,
  };
}

/** All three, for API responses: { payment, entry, nft }. `order` needs `status`. */
export const ticketStates = (ticket, order = ticket.order, event = ticket.event || order?.event) => {
  const entry = entryState(ticket, order, event);
  // What the holder may still do with it: only a valid ticket of an event that has not started can be moved
  const moveBlock = entry.status !== 'VALID' ? entry.label : event && (event.startsAt || event.date) ? moveRefusal(event, 'transferred') : null;
  return {
    payment: paymentState(order),
    entry,
    nft: nftState(ticket),
    actions: { canTransfer: !moveBlock, canResell: !moveBlock, reason: moveBlock || null },
  };
};
