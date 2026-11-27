-- Event reminder emails (services/eventReminderJob.js): one row per person per reminder sent, so the same
-- reminder is never sent twice (also safe with several servers). New table only; nothing existing changes.

-- CreateTable
CREATE TABLE "EventReminderDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventReminderDelivery_eventId_userId_kind_key" ON "EventReminderDelivery"("eventId", "userId", "kind");

-- CreateIndex
CREATE INDEX "EventReminderDelivery_eventId_kind_idx" ON "EventReminderDelivery"("eventId", "kind");
