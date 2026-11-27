-- Rollback for migration 20261118180000_gate_diagnostics (the previous API ignores these).
-- Roll back newest first (gate_security, then gate_diagnostics, ...). Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261118180000_gate_diagnostics.down.sql
-- The script also removes the migration's _prisma_migrations record: `prisma migrate resolve --rolled-back`
-- only works for FAILED migrations, so without this `prisma migrate deploy` would report success and never
-- re-create what was dropped. Re-apply later with `npx prisma migrate deploy`.
-- Tested by prisma/rollbacks/test-rollbacks.sh (rollback, schema comparison, re-apply).
BEGIN;
DROP TABLE IF EXISTS "GateSyncBatch";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "appVersion", DROP COLUMN IF EXISTS "failedScans", DROP COLUMN IF EXISTS "deviceConflicts", DROP COLUMN IF EXISTS "stuckScans", DROP COLUMN IF EXISTS "oldestPendingAt", DROP COLUMN IF EXISTS "lastScanAt", DROP COLUMN IF EXISTS "storagePersisted", DROP COLUMN IF EXISTS "clockSkewMs", DROP COLUMN IF EXISTS "lastSyncError", DROP COLUMN IF EXISTS "lastSyncErrorAt", DROP COLUMN IF EXISTS "pendingManifest", DROP COLUMN IF EXISTS "manifestAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118180000_gate_diagnostics';
COMMIT;
