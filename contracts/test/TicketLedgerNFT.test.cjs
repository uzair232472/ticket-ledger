const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TicketLedgerNFT Smart Contract Tests", function () {
  let ticketNFT;
  let owner;
  let minter;
  let buyer1;
  let buyer2;

  beforeEach(async function () {
    [owner, minter, buyer1, buyer2] = await ethers.getSigners();

    const TicketLedgerNFT = await ethers.getContractFactory("TicketLedgerNFT");
    ticketNFT = await TicketLedgerNFT.deploy(owner.address);
    await ticketNFT.waitForDeployment();

    // Authorize minter address
    await ticketNFT.setMinterStatus(minter.address, true);
  });

  it("1. Should deploy with correct initial state and name/symbol", async function () {
    expect(await ticketNFT.name()).to.equal("TicketLedger NFT Ticket");
    expect(await ticketNFT.symbol()).to.equal("TLT");
    expect(await ticketNFT.owner()).to.equal(owner.address);
    expect(await ticketNFT.authorizedMinters(minter.address)).to.equal(true);
  });

  it("2. Should allow authorized minter to mint a single ticket with anti-scalping ceiling", async function () {
    const eventId = "psl-2026-final";
    const tierId = "vip-gallery";
    const seatId = "A-12";
    const originalPrice = 10000; // Rs. 10,000
    const ticketHash = ethers.keccak256(ethers.toUtf8Bytes("ticket-psl-A12"));
    const tokenURI = "https://ticketledger.pk/metadata/psl-A12.json";

    const tx = await ticketNFT.connect(minter).mintTicket(
      buyer1.address,
      tokenURI,
      eventId,
      tierId,
      seatId,
      originalPrice,
      ticketHash
    );
    await tx.wait();

    // Verify token ownership
    expect(await ticketNFT.ownerOf(1)).to.equal(buyer1.address);
    expect(await ticketNFT.tokenURI(1)).to.equal(tokenURI);

    // Verify details
    const details = await ticketNFT.getTicketDetails(1);
    expect(details.eventId).to.equal(eventId);
    expect(details.seatId).to.equal(seatId);
    expect(details.originalPrice).to.equal(originalPrice);
    // Anti-scalping 110% cap: 10000 * 110 / 100 = 11000
    expect(details.resalePriceCap).to.equal(11000);
    expect(details.isInvalidated).to.equal(false);
  });

  it("3. Anti-Scalping: validateResalePrice should enforce maximum 110% ceiling", async function () {
    const originalPrice = 5000;
    const ticketHash = ethers.keccak256(ethers.toUtf8Bytes("ticket-test"));

    await ticketNFT.connect(minter).mintTicket(
      buyer1.address,
      "uri",
      "evt1",
      "tier1",
      "B-5",
      originalPrice,
      ticketHash
    );

    // 110% of 5000 is 5500
    expect(await ticketNFT.validateResalePrice(1, 5000)).to.equal(true);  // at original price
    expect(await ticketNFT.validateResalePrice(1, 5500)).to.equal(true);  // at max cap
    expect(await ticketNFT.validateResalePrice(1, 5501)).to.equal(false); // exceeds 110% scalping cap
    expect(await ticketNFT.validateResalePrice(1, 12000)).to.equal(false); // predatory scalping rejected
  });

  it("4. Anti-Duplicate: Should strictly reject double minting the same physical seat for an event", async function () {
    const ticketHash = ethers.keccak256(ethers.toUtf8Bytes("ticket-dup"));

    // First mint succeeds
    await ticketNFT.connect(minter).mintTicket(
      buyer1.address,
      "uri1",
      "psl-event",
      "general",
      "G-1",
      1500,
      ticketHash
    );

    // Second mint of the SAME seat on the same event must fail
    await expect(
      ticketNFT.connect(minter).mintTicket(
        buyer2.address,
        "uri2",
        "psl-event",
        "general",
        "G-1",
        1500,
        ticketHash
      )
    ).to.be.revertedWith("TicketLedger: Seat already minted for this event");
  });

  it("5. Should support batch minting multiple tickets efficiently", async function () {
    const recipients = [buyer1.address, buyer2.address];
    const uris = ["uri1", "uri2"];
    const tierIds = ["tier1", "tier2"];
    const seatIds = ["RowA-1", "RowA-2"];
    const prices = [2500, 3000];
    const hashes = [
      ethers.keccak256(ethers.toUtf8Bytes("t1")),
      ethers.keccak256(ethers.toUtf8Bytes("t2")),
    ];

    const tx = await ticketNFT.connect(minter).batchMintTickets(
      recipients,
      uris,
      "concert-atif-aslam",
      tierIds,
      seatIds,
      prices,
      hashes
    );
    await tx.wait();

    expect(await ticketNFT.ownerOf(1)).to.equal(buyer1.address);
    expect(await ticketNFT.ownerOf(2)).to.equal(buyer2.address);
  });

  it("6. Should allow owner/minter to invalidate a ticket upon refund or cancellation", async function () {
    const ticketHash = ethers.keccak256(ethers.toUtf8Bytes("ticket-inv"));

    await ticketNFT.connect(minter).mintTicket(
      buyer1.address,
      "uri",
      "evt2",
      "vip",
      "C-10",
      8000,
      ticketHash
    );

    await ticketNFT.connect(owner).invalidateTicket(1, "Customer requested refund");
    const details = await ticketNFT.getTicketDetails(1);
    expect(details.isInvalidated).to.equal(true);

    // Resale on invalidated ticket should revert
    await expect(ticketNFT.validateResalePrice(1, 5000)).to.be.revertedWith(
      "TicketLedger: Ticket has been invalidated"
    );
  });
});
