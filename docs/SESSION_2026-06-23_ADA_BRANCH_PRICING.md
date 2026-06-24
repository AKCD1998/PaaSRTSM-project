# SESSION 2026-06-23 - ADA Branch Pricing + PDA Scan

## Outcome

- Confirmed the production backend for `https://paasrtsm-project.onrender.com` is `PaaSRTSM-project/apps/admin-api`, not `SC-StockDay-Ordering/server`.
- Implemented Ada branch pricing ingestion and PDA/mobile price lookup in the correct repo.
- Verified the full repo test suite passes: `210/210`.

## Important Architecture Correction

- Earlier pricing work had been drafted in `SC-StockDay-Ordering/server`, but that repo is not the Render service backing `paasrtsm-project.onrender.com`.
- The actual production backend is `PaaSRTSM-project/apps/admin-api`.
- Root cause of repeated `404` on `/api/pda/products/scan` was not missing env vars alone; the route simply did not exist in the real backend yet.

## Backend Changes Applied

### Migration

- Added [migrations/039_add_ada_branch_prices.sql](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/migrations/039_add_ada_branch_prices.sql)

Creates:

- `ada.product_price_defaults`
- `ada.product_branch_price_overrides`
- `ada.product_effective_branch_prices`

Design notes:

- `product_price_defaults` stores HQ/master prices from Ada `TCNMPdt`
- `product_branch_price_overrides` stores branch overrides from `TCNTPdtBchPrice`
- `product_effective_branch_prices` stores resolved per-branch prices for fast PDA reads
- `price_level` rules are channel-specific:
  - retail: `1..3`
  - wholesale: `1..5`
- both defaults and overrides support `snapshot_id` for final-batch purge semantics

### Sync Routes

Updated [apps/admin-api/src/routes/sync-ada.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/apps/admin-api/src/routes/sync-ada.js)

Added:

- `POST /api/sync/ada/prices/defaults`
- `POST /api/sync/ada/prices/branch-overrides`

Behavior:

- auth uses existing `x-api-key` gate in `createAdaSyncRouter`
- payloads are normalized and validated server-side
- `isFinal=true` requires `snapshotId`
- defaults final sync purges stale HQ price rows not present in the latest snapshot
- branch override final sync purges stale rows for that branch not present in the latest snapshot
- effective prices are recomputed after each sync:
  - defaults refresh all known branches
  - branch overrides refresh only that branch
- fallback stays on backend:
  - override exists -> use override
  - otherwise -> use master/default

### PDA / Mobile Scan Routes

Updated [apps/admin-api/src/routes/mobile-products.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/apps/admin-api/src/routes/mobile-products.js)

Current routes:

- `GET /api/mobile/products/by-barcode/:barcode`
- `GET /api/pda/products/scan?barcode=...`

Behavior:

- both routes are gated by `FEATURE_MOBILE_PDA`
- both routes require the existing mobile auth middleware
- branch identity is taken from `req.mobile.branchCode`
- product lookup uses:
  - `ada.product_barcodes`
  - `ada.products`
  - `ada.branch_stock_snapshots`
  - `ada.product_effective_branch_prices`
- sales role sees branch-scoped retail prices only
- manager role can also see wholesale prices and branch cost
- response includes:
  - product identity
  - branch-scoped stock
  - `unitPrices`
  - top-level `retailPrice`

### Server Mounting

Updated [apps/admin-api/src/server.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/apps/admin-api/src/server.js)

- `createMobileProductsRouter` now receives `config` and `requireMobileTokenMiddleware`
- router is mounted under:
  - `/api/mobile`
  - `/api/pda`

## Auth Decision

The PDA scan route does **not** use `PDA_TOKEN_000..005`.

Reason:

- `apps/admin-api` already has a real mobile enrollment/auth model:
  - JWT Bearer token
  - `ordering.enrolled_devices`
  - `requireMobileToken(...)`
- this is the correct branch identity source for PDA/mobile requests
- therefore price visibility is enforced by server-side branch resolution from the enrolled device token

The `PDA_TOKEN_*` env vars may still exist in `.env.example`, but they are not the branch-pricing auth mechanism used by these routes.

## Files Changed

- [apps/admin-api/src/routes/sync-ada.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/apps/admin-api/src/routes/sync-ada.js)
- [apps/admin-api/src/routes/mobile-products.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/apps/admin-api/src/routes/mobile-products.js)
- [apps/admin-api/src/server.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/apps/admin-api/src/server.js)
- [migrations/039_add_ada_branch_prices.sql](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/migrations/039_add_ada_branch_prices.sql)
- [tests/ada_sync_api.test.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/tests/ada_sync_api.test.js)
- [tests/mobile_products_api.test.js](C:/Users/scgro/Desktop/Webapp%20training%20project/PaaSRTSM-project/tests/mobile_products_api.test.js)

## Validation

Executed:

```bash
node --test
```

Result:

- `210/210` tests passed

## Next Deployment Steps

1. Deploy `PaaSRTSM-project`
2. Run migration `039_add_ada_branch_prices.sql`
3. Probe:
   - `POST /api/sync/ada/prices/defaults`
   - expected `400` with invalid/empty body if route exists and auth passes
4. Enable mother-PC to send:
   - defaults dataset -> `/api/sync/ada/prices/defaults`
   - branch override dataset -> `/api/sync/ada/prices/branch-overrides`
5. Verify PDA scan on production with a real enrolled mobile token:
   - `GET /api/pda/products/scan?barcode=8858850301707`

## Known Follow-Up

- The mother-PC agent query/payload work was already completed separately.
- After backend deploy, the remaining production check is route probing plus the first live sync run.
