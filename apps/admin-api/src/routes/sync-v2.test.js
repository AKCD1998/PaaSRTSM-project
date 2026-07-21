"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { createSyncRouter } = require("./sync");
const { loadConfig } = require("../config");

function makeDb(seedRun = {}) {
  const state = {
    run: { sync_run_id: "7", ingestion_mode: "hybrid_v2", branch_code: "000", status: "running", handoff_status: "running", apply_status: "waiting", finalized_at: null, manifest_hash: null, ...seedRun },
    batches: [], nextBatchId: 1,
  };
  const client = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim();
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q)) return { rows: [], rowCount: 0 };
      if (/SELECT sync_run_id, ingestion_mode, branch_code, finalized_at, status/i.test(q)) return { rows: state.run ? [state.run] : [], rowCount: state.run ? 1 : 0 };
      if (/INSERT INTO ingest\.sync_batches/i.test(q)) {
        const existing = state.batches.find((b) => b.dataset === params[1] && b.batch_seq === params[2]);
        if (existing) return { rows: [], rowCount: 0 };
        const batch = { batch_id: state.nextBatchId++, dataset: params[1], batch_seq: params[2], payload_hash: params[3], payload: JSON.parse(params[4]), record_count: params[5], status: "staged" };
        state.batches.push(batch); return { rows: [batch], rowCount: 1 };
      }
      if (/SELECT batch_id, payload_hash FROM ingest\.sync_batches/i.test(q)) {
        const batch = state.batches.find((b) => b.dataset === params[1] && b.batch_seq === params[2]);
        return { rows: batch ? [batch] : [], rowCount: batch ? 1 : 0 };
      }
      if (/SELECT \* FROM ingest\.sync_runs/i.test(q)) return { rows: state.run ? [state.run] : [], rowCount: state.run ? 1 : 0 };
      if (/COUNT\(\*\)::int AS batch_count/i.test(q)) {
        const batches = state.batches.filter((b) => b.dataset === params[1] && b.status === "staged");
        const seqs = batches.map((b) => b.batch_seq);
        return { rows: [{ batch_count: batches.length, record_count: batches.reduce((n, b) => n + b.record_count, 0), min_seq: seqs.length ? Math.min(...seqs) : null, max_seq: seqs.length ? Math.max(...seqs) : null, distinct_seq: new Set(seqs).size }] };
      }
      if (/UPDATE ingest\.sync_batches SET status = 'queued'/i.test(q)) { state.batches.forEach((b) => { b.status = "queued"; }); return { rows: [], rowCount: state.batches.length }; }
      if (/UPDATE ingest\.sync_runs SET handoff_status/i.test(q)) {
        Object.assign(state.run, { handoff_status: "success", apply_status: "pending", total_batches: params[1], finalized_at: new Date(), manifest_hash: params[2] });
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO ingest\.sync_runs/i.test(q)) {
        state.run = { sync_run_id: "7", ingestion_mode: params[3], branch_code: params[2], status: "running", handoff_status: params[3] === "hybrid_v2" ? "running" : "not_applicable", apply_status: params[3] === "hybrid_v2" ? "waiting" : "not_applicable", finalized_at: null };
        return { rows: [state.run], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${q}`);
    },
    release() {},
  };
  return { state, connect: async () => client, query: (...args) => client.query(...args) };
}

function makeApp(config, db) {
  const app = express();
  app.use(express.json());
  app.use("/api/sync", createSyncRouter({ config, db }));
  app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  return app;
}

const enabledConfig = { posApiKeys: new Set(["secret"]), syncV2AllowedDatasets: new Set(["branch_stock"]), syncV2AllowedBranches: new Set(["000"]), syncV2MaxBatchRecords: 100 };
const auth = { "x-api-key": "secret" };

test("sync v2 feature flags default off and v1 config remains not_applicable", async () => {
  const config = loadConfig({});
  assert.equal(config.syncV2AllowedDatasets.size, 0);
  assert.equal(config.syncV2AllowedBranches.size, 0);
  const db = makeDb();
  const response = await request(makeApp(config, db)).post("/api/sync/run-start").send({ branchCode: "000" });
  assert.equal(response.status, 200);
  assert.equal(db.state.run.ingestion_mode, "v1");
  assert.equal(db.state.run.apply_status, "not_applicable");
});

test("batch endpoint enforces auth, dataset allowlist, validation, and max size", async () => {
  const db = makeDb(); const app = makeApp(enabledConfig, db);
  assert.equal((await request(app).post("/api/sync/v2/batches").send({})).status, 401);
  assert.equal((await request(app).post("/api/sync/v2/batches").set(auth).send({ syncRunId: "7", dataset: "products", batchSeq: 1, records: [{}] })).status, 400);
  assert.equal((await request(app).post("/api/sync/v2/batches").set(auth).send({ syncRunId: "7", dataset: "branch_stock", batchSeq: 0, records: [{}] })).status, 400);
  const tooMany = Array.from({ length: 101 }, () => ({}));
  assert.equal((await request(app).post("/api/sync/v2/batches").set(auth).send({ syncRunId: "7", dataset: "branch_stock", batchSeq: 1, records: tooMany })).status, 400);
});

test("identical duplicate is accepted but conflicting duplicate returns 409", async () => {
  const db = makeDb(); const app = makeApp(enabledConfig, db);
  const body = { syncRunId: "7", dataset: "branch_stock", batchSeq: 1, records: [{ branchCode: "000", qty: 2, productCode: "P1", syncedAt: "2026-01-01T00:00:00Z" }] };
  const first = await request(app).post("/api/sync/v2/batches").set(auth).send(body);
  const same = await request(app).post("/api/sync/v2/batches").set(auth).send({ ...body, records: [{ syncedAt: "2026-01-01T00:00:00Z", productCode: "P1", qty: 2, branchCode: "000" }] });
  const conflict = await request(app).post("/api/sync/v2/batches").set(auth).send({ ...body, records: [{ productCode: "P1", qty: 3, syncedAt: "2026-01-01T00:00:00Z", branchCode: "000" }] });
  assert.equal(first.status, 202); assert.equal(first.body.status, "staged");
  assert.equal(same.status, 202); assert.equal(same.body.payloadHash, first.body.payloadHash);
  assert.equal(conflict.status, 409);
});

test("hybrid run-start requires exact identity/dataset gates before insert", async () => {
  const db = makeDb(); const app = makeApp(enabledConfig, db);
  assert.equal((await request(app).post("/api/sync/run-start").set(auth).send({ ingestionMode: "hybrid_v2", branchCode: "000" })).status, 400);
  assert.equal((await request(app).post("/api/sync/run-start").set(auth).send({ ingestionMode: "hybrid_v2", branchCode: "999", v2Datasets: ["branch_stock"] })).status, 400);
  assert.equal((await request(app).post("/api/sync/run-start").set(auth).send({ ingestionMode: "hybrid_v2", branchCode: "000", v2Datasets: ["products"] })).status, 400);
  const ok = await request(app).post("/api/sync/run-start").set(auth).send({ ingestionMode: "hybrid_v2", branchCode: "000", v2Datasets: ["branch_stock"] });
  assert.equal(ok.status, 200);
  const disabled = { ...enabledConfig, syncV2AllowedBranches: new Set() };
  assert.equal((await request(makeApp(disabled, makeDb())).post("/api/sync/run-start").set(auth).send({ ingestionMode: "hybrid_v2", branchCode: "000", v2Datasets: ["branch_stock"] })).status, 403);
});

test("batch records require run-matching branch identity", async () => {
  const app = makeApp(enabledConfig, makeDb());
  const base = { syncRunId: "7", dataset: "branch_stock", batchSeq: 1 };
  assert.equal((await request(app).post("/api/sync/v2/batches").set(auth).send({ ...base, records: [{ productCode: "P1", qty: 1, syncedAt: "2026-01-01" }] })).status, 400);
  assert.equal((await request(app).post("/api/sync/v2/batches").set(auth).send({ ...base, records: [{ branchCode: "001", productCode: "P1", qty: 1, syncedAt: "2026-01-01" }] })).status, 400);
});

test("duplicate normalized product codes are rejected before staging", async () => {
  const db = makeDb(); const app = makeApp(enabledConfig, db);
  const response = await request(app).post("/api/sync/v2/batches").set(auth).send({
    syncRunId: "7", dataset: "branch_stock", batchSeq: 1,
    records: [
      { branchCode: "000", productCode: " DUP ", qty: 1, syncedAt: "2026-01-01" },
      { branchCode: "000", productCode: "DUP", qty: 2, syncedAt: "2026-01-01" },
    ],
  });
  assert.equal(response.status, 400); assert.equal(db.state.batches.length, 0);
});

test("finalize rechecks flags and terminal handoff state", async () => {
  const manifest = { dataset: "branch_stock", batchCount: 1, recordCount: 1 };
  const failedDb = makeDb({ status: "failed", handoff_status: "failed", apply_status: "failed" });
  failedDb.state.batches = [{ dataset: "branch_stock", batch_seq: 1, record_count: 1, status: "staged" }];
  assert.equal((await request(makeApp(enabledConfig, failedDb)).post("/api/sync/v2/runs/7/finalize").set(auth).send(manifest)).status, 409);
  assert.equal(failedDb.state.batches[0].status, "staged");
  const disabledDb = makeDb(); disabledDb.state.batches = [{ dataset: "branch_stock", batch_seq: 1, record_count: 1, status: "staged" }];
  const disabled = { ...enabledConfig, syncV2AllowedDatasets: new Set() };
  assert.equal((await request(makeApp(disabled, disabledDb)).post("/api/sync/v2/runs/7/finalize").set(auth).send(manifest)).status, 403);
  assert.equal(disabledDb.state.batches[0].status, "staged");
  assert.equal((await request(makeApp(enabledConfig, makeDb())).post("/api/sync/v2/runs/not-a-number/finalize").set(auth).send(manifest)).status, 400);
});

test("finalize rejects count, record, and sequence mismatches", async () => {
  for (const batches of [
    [{ batch_seq: 1, record_count: 1 }],
    [{ batch_seq: 1, record_count: 2 }, { batch_seq: 2, record_count: 1 }],
    [{ batch_seq: 1, record_count: 1 }, { batch_seq: 3, record_count: 1 }],
  ]) {
    const db = makeDb(); db.state.batches = batches.map((b, i) => ({ batch_id: i + 1, dataset: "branch_stock", status: "staged", ...b }));
    const response = await request(makeApp(enabledConfig, db)).post("/api/sync/v2/runs/7/finalize").set(auth).send({ dataset: "branch_stock", batchCount: 2, recordCount: 2 });
    assert.equal(response.status, 409);
  }
});

test("same finalize is idempotent, different manifest conflicts, and overall stays running", async () => {
  const db = makeDb(); db.state.batches = [1, 2].map((seq) => ({ batch_id: seq, dataset: "branch_stock", batch_seq: seq, record_count: 1, status: "staged" }));
  const app = makeApp(enabledConfig, db); const manifest = { dataset: "branch_stock", batchCount: 2, recordCount: 2 };
  const first = await request(app).post("/api/sync/v2/runs/7/finalize").set(auth).send(manifest);
  const same = await request(app).post("/api/sync/v2/runs/7/finalize").set(auth).send(manifest);
  const different = await request(app).post("/api/sync/v2/runs/7/finalize").set(auth).send({ ...manifest, recordCount: 3 });
  assert.equal(first.status, 200); assert.equal(same.status, 200); assert.equal(same.body.idempotent, true);
  assert.equal(different.status, 409); assert.equal(db.state.run.status, "running");
  assert.deepEqual(db.state.batches.map((b) => b.status), ["queued", "queued"]);
});

test("hybrid run-log cannot report overall success and pre-finalize failure is terminal", async () => {
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    if (/UPDATE ingest\.sync_runs/i.test(sql)) return { rows: [{ sync_run_id: 7 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } };
  const app = makeApp(enabledConfig, db);
  const success = await request(app).post("/api/sync/run-log").set(auth).send({ runId: "7", sourceName: "other", status: "success" });
  assert.equal(success.status, 200);
  assert.match(queries[0].sql, /WHEN ingestion_mode = 'v1' THEN \$3/);
  assert.match(queries[0].sql, /ELSE status/);
  queries.length = 0;
  const failed = await request(app).post("/api/sync/run-log").set(auth).send({ runId: "7", sourceName: "other", status: "failed" });
  assert.equal(failed.status, 200);
  assert.match(queries[0].sql, /finalized_at IS NULL THEN 'failed'/);
  assert.match(queries[0].sql, /THEN 'handoff'/);
});

test("hybrid success mirrors to ADA only after apply is terminal", async () => {
  for (const [runState, expectedAdaInserts] of [
    [{ ingestion_mode: "hybrid_v2", status: "running", apply_status: "pending" }, 0],
    [{ ingestion_mode: "hybrid_v2", status: "success", apply_status: "applied" }, 1],
  ]) {
    let adaInserts = 0;
    const db = { async query(sql) {
      if (/UPDATE ingest\.sync_runs/i.test(sql)) return { rows: [{ sync_run_id: 7, ...runState }], rowCount: 1 };
      if (/INSERT INTO ada\.sync_runs/i.test(sql)) { adaInserts += 1; return { rows: [{ sync_run_id: 88 }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    } };
    const response = await request(makeApp(enabledConfig, db)).post("/api/sync/run-log").set(auth).send({ runId: "7", sourceName: "adapos_sync", status: "success" });
    assert.equal(response.status, 200); assert.equal(adaInserts, expectedAdaInserts);
  }
});

test("hybrid requested failure mirrors and records errors only when actual status is failed", async () => {
  for (const [runState, expectedWrites] of [
    [{ ingestion_mode: "hybrid_v2", status: "running", apply_status: "pending" }, { ada: 0, errors: 0 }],
    [{ ingestion_mode: "hybrid_v2", status: "failed", apply_status: "failed" }, { ada: 1, errors: 1 }],
    [{ ingestion_mode: "v1", status: "failed", apply_status: "not_applicable" }, { ada: 1, errors: 1 }],
  ]) {
    const writes = { ada: 0, errors: 0 };
    const db = { async query(sql) {
      if (/UPDATE ingest\.sync_runs/i.test(sql)) return { rows: [{ sync_run_id: 7, ...runState }], rowCount: 1 };
      if (/INSERT INTO ada\.sync_runs/i.test(sql)) { writes.ada += 1; return { rows: [{ sync_run_id: 88 }], rowCount: 1 }; }
      if (/INSERT INTO ingest\.sync_errors/i.test(sql)) { writes.errors += 1; return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    } };
    const response = await request(makeApp(enabledConfig, db)).post("/api/sync/run-log").set(auth).send({ runId: "7", sourceName: "adapos_sync", status: "failed" });
    assert.equal(response.status, 200); assert.deepEqual(writes, expectedWrites);
  }
});

test("v2 status polling never writes sync_run_datasets", async () => {
  let datasetWrites = 0;
  const db = { async query(sql) {
    if (/INSERT INTO ingest\.sync_run_datasets/i.test(sql)) datasetWrites += 1;
    if (/SELECT sync_run_id, sync_type/i.test(sql)) return { rows: [{ sync_run_id: 7, sync_type: "manual", branch_code: "000", status: "running", ingestion_mode: "hybrid_v2", handoff_status: "success", apply_status: "pending", total_batches: 1, applied_batches: 0, failed_batches: 0 }], rowCount: 1 };
    if (/MIN\(queued_at\)/i.test(sql)) return { rows: [{ oldest_pending_queued_at: null, terminal_batch_error: null }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  } };
  const app = makeApp(enabledConfig, db);
  for (let i = 0; i < 3; i += 1) {
    const response = await request(app).get("/api/sync/v2/runs/7").set(auth).set("x-sync-run-id", "7");
    assert.equal(response.status, 200);
  }
  assert.equal(datasetWrites, 0);
});
