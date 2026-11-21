-- Rollback for migration 20261118200000_gate_security (the previous API ignores these columns).
-- Roll back newest first (this one is the newest gate migration). Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261118200000_gate_security.down.sql
-- PostgreSQL cannot drop one enum value, so "QuarantineReason" is recreated without TAMPERED. The script stops
-- (and changes nothing) if any quarantined scan still has reason TAMPERED: export and review those first:
--   SELECT * FROM "QuarantinedScan" WHERE "reason" = 'TAMPERED';
-- Dropping deviceSigned / signingKey discards signed-scan evidence and device signing keys (devices get new
-- keys when the newer backend is deployed again).
-- The script also removes the migration's _prisma_migrations record: `prisma migrate resolve --rolled-back`
-- only works for FAILED migrations, so without this `prisma migrate deploy` would report success and never
-- re-create what was dropped. Re-apply later with `npx prisma migrate deploy`.
-- Tested by prisma/rollbacks/test-rollbacks.sh (rollback, schema comparison, re-apply).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "QuarantinedScan" WHERE "reason"::text = 'TAMPERED') THEN
    RAISE EXCEPTION 'QuarantinedScan rows with reason TAMPERED exist: export them and change or delete them before rolling back';
  END IF;
END $$;
ALTER TYPE "QuarantineReason" RENAME TO "QuarantineReason_old";
CREATE TYPE "QuarantineReason" AS ENUM ('DEVICE_REVOKED', 'ACCESS_REMOVED', 'INVALID');
ALTER TABLE "QuarantinedScan" ALTER COLUMN "reason" TYPE "QuarantineReason" USING ("reason"::text::"QuarantineReason");
DROP TYPE "QuarantineReason_old";
ALTER TABLE "GateDevice" DROP COLUMN IF EXISTS "signingKey", DROP COLUMN IF EXISTS "signingKeyAt";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "deviceSigned";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118200000_gate_security';
COMMIT;
