"use strict";

const { loadConfig } = require("./config");
const { createDbPool } = require("./db");

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 2_000);
const STUCK_PROCESSING_MINUTES = Number(process.env.WORKER_STUCK_PROCESSING_MINUTES || 10);
const REAPER_INTERVAL_MS = Number(process.env.WORKER_REAPER_INTERVAL_MS || 60_000);

const BRANCH_COLUMNS = Object.freeze({
  "000": { qty: "qty_branch_000", cost: "cost_avg_branch_000", freshness: "synced_at_branch_000" },
  "001": { qty: "qty_branch_001", cost: "cost_avg_branch_001", freshness: "synced_at_branch_001" },
  "002": { qty: "qty_branch_002", cost: "cost_avg_branch_002", freshness: "synced_at_branch_002" },
  "003": { qty: "qty_branch_003", cost: "cost_avg_branch_003", freshness: "synced_at_branch_003" },
  "004": { qty: "qty_branch_004", cost: "cost_avg_branch_004", freshness: "synced_at_branch_004" },
  "005": { qty: "qty_branch_005", cost: "cost_avg_branch_005", freshness: "synced_at_branch_005" },
});

function backoffMs(attempts) {
  return Math.min(60_000, 1_000 * 2 ** attempts);
}

function value(record, ...keys) {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function normalizeBranchStock(records, branchCode) {
  const columns = BRANCH_COLUMNS[branchCode];
  if (!columns) throw new Error(`Unsupported branch code "${branchCode}".`);
  const seen = new Set();
  return records.map((record, index) => {
    const productCode = String(value(record, "productCode", "product_code") || "").trim();
    const qty = Number(value(record, "qty", "quantity", columns.qty));
    const rawCost = value(record, "costAvg", "cost_avg", columns.cost);
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

async function applyBranchStockBatch(client, records, branchCode) {
  const columns = BRANCH_COLUMNS[branchCode];
  const normalized = normalizeBranchStock(records, branchCode);
  if (normalized.length === 0) return;
  // Column names come only from BRANCH_COLUMNS, never from request input.
  await client.query(
    `INSERT INTO ada.branch_stock_snapshots
       (product_code, product_name_thai, product_name_eng, barcode, unit,
        ${columns.qty}, ${columns.cost}, ${columns.freshness}, qty_total_all_branches,
        synced_at, source_system, source_table, source_synced_at, raw_payload, updated_at)
     SELECT x.product_code, x.product_name_thai, x.product_name_eng, x.barcode, x.unit,
            x.qty, x.cost, x.source_timestamp, x.qty,
            x.source_timestamp, x.source_system, x.source_table, x.source_timestamp, x.raw_payload, now()
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                 $6::numeric[], $7::numeric[], $8::timestamptz[], $9::text[],
                 $10::text[], $11::jsonb[])
       AS x(product_code, product_name_thai, product_name_eng, barcode, unit,
            qty, cost, source_timestamp, source_system, source_table, raw_payload)
     ON CONFLICT (product_code) DO UPDATE SET
       product_name_thai = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN EXCLUDED.product_name_thai ELSE ada.branch_stock_snapshots.product_name_thai END,
       product_name_eng = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN EXCLUDED.product_name_eng ELSE ada.branch_stock_snapshots.product_name_eng END,
       barcode = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN EXCLUDED.barcode ELSE ada.branch_stock_snapshots.barcode END,
       unit = CASE WHEN ada.branch_stock_snapshots.synced_at <= EXCLUDED.synced_at THEN EXCLUDED.unit ELSE ada.branch_stock_snapshots.unit END,
       ${columns.qty} = EXCLUDED.${columns.qty},
       ${columns.cost} = COALESCE(EXCLUDED.${columns.cost}, ada.branch_stock_snapshots.${columns.cost}),
       ${columns.freshness} = EXCLUDED.${columns.freshness},
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
    [
      normalized.map((r) => r.productCode), normalized.map((r) => r.productNameThai),
      normalized.map((r) => r.productNameEng), normalized.map((r) => r.barcode),
      normalized.map((r) => r.unit), normalized.map((r) => r.qty),
      normalized.map((r) => r.cost), normalized.map((r) => r.sourceTimestamp),
      normalized.map((r) => r.sourceSystem), normalized.map((r) => r.sourceTable),
      normalized.map((r) => JSON.stringify(r.rawPayload)),
    ],
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
        AND candidate_run.status = 'running'
        AND candidate_run.handoff_status = 'success'
      ORDER BY candidate.queued_at, candidate.batch_id
      FOR UPDATE OF candidate SKIP LOCKED LIMIT 1
    ) AND r.sync_run_id = b.sync_run_id
    RETURNING b.batch_id, b.sync_run_id, b.dataset, b.batch_seq, b.payload,
              b.attempts, b.max_attempts, r.branch_code
  `);
  return result.rows[0] || null;
}

async function recomputeRunStatus(client, syncRunId) {
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

async function processOneBatch(db) {
  const batch = await claimNextBatch(db);
  if (!batch) return false;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const applier = APPLIERS[batch.dataset];
    if (!applier) throw new Error(`No applier for dataset "${batch.dataset}".`);
    await applier(client, batch.payload, batch.branch_code);
    await client.query(
      `UPDATE ingest.sync_batches SET status = 'applied', applied_at = now(), last_error = NULL
       WHERE batch_id = $1::bigint AND status = 'processing'`, [batch.batch_id]);
    await recomputeRunStatus(client, batch.sync_run_id);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
    await client.query("BEGIN");
    try {
      const exhausted = batch.attempts >= batch.max_attempts;
      await client.query(
        `UPDATE ingest.sync_batches SET status = $2, last_error = $3,
           next_attempt_at = CASE WHEN $2 = 'retry_wait' THEN now() + ($4 || ' milliseconds')::interval ELSE NULL END
         WHERE batch_id = $1::bigint AND status = 'processing'`,
        [batch.batch_id, exhausted ? "dead_letter" : "retry_wait", error.message, backoffMs(batch.attempts)],
      );
      await recomputeRunStatus(client, batch.sync_run_id);
      await client.query("COMMIT");
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
       RETURNING batch_id, sync_run_id, status`, [STUCK_PROCESSING_MINUTES]);
    const deadRunIds = [...new Set(result.rows.filter((row) => row.status === "dead_letter").map((row) => row.sync_run_id))];
    for (const syncRunId of deadRunIds) await recomputeRunStatus(client, syncRunId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* no-op */ }
    throw error;
  } finally { client.release(); }
}

async function runWorkerLoop(db, { signal } = {}) {
  const reaperTimer = setInterval(() => reapStuckBatches(db).catch(console.error), REAPER_INTERVAL_MS);
  try {
    while (!signal?.aborted) {
      const didWork = await processOneBatch(db).catch((e) => { console.error(e); return false; });
      if (!didWork) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally { clearInterval(reaperTimer); }
}

if (require.main === module) {
  const db = createDbPool(loadConfig(process.env));
  runWorkerLoop(db).catch((error) => { console.error(error); process.exit(1); });
}

module.exports = {
  BRANCH_COLUMNS, APPLIERS, backoffMs, normalizeBranchStock, applyBranchStockBatch,
  claimNextBatch, recomputeRunStatus, processOneBatch, reapStuckBatches, runWorkerLoop,
};
