# Unified Backend Architecture

Date: 2026-05-18

## Goal

Unify the older `PaaSRTSM-project` and the newer `SC-StockDay-Ordering` around:

- one Render PostgreSQL database
- one Node web service on Render
- one canonical product master
- separate functional schemas so ordering, admin, analytics, and sync do not drift into duplicate data models

## Source of truth

The only external source of truth is adaPOS on the mother PC.

Data flow:

1. The mother-PC sync agent reads adaPOS using read-only credentials.
2. The sync agent posts source-shaped payloads to the Render-hosted backend.
3. The backend lands raw evidence in `ada.*`.
4. App-facing `public.*`, `analytics.*`, `crm.*`, and future reconciliation tables derive from `ada.*`.

## Why `PaaSRTSM-project` is the base

This repo is the stronger deployment base because it already has:

- Render-friendly `PORT` and `DATABASE_URL` handling
- auth and audit infrastructure
- admin API and admin web
- existing PostgreSQL product/catalog model
- adaPOS import logic
- sales-history and enrichment support

The `SC-StockDay-Ordering` repo contributes the branch-ordering and sync-tracking domain, not the core product master.

## Shared database shape

Current canonical tables remain in `public`:

- `public.items`
- `public.skus`
- `public.barcodes`
- `public.prices`
- `public.sku_price_tiers`
- `public.sales_daily`
- `public.audit_logs`

New shared schemas introduced by `migrations/014_add_shared_ordering_and_sync.sql`:

- `core`
  - `branches`
- `analytics`
  - `product_stock_snapshots`
  - `product_sales_summary_periods`
  - `product_purchase_summary_periods`
- `ordering`
  - `branch_order_requests`
  - `branch_order_request_items`
- `ingest`
  - `sync_runs`
  - `sync_errors`

Raw evidence schema introduced by `migrations/015_add_ada_raw_ingestion.sql`:

- `ada`
  - `sync_runs`
  - `sync_errors`
  - `branches`
  - `products`
  - `product_barcodes`
  - `transfer_headers`
  - `transfer_lines`
  - `sales_headers`
  - `sales_lines`
  - `purchase_headers`
  - `purchase_lines`
  - `stock_adjustment_headers`
  - `stock_adjustment_lines`
  - `stock_snapshots`

Transfer reconciliation schema introduced by `migrations/019_add_transfer_reconciliation_foundation.sql`:

- `reconciliation`
  - source-derived
    - `transfer_documents`
    - `transfer_document_lines`
    - `transfer_match_candidates`
    - `transfer_cases`
    - `transfer_case_lines`
  - app-owned
    - `transfer_reconciliations`
    - `transfer_reconciliation_lines`
    - `transfer_reconciliation_events`

## Raw vs Normalized

`ada.*` is the raw evidence layer.

- Preserve AdaAcc document numbers, statuses, branch codes, timestamps, units, quantities, lot numbers, expiry dates, and source-shaped payloads.
- Store `source_system`, `source_table`, `source_synced_at`, and `raw_payload` so the evidence can be replayed or audited later.
- Treat this as append/upsert-safe source capture, not app UX data.

`public.*`, `analytics.*`, and future CRM or reconciliation tables are normalized app-facing layers.

- They exist to serve search, dashboards, ordering, and mobile apps.
- They should be derivable from `ada.*`.
- They should not be the first landing zone for AdaAcc sync.

## Normalization rule

Do not create a second product master for the ordering project.

All ordering and sync tables reference the existing product identity:

- `public.skus.company_code`

This keeps:

- imports
- sync
- KPI calculations
- branch ordering
- admin product management

anchored to the same product key.

## Recommended service layout

One Render Node web service is acceptable for now.

Recommended route groups:

- `/admin/*` for the current admin API
- `/api/order/*` for branch ordering
- `/api/sync/ada/*` for raw AdaAcc ingestion
- `/api/sync/*` for legacy-compatible simplified ingestion
- `/api/analytics/*` for KPI and stock views

The mother-PC sync agent remains separate and should not run on Render.

## Deployment notes

Use this repo as the deployed backend source.

Migration command:

```bash
npm run db:migrate
```

That command applies:

1. `001_inventory_schema.sql`
2. every file in `migrations/*.sql` in sorted order

Required Render environment variables:

```env
DATABASE_URL=postgresql://user:password@your-db-host.region-postgres.render.com/dbname
PGSSLMODE=require
PORT=10000
AUTH_JWT_SECRET=...
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
CORS_ALLOWED_ORIGINS=https://your-admin-site.example.com
TRUST_PROXY=true
```

`DATABASE_URL` must be a complete valid PostgreSQL connection string. For this repo's current Render-hosted setup, use the fully qualified database host from Render rather than a shortened slug, and keep SSL enabled with `PGSSLMODE=require`.

`npm run db:migrate` first checks a non-empty shell `DATABASE_URL`. If that is missing, it falls back to `apps/admin-api/.env` and only fills missing env vars, so shell overrides still win.

For general Render Postgres connection details:

- [Render Postgres: Create and Connect](https://render.com/docs/databases)

Monorepo root/build settings are supported if the service is pointed at a subdirectory:

- [Render Monorepo Support](https://render.com/docs/monorepo-support)

## Near-term rollout

1. Run `npm run db:migrate` against the revived Render Postgres database.
2. Keep the existing admin API/web running from this repo.
3. Port the mother-PC sync code from `SC-StockDay-Ordering` into this backend as a local read-only agent that posts to `/api/sync/ada/*`.
4. Keep legacy `/api/sync/*` routes working during transition, but treat them as compatibility endpoints.
5. Port the branch-order request UI/API into `/api/order/*`.
6. Build derivation jobs/views from `ada.*` into `public.*` and `analytics.*`.

## Anti-patterns to avoid

- Do not maintain two separate `products` tables across projects.
- Do not import adaPOS independently into two databases.
- Do not calculate turnover or stock-day from different fact tables per app.
- Do not let the mother-PC sync write directly to Render Postgres without going through controlled ingestion paths unless absolutely necessary.
- Do not collapse AdaAcc facts directly into app-facing summary tables when source evidence needs to be preserved.

## Derivation TODOs

The new `ada.*` layer is only the raw evidence foundation. These follow-up steps remain:

1. Derive `core.branches` from `ada.branches`.
2. Derive `public.items`, `public.skus`, and `public.barcodes` from `ada.products` and `ada.product_barcodes`.
3. Derive `analytics.product_stock_snapshots` from `ada.stock_snapshots` or curated product-master snapshots.
4. Derive `analytics.product_sales_summary_periods` from `ada.sales_headers` and `ada.sales_lines`.
5. Derive `analytics.product_purchase_summary_periods` from `ada.purchase_headers` and `ada.purchase_lines`.
6. Build reconciliation-facing transfer records from `ada.transfer_headers` and `ada.transfer_lines`.
7. Build CRM point events from `ada.sales_headers` and `ada.sales_lines`, not from daily summaries.
8. Add views or jobs that make these derivations rebuildable so corrections remain events, not silent overwrites.

### Current foundation mapping

`ada.branches` → `core.branches`
- latest row per `branch_code` wins by `source_synced_at DESC, ada_branch_id DESC`
- `branch_name` = `branch_name` fallback `branch_name_th` fallback `branch_code`
- `is_hq` = `branch_code = '000'`
- `is_active` derived conservatively from `branch_status`

`ada.products` → `public.items`
- one normalized item per `product_code`
- `items.source_company_code = ada.products.product_code`
- `items.generic_name = product_code` to avoid duplicate-name collisions
- `items.display_name = latest product name`

`ada.products` → `public.skus`
- one normalized SKU per `company_code = product_code`
- canonical app SKU currently uses the smallest known unit as `uom`
- `qty_in_base = 1` and `pack_level = 'base'` for compatibility with current app behavior
- source timestamps flow into `source_updated_at`

`ada.product_barcodes` → `public.barcodes`
- latest row per `(product_code, barcode)` wins
- barcodes for Ada-managed products are upserted onto the SKU anchored by `company_code`
- stale barcodes for Ada-managed products are deleted so the derivation remains rebuildable

### Current analytics mapping

`ada.stock_snapshots` → `analytics.product_stock_snapshots`
- raw stock evidence is grouped at `(product_code, snapshot_at)` for the current analytics table
- `stock_current` uses `SUM(COALESCE(qty_base, qty_on_hand, 0))`
- `stock_retail` and `stock_warehouse` remain `0` in the derived table because the current analytics schema cannot preserve reliable raw warehouse semantics yet
- branch, warehouse, lot, and expiry detail remain available only in `ada.stock_snapshots`
- derived rows use `source_name = 'ada_derived'`

`ada.sales_headers` + `ada.sales_lines` → `analytics.product_sales_summary_periods`
- grain remains `(product_code, branch_code, period_start, period_end, source_name)`
- only paid sales are included using `paid_status` from raw sales headers
- `sold_qty_base` uses `COALESCE(qty_base, qty * stock_factor, qty)`
- `avg_daily_usage = sold_qty_base / period_days`
- the refresh job currently builds one rolling window per requested `period_days`, ending at the latest paid sales document date in `ada.sales_headers`

`ada.purchase_headers` + `ada.purchase_lines` → `analytics.product_purchase_summary_periods`
- grain remains `(product_code, period_start, period_end, source_name)`
- purchase summaries are currently cross-branch because the existing analytics table does not include `branch_code`
- `purchased_qty_base` uses `COALESCE(qty_base, qty * stock_factor, qty)`
- the refresh job currently builds one rolling window per requested `period_days`, ending at the latest eligible purchase document date in `ada.purchase_headers`

### Refresh entrypoints

Foundation derivation:

```bash
npm run derive:ada-foundations
```

Analytics derivation:

```bash
npm run derive:ada-analytics:standard
npm run derive:ada-analytics
npm run derive:ada-analytics -- --period-days=30
```

Standard operating procedure:
- use `npm run derive:ada-analytics:standard` for scheduled or operational refreshes
- this refreshes the standard `7`, `30`, and `90` day windows in one run
- stock snapshots are refreshed once per run, followed by sales and purchase summaries for `7d`, then `30d`, then `90d`

Targeted single-window refresh:
- use `npm run derive:ada-analytics -- --period-days=<days>` when a focused backfill or re-run is needed for one window

`ada.refresh_analytics(period_days)` is rebuildable and currently runs:
- `ada.refresh_analytics_windows(ARRAY[period_days])`

`ada.refresh_analytics_standard_windows()` is rebuildable and currently runs:
- `ada.refresh_analytics_windows(ARRAY[7, 30, 90])`

`ada.refresh_analytics_windows(period_days[])` is rebuildable and currently runs:
- `ada.refresh_stock_snapshots_into_analytics()`
- `ada.refresh_sales_summary_period_into_analytics(period_days)` for each requested window in order
- `ada.refresh_purchase_summary_period_into_analytics(period_days)` for each requested window in order

### Current transfer reconciliation mapping

`ada.transfer_headers` → `reconciliation.transfer_documents`
- one normalized source-derived document per raw AdaAcc transfer header
- preserves source doc number, doc type, branch codes, warehouse codes, status fields, references, quantities, and sync timestamps
- `doc_type = '4'` is normalized as `source_direction = 'outbound'`
- `doc_type = '7'` is normalized as `source_direction = 'inbound'`
- inbound `process_status` is normalized into `process_state = 'processed'` or `process_state = 'unprocessed'`
- each document stores `matched_candidate_count`, `unique_match`, and unique-match counterpart fields when a single conservative source match exists

`ada.transfer_lines` → `reconciliation.transfer_document_lines`
- one normalized source-derived line per raw AdaAcc transfer line
- preserves product code, barcode, unit fields, qty, qty_base, normalized base qty, lot, expiry, warehouse, and references
- `normalized_qty_base` uses `COALESCE(qty_base, qty * stock_factor, qty)`

`reconciliation.transfer_match_candidates`
- contains conservative outbound/inbound source match candidates only
- match methods are intentionally narrow:
  - inbound references outbound doc
  - outbound references inbound doc
  - same doc number with compatible dispatch/receiving branch pair
- if multiple candidates exist, the ambiguity is preserved instead of silently choosing one

`reconciliation.transfer_cases`
- one source-derived reconciliation case per outbound transfer, plus unmatched inbound-only cases
- `source_match_status` currently classifies cases as:
  - `outbound_only`
  - `inbound_present_unprocessed`
  - `inbound_processed`
  - `ambiguous_match`
  - `inbound_only_unmatched`
- this is the main app-facing summary table for:
  - outbound transfers awaiting confirmation
  - unprocessed inbound receipts
  - source-side quantity deltas when a unique inbound document exists

`reconciliation.transfer_case_lines`
- source-derived line comparison layer keyed by case
- compares outbound vs inbound normalized base quantities by product/unit/lot/expiry grouping
- line statuses are:
  - `outbound_only`
  - `inbound_only`
  - `matched`
  - `qty_mismatch`
  - `ambiguous_case`

App-owned manual reconciliation tables:
- `reconciliation.transfer_reconciliations`
- `reconciliation.transfer_reconciliation_lines`
- `reconciliation.transfer_reconciliation_events`

These tables are not rebuilt from AdaAcc. They exist for later manual receive/confirm/discrepancy workflows and must survive source refreshes.

### Transfer refresh entrypoint

```bash
npm run derive:ada-reconciliation
```

`reconciliation.refresh_transfer_derivations()` is rebuildable and currently runs:
- rebuild `reconciliation.transfer_documents`
- rebuild `reconciliation.transfer_document_lines`
- rebuild `reconciliation.transfer_match_candidates`
- rebuild `reconciliation.transfer_cases`
- rebuild `reconciliation.transfer_case_lines`
