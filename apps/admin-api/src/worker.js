"use strict";

const { loadConfig } = require("./config");
const { createDbPool } = require("./db");
const { branchStockValueKeys, firstDefined } = require("./sync-v2-contract");
const {
  buildBranchStockReconciliationManifest, compareManifests, buildMismatchExamples,
} = require("./services/branchStockReconciliation");

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 2_000);
const STUCK_PROCESSING_MINUTES = Number(process.env.WORKER_STUCK_PROCESSING_MINUTES || 10);
const REAPER_INTERVAL_MS = Number(process.env.WORKER_REAPER_INTERVAL_MS || 60_000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 60_000);
const PRUNE_INTERVAL_MS = Number(process.env.WORKER_PRUNE_INTERVAL_MS || 6 * 60 * 60 * 1_000);
const APPLIED_RETENTION_DAYS = Number(process.env.WORKER_APPLIED_RETENTION_DAYS || 30);
const TERMINAL_RETENTION_DAYS = Number(process.env.WORKER_TERMINAL_RETENTION_DAYS || 90);
const ABANDONED_STAGED_RETENTION_DAYS = Number(process.env.WORKER_ABANDONED_STAGED_RETENTION_DAYS || 7);
const RECONCILIATION_RETENTION_DAYS = Number(process.env.WORKER_RECONCILIATION_RETENTION_DAYS || 90);
const RETIREMENT_RETENTION_DAYS = Number(process.env.WORKER_RETIREMENT_RETENTION_DAYS || 90);

const BRANCH_COLUMNS = Object.freeze({
  "000": { qty: "qty_branch_000", cost: "cost_avg_branch_000", freshness: "synced_at_branch_000", fullSyncRunId: "full_sync_run_id_branch_000" },
  "001": { qty: "qty_branch_001", cost: "cost_avg_branch_001", freshness: "synced_at_branch_001", fullSyncRunId: "full_sync_run_id_branch_001" },
  "002": { qty: "qty_branch_002", cost: "cost_avg_branch_002", freshness: "synced_at_branch_002", fullSyncRunId: "full_sync_run_id_branch_002" },
  "003": { qty: "qty_branch_003", cost: "cost_avg_branch_003", freshness: "synced_at_branch_003", fullSyncRunId: "full_sync_run_id_branch_003" },
  "004": { qty: "qty_branch_004", cost: "cost_avg_branch_004", freshness: "synced_at_branch_004", fullSyncRunId: "full_sync_run_id_branch_004" },
  "005": { qty: "qty_branch_005", cost: "cost_avg_branch_005", freshness: "synced_at_branch_005", fullSyncRunId: "full_sync_run_id_branch_005" },
});

function backoffMs(attempts) {
  return Math.min(60_000, 1_000 * 2 ** attempts);
}

function logWorkerEvent(event, batch, extra = {}) {
  console.log(JSON.stringify({
    component: "sync-worker",
    event,
    runId: batch.sync_run_id == null ? null : String(batch.sync_run_id),
    batchId: batch.batch_id == null ? null : String(batch.batch_id),
    dataset: batch.dataset || null,
    batchSeq: batch.batch_seq == null ? null : batch.batch_seq,
    attempts: batch.attempts == null ? null : batch.attempts,
    ...extra,
  }));
}

function value(record, ...keys) {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function normalizeBranchStock(records, branchCode) {
  const columns = BRANCH_COLUMNS[branchCode];
  if (!columns) throw new Error(`Unsupported branch code "${branchCode}".`);
  const keys = branchStockValueKeys(branchCode);
  const seen = new Set();
  return records.map((record, index) => {
    const productCode = String(value(record, "productCode", "product_code") || "").trim();
    const qty = Number(firstDefined(record, keys.qty));
    const rawCost = firstDefined(record, keys.cost);
    const cost = rawCost === undefined || rawCost === null || rawCost === "" ? null : Number(rawCost);
    const sourceTimestamp = new Date(value(record, "syncedAt", "synced_at", "sourceSyncedAt", "source_synced_at"));
    if (!productCode) throw new Error(`records[${index}] requires productCode.`);
    if (seen.has(productCode)) throw new Error(`Duplicate productCode "${productCode}" in one batch.`);
    seen.add(productCode);
    if (!Number.isFinite(qty)) throw new Error(`records[${index}] has invalid qty.`);
    if (cost !== null && !Number.isFinite(cost)) throw new Error(`records[${index}] has invalid costAvg.`);
    if (Number.isNaN(sourceTimestamp.getTime())) throw new Error(`records[${index}] has invalid syncedAt.`);
    return {
      productCode,
      productNameThai: String(value(record, "productNameThai", "product_name_thai") || "").trim() || null,
      productNameEng: String(value(record, "productNameEng", "product_name_eng") || "").trim() || null,
      barcode: String(value(record, "barcode") || "").trim() || null,
      unit: String(value(record, "unit") || "").trim() || null,
      qty,
      cost,
      sourceTimestamp: sourceTimestamp.toISOString(),
      sourceSystem: String(value(record, "sourceSystem", "source_system") || "AdaAcc").trim(),
      sourceTable: String(value(record, "sourceTable", "source_table") || "TCNTPdtInWha").trim(),
      rawPayload: value(record, "rawPayload", "raw_payload") ?? record,
    };
  }).sort((a, b) => a.productCode.localeCompare(b.productCode));
}

async function applyBranchStockBatch(client, records, branchCode, syncRunId = null) {
  const columns = BRANCH_COLUMNS[branchCode];
  const normalized = normalizeBranchStock(records, branchCode);
  if (normalized.length === 0) return;
  const unnestParams = [
    normalized.map((r) => r.productCode), normalized.map((r) => r.productNameThai),
    normalized.map((r) => r.productNameEng), normalized.map((r) => r.barcode),
    normalized.map((r) => r.unit), normalized.map((r) => r.qty),
    normalized.map((r) => r.cost), normalized.map((r) => r.sourceTimestamp),
    normalized.map((r) => r.sourceSystem), normalized.map((r) => r.sourceTable),
    normalized.map((r) => JSON.stringify(r.rawPayload)),
  ];
  // Column names come only from BRANCH_COLUMNS, never from request input.
  // ${columns.fullSyncRunId} records which full-snapshot generation (WP: branch
  // stock generation round, _ledger/claude.md CLAIM-C-046) last touched this
  // branch's data for this row; only stamped when this batch is itself part of
  // a full-snapshot generation (syncRunId not null) — same freshness guard as
  // the rest of this row, so an out-of-order arrival can never move it backward.
  await client.query(
    `INSERT INTO ada.branch_stock_snapshots
       (product_code, product_name_thai, product_name_eng, barcode, unit,
        ${columns.qty}, ${columns.cost}, ${columns.freshness}, ${columns.fullSyncRunId}, qty_total_all_branches,
        synced_at, source_system, source_table, source_synced_at, raw_payload, updated_at)
     SELECT x.product_code, x.product_name_thai, x.product_name_eng, x.barcode, x.unit,
            x.qty, x.cost, x.source_timestamp, $12::bigint, x.qty,
            x.source_timestamp, x.source_system, x.source_table, x.source_timestamp, x.raw_payload, now()
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                 $6::numeric[], $7::numeric[], $8::timestamptz[], $9::text[],
                 $10::text[], $11::jsonb[])
       AS x(product_code, product_name_thai, product_name_eng, barcode, unit,
            qty, cost, source_timestamp, source_system, source_table, raw_payload)
     ON CONFLICT (product_code) DO UPDATE SET
       product_name_thai = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN COALESCE(EXCLUDED.product_name_thai, ada.branch_stock_snapshots.product_name_thai) ELSE ada.branch_stock_snapshots.product_name_thai END,
       product_name_eng = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN COALESCE(EXCLUDED.product_name_eng, ada.branch_stock_snapshots.product_name_eng) ELSE ada.branch_stock_snapshots.product_name_eng END,
       barcode = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN COALESCE(EXCLUDED.barcode, ada.branch_stock_snapshots.barcode) ELSE ada.branch_stock_snapshots.barcode END,
       unit = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN COALESCE(EXCLUDED.unit, ada.branch_stock_snapshots.unit) ELSE ada.branch_stock_snapshots.unit END,
       ${columns.qty} = EXCLUDED.${columns.qty},
       ${columns.cost} = COALESCE(EXCLUDED.${columns.cost}, ada.branch_stock_snapshots.${columns.cost}),
       ${columns.freshness} = EXCLUDED.${columns.freshness},
       ${columns.fullSyncRunId} = CASE WHEN $12::bigint IS NULL THEN ada.branch_stock_snapshots.${columns.fullSyncRunId} ELSE $12::bigint END,
       qty_total_all_branches =
         ${columns.qty === "qty_branch_000" ? `EXCLUDED.${columns.qty}` : "ada.branch_stock_snapshots.qty_branch_000"} +
         ${columns.qty === "qty_branch_001" ? `EXCLUDED.${columns.qty}` : "ada.branch_stock_snapshots.qty_branch_001"} +
         ${columns.qty === "qty_branch_002" ? `EXCLUDED.${columns.qty}` : "ada.branch_stock_snapshots.qty_branch_002"} +
         ${columns.qty === "qty_branch_003" ? `EXCLUDED.${columns.qty}` : "ada.branch_stock_snapshots.qty_branch_003"} +
         ${columns.qty === "qty_branch_004" ? `EXCLUDED.${columns.qty}` : "ada.branch_stock_snapshots.qty_branch_004"} +
         ${columns.qty === "qty_branch_005" ? `EXCLUDED.${columns.qty}` : "ada.branch_stock_snapshots.qty_branch_005"},
       synced_at = GREATEST(ada.branch_stock_snapshots.synced_at, EXCLUDED.synced_at),
       source_synced_at = GREATEST(ada.branch_stock_snapshots.source_synced_at, EXCLUDED.source_synced_at),
       source_system = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN EXCLUDED.source_system ELSE ada.branch_stock_snapshots.source_system END,
       source_table = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN EXCLUDED.source_table ELSE ada.branch_stock_snapshots.source_table END,
       raw_payload = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN EXCLUDED.raw_payload ELSE ada.branch_stock_snapshots.raw_payload END,
       updated_at = now()
     WHERE ada.branch_stock_snapshots.${columns.freshness} IS NULL
        OR ada.branch_stock_snapshots.${columns.freshness} <= EXCLUDED.${columns.freshness}`,
    [...unnestParams, syncRunId],
  );

  // WP3 Phase 1 dual-write (_ledger/claude.md CLAIM-C-019/X-034; migrations/066):
  // same transaction/batch as the wide-table upsert above, writing the SAME
  // normalized records into ada.branch_stock_current — no per-branch column
  // templating needed here (branch_code is data, not a column name), which is
  // exactly the simplification this table exists to prove out. Nothing reads
  // from this table yet.
  await client.query(
    `INSERT INTO ada.branch_stock_current
       (product_code, branch_code, qty, cost_avg, synced_at, source_system, source_table, source_synced_at, raw_payload, last_full_sync_run_id, updated_at)
     SELECT x.product_code, $12, x.qty, x.cost, x.source_timestamp,
            x.source_system, x.source_table, x.source_timestamp, x.raw_payload, $13::bigint, now()
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                 $6::numeric[], $7::numeric[], $8::timestamptz[], $9::text[],
                 $10::text[], $11::jsonb[])
       AS x(product_code, product_name_thai, product_name_eng, barcode, unit,
            qty, cost, source_timestamp, source_system, source_table, raw_payload)
     ON CONFLICT (product_code, branch_code) DO UPDATE SET
       qty = EXCLUDED.qty,
       cost_avg = COALESCE(EXCLUDED.cost_avg, ada.branch_stock_current.cost_avg),
       synced_at = EXCLUDED.synced_at,
       source_synced_at = EXCLUDED.source_synced_at,
       source_system = EXCLUDED.source_system,
       source_table = EXCLUDED.source_table,
       raw_payload = EXCLUDED.raw_payload,
       last_full_sync_run_id = CASE WHEN $13::bigint IS NULL THEN ada.branch_stock_current.last_full_sync_run_id ELSE $13::bigint END,
       updated_at = now()
     WHERE ada.branch_stock_current.synced_at IS NULL
        OR ada.branch_stock_current.synced_at <= EXCLUDED.synced_at`,
    [...unnestParams, branchCode, syncRunId],
  );
}

const APPLIERS = { branch_stock: applyBranchStockBatch };

async function claimNextBatch(db) {
  const result = await db.query(`
    UPDATE ingest.sync_batches b
    SET status = 'processing', claimed_at = now(), attempts = b.attempts + 1
    FROM ingest.sync_runs r
    WHERE b.batch_id = (
      SELECT candidate.batch_id FROM ingest.sync_batches candidate
      JOIN ingest.sync_runs candidate_run ON candidate_run.sync_run_id = candidate.sync_run_id
      WHERE candidate.status IN ('queued', 'retry_wait')
        AND candidate.next_attempt_at <= now()
        AND candidate_run.status IN ('running', 'failed')
        AND candidate_run.handoff_status = 'success'
        AND candidate_run.finalized_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ingest.sync_runs earlier_run
          JOIN ingest.branch_stock_reconciliations earlier_reconciliation
            ON earlier_reconciliation.sync_run_id = earlier_run.sync_run_id
          WHERE earlier_run.branch_code = candidate_run.branch_code
            AND earlier_run.sync_run_id < candidate_run.sync_run_id
            AND (
              earlier_reconciliation.status IN ('processing', 'retry_wait')
              OR (
                earlier_reconciliation.status = 'pending'
                AND (
                  (earlier_run.ingestion_mode = 'hybrid_v2' AND earlier_run.status <> 'failed')
                  OR (earlier_run.ingestion_mode = 'v1' AND earlier_run.status = 'success')
                )
              )
            )
        )
      ORDER BY candidate.queued_at, candidate.batch_id
      FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
    ) AND r.sync_run_id = b.sync_run_id
    RETURNING b.batch_id, b.sync_run_id, b.dataset, b.batch_seq, b.payload,
              b.attempts, b.max_attempts, r.branch_code
  `);
  const batch = result.rows[0] || null;
  if (batch) logWorkerEvent("CLAIMED", batch);
  return batch;
}

async function claimNextReconciliation(db) {
  // Generation remediation round (_ledger/claude.md CLAIM-X-047, fixed by
  // C-052): reconciliation is no longer eligible on run completion alone.
  // It additionally requires a `done` row in ingest.branch_stock_retirements
  // for the SAME sync_run_id — enforcing "stock apply complete -> retirement
  // complete -> reconciliation eligible" directly in the claim query itself,
  // not via caller-side sequencing. A `refused`/`dead_letter` retirement
  // never produces a `done` row, so that generation's reconciliation simply
  // never becomes eligible — terminal retry exhaustion cannot silently
  // certify reconciliation.
  const result = await db.query(`
    UPDATE ingest.branch_stock_reconciliations reconciliation
    SET status = 'processing', claimed_at = now(),
        attempts = reconciliation.attempts + 1, updated_at = now()
    FROM ingest.sync_runs run
    WHERE reconciliation.sync_run_id = (
      SELECT candidate.sync_run_id
      FROM ingest.branch_stock_reconciliations candidate
      JOIN ingest.sync_runs candidate_run ON candidate_run.sync_run_id = candidate.sync_run_id
      WHERE candidate.status IN ('pending', 'retry_wait')
        AND candidate.next_attempt_at <= now()
        AND (
          candidate_run.apply_status = 'applied'
          OR (candidate_run.ingestion_mode = 'v1' AND candidate_run.status = 'success')
        )
        AND EXISTS (
          SELECT 1 FROM ingest.branch_stock_retirements retirement
          WHERE retirement.sync_run_id = candidate.sync_run_id
            AND retirement.status = 'done'
        )
      ORDER BY candidate.created_at, candidate.sync_run_id
      FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
    )
      AND run.sync_run_id = reconciliation.sync_run_id
    RETURNING reconciliation.sync_run_id, reconciliation.branch_code,
              reconciliation.expected_manifest, reconciliation.attempts,
              reconciliation.max_attempts, run.ingestion_mode
  `);
  const job = result.rows[0] || null;
  if (job) logWorkerEvent("RECONCILIATION_CLAIMED", { sync_run_id: job.sync_run_id });
  return job;
}

function reconciliationRowsFromBatches(rows) {
  return rows.flatMap((row) => Array.isArray(row.payload) ? row.payload : []);
}

async function readReconciliationInputs(client, job) {
  const columns = BRANCH_COLUMNS[job.branch_code];
  if (!columns) throw new Error(`Unsupported branch code "${job.branch_code}".`);
  const batches = await client.query(
    `SELECT payload FROM ingest.sync_batches
     WHERE sync_run_id = $1::bigint AND dataset = 'branch_stock'
     ORDER BY batch_seq`,
    [job.sync_run_id],
  );
  const normalized = await client.query(
    `SELECT product_code, qty, synced_at
     FROM ada.branch_stock_current
     WHERE branch_code = $1`,
    [job.branch_code],
  );
  // Column identifiers are selected exclusively from BRANCH_COLUMNS.
  // CLAIM-C-046 fix: filter on ${columns.fullSyncRunId}, not ${columns.freshness}.
  // Legacy v1 branches populate the freshness timestamp inconsistently (it is
  // written unconditionally, arrival-order, never gated) but ALWAYS stamp the
  // full-snapshot generation id once a v1 write threads a syncRunId (see
  // routes/branch-stock.js upsertBranchStockSnapshot). Filtering on freshness
  // meant a v1 branch's wide-table read was permanently empty (freshness was
  // never populated by v1 before this round), so buildBranchStockReconciliationManifest
  // threw on an empty snapshot and every v1 reconciliation dead-lettered.
  const wide = await client.query(
    `SELECT product_code, ${columns.qty} AS qty, ${columns.freshness} AS synced_at
     FROM ada.branch_stock_snapshots
     WHERE ${columns.fullSyncRunId} IS NOT NULL`,
  );
  return {
    payloadRecords: reconciliationRowsFromBatches(batches.rows),
    normalizedRecords: normalized.rows,
    wideRecords: wide.rows,
  };
}

async function reconcileBranchStockJob(db, job) {
  const client = await db.connect();
  let inputs;
  try {
    // One catalog-wide MVCC snapshot prevents the three reads from observing
    // different commits while a future branch generation is arriving.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    inputs = await readReconciliationInputs(client, job);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
    throw error;
  } finally {
    client.release();
  }

  const hasStagedPayload = job.ingestion_mode === "hybrid_v2";
  const payloadManifest = hasStagedPayload
    ? buildBranchStockReconciliationManifest(inputs.payloadRecords)
    : job.expected_manifest;
  const normalizedManifest = buildBranchStockReconciliationManifest(inputs.normalizedRecords);
  const wideManifest = buildBranchStockReconciliationManifest(inputs.wideRecords);
  const sourceVsPayload = hasStagedPayload
    ? compareManifests(job.expected_manifest, payloadManifest)
    : { matches: null, mismatchedFields: [], reason: "v1 has no retained staged payload" };
  const payloadVsNormalized = compareManifests(payloadManifest, normalizedManifest);
  const normalizedVsWide = compareManifests(normalizedManifest, wideManifest);
  const normalizedMismatches = hasStagedPayload
    ? buildMismatchExamples(inputs.payloadRecords, inputs.normalizedRecords)
    : { mismatchCount: null, examples: [], examplesTruncated: false, reason: "v1 source rows are not retained" };
  const wideMismatches = buildMismatchExamples(inputs.normalizedRecords, inputs.wideRecords);
  const pass = sourceVsPayload.matches !== false && payloadVsNormalized.matches &&
    normalizedVsWide.matches && payloadManifest.duplicateProductCount === 0;
  const mismatchSummary = {
    sourceVsPayload,
    payloadVsNormalized,
    normalizedVsWide,
    payloadVsNormalizedRows: normalizedMismatches,
    normalizedVsWideRows: wideMismatches,
  };
  // CLAIM-X-052-class fix (audited alongside the retirement queue fix,
  // same ownership-token principle): this write previously matched only
  // `status = 'processing'`, with no attempts token — the same gap the
  // retirement queue had, just on reconciliation's own success path instead
  // of a catch block. A worker whose lease was reaped and reclaimed while it
  // was still computing manifests (the REPEATABLE READ read phase above can
  // take a while on a large catalog) could otherwise overwrite a newer
  // attempt's in-flight `processing` row with stale PASS/FAIL evidence.
  const result = await db.query(
    `UPDATE ingest.branch_stock_reconciliations
     SET status = $2, payload_manifest = $3::jsonb,
         normalized_manifest = $4::jsonb, wide_manifest = $5::jsonb,
         mismatch_summary = $6::jsonb, reconciled_at = now(),
         claimed_at = NULL, last_error = NULL, updated_at = now()
     WHERE sync_run_id = $1::bigint AND status = 'processing' AND attempts = $7
     RETURNING sync_run_id, branch_code, status`,
    [
      job.sync_run_id, pass ? "pass" : "fail",
      JSON.stringify(payloadManifest), JSON.stringify(normalizedManifest),
      JSON.stringify(wideManifest), JSON.stringify(mismatchSummary),
      job.attempts,
    ],
  );
  if (result.rowCount === 0) {
    throw new Error("Reconciliation lease no longer owned by this worker (reaped or reclaimed by another attempt); aborting without recording evidence.");
  }
  logWorkerEvent(pass ? "RECONCILIATION_PASS" : "RECONCILIATION_FAIL", {
    sync_run_id: job.sync_run_id,
  }, { branchCode: job.branch_code });
  return result.rows[0] || null;
}

async function processOneReconciliation(db) {
  const job = await claimNextReconciliation(db);
  if (!job) return false;
  try {
    await reconcileBranchStockJob(db, job);
  } catch (error) {
    const exhausted = job.attempts >= job.max_attempts;
    // CLAIM-X-052 fix (same class, applied here too): without the attempts
    // token, this catch could reset a reclaimed, newer attempt's in-flight
    // `processing` row back to retry_wait/dead_letter — including the case
    // where THIS worker's own failure was "lease no longer owned" (thrown
    // above by reconcileBranchStockJob's own new ownership check).
    const result = await db.query(
      `UPDATE ingest.branch_stock_reconciliations
       SET status = $2, last_error = $3, claimed_at = NULL,
           next_attempt_at = CASE WHEN $2 = 'retry_wait'
             THEN now() + ($4 || ' milliseconds')::interval ELSE next_attempt_at END,
           updated_at = now()
       WHERE sync_run_id = $1::bigint AND status = 'processing' AND attempts = $5`,
      [job.sync_run_id, exhausted ? "dead_letter" : "retry_wait", error.message, backoffMs(job.attempts), job.attempts],
    );
    if (result.rowCount === 0) {
      logWorkerEvent("RECONCILIATION_CATCH_LEASE_NOT_OWNED", { sync_run_id: job.sync_run_id }, { attempts: job.attempts });
      return true;
    }
    logWorkerEvent(exhausted ? "RECONCILIATION_DEAD_LETTER" : "RECONCILIATION_RETRY_WAIT", {
      sync_run_id: job.sync_run_id, attempts: job.attempts,
    });
  }
  return true;
}

async function recomputeRunStatus(client, syncRunId) {
  // Serialize recomputations for one run before taking the aggregate snapshot.
  // Without this lock, two workers finishing the last batches concurrently can
  // each count before the other commits, then overwrite the run with a stale
  // partial count even though every batch is already applied.
  await client.query(
    `SELECT sync_run_id FROM ingest.sync_runs
     WHERE sync_run_id = $1::bigint FOR UPDATE`,
    [syncRunId],
  );
  await client.query(`
    WITH counts AS (
      SELECT COUNT(*) FILTER (WHERE status = 'applied')::int AS applied,
             COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS failed,
             (ARRAY_AGG(last_error ORDER BY batch_id DESC)
                FILTER (WHERE status = 'dead_letter' AND last_error IS NOT NULL))[1] AS terminal_error
      FROM ingest.sync_batches WHERE sync_run_id = $1::bigint
    )
    UPDATE ingest.sync_runs r SET
      applied_batches = counts.applied,
      failed_batches = counts.failed,
      apply_status = CASE
        WHEN counts.failed > 0 THEN 'failed'
        WHEN r.total_batches > 0 AND counts.applied = r.total_batches THEN 'applied'
        WHEN counts.applied > 0 THEN 'partial'
        ELSE 'pending' END,
      status = CASE
        WHEN counts.failed > 0 THEN 'failed'
        WHEN r.total_batches > 0 AND counts.applied = r.total_batches THEN 'success'
        ELSE 'running' END,
      failure_stage = CASE WHEN counts.failed > 0 THEN 'apply' ELSE r.failure_stage END,
      message = CASE WHEN counts.failed > 0 THEN counts.terminal_error ELSE r.message END,
      applied_at = CASE WHEN r.total_batches > 0 AND counts.applied = r.total_batches THEN COALESCE(r.applied_at, now()) ELSE r.applied_at END,
      finished_at = CASE WHEN counts.failed > 0 OR (r.total_batches > 0 AND counts.applied = r.total_batches) THEN COALESCE(r.finished_at, now()) ELSE r.finished_at END
    FROM counts WHERE r.sync_run_id = $1::bigint`, [syncRunId]);
}

// Durable retirement queue (branch-stock generation REMEDIATION round,
// _ledger/claude.md CLAIM-X-046/X-047, fixed by CLAIM-C-051/C-052/C-053).
// Replaces the previous round's direct, fire-and-forget
// finalizeFullSnapshotGeneration with a durable queue table
// (ingest.branch_stock_retirements, migration 069) mirroring
// ingest.branch_stock_reconciliations' proven shape exactly: SKIP LOCKED
// claim, bounded retry with backoff, terminal states, lease-reap, retention.
//
// Retirement representation is unchanged from the previous round
// (zero-quantity, see docs/BRANCH_STOCK_GENERATION_CONTRACT.md) — what
// changed is durability and PROOF of generation membership before sweeping.
//
// registerRetirementJobIfComplete is called from INSIDE the same transaction
// that flips a v2 run's apply_status to 'applied' (processOneBatch, after
// recomputeRunStatus) so there is no gap between "run succeeded" and
// "retirement job exists." v1's equivalent registration is a single
// WITH...INSERT...ON CONFLICT DO NOTHING statement inside routes/sync.js's
// run-finish handler, atomic with the same UPDATE that flips status to
// 'success' — see that file, not this one.
async function registerRetirementJobIfComplete(client, syncRunId) {
  await client.query(
    `INSERT INTO ingest.branch_stock_retirements (sync_run_id, branch_code, status, next_attempt_at)
     SELECT sync_run_id, branch_code, 'pending', now()
     FROM ingest.sync_runs
     WHERE sync_run_id = $1::bigint
       AND snapshot_mode = 'full'
       AND apply_status = 'applied' AND finalized_at IS NOT NULL AND status <> 'failed'
     ON CONFLICT (sync_run_id) DO NOTHING`,
    [syncRunId],
  );
}

async function claimNextRetirement(db) {
  // Same-branch generation-ordering guard mirrors claimNextBatch's existing
  // pattern: an earlier, still-pending/processing/retry_wait retirement for
  // the same branch blocks a later one from claiming (prevents interleaved
  // sweeps), but a TERMINAL earlier retirement (done/refused/dead_letter)
  // does not block — same no-permanent-block guarantee as reconciliation.
  const result = await db.query(`
    UPDATE ingest.branch_stock_retirements retirement
    SET status = 'processing', claimed_at = now(),
        attempts = retirement.attempts + 1, updated_at = now()
    FROM ingest.sync_runs run
    WHERE retirement.sync_run_id = (
      SELECT candidate.sync_run_id
      FROM ingest.branch_stock_retirements candidate
      JOIN ingest.sync_runs candidate_run ON candidate_run.sync_run_id = candidate.sync_run_id
      WHERE candidate.status IN ('pending', 'retry_wait')
        AND candidate.next_attempt_at <= now()
        AND candidate_run.snapshot_mode = 'full'
        AND (
          candidate_run.apply_status = 'applied'
          OR (candidate_run.ingestion_mode = 'v1' AND candidate_run.status = 'success')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ingest.sync_runs earlier_run
          JOIN ingest.branch_stock_retirements earlier_retirement
            ON earlier_retirement.sync_run_id = earlier_run.sync_run_id
          WHERE earlier_run.branch_code = candidate_run.branch_code
            AND earlier_run.sync_run_id < candidate_run.sync_run_id
            AND earlier_retirement.status IN ('pending', 'processing', 'retry_wait')
        )
      ORDER BY candidate.created_at, candidate.sync_run_id
      FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
    )
      AND run.sync_run_id = retirement.sync_run_id
    RETURNING retirement.sync_run_id, retirement.branch_code,
              retirement.attempts, retirement.max_attempts, run.ingestion_mode
  `);
  const job = result.rows[0] || null;
  if (job) logWorkerEvent("RETIREMENT_CLAIMED", { sync_run_id: job.sync_run_id });
  return job;
}

// CLAIM-X-046 fix: the membership-proof check. Returns the number of unique
// products this generation's OWN registered evidence says it should have
// touched, or null if that evidence isn't available yet (caller should
// retry, not refuse — the manifest-registration call is a separate request
// from the stock upload and can plausibly race it).
async function computeExpectedMembershipCount(client, job) {
  if (job.ingestion_mode === "v1") {
    const manifestRow = (await client.query(
      `SELECT expected_manifest FROM ingest.branch_stock_reconciliations WHERE sync_run_id = $1::bigint`,
      [job.sync_run_id],
    )).rows[0];
    const manifest = manifestRow && manifestRow.expected_manifest;
    return manifest && typeof manifest.uniqueProductCount === "number" ? manifest.uniqueProductCount : null;
  }
  // hybrid_v2: build a manifest from this run's own staged payload — the
  // exact same function reconciliation itself uses for the payload side.
  const batches = await client.query(
    `SELECT payload FROM ingest.sync_batches WHERE sync_run_id = $1::bigint AND dataset = 'branch_stock' ORDER BY batch_seq`,
    [job.sync_run_id],
  );
  const records = reconciliationRowsFromBatches(batches.rows);
  if (records.length === 0) return null;
  return buildBranchStockReconciliationManifest(records).uniqueProductCount;
}

// One claimed retirement job: supersession check, membership-proof check,
// then either a safe refusal (no sweep) or the actual zero-quantity sweep.
// Invariants (see docs/BRANCH_STOCK_GENERATION_CONTRACT.md):
//   1. A superseded generation (a newer complete full-snapshot generation
//      already exists for this branch) is refused, never swept, and never
//      retried — prevents overlapping generations from interleaving.
//   2. A generation whose stamped-row count is LESS than its own registered
//      manifest's uniqueProductCount is refused, never swept, and never
//      retried — this is the direct fix for CLAIM-X-046: an old/unstamped
//      writer can complete a fully "successful" run and this is the only
//      durable proof available that its rows were never actually stamped
//      with the current generation-tracking contract. Refusing is always
//      safe: it leaves stock exactly as-is rather than risk zeroing it.
//   3. Missing registered evidence throws (caller retries with backoff, then
//      dead-letters at exhaustion) rather than refusing immediately — a
//      registration race is plausible and deserves a few chances.
// CLAIM-X-048 fix: a retirement that terminalizes as 'refused' or
// 'dead_letter' can never reach 'done' — so the same-run reconciliation row
// (if one is registered) can never legitimately reach 'pass'/'fail' either,
// since claimNextReconciliation requires retirement='done' before it will
// even claim the job. Left alone, that reconciliation row stays 'pending'
// forever: excluded from maintainReconciliations' retention (which only
// prunes pass/fail/dead_letter) and treated by claimNextBatch as a live
// blocker for every later same-branch batch (its ordering guard only
// excludes dead_letter reconciliations, not pending ones). This function
// closes that gap by moving a still-pending/processing/retry_wait
// reconciliation straight to 'dead_letter' — the same repository already
// treats 'dead_letter' as "abandoned, not a data verdict" (see
// buildMismatchExamples callers and the reconciliation CHECK constraint),
// which is the accurate meaning here: no comparison was ever possible.
async function terminalizeDependentReconciliation(client, syncRunId, reason) {
  await client.query(
    `UPDATE ingest.branch_stock_reconciliations
     SET status = 'dead_letter', claimed_at = NULL,
         last_error = $2, reconciled_at = now(), updated_at = now()
     WHERE sync_run_id = $1::bigint AND status IN ('pending', 'processing', 'retry_wait')`,
    [syncRunId, reason],
  );
}

// CLAIM-X-050 fix: a worker whose processing lease was reaped (marked
// dead_letter by maintainRetirements, e.g. because it appeared stuck past
// STUCK_PROCESSING_MINUTES) must be fenced out if it later wakes up and
// tries to finish anyway — otherwise it can zero stock and commit even
// though the durable queue already recorded the job as failed. Two layers:
//   1. Ownership fencing: lock the retirement row FOR UPDATE at the very
//      start of the transaction and verify it is still 'processing' with
//      the SAME attempts count claimNextRetirement handed this worker. This
//      also means a concurrent maintainRetirements() reap targeting this
//      exact row blocks on the row lock until this transaction commits or
//      rolls back — a truly crashed worker's connection drop releases the
//      lock (and its transaction) automatically, so this does not reintroduce
//      an unbounded stuck-forever risk; a merely-slow-but-alive worker
//      delays the reaper's SQL for that one row, not indefinitely.
//   2. Belt-and-suspenders: every terminal status UPDATE below is checked
//      for rowCount === 1 and throws (triggering ROLLBACK of the whole
//      transaction, including any stock sweep already performed) if it
//      isn't — so even if the ownership fence were somehow bypassed, a
//      worker whose row no longer matches what it expects can never commit
//      a stock mutation while leaving the queue row saying otherwise.
async function assertStillOwnsRetirement(client, job) {
  const current = (await client.query(
    `SELECT status, attempts FROM ingest.branch_stock_retirements
     WHERE sync_run_id = $1::bigint FOR UPDATE`,
    [job.sync_run_id],
  )).rows[0];
  if (!current || current.status !== "processing" || current.attempts !== job.attempts) {
    throw new Error(
      "Retirement lease no longer owned by this worker (reaped or reclaimed by another attempt); aborting without committing any stock change.",
    );
  }
}

function assertExactlyOneRowChanged(result, context) {
  if (result.rowCount !== 1) {
    throw new Error(`${context}: expected to change exactly 1 row but changed ${result.rowCount}; aborting without committing.`);
  }
}

async function processRetirementJob(db, job) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertStillOwnsRetirement(client, job);
    const runRow = (await client.query(
      `SELECT sync_run_id, branch_code, ingestion_mode, snapshot_mode
       FROM ingest.sync_runs WHERE sync_run_id = $1::bigint FOR UPDATE`,
      [job.sync_run_id],
    )).rows[0];
    if (!runRow) throw new Error("Sync run not found.");

    const newer = await client.query(
      `SELECT 1 FROM ingest.sync_runs
       WHERE branch_code = $1 AND snapshot_mode = 'full' AND sync_run_id > $2::bigint
         AND (status = 'success' OR apply_status = 'applied')
       LIMIT 1`,
      [runRow.branch_code, job.sync_run_id],
    );
    if (newer.rows.length > 0) {
      const refusedSuperseded = await client.query(
        `UPDATE ingest.branch_stock_retirements
         SET status = 'refused', completed_at = now(), claimed_at = NULL,
             last_error = 'Superseded by a newer full-snapshot generation for this branch.',
             updated_at = now()
         WHERE sync_run_id = $1::bigint AND status = 'processing' AND attempts = $2`,
        [job.sync_run_id, job.attempts],
      );
      assertExactlyOneRowChanged(refusedSuperseded, "Refusing (superseded) retirement");
      await terminalizeDependentReconciliation(
        client, job.sync_run_id,
        "Retirement was refused (superseded by a newer generation); no reconciliation comparison is possible.",
      );
      await client.query("COMMIT");
      logWorkerEvent("RETIREMENT_REFUSED", { sync_run_id: job.sync_run_id }, { branchCode: runRow.branch_code, reason: "superseded" });
      return;
    }

    const expectedCount = await computeExpectedMembershipCount(client, job);
    if (expectedCount == null) {
      throw new Error("Registered manifest not yet available for generation membership proof.");
    }

    const columns = BRANCH_COLUMNS[runRow.branch_code];
    if (!columns) throw new Error(`Unsupported branch code "${runRow.branch_code}".`);

    const actualCount = (await client.query(
      `SELECT COUNT(DISTINCT product_code)::int AS count
       FROM ada.branch_stock_current WHERE branch_code = $1 AND last_full_sync_run_id = $2::bigint`,
      [runRow.branch_code, job.sync_run_id],
    )).rows[0].count;

    if (actualCount < expectedCount) {
      const refusedMembership = await client.query(
        `UPDATE ingest.branch_stock_retirements
         SET status = 'refused', completed_at = now(), claimed_at = NULL,
             expected_membership_count = $2, actual_membership_count = $3,
             last_error = 'Generation membership proof failed: fewer rows carry this generation id than the registered manifest expects (old/unstamped writer, or a bug with the same shape).',
             updated_at = now()
         WHERE sync_run_id = $1::bigint AND status = 'processing' AND attempts = $4`,
        [job.sync_run_id, expectedCount, actualCount, job.attempts],
      );
      assertExactlyOneRowChanged(refusedMembership, "Refusing (membership proof failed) retirement");
      await terminalizeDependentReconciliation(
        client, job.sync_run_id,
        "Retirement was refused (generation membership proof failed); no reconciliation comparison is possible.",
      );
      await client.query("COMMIT");
      logWorkerEvent("RETIREMENT_REFUSED", { sync_run_id: job.sync_run_id }, {
        branchCode: runRow.branch_code, reason: "membership_proof_failed", expectedCount, actualCount,
      });
      return;
    }

    const normalizedResult = await client.query(
      `UPDATE ada.branch_stock_current
       SET qty = 0, retired_at = now(), retired_by_sync_run_id = $2::bigint, updated_at = now()
       WHERE branch_code = $1 AND qty <> 0
         AND (last_full_sync_run_id IS NULL OR last_full_sync_run_id < $2::bigint)
       RETURNING product_code`,
      [runRow.branch_code, job.sync_run_id],
    );
    const wideResult = await client.query(
      `UPDATE ada.branch_stock_snapshots
       SET qty_total_all_branches = qty_total_all_branches - ${columns.qty},
           ${columns.qty} = 0, updated_at = now()
       WHERE ${columns.qty} <> 0
         AND (${columns.fullSyncRunId} IS NULL OR ${columns.fullSyncRunId} < $1::bigint)
       RETURNING product_code`,
      [job.sync_run_id],
    );
    const doneResult = await client.query(
      `UPDATE ingest.branch_stock_retirements
       SET status = 'done', completed_at = now(), claimed_at = NULL,
           expected_membership_count = $2, actual_membership_count = $3,
           retired_normalized_count = $4, retired_wide_count = $5,
           last_error = NULL, updated_at = now()
       WHERE sync_run_id = $1::bigint AND status = 'processing' AND attempts = $6`,
      [job.sync_run_id, expectedCount, actualCount, normalizedResult.rowCount, wideResult.rowCount, job.attempts],
    );
    assertExactlyOneRowChanged(doneResult, "Completing (done) retirement");
    await client.query("COMMIT");
    logWorkerEvent("RETIREMENT_DONE", { sync_run_id: job.sync_run_id }, {
      branchCode: runRow.branch_code,
      retiredNormalized: normalizedResult.rowCount, retiredWide: wideResult.rowCount,
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
    throw error;
  } finally {
    client.release();
  }
}

async function processOneRetirement(db) {
  const job = await claimNextRetirement(db);
  if (!job) return false;
  try {
    await processRetirementJob(db, job);
  } catch (error) {
    const exhausted = job.attempts >= job.max_attempts;
    // CLAIM-X-052 fix: this catch previously used the SAME ownership
    // condition as every OTHER pre-fix write in this queue (status='processing'
    // only, no attempts token) — so a worker that lost its lease (reaped,
    // then reclaimed by a newer attempt) and then failed for the mundane
    // reason "lease no longer owned" (thrown by assertStillOwnsRetirement)
    // would land HERE and, without this check, silently reset the NEW
    // owner's in-flight `processing` row back to retry_wait/dead_letter —
    // stealing or cancelling a lease it no longer holds. Adding
    // `attempts = job.attempts` makes this catch use the exact same
    // ownership proof as the success path (assertStillOwnsRetirement /
    // assertExactlyOneRowChanged): if the row has moved on to a different
    // attempt, this worker has nothing left to report and must not touch it.
    const result = await db.query(
      `UPDATE ingest.branch_stock_retirements
       SET status = $2, last_error = $3, claimed_at = NULL,
           next_attempt_at = CASE WHEN $2 = 'retry_wait'
             THEN now() + ($4 || ' milliseconds')::interval ELSE next_attempt_at END,
           updated_at = now()
       WHERE sync_run_id = $1::bigint AND status = 'processing' AND attempts = $5`,
      [job.sync_run_id, exhausted ? "dead_letter" : "retry_wait", error.message, backoffMs(job.attempts), job.attempts],
    );
    if (result.rowCount === 0) {
      logWorkerEvent("RETIREMENT_CATCH_LEASE_NOT_OWNED", { sync_run_id: job.sync_run_id }, { attempts: job.attempts });
      return true;
    }
    logWorkerEvent(exhausted ? "RETIREMENT_DEAD_LETTER" : "RETIREMENT_RETRY_WAIT", {
      sync_run_id: job.sync_run_id, attempts: job.attempts,
    });
    // CLAIM-X-048 fix: once retirement itself is exhausted to dead_letter,
    // its dependent reconciliation (if any) can never be claimed (it needs
    // retirement='done') — terminalize it here too, same as the 'refused'
    // branches inside processRetirementJob. Not exhausted yet (still
    // retry_wait) means the reconciliation should keep waiting. Only reached
    // when the UPDATE above actually affected OUR row (rowCount===1), so
    // this can never terminalize a reconciliation on behalf of a lease this
    // worker no longer owns.
    if (exhausted) {
      await terminalizeDependentReconciliation(
        db, job.sync_run_id,
        "Retirement was dead-lettered after exhausting retries; no reconciliation comparison is possible.",
      );
    }
  }
  return true;
}

async function maintainRetirements(db, options = {}) {
  const retentionDays = positiveDays(
    options.retirementRetentionDays ?? RETIREMENT_RETENTION_DAYS,
    "retirementRetentionDays",
  );
  const abandoned = await db.query(
    `UPDATE ingest.branch_stock_retirements retirement
     SET status = 'dead_letter', claimed_at = NULL,
         last_error = 'Retirement abandoned because its source sync run failed.',
         updated_at = now()
     FROM ingest.sync_runs run
     WHERE run.sync_run_id = retirement.sync_run_id
       AND retirement.status = 'pending'
       AND run.status = 'failed'
     RETURNING retirement.sync_run_id, retirement.status`,
  );
  const reaped = await db.query(
    `UPDATE ingest.branch_stock_retirements
     SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
         claimed_at = NULL, next_attempt_at = now(),
         last_error = CASE WHEN attempts >= max_attempts
           THEN 'Reaped: retirement lease expired at maximum attempts.'
           ELSE 'Reaped: retirement lease expired; retry scheduled.' END,
         updated_at = now()
     WHERE status = 'processing'
       AND claimed_at < now() - ($1 || ' minutes')::interval
     RETURNING sync_run_id, status`,
    [STUCK_PROCESSING_MINUTES],
  );
  const pruned = await db.query(
    `DELETE FROM ingest.branch_stock_retirements
     WHERE status IN ('done', 'refused', 'dead_letter')
       AND COALESCE(completed_at, updated_at) <
         now() - ($1::double precision * interval '1 day')
     RETURNING sync_run_id, status`,
    [retentionDays],
  );
  return { abandoned, reaped, pruned };
}

function positiveDays(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of days.`);
  return value;
}

async function pruneExpiredBatches(db, options = {}) {
  const appliedDays = positiveDays(options.appliedRetentionDays ?? APPLIED_RETENTION_DAYS, "appliedRetentionDays");
  const terminalDays = positiveDays(options.terminalRetentionDays ?? TERMINAL_RETENTION_DAYS, "terminalRetentionDays");
  const abandonedDays = positiveDays(options.abandonedStagedRetentionDays ?? ABANDONED_STAGED_RETENTION_DAYS, "abandonedStagedRetentionDays");
  const result = await db.query(
    `DELETE FROM ingest.sync_batches b
     USING ingest.sync_runs r
     WHERE r.sync_run_id = b.sync_run_id
       AND (
         (b.status = 'applied' AND r.status = 'success'
           AND b.applied_at < now() - ($1::double precision * interval '1 day'))
         OR (b.status IN ('applied', 'dead_letter') AND r.status = 'failed'
           AND NOT EXISTS (
             SELECT 1 FROM ingest.sync_batches active
             WHERE active.sync_run_id = r.sync_run_id
               AND active.status IN ('queued', 'processing', 'retry_wait')
           )
           AND COALESCE(b.applied_at, b.created_at) < now() - ($2::double precision * interval '1 day'))
         OR (b.status = 'staged' AND r.status = 'failed' AND r.finalized_at IS NULL
           AND b.created_at < now() - ($3::double precision * interval '1 day'))
       )
     RETURNING b.batch_id, b.sync_run_id, b.dataset, b.batch_seq, b.status`,
    [appliedDays, terminalDays, abandonedDays],
  );
  if (result.rowCount > 0) {
    console.log(JSON.stringify({ component: "sync-worker", event: "PRUNED", batches: result.rowCount }));
  }
  return result;
}

async function maintainReconciliations(db, options = {}) {
  const retentionDays = positiveDays(
    options.reconciliationRetentionDays ?? RECONCILIATION_RETENTION_DAYS,
    "reconciliationRetentionDays",
  );
  const abandoned = await db.query(
    `UPDATE ingest.branch_stock_reconciliations reconciliation
     SET status = 'dead_letter', claimed_at = NULL,
         last_error = CASE WHEN run.status = 'failed'
           THEN 'Reconciliation cancelled because its source sync failed.'
           ELSE 'Reconciliation abandoned because its source sync never became eligible.' END,
         updated_at = now()
     FROM ingest.sync_runs run
     WHERE run.sync_run_id = reconciliation.sync_run_id
       AND reconciliation.status = 'pending'
       AND (
         run.status = 'failed'
         OR (
           reconciliation.created_at <
             now() - ($1::double precision * interval '1 day')
           AND NOT (
             run.apply_status = 'applied'
             OR (run.ingestion_mode = 'v1' AND run.status = 'success')
           )
         )
       )
     RETURNING reconciliation.sync_run_id, reconciliation.status`,
    [ABANDONED_STAGED_RETENTION_DAYS],
  );
  // CLAIM-X-048 fix (defense-in-depth recovery): processRetirementJob and
  // processOneRetirement's dead-letter branch both terminalize a dependent
  // reconciliation in the same moment retirement itself terminalizes as
  // refused/dead_letter — but a crash between those two writes (extremely
  // narrow, since the refused branches are one transaction, but the
  // dead_letter branch is two separate statements) must not leave the
  // reconciliation stuck non-terminal forever with no path to recovery.
  // This scan catches ANY reconciliation left behind that way, independent
  // of which code path produced it.
  const orphaned = await db.query(
    `UPDATE ingest.branch_stock_reconciliations reconciliation
     SET status = 'dead_letter', claimed_at = NULL,
         last_error = 'Retirement for this generation ended refused/dead_letter; no reconciliation comparison is possible.',
         reconciled_at = now(), updated_at = now()
     FROM ingest.branch_stock_retirements retirement
     WHERE retirement.sync_run_id = reconciliation.sync_run_id
       AND retirement.status IN ('refused', 'dead_letter')
       AND reconciliation.status IN ('pending', 'processing', 'retry_wait')
     RETURNING reconciliation.sync_run_id, reconciliation.status`,
  );
  const reaped = await db.query(
    `UPDATE ingest.branch_stock_reconciliations
     SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
         claimed_at = NULL, next_attempt_at = now(),
         last_error = CASE WHEN attempts >= max_attempts
           THEN 'Reaped: reconciliation lease expired at maximum attempts.'
           ELSE 'Reaped: reconciliation lease expired; retry scheduled.' END,
         updated_at = now()
     WHERE status = 'processing'
       AND claimed_at < now() - ($1 || ' minutes')::interval
     RETURNING sync_run_id, status`,
    [STUCK_PROCESSING_MINUTES],
  );
  const pruned = await db.query(
    `DELETE FROM ingest.branch_stock_reconciliations
     WHERE status IN ('pass', 'fail', 'dead_letter')
       AND COALESCE(reconciled_at, updated_at) <
         now() - ($1::double precision * interval '1 day')
     RETURNING sync_run_id, status`,
    [retentionDays],
  );
  return { abandoned, orphaned, reaped, pruned };
}

// CLAIM-X-058 fix (same class as X-050/X-052, self-filed then confirmed by
// Codex on the real production functions): claimNextBatch hands out
// `attempts` as a fencing token exactly like claimNextRetirement does, but
// nothing previously checked it — a worker reaped by reapStuckBatches while
// still genuinely applying (or reclaimed by a second worker after being
// reaped) could commit a real stock mutation underneath a batch row that had
// already moved on, or overwrite a newer owner's in-flight row from its own
// stale catch block. Fixed with the exact same two-layer pattern already
// proven for the retirement queue:
//   1. Ownership fencing: lock the batch row FOR UPDATE and verify
//      status='processing' AND attempts matches, as the very first thing
//      inside the transaction, before the applier ever touches stock.
//   2. Every terminal write (the success 'applied' UPDATE, and the catch's
//      retry_wait/dead_letter UPDATE) also filters on attempts and asserts
//      rowCount===1 — including the catch, so a fenced-out worker's failure
//      handling can never steal or cancel a different, legitimate owner's
//      lease. A rowCount mismatch on the success path throws, which rolls
//      back the whole transaction (including the applier's stock writes);
//      a rowCount mismatch in the catch is a silent, correct no-op — this
//      worker has nothing left to report.
async function assertStillOwnsBatch(client, batch) {
  const current = (await client.query(
    `SELECT status, attempts FROM ingest.sync_batches WHERE batch_id = $1::bigint FOR UPDATE`,
    [batch.batch_id],
  )).rows[0];
  if (!current || current.status !== "processing" || current.attempts !== batch.attempts) {
    throw new Error(
      "Batch lease no longer owned by this worker (reaped or reclaimed by another attempt); aborting without committing any stock change.",
    );
  }
}

async function processOneBatch(db) {
  const batch = await claimNextBatch(db);
  if (!batch) return false;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertStillOwnsBatch(client, batch);
    const applier = APPLIERS[batch.dataset];
    if (!applier) throw new Error(`No applier for dataset "${batch.dataset}".`);
    await applier(client, batch.payload, batch.branch_code, batch.sync_run_id);
    const appliedResult = await client.query(
      `UPDATE ingest.sync_batches SET status = 'applied', applied_at = now(), last_error = NULL
       WHERE batch_id = $1::bigint AND status = 'processing' AND attempts = $2`,
      [batch.batch_id, batch.attempts],
    );
    assertExactlyOneRowChanged(appliedResult, "Applying batch");
    await recomputeRunStatus(client, batch.sync_run_id);
    // Generation remediation round (_ledger/claude.md CLAIM-X-047, fixed by
    // C-051): registered in the SAME transaction as the apply_status flip
    // above, not as a separate fire-and-forget call after commit — a crash
    // between these two statements is impossible; they commit together or
    // not at all. Idempotent (ON CONFLICT DO NOTHING), so calling it after
    // every batch of a multi-batch run is safe.
    await registerRetirementJobIfComplete(client, batch.sync_run_id);
    await client.query("COMMIT");
    logWorkerEvent("APPLIED", batch);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
    await client.query("BEGIN");
    try {
      const exhausted = batch.attempts >= batch.max_attempts;
      const catchResult = await client.query(
        `UPDATE ingest.sync_batches SET status = $2, last_error = $3,
           next_attempt_at = CASE WHEN $2 = 'retry_wait' THEN now() + ($4 || ' milliseconds')::interval ELSE NULL END
         WHERE batch_id = $1::bigint AND status = 'processing' AND attempts = $5`,
        [batch.batch_id, exhausted ? "dead_letter" : "retry_wait", error.message, backoffMs(batch.attempts), batch.attempts],
      );
      if (catchResult.rowCount === 0) {
        await client.query("COMMIT");
        logWorkerEvent("BATCH_CATCH_LEASE_NOT_OWNED", batch);
        return true;
      }
      await recomputeRunStatus(client, batch.sync_run_id);
      await client.query("COMMIT");
      logWorkerEvent(exhausted ? "DEAD_LETTER" : "RETRY_WAIT", batch);
    } catch (statusError) {
      try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
      throw statusError;
    }
  } finally { client.release(); }
  return true;
}

async function reapStuckBatches(db) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE ingest.sync_batches
       SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
           next_attempt_at = CASE WHEN attempts >= max_attempts THEN NULL ELSE now() END,
           claimed_at = NULL,
           last_error = CASE
             WHEN attempts >= max_attempts THEN 'Reaped: processing lease expired at maximum attempts.'
             ELSE 'Reaped: processing lease expired; retry scheduled.' END
       WHERE status = 'processing' AND claimed_at < now() - ($1 || ' minutes')::interval
       RETURNING batch_id, sync_run_id, dataset, batch_seq, attempts, status`, [STUCK_PROCESSING_MINUTES]);
    const deadRunIds = [...new Set(result.rows.filter((row) => row.status === "dead_letter").map((row) => row.sync_run_id))];
    for (const syncRunId of deadRunIds) await recomputeRunStatus(client, syncRunId);
    await client.query("COMMIT");
    for (const batch of result.rows) logWorkerEvent("REAPED", batch, { outcome: batch.status });
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
    throw error;
  } finally { client.release(); }
}

async function runWorkerLoop(db, { signal } = {}) {
  const reaperTimer = setInterval(() => reapStuckBatches(db).catch(console.error), REAPER_INTERVAL_MS);
  const pruneTimer = setInterval(() => Promise.all([
    pruneExpiredBatches(db), maintainReconciliations(db), maintainRetirements(db),
  ]).catch(console.error), PRUNE_INTERVAL_MS);
  const heartbeatTimer = setInterval(() => {
    console.log(JSON.stringify({ component: "sync-worker", event: "HEARTBEAT" }));
  }, HEARTBEAT_INTERVAL_MS);
  console.log(JSON.stringify({ component: "sync-worker", event: "STARTED" }));
  try {
    while (!signal?.aborted) {
      const didWork = await processOneBatch(db).catch((e) => { console.error(e); return false; });
      // Retirement runs before reconciliation each tick — not required for
      // correctness (claimNextReconciliation's own gate enforces the
      // ordering regardless of poll interleaving) but keeps latency down.
      const didRetire = await processOneRetirement(db).catch((e) => { console.error(e); return false; });
      const didReconcile = await processOneReconciliation(db).catch((e) => { console.error(e); return false; });
      if (!didWork && !didRetire && !didReconcile) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    clearInterval(reaperTimer);
    clearInterval(pruneTimer);
    clearInterval(heartbeatTimer);
  }
}

if (require.main === module) {
  const db = createDbPool(loadConfig(process.env));
  runWorkerLoop(db).catch((error) => { console.error(error); process.exit(1); });
}

module.exports = {
  BRANCH_COLUMNS, APPLIERS, backoffMs, normalizeBranchStock, applyBranchStockBatch,
  claimNextBatch, recomputeRunStatus, processOneBatch, reapStuckBatches, pruneExpiredBatches,
  claimNextReconciliation, readReconciliationInputs, reconcileBranchStockJob,
  processOneReconciliation, maintainReconciliations, runWorkerLoop, logWorkerEvent,
  registerRetirementJobIfComplete, claimNextRetirement, computeExpectedMembershipCount,
  processRetirementJob, processOneRetirement, maintainRetirements,
};
