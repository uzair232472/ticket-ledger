# TicketLedger 🎟️ 🇵🇰

> **Blockchain-Based Event Ticketing System for Pakistani Sports and Concerts**
> *Final Year Project (FYP) - Phase 2*

TicketLedger eliminates ticket scalping, counterfeit QR validation, and lack of audience insights using Polygon ERC721 NFTs, Redis atomic seat reservation, and AI behavioral analytics.

---

## 🏗️ Monorepo Structure

```
ticket-ledger/
  apps/
    web/              React Vite frontend (Tailwind CSS, Ethers.js, Socket.io)
    api/              Node Express backend (Prisma, PostgreSQL, Redis, Socket.io)
    ml-service/       Python FastAPI ML service (Scikit-learn, Intent & Fraud scoring)
  contracts/          Solidity Hardhat contracts (Polygon Amoy ERC721)
  docs/               Architecture, Database, API, ML & Demo documentation
  infra/              docker-compose.yml (PostgreSQL 16 & Redis 7)
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v18+ (tested on v25.1.0)
- **Python**: v3.10+ (tested on v3.13.5)
- **Docker / Docker Compose** (Optional for containerized DB/Redis)

---

### Step 1: Clone and Infrastructure Setup

If using Docker:
```bash
docker-compose -f infra/docker-compose.yml up -d
```

---

### Step 2: Backend (Express API)

```bash
cd apps/api
npm install
npm run prisma:generate
npm run dev
```
- API starts at: `http://localhost:5000`
- Health check: `http://localhost:5000/api/health`

---

### Step 3: Frontend (React + Vite)

```bash
cd apps/web
npm install
npm run dev
```
- Web portal opens at: `http://localhost:5173`

---

### Step 4: Machine Learning Service (FastAPI)

```bash
cd apps/ml-service
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```
- ML service runs at: `http://localhost:8000`
- Swagger Docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

---

## 📜 20-Module Implementation Roadmap

1. [x] **Module 1**: Project Setup and Architecture
2. [ ] **Module 2**: Authentication and Role-Based Access
3. [ ] **Module 3**: User Profile and Wallet Connection
4. [ ] **Module 4**: Company Registration and Approval
5. [ ] **Module 5**: Event Management & Tiers
6. [ ] **Module 6**: Seat Map & Redis Locking
7. [ ] **Module 7**: Ticket Booking & Multi-Channel Payments
8. [ ] **Module 8**: Blockchain Smart Contracts on Polygon (ERC721)
9. [ ] **Module 9**: Digital Ticket & Cryptographic QR Wallet
10. [ ] **Module 10**: Gate Check-in & Dual Validation
11. [ ] **Module 11**: Ticket Transfer & 110% Controlled Resale
12. [ ] **Module 12**: Multi-Channel Notification System
13. [ ] **Module 13**: Behavior Tracking System
14. [ ] **Module 14**: ML Dataset Generation & Model Training
15. [ ] **Module 15**: FastAPI ML Inference Engine
16. [ ] **Module 16**: Purchase Intent Analytics Page
17. [ ] **Module 17**: Pre-Launch Demand Forecast Page
18. [ ] **Module 18**: Abandoned Intent Dashboard
19. [ ] **Module 19**: Super Admin & Organizer Analytics
20. [ ] **Module 20**: Final Testing, Seed Data & FYP Demo Script
