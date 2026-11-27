-- Rollback for migration 20261121120000_ml_review_blindness. Discards each review's blindness record: every
-- review then counts as "not known to be blind" again (the previous API did not read these columns).
-- Roll back before 20261120120000_ml_shadow. Run it as one transaction:
--   psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f prisma/rollbacks/20261121120000_ml_review_blindness.down.sql
-- Removes the _prisma_migrations record too, so `npx prisma migrate deploy` can re-apply it later.
-- Tested by prisma/rollbacks/test-rollbacks.sh.
BEGIN;
ALTER TABLE "FraudReview" DROP COLUMN IF EXISTS "blind", 
DROP COLUMN IF EXISTS "exposure";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261121120000_ml_review_blindness';
COMMIT;
