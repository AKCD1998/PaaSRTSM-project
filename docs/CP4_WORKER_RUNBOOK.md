# CP4 async worker runbook

The CP4 API and worker are separate processes. Deploying only the existing web
service is not enough to apply queued batches.

## Release gate

Keep `SYNC_V2_ALLOWED_DATASETS` and `SYNC_V2_ALLOWED_BRANCHES` empty until all
of the following are true:

1. migration `060_add_async_ingestion_queue.sql` has completed;
2. the API revision and worker revision are the same reviewed commit;
3. a background worker runs `npm run sync:worker` with the same database URL;
4. worker logs contain `{"component":"sync-worker","event":"STARTED"}` and
   continue to contain `HEARTBEAT` at the configured interval;
5. the Agent's `ADAPOS_SYNC_V2_BATCH_SIZE` is less than or equal to the
   Backend's `SYNC_V2_MAX_BATCH_RECORDS`.

Do not run the worker inside the web process. Provision it as a separately
restartable background service so web deploys and worker failures are visible
independently. Start with one worker instance. Multi-worker scaling is allowed
only after the real-PostgreSQL concurrent-final-batch regression test passes in
the deployed revision.

## Start and health evidence

Start command:

```text
npm run sync:worker
```

Healthy evidence requires recurring `HEARTBEAT` events, not only a process in
the platform's "running" state. Alert when no heartbeat is observed for more
than three `WORKER_HEARTBEAT_INTERVAL_MS` periods, or when `DEAD_LETTER` appears.

## Retention

The worker periodically removes batch payloads only after their outcome is
terminal:

- applied batches belonging to successful runs after
  `WORKER_APPLIED_RETENTION_DAYS` (default 30);
- applied and dead-letter batches belonging to fully drained failed runs after
  `WORKER_TERMINAL_RETENTION_DAYS` (default 90);
- staged batches belonging to failed, never-finalized runs after
  `WORKER_ABANDONED_STAGED_RETENTION_DAYS` (default 7).

Run rows and their terminal message/counters remain available for audit. The
cleanup never selects queued, retrying, or processing work.

## Enablement order

1. Deploy migration, API, and worker with both v2 allowlists empty.
2. Observe worker heartbeats and run the non-production CP4 smoke test.
3. Enable Backend dataset `branch_stock` for one non-production branch.
4. Set the matching Agent flag and verify `QUEUED` followed by `APPLIED`.
5. Expand one branch at a time. Clearing the Agent v2 dataset flag returns that
   Agent to v1; clearing the Backend allowlists blocks new hybrid runs.
