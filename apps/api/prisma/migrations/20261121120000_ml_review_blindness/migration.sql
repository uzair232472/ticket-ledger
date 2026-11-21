-- Blind fraud review: record, per review, whether the reviewer could have seen detector output for that
-- customer beforehand (fraud watchlist, investigations, account actions). Additive only: two nullable columns.
-- blind = true  : no detector exposure found -> the review is a label
-- blind = false : exposed -> kept in the history and reported separately, never used as a label
-- blind = NULL  : recorded before this check existed -> treated as not blind
-- Rollback: prisma/rollbacks/20261121120000_ml_review_blindness.down.sql
ALTER TABLE "FraudReview" ADD COLUMN "blind" BOOLEAN,
ADD COLUMN "exposure" JSONB;
