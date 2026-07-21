"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");
const { createSyncRouter } = require("../apps/admin-api/src/routes/sync");
const { applyBranchStockBatch, claimNextBatch, processOneBatch, reapStuckBatches } = require("../apps/admin-api/src/worker");

const databaseUrl = process.env.CP4_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;
const migrationSql = fs.readFileSync(path.join(__dirname, "..", "migrations", "060_add_async_ingestion_queue.sql"), "utf8");

async function resetData() {
  await pool.query("TRUNCATE ingest.sync_batches, ingest.sync_runs, ada.branch_stock_snapshots RESTART IDENTITY CASCADE");
}

async function insertRun(overrides = {}) {
  const values = {
    sync_type: "test", source_name: "cp4-test", branch_code: "000", ingestion_mode: "hybrid_v2",
    handoff_status: "success", apply_status: "pending", status: "running", total_batches: 1, finalized: true,
    ...overrides,
  };
  const result = await pool.query(
    `INSERT INTO ingest.sync_runs
       (sync_type, source_name, branch_code, ingestion_mode, handoff_status, apply_status,
        started_at, status, total_batches, finalized_at)
     VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,CASE WHEN $9 THEN now() ELSE NULL END) RETURNING sync_run_id`,
    [values.sync_type, values.source_name, values.branch_code, values.ingestion_mode,
      values.handoff_status, values.apply_status, values.status, values.total_batches, values.finalized],
  );
  return result.rows[0].sync_run_id;
}

integration("REAL POSTGRES: migration 060 executes, preserves v1 defaults, and reruns safely", async () => {
  await pool.query(`
    DROP SCHEMA IF EXISTS ingest CASCADE; DROP SCHEMA IF EXISTS ada CASCADE;
    CREATE SCHEMA ingest; CREATE SCHEMA ada;
    CREATE TABLE ingest.sync_runs (
      sync_run_id bigserial PRIMARY KEY, sync_type text NOT NULL, source_name text NOT NULL,
      started_at timestamptz NOT NULL, finished_at timestamptz,
      status text NOT NULL CHECK (status IN ('queued','running','success','failed')),
      records_read integer NOT NULL DEFAULT 0, records_sent integer NOT NULL DEFAULT 0,
      message text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ada.branch_stock_snapshots (
      product_code text PRIMARY KEY, product_name_thai text, product_name_eng text, barcode text, unit text,
      qty_branch_000 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_001 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_002 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_003 numeric(14,4) NOT NULL DEFAULT 0,
      qty_branch_004 numeric(14,4) NOT NULL DEFAULT 0, qty_branch_005 numeric(14,4) NOT NULL DEFAULT 0,
      qty_total_all_branches numeric(14,4) NOT NULL DEFAULT 0,
      cost_avg_branch_000 numeric(18,4), cost_avg_branch_001 numeric(18,4), cost_avg_branch_002 numeric(18,4),
      cost_avg_branch_003 numeric(18,4), cost_avg_branch_004 numeric(18,4), cost_avg_branch_005 numeric(18,4),
      synced_at timestamptz NOT NULL, source_system text NOT NULL DEFAULT 'AdaAcc',
      source_table text NOT NULL DEFAULT 'TCNTPdtInWha', source_synced_at timestamptz NOT NULL,
      raw_payload jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO ingest.sync_runs (sync_type,source_name,started_at,status) VALUES ('legacy','v1',now(),'success');
  `);
  await pool.query(migrationSql);
  const legacy = (await pool.query("SELECT ingestion_mode,handoff_status,apply_status FROM ingest.sync_runs")).rows[0];
  assert.deepEqual(legacy, { ingestion_mode: "v1", handoff_status: "not_applicable", apply_status: "not_applicable" });
  await pool.query(migrationSql);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM ingest.sync_runs")).rows[0].count, 1);
});

integration("REAL POSTGRES: staged work is invisible and two claimers get different queued batches", async () => {
  await resetData(); const runId = await insertRun({ total_batches: 3 });
  await pool.query(
    `INSERT INTO ingest.sync_batches (sync_run_id,dataset,batch_seq,payload_hash,payload,record_count,status,queued_at,next_attempt_at)
     VALUES ($1,'branch_stock',1,'a','[]',0,'staged',NULL,NULL),
            ($1,'branch_stock',2,'b','[]',0,'queued',now(),now()),
            ($1,'branch_stock',3,'c','[]',0,'queued',now(),now())`, [runId]);
  const [first, second] = await Promise.all([claimNextBatch(pool), claimNextBatch(pool)]);
  assert.notEqual(first.batch_id, second.batch_id);
  assert.deepEqual(new Set([first.batch_seq, second.batch_seq]), new Set([2, 3]));
  assert.equal((await pool.query("SELECT status FROM ingest.sync_batches WHERE batch_seq=1")).rows[0].status, "staged");
});

integration("REAL POSTGRES: concurrent branches preserve quantities, exact total, metadata, freshness, and null cost", async () => {
  await resetData();
  const record = { productCode: "P1", productNameThai: "สินค้า", productNameEng: "Product", barcode: "885", unit: "EA", syncedAt: "2026-01-02T00:00:00Z", rawPayload: { source: "acceptance" } };
  await applyBranchStockBatch(pool, [{ ...record, productCode: "NEW", branchCode: "003", qty: 6, costAvg: 2 }], "003");
  assert.equal(Number((await pool.query("SELECT qty_total_all_branches FROM ada.branch_stock_snapshots WHERE product_code='NEW'")).rows[0].qty_total_all_branches), 6);
  const c0 = await pool.connect(); const c1 = await pool.connect();
  try {
    await Promise.all([
      applyBranchStockBatch(c0, [{ ...record, branchCode: "000", qty: 10, costAvg: 5 }], "000"),
      applyBranchStockBatch(c1, [{ ...record, branchCode: "001", qty: 20, costAvg: 7 }], "001"),
    ]);
  } finally { c0.release(); c1.release(); }
  await applyBranchStockBatch(pool, [{ ...record, branchCode: "000", qty: 99, costAvg: 9, syncedAt: "2026-01-01T00:00:00Z" }], "000");
  await applyBranchStockBatch(pool, [{ ...record, branchCode: "000", qty: 11, costAvg: null, syncedAt: "2026-01-03T00:00:00Z" }], "000");
  let row = (await pool.query("SELECT * FROM ada.branch_stock_snapshots WHERE product_code='P1'")).rows[0];
  assert.equal(Number(row.qty_branch_000), 11); assert.equal(Number(row.qty_branch_001), 20);
  assert.equal(Number(row.qty_total_all_branches), 31); assert.equal(Number(row.cost_avg_branch_000), 5);
  assert.equal(row.product_name_thai, "สินค้า"); assert.equal(row.product_name_eng, "Product");
  assert.equal(row.barcode, "885"); assert.equal(row.unit, "EA"); assert.deepEqual(row.raw_payload, { source: "acceptance" });
  assert.equal(row.synced_at.toISOString(), "2026-01-03T00:00:00.000Z");
  assert.equal(row.source_synced_at.toISOString(), "2026-01-03T00:00:00.000Z");
  await applyBranchStockBatch(pool, [{ ...record, branchCode: "000", productNameThai: null, productNameEng: "", barcode: null, unit: "", qty: 12, syncedAt: "2026-01-04T00:00:00Z" }], "000");
  row = (await pool.query("SELECT * FROM ada.branch_stock_snapshots WHERE product_code='P1'")).rows[0];
  assert.equal(row.product_name_thai, "สินค้า"); assert.equal(row.product_name_eng, "Product");
  assert.equal(row.barcode, "885"); assert.equal(row.unit, "EA");
  await applyBranchStockBatch(pool, [{ ...record, branchCode: "000", productNameThai: "สินค้าใหม่", productNameEng: "Updated", barcode: "999", unit: "BOX", qty: 13, syncedAt: "2026-01-05T00:00:00Z" }], "000");
  row = (await pool.query("SELECT * FROM ada.branch_stock_snapshots WHERE product_code='P1'")).rows[0];
  assert.equal(row.product_name_thai, "สินค้าใหม่"); assert.equal(row.product_name_eng, "Updated");
  assert.equal(row.barcode, "999"); assert.equal(row.unit, "BOX");
});

integration("REAL POSTGRES: duplicate upload is rejected before staging", async () => {
  await resetData(); const runId = await insertRun({ handoff_status: "running", apply_status: "waiting", finalized: false, total_batches: 0 });
  const config = { posApiKeys: new Set(["secret"]), syncV2AllowedDatasets: new Set(["branch_stock"]), syncV2AllowedBranches: new Set(["000"]), syncV2MaxBatchRecords: 100 };
  const app = express(); app.use(express.json()); app.use("/api/sync", createSyncRouter({ config, db: pool })); app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  const record = { branchCode: "000", productCode: " DUP ", qty: 1, syncedAt: "2026-01-01" };
  const response = await request(app).post("/api/sync/v2/batches").set("x-api-key", "secret").send({ syncRunId: String(runId), dataset: "branch_stock", batchSeq: 1, records: [record, { ...record, productCode: "DUP" }] });
  assert.equal(response.status, 400);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM ingest.sync_batches")).rows[0].count, 0);
});

integration("REAL POSTGRES: apply failure rolls back live data; success commits data and applied state atomically", async () => {
  await resetData(); let runId = await insertRun();
  const payload = [{ branchCode: "000", productCode: "ROLLBACK", qty: 4, syncedAt: "2026-01-02" }];
  await pool.query(`INSERT INTO ingest.sync_batches (sync_run_id,dataset,batch_seq,payload_hash,payload,record_count,status,queued_at,next_attempt_at,max_attempts)
                    VALUES ($1,'branch_stock',1,'x',$2,1,'queued',now(),now(),3)`, [runId, JSON.stringify(payload)]);
  await pool.query(`CREATE OR REPLACE FUNCTION ingest.reject_applied_once() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status='applied' THEN RAISE EXCEPTION 'forced applied failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER cp4_reject_applied BEFORE UPDATE ON ingest.sync_batches FOR EACH ROW EXECUTE FUNCTION ingest.reject_applied_once();`);
  await processOneBatch(pool);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM ada.branch_stock_snapshots WHERE product_code='ROLLBACK'")).rows[0].count, 0);
  assert.equal((await pool.query("SELECT status FROM ingest.sync_batches")).rows[0].status, "retry_wait");
  await pool.query("DROP TRIGGER cp4_reject_applied ON ingest.sync_batches");

  await resetData(); runId = await insertRun();
  await pool.query(`INSERT INTO ingest.sync_batches (sync_run_id,dataset,batch_seq,payload_hash,payload,record_count,status,queued_at,next_attempt_at)
                    VALUES ($1,'branch_stock',1,'y',$2,1,'queued',now(),now())`, [runId, JSON.stringify([{ branchCode: "000", productCode: "COMMIT", qty: 8, syncedAt: "2026-01-02" }])]);
  await processOneBatch(pool);
  const committed = await pool.query(`SELECT b.status, r.status AS run_status, r.apply_status, s.qty_branch_000
    FROM ingest.sync_batches b JOIN ingest.sync_runs r ON r.sync_run_id=b.sync_run_id
    JOIN ada.branch_stock_snapshots s ON s.product_code='COMMIT'`);
  assert.equal(committed.rows[0].status, "applied"); assert.equal(committed.rows[0].run_status, "success");
  assert.equal(committed.rows[0].apply_status, "applied"); assert.equal(Number(committed.rows[0].qty_branch_000), 8);
});

integration("REAL POSTGRES: max-attempt crashed work dead-letters and exposes crash error", async () => {
  await resetData(); const runId = await insertRun();
  await pool.query(`INSERT INTO ingest.sync_batches (sync_run_id,dataset,batch_seq,payload_hash,payload,record_count,status,attempts,max_attempts,claimed_at)
                    VALUES ($1,'branch_stock',1,'z','[]',0,'processing',5,5,now()-interval '1 hour')`, [runId]);
  await reapStuckBatches(pool);
  const result = await pool.query(`SELECT b.status,b.last_error,r.status AS run_status,r.apply_status,r.failed_batches,r.message
    FROM ingest.sync_batches b JOIN ingest.sync_runs r ON r.sync_run_id=b.sync_run_id`);
  assert.equal(result.rows[0].status, "dead_letter"); assert.match(result.rows[0].last_error, /maximum attempts/);
  assert.equal(result.rows[0].run_status, "failed"); assert.equal(result.rows[0].apply_status, "failed");
  assert.equal(result.rows[0].failed_batches, 1); assert.match(result.rows[0].message, /maximum attempts/);
  const config = { posApiKeys: new Set(["secret"]), syncV2AllowedDatasets: new Set(["branch_stock"]), syncV2AllowedBranches: new Set(["000"]), syncV2MaxBatchRecords: 100 };
  const app = express(); app.use(express.json()); app.use("/api/sync", createSyncRouter({ config, db: pool })); app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  const statusResponse = await request(app).get(`/api/sync/v2/runs/${runId}`).set("x-api-key", "secret");
  assert.equal(statusResponse.status, 200); assert.match(statusResponse.body.terminalFailure.message, /maximum attempts/);
});

integration("REAL POSTGRES: one dead-letter does not strand the remaining finalized queue", async () => {
  await resetData(); const runId = await insertRun({ total_batches: 2 });
  const bad = [{ branchCode: "000", productCode: "BAD", qty: 1, syncedAt: "2026-01-01" }, { branchCode: "000", productCode: "BAD", qty: 2, syncedAt: "2026-01-01" }];
  const good = [{ branchCode: "000", productCode: "GOOD", qty: 9, syncedAt: "2026-01-01" }];
  await pool.query(`INSERT INTO ingest.sync_batches (sync_run_id,dataset,batch_seq,payload_hash,payload,record_count,status,queued_at,next_attempt_at,max_attempts)
    VALUES ($1,'branch_stock',1,'bad',$2,2,'queued',now(),now(),1), ($1,'branch_stock',2,'good',$3,1,'queued',now(),now(),5)`, [runId, JSON.stringify(bad), JSON.stringify(good)]);
  assert.equal(await processOneBatch(pool), true);
  assert.equal((await pool.query("SELECT status FROM ingest.sync_runs WHERE sync_run_id=$1", [runId])).rows[0].status, "failed");
  assert.equal(await processOneBatch(pool), true);
  assert.equal(await processOneBatch(pool), false);
  const result = await pool.query(`SELECT r.status,r.apply_status,r.applied_batches,r.failed_batches,
    COUNT(*) FILTER (WHERE b.status IN ('queued','retry_wait','processing'))::int AS pending
    FROM ingest.sync_runs r JOIN ingest.sync_batches b ON b.sync_run_id=r.sync_run_id
    WHERE r.sync_run_id=$1 GROUP BY r.sync_run_id`, [runId]);
  assert.deepEqual(result.rows[0], { status: "failed", apply_status: "failed", applied_batches: 1, failed_batches: 1, pending: 0 });
  assert.equal(Number((await pool.query("SELECT qty_branch_000 FROM ada.branch_stock_snapshots WHERE product_code='GOOD'")).rows[0].qty_branch_000), 9);
});

integration("REAL POSTGRES: finalize mismatch rolls back without queueing staged work", async () => {
  await resetData(); const runId = await insertRun({ handoff_status: "running", apply_status: "waiting", total_batches: 0, finalized: false });
  await pool.query(`INSERT INTO ingest.sync_batches (sync_run_id,dataset,batch_seq,payload_hash,payload,record_count,status)
                    VALUES ($1,'branch_stock',1,'m','[{}]',1,'staged')`, [runId]);
  const config = { posApiKeys: new Set(["secret"]), syncV2AllowedDatasets: new Set(["branch_stock"]), syncV2AllowedBranches: new Set(["000"]), syncV2MaxBatchRecords: 100 };
  const app = express(); app.use(express.json()); app.use("/api/sync", createSyncRouter({ config, db: pool })); app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  const response = await request(app).post(`/api/sync/v2/runs/${runId}/finalize`).set("x-api-key", "secret").send({ dataset: "branch_stock", batchCount: 2, recordCount: 1 });
  assert.equal(response.status, 409);
  assert.equal((await pool.query("SELECT status FROM ingest.sync_batches WHERE sync_run_id=$1", [runId])).rows[0].status, "staged");
  assert.equal((await pool.query("SELECT finalized_at FROM ingest.sync_runs WHERE sync_run_id=$1", [runId])).rows[0].finalized_at, null);
});

if (pool) test.after(async () => pool.end());
