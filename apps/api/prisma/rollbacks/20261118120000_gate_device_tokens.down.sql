-- Rollback for migration 20261118120000_gate_device_tokens.
-- Only needed if the backend is rolled back to a version before device tokens. Set GATE_DEVICE_AUTH=off first
-- (scanners keep working with their device id), deploy the previous backend, then run:
--   psql "$DATABASE_URL" -f prisma/rollbacks/20261118120000_gate_device_tokens.down.sql
--   npx prisma migrate resolve --rolled-back 20261118120000_gate_device_tokens
-- Dropping these columns discards issued device tokens: devices re-enroll automatically when re-deployed.
DROP INDEX IF EXISTS "GateDevice_tokenHash_key";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "tokenHash";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "tokenIssuedAt";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "enrolledById";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "legacyRequests";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "lastLegacyAt";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "authFailures";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "lastAuthFailureAt";
