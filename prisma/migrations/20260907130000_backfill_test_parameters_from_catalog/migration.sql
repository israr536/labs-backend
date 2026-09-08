-- Backfill existing lab-specific Test rows from their TestDefinition catalog.
-- Keep this migration compatible with the original Test table, which did not
-- contain a stable code column. Existing tests without catalogId are preserved.

-- Copy every missing catalog parameter into the lab-specific test.
-- Existing TestParameter rows are preserved so existing OrderResult/ReportResult
-- foreign keys remain valid.
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
