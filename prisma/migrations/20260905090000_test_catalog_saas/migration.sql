CREATE TYPE "ParameterInputType_new" AS ENUM ('NUMBER', 'TEXT', 'SELECT', 'MULTILINE_TEXT', 'BOOLEAN', 'DATE', 'DATETIME', 'TIME', 'PERCENTAGE', 'QUALITATIVE');
ALTER TABLE "TestParameter" ALTER COLUMN "inputType" DROP DEFAULT;
ALTER TABLE "TestParameter" ALTER COLUMN "inputType" TYPE "ParameterInputType_new" USING ("inputType"::text::"ParameterInputType_new");
ALTER TABLE "TestParameter" ALTER COLUMN "inputType" SET DEFAULT 'NUMBER';
DROP TYPE "ParameterInputType";
ALTER TYPE "ParameterInputType_new" RENAME TO "ParameterInputType";

CREATE TABLE "TestDefinition" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "shortName" TEXT,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "specimenType" TEXT,
  "container" TEXT,
  "method" TEXT,
  "tat" INTEGER,
  "fasting" BOOLEAN NOT NULL DEFAULT false,
  "sampleHandling" TEXT,
  "stability" TEXT,
  "rejectionCriteria" TEXT,
  "description" TEXT,
  "synonyms" JSONB,
  "externalCodes" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestDefinition_code_key" ON "TestDefinition"("code");
CREATE INDEX "TestDefinition_category_idx" ON "TestDefinition"("category");
CREATE INDEX "TestDefinition_department_idx" ON "TestDefinition"("department");
CREATE INDEX "TestDefinition_name_idx" ON "TestDefinition"("name");
CREATE INDEX "TestDefinition_isActive_idx" ON "TestDefinition"("isActive");

CREATE TABLE "TestDefinitionParameter" (
  "id" TEXT NOT NULL,
  "testDefinitionId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT,
  "inputType" "ParameterInputType" NOT NULL DEFAULT 'NUMBER',
  "unit" TEXT,
  "normalMin" DOUBLE PRECISION,
  "normalMax" DOUBLE PRECISION,
  "referenceRange" JSONB,
  "options" JSONB,
  "validation" JSONB,
  "criticalLow" DOUBLE PRECISION,
  "criticalHigh" DOUBLE PRECISION,
  "decimalPlaces" INTEGER,
  "defaultValue" TEXT,
  "formula" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "remarks" TEXT,
  CONSTRAINT "TestDefinitionParameter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestDefinitionParameter_testDefinitionId_code_key" ON "TestDefinitionParameter"("testDefinitionId", "code");
CREATE INDEX "TestDefinitionParameter_testDefinitionId_displayOrder_idx" ON "TestDefinitionParameter"("testDefinitionId", "displayOrder");
ALTER TABLE "TestDefinitionParameter" ADD CONSTRAINT "TestDefinitionParameter_testDefinitionId_fkey" FOREIGN KEY ("testDefinitionId") REFERENCES "TestDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Test" ADD COLUMN "catalogId" TEXT;
CREATE INDEX "Test_labId_catalogId_idx" ON "Test"("labId", "catalogId");
ALTER TABLE "Test" ADD CONSTRAINT "Test_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "TestDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TestParameter" ADD COLUMN "validation" JSONB;
ALTER TABLE "TestParameter" ADD COLUMN "criticalLow" DOUBLE PRECISION;
ALTER TABLE "TestParameter" ADD COLUMN "criticalHigh" DOUBLE PRECISION;
ALTER TABLE "TestParameter" ADD COLUMN "decimalPlaces" INTEGER;
ALTER TABLE "TestParameter" ADD COLUMN "defaultValue" TEXT;
ALTER TABLE "TestParameter" ADD COLUMN "formula" TEXT;
