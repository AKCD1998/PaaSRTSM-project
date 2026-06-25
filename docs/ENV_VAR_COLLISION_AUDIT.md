# Env Var Collision Audit

Values are intentionally omitted. This report lists env names only.

## Tooling Availability

- `dotenv-linter`: not found
- `gitleaks`: not found
- `trufflehog`: not found

## Repos Scanned

| Repo | Prefix | Path |
|---|---|---|
| `SC-StockDay-Ordering` | `SC` | `C:\Users\scgro\Desktop\Webapp training project\SC-StockDay-Ordering` |
| `PaaSRTSM-project` | `PAASRTSM` | `C:\Users\scgro\Desktop\Webapp training project\PaaSRTSM-project` |

## Tracked Env Files

- None detected.

## Tracked Env Templates

- `SC-StockDay-Ordering` tracks template `.env.example`
- `SC-StockDay-Ordering` tracks template `apps/adapos-sync/.env.example`
- `SC-StockDay-Ordering` tracks template `apps/admin-web/.env.example`
- `SC-StockDay-Ordering` tracks template `apps/ocr-worker/.env.example`
- `SC-StockDay-Ordering` tracks template `apps/order-web/.env.example`
- `SC-StockDay-Ordering` tracks template `server/.env.example`
- `PaaSRTSM-project` tracks template `apps/admin-api/.env.example`
- `PaaSRTSM-project` tracks template `apps/admin-web/.env.example`

## Duplicate Keys Inside Env Files

- None detected.

## Duplicate Names Across Repos

| Severity | Name | Repos | Reason |
|---|---|---|---|
| Info | `ADAPOS_SQLSERVER_DATABASE` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SQLSERVER_HOST` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| P1 | `ADAPOS_SQLSERVER_PASSWORD` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Sensitive backend env name is duplicated and not project-scoped |
| Info | `ADAPOS_SQLSERVER_PORT` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SQLSERVER_USER` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SYNC_API_BASE_URL` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SYNC_BRANCH_CODE` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SYNC_DATASETS` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SYNC_DATE_CUTOFF` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SYNC_DRY_RUN` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `ADAPOS_SYNC_INTERVAL_MINUTES` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| P0 | `DATABASE_URL` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Known dangerous backend secret/config name duplicated across repos |
| Info | `DATA_MODE` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `DEFAULT_PERIOD_DAYS` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| Info | `SERVER_PORT` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Duplicate name found; verify runtime boundary |
| P2 | `VITE_API_BASE_URL` | `PaaSRTSM-project`, `SC-StockDay-Ordering` | Generic frontend build variable duplicated across repos; safe only when build environments are separate |

## Sample Occurrences

### `ADAPOS_SQLSERVER_DATABASE`

- `SC-StockDay-Ordering` `.env:11` (env-file)
- `SC-StockDay-Ordering` `.env.example:12` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:46` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:39` (env-file)

### `ADAPOS_SQLSERVER_HOST`

- `SC-StockDay-Ordering` `.env:7` (env-file)
- `SC-StockDay-Ordering` `.env.example:8` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:42` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:35` (env-file)

### `ADAPOS_SQLSERVER_PASSWORD`

- `SC-StockDay-Ordering` `.env:10` (env-file)
- `SC-StockDay-Ordering` `.env.example:11` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:45` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:38` (env-file)

### `ADAPOS_SQLSERVER_PORT`

- `SC-StockDay-Ordering` `.env:8` (env-file)
- `SC-StockDay-Ordering` `.env.example:9` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:43` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:36` (env-file)

### `ADAPOS_SQLSERVER_USER`

- `SC-StockDay-Ordering` `.env:9` (env-file)
- `SC-StockDay-Ordering` `.env.example:10` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:44` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:37` (env-file)

### `ADAPOS_SYNC_API_BASE_URL`

- `SC-StockDay-Ordering` `.env:14` (env-file)
- `SC-StockDay-Ordering` `.env.example:15` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:49` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:47` (env-file)

### `ADAPOS_SYNC_BRANCH_CODE`

- `SC-StockDay-Ordering` `apps/adapos-sync/.env.example:12` (env-file)
- `SC-StockDay-Ordering` `apps/adapos-sync/src/config.js:47` (process.env)
- `PaaSRTSM-project` `apps/admin-api/.env.example:44` (env-file)

### `ADAPOS_SYNC_DATASETS`

- `SC-StockDay-Ordering` `apps/adapos-sync/.env.example:11` (env-file)
- `SC-StockDay-Ordering` `apps/adapos-sync/src/config.js:48` (process.env)
- `PaaSRTSM-project` `apps/admin-api/.env.example:43` (env-file)

### `ADAPOS_SYNC_DATE_CUTOFF`

- `SC-StockDay-Ordering` `.env:15` (env-file)
- `SC-StockDay-Ordering` `apps/adapos-sync/.env.example:10` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:50` (env-file)
- `PaaSRTSM-project` `apps/admin-web/.env.example:17` (env-file)

### `ADAPOS_SYNC_DRY_RUN`

- `SC-StockDay-Ordering` `.env:13` (env-file)
- `SC-StockDay-Ordering` `.env.example:14` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:48` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:41` (env-file)

### `ADAPOS_SYNC_INTERVAL_MINUTES`

- `SC-StockDay-Ordering` `.env:12` (env-file)
- `SC-StockDay-Ordering` `.env.example:13` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:47` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:40` (env-file)

### `DATABASE_URL`

- `SC-StockDay-Ordering` `.env:3` (env-file)
- `SC-StockDay-Ordering` `.env.example:3` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:38` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:7` (env-file)

### `DATA_MODE`

- `SC-StockDay-Ordering` `.env:2` (env-file)
- `SC-StockDay-Ordering` `.env.example:2` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:37` (env-file)
- `PaaSRTSM-project` `apps/admin-web/.env.example:3` (env-file)

### `DEFAULT_PERIOD_DAYS`

- `SC-StockDay-Ordering` `server/.env:4` (env-file)
- `SC-StockDay-Ordering` `server/.env.example:4` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env.example:53` (env-file)

### `SERVER_PORT`

- `SC-StockDay-Ordering` `.env:1` (env-file)
- `SC-StockDay-Ordering` `.env.example:1` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:36` (env-file)
- `PaaSRTSM-project` `apps/admin-web/.env.example:2` (env-file)

### `VITE_API_BASE_URL`

- `SC-StockDay-Ordering` `.env:5` (env-file)
- `SC-StockDay-Ordering` `.env.example:5` (env-file)
- `PaaSRTSM-project` `apps/admin-api/.env:40` (env-file)
- `PaaSRTSM-project` `apps/admin-web/.env.example:7` (env-file)

## Recommended Follow-Up

- Rename P0/P1 backend secrets to project-scoped names before sharing one runtime.
- For one frontend app calling multiple modules, replace generic API prefix vars with `VITE_<PROJECT>_API_PREFIX`.
- Run `dotenv-linter` on `.env*` files when available.
- Run `gitleaks` or `trufflehog` before committing or deploying.
- Update code, workflows, env examples, deployment docs, and Render/GitHub variables together.
