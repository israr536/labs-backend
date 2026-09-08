-- Backfill existing lab-specific Test rows from their TestDefinition catalog.
-- This migration intentionally uses only TestParameter columns that existed
-- before the catalog migration chain, keeping fresh-database migration safe.

INSERT INTO "TestParameter" (
  "id",
  "testId",
  "name",
  "inputType",
  "unit",
  "normalMin",
  "normalMax",
  "displayOrder",
  "isRequired",
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
  dp."displayOrder",
  dp."isRequired",
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
