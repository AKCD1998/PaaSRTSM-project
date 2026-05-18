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
2. The sync agent posts normalized payloads to the Render-hosted backend.
3. The backend writes to shared PostgreSQL tables.
4. Admin, analytics, and branch-ordering features read from the same normalized tables.

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
- `/api/sync/*` for mother-PC ingestion
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
DATABASE_URL=postgresql://...
PORT=10000
AUTH_JWT_SECRET=...
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
CORS_ALLOWED_ORIGINS=https://your-admin-site.example.com
TRUST_PROXY=true
```

If using Render Postgres from the same region/account, prefer the internal database URL:

- [Render Postgres: Create and Connect](https://render.com/docs/databases)

Monorepo root/build settings are supported if the service is pointed at a subdirectory:

- [Render Monorepo Support](https://render.com/docs/monorepo-support)

## Near-term rollout

1. Run `npm run db:migrate` against the revived Render Postgres database.
2. Keep the existing admin API/web running from this repo.
3. Port the mother-PC sync code from `SC-StockDay-Ordering` into this backend as `/api/sync/*` handlers plus the local sync agent.
4. Port the branch-order request UI/API into `/api/order/*`.
5. Build KPI views/endpoints from `public.sales_daily` plus the new `analytics.*` tables.

## Anti-patterns to avoid

- Do not maintain two separate `products` tables across projects.
- Do not import adaPOS independently into two databases.
- Do not calculate turnover or stock-day from different fact tables per app.
- Do not let the mother-PC sync write directly to Render Postgres without going through controlled ingestion paths unless absolutely necessary.
