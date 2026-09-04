# Laboratory Master Test Catalog

The catalog in `catalog.ts` is the application seed source for laboratory tests and result-entry parameters.

Each parameter supports:

- `NUMBER` for numeric results with `normalMin` / `normalMax` and units.
- `TEXT` for free-form findings such as microscopy, culture and pathology impressions.
- `SELECT` for controlled qualitative results such as Positive/Negative, blood group and compatibility.
- Optional `referenceRange` metadata for sex-specific or descriptive ranges.
- Optional `options` for controlled result choices.

## Seed

Use a lab-specific seed:

```bash
SEED_LAB_ID=<your-lab-id> npm run seed:tests
```

To seed every active lab explicitly:

```bash
SEED_ALL_LABS=true npm run seed:tests
```

The seeder is deliberately non-destructive for parameters already used by reports or orders. This protects historical results from a catalog update.

## Clinical data policy

Reference intervals in this repository are baseline master-data values for application development. They are not universal clinical decision limits. Before production use, the laboratory should validate and configure intervals for its analyzer, methodology, population, age/sex groups and SOP.

The catalog is intended to grow as a versioned master-data library rather than putting test definitions directly into application services.
