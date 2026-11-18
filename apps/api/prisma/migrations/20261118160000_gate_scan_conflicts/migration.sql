-- Gate scan conflicts (additive): conflict records for offline scans that disagree with the server ticket
-- state, linked to their CheckIn rows; resolved only by supervisors, never automatically.
-- CreateEnum
CREATE TYPE "ScanConflictType" AS ENUM ('DUPLICATE_ADMISSION', 'TICKET_INVALIDATED', 'ORDERING', 'REENTRY_LIMIT', 'RULE_MISMATCH');

-- CreateEnum
CREATE TYPE "ScanConflictStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ScanConflictResolution" AS ENUM ('CONFIRMED_SINGLE_ENTRY', 'CONFIRMED_MULTIPLE_ENTRY', 'ADMISSION_ACCEPTED', 'ADMISSION_REJECTED', 'DEVICE_ERROR', 'DISMISSED');

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "conflictId" TEXT;

-- CreateTable
CREATE TABLE "ScanConflict" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ticketId" TEXT,
    "type" "ScanConflictType" NOT NULL,
    "status" "ScanConflictStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "detectedById" TEXT NOT NULL,
    "resolution" "ScanConflictResolution",
    "resolutionReason" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanConflict_eventId_status_idx" ON "ScanConflict"("eventId", "status");

-- CreateIndex
CREATE INDEX "ScanConflict_ticketId_type_status_idx" ON "ScanConflict"("ticketId", "type", "status");

-- CreateIndex
CREATE INDEX "CheckIn_conflictId_idx" ON "CheckIn"("conflictId");

