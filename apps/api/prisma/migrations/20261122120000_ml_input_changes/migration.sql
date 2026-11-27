-- Prediction-snapshot integrity. Triggers record, in the same transaction as the change, every change to an
-- event's model inputs: event details (schedule, capacity, type, city, sales-open times, organizer,
-- cancellation), its tiers (price, quantity, added or removed) and its gates (capacity, active, added or
-- removed). Ticket sales (availableQuantity) are not inputs and are not recorded.
-- The prediction logger checks this log right after reading a prediction's inputs: a change to that event
-- since the prediction's reference moment marks the snapshot as not exact, and training leaves it out.
-- Additive only: one table, three functions, seven triggers. No existing row or column is changed.
-- Rollback: prisma/rollbacks/20261122120000_ml_input_changes.down.sql
CREATE TABLE "MlInputChange" (
    "id" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
    CONSTRAINT "MlInputChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MlInputChange_eventId_changedAt_idx" ON "MlInputChange"("eventId", "changedAt");
CREATE INDEX "MlInputChange_changedAt_idx" ON "MlInputChange"("changedAt");

CREATE FUNCTION ml_note_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "MlInputChange" ("eventId", "source") VALUES (NEW."id", 'Event');
  RETURN NULL;
END $$;

CREATE FUNCTION ml_note_tier_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "MlInputChange" ("eventId", "source") VALUES (OLD."eventId", 'TicketTier');
  ELSE
    INSERT INTO "MlInputChange" ("eventId", "source") VALUES (NEW."eventId", 'TicketTier');
    IF TG_OP = 'UPDATE' AND OLD."eventId" IS DISTINCT FROM NEW."eventId" THEN
      INSERT INTO "MlInputChange" ("eventId", "source") VALUES (OLD."eventId", 'TicketTier');
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION ml_note_gate_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "MlInputChange" ("eventId", "source") VALUES (OLD."eventId", 'EventGate');
  ELSE
    INSERT INTO "MlInputChange" ("eventId", "source") VALUES (NEW."eventId", 'EventGate');
    IF TG_OP = 'UPDATE' AND OLD."eventId" IS DISTINCT FROM NEW."eventId" THEN
      INSERT INTO "MlInputChange" ("eventId", "source") VALUES (OLD."eventId", 'EventGate');
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "ml_event_input_change" AFTER UPDATE ON "Event" FOR EACH ROW
  WHEN (OLD."date" IS DISTINCT FROM NEW."date" OR OLD."time" IS DISTINCT FROM NEW."time"
     OR OLD."startsAt" IS DISTINCT FROM NEW."startsAt" OR OLD."endsAt" IS DISTINCT FROM NEW."endsAt"
     OR OLD."capacityLimit" IS DISTINCT FROM NEW."capacityLimit" OR OLD."type" IS DISTINCT FROM NEW."type"
     OR OLD."city" IS DISTINCT FROM NEW."city" OR OLD."salesOpenAt" IS DISTINCT FROM NEW."salesOpenAt"
     OR OLD."publishAt" IS DISTINCT FROM NEW."publishAt" OR OLD."approvedAt" IS DISTINCT FROM NEW."approvedAt"
     OR OLD."companyId" IS DISTINCT FROM NEW."companyId" OR OLD."cancelledAt" IS DISTINCT FROM NEW."cancelledAt")
  EXECUTE FUNCTION ml_note_event_change();
CREATE TRIGGER "ml_tier_input_insert_delete" AFTER INSERT OR DELETE ON "TicketTier" FOR EACH ROW EXECUTE FUNCTION ml_note_tier_change();
CREATE TRIGGER "ml_tier_input_update" AFTER UPDATE ON "TicketTier" FOR EACH ROW
  WHEN (OLD."price" IS DISTINCT FROM NEW."price" OR OLD."totalQuantity" IS DISTINCT FROM NEW."totalQuantity"
     OR OLD."eventId" IS DISTINCT FROM NEW."eventId")
  EXECUTE FUNCTION ml_note_tier_change();
CREATE TRIGGER "ml_gate_input_insert_delete" AFTER INSERT OR DELETE ON "EventGate" FOR EACH ROW EXECUTE FUNCTION ml_note_gate_change();
CREATE TRIGGER "ml_gate_input_update" AFTER UPDATE ON "EventGate" FOR EACH ROW
  WHEN (OLD."capacityPerHour" IS DISTINCT FROM NEW."capacityPerHour" OR OLD."active" IS DISTINCT FROM NEW."active"
     OR OLD."eventId" IS DISTINCT FROM NEW."eventId")
  EXECUTE FUNCTION ml_note_gate_change();
