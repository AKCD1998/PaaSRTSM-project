# Optional Shopee 004 availability reader

Depends on the SC-official durable Shopee ledger PR; it is not another reservation authority. Both old local `071` stock-request candidates remain untouched. No PaaS migration, POS query, stock write, Sync hook or Transfer Delta change is added.

`GET /api/branch-stock?stockView=hourly004-shopee` and the same export view compose the existing Hourly 004 reader with a fixed-origin, dedicated-token read from the SC ledger. Other branches, the default API and `stockView=hourly004` keep their existing quantities and behavior. Only 004 and its derived all-branch total change in the optional view.

`available = selected POS quantity - reserved - shipped-unposted`. Source POS quantity, its Hourly/Full Sync basis/time, reservation buckets, ledger as-of, cutover and last ingested email time are exposed separately. Zero and negatives remain numbers. A failed, stale technical response, paused/unconfigured ledger, pending/review queue, invalid scope/duplicates/units or timeout returns **unknown** availability, never unadjusted POS as available stock and never a made-up zero. Unknown totals/Excel cells stay unknown. Existing Full Sync fallback is still identified as the POS basis; it does not claim a new Hourly capture.

Defaults: `FEATURE_SHOPEE004_STOCK_AVAILABILITY=false`; dedicated server-only `SHOPEE004_STOCK_PROJECTION_TOKEN` unset. OFF makes zero bridge calls and preserves existing Hourly quantities. Never use a Sync/Delta key, expose this token through VITE, rotate existing credentials, or add it to a browser request. The upstream URL is pinned to the SC backend; redirects are rejected, total read deadline is 5 seconds and response size is bounded. No raw upstream error/body is logged.

## Later authorized activation

1. Review/merge/deploy the SC producer with its switch OFF, after reviewing its one pending additive SC migration. PaaS uses `checksPass` auto-deployment and `npm run db:migrate` pre-deploy: recheck the actual PaaS migration ceiling and ledger before merging this consumer even though this PR adds no migration.
2. Deploy this API with the new switch OFF **before** deploying the dependent StockDay UI. Check old POS-only contracts and current natural Hourly/Full Sync/Delta results without starting work.
3. Configure the dedicated read-only projection token on the two backends. Do not change actual environments during PR preparation.
4. Complete the SC runbook's explicit, physically reviewed pending-order opening set and separate reconciliation of historical shipped-but-unposted goods. The cutover is the DB-clock activation time, not mail arrival; replay/backfill cannot create new deductions for historical orders.
5. Producer live, dirty/review counts zero, actual ledger quantities checked, then enable only this availability switch. Compare a real confirmation/release and the selected POS basis against page/export; a count of passing tests is not proof of natural email coverage.

On failure, pause the producer, retain holds and keep the consumer view blocked. Do not delete the ledger/queue, reset the cutover, release all demand or call a POS-only view “available”. The original POS-only view remains available as explicitly POS-only evidence, and Hourly/Full Sync/Delta continue. Re-enabling must honor the existing epoch/holds.

This read view is email-order coverage, not Seller Centre completeness. A refund is not a physical return. Shopee currently is not posted in POS/AdaSmart; if that changes, pause and add exact issue/stock-basis reconciliation before proceeding. No guessed timestamp-based POS linkage is implemented. NOLOCK/ABA, different POS/ledger read times and business freshness remain unqualified. The technical 30-second response-age bound is transport validation, not a business freshness promise. Procurement recommendations and credit reservations are separate scope.
