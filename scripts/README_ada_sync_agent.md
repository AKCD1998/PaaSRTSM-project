# ADA Sync Agent

Local mother-PC sync agent scaffold for read-only AdaAcc extraction into the backend's
`/api/sync/ada/*` endpoints.

## Safety rules

- Read-only only: the live SQL Server extractor uses `SELECT` queries only.
- Dry-run is the default.
- No direct PostgreSQL writes from the agent.
- No business decisions locally. The agent only extracts source-shaped records, posts them, and logs runs.
- Production sync is not enabled by default.

## Current datasets

- `branches`
- `products`
- `transfers`

The agent is intentionally narrow for the first connection step.

## Branch pilot filter

The agent now supports a single-branch pilot filter:

```bash
--branch=005
```

Or:

```env
ADAPOS_SYNC_BRANCH_CODE=005
```

Current behavior:

- `branches`: filtered to the selected branch plus HQ `000`
- `transfers`: filtered to transfers where source or destination branch matches the selected branch
- `products`: not branch-scoped in AdaAcc, so if `products` is included it remains a global product-master extract

For the safest one-branch reconciliation pilot, prefer:

- `--datasets=branches,transfers`

## Run in simulation mode

```bash
npm run sync:ada-agent
```

This uses:

- `ADAPOS_SYNC_DRIVER=simulation`
- `ADAPOS_SYNC_DRY_RUN=true`
- fixture: `scripts/fixtures/ada_sync_simulation.json`

## Run execute mode against the backend

```bash
npm run sync:ada-agent -- --execute --driver=simulation
```

This posts fixture payloads to `/api/sync/ada/*` and writes run logs to `/api/sync/ada/run-log`.

## Prepare live SQL Server mode

Set:

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
ADAPOS_SYNC_BRANCH_CODE=005
```

Important:

- Keep `ADAPOS_SYNC_DRY_RUN=true` for the first live extraction pass.
- The live extractor requires the optional `mssql` package on the mother-PC.
- Watermarks are stored locally in `ADAPOS_SYNC_WATERMARK_FILE`.

## Safest branch-005 pilot commands

Dry-run:

```bash
npm run sync:ada-agent -- --dry-run --driver=sqlserver --branch=005 --datasets=branches,transfers
```

Manual execute pass:

```bash
npm run sync:ada-agent -- --execute --driver=sqlserver --branch=005 --datasets=branches,transfers
```

Disable / revert:

```bash
npm run sync:ada-agent -- --dry-run --driver=simulation --branch=005 --datasets=branches,transfers
```

## Watermarks

Watermarks are per dataset and only advance after a successful non-dry-run post.

Example:

```json
{
  "branches": "2026-05-21T08:00:00.000Z",
  "products": "2026-05-21T08:05:00.000Z",
  "transfers": "2026-05-21T08:10:00.000Z"
}
```

## Notes

- `branches` and `products` currently use full refresh-style extraction.
- `transfers` currently uses a date watermark and posts source-shaped headers plus lines.
- Sales, purchases, stock snapshots, and other datasets can be added later without changing the safety model.
