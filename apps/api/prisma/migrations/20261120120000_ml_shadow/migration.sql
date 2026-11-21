-- ML shadow mode (additive only): model registry, prediction log (rule decision + shadow output + attached
-- outcome), blind fraud-review sampling and review history. No existing table or column is changed.
-- Rollback: prisma/rollbacks/20261120120000_ml_shadow.down.sql
-- CreateEnum
CREATE TYPE "MlModelStatus" AS ENUM ('SHADOW', 'READY', 'ACTIVE', 'RETIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MlPredictionRole" AS ENUM ('RULES', 'SHADOW');

-- CreateEnum
CREATE TYPE "FraudReviewDecision" AS ENUM ('CONFIRMED_FRAUD', 'LEGITIMATE', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "FraudSampleCell" AS ENUM ('RULE_AND_ML', 'RULE_ONLY', 'ML_ONLY', 'NEITHER');

-- CreateTable
CREATE TABLE "MlModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "MlModelStatus" NOT NULL DEFAULT 'SHADOW',
    "mayServeDecisions" BOOLEAN NOT NULL DEFAULT false,
    "evaluationStatus" TEXT NOT NULL,
    "evaluation" JSONB NOT NULL,
    "features" JSONB,
    "shadowDecision" JSONB,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "MlModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlPrediction" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelId" TEXT,
    "role" "MlPredictionRole" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "eventId" TEXT,
    "userId" TEXT,
    "score" DOUBLE PRECISION,
    "decision" TEXT,
    "output" JSONB,
    "features" JSONB,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcomeLabel" DOUBLE PRECISION,
    "outcome" JSONB,
    "outcomeAt" TIMESTAMP(3),

    CONSTRAINT "MlPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudSample" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cell" "FraudSampleCell" NOT NULL,
    "selected" BOOLEAN NOT NULL,
    "inclusionProbability" DOUBLE PRECISION NOT NULL,
    "ruleDecision" TEXT,
    "ruleScore" DOUBLE PRECISION,
    "mlProbability" DOUBLE PRECISION,
    "mlWouldFlag" BOOLEAN NOT NULL,
    "modelId" TEXT,
    "rulePredictionId" TEXT,
    "shadowPredictionId" TEXT,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudReview" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "decision" "FraudReviewDecision" NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MlModel_name_status_idx" ON "MlModel"("name", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MlModel_name_sha256_key" ON "MlModel"("name", "sha256");

-- CreateIndex
CREATE INDEX "MlPrediction_modelName_createdAt_idx" ON "MlPrediction"("modelName", "createdAt");

-- CreateIndex
CREATE INDEX "MlPrediction_modelName_outcomeAt_idx" ON "MlPrediction"("modelName", "outcomeAt");

-- CreateIndex
CREATE INDEX "MlPrediction_subjectType_subjectId_idx" ON "MlPrediction"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "MlPrediction_eventId_idx" ON "MlPrediction"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "MlPrediction_modelName_role_subjectType_subjectId_key" ON "MlPrediction"("modelName", "role", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "FraudSample_orderId_key" ON "FraudSample"("orderId");

-- CreateIndex
CREATE INDEX "FraudSample_selected_cell_idx" ON "FraudSample"("selected", "cell");

-- CreateIndex
CREATE INDEX "FraudSample_sampledAt_idx" ON "FraudSample"("sampledAt");

-- CreateIndex
CREATE INDEX "FraudReview_sampleId_createdAt_idx" ON "FraudReview"("sampleId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudReview_orderId_idx" ON "FraudReview"("orderId");

-- CreateIndex
CREATE INDEX "FraudReview_decision_createdAt_idx" ON "FraudReview"("decision", "createdAt");

-- AddForeignKey
ALTER TABLE "MlPrediction" ADD CONSTRAINT "MlPrediction_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MlModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "FraudSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

