"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSimulationExtractor,
  createSqlServerExtractor,
  getDatasetSql,
  loadAgentConfig,
  runAdaSyncAgent,
  saveWatermarks,
  loadWatermarks,
} = require("../scripts/lib/ada_sync_agent");

function createExtractor(resultsByDataset) {
  return {
    async extractDataset(datasetName, watermarkFrom) {
      const entry = resultsByDataset[datasetName];
      if (!entry) {
        return { recordsRead: 0, payload: null, watermarkTo: watermarkFrom || null };
      }
      if (entry.error) {
        throw new Error(entry.error);
      }
      return {
        recordsRead: entry.recordsRead,
        payload: entry.payload,
        watermarkTo: entry.watermarkTo,
        sourceTable: entry.sourceTable || null,
      };
    },
  };
}

function createFetchRecorder() {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    calls.push({
      url,
      options: {
        ...options,
        body: options.body ? JSON.parse(options.body) : null,
      },
    });
    return {
      ok: true,
      async text() {
        return JSON.stringify({ accepted: 1, id: String(calls.length) });
      },
    };
  }
  return { calls, fetchImpl };
}

test("loadAgentConfig defaults to dry-run simulation mode", () => {
  const config = loadAgentConfig({}, []);
  assert.equal(config.dryRun, true);
  assert.equal(config.driver, "simulation");
  assert.deepEqual(config.datasets, ["branches", "products", "transfers"]);
  assert.equal(config.branchCode, null);
});

test("loadAgentConfig parses a single branch pilot filter", () => {
  const config = loadAgentConfig({}, ["--branch=005", "--datasets=branches,transfers"]);
  assert.equal(config.branchCode, "005");
  assert.deepEqual(config.datasets, ["branches", "transfers"]);
});

test("watermark helpers round-trip JSON state", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ada-sync-watermark-"));
  const watermarkFile = path.join(tmpDir, "watermarks.json");

  await saveWatermarks(watermarkFile, { branches: "2026-05-21T08:00:00.000Z" });
  const loaded = await loadWatermarks(watermarkFile);

  assert.deepEqual(loaded, { branches: "2026-05-21T08:00:00.000Z" });
});

test("runAdaSyncAgent dry-run does not post dataset payloads or persist watermarks", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ada-sync-dry-run-"));
  const watermarkFile = path.join(tmpDir, "watermarks.json");
  await saveWatermarks(watermarkFile, { branches: "2026-05-20T00:00:00.000Z" });

  const { calls, fetchImpl } = createFetchRecorder();
  const result = await runAdaSyncAgent({
    config: {
      dryRun: true,
      datasets: ["branches"],
      driver: "simulation",
      fixturePath: "",
      watermarkFile,
      apiBaseUrl: "http://localhost:3001",
      apiKey: "test-pos-key",
      sourceLocation: "mother-pc",
      agentName: "adapos-sync",
      agentVersion: "0.1.0",
      sqlserver: {},
    },
    extractor: createExtractor({
      branches: {
        recordsRead: 2,
        watermarkTo: "2026-05-21T08:00:00.000Z",
        payload: {
          sourceSystem: "AdaAcc",
          sourceSyncedAt: "2026-05-21T08:00:00.000Z",
          records: [{ branchCode: "000" }, { branchCode: "001" }],
        },
      },
    }),
    fetchImpl,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.recordsRead, 2);
  assert.equal(result.recordsSent, 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/api/sync/ada/run-log"));
  const saved = await loadWatermarks(watermarkFile);
  assert.deepEqual(saved, { branches: "2026-05-20T00:00:00.000Z" });
});

test("runAdaSyncAgent execute mode posts payloads, advances watermarks, and logs success", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ada-sync-execute-"));
  const watermarkFile = path.join(tmpDir, "watermarks.json");
  await saveWatermarks(watermarkFile, { branches: "2026-05-20T00:00:00.000Z" });

  const { calls, fetchImpl } = createFetchRecorder();
  const result = await runAdaSyncAgent({
    config: {
      dryRun: false,
      datasets: ["branches", "transfers"],
      driver: "simulation",
      fixturePath: "",
      watermarkFile,
      apiBaseUrl: "http://localhost:3001",
      apiKey: "test-pos-key",
      sourceLocation: "mother-pc",
      agentName: "adapos-sync",
      agentVersion: "0.1.0",
      sqlserver: {},
    },
    extractor: createExtractor({
      branches: {
        recordsRead: 1,
        watermarkTo: "2026-05-21T08:00:00.000Z",
        payload: {
          sourceSystem: "AdaAcc",
          sourceSyncedAt: "2026-05-21T08:00:00.000Z",
          records: [{ branchCode: "000" }],
        },
      },
      transfers: {
        recordsRead: 2,
        watermarkTo: "2026-05-21T08:10:00.000Z",
        payload: {
          sourceSystem: "AdaAcc",
          sourceSyncedAt: "2026-05-21T08:10:00.000Z",
          headers: [{ FTPthDocNo: "TRF-001" }],
          lines: [{ FTPthDocNo: "TRF-001", FNPtdSeqNo: 1 }],
        },
      },
    }),
    fetchImpl,
  });

  assert.equal(result.status, "success");
  assert.equal(result.recordsRead, 3);
  assert.equal(result.recordsSent, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.endsWith("/api/sync/ada/branches"));
  assert.ok(calls[1].url.endsWith("/api/sync/ada/transfers"));
  assert.ok(calls[2].url.endsWith("/api/sync/ada/run-log"));

  const saved = await loadWatermarks(watermarkFile);
  assert.deepEqual(saved, {
    branches: "2026-05-21T08:00:00.000Z",
    transfers: "2026-05-21T08:10:00.000Z",
  });
});

test("simulation extractor filters branch-scoped datasets to the selected pilot branch", async () => {
  const extractor = await createSimulationExtractor(
    path.resolve(__dirname, "..", "scripts", "fixtures", "ada_sync_simulation.json"),
  );

  const branches = await extractor.extractDataset("branches", null, { branchCode: "005" });
  const transfers = await extractor.extractDataset("transfers", null, { branchCode: "005" });

  assert.equal(Array.isArray(branches.payload.records), true);
  assert.equal(branches.payload.records.length, 1);
  assert.equal(branches.payload.records[0].FTBchCode, "000");
  assert.equal(Array.isArray(transfers.payload.headers), true);
  assert.equal(transfers.payload.headers.length, 0);
  assert.equal(Array.isArray(transfers.payload.lines), true);
  assert.equal(transfers.payload.lines.length, 0);
});

test("runAdaSyncAgent logs failures without enabling production sync by default", async () => {
  const { calls, fetchImpl } = createFetchRecorder();
  const result = await runAdaSyncAgent({
    config: {
      dryRun: true,
      datasets: ["products"],
      driver: "simulation",
      fixturePath: "",
      watermarkFile: path.join(os.tmpdir(), `ada-sync-failure-${Date.now()}.json`),
      apiBaseUrl: "http://localhost:3001",
      apiKey: "test-pos-key",
      sourceLocation: "mother-pc",
      agentName: "adapos-sync",
      agentVersion: "0.1.0",
      sqlserver: {},
    },
    extractor: createExtractor({
      products: {
        error: "SQL timeout from AdaAcc",
      },
    }),
    fetchImpl,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errors.length, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/api/sync/ada/run-log"));
  assert.equal(calls[0].options.body.status, "failed");
});

test("live SQL definitions remain read-only SELECT statements", () => {
  const branchSql = getDatasetSql("branches");
  const productSql = getDatasetSql("products");
  const transferSql = getDatasetSql("transfers", "005");

  assert.match(branchSql.trim().toUpperCase(), /^(SELECT|WITH)/);
  assert.match(productSql.trim().toUpperCase(), /^(SELECT|WITH)/);
  assert.match(transferSql.headers.trim().toUpperCase(), /^(SELECT|WITH)/);
  assert.match(transferSql.lines.trim().toUpperCase(), /^(SELECT|WITH)/);
  assert.equal(/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(branchSql), false);
  assert.equal(/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(productSql), false);
  assert.equal(/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(transferSql.headers), false);
  assert.equal(/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(transferSql.lines), false);
  assert.match(transferSql.headers, /@branchCode/);
  assert.match(transferSql.lines, /@branchCode/);
});

test("createSqlServerExtractor applies the branch filter to live transfer queries", async () => {
  const requests = [];
  class FakeRequest {
    constructor() {
      this.inputs = [];
      requests.push(this);
    }

    input(name, type, value) {
      this.inputs.push({ name, type, value });
      return this;
    }

    async query(sqlText) {
      this.sqlText = sqlText;
      return { recordset: [] };
    }
  }

  class FakeConnectionPool {
    constructor(config) {
      this.config = config;
    }

    async connect() {}

    request() {
      return new FakeRequest();
    }

    async close() {}
  }

  const extractor = await createSqlServerExtractor(
    {
      host: "mother-pc",
      port: 1433,
      user: "readonly_user",
      password: "secret",
      database: "AdaAcc",
      branchCode: "005",
      encrypt: false,
      trustServerCertificate: true,
      requestTimeoutMs: 30000,
    },
    {
      ConnectionPool: FakeConnectionPool,
      DateTime: "DateTime",
      VarChar: "VarChar",
    },
  );

  await extractor.extractDataset("transfers", "2026-05-20T00:00:00.000Z");

  assert.equal(requests.length, 2);
  assert.ok(requests[0].sqlText.includes("@branchCode"));
  assert.ok(requests[1].sqlText.includes("TCNTPdtTnfHD.FTBchCode = @branchCode"));
  assert.deepEqual(
    requests.map((request) => request.inputs.find((entry) => entry.name === "branchCode")?.value),
    ["005", "005"],
  );
});
