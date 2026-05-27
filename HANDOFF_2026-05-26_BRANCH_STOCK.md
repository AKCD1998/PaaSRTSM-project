# Branch Stock Handoff for May 26, 2026

## Current status

- `POST /api/branch-stock/sync` is working and writes into `ada.branch_stock_snapshots`.
- The deployed `sc-stockday-ordering` frontend is calling the correct endpoint: `GET /api/branch-stock`.
- I added a backend fallback so branch-stock rows can show `productNameThai`, `productNameEng`, `barcode`, and `unit` from `ada.products` and `ada.product_barcodes` when the snapshot row is blank.
- This does **not** fix the root cause of the branch-stock sync payload.

## What is still broken

- The branch-stock UI still shows mostly `0.00` quantities.
- The original Mother PC branch-stock payload appears to be missing or miscomputing:
  - product names
  - barcode
  - unit
  - branch quantities
- The likely root cause is the Mother PC SQL join used in `scripts/lib/ada_sync_agent.js` for dataset `branch-stock`.

## Repo work to do tomorrow in `PaaSRTSM-project`

1. Verify the live Mother PC SQL result before POST.
   - Run the `branch-stock` SQL directly on the Mother PC against AdaAcc.
   - Inspect a few known product codes and confirm:
     - `product_code`
     - `product_name_thai`
     - `product_name_eng`
     - `barcode`
     - `unit`
     - `qty_branch_000/001/002/003/004/005`
     - `qty_total_all_branches`

2. Re-check the warehouse-to-branch mapping in `scripts/lib/ada_sync_agent.js`.
   - Current join:
     - `b.FTBchWheStk = w.FTWahCode`
   - Confirm this is actually correct in the live AdaAcc schema.
   - If wrong, replace it with the real mapping between:
     - product stock warehouse rows in `TCNTPdtInWha`
     - branch identity in `TCNMBranch`

3. Confirm that the Mother PC is running the latest branch-stock extractor code.
   - The repo SQL includes names, barcode, unit, and summed quantities.
   - If the Mother PC script is older, redeploy or copy the updated sync agent there.

4. Capture one real outgoing branch-stock payload from the Mother PC before POST.
   - Save a sample JSON payload.
   - Confirm whether the zeros and blank metadata are already present before the API call.
   - If they are already wrong there, the bug is fully in extraction, not in this backend.

5. After the SQL fix, run a real sync and verify in PostgreSQL:
   - `ada.branch_stock_snapshots`
   - spot-check a few product codes
   - confirm names and quantities are non-zero where expected

## Work to do tomorrow in `sc-stockday-ordering`

1. Confirm the frontend is reading from the production API you expect.
   - Current deployed frontend bundle is calling `/api/branch-stock`.
   - Confirm its API base URL targets `paasrtsm-project.onrender.com`.

2. After the Mother PC SQL fix, verify the branch-stock page with real products.
   - Confirm:
     - Thai name
     - English name
     - barcode
     - unit
     - branch quantities
     - total quantity

3. Remove dependence on fallback assumptions when source data becomes correct.
   - The frontend itself is not the root issue right now.
   - Keep focus on validating the source payload first.

## Known safe conclusion

- The sync route and database write path are functioning.
- The remaining issue is the quality of the branch-stock data extracted on the Mother PC.

## Files involved

- [scripts/lib/ada_sync_agent.js](C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/scripts/lib/ada_sync_agent.js)
- [apps/admin-api/src/routes/branch-stock.js](C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/apps/admin-api/src/routes/branch-stock.js)
- [tests/branch_stock_routes.test.js](C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/tests/branch_stock_routes.test.js)
