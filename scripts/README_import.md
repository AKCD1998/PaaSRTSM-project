# AdaPos CSV Importer

## Why Node importer (instead of staging SQL first)
AdaPos rows are messy and include repeated report/header columns. The parsing step needs row-level heuristics (find 9-digit SKU first, then map nearby values). That is simpler and safer in Node before writing to PostgreSQL.

## Schema mapping used
- SSOT identity: `skus.company_code` <- `sku_code`
- `items.source_company_code` <- `sku_code` (idempotent item upsert key)
- `items.generic_name` <- `name_th` (legacy-compatible)
- `items.display_name` <- `name_th`
- `items.category_name` <- `category/group`
- `items.supplier_code` <- `supplier_code`
- `items.product_kind` <- inferred (`medicine|supplement|medical_food|cosmetic|device_or_general_goods`)
- `skus.display_name` <- `name_th`
- `skus.category_name` <- `category/group`
- `skus.supplier_code` <- `supplier_code`
- `skus.avg_cost` <- `avg_cost`
- `barcodes.barcode` <- `barcode` (when present)
- `prices.price` <- `retail_price` (currency `THB`, current retail behavior unchanged)
- `sku_price_tiers.price` <- wholesale tiers `1..5` (price_kind=`wholesale`, currency `THB`)

## Safety
- `--dry-run` is default.
- `--commit` writes in batches, one transaction per batch.
- Batch failure rolls back the full batch.
- Parser logs skipped rows and top parse errors.

## Commands
Install dependencies:

```bash
npm install
```

Run migration:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_add_sku_price_tiers.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/003_add_product_fields.sql
```

Dry run:

```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --dry-run
```

Price-only monthly update dry run:

```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --mode price-only --price-history off --dry-run
```

Commit:

```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --commit --db-url "postgresql://..."
```

Commit with retail history mode:

```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --mode price-only --price-history on --commit --db-url "postgresql://..."
```

With test limit:

```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --dry-run --limit 100
```

With custom batch size:

```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --commit --batch-size 500
```

Apply enrichment rules immediately after import commit:

```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --commit --apply-rules --db-url "postgresql://..."
```

## Verify wholesale tiers
```sql
SELECT count(*) FROM public.sku_price_tiers;
```

```sql
SELECT sku_id, tier, price
FROM public.sku_price_tiers
WHERE price_kind = 'wholesale'
ORDER BY sku_id, tier;
```

```sql
SELECT company_code, display_name, category_name, supplier_code, avg_cost
FROM public.skus
ORDER BY sku_id DESC
LIMIT 20;
```
