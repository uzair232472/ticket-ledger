-- Gate sync idempotency (additive): scan ids and device evidence on CheckIn (unique per device), reversible
-- GateScan rows, the device's last acknowledged sequence number, and quarantined scans (evidence, never admitted).
-- CreateEnum
CREATE TYPE "QuarantineReason" AS ENUM ('DEVICE_REVOKED', 'ACCESS_REMOVED', 'INVALID');

-- CreateEnum
CREATE TYPE "QuarantineStatus" AS ENUM ('PENDING_REVIEW', 'REVIEWED');

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "clientScanId" TEXT,
ADD COLUMN     "deviceRecordId" TEXT,
ADD COLUMN     "deviceScannedAt" TEXT,
ADD COLUMN     "deviceSeq" INTEGER,
ADD COLUMN     "localReason" TEXT,
ADD COLUMN     "localResult" "CheckInResult";

-- AlterTable
ALTER TABLE "GateDevice" ADD COLUMN     "lastSeqAcked" INTEGER;

-- AlterTable
ALTER TABLE "GateScan" ADD COLUMN     "checkInId" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT;

-- CreateTable
CREATE TABLE "QuarantinedScan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "deviceId" TEXT,
    "clientScanId" TEXT,
    "deviceSeq" INTEGER,
    "submittedById" TEXT NOT NULL,
    "reason" "QuarantineReason" NOT NULL,
    "detail" TEXT,
    "payload" JSONB NOT NULL,
    "status" "QuarantineStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuarantinedScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuarantinedScan_eventId_status_idx" ON "QuarantinedScan"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuarantinedScan_companyId_deviceKey_clientScanId_key" ON "QuarantinedScan"("companyId", "deviceKey", "clientScanId");

-- CreateIndex
CREATE INDEX "CheckIn_deviceRecordId_deviceSeq_idx" ON "CheckIn"("deviceRecordId", "deviceSeq");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_deviceRecordId_clientScanId_key" ON "CheckIn"("deviceRecordId", "clientScanId");

-- CreateIndex
CREATE INDEX "GateScan_checkInId_idx" ON "GateScan"("checkInId");

