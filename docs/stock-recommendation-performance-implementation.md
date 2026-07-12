# Stock Recommendation Performance Implementation

Date: 2026-07-12

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
- Render cron/background job for periodic refresh.
- A status/admin endpoint showing latest snapshot freshness.

Recommended next step:
- Wire `derive:stock-recommendations` into the existing post-sync derivation sequence so the cache stays warm automatically.
