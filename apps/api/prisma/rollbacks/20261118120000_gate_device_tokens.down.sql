-- Rollback for migration 20261118120000_gate_device_tokens.
-- Only needed if the backend is rolled back to a version before device tokens. Set GATE_DEVICE_AUTH=off first
-- (scanners keep working with their device id), deploy the previous backend, then run:
-- Dropping these columns discards issued device tokens: devices re-enroll automatically when re-deployed.
-- Roll back newest first (gate_security, then gate_diagnostics, ...). Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261118120000_gate_device_tokens.down.sql
-- The script also removes the migration's _prisma_migrations record: `prisma migrate resolve --rolled-back`
-- only works for FAILED migrations, so without this `prisma migrate deploy` would report success and never
-- re-create what was dropped. Re-apply later with `npx prisma migrate deploy`.
-- Tested by prisma/rollbacks/test-rollbacks.sh (rollback, schema comparison, re-apply).
BEGIN;
DROP INDEX IF EXISTS "GateDevice_tokenHash_key";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "tokenHash";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "tokenIssuedAt";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "enrolledById";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "legacyRequests";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "lastLegacyAt";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "authFailures";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "lastAuthFailureAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118120000_gate_device_tokens';
COMMIT;
