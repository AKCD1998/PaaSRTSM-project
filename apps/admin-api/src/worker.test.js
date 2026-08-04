"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyBranchStockBatch, claimNextBatch, processOneBatch, reapStuckBatches,
  pruneExpiredBatches, recomputeRunStatus, backoffMs, logWorkerEvent, normalizeBranchStock,
  claimNextReconciliation, reconcileBranchStockJob, maintainReconciliations,
} = require("./worker");
const {
  buildBranchStockReconciliationManifest,
} = require("./services/branchStockReconciliation");

test("run recomputation locks the run before taking a fresh aggregate snapshot", async () => {
  const calls = [];
  await recomputeRunStatus({ query: async (sql) => { calls.push(sql.replace(/\s+/g, " ").trim()); return { rows: [] }; } }, 7);
  assert.match(calls[0], /SELECT sync_run_id FROM ingest\.sync_runs/);
  assert.match(calls[0], /FOR UPDATE/);
  assert.match(calls[1], /WITH counts AS/);
});

test("route and worker share camel and snake branch-stock value aliases", () => {
  const timestamp = "2026-01-01T00:00:00Z";
  const [camel] = normalizeBranchStock([{ productCode: "P1", qtyBranch001: 5, costAvgBranch001: 2, syncedAt: timestamp }], "001");
  const [snake] = normalizeBranchStock([{ productCode: "P1", qty_branch_001: 6, cost_avg_branch_001: 3, syncedAt: timestamp }], "001");
  assert.deepEqual([camel.qty, camel.cost], [5, 2]);
  assert.deepEqual([snake.qty, snake.cost], [6, 3]);
});

test("claim query only claims queued/retry_wait and uses SKIP LOCKED, never staged", async () => {
  let sql;
  await claimNextBatch({ query: async (query) => { sql = query; return { rows: [] }; } });
  assert.match(sql, /status IN \('queued', 'retry_wait'\)/);
  assert.match(sql, /FOR UPDATE OF candidate SKIP LOCKED/);
  assert.match(sql, /candidate_run\.status IN \('running', 'failed'\)/);
  assert.match(sql, /candidate_run\.finalized_at IS NOT NULL/);
  assert.match(sql, /earlier_reconciliation\.status IN \('processing', 'retry_wait'\)/);
  assert.match(sql, /earlier_run\.ingestion_mode = 'v1' AND earlier_run\.status = 'success'/);
  assert.doesNotMatch(sql, /status IN \([^)]*staged/);
});

test("reconciliation claim is durable, skip-locked, and waits for APPLIED", async () => {
  let sql;
  await claimNextReconciliation({ query: async (query) => { sql = query; return { rows: [] }; } });
  assert.match(sql, /candidate\.status IN \('pending', 'retry_wait'\)/);
  assert.match(sql, /candidate_run\.apply_status = 'applied'/);
  assert.match(sql, /FOR UPDATE OF candidate SKIP LOCKED/);
  assert.match(sql, /attempts = reconciliation\.attempts \+ 1/);
});

test("catalog-wide reconciliation uses one repeatable-read snapshot and records PASS evidence", async () => {
  const at = "2026-07-29T01:00:00.000Z";
  const records = [{ productCode: "P1", qty: 2, syncedAt: at }];
  const expected = buildBranchStockReconciliationManifest(records);
  const clientCalls = [];
  const client = {
    async query(sql) {
      const q = sql.replace(/\s+/g, " ").trim(); clientCalls.push(q);
      if (/SELECT payload FROM ingest\.sync_batches/.test(q)) return { rows: [{ payload: records }] };
      if (/FROM ada\.branch_stock_current/.test(q)) return { rows: [{ product_code: "P1", qty: "2.0000", synced_at: at }] };
      if (/FROM ada\.branch_stock_snapshots/.test(q)) return { rows: [{ product_code: "P1", qty: "2.0000", synced_at: at }] };
      return { rows: [] };
    },
    release() {},
  };
  let update;
  const db = {
    connect: async () => client,
    query: async (sql, params) => { update = { sql, params }; return { rows: [{ status: params[1] }] }; },
  };
  await reconcileBranchStockJob(db, {
    sync_run_id: 7, branch_code: "000", ingestion_mode: "hybrid_v2", expected_manifest: expected,
  });
  assert.equal(clientCalls[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(clientCalls.at(-1), "COMMIT");
  assert.equal(update.params[1], "pass");
  assert.equal(JSON.parse(update.params[5]).payloadVsNormalized.matches, true);
  assert.match(update.sql, /WHERE sync_run_id = \$1::bigint AND status = 'processing'/);
});

test("reconciliation mismatch is terminal FAIL evidence and never writes stock", async () => {
  const at = "2026-07-29T01:00:00.000Z";
  const payload = [{ productCode: "P1", qty: 2, syncedAt: at }];
  const client = {
    async query(sql) {
      if (/SELECT payload FROM ingest\.sync_batches/.test(sql)) return { rows: [{ payload }] };
      if (/FROM ada\.branch_stock_current/.test(sql)) return { rows: [{ product_code: "P1", qty: 3, synced_at: at }] };
      if (/FROM ada\.branch_stock_snapshots/.test(sql)) return { rows: [{ product_code: "P1", qty: 3, synced_at: at }] };
      return { rows: [] };
    },
    release() {},
  };
  let update;
  await reconcileBranchStockJob({
    connect: async () => client,
    query: async (sql, params) => { update = { sql, params }; return { rows: [] }; },
  }, {
    sync_run_id: 7, branch_code: "000",
    ingestion_mode: "hybrid_v2",
    expected_manifest: buildBranchStockReconciliationManifest(payload),
  });
  assert.equal(update.params[1], "fail");
  assert.equal(JSON.parse(update.params[5]).payloadVsNormalizedRows.mismatchCount, 1);
  assert.doesNotMatch(update.sql, /INSERT INTO ada|UPDATE ada|DELETE FROM ada/);
});

test("reconciliation maintenance reaps leases and prunes only aged terminal evidence", async () => {
  const calls = [];
  await maintainReconciliations({
    query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params }); return { rows: [], rowCount: 0 }; },
  }, { reconciliationRetentionDays: 90 });
  assert.match(calls[0].sql, /reconciliation\.status = 'pending'/);
  assert.match(calls[0].sql, /run\.status = 'failed'/);
  assert.match(calls[0].sql, /never became eligible/);
  // CLAIM-X-048 fix: a new "orphaned" scan terminalizes any reconciliation
  // whose retirement already ended refused/dead_letter, independent of
  // whether the retirement-side code already did so in the same breath.
  assert.match(calls[1].sql, /retirement\.status IN \('refused', 'dead_letter'\)/);
  assert.match(calls[1].sql, /reconciliation\.status IN \('pending', 'processing', 'retry_wait'\)/);
  assert.match(calls[2].sql, /status = 'processing'/);
  assert.match(calls[2].sql, /THEN 'dead_letter' ELSE 'retry_wait'/);
  assert.match(calls[3].sql, /status IN \('pass', 'fail', 'dead_letter'\)/);
  assert.doesNotMatch(calls[3].sql, /pending|processing|retry_wait/);
  assert.deepEqual(calls[3].params, [90]);
});

test("branch stock applier updates only the whitelisted branch columns and guards freshness", async () => {
  const calls = [];
  await applyBranchStockBatch({ query: async (sql, params) => { calls.push({ sql, params }); } }, [{ productCode: "P1", productNameThai: "ไทย", productNameEng: "English", barcode: "123", unit: "EA", qty: 4, costAvg: 2.5, syncedAt: "2026-01-02T00:00:00Z", rawPayload: { source: "test" } }], "001");
  assert.match(calls[0].sql, /qty_branch_001 = EXCLUDED\.qty_branch_001/);
  assert.match(calls[0].sql, /cost_avg_branch_001 = COALESCE\(EXCLUDED\.cost_avg_branch_001/);
  assert.match(calls[0].sql, /synced_at_branch_001 <= EXCLUDED\.synced_at_branch_001/);
  assert.match(calls[0].sql, /qty_total_all_branches =/);
  assert.match(calls[0].sql, /synced_at = GREATEST/);
  assert.match(calls[0].sql, /COALESCE\(EXCLUDED\.product_name_thai, ada\.branch_stock_snapshots\.product_name_thai\)/);
  assert.deepEqual(calls[0].params.slice(1, 5).map((values) => values[0]), ["ไทย", "English", "123", "EA"]);
  assert.deepEqual(JSON.parse(calls[0].params[10][0]), { source: "test" });
  assert.doesNotMatch(calls[0].sql, /qty_branch_000 = EXCLUDED/);
  await assert.rejects(() => applyBranchStockBatch({ query: async () => {} }, [], "999"), /Unsupported branch/);
  await assert.rejects(
    () => applyBranchStockBatch({ query: async () => assert.fail("SQL must not execute") }, [
      { productCode: "P1", qty: 1, syncedAt: "2026-01-01" },
      { productCode: "P1", qty: 2, syncedAt: "2026-01-02" },
    ], "000"),
    /Duplicate productCode/,
  );
});

test("worker terminal logs are structured and never contain payloads or secrets", () => {
  const original = console.log; const lines = []; console.log = (line) => lines.push(line);
  try { logWorkerEvent("DEAD_LETTER", { sync_run_id: 7, batch_id: 8, dataset: "branch_stock", batch_seq: 2, attempts: 5, payload: [{ secret: "must-not-log" }] }, { error: "failed safely" }); }
  finally { console.log = original; }
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(entry, { component: "sync-worker", event: "DEAD_LETTER", runId: "7", batchId: "8", dataset: "branch_stock", batchSeq: 2, attempts: 5, error: "failed safely" });
  assert.doesNotMatch(lines[0], /must-not-log|api.?key|postgresql:\/\//i);
});

test("apply, batch status, and recomputed counters share one transaction", async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      const q = sql.replace(/\s+/g, " ").trim();
      calls.push(q);
      // CLAIM-X-058 fix: processOneBatch now fences ownership with a
      // SELECT ... FOR UPDATE before touching stock — this mock must answer
      // it with a row matching the claimed batch (status='processing',
      // attempts=1) or the fence would (correctly) reject every call.
      if (/SELECT status, attempts FROM ingest\.sync_batches/.test(q)) return { rows: [{ status: "processing", attempts: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  // registerRetirementJobIfComplete (generation remediation round, fixes
  // CLAIM-X-047) runs on this SAME client/transaction, not a separate
  // connection — that is the whole point of the fix (atomic with the batch
  // commit, no fire-and-forget gap) — so a single mock client is enough now.
  const db = {
    query: async () => ({ rows: [{ batch_id: 1, sync_run_id: 7, dataset: "branch_stock", payload: [{ productCode: "P1", qty: 1, syncedAt: "2026-01-01T00:00:00Z" }], attempts: 1, max_attempts: 5, branch_code: "000" }] }),
    connect: async () => client,
  };
  await processOneBatch(db);
  assert.equal(calls[0], "BEGIN"); assert.equal(calls.at(-1), "COMMIT");
  assert.ok(calls.find((q) => /INSERT INTO ada\.branch_stock_snapshots/.test(q)));
  assert.ok(calls.find((q) => /UPDATE ingest\.sync_batches SET status = 'applied'/.test(q)));
  const recompute = calls.find((q) => /WITH counts AS/.test(q));
  assert.match(recompute, /COUNT\(\*\) FILTER/); assert.doesNotMatch(recompute, /applied_batches \+ 1/);
  assert.ok(calls.find((q) => /INSERT INTO ingest\.branch_stock_retirements/.test(q)), "retirement registration must run inside the same transaction");
});

test("failed apply rolls back live writes before retry status transaction", async () => {
  const calls = []; let failed = false;
  const client = { async query(sql) { const q = sql.replace(/\s+/g, " ").trim(); calls.push(q); if (/INSERT INTO ada\.branch_stock_snapshots/.test(q) && !failed) { failed = true; throw new Error("boom"); } return { rows: [] }; }, release() {} };
  const db = { query: async () => ({ rows: [{ batch_id: 1, sync_run_id: 7, dataset: "branch_stock", payload: [{ productCode: "P1", qty: 1, syncedAt: "2026-01-01" }], attempts: 1, max_attempts: 2, branch_code: "000" }] }), connect: async () => client };
  await processOneBatch(db);
  assert.deepEqual(calls.filter((q) => ["BEGIN", "ROLLBACK", "COMMIT"].includes(q)), ["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]);
  assert.ok(calls.find((q) => /status = \$2/.test(q)));
});

test("reaper returns crashed work to retry_wait and retry backoff is bounded", async () => {
  const calls = [];
  const client = { async query(q) { calls.push(q); return /RETURNING batch_id/.test(q) ? { rows: [{ batch_id: 1, sync_run_id: 7, status: "retry_wait" }], rowCount: 1 } : { rows: [] }; }, release() {} };
  await reapStuckBatches({ connect: async () => client });
  const sql = calls.find((q) => /UPDATE ingest\.sync_batches/.test(q));
  assert.match(sql, /attempts >= max_attempts THEN 'dead_letter'/); assert.match(sql, /ELSE 'retry_wait'/);
  assert.match(sql, /maximum attempts/);
  assert.equal(backoffMs(1), 2000); assert.equal(backoffMs(99), 60000);
});

test("retention deletes only aged terminal batch classes with bounded settings", async () => {
  let call;
  const result = await pruneExpiredBatches({ query: async (sql, params) => {
    call = { sql: sql.replace(/\s+/g, " ").trim(), params };
    return { rows: [], rowCount: 0 };
  } }, { appliedRetentionDays: 30, terminalRetentionDays: 90, abandonedStagedRetentionDays: 7 });
  assert.equal(result.rowCount, 0);
  assert.deepEqual(call.params, [30, 90, 7]);
  assert.match(call.sql, /b\.status = 'applied' AND r\.status = 'success'/);
  assert.match(call.sql, /b\.status IN \('applied', 'dead_letter'\) AND r\.status = 'failed'/);
  assert.match(call.sql, /NOT EXISTS.*active\.status IN \('queued', 'processing', 'retry_wait'\)/);
  assert.match(call.sql, /COALESCE\(b\.applied_at, b\.created_at\)/);
  assert.match(call.sql, /b\.status = 'staged' AND r\.status = 'failed' AND r\.finalized_at IS NULL/);
  assert.doesNotMatch(call.sql, /b\.status = 'queued'|b\.status = 'processing'|b\.status = 'retry_wait'/);
  await assert.rejects(() => pruneExpiredBatches({ query: async () => assert.fail("must validate first") }, { appliedRetentionDays: 0 }), /positive/);
});

test("two concurrent claimers receive different batches", async () => {
  const pending = [11, 12];
  const db = { async query() { const batch_id = pending.shift(); await new Promise((resolve) => setImmediate(resolve)); return { rows: batch_id ? [{ batch_id }] : [] }; } };
  const [first, second] = await Promise.all([claimNextBatch(db), claimNextBatch(db)]);
  assert.notEqual(first.batch_id, second.batch_id);
});

test("branch 000 and 001 writes preserve both values and older branch data is ignored (mock storage)", async () => {
  const row = {};
  const client = { async query(sql, params) {
    // applyBranchStockBatch now also dual-writes to ada.branch_stock_current
    // (WP3 Phase 1) — that second query has no per-branch column name to
    // match, so it's not relevant to this test's wide-table-specific
    // assertions; skip it rather than let the regex below throw on it.
    const match = /qty_branch_(\d{3}) = EXCLUDED/.exec(sql);
    if (!match) return;
    const branch = match[1];
    const incomingAt = new Date(params[7][0]);
    if (!row[`at_${branch}`] || row[`at_${branch}`] <= incomingAt) {
      row[`qty_${branch}`] = params[5][0]; row[`at_${branch}`] = incomingAt;
      row.total = (row.qty_000 || 0) + (row.qty_001 || 0);
    }
  } };
  await Promise.all([
    applyBranchStockBatch(client, [{ productCode: "P1", qty: 10, syncedAt: "2026-01-02" }], "000"),
    applyBranchStockBatch(client, [{ productCode: "P1", qty: 20, syncedAt: "2026-01-02" }], "001"),
  ]);
  await applyBranchStockBatch(client, [{ productCode: "P1", qty: 5, syncedAt: "2026-01-01" }], "000");
  assert.equal(row.qty_000, 10); assert.equal(row.qty_001, 20); assert.equal(row.total, 30);
});

test("null incoming cost uses COALESCE to preserve stored cost", async () => {
  const calls = [];
  await applyBranchStockBatch({ query: async (sql, params) => { calls.push({ sql, params }); } }, [{ productCode: "P1", qty: 3, costAvg: null, syncedAt: "2026-01-02" }], "000");
  // calls[0] is the wide-table upsert; calls[1] (WP3 Phase 1) is the new
  // ada.branch_stock_current dual-write — asserted separately below.
  assert.equal(calls[0].params[6][0], null);
  assert.match(calls[0].sql, /cost_avg_branch_000 = COALESCE\(EXCLUDED\.cost_avg_branch_000, ada\.branch_stock_snapshots\.cost_avg_branch_000\)/);

  assert.match(calls[1].sql, /INSERT INTO ada\.branch_stock_current/);
  assert.match(calls[1].sql, /cost_avg = COALESCE\(EXCLUDED\.cost_avg, ada\.branch_stock_current\.cost_avg\)/);
  assert.equal(calls[1].params[6][0], null);
  // params: [...unnestParams (11), branchCode, syncRunId] — branch-stock
  // generation round added syncRunId as the new final scalar param.
  assert.equal(calls[1].params.at(-2), "000", "branch_code is the second-to-last scalar param, not templated into the SQL");
  assert.equal(calls[1].params.at(-1), null, "syncRunId defaults to null when applyBranchStockBatch isn't given one");
});

test("exhausted retry becomes dead_letter and marks the run failed from recomputed counts", async () => {
  const calls = [];
  const client = { async query(sql, params = []) { const q = sql.replace(/\s+/g, " ").trim(); calls.push({ q, params }); if (/INSERT INTO ada\.branch_stock_snapshots/.test(q)) throw new Error("permanent"); return { rows: [] }; }, release() {} };
  const db = { query: async () => ({ rows: [{ batch_id: 1, sync_run_id: 7, dataset: "branch_stock", payload: [{ productCode: "P1", qty: 1, syncedAt: "2026-01-01" }], attempts: 5, max_attempts: 5, branch_code: "000" }] }), connect: async () => client };
  await processOneBatch(db);
  const failureUpdate = calls.find((call) => /status = \$2/.test(call.q));
  assert.equal(failureUpdate.params[1], "dead_letter");
  assert.match(calls.find((call) => /WITH counts AS/.test(call.q)).q, /counts\.failed > 0 THEN 'failed'/);
});
