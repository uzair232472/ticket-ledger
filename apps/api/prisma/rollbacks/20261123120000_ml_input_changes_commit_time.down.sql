-- Rollback for migration 20261123120000_ml_input_changes_commit_time: back to the statement-time triggers of
-- 20261122120000_ml_input_changes. Snapshots logged afterwards are marked "commit-time change log not
-- installed" (not exact) and are never used for training.
-- Roll back before 20261122120000_ml_input_changes. Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261123120000_ml_input_changes_commit_time.down.sql
-- Removes the _prisma_migrations record too, so `npx prisma migrate deploy` can re-apply it later.
-- Tested by prisma/rollbacks/test-rollbacks.sh.
BEGIN;
DROP TRIGGER IF EXISTS "ml_event_input_change" ON "Event";
DROP TRIGGER IF EXISTS "ml_tier_input_insert_delete" ON "TicketTier";
DROP TRIGGER IF EXISTS "ml_tier_input_update" ON "TicketTier";
DROP TRIGGER IF EXISTS "ml_gate_input_insert_delete" ON "EventGate";
DROP TRIGGER IF EXISTS "ml_gate_input_update" ON "EventGate";
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
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261123120000_ml_input_changes_commit_time';
COMMIT;
