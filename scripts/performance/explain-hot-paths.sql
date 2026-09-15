-- Run against a staging database with representative fixture data.
-- Replace the UUID variables before running:
-- psql "$DATABASE_URL" -v lab_id="'...uuid...'" -f scripts/performance/explain-hot-paths.sql
\set ON_ERROR_STOP on
\timing on

\echo 'Order list: unfiltered tenant page'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT o."id", o."orderNumber", o."status", o."createdAt",
       p."id", p."name", p."mobile", count(oi."id") AS "testCount"
FROM "LabOrder" o
JOIN "Patient" p ON p."id" = o."patientId"
LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
WHERE o."labId" = :lab_id::uuid
GROUP BY o."id", p."id"
ORDER BY o."createdAt" DESC
LIMIT 50;

\echo 'Order list: tenant search'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT o."id", o."orderNumber", o."status", o."createdAt", p."name", p."mobile"
FROM "LabOrder" o
JOIN "Patient" p ON p."id" = o."patientId"
WHERE o."labId" = :lab_id::uuid
  AND (o."orderNumber" ILIKE '%PERF%' OR p."name" ILIKE '%Performance%' OR p."mobile" ILIKE '%900%')
ORDER BY o."createdAt" DESC
LIMIT 50;

\echo 'Patient type-ahead search'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT "id", "name", "age", "gender", "mobile", "email", "createdAt"
FROM "Patient"
WHERE "labId" = :lab_id::uuid
  AND ("name" ILIKE '%Performance%' OR "mobile" ILIKE '%900%' OR "email" ILIKE '%perf%')
ORDER BY "createdAt" DESC
LIMIT 50;

\echo 'Dashboard aggregate'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT COUNT(*)::bigint AS "totalReports",
       COUNT(*) FILTER (WHERE "status" = 'FINAL'::"OrderStatus")::bigint AS "completedReports",
       COUNT(*) FILTER (WHERE "status" NOT IN ('FINAL'::"OrderStatus", 'CANCELLED'::"OrderStatus"))::bigint AS "pendingReports"
FROM "LabOrder"
WHERE "labId" = :lab_id::uuid;

\echo 'Critical-result queue'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT COUNT(*)
FROM "CriticalResult"
WHERE "labId" = :lab_id::uuid AND "isCurrent" = true AND "status" IN ('PENDING', 'NOTIFIED');

\echo 'Reference-range lookup'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT "id", "parameterId", "version", "gender", "ageMinYears", "ageMaxYears", "method", "analyzer", "low", "high", "effectiveFrom", "effectiveTo"
FROM "TestParameterReferenceRange"
WHERE "parameterId" IN (SELECT "id" FROM "TestParameter" LIMIT 25)
  AND "effectiveFrom" <= CURRENT_TIMESTAMP
  AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP);
