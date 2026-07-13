# Stock Recommendation Performance Implementation

Date: 2026-07-12
Updated: 2026-07-13 — see "2026-07-13 Update" section at the bottom for the priority-sort fix, the demand-data-source fix, and the nightly cron that closes out the "Remaining Follow-up" items below.

## Goal

Implement the first two performance levers for stock recommendation:

1. Reduce candidate SKU count before recommendation math runs.
2. Precompute recommendation rows into a snapshot table so the UI can read cached rows instead of recomputing on every request.

## What Changed

### 1. Candidate Reduction in live computation

File:
- `apps/admin-api/src/services/stockRecommendations.js`

Added:
- `loadCandidateProductCodes(...)`
- `buildBranchQtyPositiveSql(...)`

New candidate rules:
- Include SKUs with positive stock in any branch inside the current scope.
- Include SKUs with 30d/90d sales summary for the current anchor date.
- Include SKUs present in pending or approved incoming receipts.
- Include SKUs explicitly matched by the user's search text.

Effect:
- Live fallback no longer scans the full `ada.branch_stock_snapshots` catalog by default.
- It now loads detailed stock rows only for the reduced candidate set.

### 2. Precomputed recommendation snapshots

Files:
- `migrations/050_add_stock_recommendation_snapshots.sql`
- `apps/admin-api/src/services/stockRecommendations.js`

Added table:
- `ordering.stock_recommendation_snapshots`

Stored per row:
- `anchor_date`
- `target_days`
- `branch_code`
- `product_code`
- all computed recommendation metrics
- `action`
- `recommendation_reason`
- `recommendation_flags`
- `donors_json`
- `generated_at`

Indexes added for:
- scope lookup: `anchor_date + target_days + branch_code`
- action/priority sorting
- product/detail lookup
- latest generation tracking

### 3. Read path now prefers precomputed snapshots

File:
- `apps/admin-api/src/services/stockRecommendations.js`

New behavior:
- `listStockRecommendations(...)`
- `getStockRecommendationSummary(...)`
- `getStockRecommendationDetail(...)`

These now:
- Resolve current scope and anchor date.
- Check whether snapshot rows exist for `anchor_date + target_days + branch scope`.
- Read from `ordering.stock_recommendation_snapshots` if available.
- Fall back to live computation only if snapshots are missing.

Meta field added in API payload:
- `meta.source = "precomputed"` or `"live"`

### 4. Snapshot refresh entrypoint

Files:
- `apps/admin-api/src/services/stockRecommendations.js`
- `scripts/derive_stock_recommendations.js`
- `package.json`

Added exported service:
- `refreshStockRecommendationSnapshots(db, options)`

Added CLI script:
- `npm run derive:stock-recommendations`

Examples:
- `npm run derive:stock-recommendations`
- `npm run derive:stock-recommendations -- 90`
- `npm run derive:stock-recommendations -- 90 001,003,005`

Refresh flow:
- Compute recommendation rows live once.
- Delete stale snapshot rows for the same `anchor_date + target_days` (or selected branches).
- Insert the new snapshot batch into `ordering.stock_recommendation_snapshots`.

## Intended Runtime Flow

### Normal user/API read path

1. UI calls `/api/admin/stock-recommendations`.
2. Backend checks for snapshot rows for the current anchor date and target days.
3. If snapshot exists, backend serves cached rows with SQL filter/sort/pagination.
4. If snapshot does not exist, backend falls back to live compute with reduced candidate SKU selection.

### Refresh path

1. Ada sync / analytics refresh finishes.
2. Run `npm run derive:stock-recommendations`.
3. Snapshot table is regenerated.
4. Subsequent UI reads use `meta.source = "precomputed"`.

## Files Touched

- `apps/admin-api/src/services/stockRecommendations.js`
- `migrations/050_add_stock_recommendation_snapshots.sql`
- `scripts/derive_stock_recommendations.js`
- `package.json`
- `tests/stock_recommendations_api.test.js`

## Remaining Follow-up

Not done yet:
- Automatic hook to run snapshot refresh immediately after Ada analytics refresh.
- ~~Render cron/background job for periodic refresh.~~ Done 2026-07-13 — see below (in-process `node-cron`, not a separate Render service).
- A status/admin endpoint showing latest snapshot freshness.

Recommended next step:
- Wire `derive:stock-recommendations` into the existing post-sync derivation sequence so the cache stays warm automatically.
- Live fallback (`computeLiveRecommendationDataset`) still costs ~13-40s per call when no snapshot exists for the requested `targetDays`/branch combo — fine for the nightly batch, too slow for an on-demand API call. If the UI ever lets users pick arbitrary `targetDays`, either widen `STOCK_RECOMMENDATION_CRON_TARGET_DAYS` to precompute the values users actually pick, or add a short-TTL cache in front of the live path.

## 2026-07-13 Update

### Bug fixes (see `docs/SESSION_2026-07-13_STOCK_RECOMMENDATION_DEMAND_FIX.md` for full detail)

1. **`priorityScore` no longer derived from raw `shortageQty`.** It previously
   floated `NO_ACTION`/`NO_PURCHASE_SLOW_MOVING` rows with negative
   `current_stock` (data glitches, mostly on warehouse branch `000`) to the
   top of the default sort. Now it's `0` unless the resolved action is
   `PURCHASE`/`TRANSFER_IN`/`TRANSFER_AND_PURCHASE`.
2. **Sold-qty aggregation moved off `analytics.product_sales_summary_periods`.**
   That table's `period_days=90` bucket was stale since 2026-05-20 (wrong
   `paid_status` filter in migration 017's derivation function) and its only
   live feed (`adapos_sync`) never wrote `period_days=90` at all — so
   `soldQty90d` was always `0` and ~85% of SKUs were misclassified as slow
   movers. `loadSalesAggByProductBranch` was replaced by
   `loadRawSalesAggByBranch`, which reads `ada.sales_lines` +
   `ada.sales_headers` directly with the correct `paid_status='3'` filter.
   The candidate-product discovery query was updated to use the same raw
   aggregate instead of a second query against the broken table.

### Nightly cron (in-process, not a new Render service)

Added `apps/admin-api/src/services/stockRecommendationSchedule.js`, wired into
`startServer()` in `server.js` (never runs during tests, which only call
`createApp()`). Uses `node-cron` inside the existing always-on admin-api web
service — no new Render service, no extra hosting cost.

Env vars (all optional; feature is off unless the first one is set):

```
FEATURE_STOCK_RECOMMENDATION_CRON=true
STOCK_RECOMMENDATION_CRON_EXPRESSION=0 6 * * *
STOCK_RECOMMENDATION_CRON_TIMEZONE=Asia/Bangkok
STOCK_RECOMMENDATION_CRON_TARGET_DAYS=90
```

- `STOCK_RECOMMENDATION_CRON_EXPRESSION` — standard 5-field cron syntax. Default runs once a day at 06:00, after the branch morning sync has landed.
- `STOCK_RECOMMENDATION_CRON_TARGET_DAYS` — comma-separated list, e.g. `60,90` to precompute snapshots for more than one target-days value.
- Invalid cron expressions are caught at startup (`cron.validate`) and logged instead of crashing the process.
