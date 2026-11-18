-- Rollback for migration 20261118160000_gate_scan_conflicts. The previous API ignores these. Export conflicts first:
--   SELECT * FROM "ScanConflict";
--   psql "$DATABASE_URL" -f prisma/rollbacks/20261118160000_gate_scan_conflicts.down.sql
--   npx prisma migrate resolve --rolled-back 20261118160000_gate_scan_conflicts
DROP INDEX IF EXISTS "CheckIn_conflictId_idx";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "conflictId";
DROP TABLE IF EXISTS "ScanConflict";
DROP TYPE IF EXISTS "ScanConflictResolution";
DROP TYPE IF EXISTS "ScanConflictStatus";
DROP TYPE IF EXISTS "ScanConflictType";
