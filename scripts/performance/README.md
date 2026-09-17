# Staging performance kit

These scripts provide the repository-side portion of the performance plan. They must be run only against an anonymized staging PostgreSQL database after all migrations have been applied.

## Migration gate

Run the following from the backend root:

```bash
DATABASE_URL='postgresql://…/staging' npx prisma migrate deploy
DATABASE_URL='postgresql://…/staging' npx prisma migrate status
```

The migration check must complete from a clean database, including the `CriticalResult` and `CriticalNotificationAttempt` tables.

## Synthetic fixture

Create a staging-only lab, user, and enabled test first. Then run:

```bash
psql "$DATABASE_URL" \
  -v lab_id="'LAB_UUID'" \
  -v user_id="'USER_UUID'" \
  -v test_id="'TEST_UUID'" \
  -f scripts/performance/generate-fixture.sql
```

The default fixture creates 10,000 patients and 10,000 orders. Change both `generate_series(1, 10000)` bounds to produce 1,000 or 100,000 datasets. The script is deliberately synthetic and should not be executed against production.

## Query plans

Run the hot-path pack and save the JSON output for comparison:

```bash
psql "$DATABASE_URL" -v lab_id="'LAB_UUID'" \
  -f scripts/performance/explain-hot-paths.sql \
  > performance-explain-$(date +%Y%m%d-%H%M%S).log
```

The saved evidence should be compared before and after indexes. Search plans should be checked for tenant isolation, bounded rows, and index usage. If substring search remains mandatory and sequential scans dominate, evaluate `pg_trgm` indexes in a separate migration after measuring write overhead.

## Application metrics

The backend emits structured `http.performance` log records containing `requestId`, route, status, duration, and response bytes when available. Collect these logs during representative sessions and calculate p50/p95/p99 by route. For database statement count and transaction duration, enable PostgreSQL statement logging or a staging query-statistics extension and correlate using the request ID in application logs.

Starting budgets from the implementation plan are:

| Operation | p95 target |
|---|---:|
| Dashboard summary | < 300 ms server time |
| Report editor catalog | < 500 ms, one request |
| Order list page | < 300 ms server time |
| Open medium order | < 500 ms server time |
| Save 25 results | < 750 ms server time |
| Verify results | < 500 ms server time |
| Finalize report | < 1,000 ms excluding asynchronous audit work |
| Initial frontend route | < 500 KB minified |

Record request count, response bytes, database statement count, transaction duration, p95 latency, initial bundle size, and browser heap after a representative workspace session.
