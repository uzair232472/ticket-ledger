-- Gate diagnostics (additive): scanner-reported health on GateDevice and a log of every upload request.
-- AlterTable
ALTER TABLE "GateDevice" ADD COLUMN     "appVersion" TEXT,
ADD COLUMN     "clockSkewMs" INTEGER,
ADD COLUMN     "deviceConflicts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedScans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastScanAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncErrorAt" TIMESTAMP(3),
ADD COLUMN     "manifestAt" TIMESTAMP(3),
ADD COLUMN     "oldestPendingAt" TIMESTAMP(3),
ADD COLUMN     "pendingManifest" JSONB,
ADD COLUMN     "storagePersisted" BOOLEAN,
ADD COLUMN     "stuckScans" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GateSyncBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "alreadyProcessed" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "retry" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "quarantined" INTEGER NOT NULL DEFAULT 0,
    "lastAckedSeq" INTEGER,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateSyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GateSyncBatch_deviceId_createdAt_idx" ON "GateSyncBatch"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "GateSyncBatch_eventId_createdAt_idx" ON "GateSyncBatch"("eventId", "createdAt");

