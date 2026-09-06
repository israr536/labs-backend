-- Backfill existing lab-specific Test rows from their TestDefinition catalog.
-- Existing TestParameter rows are preserved so existing ReportResult/OrderResult
-- foreign keys remain valid. Only missing parameters are inserted.

BEGIN;

-- Some older lab tests may have been created without catalogId. Restore the
-- catalog link from the stable test code where possible.
UPDATE "Test" AS t
SET "catalogId" = td."id"
FROM "TestDefinition" AS td
WHERE t."catalogId" IS NULL
  AND lower(trim(t."code")) = lower(trim(td."code"));

-- Copy every missing catalog parameter into the lab-specific test.
-- ON CONFLICT is intentionally target-less so this remains safe against any
-- unique constraint on TestParameter while preserving already-used rows.
INSERT INTO "TestParameter" (
  "id",
  "testId",
  "name",
  "inputType",
  "unit",
  "normalMin",
  "normalMax",
  "referenceRange",
  "options",
  "validation",
  "criticalLow",
  "criticalHigh",
  "decimalPlaces",
  "defaultValue",
  "formula",
  "displayOrder",
  "isRequired",
  "remarks",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  t."id",
  dp."name",
  dp."inputType",
  dp."unit",
  dp."normalMin",
  dp."normalMax",
  dp."referenceRange",
  dp."options",
  dp."validation",
  dp."criticalLow",
  dp."criticalHigh",
  dp."decimalPlaces",
  dp."defaultValue",
  dp."formula",
  dp."displayOrder",
  dp."isRequired",
  dp."remarks",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Test" AS t
JOIN "TestDefinition" AS td
  ON td."id" = t."catalogId"
JOIN "TestDefinitionParameter" AS dp
  ON dp."testDefinitionId" = td."id"
LEFT JOIN "TestParameter" AS existing
  ON existing."testId" = t."id"
 AND lower(trim(existing."name")) = lower(trim(dp."name"))
WHERE existing."id" IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
