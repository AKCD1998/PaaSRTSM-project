# Enrichment Workflow

This workflow lets you keep commercial SKU import simple while gradually enriching drug-like metadata.

## 1) Migrations
Run these after your existing schema migrations:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/004_add_enrichment_workflow.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/005_add_sales_daily.sql
```

## 2) Enrichment fields on `skus`
Added columns:
- `generic_name`
- `strength_text`
- `form`
- `route`
- `product_kind`
- `enrichment_status` (`missing|partial|verified`, default `missing`)
- `enrichment_notes`
- `enriched_at`
- `enriched_by`

Meaning:
- `missing`: no/very little drug facts yet.
- `partial`: some fields mapped (usually by rules/manual).
- `verified`: reviewed and trusted.

## 3) Rule table
`public.enrichment_rules` stores regex-based mapping rules:
- Match fields: display name / category / supplier
- Set fields: generic_name, strength_text, form, route, product_kind, status
- Rules execute by `priority ASC`, then `rule_id`.

### Example rules
```sql
INSERT INTO public.enrichment_rules (
  priority,
  match_name_regex,
  set_generic_name,
  set_strength_text,
  set_form,
  set_route,
  set_status,
  note
)
VALUES
  (10, 'cetirizine\\s*10', 'cetirizine', '10 mg', 'tablet', 'oral', 'partial', 'auto OTC mapping'),
  (20, 'CPM', 'chlorpheniramine', '4 mg', 'tablet', 'oral', 'partial', 'auto antihistamine mapping');
```

Category + name combined rule example:
```sql
INSERT INTO public.enrichment_rules (
  priority,
  match_category_regex,
  match_name_regex,
  set_generic_name,
  set_strength_text,
  set_form,
  set_route,
  set_status
)
VALUES
  (30, 'ยาลดน้ำมูก', 'CPM', 'chlorpheniramine', '4 mg', 'tablet', 'oral', 'partial');
```

## 4) Apply rules
Dry-run:
```bash
node scripts/apply_enrichment_rules.js --dry-run --db-url "$DATABASE_URL"
```

Commit:
```bash
node scripts/apply_enrichment_rules.js --commit --db-url "$DATABASE_URL"
```

Only missing SKUs:
```bash
node scripts/apply_enrichment_rules.js --commit --only-status missing --db-url "$DATABASE_URL"
```

Force overwrite existing values:
```bash
node scripts/apply_enrichment_rules.js --commit --force --db-url "$DATABASE_URL"
```

## 5) Top-seller prioritization
Load sales stub CSV:
```bash
node scripts/import_sales_daily_csv.js --file path/to/sales_daily.csv --commit --db-url "$DATABASE_URL"
```

CSV aliases supported:
- date: `sale_date`, `date`
- code: `company_code`, `sku_code`
- qty: `qty`, `quantity`
- amount: `amount`, `sales_amount`

Top sellers still not verified:
```bash
node scripts/enrichment_report_top_sellers.js --top 200 --since 2026-01-01 --db-url "$DATABASE_URL"
```

## 6) Completeness queries
Status summary:
```sql
SELECT enrichment_status, COUNT(*)
FROM public.skus
GROUP BY enrichment_status
ORDER BY enrichment_status;
```

What is missing per SKU:
```sql
SELECT
  sku_id,
  company_code,
  display_name,
  enrichment_status,
  CONCAT_WS(
    ',',
    CASE WHEN COALESCE(TRIM(generic_name), '') = '' THEN 'generic_name' END,
    CASE WHEN COALESCE(TRIM(strength_text), '') = '' THEN 'strength_text' END,
    CASE WHEN COALESCE(TRIM(form), '') = '' THEN 'form' END,
    CASE WHEN COALESCE(TRIM(route), '') = '' THEN 'route' END
  ) AS missing_fields
FROM public.skus
WHERE enrichment_status <> 'verified'
ORDER BY sku_id;
```

## 7) Optional importer integration
After AdaPos import commit, apply rules to imported SKUs only:
```bash
node scripts/import_adapos_csv.js --file path/to/adapos.csv --commit --apply-rules --db-url "$DATABASE_URL"
```

## 8) Future extension (proposal only)
When ingredient-level source data is available, add:
- `ingredients` master table
- `product_ingredients` join table (0..N ingredients per SKU)

This is intentionally not implemented yet because current AdaPos feed does not provide a reliable ingredient list per SKU.
