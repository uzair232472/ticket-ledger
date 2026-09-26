# TicketLedger FYP Phase 2 Demonstration Script

This script outlines the complete end-to-end evaluation flow for FYP defense and demonstration.

---

## Act 1: Organizer Onboarding & Administrative Governance
1. **Organizer Registration**:
   - Event organizer registers with company name, NTN, CNIC, and verification documents.
   - Status transitions to `PENDING`. Organizer cannot publish live events yet.
2. **Super Admin Verification**:
   - Super Admin inspects organizer credentials in the Admin Approval portal.
   - Admin approves organizer; automated email/in-app notification triggers.

---

## Act 2: Event Creation & AI Demand Forecasting
3. **Pre-Launch AI Demand Forecast**:
   - Organizer drafts a PSL cricket match / music festival in Lahore.
   - ML model analyzes venue capacity, ticket tiers, timing, and city demand.
   - System outputs expected 48h ticket sales and pricing advice.
4. **Publish Event**:
   - Organizer sets seat map sections, rows, and tiered prices.
   - Event status transitions to `PUBLISHED`.

---

## Act 3: Discovery, Seat Map & Redis Atomic Locking
5. **Customer Browsing & Wallet Connection**:
   - Customer browses events with filters (Cricket, Lahore, Price).
   - Customer connects MetaMask wallet (`0x...`).
6. **Interactive Seat Selection & Redis Reservation**:
   - Customer selects seats on the interactive visual seat map.
   - Seat is atomically locked for **10 minutes** via Redis key with TTL.
   - Real-time Socket.io broadcast marks seat as "Locked" across all concurrent user screens.

---

## Act 4: Checkout, Multi-Channel Payment & Blockchain Minting
7. **Payment Processing**:
   - Customer checks out using Mock / JazzCash / EasyPaisa / Stripe.
   - Payment succeeds.
8. **ERC721 NFT Minting on Polygon Amoy**:
   - Backend triggers NFT ticket minting on Polygon Amoy testnet.
   - Smart contract registers `tokenId`, `txHash`, and owner wallet in the ledger.

---

## Act 5: Dynamic QR Wallet & Gate Entry Validation
9. **Dynamic QR Ticket Display**:
   - Customer opens Ticket Wallet showing NFT badge and dynamic signed QR.
   - Customer downloads verifiable PDF ticket.
10. **Dual Validation at Gate**:
    - Gate staff scans QR ticket.
    - **First Scan**: Dual DB + Blockchain check passes -> **GREEN** screen + entry counter increments in real time via Socket.io.
    - **Second Scan**: Duplicate entry attempt detected -> **YELLOW** screen ("Already Scanned").
    - **Tampered QR / Resold Ticket**: -> **RED** screen ("Invalid / Transferred").

---

## Act 6: 110% Anti-Scalping Resale & Secondary Market
11. **Enforced Anti-Scalp Resale**:
    - Customer lists ticket on secondary marketplace.
    - Attempting to list at 150% fails on both backend validation and Solidity contract check (`<= 110%`).
    - Listing at 108% succeeds.
    - Upon resale, original ticket QR is immediately invalidated and new NFT ownership is reassigned.

---

## Act 7: AI Analytics & Fraud Defense
12. **Organizer Conversion Funnel**:
    - Organizer inspects real-time funnel (`Viewed -> Seat Selected -> Checkout -> Paid`).
    - High-intent abandoned carts receive personalized reminder prompts.
13. **Super Admin Fraud & Audit Intelligence**:
    - Fraud model flags suspicious multi-card rapid purchases with high fraud scores.
    - Admin freezes fraudulent accounts with one click.
