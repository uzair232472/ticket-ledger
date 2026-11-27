-- Rollback for migration 20261122120000_ml_input_changes. Removes the change log and its triggers: snapshots
-- logged afterwards are marked "integrity check unavailable" and are never used for training.
-- Roll back before 20261121120000_ml_review_blindness. Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261122120000_ml_input_changes.down.sql
-- Removes the _prisma_migrations record too, so `npx prisma migrate deploy` can re-apply it later.
-- Tested by prisma/rollbacks/test-rollbacks.sh.
BEGIN;
DROP TRIGGER IF EXISTS "ml_event_input_change" ON "Event";
DROP TRIGGER IF EXISTS "ml_tier_input_insert_delete" ON "TicketTier";
DROP TRIGGER IF EXISTS "ml_tier_input_update" ON "TicketTier";
DROP TRIGGER IF EXISTS "ml_gate_input_insert_delete" ON "EventGate";
DROP TRIGGER IF EXISTS "ml_gate_input_update" ON "EventGate";
DROP FUNCTION IF EXISTS ml_note_event_change();
DROP FUNCTION IF EXISTS ml_note_tier_change();
DROP FUNCTION IF EXISTS ml_note_gate_change();
DROP TABLE IF EXISTS "MlInputChange";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261122120000_ml_input_changes';
COMMIT;
