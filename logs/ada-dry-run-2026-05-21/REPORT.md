# ADA End-to-End Dry Run Report

Date: 2026-05-21

Scope:
- Ingest sample ADA payloads through `/api/sync/ada/*`
- Run foundation, analytics, and reconciliation derivations
- Verify derived rows in `core.branches`, `public.skus`, `analytics.*`, and `reconciliation.*`

Artifacts:
- Payloads: [branches.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/branches.json), [products.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/products.json), [stock-snapshots.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/stock-snapshots.json), [sales.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/sales.json), [purchases.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/purchases.json), [transfers.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/transfers.json)
- Route responses: [branches.response.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/branches.response.json), [products.response.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/products.response.json), [stock-snapshots.response.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/stock-snapshots.response.json), [sales.response.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/sales.response.json), [purchases.response.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/purchases.response.json), [transfers.response.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/transfers.response.json)
- Derivation outputs: [derive-foundations.txt](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/derive-foundations.txt), [derive-analytics-standard.txt](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/derive-analytics-standard.txt), [derive-reconciliation.txt](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/derive-reconciliation.txt)
- Verified derived rows: [derived-outputs.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/derived-outputs.json)

## Commands Used

1. Apply schema and derivation migrations:

```powershell
npm run db:migrate
```

2. Start the admin API on a temporary local port with a temporary sync API key:

```powershell
$envPath = Join-Path (Get-Location) 'apps\admin-api\.env'; Get-Content $envPath | ForEach-Object { if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }; $parts = $_ -split '=',2; $key = $parts[0].Trim(); $value = $parts[1].Trim().Trim('"'); if (-not [string]::IsNullOrWhiteSpace($key) -and -not [string]::IsNullOrWhiteSpace($value) -and -not (Test-Path ("Env:" + $key))) { Set-Item -Path ("Env:" + $key) -Value $value } }; $env:PORT='3101'; $env:POS_API_KEYS='ada-dry-run-key'; $p = Start-Process node -ArgumentList 'apps/admin-api/src/server.js' -WindowStyle Hidden -PassThru; Write-Output "PID=$($p.Id) PORT=$env:PORT"
```

3. Verify the API is reachable:

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3101/admin/health' | ConvertTo-Json -Compress
```

4. Post sample payloads through the ADA sync routes:

```powershell
$dir = Join-Path (Get-Location) 'logs\ada-dry-run-2026-05-21';
$headers = @{ 'x-api-key' = 'ada-dry-run-key' };
$requests = @(
  @{ Route = 'branches'; File = 'branches.json' },
  @{ Route = 'products'; File = 'products.json' },
  @{ Route = 'stock-snapshots'; File = 'stock-snapshots.json' },
  @{ Route = 'sales'; File = 'sales.json' },
  @{ Route = 'purchases'; File = 'purchases.json' },
  @{ Route = 'transfers'; File = 'transfers.json' }
);
foreach ($req in $requests) {
  $body = Get-Content (Join-Path $dir $req.File) -Raw;
  $resp = Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:3101/api/sync/ada/" + $req.Route) -Headers $headers -ContentType 'application/json' -Body $body;
  $json = $resp | ConvertTo-Json -Compress -Depth 10;
  Set-Content -Path (Join-Path $dir ($req.Route + '.response.json')) -Value $json;
  Write-Output ($req.Route + ' => ' + $json);
}
```

5. Run the derivation commands:

```powershell
npm run derive:ada-foundations
npm run derive:ada-analytics:standard
npm run derive:ada-reconciliation
```

6. Query derived output rows for the sample identifiers:

```powershell
node -
```

The exact query result is saved in [derived-outputs.json](/C:/Users/scgro/Desktop/Webapp training project/PaaSRTSM-project/logs/ada-dry-run-2026-05-21/derived-outputs.json).

## Expected Outputs

Ingestion expectations:
- `branches`: accept 2 records
- `products`: accept 1 record
- `stock-snapshots`: accept 1 record
- `sales`: accept 1 header and 1 line
- `purchases`: accept 1 header and 1 line
- `transfers`: accept 2 headers and 2 lines

Derivation expectations:
- Foundations should upsert 2 branches, 1 product-backed item/SKU, and 2 barcodes
- Standard analytics should insert:
  - 1 stock snapshot row
  - 3 sales summary rows for 7/30/90 day windows
  - 3 purchase summary rows for 7/30/90 day windows
- Reconciliation should insert:
  - 2 transfer documents
  - 2 transfer document lines
  - 1 match candidate
  - 1 transfer case
  - 1 transfer case line

Verification expectations:
- `core.branches` contains branch codes `900` and `901`
- `public.skus` contains product code `ADA-DRY-001`
- `analytics.*` contains rows for `ADA-DRY-001`
- `reconciliation.*` contains rows for `ADA-TRF-OUT-001` and `ADA-TRF-IN-001`

## Actual Outputs

API health check:

```json
{"ok":true,"service":"admin-api","request_id":"0666606c-7768-4215-917b-d411bc36e628","now":"2026-05-21T02:10:46.724Z"}
```

Ingestion responses:

```text
branches => {"accepted":2,"syncRunId":null}
products => {"accepted":1,"syncRunId":null}
stock-snapshots => {"accepted":1,"syncRunId":null}
sales => {"acceptedHeaders":1,"acceptedLines":1}
purchases => {"acceptedHeaders":1,"acceptedLines":1}
transfers => {"acceptedHeaders":2,"acceptedLines":2}
```

Foundation derivation:

```text
Ada foundation derivation completed.
core.branches_upserted: 2
public.items_updated: 0
public.items_inserted: 1
public.skus_upserted: 1
public.barcodes_deleted: 0
public.barcodes_upserted: 2
```

Analytics derivation:

```text
Ada analytics derivation completed for standard windows: 7, 30, 90.
analytics.product_stock_snapshots_deleted: 0
analytics.product_stock_snapshots_inserted: 1
analytics.product_sales_summary_periods_deleted[7d]: 0
analytics.product_sales_summary_periods_inserted[7d]: 1
analytics.product_purchase_summary_periods_deleted[7d]: 0
analytics.product_purchase_summary_periods_inserted[7d]: 1
analytics.product_sales_summary_periods_deleted[30d]: 0
analytics.product_sales_summary_periods_inserted[30d]: 1
analytics.product_purchase_summary_periods_deleted[30d]: 0
analytics.product_purchase_summary_periods_inserted[30d]: 1
analytics.product_sales_summary_periods_deleted[90d]: 0
analytics.product_sales_summary_periods_inserted[90d]: 1
analytics.product_purchase_summary_periods_deleted[90d]: 0
analytics.product_purchase_summary_periods_inserted[90d]: 1
```

Reconciliation derivation:

```text
Ada transfer reconciliation derivation completed.
reconciliation.transfer_case_lines_deleted: 0
reconciliation.transfer_cases_deleted: 0
reconciliation.transfer_match_candidates_deleted: 0
reconciliation.transfer_document_lines_deleted: 0
reconciliation.transfer_documents_deleted: 0
reconciliation.transfer_documents_inserted: 2
reconciliation.transfer_document_lines_inserted: 2
reconciliation.transfer_match_candidates_inserted: 1
reconciliation.transfer_cases_inserted: 1
reconciliation.transfer_case_lines_inserted: 1
```

Verified derived rows:

- `core.branches`
  - `900` => `ADA Dry Run Dispatch`
  - `901` => `ADA Dry Run Receiving`
- `public.skus`
  - `ADA-DRY-001` => `display_name=ADA Dry Run Product 001`, `uom=BOX`, `min_stock=2.0000`, `max_stock=20.0000`
- `analytics.product_stock_snapshots`
  - `ADA-DRY-001` => `snapshot_at=2026-05-21T02:17:00+00:00`, `stock_current=12.0000`
- `analytics.product_sales_summary_periods`
  - `7d` => `period_start=2026-05-14`, `period_end=2026-05-20`, `sold_qty_base=2.0000`, `avg_daily_usage=0.2857`
  - `30d` => `period_start=2026-04-21`, `period_end=2026-05-20`, `sold_qty_base=2.0000`, `avg_daily_usage=0.0667`
  - `90d` => `period_start=2026-02-20`, `period_end=2026-05-20`, `sold_qty_base=2.0000`, `avg_daily_usage=0.0222`
- `analytics.product_purchase_summary_periods`
  - `7d` => `period_start=2026-05-13`, `period_end=2026-05-19`, `purchased_qty_base=5.0000`
  - `30d` => `period_start=2026-04-20`, `period_end=2026-05-19`, `purchased_qty_base=5.0000`
  - `90d` => `period_start=2026-02-19`, `period_end=2026-05-19`, `purchased_qty_base=5.0000`
- `reconciliation.transfer_documents`
  - `ADA-TRF-OUT-001` matched uniquely to `ADA-TRF-IN-001` with `source_match_method=inbound_reference_doc`
  - `ADA-TRF-IN-001` matched uniquely back to `ADA-TRF-OUT-001`
- `reconciliation.transfer_cases`
  - `outbound:900:4:ADA-TRF-OUT-001` => `source_match_status=inbound_processed`, `qty_delta_source=0.0000`
- `reconciliation.transfer_case_lines`
  - `ADA-DRY-001` => `outbound_qty_base=3.0000`, `inbound_qty_base=3.0000`, `line_status=matched`

## Mismatch Found

No pipeline-breaking mismatch was found.

One non-blocking observation appeared during verification:
- When queried through Node `pg` without explicit `::text` casts, `date` columns such as `period_start` and `period_end` were serialized as UTC timestamps offset from the stored calendar date.
- Direct SQL text casts confirmed the stored database values were correct dates.
- This is a query-client display artifact, not an ADA derivation or schema failure.

## Conclusion

The ADA pipeline is runnable end to end in this environment:
- HTTP ingestion through `/api/sync/ada/*` worked for sample branch, product, stock snapshot, sales, purchase, and transfer payloads.
- `npm run derive:ada-foundations` completed successfully and populated `core.branches` and `public.skus`.
- `npm run derive:ada-analytics:standard` completed successfully and populated stock, sales, and purchase analytics rows.
- `npm run derive:ada-reconciliation` completed successfully and produced matched transfer reconciliation outputs.

No code or schema change was required for this dry run.
