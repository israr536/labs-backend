-- Versioned, lab-specific clinical reference ranges.
-- A range is immutable once created; new clinical definitions are represented by a new version.
-- IDs are TEXT because the existing Prisma models use TEXT primary keys.
CREATE TABLE "TestParameterReferenceRange" (
  "id" TEXT NOT NULL,
  "parameterId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "gender" "Gender",
  "ageMinYears" DECIMAL(7,2),
  "ageMaxYears" DECIMAL(7,2),
  "method" TEXT,
  "analyzer" TEXT,
  "low" DOUBLE PRECISION,
  "high" DOUBLE PRECISION,
  "displayRange" TEXT,
  "unit" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestParameterReferenceRange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestParameterReferenceRange_parameterId_fkey"
    FOREIGN KEY ("parameterId") REFERENCES "TestParameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TestParameterReferenceRange_version_check" CHECK ("version" > 0),
  CONSTRAINT "TestParameterReferenceRange_age_check" CHECK (
    "ageMinYears" IS NULL OR "ageMaxYears" IS NULL OR "ageMinYears" <= "ageMaxYears"
  ),
  CONSTRAINT "TestParameterReferenceRange_numeric_check" CHECK (
    ("low" IS NULL OR "high" IS NULL OR "low" <= "high")
  ),
  CONSTRAINT "TestParameterReferenceRange_effective_check" CHECK (
    "effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"
  )
);

CREATE UNIQUE INDEX "TestParameterReferenceRange_parameterId_version_key"
  ON "TestParameterReferenceRange"("parameterId", "version");
CREATE INDEX "TestParameterReferenceRange_parameterId_effectiveFrom_idx"
  ON "TestParameterReferenceRange"("parameterId", "effectiveFrom");
CREATE INDEX "TestParameterReferenceRange_parameterId_gender_idx"
  ON "TestParameterReferenceRange"("parameterId", "gender");

ALTER TABLE "OrderResult"
  ADD COLUMN "referenceRangeId" TEXT,
  ADD COLUMN "referenceRangeSnapshot" JSONB;

ALTER TABLE "OrderResult"
  ADD CONSTRAINT "OrderResult_referenceRangeId_fkey"
  FOREIGN KEY ("referenceRangeId") REFERENCES "TestParameterReferenceRange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "OrderResult_referenceRangeId_idx"
  ON "OrderResult"("referenceRangeId");
