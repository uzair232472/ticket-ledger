-- CreateEnum
CREATE TYPE "CompanyDocumentType" AS ENUM ('VERIFICATION', 'NTN_CERTIFICATE', 'FBR_REGISTRATION', 'CNIC', 'BUSINESS_LICENSE', 'BANK_LETTER', 'CONTRACT', 'INSURANCE', 'VENUE_PERMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA');

-- CreateEnum
CREATE TYPE "PayoutSchedule" AS ENUM ('AFTER_EVENT', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "FinanceVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "DiscountSource" AS ENUM ('MANUAL', 'CART_RECOVERY');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "address" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "supportEmail" TEXT,
ADD COLUMN     "supportPhone" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountCodeId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "paymentRef" TEXT,
ADD COLUMN     "subtotalAmount" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "CompanyDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CompanyDocumentType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "uploadedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyFinancialProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payoutMethod" "PayoutMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "payoutSchedule" "PayoutSchedule" NOT NULL DEFAULT 'AFTER_EVENT',
    "accountTitle" TEXT,
    "bankName" TEXT,
    "bankBranchCode" TEXT,
    "ibanEncrypted" TEXT,
    "ibanLast4" TEXT,
    "walletEncrypted" TEXT,
    "walletLast4" TEXT,
    "taxNtn" TEXT,
    "salesTaxNumber" TEXT,
    "taxFiler" BOOLEAN NOT NULL DEFAULT false,
    "billingEmail" TEXT,
    "billingAddress" TEXT,
    "status" "FinanceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyFinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBranch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isHeadOffice" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "managerUserId" TEXT,
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "maxRedemptions" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "minTickets" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "DiscountSource" NOT NULL DEFAULT 'MANUAL',
    "restrictedToUserId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRedemption" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyDocument_companyId_archivedAt_idx" ON "CompanyDocument"("companyId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyFinancialProfile_companyId_key" ON "CompanyFinancialProfile"("companyId");

-- CreateIndex
CREATE INDEX "CompanyFinancialProfile_status_idx" ON "CompanyFinancialProfile"("status");

-- CreateIndex
CREATE INDEX "CompanyBranch_companyId_status_idx" ON "CompanyBranch"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBranch_companyId_name_key" ON "CompanyBranch"("companyId", "name");

-- CreateIndex
CREATE INDEX "DiscountCode_eventId_idx" ON "DiscountCode"("eventId");

-- CreateIndex
CREATE INDEX "DiscountCode_companyId_source_idx" ON "DiscountCode"("companyId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_companyId_code_key" ON "DiscountCode"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRedemption_orderId_key" ON "DiscountRedemption"("orderId");

-- CreateIndex
CREATE INDEX "DiscountRedemption_discountCodeId_status_idx" ON "DiscountRedemption"("discountCodeId", "status");

-- CreateIndex
CREATE INDEX "DiscountRedemption_userId_idx" ON "DiscountRedemption"("userId");

-- CreateIndex
CREATE INDEX "Event_branchId_idx" ON "Event"("branchId");

-- CreateIndex
CREATE INDEX "Order_paymentTxId_idx" ON "Order"("paymentTxId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "CompanyBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDocument" ADD CONSTRAINT "CompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFinancialProfile" ADD CONSTRAINT "CompanyFinancialProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBranch" ADD CONSTRAINT "CompanyBranch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Backfill 1: the verification documents sent with each registration start the organization's document library
INSERT INTO "CompanyDocument" ("id", "companyId", "type", "title", "url", "uploadedById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'VERIFICATION', 'Verification document ' || d.n, d.url, c."userId", c."createdAt", now()
FROM "Company" c
CROSS JOIN LATERAL unnest(CASE WHEN cardinality(c."documentUrls") > 0 THEN c."documentUrls" ELSE ARRAY[c."documentUrl"] END) WITH ORDINALITY AS d(url, n)
WHERE d.url IS NOT NULL AND d.url <> '';

-- Backfill 2: every organization gets a head office at its registered city
INSERT INTO "CompanyBranch" ("id", "companyId", "name", "isHeadOffice", "city", "phone", "email", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'Head office', true, c."city", c."phone", c."email", c."createdAt", now()
FROM "Company" c;

-- Backfill 3: orders placed before discounts existed were charged their ticket prices
UPDATE "Order" SET "subtotalAmount" = "totalAmount" WHERE "subtotalAmount" IS NULL;

-- One head office per organization
CREATE UNIQUE INDEX "CompanyBranch_one_head_office" ON "CompanyBranch"("companyId") WHERE "isHeadOffice";
