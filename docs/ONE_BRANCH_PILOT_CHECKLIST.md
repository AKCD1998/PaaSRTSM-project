# One-Branch Pilot Checklist

Date: 2026-05-21

## Purpose

This document is the operational checklist for testing the new ADA raw-ingestion and transfer
reconciliation flow with one real branch.

This is a **pilot runbook only**.

- It does not change production behavior.
- It assumes AdaAcc remains read-only forever.
- It assumes the mother-PC sync agent is still local and opt-in.
- It assumes reconciliation actions stay app-owned inside PostgreSQL and never write back to AdaAcc.

## Pilot scope

Use one receiving branch only.

Recommended pilot branch:

- Branch `005`

Reason:

- it is a real branch, not HQ
- it matches the physical location of the pilot operator
- it keeps the first test narrow
- transfers from HQ `000` to branch `005` are easier to reason about than a multi-branch rollout

Do not enable multiple receiving branches in the first pilot.

## Systems involved

Source:

- AdaAcc SQL Server on the mother-PC / central server

Read-only sync agent:

- local script in this repo
- command: `npm run sync:ada-agent`

Backend ingestion:

- `/api/sync/ada/branches`
- `/api/sync/ada/products`
- `/api/sync/ada/transfers`
- `/api/sync/ada/run-log`

Derivation jobs:

- `npm run derive:ada-foundations`
- `npm run derive:ada-reconciliation`

Operational review UI:

- admin web `/reconciliation`

## Expected pilot data flow

1. Mother-PC sync agent reads AdaAcc using a read-only login.
2. Agent extracts source-shaped rows only.
3. Agent posts raw payloads to `/api/sync/ada/*`.
4. Backend stores raw evidence in `ada.*`.
5. Derivation jobs rebuild reconciliation tables from `ada.transfer_headers` and `ada.transfer_lines`.
6. Admin users review cases in `/reconciliation`.
7. Staff/admin confirm actual outcomes in app-owned `reconciliation.*` tables only.

What must not happen:

- no `INSERT`, `UPDATE`, `DELETE`, or `EXEC` against AdaAcc
- no direct mother-PC writes to Render PostgreSQL
- no local “smart” mismatch resolution inside the sync agent
- no silent correction of source-side discrepancies

## Pilot schedule

Recommended first schedule:

- Day 1:
  - dry-run only
  - one manual extraction pass
  - one manual derivation pass
  - one manual UI verification pass
- Day 2 to Day 3:
  - manual execute runs only
  - every 30 to 60 minutes during staffed hours
- Only after stable manual runs:
  - consider Windows Task Scheduler on the mother-PC

Recommended starting cadence:

- `09:00`
- `12:00`
- `15:00`
- `18:00`

Do not start with unattended high-frequency sync.

## Prerequisites

Before the pilot:

1. Database migrations already applied:
   - `npm run db:migrate`
2. Backend running with valid `POS_API_KEYS`.
3. Admin web deployed or reachable.
4. Mother-PC has:
   - repo checkout
   - Node.js runtime
   - read-only AdaAcc credentials
5. For live SQL Server mode only:
   - optional `mssql` package installed on the mother-PC

## Safe configuration

Use dry-run first.

Example environment values:

```env
ADAPOS_SYNC_DRIVER=sqlserver
ADAPOS_SQLSERVER_HOST=192.168.100.124
ADAPOS_SQLSERVER_PORT=1433
ADAPOS_SQLSERVER_USER=readonly_user
ADAPOS_SQLSERVER_PASSWORD=...
ADAPOS_SQLSERVER_DATABASE=AdaAcc
ADAPOS_SYNC_API_BASE_URL=https://your-admin-api.example.com
POS_API_KEYS=your-sync-api-key
ADAPOS_SYNC_DRY_RUN=true
ADAPOS_SYNC_DATASETS=branches,transfers
ADAPOS_SYNC_BRANCH_CODE=005
ADAPOS_SYNC_WATERMARK_FILE=./scripts/.ada_sync_watermarks.json
```

Branch filter support:

- yes, the sync agent now supports `--branch=005`
- current branch filter scope:
  - `branches`: selected branch plus HQ `000`
  - `transfers`: only transfers where source or destination branch matches the selected branch
  - `products`: not branch-scoped in AdaAcc, so for the safest one-branch pilot they should be omitted unless specifically needed

## Exact commands

### 1. Verify current dry-run simulation still works

```bash
npm run sync:ada-agent
```

Expected:

- no real AdaAcc reads
- no real backend dataset posts
- run-log post only if API base and key are configured

### 2. First live read-only extraction, still dry-run

```bash
npm run sync:ada-agent -- --dry-run --driver=sqlserver --branch=005 --datasets=branches,transfers
```

Expected:

- real read-only AdaAcc extraction
- branch-scoped to pilot branch `005` plus HQ context where applicable
- no dataset posts to `/api/sync/ada/*`
- no watermark advancement
- run-log records dry-run status if API base and key are configured

### 3. First manual execute pass for the pilot

Only do this after the dry-run output looks correct.

```bash
npm run sync:ada-agent -- --execute --driver=sqlserver --branch=005 --datasets=branches,transfers
```

Expected:

- posts `branches` and `transfers` only
- limited to pilot branch `005` plus HQ branch context for `branches`
- advances local watermarks only after successful post
- writes `/api/sync/ada/run-log`

### 4. Rebuild derived reconciliation state

```bash
npm run derive:ada-foundations
npm run derive:ada-reconciliation
```

### 5. Open admin reconciliation screen

Use the admin web route:

```text
/reconciliation
```

## How to verify transfer cases

After a manual execute pass:

1. Confirm sync run logged successfully.
2. Run:

```bash
npm run derive:ada-reconciliation
```

3. In admin web, open `/reconciliation`.
4. Filter to:
   - branch `005`
   - relevant date range
   - start with status `outbound_only`, `inbound_present_unprocessed`, and `ambiguous_match`
5. For each pilot transfer case, verify:
   - outbound doc number matches Ada source
   - inbound doc number appears when source uniquely matches
   - dispatch branch is `000` when HQ is the sender
   - receiving branch is `005` for the pilot target branch
   - expected quantity matches outbound source
   - source received quantity matches inbound source when present
   - line-level product/unit/lot rows look plausible

### Minimum SQL-level verification

If needed, validate by querying PostgreSQL after derivation:

```sql
SELECT
  case_key,
  outbound_doc_no,
  inbound_doc_no,
  dispatch_branch_code,
  receiving_branch_code,
  source_match_status,
  expected_total_qty_base,
  source_received_total_qty_base,
  qty_delta_source,
  latest_source_synced_at
FROM reconciliation.transfer_cases
WHERE receiving_branch_code = '005'
ORDER BY case_doc_date DESC, case_key ASC;
```

And:

```sql
SELECT
  case_key,
  product_code,
  lot_no,
  expiry_date,
  outbound_qty_base,
  inbound_qty_base,
  qty_delta_source,
  line_status
FROM reconciliation.transfer_case_lines
WHERE case_key = '<CASE_KEY>'
ORDER BY product_code, lot_no, expiry_date;
```

## How to report a mismatch

Use both the UI and an external pilot log.

Inside the app:

1. Open the reconciliation case.
2. Save actual received quantity per line where needed.
3. Record a discrepancy note with reason.
4. Add a timeline note if operational context matters.

Outside the app, log each mismatch with:

- pilot date/time
- branch code
- outbound doc number
- inbound doc number if present
- product code(s)
- expected qty
- actual received qty
- lot/expiry mismatch if any
- who verified it
- whether source issue, operational issue, or ambiguous source matching

Recommended mismatch categories:

- `short_shipment`
- `over_shipment`
- `damaged_in_transit`
- `wrong_item`
- `lot_mismatch`
- `expiry_mismatch`
- `missing_inbound_receipt`
- `ambiguous_source_match`

## Rollback / disable steps

These are the exact currently available disable steps.

### Disable live posting immediately

Switch back to dry-run:

```bash
npm run sync:ada-agent -- --dry-run --driver=sqlserver --branch=005 --datasets=branches,transfers
```

Or set:

```env
ADAPOS_SYNC_DRY_RUN=true
```

### Disable live AdaAcc extraction entirely

Switch back to simulation mode:

```bash
npm run sync:ada-agent -- --dry-run --driver=simulation --branch=005 --datasets=branches,transfers
```

Or set:

```env
ADAPOS_SYNC_DRIVER=simulation
```

### Stop scheduled runs

If using Windows Task Scheduler, disable the scheduled task on the mother-PC.

There is no repo-managed scheduler yet, so disablement is operational:

- disable the Windows scheduled task
- or remove the trigger
- or stop invoking `npm run sync:ada-agent -- --execute --driver=sqlserver --branch=005 --datasets=branches,transfers`

### Prevent derivation refresh from changing app-facing reconciliation source state

Do not run:

```bash
npm run derive:ada-reconciliation
```

This does not remove existing app-owned manual reconciliation actions, but it does stop source-derived case refresh.

### Watermark reset

Because watermarks are local-file based, disabling the pilot does not require watermark deletion.

If a re-run from an earlier point is needed, back up then edit or replace:

```text
scripts/.ada_sync_watermarks.json
```

Only do this intentionally and document the reset reason.

## Success criteria

The one-branch pilot is successful if all of the following are true:

1. AdaAcc extraction remains read-only throughout.
2. At least one real execute sync runs successfully for branch `005`.
3. Transfer cases for branch `005` appear in `/reconciliation`.
4. Case counts and line details are plausible against real source documents.
5. Staff/admin can:
   - identify the right case
   - compare expected vs actual
   - record discrepancy notes
   - append timeline notes
   - approve or cancel/reopen cases
6. No backend write is made to AdaAcc.
7. No manual database patch is required in PostgreSQL to make the workflow usable.
8. Watermarks advance only on successful non-dry-run posts.
9. Disabling the pilot is operationally simple.

## Known risks

1. Source sync lag:
   central AdaAcc may be behind branch reality by 1 to 8+ days.

2. Transfer matching ambiguity:
   current match methods are intentionally conservative; some real documents may remain ambiguous.

3. Full-refresh behavior for some datasets:
   `branches` is narrow-filtered for the pilot, but `products` is not branch-scoped in AdaAcc and should stay out of the safest first pilot pass.

4. Transfer watermark simplicity:
   current transfer extraction uses a date-style watermark and may need refinement after the pilot.

5. No scheduler in repo:
   unattended pilot scheduling is external and must be controlled carefully.

6. Mother-PC dependency:
   live SQL Server mode depends on local environment setup and optional `mssql` install.

7. Human-process risk:
   if branch staff do not report actual received outcomes consistently, app-owned reconciliation quality will still drift.

## Pilot recommendation

Run the first branch pilot manually.

Recommended first sequence:

1. `npm run sync:ada-agent -- --dry-run --driver=sqlserver --branch=005 --datasets=branches,transfers`
2. inspect output
3. `npm run sync:ada-agent -- --execute --driver=sqlserver --branch=005 --datasets=branches,transfers`
4. `npm run derive:ada-foundations`
5. `npm run derive:ada-reconciliation`
6. review `/reconciliation` for branch `005`
7. record one or more real mismatches if present
8. switch back to dry-run if anything is unclear

### Exact branch-005 command set

SQL Server dry-run for branch `005`:

```bash
npm run sync:ada-agent -- --dry-run --driver=sqlserver --branch=005 --datasets=branches,transfers
```

One manual execute pass for branch `005`:

```bash
npm run sync:ada-agent -- --execute --driver=sqlserver --branch=005 --datasets=branches,transfers
```

Derivation refresh:

```bash
npm run derive:ada-foundations
npm run derive:ada-reconciliation
```

Reconciliation verification:

1. Open `/reconciliation`
2. Filter branch = `005`
3. Check statuses:
   - `outbound_only`
   - `inbound_present_unprocessed`
   - `ambiguous_match`
   - `inbound_processed`
4. Compare real transfer documents against `reconciliation.transfer_cases` and `reconciliation.transfer_case_lines`

Rollback / disable:

```bash
npm run sync:ada-agent -- --dry-run --driver=sqlserver --branch=005 --datasets=branches,transfers
npm run sync:ada-agent -- --dry-run --driver=simulation --branch=005 --datasets=branches,transfers
```

That is the safest path to a one-branch pilot without changing production behavior.
