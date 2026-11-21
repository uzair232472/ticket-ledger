-- Rollback for migration 20261118140000_gate_sync_idempotency. The previous API ignores these columns, so this is
-- only needed to remove them. It discards scan ids (idempotency), device evidence, GateScan reversal marks
-- (reversed rows would count as admissions again: delete them first if that matters) and quarantined scans
-- (export them first: SELECT * FROM "QuarantinedScan").
-- Roll back newest first (gate_security, then gate_diagnostics, ...). Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261118140000_gate_sync_idempotency.down.sql
-- The script also removes the migration's _prisma_migrations record: `prisma migrate resolve --rolled-back`
-- only works for FAILED migrations, so without this `prisma migrate deploy` would report success and never
-- re-create what was dropped. Re-apply later with `npx prisma migrate deploy`.
-- Tested by prisma/rollbacks/test-rollbacks.sh (rollback, schema comparison, re-apply).
BEGIN;
DROP TABLE IF EXISTS "QuarantinedScan";
DROP TYPE IF EXISTS "QuarantineStatus";
DROP TYPE IF EXISTS "QuarantineReason";
DROP INDEX IF EXISTS "CheckIn_deviceRecordId_clientScanId_key";
DROP INDEX IF EXISTS "CheckIn_deviceRecordId_deviceSeq_idx";
DROP INDEX IF EXISTS "GateScan_checkInId_idx";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "clientScanId", DROP COLUMN IF EXISTS "deviceRecordId", DROP COLUMN IF EXISTS "deviceScannedAt", DROP COLUMN IF EXISTS "deviceSeq", DROP COLUMN IF EXISTS "localReason", DROP COLUMN IF EXISTS "localResult";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "lastSeqAcked";
ALTER TABLE "GateScan" DROP COLUMN IF EXISTS "checkInId", DROP COLUMN IF EXISTS "reversalReason", DROP COLUMN IF EXISTS "reversedAt", DROP COLUMN IF EXISTS "reversedById";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118140000_gate_sync_idempotency';
COMMIT;
