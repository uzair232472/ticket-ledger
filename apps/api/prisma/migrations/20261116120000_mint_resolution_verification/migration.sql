-- CreateEnum
CREATE TYPE "MintResolutionAction" AS ENUM ('RETRY', 'REISSUE', 'WAIVE');

-- CreateEnum
CREATE TYPE "MintResolutionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "MintStatus" ADD VALUE 'WAIVED';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "chainSeatId" TEXT,
ADD COLUMN     "mintConflictTokenId" INTEGER,
ADD COLUMN     "mintErrorCode" TEXT,
ADD COLUMN     "mintSimulated" BOOLEAN,
ADD COLUMN     "nftVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "nftVerifiedChainId" INTEGER,
ADD COLUMN     "nftVerifiedContract" TEXT,
ADD COLUMN     "nftVerifiedOwner" TEXT;

-- CreateTable
CREATE TABLE "MintResolution" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "action" "MintResolutionAction" NOT NULL,
    "status" "MintResolutionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "note" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "oldTokenId" INTEGER,
    "invalidateTxHash" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "newChainSeatId" TEXT,
    "newTokenId" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MintResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MintResolution_ticketId_idx" ON "MintResolution"("ticketId");

-- CreateIndex
CREATE INDEX "MintResolution_status_idx" ON "MintResolution"("status");

-- AddForeignKey
ALTER TABLE "MintResolution" ADD CONSTRAINT "MintResolution_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintResolution" ADD CONSTRAINT "MintResolution_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

