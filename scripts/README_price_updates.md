# Monthly AdaPos Price Updates

## Audit summary
Current importer behavior now has two explicit modes:

- `--mode full`:
  - Re-applies product metadata upserts (`items` + `skus`) and pricing updates.
  - This is idempotent but can overwrite non-price metadata (name/category/supplier/avg_cost/product_kind) from the latest file.
- `--mode price-only`:
  - For existing SKUs, does not overwrite non-price metadata.
  - Still updates retail/wholesale prices.
  - Still inserts missing records for new SKUs.

Default remains `--mode full` to preserve backward compatibility.

## New SKU insertion behavior
- In both modes, if `company_code` (AdaPos SKU code) is missing in DB:
  - create minimal `items` record (POS-linked by `source_company_code`)
  - create `skus` record
  - insert barcode when available
- In `price-only`, existing SKU metadata is not touched.

## Retail price semantics
- `--price-history off` (default):
  - Updates current active row in `public.prices` for `(sku_id, currency='THB')`.
  - If no active row exists, inserts one.
- `--price-history on`:
  - If current active row has same price, no change.
  - Otherwise, closes active row(s) with `effective_end = now()`, then inserts new active row.
  - Implemented by importer logic (no new DB constraint added).

## Recommended monthly workflow (safe)
1. Dry run first:
```bash
node scripts/import_adapos_csv.js --file path/to/monthly_adapos.csv --mode price-only --price-history off --dry-run
```
2. Commit price-only update:
```bash
node scripts/import_adapos_csv.js --file path/to/monthly_adapos.csv --mode price-only --price-history off --commit --db-url "$DATABASE_URL"
```
3. If you need retail history snapshots:
```bash
node scripts/import_adapos_csv.js --file path/to/monthly_adapos.csv --mode price-only --price-history on --commit --db-url "$DATABASE_URL"
```

## Notes
- Enrichment fields are not modified by price-only mode.
- Wholesale tiers are updated when numeric tier prices are present in CSV parse output.
- Barcode reassignment is blocked in `price-only` mode (conflicts are logged in summary counters).
