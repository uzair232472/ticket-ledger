-- CreateEnum
CREATE TYPE "RecoverySource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "recoveryDelayHours" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "recoveryDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recoveryValidHours" INTEGER NOT NULL DEFAULT 48;

-- CreateTable
CREATE TABLE "RecoveryReminder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "discountCodeId" TEXT,
    "source" "RecoverySource" NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryReminder_userId_eventId_sentAt_idx" ON "RecoveryReminder"("userId", "eventId", "sentAt");

-- CreateIndex
CREATE INDEX "RecoveryReminder_companyId_sentAt_idx" ON "RecoveryReminder"("companyId", "sentAt");

-- CreateIndex
CREATE INDEX "RecoveryReminder_orderId_idx" ON "RecoveryReminder"("orderId");

