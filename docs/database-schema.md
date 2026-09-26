# TicketLedger Database Schema Specification

This document details the PostgreSQL schema managed via Prisma ORM for TicketLedger.

## Entity Relationship Overview

- **User**: Authentication, roles (`CUSTOMER`, `ORGANIZER`, `GATE_STAFF`, `SUPER_ADMIN`), statuses (`ACTIVE`, `FROZEN`, `BLACKLISTED`), and MetaMask wallet address.
- **Company**: Organizer verification details, NTN/CNIC, document proof, approval status (`PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`).
- **Event**: Organizer-hosted matches/concerts, dates, status (`DRAFT`, `PUBLISHED`, `COMPLETED`, etc.), venue, and city.
- **TicketTier**: Classes (VIP, General, Pavilion) with fixed prices and quotas.
- **Seat**: Specific seating coordinates (Section, Row, Number) with statuses (`AVAILABLE`, `LOCKED`, `SOLD`, `BLOCKED`).
- **Order**: Financial transaction record linked to user, event, and payment gateway (`MOCK`, `STRIPE`, `JAZZCASH`, `EASYPAISA`).
- **Ticket**: Issued ticket NFT reference, dynamic QR cryptographic nonce, signature, gate check-in status, and resale state.
- **ResaleListing**: Controlled secondary marketplace listings enforcing the 110% ceiling.
- **GateScan**: Comprehensive gate entry validation audit log (staff ID, timestamp, outcome).
- **BehaviorEvent**: Real-time event tracking stream for ML intent and fraud analysis.
- **Notification**: User in-app and push notification records.
- **AuditLog**: Administrative action tracking.

## Core Schema Details

See [`apps/api/prisma/schema.prisma`](file:///C:/Users/23247/.gemini/antigravity/scratch/ticket-ledger/apps/api/prisma/schema.prisma) for the exact model constraints, indexes, and relations.
