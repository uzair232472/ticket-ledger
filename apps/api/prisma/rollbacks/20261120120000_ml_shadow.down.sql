-- Rollback for migration 20261120120000_ml_shadow (the previous API never reads these tables).
-- Deletes the shadow prediction log, fraud samples and review history. Back up those tables first:
--   pg_dump -Fc -t '"MlModel"' -t '"MlPrediction"' -t '"FraudSample"' -t '"FraudReview"' -d <db> -f ml_shadow_tables.dump
--   psql -v ON_ERROR_STOP=1 -d <db> -f prisma/rollbacks/20261120120000_ml_shadow.down.sql
-- Then deploy the previous API version. To restore later: npx prisma migrate deploy (re-applies it), then
-- restore the tables one at a time, parents first (a single pg_restore loads FraudReview before FraudSample
-- and fails on the foreign key):
--   for t in MlModel MlPrediction FraudSample FraudReview; do pg_restore --data-only -t "$t" -d <db> ml_shadow_tables.dump; done
--
-- Note: `prisma migrate resolve --rolled-back` only works for FAILED migrations. For an applied one, its
-- record in _prisma_migrations must be removed (below) or Prisma keeps treating it as applied and never
-- re-creates the tables. Verified on a database copy, 2026-11-20.
BEGIN;
DROP TABLE IF EXISTS "FraudReview";
DROP TABLE IF EXISTS "FraudSample";
DROP TABLE IF EXISTS "MlPrediction";
DROP TABLE IF EXISTS "MlModel";
DROP TYPE IF EXISTS "FraudSampleCell";
DROP TYPE IF EXISTS "FraudReviewDecision";
DROP TYPE IF EXISTS "MlPredictionRole";
DROP TYPE IF EXISTS "MlModelStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261120120000_ml_shadow';
COMMIT;
