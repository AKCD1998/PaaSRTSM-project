"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");
const { Pool } = require("pg");

const { loadConfig } = require("../config");
const { createAdaSyncRouter } = require("./sync-ada");
const {
  applyTransferDelta,
  calculateContentHash,
  readCapability,
  rebaselineTransferDelta,
} = require("../services/transferDelta");
const { readTransferDeltaEvidence } = require("../services/transferDeltaEvidence");

const databaseUrl = process.env.TRANSFER_DELTA_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function app(config, db) {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/sync/ada", createAdaSyncRouter({ config, db }));
  instance.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  return instance;
}

test("Transfer Delta flags are default OFF with an empty allowlist", () => {
  const config = loadConfig({});
  assert.equal(config.featureTransferDeltaApply, false);
  assert.equal(config.featureTransferDeltaHardTombstones, false);
  assert.deepEqual([...config.transferDeltaBranches], []);
});

test("disabled capability and apply path do not acquire a database client", async () => {
  const db = {
    query: async () => { throw new Error("disabled capability must not query"); },
    connect: async () => { throw new Error("disabled apply must not connect"); },
  };
  const config = { posApiKeys: new Set(), featureTransferDeltaApply: false, transferDeltaBranches: new Set() };
  const capability = await request(app(config, db))
    .get("/api/sync/ada/transfers/delta-capabilities?branchCode=004&contractVersion=transfer-delta-v1")
    .expect(200);
  assert.equal(capability.body.enabled, false);
  await request(app(config, db)).post("/api/sync/ada/transfers/delta").send({ branchCode: "004" }).expect(404);
});

test("inactive branch 002 remains disabled even if accidentally allowlisted", async () => {
  const db = {
    query: async () => { throw new Error("inactive capability must not query"); },
    connect: async () => { throw new Error("inactive apply must not connect"); },
  };
  const config = {
    posApiKeys: new Set(),
    featureTransferDeltaApply: true,
    featureTransferDeltaHardTombstones: false,
    transferDeltaBranches: new Set(["002"]),
  };
  const capability = await request(app(config, db))
    .get("/api/sync/ada/transfers/delta-capabilities?branchCode=002&contractVersion=transfer-delta-v1")
    .expect(200);
  assert.equal(capability.body.enabled, false);
  await request(app(config, db))
    .post("/api/sync/ada/transfers/delta")
    .send({ branchCode: "002" })
    .expect(404);
  await request(app(config, db))
    .post("/api/sync/ada/transfers/delta-rebaseline")
    .send({ branchCode: "002" })
    .expect(404);
});

let pool;
test.before(async () => {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const root = path.join(__dirname, "..", "..", "..", "..");
  await pool.query(fs.readFileSync(path.join(root, "migrations", "015_add_ada_raw_ingestion.sql"), "utf8"));
  const deltaMigration = fs.readFileSync(path.join(root, "migrations", "073_add_transfer_delta_delivery.sql"), "utf8");
  await pool.query(deltaMigration);
  await pool.query(deltaMigration); // idempotent rerun proof
  await pool.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`INSERT INTO public.schema_migrations(filename)
    VALUES ('migrations/073_add_transfer_delta_delivery.sql') ON CONFLICT DO NOTHING`);
});

test.after(async () => { if (pool) await pool.end(); });

test.beforeEach(async () => {
  if (!pool) return;
  await pool.query(`TRUNCATE ada.transfer_delta_tombstone_audit,ada.transfer_delta_requests,
    ada.transfer_delta_checkpoints,ada.transfer_lines,ada.transfer_headers RESTART IDENTITY CASCADE`);
});

const header = (status = "1") => ({
  docNo: "T-1", docType: "4", branchCode: "004", branchCodeTo: "005",
  docDate: "2026-09-23", docStatus: status, processStatus: "1",
});
const line = (lineNo, productCode, qty = 1) => ({
  docNo: "T-1", docType: "4", branchCode: "004", lineNo, productCode, qty, qtyBase: qty, stockFactor: 1,
});

async function withClient(action) {
  const client = await pool.connect();
  try { return await action(client); } finally { client.release(); }
}

async function seedCheckpoint(stateHash = "a".repeat(64)) {
  return withClient((client) => rebaselineTransferDelta(client, {
    branchCode: "004", contractVersion: "transfer-delta-v1", baseCheckpointToken: null,
    stateHash, idempotencyKey: sha(JSON.stringify([
      "004", "transfer-delta-v1", "rebaseline", null, stateHash,
    ])),
  }));
}

function applyBody(checkpoint, baseStateHash, nextStateHash, headers, lines, overrides = {}) {
  const body = {
    branchCode: "004", contractVersion: "transfer-delta-v1",
    baseCheckpointToken: checkpoint, baseStateHash, nextStateHash,
    headers, lines, tombstones: [], ...overrides,
  };
  body.contentHash = calculateContentHash(body);
  body.idempotencyKey = overrides.idempotencyKey || sha(JSON.stringify([
    body.branchCode, body.contractVersion, body.baseCheckpointToken,
    body.baseStateHash, body.nextStateHash, body.contentHash,
  ]));
  return body;
}

integration("migration constraints and capability expose durable token plus state hash", async () => {
  const constraints = await pool.query(`SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid IN ('ada.transfer_delta_checkpoints'::regclass,'ada.transfer_delta_requests'::regclass)`);
  assert.ok(constraints.rows[0].n >= 7);
  const seeded = await seedCheckpoint();
  const capability = await readCapability(pool, {
    featureTransferDeltaApply: true, featureTransferDeltaHardTombstones: false,
    transferDeltaBranches: new Set(["004"]),
  }, "004", "transfer-delta-v1");
  assert.equal(capability.checkpointToken, seeded.checkpointToken);
  assert.equal(capability.stateHash, "a".repeat(64));
  assert.equal(capability.hardTombstones, "disabled");
});

integration("read-only evidence summarizes rebaseline without exposing checkpoint material", async () => {
  await seedCheckpoint();
  const evidence = await readTransferDeltaEvidence(pool, "004");
  assert.equal(evidence.migration073Recorded, true);
  assert.deepEqual(evidence.tables, { checkpoints: true, requests: true, tombstoneAudit: true });
  assert.equal(evidence.checkpoint.rowCount, 1);
  assert.equal(evidence.checkpoint.sequence, 1);
  assert.equal(evidence.checkpoint.hasToken, true);
  assert.equal(evidence.checkpoint.hasStateHash, true);
  assert.equal(evidence.requests.rowCount, 1);
  assert.equal(evidence.requests.latest.operation, "rebaseline");
  assert.equal(evidence.requests.latest.status, "applied");
  assert.equal(evidence.tombstoneAuditRows, 0);
  assert.equal(JSON.stringify(evidence).includes("checkpointToken"), false);
  assert.equal(JSON.stringify(evidence).includes("stateHash"), false);
});

integration("whole-document replacement is set-based, removes stale lines, and matches Full projection", async () => {
  const seedResult = await seedCheckpoint();
  let body = applyBody(seedResult.checkpointToken, "a".repeat(64), "b".repeat(64),
    [header()], [line(1, "P1"), line(2, "P2")]);
  const statements = [];
  const first = await withClient(async (client) => {
    const original = client.query;
    client.query = (sql, params) => {
      if (typeof sql === "string") statements.push(sql.replace(/\s+/g, " "));
      return original.call(client, sql, params);
    };
    try {
      return await applyTransferDelta(client, body, body.headers, body.lines);
    } finally {
      client.query = original;
    }
  });
  assert.equal(first.acceptedLines, 2);
  assert.equal(statements.filter((sql) => /INSERT INTO ada\.transfer_lines/.test(sql)).length, 1);
  assert.equal(statements.some((sql) => /FROM UNNEST/.test(sql)), true);

  body = applyBody(first.checkpointToken, "b".repeat(64), "c".repeat(64),
    [header("3")], [line(1, "P1", 7)]);
  const second = await withClient((client) => applyTransferDelta(client, body, body.headers, body.lines));
  const rows = await pool.query(`SELECT h.doc_status,l.line_no,l.product_code,l.qty
    FROM ada.transfer_headers h JOIN ada.transfer_lines l USING(doc_no,doc_type,branch_code)
    WHERE h.branch_code='004' ORDER BY l.line_no,l.product_code`);
  assert.deepEqual(rows.rows.map((row) => ({ ...row, qty: Number(row.qty) })), [
    { doc_status: "3", line_no: 1, product_code: "P1", qty: 7 },
  ]);
  assert.equal(second.stateHash, "c".repeat(64));
});

integration("duplicate replay is idempotent; hash conflict and stale checkpoint are rejected", async () => {
  const seeded = await seedCheckpoint();
  const body = applyBody(seeded.checkpointToken, "a".repeat(64), "b".repeat(64), [header()], [line(1, "P1")]);
  const first = await withClient((client) => applyTransferDelta(client, body, body.headers, body.lines));
  const replay = await withClient((client) => applyTransferDelta(client, body, body.headers, body.lines));
  assert.equal(replay.replayed, true);
  assert.equal(replay.checkpointToken, first.checkpointToken);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_lines")).rows[0].n, 1);

  const advance = applyBody(first.checkpointToken, "b".repeat(64), "e".repeat(64),
    [header()], [line(1, "P1", 4)]);
  await withClient((client) => applyTransferDelta(client, advance, advance.headers, advance.lines));
  await assert.rejects(withClient((client) => applyTransferDelta(client, body, body.headers, body.lines)),
    (error) => error.code === "TRANSFER_DELTA_REPLAY_STALE");

  const conflict = applyBody(first.checkpointToken, "b".repeat(64), "c".repeat(64),
    [header()], [line(1, "P1", 2)], { idempotencyKey: body.idempotencyKey });
  await assert.rejects(withClient((client) => applyTransferDelta(client, conflict, conflict.headers, conflict.lines)),
    (error) => error.code === "TRANSFER_DELTA_IDEMPOTENCY_CONFLICT");
  const stale = applyBody("stale", "b".repeat(64), "d".repeat(64), [header()], [line(1, "P1", 3)]);
  await assert.rejects(withClient((client) => applyTransferDelta(client, stale, stale.headers, stale.lines)),
    (error) => error.code === "TRANSFER_DELTA_CHECKPOINT_CONFLICT");
});

integration("transaction failure rolls back document and checkpoint", async () => {
  const seeded = await seedCheckpoint();
  const before = await readCapability(pool, { featureTransferDeltaApply:true,
    transferDeltaBranches:new Set(["004"]) }, "004", "transfer-delta-v1");
  const duplicateLines = [line(1, "P1"), line(1, "P1", 2)];
  const body = applyBody(seeded.checkpointToken, "a".repeat(64), "b".repeat(64), [header()], duplicateLines);
  await assert.rejects(withClient((client) => applyTransferDelta(client, body, body.headers, body.lines)));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_headers")).rows[0].n, 0);
  const after = await readCapability(pool, { featureTransferDeltaApply:true,
    transferDeltaBranches:new Set(["004"]) }, "004", "transfer-delta-v1");
  assert.equal(after.checkpointToken, before.checkpointToken);
  assert.equal(after.stateHash, before.stateHash);
});

integration("hard tombstones are rejected while separately disabled", async () => {
  const seeded = await seedCheckpoint();
  const body = applyBody(seeded.checkpointToken, "a".repeat(64), "b".repeat(64), [], [], {
    tombstones: [{ branchCode:"004",docType:"4",docNo:"T-1",
      evidenceType:"source-hard-delete",evidenceId:"source-row-1" }],
  });
  await assert.rejects(withClient((client) => applyTransferDelta(client, body, [], [], { allowHardTombstones:false })),
    (error) => error.code === "TRANSFER_DELTA_TOMBSTONES_DISABLED");
});

integration("explicit hard tombstone requires the separate gate and writes audit evidence", async () => {
  const seeded = await seedCheckpoint();
  const create = applyBody(seeded.checkpointToken, "a".repeat(64), "b".repeat(64),
    [header()], [line(1, "P1")]);
  const created = await withClient((client) => applyTransferDelta(client, create, create.headers, create.lines));
  const tombstone = applyBody(created.checkpointToken, "b".repeat(64), "c".repeat(64), [], [], {
    tombstones: [{ branchCode:"004",docType:"4",docNo:"T-1",
      evidenceType:"source-hard-delete",evidenceId:"source-row-1" }],
  });
  await withClient((client) => applyTransferDelta(client, tombstone, [], [], { allowHardTombstones:true }));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_headers")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_lines")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_delta_tombstone_audit")).rows[0].n, 1);
});

const authenticatedConfig = {
  posApiKeys: new Set(["synthetic-pos-key"]), featureTransferDeltaApply: true,
  featureTransferDeltaHardTombstones: false, transferDeltaBranches: new Set(["004", "002"]),
};

test("POS authentication and inactive collector guards reject before acquiring a DB client", async () => {
  const db = { connect: async () => { throw new Error("must not connect"); } };
  const instance = app(authenticatedConfig, db);
  for (const key of [null, "invalid-synthetic-key"]) {
    let requestBuilder = request(instance).post("/api/sync/ada/transfers/delta");
    if (key) requestBuilder = requestBuilder.set("x-api-key", key);
    await requestBuilder.send({ branchCode: "004" }).expect(401);
  }
  await request(instance).post("/api/sync/ada/transfers/delta")
    .set("x-api-key", "synthetic-pos-key").send({ branchCode: "002" }).expect(404);
});

test("unrelated or inactive senders, duplicate headers and orphan lines remain rejected before SQL", async () => {
  for (const [headers, lines, message] of [
    [[{ ...header(), branchCode: "001", branchCodeTo: "005" }], [], "Transfer Delta cannot mix branch codes."],
    [[{ ...header(), branchCode: "002", branchCodeTo: "004" }], [], "Transfer Delta cannot mix branch codes."],
    [[header(), header()], [], "Transfer Delta contains a duplicate document header."],
    [[header()], [{ ...line(1, "P1"), branchCode: "001" }], "Every Transfer Delta line requires its complete document header."],
  ]) {
    const body = applyBody(null, "a".repeat(64), "b".repeat(64), headers, lines);
    await assert.rejects(applyTransferDelta({ query: async () => { throw new Error("must not query"); } },
      body, body.headers, body.lines), (error) => error.status === 400 && error.message === message);
  }
});

integration("authenticated Agent-shaped mixed incoming and outgoing payload preserves canonical keys and retry idempotency", async () => {
  const checkpoint = await seedCheckpoint();
  const sources = ["000", "001", "001", "001", "001", "004"];
  const lineCounts = [4, 5, 5, 5, 5, 10];
  // This is the Agent wire shape: canonical branchCode, branchTo and seqNo.
  const headers = sources.map((branchCode, index) => ({ docNo: `MIX-${index}`, docType: "4",
    branchCode, branchTo: branchCode === "004" ? "005" : "004", docDate: "2026-10-09" }));
  const lines = headers.flatMap((record, index) => Array.from({ length: lineCounts[index] }, (_, offset) => ({
    docNo: record.docNo, docType: record.docType, branchCode: record.branchCode,
    seqNo: offset + 1, productCode: `SYNTHETIC-${offset}`, qty: 1,
  })));
  const body = applyBody(checkpoint.checkpointToken, "a".repeat(64), "b".repeat(64), headers, lines);
  const instance = app(authenticatedConfig, pool);
  const first = await request(instance).post("/api/sync/ada/transfers/delta")
    .set("x-api-key", "synthetic-pos-key").send(body).expect(200);
  assert.equal(first.body.acceptedHeaders, 6);
  assert.equal(first.body.acceptedLines, 34);
  assert.equal(first.body.checkpointSequence, 2);
  const replay = await request(instance).post("/api/sync/ada/transfers/delta")
    .set("x-api-key", "synthetic-pos-key").send(body).expect(200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.checkpointToken, first.body.checkpointToken);
  assert.deepEqual((await pool.query(`SELECT branch_code,count(*)::int AS n FROM ada.transfer_headers
    GROUP BY branch_code ORDER BY branch_code`)).rows,
  [{ branch_code: "000", n: 1 }, { branch_code: "001", n: 4 }, { branch_code: "004", n: 1 }]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_lines")).rows[0].n, 34);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_delta_requests WHERE operation='apply'")).rows[0].n, 1);
});

integration("incoming Delta replaces the Full projection under the sender key and removes stale lines", async () => {
  const incomingHeader = { ...header(), branchCode: "000", branchCodeTo: "004" };
  const incomingLines = [1, 2].map((number) => ({ ...line(number, `P${number}`), branchCode: "000" }));
  const instance = app(authenticatedConfig, pool);
  await request(instance).post("/api/sync/ada/transfers").set("x-api-key", "synthetic-pos-key")
    .send({ headers: [incomingHeader], lines: incomingLines }).expect(200);
  const checkpoint = await seedCheckpoint();
  const body = applyBody(checkpoint.checkpointToken, "a".repeat(64), "b".repeat(64), [incomingHeader],
    [{ ...incomingLines[0], qty: 7 }]);
  await request(instance).post("/api/sync/ada/transfers/delta").set("x-api-key", "synthetic-pos-key")
    .send(body).expect(200);
  assert.deepEqual((await pool.query(`SELECT h.branch_code,h.branch_code_to,l.line_no,l.qty::float8 AS qty
    FROM ada.transfer_headers h JOIN ada.transfer_lines l USING(doc_no,doc_type,branch_code)`)).rows,
  [{ branch_code: "000", branch_code_to: "004", line_no: 1, qty: 7 }]);
});

integration("spoofed incoming receiver cannot retarget an existing unrelated document and rolls back the whole Delta", async () => {
  const instance = app(authenticatedConfig, pool);
  const unrelatedHeader = { ...header(), branchCode: "000", branchCodeTo: "005" };
  await request(instance).post("/api/sync/ada/transfers").set("x-api-key", "synthetic-pos-key")
    .send({ headers: [unrelatedHeader], lines: [{ ...line(1, "P1"), branchCode: "000" }] }).expect(200);
  const checkpoint = await seedCheckpoint();
  const outgoing = { ...header(), docNo: "OUTGOING-BEFORE-CONFLICT" };
  const body = applyBody(checkpoint.checkpointToken, "a".repeat(64), "b".repeat(64),
    [outgoing, { ...unrelatedHeader, branchCodeTo: "004" }],
    [{ ...line(1, "P1", 99), branchCode: "000" }]);
  for (let retry = 0; retry < 2; retry += 1) {
    const result = await request(instance).post("/api/sync/ada/transfers/delta")
      .set("x-api-key", "synthetic-pos-key").send(body).expect(400);
    assert.equal(result.body.message, "Transfer Delta cannot mix branch codes.");
    assert.equal((await pool.query("SELECT checkpoint_sequence FROM ada.transfer_delta_checkpoints")).rows[0].checkpoint_sequence, "1");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_delta_requests WHERE operation='apply'")).rows[0].n, 0);
    assert.deepEqual((await pool.query(`SELECT h.branch_code,h.branch_code_to,l.qty::float8 AS qty
      FROM ada.transfer_headers h JOIN ada.transfer_lines l USING(doc_no,doc_type,branch_code)`)).rows,
    [{ branch_code: "000", branch_code_to: "005", qty: 1 }]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_headers")).rows[0].n, 1);
  }
});

integration("atomic incoming UPSERT ownership guard rejects a concurrent unrelated insert", async () => {
  const checkpoint = await seedCheckpoint();
  const incoming = { ...header(), docNo: "RACE", branchCode: "000", branchCodeTo: "004" };
  const body = applyBody(checkpoint.checkpointToken, "a".repeat(64), "b".repeat(64), [incoming], []);
  const blocker = await pool.connect();
  const delivery = await pool.connect();
  let reachedInsert;
  const reached = new Promise((resolve) => { reachedInsert = resolve; });
  try {
    await blocker.query("BEGIN");
    await blocker.query(`INSERT INTO ada.transfer_headers(doc_no,doc_type,branch_code,branch_code_to,source_synced_at)
      VALUES ('RACE','4','000','005',now())`);
    const outcome = applyTransferDelta({ query: (sql, params) => {
      if (/INSERT INTO ada\.transfer_headers/.test(sql)) reachedInsert();
      return delivery.query(sql, params);
    } }, body, body.headers, body.lines).then(() => ({ ok: true }), (error) => ({ error }));
    await Promise.race([reached, outcome.then(() => { throw new Error("Delta did not reach the incoming UPSERT"); })]);
    await blocker.query("COMMIT");
    const result = await outcome;
    assert.equal(result.error?.status, 400);
    assert.equal(result.error?.message, "Transfer Delta cannot mix branch codes.");
    assert.equal((await pool.query("SELECT branch_code_to FROM ada.transfer_headers WHERE doc_no='RACE'")).rows[0].branch_code_to, "005");
    assert.equal((await pool.query("SELECT checkpoint_sequence FROM ada.transfer_delta_checkpoints")).rows[0].checkpoint_sequence, "1");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ada.transfer_delta_requests WHERE operation='apply'")).rows[0].n, 0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release(); delivery.release();
  }
});
