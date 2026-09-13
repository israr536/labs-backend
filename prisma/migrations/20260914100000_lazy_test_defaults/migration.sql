-- Keep existing lab-owned test rows compatible while allowing one lazy
-- user-scoped materialization per lab/test code.
ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "scopeId" TEXT;

UPDATE "Test"
SET "scopeId" = "labId"
WHERE "scopeId" IS NULL;

ALTER TABLE "Test" ALTER COLUMN "scopeId" SET NOT NULL;

DROP INDEX IF EXISTS "Test_labId_code_key";
CREATE INDEX IF NOT EXISTS "Test_labId_scopeId_idx" ON "Test"("labId", "scopeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Test_labId_scopeId_code_key" ON "Test"("labId", "scopeId", "code");
