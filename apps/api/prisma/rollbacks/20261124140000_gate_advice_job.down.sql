-- Rollback for migration 20261124140000_gate_advice_job: drops the gate advice job tables (the run history and
-- the per-person delivery record). In-app notifications and emails already sent are kept.
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261124140000_gate_advice_job.down.sql
-- Removes the _prisma_migrations record too, so `npx prisma migrate deploy` can re-apply it later.
-- Tested by prisma/rollbacks/test-rollbacks.sh.
BEGIN;
DROP TABLE IF EXISTS "GateAdviceDelivery";
DROP TABLE IF EXISTS "GateAdviceRun";
DROP TYPE IF EXISTS "GateAdviceRunStatus";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261124140000_gate_advice_job';
COMMIT;
