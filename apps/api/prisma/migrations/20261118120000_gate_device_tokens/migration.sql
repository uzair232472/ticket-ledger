-- Gate device enrollment (additive): server-issued device tokens, stored as SHA-256 hashes only,
-- plus counters for legacy (unenrolled) access and rejected credentials.
ALTER TABLE "GateDevice" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "GateDevice" ADD COLUMN "tokenIssuedAt" TIMESTAMP(3);
ALTER TABLE "GateDevice" ADD COLUMN "enrolledById" TEXT;
ALTER TABLE "GateDevice" ADD COLUMN "legacyRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GateDevice" ADD COLUMN "lastLegacyAt" TIMESTAMP(3);
ALTER TABLE "GateDevice" ADD COLUMN "authFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GateDevice" ADD COLUMN "lastAuthFailureAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "GateDevice_tokenHash_key" ON "GateDevice"("tokenHash");
