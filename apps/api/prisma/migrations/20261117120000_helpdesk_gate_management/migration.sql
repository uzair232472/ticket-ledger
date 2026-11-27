-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('BOOKING', 'PAYMENT', 'REFUND', 'TICKET_ACCESS', 'EVENT', 'ACCOUNT', 'ORGANIZER', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportAuthorType" AS ENUM ('CUSTOMER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "GateType" AS ENUM ('ENTRY', 'EXIT', 'ENTRY_EXIT');

-- CreateEnum
CREATE TYPE "ScanDirection" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "ReentryPolicy" AS ENUM ('NONE', 'UNLIMITED', 'LIMITED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "direction" "ScanDirection" NOT NULL DEFAULT 'ENTRY',
ADD COLUMN     "exceptionId" TEXT,
ADD COLUMN     "gateId" TEXT,
ADD COLUMN     "reentry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "maxReentries" INTEGER,
ADD COLUMN     "reentryPolicy" "ReentryPolicy" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "entryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isInside" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastExitAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSupportAgent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "SupportCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "orderId" TEXT,
    "eventId" TEXT,
    "assigneeId" TEXT,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "escalationReason" TEXT,
    "firstResponseAt" TIMESTAMP(3),
    "lastCustomerReplyAt" TIMESTAMP(3),
    "lastAgentReplyAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorType" "SupportAuthorType" NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventGate" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GateType" NOT NULL DEFAULT 'ENTRY_EXIT',
    "allowedTierIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capacityPerHour" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateAssignment" (
    "gateId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateAssignment_pkey" PRIMARY KEY ("gateId","staffId")
);

-- CreateTable
CREATE TABLE "GateDevice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "registeredById" TEXT NOT NULL,
    "lastUserId" TEXT,
    "lastEventId" TEXT,
    "lastGate" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "pendingScans" INTEGER NOT NULL DEFAULT 0,
    "packAt" TIMESTAMP(3),
    "online" BOOLEAN NOT NULL DEFAULT true,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GateDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateException" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketId" TEXT,
    "code" TEXT,
    "gateId" TEXT,
    "gate" TEXT,
    "scanResult" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "deviceId" TEXT,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "checkInId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_reference_key" ON "SupportTicket"("reference");

-- CreateIndex
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assigneeId_status_idx" ON "SupportTicket"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventGate_eventId_name_key" ON "EventGate"("eventId", "name");

-- CreateIndex
CREATE INDEX "GateAssignment_staffId_eventId_idx" ON "GateAssignment"("staffId", "eventId");

-- CreateIndex
CREATE INDEX "GateDevice_companyId_status_idx" ON "GateDevice"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GateDevice_companyId_deviceKey_key" ON "GateDevice"("companyId", "deviceKey");

-- CreateIndex
CREATE INDEX "GateException_eventId_status_idx" ON "GateException"("eventId", "status");

-- CreateIndex
CREATE INDEX "CheckIn_gateId_scannedAt_idx" ON "CheckIn"("gateId", "scannedAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGate" ADD CONSTRAINT "EventGate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateAssignment" ADD CONSTRAINT "GateAssignment_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "EventGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateException" ADD CONSTRAINT "GateException_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing check-ins were entries; tickets already scanned are inside with one entry
UPDATE "Ticket" SET "isInside" = true, "entryCount" = 1 WHERE "status" = 'SCANNED';
