// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TicketLedgerNFT
 * @notice ERC721 NFT Smart Contract for TicketLedger on Polygon Amoy
 * Enforces anti-scalping 110% resale price cap and single-seat on-chain uniqueness.
 */
contract TicketLedgerNFT is ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 private _nextTokenId;

    struct TicketData {
        uint256 tokenId;
        string eventId;
        string tierId;
        string seatId;
        uint256 originalPrice;
        uint256 resalePriceCap; // Enforced at max 110% of original price
        bytes32 ticketHash;     // Cryptographic fingerprint
        bool isInvalidated;
        uint256 mintedAt;
    }

    // Mapping from tokenId to ticket metadata
    mapping(uint256 => TicketData) public tickets;

    // Mapping to prevent double-minting the same physical seat for an event
    mapping(string => uint256) public seatToTokenId;

    // Authorized minters (e.g. TicketLedger automated backend custodian)
    mapping(address => bool) public authorizedMinters;

    // Events
    event TicketMinted(
        uint256 indexed tokenId,
        address indexed to,
        string eventId,
        string seatId,
        uint256 originalPrice,
        uint256 resalePriceCap
    );

    event TicketTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        uint256 price
    );

    event TicketInvalidated(uint256 indexed tokenId, string reason);
    event MinterStatusUpdated(address indexed minter, bool status);

    modifier onlyMinterOrOwner() {
        require(
            msg.sender == owner() || authorizedMinters[msg.sender],
            "TicketLedger: Caller is not authorized minter or owner"
        );
        _;
    }

    constructor(address initialOwner) 
        ERC721("TicketLedger NFT Ticket", "TLT") 
        Ownable(initialOwner) 
    {
        _nextTokenId = 1;
        authorizedMinters[initialOwner] = true;
    }

    /**
     * @notice Set or revoke minter status for a backend custodian address
     */
    function setMinterStatus(address minter, bool status) external onlyOwner {
        authorizedMinters[minter] = status;
        emit MinterStatusUpdated(minter, status);
    }

    /**
     * @notice Mint a single NFT ticket with embedded metadata and anti-scalping ceiling
     */
    function mintTicket(
        address recipient,
        string calldata tokenURI,
        string calldata eventId,
        string calldata tierId,
        string calldata seatId,
        uint256 originalPrice,
        bytes32 ticketHash
    ) external onlyMinterOrOwner nonReentrant returns (uint256) {
        string memory seatKey = string.concat(eventId, "-", seatId);
        require(seatToTokenId[seatKey] == 0, "TicketLedger: Seat already minted for this event");

        uint256 tokenId = _nextTokenId++;
        
        // Anti-scalping 110% resale price cap: originalPrice * 110 / 100
        uint256 resaleCap = (originalPrice * 110) / 100;

        tickets[tokenId] = TicketData({
            tokenId: tokenId,
            eventId: eventId,
            tierId: tierId,
            seatId: seatId,
            originalPrice: originalPrice,
            resalePriceCap: resaleCap,
            ticketHash: ticketHash,
            isInvalidated: false,
            mintedAt: block.timestamp
        });

        seatToTokenId[seatKey] = tokenId;

        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, tokenURI);

        emit TicketMinted(tokenId, recipient, eventId, seatId, originalPrice, resaleCap);

        return tokenId;
    }

    /**
     * @notice Batch mint multiple NFT tickets in a single transaction
     */
    function batchMintTickets(
        address[] calldata recipients,
        string[] calldata tokenURIs,
        string calldata eventId,
        string[] calldata tierIds,
        string[] calldata seatIds,
        uint256[] calldata prices,
        bytes32[] calldata ticketHashes
    ) external onlyMinterOrOwner nonReentrant returns (uint256[] memory) {
        require(
            recipients.length == tokenURIs.length &&
            recipients.length == tierIds.length &&
            recipients.length == seatIds.length &&
            recipients.length == prices.length &&
            recipients.length == ticketHashes.length,
            "TicketLedger: Array lengths mismatch"
        );

        uint256 count = recipients.length;
        uint256[] memory mintedTokenIds = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            string memory seatKey = string.concat(eventId, "-", seatIds[i]);
            require(seatToTokenId[seatKey] == 0, "TicketLedger: Seat already minted in batch");

            uint256 tokenId = _nextTokenId++;
            uint256 resaleCap = (prices[i] * 110) / 100;

            tickets[tokenId] = TicketData({
                tokenId: tokenId,
                eventId: eventId,
                tierId: tierIds[i],
                seatId: seatIds[i],
                originalPrice: prices[i],
                resalePriceCap: resaleCap,
                ticketHash: ticketHashes[i],
                isInvalidated: false,
                mintedAt: block.timestamp
            });

            seatToTokenId[seatKey] = tokenId;

            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, tokenURIs[i]);

            emit TicketMinted(tokenId, recipients[i], eventId, seatIds[i], prices[i], resaleCap);
            mintedTokenIds[i] = tokenId;
        }

        return mintedTokenIds;
    }

    /**
     * @notice Verify whether a proposed resale price satisfies the anti-scalping cap
     */
    function validateResalePrice(uint256 tokenId, uint256 attemptedPrice) external view returns (bool) {
        require(_ownerOf(tokenId) != address(0), "TicketLedger: Nonexistent token");
        TicketData memory ticket = tickets[tokenId];
        require(!ticket.isInvalidated, "TicketLedger: Ticket has been invalidated");
        return attemptedPrice <= ticket.resalePriceCap;
    }

    /**
     * @notice Retrieve on-chain ticket verification record
     */
    function getTicketDetails(uint256 tokenId) external view returns (
        string memory eventId,
        string memory tierId,
        string memory seatId,
        uint256 originalPrice,
        uint256 resalePriceCap,
        bool isInvalidated,
        address currentOwner
    ) {
        require(_ownerOf(tokenId) != address(0), "TicketLedger: Nonexistent token");
        TicketData memory t = tickets[tokenId];
        return (
            t.eventId,
            t.tierId,
            t.seatId,
            t.originalPrice,
            t.resalePriceCap,
            t.isInvalidated,
            ownerOf(tokenId)
        );
    }

    /**
     * @notice Invalidate ticket on refund or terms violation
     */
    function invalidateTicket(uint256 tokenId, string calldata reason) external onlyMinterOrOwner {
        require(_ownerOf(tokenId) != address(0), "TicketLedger: Nonexistent token");
        tickets[tokenId].isInvalidated = true;
        emit TicketInvalidated(tokenId, reason);
    }
}
