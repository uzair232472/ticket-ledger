-- CreateEnum
CREATE TYPE "MintStatus" AS ENUM ('PENDING', 'MINTING', 'MINTED', 'FAILED');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "mintAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mintError" TEXT,
ADD COLUMN     "mintNextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "mintStatus" "MintStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "mintedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Ticket_mintStatus_mintNextAttemptAt_idx" ON "Ticket"("mintStatus", "mintNextAttemptAt");


-- Backfill: tickets minted before mint tracking existed (they already carry a token and transaction)
UPDATE "Ticket" SET "mintStatus" = 'MINTED' WHERE "tokenId" IS NOT NULL AND "txHash" IS NOT NULL;
