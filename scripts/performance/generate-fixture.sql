-- Performance fixture generator for staging only. Run with psql after migrations:
--   psql "$DATABASE_URL" -v lab_id="'...uuid...'" -v user_id="'...uuid...'" -v test_id="'...uuid...'" -f scripts/performance/generate-fixture.sql
-- This intentionally creates synthetic data and must never be run against production.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE perf_fixture AS
SELECT gen_random_uuid() AS patient_id,
       :'lab_id'::uuid AS lab_id,
       format('Performance Patient %s', row_number() OVER ()) AS name,
       ((row_number() OVER () % 80) + 1)::int AS age,
       CASE WHEN row_number() OVER () % 2 = 0 THEN 'MALE' ELSE 'FEMALE' END AS gender,
       format('900%07s', row_number() OVER ()) AS mobile
FROM generate_series(1, 10000);

INSERT INTO "Patient" ("id", "labId", "name", "age", "gender", "mobile", "createdAt", "updatedAt")
SELECT patient_id, lab_id, name, age, gender::"Gender", mobile, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM perf_fixture
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LabOrder" ("id", "labId", "patientId", "orderNumber", "status", "revision", "createdById", "orderedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), lab_id, patient_id,
       format('PERF-%s-%s', to_char(current_date, 'YYYYMMDD'), lpad(row_number() OVER ()::text, 7, '0')),
       CASE WHEN row_number() OVER () % 5 = 0 THEN 'FINAL'::"OrderStatus" ELSE 'REGISTERED'::"OrderStatus" END,
       0, :'user_id'::uuid, CURRENT_TIMESTAMP - ((row_number() OVER () % 365) || ' days')::interval,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM perf_fixture
-- The generated order number is deterministic for the fixture date and row, so reruns
-- remain safe on the lab-scoped unique key.
ON CONFLICT ("labId", "orderNumber") DO NOTHING;

COMMIT;

\echo 'Created 10,000 synthetic patients and 10,000 synthetic orders.'
\echo 'Repeat with adjusted generate_series bounds for 1,000 or 100,000 datasets.'
\echo 'The test_id variable is reserved for extending this fixture with order items/results.'

DROP TABLE perf_fixture;
