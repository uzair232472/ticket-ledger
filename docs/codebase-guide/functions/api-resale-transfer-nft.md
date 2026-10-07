# Function catalogue — transfers, resale, waitlist & blockchain (NFT)

[← Function catalogue index](README.md) · Module walkthroughs: [Transfers & resale](../02-modules/transfers-resale.md) · [Blockchain / NFT](../02-modules/blockchain-nft.md)

Files: `apps/api/src/controllers/ticketTransferController.js`, `controllers/resaleController.js`, `services/nftService.js`, `contracts/contracts/TicketLedgerNFT.sol`, `contracts/scripts/deploy.cjs`, `contracts/test/TicketLedgerNFT.test.cjs`, `contracts/hardhat.config.cjs`.

**How ownership moves:** both a direct transfer and a resale purchase update the **same `Ticket` row**: `userId` becomes the new owner, `qrVersion` is incremented (old owner's signed QR now fails at the gate with "Old QR"), `manualCode` is cleared (a new one is assigned lazily), and the legacy `qrNonce` is replaced. A `TicketTransferHistory` row records the move. **Nothing is sent to the blockchain** on transfer or resale (no `nftService` call) — on-chain ownership, if a token was ever really minted, stays with the original recipient/custodian wallet.

---

## `ticketTransferController.js`

<a id="api-transfer-direct"></a>
### `transferTicketDirectly` — `POST /api/tickets/transfer` — `:14` (`requireAuth`)
- **In:** `{ticketId, recipientEmail}`. **Caller:** `DigitalWallet.jsx:197`.
- **Steps:**
  1. Zod-validate (note: a `ZodError` here is **not** special-cased, so invalid input returns **500** with the raw message).
  2. Load ticket with event, seat/tier and active listings; 404 if missing; **403** unless the caller owns it; **400** unless `status === 'ACTIVE'` (scanned/used tickets cannot move).
  3. Recipient must be a registered user (404 otherwise) and not the sender (400).
  4. **Transaction:** cancel active resale listings of the ticket; update the ticket (`userId`, `ownerWallet` = recipient wallet or previous, new `qrNonce`, `qrIssuedAt`, `qrVersion + 1`, `manualCode: null`); create `TicketTransferHistory` (`DIRECT_TRANSFER`, price 0, old/new nonce, txHash); notifications `TICKET_RECEIVED` (recipient) and `TICKET_TRANSFERRED` (sender); AuditLog `TICKET_TRANSFERRED_DIRECTLY`.
  5. Behaviour `TICKET_TRANSFERRED`; **200** with new owner and nonces.
- **Not checked (observed):** that the ticket's order is `SUCCESSFUL` (a placeholder ticket of the sender's own unpaid checkout has status `ACTIVE`); recipient role or status (a suspended account can receive). Ticket `status` stays `ACTIVE` (the `TRANSFERRED` enum value is never set by this code).

<a id="api-waitlist"></a>
### `joinEventWaitlist` — `POST /api/events/:eventId/waitlist` — `:187` (`authenticateJWT`)
404 if no event; `upsert` on `(eventId, userId)` resetting `notified=false`; returns total waitlist size. Caller: `EventDetails.jsx:211`.

### `getEventWaitlistStatus` — `GET /api/events/:eventId/waitlist` — `:234`
`{onWaitlist, totalWaitlistCount}`. Caller: `EventDetails.jsx:184`.

**Waitlist effect:** when a ticket of that event is listed for resale, `listTicketForResale` notifies every waitlisted user except the seller and sets `notified=true`. Nothing else reads the waitlist.

### `getTicketTransferHistory` — `GET /api/tickets/:ticketId/transfer-history` — `:262`
History of one ticket with from/to user names **and emails**. **No ownership check** — any signed-in user who knows a ticket id can read it. Caller: `DigitalWallet.jsx:281`.

### `getMyTransferHistory` — `GET /api/tickets/my-transfers` — `:290`
Two queries: transfers sent and received by the caller, with ticket/event/seat and counterpart. Caller: `DigitalWallet.jsx:301`.

---

## `resaleController.js` (`/api/resale`)

<a id="api-resale-list"></a>
### `listTicketForResale` — `POST /api/resale/list` — `:15` (`requireAuth`)
- **In:** `{ticketId, resalePrice > 0}`. **Callers:** `DigitalWallet.jsx:244`, `MyNFTTickets.jsx:109`.
- **Steps:** load ticket with active listings → 404 / 403 (not owner) / 400 (status ≠ ACTIVE) / 409 (already listed) → **price cap:** `maxResalePrice = floor(originalPrice × 1.10)`; above it → **400** "Anti-scalping violation" with the numbers → create `ResaleListing` (`ACTIVE`, stores original, resale and max price) → AuditLog `TICKET_LISTED_FOR_RESALE` → notify waitlisted users (`RESALE_TICKET_AVAILABLE`, `createMany`, failures only logged) and mark them notified → behaviour `RESALE_ATTEMPTED` → notification `RESALE_LISTED` to the seller → **201**.
- **Note:** the cap is enforced **in the API**; the message says "blocked on-chain", but the contract's `validateResalePrice` is never called by the API. Order payment status is not checked.

### `cancelResaleListing` — `POST /api/resale/cancel/:listingId` — `:183`
Seller or admin; must be `ACTIVE`; sets `CANCELLED`; notification `RESALE_CANCELLED` (sent to the **caller**, so an admin cancelling gets the seller's message). Caller: `MyNFTTickets.jsx:138`.

### `getMarketListings` — `GET /api/resale/market` — `:234` (`optionalAuth`)
Filters `eventId`, `city` (exact), `maxPrice`, `search` (event name/venue, insensitive); only listings `ACTIVE` whose ticket is `ACTIVE`. Returns formatted listings with `markupPercent`, seller name/city, event, seat, token fields. Behaviour `RESALE_VIEWED`. Caller: `ResaleMarketplace.jsx:83`.

### `getMyListings` — `GET /api/resale/my-listings` — `:356`
All listings by the caller (any status). No web caller found.

<a id="api-resale-buy"></a>
### `buyResaleTicket` — `POST /api/resale/buy/:listingId` — `:385` (`requireAuth`)
- **Caller:** `ResaleMarketplace.jsx:127`.
- **Steps:** load listing (404); must be `ACTIVE` (400); buyer ≠ seller (400) → **transaction:** listing → `SOLD` + `buyerId`; ticket → new owner, `ownerWallet` = buyer wallet or previous, `status: ACTIVE`, new nonce, `qrVersion + 1`, `manualCode: null`; `TicketTransferHistory` (`P2P_RESALE`, price); notifications `RESALE_TICKET_SOLD` (seller, says "Funds have been credited") and `RESALE_TICKET_PURCHASED` (buyer); AuditLog `RESALE_PURCHASE_COMPLETED` → **200** with ticket and a receipt.
- **Payment:** **none.** No payment service is called and no money moves; the receipt is informational.
- **Concurrency (observed):** the `ACTIVE` check happens **before** the transaction and the listing update inside it is unconditional, so two simultaneous buyers could both pass the check; both transactions would succeed and the later one would end up owning the ticket. Compare with the conditional `updateMany` pattern used in `confirmBooking` and `reviewEvent`.
- The ticket's current status is not re-checked (a ticket scanned after listing could still be sold, and the update forces `status: ACTIVE`).

---

## `nftService.js` — NFT minting (**simulated unless configured**)

Module constants (read at import): `POLYGON_AMOY_RPC` (default public Amoy RPC), `CONTRACT_ADDRESS` = `TICKET_NFT_CONTRACT_ADDRESS` or a hard-coded address, `CUSTODIAN_WALLET` = `PLATFORM_CUSTODIAN_WALLET` or a hard-coded address. `TICKET_NFT_ABI` (`:11`) — human-readable ABI matching the contract's `mintTicket`, `validateResalePrice`, `getTicketDetails`, `ownerOf`, `tokenURI`.

> **Configuration mismatch:** `apps/api/.env.example` defines `POLYGON_RPC_URL`, `NFT_CONTRACT_ADDRESS` and `DEPLOYER_PRIVATE_KEY`, but this service reads `POLYGON_AMOY_RPC`, `TICKET_NFT_CONTRACT_ADDRESS`, `PLATFORM_CUSTODIAN_WALLET` and `POLYGON_PRIVATE_KEY`. With the example file, no signer is created and every mint is simulated.

### `class NFTService` — singleton exported as `default new NFTService()` (`:224`)

| Method | Line | Behaviour |
|---|---|---|
| `constructor()` / `initProvider()` | `:20`, `:27` | Creates an `ethers.JsonRpcProvider`; only if `POLYGON_PRIVATE_KEY` is set, a `Wallet` signer and `Contract`. Errors → warning, simulated mode. No network call happens at construction. |
| `generateMetadata({ticket, event, seat, tier, resaleCap})` | `:42` | ERC-721 JSON: name, description, image (banner or a fixed Unsplash URL), `external_url`, attributes (event, city, venue, date, section, row, seat, tier, original price, resale cap, network). |
| <a id="api-nft-mintticketnft"></a>`mintTicketNFT(ticketId)` | `:67` | See below. |
| `batchMintOrderTickets(orderId)` | `:198` | Loads the order's tickets and mints them **sequentially**; returns `{orderId, totalMinted, nfts}`. Callers: `bookingController.confirmBooking` (errors caught; booking still succeeds), `ticketController.mintOrderNFTs`. |

**`mintTicketNFT(ticketId)` steps**
1. Load ticket with event, user, seat/tier (throws if missing).
2. Already has `tokenId` and `txHash` → return them (`alreadyMinted`).
3. `resaleCap = floor(price × 110 / 100)`; recipient = user's `walletAddress` or the custodian wallet, normalised with `ethers.getAddress(lower-cased)` (checksummed form; since `cc26c42`). An invalid address falls back to the hard-coded custodian `0x71C8…F220` (`:101-106`).
4. `ticketHash = keccak256("ticketId:eventId:seatId:price")`; `tokenURI` = `data:application/json;base64,<metadata>` (metadata embedded, no IPFS).
5. **On-chain path** (only when a contract+signer exist): `contract.mintTicket(...)`, wait for the receipt, read `tokenId` from the ERC-721 `Transfer` log topic 3. Any error → warning and fall through.
6. **Simulation path:** `tokenId = (BigInt(ticketHash) % 1_000_000) + 1000` (deterministic from the hash) and `txHash` = **32 random bytes** (not a real transaction; the generated Polygonscan link will not resolve).
7. **DB write:** ticket `tokenId, txHash, contractAddress, ownerWallet`; AuditLog `NFT_TICKET_MINTED`.
8. Returns token data, Polygonscan URL, `tokenURI`, updated ticket.
- **Callers:** `batchMintOrderTickets`, and lazily from `ticketController.getMyNFTTickets` and `getCustomerWallet` for any ticket without token data.
- **Note:** `originalPrice` is sent to the contract as the PKR number (no unit conversion), and the price is a Prisma `Decimal` converted with `Number()`.

---

## `contracts/` — Solidity smart contract (Hardhat project)

### `TicketLedgerNFT` — `contracts/contracts/TicketLedgerNFT.sol`
ERC-721 (`ERC721URIStorage`) + `Ownable` + `ReentrancyGuard`, name "TicketLedger NFT Ticket", symbol `TLT`, Solidity 0.8.24.

| Member | Line | Behaviour |
|---|---|---|
| `struct TicketData` / `tickets` mapping | `:16`, `:29` | Per token: event/tier/seat ids (strings), original price, `resalePriceCap`, `ticketHash`, `isInvalidated`, `mintedAt`. |
| `seatToTokenId` | `:32` | `"<eventId>-<seatId>"` → token id; prevents minting the same seat twice. |
| `authorizedMinters` | `:35` | Addresses allowed to mint (owner is added in the constructor). |
| `onlyMinterOrOwner` | `:57` | Modifier. |
| `constructor(initialOwner)` | `:65` | Sets name/symbol/owner; first token id 1. |
| `setMinterStatus(minter, status)` | `:76` | Owner-only; emits `MinterStatusUpdated`. |
| `mintTicket(recipient, tokenURI, eventId, tierId, seatId, originalPrice, ticketHash)` | `:84` | Rejects already-minted seat; `resaleCap = price × 110 / 100`; stores data; `_safeMint`; sets URI; emits `TicketMinted`; returns id. Called by `nftService` (when configured). |
| `batchMintTickets(...)` | `:126` | Same for arrays (length check). **Not called by the API.** |
| `validateResalePrice(tokenId, price)` | `:181` | `price <= resalePriceCap` (reverts for nonexistent/invalidated). **Not called by the API.** |
| `getTicketDetails(tokenId)` | `:191` | Returns stored data + current owner. Not called by the API. |
| `invalidateTicket(tokenId, reason)` | `:216` | Minter/owner flag; emits `TicketInvalidated`. Not called by the API. |

The contract does **not** restrict transfers (standard ERC-721 `transferFrom` works) — the 110 % cap is only a stored value plus a view function.

### Tooling
- `hardhat.config.cjs` — Solidity 0.8.24, optimizer 200 runs, `viaIR`, EVM `cancun`; networks `hardhat` (in-process), **`localhost`** (`http://127.0.0.1:8545`, chain 31337 — a `npx hardhat node`; added in `cc26c42`) and `amoy` (chain 80002) using `POLYGON_AMOY_RPC` and `POLYGON_PRIVATE_KEY`. To mint for real locally, run a Hardhat node, deploy the contract to it, and point the API's `POLYGON_AMOY_RPC` (despite its name) at `http://127.0.0.1:8545` with `POLYGON_PRIVATE_KEY` and `TICKET_NFT_CONTRACT_ADDRESS` set (inferred from the code and the root `scripts/`; the repository's local `.env` was not read).
- `scripts/deploy.cjs` — `main()` deploys with the first signer as owner and prints the address/Polygonscan link. **The npm script `deploy:amoy` points to `scripts/deploy.js`, which does not exist** (the file is `.cjs`); run `npx hardhat run scripts/deploy.cjs --network amoy` instead.
- `test/TicketLedgerNFT.test.cjs` — six Mocha/Chai tests: initial state, single mint with cap, `validateResalePrice` 110 % ceiling, duplicate-seat rejection, batch mint, invalidation. Run with `npx hardhat test` inside `contracts/`.
- No deployment address, ABI artifact or deployment record is committed; `artifacts/` and `cache/` are git-ignored.
