-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'EVENT_MANAGER', 'FINANCE_MANAGER', 'STAFF', 'GATE_STAFF');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'REMOVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InviteStatus" ADD VALUE 'REJECTED';
ALTER TYPE "InviteStatus" ADD VALUE 'REVOKED';

-- DropForeignKey
ALTER TABLE "Company" DROP CONSTRAINT "Company_userId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "StaffInvite" ADD COLUMN     "acceptedUserId" TEXT,
ADD COLUMN     "eventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "grantedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "revokedById" TEXT,
ADD COLUMN     "revokedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "role" "OrgRole" NOT NULL DEFAULT 'GATE_STAFF',
ALTER COLUMN "eventId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revokedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invitedById" TEXT,
    "inviteId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedById" TEXT,
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationMember_companyId_status_idx" ON "OrganizationMember"("companyId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_status_idx" ON "OrganizationMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_companyId_userId_key" ON "OrganizationMember"("companyId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One organization per user: at most one membership that is not REMOVED
CREATE UNIQUE INDEX "OrganizationMember_one_open_membership_per_user" ON "OrganizationMember"("userId") WHERE "status" <> 'REMOVED';

-- Backfill 1: every company's registering account becomes its OWNER
INSERT INTO "OrganizationMember" ("id", "companyId", "userId", "role", "status", "joinedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", c."userId", 'OWNER', 'ACTIVE', c."createdAt", now(), now()
FROM "Company" c;

-- Backfill 2: gate staff accounts become GATE_STAFF members of their company. Organizer-deactivated staff
-- (User.status DEACTIVATED) keep no organization access. Their account status itself is left as it was.
INSERT INTO "OrganizationMember" ("id", "companyId", "userId", "role", "status", "statusChangedAt", "statusReason", "joinedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."companyId", u."id", 'GATE_STAFF',
       CASE WHEN u."status" = 'DEACTIVATED' THEN 'DEACTIVATED'::"MemberStatus" ELSE 'ACTIVE'::"MemberStatus" END,
       CASE WHEN u."status" = 'DEACTIVATED' THEN now() END,
       CASE WHEN u."status" = 'DEACTIVATED' THEN 'Deactivated before organization memberships existed' END,
       u."createdAt", now(), now()
FROM "User" u
WHERE u."role" = 'GATE_STAFF' AND u."companyId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."userId" = u."id");

-- Backfill 3: existing gate staff invites name their one event in eventIds
UPDATE "StaffInvite" SET "eventIds" = ARRAY["eventId"] WHERE "eventId" IS NOT NULL;

-- Backfill 4: attach existing audit rows to their organization where it is known
UPDATE "AuditLog" a SET "companyId" = e."companyId" FROM "Event" e WHERE a."targetType" = 'Event' AND a."targetId" = e."id" AND a."companyId" IS NULL;
UPDATE "AuditLog" a SET "companyId" = c."id" FROM "Company" c WHERE a."targetType" = 'Company' AND a."targetId" = c."id" AND a."companyId" IS NULL;
UPDATE "AuditLog" a SET "companyId" = c."id" FROM "Company" c WHERE a."companyId" IS NULL AND a."details" ->> 'companyId' = c."id";
