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

## Crystal Excel (Data Only) price-only import
Use this when the CSV export lacks complete prices, but Crystal `Excel (Data Only)` has full price rows.

Run migration for unit-level prices first:
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/011_add_sku_unit_prices.sql
```

Dry run:
```bash
node scripts/import_adapos_prices_from_excel_dataonly.js --file path/to/rpt_sql_allmpdtentryexceldataonly.xls
```

Commit in one transaction:
```bash
node scripts/import_adapos_prices_from_excel_dataonly.js --file path/to/rpt_sql_allmpdtentryexceldataonly.xls --commit --db-url "$DATABASE_URL"
```

Quick structure sanity check (no DB):
```bash
node scripts/import_adapos_prices_from_excel_dataonly.js --file path/to/rpt_sql_allmpdtentryexceldataonly.xls --check
```

The script always writes a run log under `logs/price_import_YYYYMMDD_HHMMSS.json`.

Unit-level behavior:
- Stores prices per `(sku_id, unit)` in `public.sku_unit_prices`.
- Stores optional tiers 2..8 per unit in `public.sku_unit_price_tiers`.
- Keeps legacy tables (`prices`, `sku_price_tiers`) updated from the first priced unit for backward compatibility.

## Notes
- Enrichment fields are not modified by price-only mode.
- Wholesale tiers are updated when numeric tier prices are present in CSV parse output.
- Barcode reassignment is blocked in `price-only` mode (conflicts are logged in summary counters).
- Admin API `POST /admin/import/prices` now supports both:
  - CSV (`source_format=csv` or auto-detected by file extension)
  - Crystal Excel Data Only (`.xls/.xlsx`, `source_format=excel-dataonly` or auto)
- For Excel Data Only source, `price_history=on` is not supported (current-price upsert only).
