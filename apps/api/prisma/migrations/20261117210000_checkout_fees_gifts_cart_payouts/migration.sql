-- CreateEnum
CREATE TYPE "ServiceFeeType" AS ENUM ('NONE', 'PERCENT', 'PER_TICKET');

-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('PENDING', 'CLAIMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('SCHEDULED', 'ON_HOLD', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "serviceFeeType" "ServiceFeeType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "serviceFeeValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxLabel" TEXT NOT NULL DEFAULT 'Sales tax',
ADD COLUMN     "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRegistrationNumber" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "allowSeatChanges" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "groupDiscountPercent" INTEGER,
ADD COLUMN     "groupMinTickets" INTEGER,
ADD COLUMN     "maxTicketsPerCustomer" INTEGER,
ADD COLUMN     "seatChangeCutoffHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutGroupId" TEXT,
ADD COLUMN     "groupDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "serviceFeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "seatChanges" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TicketGift" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "message" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'GIFT',
    "tokenHash" TEXT NOT NULL,
    "status" "GiftStatus" NOT NULL DEFAULT 'PENDING',
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketGift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'MOCK',
    "paymentRef" TEXT,
    "paymentTxId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossSales" DECIMAL(12,2) NOT NULL,
    "refunds" DECIMAL(12,2) NOT NULL,
    "platformFee" DECIMAL(12,2) NOT NULL,
    "serviceFees" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'SCHEDULED',
    "holdReason" TEXT,
    "payoutMethod" TEXT,
    "destination" TEXT,
    "reference" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "processedById" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketGift_tokenHash_key" ON "TicketGift"("tokenHash");

-- CreateIndex
CREATE INDEX "TicketGift_ticketId_status_idx" ON "TicketGift"("ticketId", "status");

-- CreateIndex
CREATE INDEX "TicketGift_recipientEmail_status_idx" ON "TicketGift"("recipientEmail", "status");

-- CreateIndex
CREATE INDEX "TicketGift_senderId_idx" ON "TicketGift"("senderId");

-- CreateIndex
CREATE INDEX "CheckoutGroup_userId_status_idx" ON "CheckoutGroup"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutGroup_userId_idempotencyKey_key" ON "CheckoutGroup"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Payout_companyId_status_idx" ON "Payout"("companyId", "status");

-- CreateIndex
CREATE INDEX "Payout_status_scheduledFor_idx" ON "Payout"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_eventId_key" ON "Payout"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceNumber_key" ON "Order"("invoiceNumber");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutGroupId_fkey" FOREIGN KEY ("checkoutGroupId") REFERENCES "CheckoutGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invoice numbers: INV-<year>-<6 digits>, from one sequence
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" START 1;
