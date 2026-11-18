-- Rollback for migration 20261118200000_gate_security (the previous API ignores these columns).
-- The TAMPERED enum value cannot be dropped in PostgreSQL without recreating the type; it is harmless to keep.
--   psql "$DATABASE_URL" -f prisma/rollbacks/20261118200000_gate_security.down.sql
--   npx prisma migrate resolve --rolled-back 20261118200000_gate_security
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "signingKey", DROP COLUMN IF EXISTS "signingKeyAt";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "deviceSigned";
