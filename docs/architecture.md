# TicketLedger System Architecture

## 1. Overview
TicketLedger is a next-generation decentralized ticketing ecosystem designed for Pakistani sports (cricket, kabaddi, football) and music concerts. It combines Solidity ERC721 smart contracts on Polygon Amoy with Node.js Express APIs, React frontend, atomic Redis seat locking, and a FastAPI machine learning service.

## 2. High-Level Architecture Diagram

```
+-------------------------------------------------------------+
|                     Client Tier (React Vite)                |
|  - Customer Web Portal        - Organizer Dashboard         |
|  - Gate Staff QR Scanner      - Super Admin Portal          |
|  - MetaMask Web3 Wallet       - Socket.io Real-time Client  |
+------------------------------+------------------------------+
                               | HTTPS / WSS
                               v
+-------------------------------------------------------------+
|                 Application Backend (Node.js/Express)       |
|  - JWT & Role-Based Auth Guard                              |
|  - Seat Reservation Engine (Redis Atomic 10-min TTL Lock)   |
|  - Secure Dynamic QR Generator (HMAC Signed + Nonce)        |
|  - Multi-Payment Hub (Mock, Stripe, JazzCash, EasyPaisa)    |
|  - Blockchain Minting Dispatcher (Ethers.js -> Polygon Amoy)|
|  - Real-Time Socket.io Server                               |
+---------------+------------------------------+---------------+
                |                              |
                v                              v
+-------------------------------+  +---------------------------+
|    Database & Cache Tier      |  |     FastAPI ML Tier       |
|  - PostgreSQL 16 (Relational) |  |  - Purchase Intent Scorer |
|  - Redis 7 (Seat Locking)     |  |  - Fraud Detection Engine |
|  - Prisma ORM Data Access     |  |  - 48h Demand Forecaster  |
+-------------------------------+  +---------------------------+
                |
                v
+-------------------------------------------------------------+
|           Blockchain Tier (Polygon Amoy Testnet)            |
|  - TicketNFT.sol (ERC721 Ticket Minting & Ownership)        |
|  - ResaleMarketplace.sol (Enforces Max 110% Resale Cap)     |
+-------------------------------------------------------------+
```

## 3. Technology Stack Alignment

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite, Tailwind CSS | Fast HMR, responsive UI, component-driven architecture |
| **Backend API** | Express.js, Node.js | Scalable asynchronous I/O, rich ecosystem for Web3/QR/PDF |
| **Database** | PostgreSQL 16 + Prisma ORM | ACID compliance for financial orders, strict relational constraints |
| **Cache & Lock** | Redis 7 | Sub-millisecond atomic key expirations for 10-minute seat reservations |
| **Blockchain** | Polygon Amoy (Solidity ERC721) | Ultra-low gas fees, fast finality, MetaMask compatibility, anti-scalp cap |
| **ML Engine** | Python FastAPI, Scikit-learn, TF | High-speed REST inference for intent and fraud scoring |
| **Payments** | Stripe, JazzCash, EasyPaisa, Mock | Local Pakistani payment gateways + international sandbox |
| **Real-time** | Socket.io | Live seat occupancy updates, gate check-in counts |
| **Documents/QR** | PDFKit, QRCode | Cryptographically verifiable dynamic ticket payloads & PDF downloads |

## 4. Security & Anti-Fraud Architecture
1. **Anti-Scalping (110% Resale Cap)**: The `ResaleMarketplace.sol` smart contract enforces `require(resalePrice <= originalPrice * 110 / 100, "Price exceeds cap")` at the blockchain level.
2. **Replay-Attack Resistant QR**: QR codes are not static; they contain a cryptographic signature, dynamic nonce, and timestamp that invalidate immediately upon gate scan or resale transfer.
3. **Atomic Double-Booking Prevention**: Seats are reserved with Redis `SET key value NX EX 600` before PostgreSQL order creation.
