-- Rollback for migration 20261118180000_gate_diagnostics (the previous API ignores these).
--   psql "$DATABASE_URL" -f prisma/rollbacks/20261118180000_gate_diagnostics.down.sql
--   npx prisma migrate resolve --rolled-back 20261118180000_gate_diagnostics
DROP TABLE IF EXISTS "GateSyncBatch";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "appVersion", DROP COLUMN IF EXISTS "failedScans", DROP COLUMN IF EXISTS "deviceConflicts", DROP COLUMN IF EXISTS "stuckScans", DROP COLUMN IF EXISTS "oldestPendingAt", DROP COLUMN IF EXISTS "lastScanAt", DROP COLUMN IF EXISTS "storagePersisted", DROP COLUMN IF EXISTS "clockSkewMs", DROP COLUMN IF EXISTS "lastSyncError", DROP COLUMN IF EXISTS "lastSyncErrorAt", DROP COLUMN IF EXISTS "pendingManifest", DROP COLUMN IF EXISTS "manifestAt";
