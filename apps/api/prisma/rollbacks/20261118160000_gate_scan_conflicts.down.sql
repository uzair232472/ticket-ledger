-- Rollback for migration 20261118160000_gate_scan_conflicts. The previous API ignores these. Export conflicts first:
--   SELECT * FROM "ScanConflict";
-- Roll back newest first (gate_security, then gate_diagnostics, ...). Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261118160000_gate_scan_conflicts.down.sql
-- The script also removes the migration's _prisma_migrations record: `prisma migrate resolve --rolled-back`
-- only works for FAILED migrations, so without this `prisma migrate deploy` would report success and never
-- re-create what was dropped. Re-apply later with `npx prisma migrate deploy`.
-- Tested by prisma/rollbacks/test-rollbacks.sh (rollback, schema comparison, re-apply).
BEGIN;
DROP INDEX IF EXISTS "CheckIn_conflictId_idx";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "conflictId";
DROP TABLE IF EXISTS "ScanConflict";
DROP TYPE IF EXISTS "ScanConflictResolution";
DROP TYPE IF EXISTS "ScanConflictStatus";
DROP TYPE IF EXISTS "ScanConflictType";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118160000_gate_scan_conflicts';
COMMIT;
