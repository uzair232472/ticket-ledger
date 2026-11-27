-- AlterEnum
ALTER TYPE "SupportAuthorType" ADD VALUE 'ORGANIZER';

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "SupportTicket_companyId_status_idx" ON "SupportTicket"("companyId", "status");


-- Requests already linked to an event belong to that event's organization
UPDATE "SupportTicket" t SET "companyId" = e."companyId" FROM "Event" e WHERE t."eventId" = e."id" AND t."companyId" IS NULL;
