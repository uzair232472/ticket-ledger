-- Commit-time change log. The triggers of 20261122120000_ml_input_changes ran at STATEMENT time, so a change
-- made early in a long transaction (the app has transactions of up to 60 s) was logged with a time before it
-- became visible; a snapshot read after that commit could be marked exact although its inputs had changed
-- after the prediction moment. These triggers are deferred constraint triggers: they run at COMMIT, in the
-- same transaction as the change, so a change is logged at (just before) the moment it becomes visible.
-- Same functions, same columns watched. No table, column or row is changed.
-- Rollback: prisma/rollbacks/20261123120000_ml_input_changes_commit_time.down.sql
DROP TRIGGER "ml_event_input_change" ON "Event";
DROP TRIGGER "ml_tier_input_insert_delete" ON "TicketTier";
DROP TRIGGER "ml_tier_input_update" ON "TicketTier";
DROP TRIGGER "ml_gate_input_insert_delete" ON "EventGate";
DROP TRIGGER "ml_gate_input_update" ON "EventGate";

CREATE CONSTRAINT TRIGGER "ml_event_input_change" AFTER UPDATE ON "Event" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD."date" IS DISTINCT FROM NEW."date" OR OLD."time" IS DISTINCT FROM NEW."time"
     OR OLD."startsAt" IS DISTINCT FROM NEW."startsAt" OR OLD."endsAt" IS DISTINCT FROM NEW."endsAt"
     OR OLD."capacityLimit" IS DISTINCT FROM NEW."capacityLimit" OR OLD."type" IS DISTINCT FROM NEW."type"
     OR OLD."city" IS DISTINCT FROM NEW."city" OR OLD."salesOpenAt" IS DISTINCT FROM NEW."salesOpenAt"
     OR OLD."publishAt" IS DISTINCT FROM NEW."publishAt" OR OLD."approvedAt" IS DISTINCT FROM NEW."approvedAt"
     OR OLD."companyId" IS DISTINCT FROM NEW."companyId" OR OLD."cancelledAt" IS DISTINCT FROM NEW."cancelledAt")
  EXECUTE FUNCTION ml_note_event_change();
CREATE CONSTRAINT TRIGGER "ml_tier_input_insert_delete" AFTER INSERT OR DELETE ON "TicketTier" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ml_note_tier_change();
CREATE CONSTRAINT TRIGGER "ml_tier_input_update" AFTER UPDATE ON "TicketTier" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD."price" IS DISTINCT FROM NEW."price" OR OLD."totalQuantity" IS DISTINCT FROM NEW."totalQuantity"
     OR OLD."eventId" IS DISTINCT FROM NEW."eventId")
  EXECUTE FUNCTION ml_note_tier_change();
CREATE CONSTRAINT TRIGGER "ml_gate_input_insert_delete" AFTER INSERT OR DELETE ON "EventGate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ml_note_gate_change();
CREATE CONSTRAINT TRIGGER "ml_gate_input_update" AFTER UPDATE ON "EventGate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD."capacityPerHour" IS DISTINCT FROM NEW."capacityPerHour" OR OLD."active" IS DISTINCT FROM NEW."active"
     OR OLD."eventId" IS DISTINCT FROM NEW."eventId")
  EXECUTE FUNCTION ml_note_gate_change();
