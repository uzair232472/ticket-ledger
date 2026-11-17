-- AlterTable
ALTER TABLE "SupportAttachment" ADD COLUMN     "storageKey" TEXT,
ALTER COLUMN "url" DROP NOT NULL;

