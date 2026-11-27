// In-memory stand-in for TicketLedgerNFT (tests only): one token per seat key, a second mint of a key reverts,
// invalidateTicket marks a token. `hooks` lets a test delay, time out or crash a step. Counts sends and the
// largest number of transactions in flight at once (one signer must never have more than one).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export function fakeChain() {
  const chain = { seats: new Map(), tokens: new Map(), txs: new Map(), next: 1, sends: 0, mints: 0, invalidates: 0, inFlight: 0, maxInFlight: 0, hooks: {}, pending: [] };
  const revert = (msg = 'TicketLedger: Seat already minted for this event') => Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION', shortMessage: `execution reverted: "${msg}"` });
  const hash = () => `0x${String(chain.sends).padStart(64, '0')}`;

  chain.mine = (p) => {
    if (p.kind === 'invalidate') {
      chain.tokens.get(p.tokenId).isInvalidated = true;
      chain.txs.set(p.hash, { status: 1 });
      return true;
    }
    if (chain.seats.has(p.seatKey)) {
      chain.txs.set(p.hash, { status: 0 });
      return null;
    }
    const tokenId = chain.next++;
    chain.seats.set(p.seatKey, tokenId);
    chain.tokens.set(tokenId, { owner: p.recipient, ticketHash: p.ticketHash, seatKey: p.seatKey, isInvalidated: false });
    chain.txs.set(p.hash, { status: 1, tokenId });
    return tokenId;
  };
  /** A token minted by someone else (e.g. a deleted checkout's ticket) holding a seat key. */
  chain.preMint = (seatKey, ticketHash = '0x' + 'ab'.repeat(32), owner = '0x000000000000000000000000000000000000bEEF') => {
    chain.sends += 1;
    return chain.mine({ kind: 'mint', hash: hash(), seatKey, ticketHash, recipient: owner });
  };

  const send = (pending, receipt) => {
    chain.sends += 1;
    chain.inFlight += 1;
    chain.maxInFlight = Math.max(chain.maxInFlight, chain.inFlight);
    pending.hash = hash();
    chain.lastPending = pending;
    chain.pending.push(pending);
    return {
      hash: pending.hash,
      wait: async () => {
        try {
          await (chain.hooks.beforeMine?.(pending) ?? sleep(chain.hooks.delay ?? 5));
          if (chain.hooks.timeout?.(pending)) throw Object.assign(new Error('timeout'), { code: 'TIMEOUT', shortMessage: 'timeout' });
          const result = chain.mine(pending);
          if (!result) throw revert();
          return receipt(result);
        } finally {
          chain.inFlight -= 1;
        }
      },
    };
  };

  chain.contract = {
    seatToTokenId: async (key) => BigInt(chain.seats.get(key) || 0),
    tickets: async (id) => {
      const t = chain.tokens.get(Number(id));
      return { ticketHash: t?.ticketHash || '0x', isInvalidated: Boolean(t?.isInvalidated) };
    },
    ownerOf: async (id) => {
      const t = chain.tokens.get(Number(id));
      if (!t) throw revert('ERC721NonexistentToken');
      return t.owner;
    },
    mintTicket: async (recipient, uri, eventId, tierId, seatId, price, ticketHash) => {
      const seatKey = `${eventId}-${seatId}`;
      if (chain.seats.has(seatKey)) throw revert(); // like estimateGas: reverts before sending
      chain.mints += 1;
      return send({ kind: 'mint', recipient, ticketHash, seatKey }, (tokenId) => ({
        hash: chain.lastPending.hash,
        status: 1,
        logs: [{ topics: [TRANSFER, '0x', '0x', `0x${tokenId.toString(16).padStart(64, '0')}`] }],
      }));
    },
    invalidateTicket: async (tokenId) => {
      if (!chain.tokens.has(Number(tokenId))) throw revert('TicketLedger: Nonexistent token');
      chain.invalidates += 1;
      return send({ kind: 'invalidate', tokenId: Number(tokenId) }, () => ({ status: 1, logs: [] }));
    },
  };
  chain.provider = {
    waitForTransaction: async (h) => {
      const t = chain.txs.get(h);
      return t ? { status: t.status } : null;
    },
  };
  return chain;
}
