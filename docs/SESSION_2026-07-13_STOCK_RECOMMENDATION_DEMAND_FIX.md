# Session 2026-07-13 — Stock Recommendation: Real 90-Day Demand + Priority Fix + Nightly Cron

## Context

Boss's back-of-envelope KPI targets (from the web dashboard numbers, calculated
by hand): stock cover ~115-120 days, monthly stock cost ~15,000,000 THB, target
90 days cover. Asked for the real numbers computed from the database instead of
guessed, plus a design for a per-branch reorder recommendation system.

While validating the numbers against production, the already-built stock
recommendation feature (`คำแนะนำสต๊อก` in admin-web) was found to be silently
broken — every SKU showed as "no action needed" or "slow moving," never a
`PURCHASE`/`TRANSFER_IN` recommendation. This session traced and fixed the
root causes, then closed out the "nightly refresh" follow-up from
`docs/stock-recommendation-performance-implementation.md`.

## Part 1 — Real KPI numbers (ad-hoc queries against production, no code change)

Computed directly against the live Postgres DB (`ada.branch_stock_snapshots`
qty × `cost_avg`, `ada.sales_lines`/`ada.sales_headers` with the correct
`paid_status='3'` filter):

- Retail-branch stock value (001, 003, 004, 005 — excludes warehouse branch
  000): **13,892,896 THB** (14,805,990 THB including branch 000).
- 90-day trailing avg daily cost-of-goods-sold: **113,107 THB/day**.
- Real stock cover: **122.8 days** — close to the boss's hand-estimate of
  115-120, confirming the manual math was basically right.
- Reducing to 90 days cover → target stock value **10,179,634 THB** → real
  potential reduction **~3.71M THB** (~4.63M THB if branch 000 is included).
- **Per-branch cover varies a lot** and this is the more actionable insight
  than the company-wide average:
  - 001: 91.2 days (already near target)
  - 003: 112.8 days
  - 004: 172.8 days
  - 005: 223.0 days (worst — also the newest branch, least sales history)

Branch 002 in `ada.branch_stock_snapshots` is dead data (qty=1 total across
the whole table, no active sales) — excluded from all of the above.

## Part 2 — Bug #1: priority sort put non-actionable rows first

File: `apps/admin-api/src/services/stockRecommendations.js`

`priorityScore` (used as the default list sort) was:

```js
const priorityScore = round(metric.shortageQty * (metric.unitCostAvg || 0), 2);
```

`metric.shortageQty` is computed generically as `MAX(-(effectiveStock -
targetQty), 0)` regardless of which `action` branch was ultimately taken. When
`soldQty90d <= 0` (no sales in the window), `targetQty` collapses to `0`
because `adjustedAdu = 0`. If `currentStock` also happened to be negative — a
data-quality artifact, especially common on branch `000` (the central
warehouse, which never has direct sales, so it *always* takes the "no sales"
branch) — `shortageQty` computed as a spurious positive number even though the
actual `action` was correctly resolved to `NO_ACTION`/`NO_PURCHASE_SLOW_MOVING`
just a few lines earlier.

Net effect (matches the screenshot the user reported): items with negative
recorded stock and zero sales floated to the very top of "ควรสั่งด่วน"
(urgent-order) sort, ahead of genuinely understocked fast movers.

Fix:

```js
const priorityActionQty =
  action === "PURCHASE" || action === "TRANSFER_AND_PURCHASE"
    ? purchaseQty
    : action === "TRANSFER_IN"
      ? transferPlanQty
      : 0;
const priorityScore = round(priorityActionQty * (metric.unitCostAvg || 0), 2);
```

Also added a `NEGATIVE_STOCK` flag (`metric.currentStock < 0`) so branch staff
can see the data-quality issue explicitly instead of it silently distorting
the recommendation.

## Part 3 — Bug #2: the demand engine had no real 90-day data (bigger bug)

After fixing bug #1 and regenerating the snapshot table, **zero** rows had
action `PURCHASE`/`TRANSFER_IN`/`TRANSFER_AND_PURCHASE` — every one of 13,824
rows was `NO_ACTION` or `NO_PURCHASE_SLOW_MOVING` (85% the latter). That's not
plausible for a company doing real daily sales, so it pointed at the input
data, not just the sort.

Root cause: `stockRecommendations.js` computed demand from
`analytics.product_sales_summary_periods`, filtered to `period_days IN (30,
90)`. That table has two writers:

- `ada.refresh_sales_summary_period_into_analytics()` (migration 017,
  `source_name='ada_derived'`) — filters
  `paid_status IN ('1', 'true', 't', 'paid', 'success', 'y')`. Real paid-sale
  rows use `paid_status='3'` (confirmed via `movement-analytics.js` and
  `focusProducts.js`, both of which use
  `COALESCE(NULLIF(raw_payload->>'FTShdStaPaid',''), paid_status, '') = '3'`).
  This function ran once and has been stale since **2026-05-20** for all three
  windows (7/30/90).
- `adapos_sync` (branch senders, `apps/admin-api/src/routes/sync.js` `POST
  /sales-summary`) — the only feed still actually running, fresh through
  today. **It only ever sends `period_days=30`.** No 90-day data has ever
  reached this table from that source.

Query confirming this:

```sql
SELECT source_name, period_days, count(*), max(period_end)
FROM analytics.product_sales_summary_periods GROUP BY 1,2 ORDER BY 1,2;

 source_name | period_days | count  |    max
-------------+-------------+--------+------------
 ada_derived |           7 |      1 | 2026-05-20
 ada_derived |          30 |      1 | 2026-05-20
 ada_derived |          90 |      1 | 2026-05-20
 adapos_sync |          30 | 890434 | 2026-07-13
```

`stockRecommendations.js` used `adu90` (from `soldQty90d`) as `baseAdu` for
demand — `adu30` was only ever a secondary trend multiplier on top of that
base. Since `soldQty90d` was structurally always `0`, `adjustedAdu` was always
`0`, `targetQty` was always `0`, and every SKU took the "no sales in 90 days"
branch.

Note: `docs/STOCK_RECOMMENDATION_ENGINE_SPEC.md` (the design doc this feature
was built from) already explicitly warned *"do not depend on
`analytics.product_sales_summary_periods` for arbitrary recommendation date
windows"* — the implementation just didn't follow that.

### Fix

Added `loadRawSalesAggByBranch()` in `stockRecommendations.js`, which computes
both the 30d and 90d windows in one query directly against `ada.sales_lines` +
`ada.sales_headers`, using the same paid-sale filter as `movement-analytics.js`:

```sql
SELECT
  sl.product_code,
  sh.branch_code,
  COALESCE(SUM(COALESCE(sl.qty_base, sl.qty, 0)) FILTER (WHERE sh.doc_date >= $4::date), 0)::numeric AS sold_qty_30d,
  COALESCE(SUM(COALESCE(sl.qty_base, sl.qty, 0)), 0)::numeric AS sold_qty_90d
FROM ada.sales_headers sh
JOIN ada.sales_lines sl
  ON sl.branch_code = sh.branch_code AND sl.doc_no = sh.doc_no
WHERE sh.branch_code = ANY($1::text[])
  AND sh.doc_date BETWEEN $2::date AND $3::date
  AND COALESCE(NULLIF(sh.raw_payload->>'FTShdDocType', ''), '1') = '1'
  AND COALESCE(NULLIF(sh.raw_payload->>'FTShdStaPaid', ''), sh.paid_status, '') = '3'
GROUP BY sl.product_code, sh.branch_code
```

Also updated `loadCandidateProductCodes()` to source its "has recent sales"
candidate signal from this same raw aggregate instead of a second query
against `analytics.product_sales_summary_periods` — avoids querying twice and
fixes the same staleness bug for candidate discovery.

`computeLiveRecommendationDataset()` now computes the raw sales map once and
passes it to both candidate discovery and row-building.

`analytics.product_stock_snapshots` (current stock) was **not** affected —
that data already comes from `ada.branch_stock_snapshots` directly, which is
reliable.

### Result after fix

Full-catalog snapshot regenerated via `npm run derive:stock-recommendations`
(anchor date 2026-07-12, target 90 days, 14,309 rows, ~40s):

| action                  | before | after  |
|-------------------------|--------|--------|
| NO_ACTION                | 2,021 (roughly) | 8,230 |
| NO_PURCHASE_SLOW_MOVING  | 11,803 (85%) | 2,951 (21%) |
| TRANSFER_IN              | 0      | 1,626 |
| TRANSFER_AND_PURCHASE    | 0      | 804   |
| PURCHASE                 | 0      | 698   |

Spot-checked the new top-priority row: `IC-001011` branch 003, 41 units on
hand, sold 4,280 units in 90 days (42.8/day avg) → 1.19 days of cover left.
Genuinely urgent, unlike the pre-fix top rows (negative recorded stock, zero
sales).

### Performance note

`EXPLAIN ANALYZE` on the raw query (all 4 retail branches, 90-day window):
**~13s**, using the partial index `idx_ada_sales_headers_paid_doc_date` (added
in migration 053) and `idx_ada_sales_lines_branch_doc_product`. Acceptable for
the nightly batch (`scripts/derive_stock_recommendations.js`, full run ~40s),
too slow to run per API request — this is why the precomputed-snapshot path
and the nightly cron (Part 4) matter: the live-compute fallback in
`computeLiveRecommendationDataset()` is only meant to be hit when no snapshot
exists for the requested `targetDays`/branch combo.

## Part 4 — Nightly cron (in-process `node-cron`, no new Render service)

Closes the "Render cron/background job for periodic refresh" item from
`docs/stock-recommendation-performance-implementation.md`.

Chose in-process scheduling over a separate Render Cron Job service: no extra
Render service/cost, and the existing admin-api web service already runs
24/7. Trade-off accepted: ties the schedule to the web dyno's uptime, and the
job shares CPU/DB-connection-pool with live API traffic while it runs (~40s,
once a day, off-peak).

New files:
- `apps/admin-api/src/services/stockRecommendationSchedule.js` — wraps
  `refreshStockRecommendationSnapshots()` in a `node-cron` job. Validates the
  cron expression at startup (`cron.validate`) and logs+no-ops instead of
  crashing on a bad expression. Exports `runStockRecommendationRefresh` (for
  manual/test invocation) and `startStockRecommendationSchedule`.

Changed files:
- `apps/admin-api/src/config.js` — added `featureStockRecommendationCron`,
  `stockRecommendationCronExpression`, `stockRecommendationCronTimezone`,
  `stockRecommendationCronTargetDays`.
- `apps/admin-api/src/server.js` — wired `startStockRecommendationSchedule()`
  into `startServer()` only (not `createApp()`), matching the existing
  `startAssetCleanupSchedule` pattern so it never fires during tests (tests
  only call `createApp()`). Added to the graceful-shutdown handler.
- `package.json` — added `node-cron@^4.6.0` dependency.

### Env vars to set on Render (admin-api service)

```
FEATURE_STOCK_RECOMMENDATION_CRON=true
STOCK_RECOMMENDATION_CRON_EXPRESSION=0 6 * * *
STOCK_RECOMMENDATION_CRON_TIMEZONE=Asia/Bangkok
STOCK_RECOMMENDATION_CRON_TARGET_DAYS=90
```

All optional except the feature flag needs to be explicitly `true` — the
schedule is off by default so it doesn't start firing against a fresh deploy
before anyone's confirmed the timing. Default cron expression (06:00 daily) is
chosen to run after the branch morning sync ("soldqty ทุกๆเช้า") has landed.
`STOCK_RECOMMENDATION_CRON_TARGET_DAYS` accepts a comma-separated list (e.g.
`60,90`) if more than one target-days value needs to stay precomputed.

No `render.yaml` in this repo (deploys are manual via the Render dashboard per
earlier session notes) — these env vars need to be added by hand in the
admin-api service's Environment tab, then redeploy.

## Files touched this session

- `apps/admin-api/src/services/stockRecommendations.js` (priority fix, raw
  sales aggregation, candidate discovery)
- `apps/admin-api/src/services/stockRecommendationSchedule.js` (new)
- `apps/admin-api/src/config.js` (cron config)
- `apps/admin-api/src/server.js` (cron wiring)
- `package.json` (node-cron dependency)
- `tests/stock_recommendations_api.test.js` (mock updated for the new raw-SQL
  query shape — all 4 tests pass)
- `docs/stock-recommendation-performance-implementation.md` (updated)
- `docs/SESSION_2026-07-13_STOCK_RECOMMENDATION_DEMAND_FIX.md` (this file)
- `SC-StockDay-Ordering/docs/STOCK_RECOMMENDATION_ENGINE_SPEC.md` (status
  update section added)

Production snapshot table (`ordering.stock_recommendation_snapshots`) was
regenerated twice against the live Render Postgres DB during this session
(once after the priority fix, once after the demand-source fix) via `npm run
derive:stock-recommendations`.

## Not done yet / open follow-ups

- **Code not committed.** Everything above is in the working tree only.
  Decision point: verify in the real admin-web/order-web UI first, or commit
  now and verify after — see the conversation for the live discussion.
- `FEATURE_STOCK_RECOMMENDATION_CRON` env var not yet set on Render — the
  cron code is inert in production until that's done manually.
- Live fallback path (no precomputed snapshot for a requested
  `targetDays`/branch) still costs ~13-40s per request. Only matters if the
  UI starts letting users pick arbitrary `targetDays` values not covered by
  `STOCK_RECOMMENDATION_CRON_TARGET_DAYS`.
- No status/admin endpoint yet showing latest snapshot freshness (still on the
  original follow-up list).
- `NEGATIVE_STOCK` flag added to rows but not yet surfaced anywhere in the
  admin-web/order-web UI — would be useful for branch staff to see when a
  recommendation is riding on suspect stock-count data.
