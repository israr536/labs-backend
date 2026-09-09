-- Align the physical Test/TestParameter tables with prisma/schema.prisma.
-- Earlier migrations created a smaller Test shape; the application now relies
-- on the catalog fields below.

ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "shortName" TEXT;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "sampleType" TEXT;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "tat" INTEGER;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "remarks" TEXT;

UPDATE "Test"
SET "code" = 'LEGACY-' || "id"
WHERE "code" IS NULL OR trim("code") = '';

ALTER TABLE "Test" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Test_labId_code_key" ON "Test"("labId", "code");

ALTER TABLE "TestParameter" ADD COLUMN IF NOT EXISTS "referenceRange" JSONB;
ALTER TABLE "TestParameter" ADD COLUMN IF NOT EXISTS "options" JSONB;
ALTER TABLE "TestParameter" ADD COLUMN IF NOT EXISTS "remarks" TEXT;
ALTER TABLE "TestParameter" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
