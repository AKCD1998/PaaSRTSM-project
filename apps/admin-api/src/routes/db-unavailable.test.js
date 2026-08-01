"use strict";

// 2026-07-31 incident (SC-StockDay-Ordering repo:
// docs/sync-program/INCIDENT_2026-07-31_MORNING_SYNC.md): every ingestion
// route in sync-ada.js, sync.js, and branch-stock.js called
// `await db.connect()` outside its own try/catch. When the pool could not
// hand out a connection, the rejection escaped the Express 4 async handler
// as an uncaught exception and took the whole process down (deployed
// sync-ada.js:2065, the incident's exact failure site).
//
// These tests exercise the fix — apps/admin-api/src/utils/db-acquire.js's
// acquireIngestionDbClient(), wired into every acquisition site in all
// three route files — against the real router factories, not a
// reimplementation.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const request = require("supertest");

const { createAdaSyncRouter } = require("./sync-ada");
const { createSyncRouter } = require("./sync");
const { createBranchStockRouter } = require("./branch-stock");
const { acquireIngestionDbClient, safeErrorClassification } = require("../utils/db-acquire");

function makeControllableDb() {
  let rejectNext = false;
  const client = {
    released: false,
    releaseCount: 0,
    rollbackCount: 0,
    commitCount: 0,
    queries: [],
    failNextQuery: false,
    async query(sql) {
      client.queries.push(sql);
      if (sql === "ROLLBACK") client.rollbackCount += 1;
      if (sql === "COMMIT") client.commitCount += 1;
      if (client.failNextQuery && sql !== "BEGIN" && sql !== "ROLLBACK" && sql !== "COMMIT") {
        client.failNextQuery = false;
        throw new Error("simulated post-acquisition query failure");
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      client.released = true;
      client.releaseCount += 1;
    },
  };
  return {
    client,
    async connect() {
      if (rejectNext) {
        const err = new Error("timeout exceeded when trying to connect");
        throw err;
      }
      return client;
    },
    async query() {
      // Only used by sync.js's fire-and-forget per-dataset logging middleware
      // when x-sync-run-id is set; tests below never set that header.
      return { rows: [], rowCount: 0 };
    },
    rejectNextAcquisition(value = true) {
      rejectNext = value;
    },
  };
}

function makeAdaApp(db, crmMirrorClient) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/sync/ada",
    createAdaSyncRouter({ config: { posApiKeys: new Set() }, db, crmMirrorClient: crmMirrorClient || { enabled: false } }),
  );
  app.use((error, req, res, _next) => res.status(error.statusCode || error.status || 500).json({ message: error.message }));
  return app;
}

function makeSyncApp(db) {
  const app = express();
  app.use(express.json());
  app.use("/api/sync", createSyncRouter({ config: { posApiKeys: new Set() }, db }));
  app.use((error, req, res, _next) => res.status(error.statusCode || error.status || 500).json({ message: error.message }));
  return app;
}

function makeBranchStockApp(db) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createBranchStockRouter({
      config: { posApiKeys: new Set() },
      db,
      requireAuthMiddleware: (req, res, next) => next(),
      requireRoleMiddleware: () => (req, res, next) => next(),
      requireCsrfMiddleware: (req, res, next) => next(),
    }),
  );
  app.use((error, req, res, _next) => res.status(error.statusCode || error.status || 500).json({ message: error.message }));
  return app;
}

const salesPayload = {
  headers: [{ FTBchCode: "005", FTShdDocNo: "D1", FTShdDocType: "1" }],
  lines: [{ FTBchCode: "005", FTShdDocNo: "D1", FNSdtSeqNo: 1, FTPdtCode: "P1" }],
};

const productsPayload = { records: [{ productCode: "P1", productName: "Test" }] };

const branchStockPayload = {
  branchCode: "005",
  records: [{ product_code: "P1", qty: 1, synced_at: new Date().toISOString() }],
};

// --- 1. Exact incident route ------------------------------------------------

test("REQUIRED (exact incident route): POST /api/sync/ada/sales returns 503 DB_UNAVAILABLE when db.connect() rejects, and touches no client", async () => {
  const db = makeControllableDb();
  db.rejectNextAcquisition(true);

  const response = await request(makeAdaApp(db)).post("/api/sync/ada/sales").send(salesPayload);

  assert.equal(response.status, 503);
  assert.equal(response.body.error, "DB_UNAVAILABLE");
  assert.equal(typeof response.body.message, "string");
  assert.ok(!("stack" in response.body), "must not leak a stack trace");
  assert.ok(!JSON.stringify(response.body).toLowerCase().includes("timeout exceeded"), "must not leak the raw pg error message");
  // No client was ever returned by db.connect(), so ROLLBACK/release must never fire.
  assert.equal(db.client.rollbackCount, 0);
  assert.equal(db.client.releaseCount, 0);
});

// --- 2. Process/server survives, serves the next request -------------------

test("REQUIRED: the same server instance serves a normal /sales request immediately after a DB_UNAVAILABLE rejection", async () => {
  const db = makeControllableDb();
  const app = makeAdaApp(db);

  db.rejectNextAcquisition(true);
  const first = await request(app).post("/api/sync/ada/sales").send(salesPayload);
  assert.equal(first.status, 503);

  db.rejectNextAcquisition(false);
  const second = await request(app).post("/api/sync/ada/sales").send(salesPayload);
  assert.equal(second.status, 200);
  assert.equal(second.body.acceptedHeaders, 1);
});

// --- 3. No process-level unhandledRejection ---------------------------------

test("REQUIRED: a rejected acquisition never produces a process-level unhandledRejection", async () => {
  let unhandled = null;
  const onUnhandled = (reason) => {
    unhandled = reason;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const db = makeControllableDb();
    db.rejectNextAcquisition(true);
    const response = await request(makeAdaApp(db)).post("/api/sync/ada/sales").send(salesPayload);
    assert.equal(response.status, 503);
    // Give any stray microtask a turn before asserting silence.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled, null, `expected no unhandledRejection, got: ${unhandled}`);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

// --- 4. No rollback/release without an acquired client (also covered by test 1, restated for /products and /branch-stock/sync) ---

test("REQUIRED: POST /api/sync/products returns 503 and never rolls back/releases a client it never acquired", async () => {
  const db = makeControllableDb();
  db.rejectNextAcquisition(true);

  const response = await request(makeSyncApp(db)).post("/api/sync/products").send(productsPayload);

  assert.equal(response.status, 503);
  assert.equal(response.body.error, "DB_UNAVAILABLE");
  assert.equal(db.client.rollbackCount, 0);
  assert.equal(db.client.releaseCount, 0);
});

test("REQUIRED: POST /api/branch-stock/sync returns 503 and never rolls back/releases a client it never acquired", async () => {
  const db = makeControllableDb();
  db.rejectNextAcquisition(true);

  const response = await request(makeBranchStockApp(db)).post("/api/branch-stock/sync").send(branchStockPayload);

  assert.equal(response.status, 503);
  assert.equal(response.body.error, "DB_UNAVAILABLE");
  assert.equal(db.client.rollbackCount, 0);
  assert.equal(db.client.releaseCount, 0);
});

// --- 5. A normal /sales request still succeeds ------------------------------

test("REQUIRED: a normal (no acquisition failure) /sales request still succeeds end to end", async () => {
  const db = makeControllableDb();
  const response = await request(makeAdaApp(db)).post("/api/sync/ada/sales").send(salesPayload);
  assert.equal(response.status, 200);
  assert.equal(response.body.acceptedHeaders, 1);
  assert.equal(response.body.acceptedLines, 1);
  assert.equal(db.client.commitCount, 1);
  assert.equal(db.client.rollbackCount, 0);
  assert.equal(db.client.releaseCount, 1, "must release exactly once");
});

// --- 6. CRM mirror behavior unchanged (release before mirror, mirror failure non-fatal, no double release) ---

test("REQUIRED: CRM mirror behavior is unchanged by this fix — connection released before the mirror call, mirror failure is non-fatal, no double release", async () => {
  const db = makeControllableDb();
  let releasedBeforeMirrorStarted = false;
  const crmMirrorClient = {
    enabled: true,
    async mirrorSales() {
      releasedBeforeMirrorStarted = db.client.released;
      throw Object.assign(new Error("Payload too large"), { status: 413 });
    },
    async mirrorRefunds() {
      return { ok: true, body: {} };
    },
  };

  const response = await request(makeAdaApp(db, crmMirrorClient)).post("/api/sync/ada/sales").send(salesPayload);

  assert.equal(response.status, 200, "a non-fatal mirror failure must not turn an already-committed sync into an error response");
  assert.equal(releasedBeforeMirrorStarted, true);
  assert.equal(db.client.releaseCount, 1, "must not double-release");
});

// --- 7. Shared records-handler endpoint (/products in sync-ada.js) also protected ---

test("REQUIRED: POST /api/sync/ada/products (shared records-handler) returns 503 when db.connect() rejects", async () => {
  const db = makeControllableDb();
  db.rejectNextAcquisition(true);

  const response = await request(makeAdaApp(db))
    .post("/api/sync/ada/products")
    .send({ records: [{ productCode: "P1" }] });

  assert.equal(response.status, 503);
  assert.equal(response.body.error, "DB_UNAVAILABLE");
});

// --- 8. Structural coverage across every audited acquisition site ----------

test("REQUIRED: every db.connect() acquisition site in the three audited route files goes through acquireIngestionDbClient", () => {
  const files = [
    path.join(__dirname, "sync-ada.js"),
    path.join(__dirname, "sync.js"),
    path.join(__dirname, "branch-stock.js"),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rawSites = source.match(/await\s+db\.connect\(\)/g) || [];
    assert.equal(
      rawSites.length,
      0,
      `${path.basename(file)} has ${rawSites.length} unguarded "await db.connect()" call(s) bypassing acquireIngestionDbClient`,
    );
    const helperSites = source.match(/await\s+acquireIngestionDbClient\(/g) || [];
    assert.ok(helperSites.length > 0, `${path.basename(file)} should use acquireIngestionDbClient at least once`);
  }
});

// --- 9. A successful acquisition followed by a query failure still rolls back and releases exactly once ---

test("REQUIRED: a successful acquisition followed by a downstream query failure still rolls back and releases exactly once", async () => {
  const db = makeControllableDb();
  db.client.failNextQuery = true; // fails the first upsert after BEGIN

  const response = await request(makeAdaApp(db)).post("/api/sync/ada/sales").send(salesPayload);

  assert.equal(response.status, 500);
  assert.equal(db.client.rollbackCount, 1);
  assert.equal(db.client.commitCount, 0);
  assert.equal(db.client.releaseCount, 1, "must release exactly once, not zero and not twice");
});

// --- 10. The 503 path does not falsely create a successful sync/run-log result ---

test("REQUIRED: a DB_UNAVAILABLE response never reports acceptance/success counts", async () => {
  const db = makeControllableDb();
  db.rejectNextAcquisition(true);

  const response = await request(makeAdaApp(db)).post("/api/sync/ada/sales").send(salesPayload);

  assert.equal(response.status, 503);
  assert.equal(response.body.acceptedHeaders, undefined);
  assert.equal(response.body.acceptedLines, undefined);
  assert.notEqual(response.body.error, undefined);
});

// --- 11. Sender-side: any non-2xx (including 503) is thrown as a retryable error, never treated as success ---
// Characterized directly from SC-StockDay-Ordering/apps/adapos-sync/src/client.js
// postJson(): `if (!response.ok) throw ...`. No sender code change was made or
// needed. This test documents that contract locally using the same shape.
test("REQUIRED (documentary, sender contract): a 503 response is !response.ok, matching the sender's existing throw-on-non-2xx behavior", async () => {
  const db = makeControllableDb();
  db.rejectNextAcquisition(true);
  const response = await request(makeAdaApp(db)).post("/api/sync/ada/sales").send(salesPayload);
  assert.equal(response.status, 503);
  assert.ok(response.status < 200 || response.status >= 300, "503 must be outside the 2xx range the sender treats as success");
});

// --- 12. Unit coverage of the helper itself ---------------------------------

test("acquireIngestionDbClient: returns the client on success and never touches res", async () => {
  const db = makeControllableDb();
  let resTouched = false;
  const fakeRes = new Proxy(
    {},
    {
      get() {
        resTouched = true;
        return () => fakeRes;
      },
    },
  );
  const client = await acquireIngestionDbClient(db, fakeRes, "test:unit");
  assert.equal(client, db.client);
  assert.equal(resTouched, false);
});

// --- 13. Codex CLAIM-X-070: a code-less rejection's raw error.message must never reach the server log ---

test("REQUIRED (fixes CLAIM-X-070): a code-less acquisition error's raw message (e.g. connection-string-shaped) never reaches the server log or the HTTP response", async () => {
  const originalConsoleError = console.error;
  const loggedLines = [];
  console.error = (...args) => loggedLines.push(args.join(" "));
  try {
    const db = {
      connect: async () => {
        throw new Error("connect postgres://review_user:LEAK_SENTINEL@db.invalid/app");
      },
    };
    let statusCode = null;
    let jsonBody = null;
    const fakeRes = {
      req: { requestId: "req-test" },
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      },
    };
    const client = await acquireIngestionDbClient(db, fakeRes, "test:sentinel");
    assert.equal(client, null);
    assert.equal(statusCode, 503);
    assert.ok(
      !JSON.stringify(jsonBody).includes("LEAK_SENTINEL"),
      "the HTTP response must never contain the raw error message",
    );
    const logText = loggedLines.join("\n");
    assert.ok(
      !logText.includes("LEAK_SENTINEL"),
      `the server log must never contain the raw error message/connection string, got: ${logText}`,
    );
    assert.ok(logText.includes("NO_SAFE_ERROR_CODE"), "a code-less error must classify to the fixed safe constant");
  } finally {
    console.error = originalConsoleError;
  }
});

test("safeErrorClassification: allowlists a short alphanumeric pg/node error code and rejects everything else, including message-shaped strings", () => {
  assert.equal(safeErrorClassification({ code: "ETIMEDOUT" }), "ETIMEDOUT");
  assert.equal(safeErrorClassification({ code: "57014" }), "57014");
  assert.equal(safeErrorClassification({ code: "postgres://user:pass@host/db" }), "NO_SAFE_ERROR_CODE");
  assert.equal(safeErrorClassification({ message: "connect postgres://user:pass@host/db" }), "NO_SAFE_ERROR_CODE");
  assert.equal(safeErrorClassification({}), "NO_SAFE_ERROR_CODE");
  assert.equal(safeErrorClassification(null), "NO_SAFE_ERROR_CODE");
});

test("acquireIngestionDbClient: on rejection, returns null and writes exactly one 503 DB_UNAVAILABLE response", async () => {
  const db = makeControllableDb();
  db.rejectNextAcquisition(true);
  let statusCode = null;
  let jsonBody = null;
  const fakeRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return this;
    },
  };
  const client = await acquireIngestionDbClient(db, fakeRes, "test:unit");
  assert.equal(client, null);
  assert.equal(statusCode, 503);
  assert.equal(jsonBody.error, "DB_UNAVAILABLE");
});
