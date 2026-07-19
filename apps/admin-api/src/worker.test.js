"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyBranchStockBatch, claimNextBatch, processOneBatch, reapStuckBatches, backoffMs } = require("./worker");

test("claim query only claims queued/retry_wait and uses SKIP LOCKED, never staged", async () => {
  let sql;
  await claimNextBatch({ query: async (query) => { sql = query; return { rows: [] }; } });
  assert.match(sql, /status IN \('queued', 'retry_wait'\)/);
  assert.match(sql, /FOR UPDATE OF candidate SKIP LOCKED/);
  assert.doesNotMatch(sql, /status IN \([^)]*staged/);
});

test("branch stock applier updates only the whitelisted branch columns and guards freshness", async () => {
  const calls = [];
  await applyBranchStockBatch({ query: async (sql, params) => { calls.push({ sql, params }); } }, [{ productCode: "P1", qty: 4, costAvg: 2.5, syncedAt: "2026-01-02T00:00:00Z" }], "001");
  assert.match(calls[0].sql, /qty_branch_001 = EXCLUDED\.qty_branch_001/);
  assert.match(calls[0].sql, /cost_avg_branch_001 = EXCLUDED\.cost_avg_branch_001/);
  assert.match(calls[0].sql, /synced_at_branch_001 <= EXCLUDED\.synced_at_branch_001/);
  assert.doesNotMatch(calls[0].sql, /qty_branch_000 = EXCLUDED/);
  await assert.rejects(() => applyBranchStockBatch({ query: async () => {} }, [], "999"), /Unsupported branch/);
});

test("apply, batch status, and recomputed counters share one transaction", async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql.replace(/\s+/g, " ").trim()); return { rows: [], rowCount: 1 }; }, release() {} };
  const db = { query: async () => ({ rows: [{ batch_id: 1, sync_run_id: 7, dataset: "branch_stock", payload: [{ productCode: "P1", qty: 1, syncedAt: "2026-01-01T00:00:00Z" }], attempts: 1, max_attempts: 5, branch_code: "000" }] }), connect: async () => client };
  await processOneBatch(db);
  assert.equal(calls[0], "BEGIN"); assert.equal(calls.at(-1), "COMMIT");
  assert.ok(calls.find((q) => /INSERT INTO ada\.branch_stock_snapshots/.test(q)));
  assert.ok(calls.find((q) => /UPDATE ingest\.sync_batches SET status = 'applied'/.test(q)));
  const recompute = calls.find((q) => /WITH counts AS/.test(q));
  assert.match(recompute, /COUNT\(\*\) FILTER/); assert.doesNotMatch(recompute, /applied_batches \+ 1/);
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
  let sql; await reapStuckBatches({ query: async (q) => { sql = q; return { rows: [{ batch_id: 1 }], rowCount: 1 }; } });
  assert.match(sql, /status = 'retry_wait'/); assert.match(sql, /status = 'processing'/);
  assert.equal(backoffMs(1), 2000); assert.equal(backoffMs(99), 60000);
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
    const branch = /qty_branch_(\d{3}) = EXCLUDED/.exec(sql)[1];
    const incomingAt = new Date(params[3][0]);
    if (!row[`at_${branch}`] || row[`at_${branch}`] <= incomingAt) {
      row[`qty_${branch}`] = params[1][0]; row[`at_${branch}`] = incomingAt;
    }
  } };
  await Promise.all([
    applyBranchStockBatch(client, [{ productCode: "P1", qty: 10, syncedAt: "2026-01-02" }], "000"),
    applyBranchStockBatch(client, [{ productCode: "P1", qty: 20, syncedAt: "2026-01-02" }], "001"),
  ]);
  await applyBranchStockBatch(client, [{ productCode: "P1", qty: 5, syncedAt: "2026-01-01" }], "000");
  assert.equal(row.qty_000, 10); assert.equal(row.qty_001, 20);
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
