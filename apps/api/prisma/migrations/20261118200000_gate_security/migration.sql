-- Gate security (additive): per-device scan signing key, signature evidence on CheckIn, TAMPERED quarantine reason.
-- AlterEnum
ALTER TYPE "QuarantineReason" ADD VALUE 'TAMPERED';

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "deviceSigned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GateDevice" ADD COLUMN     "signingKey" JSONB,
ADD COLUMN     "signingKeyAt" TIMESTAMP(3);

