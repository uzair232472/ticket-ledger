-- Gate advice job (services/gateAdviceJob.js): "tell ticket holders their gate" is queued and sent in the
-- background. New tables only; nothing existing changes. The partial unique index at the end cannot be written
-- in schema.prisma; it exists only here. A future `prisma migrate dev` diff must not drop it.

-- CreateEnum
CREATE TYPE "GateAdviceRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "GateAdviceRun" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "companyId" TEXT,
    "requestedById" TEXT NOT NULL,
    "status" "GateAdviceRunStatus" NOT NULL DEFAULT 'QUEUED',
    "people" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GateAdviceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateAdviceDelivery" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adviceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateAdviceDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GateAdviceRun_eventId_createdAt_idx" ON "GateAdviceRun"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "GateAdviceRun_status_createdAt_idx" ON "GateAdviceRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GateAdviceDelivery_runId_idx" ON "GateAdviceDelivery"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "GateAdviceDelivery_eventId_userId_adviceKey_key" ON "GateAdviceDelivery"("eventId", "userId", "adviceKey");


-- At most one QUEUED or RUNNING run per event: a double click or two managers cannot start two sends
CREATE UNIQUE INDEX "GateAdviceRun_one_active_per_event" ON "GateAdviceRun" ("eventId") WHERE status IN ('QUEUED', 'RUNNING');
