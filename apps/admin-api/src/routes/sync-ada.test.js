"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { createAdaSyncRouter } = require("./sync-ada");

function makeDb() {
  const client = {
    async query(sql) {
      return { rows: [], rowCount: 0 };
    },
    released: false,
    release() {
      this.released = true;
    },
  };
  return { client, connect: async () => client };
}

function makeApp(db, crmMirrorClient) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/sync/ada",
    createAdaSyncRouter({
      config: { posApiKeys: new Set() },
      db,
      crmMirrorClient,
    }),
  );
  app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  return app;
}

const salesPayload = {
  headers: [{ FTBchCode: "005", FTShdDocNo: "D1", FTShdDocType: "1" }],
  lines: [{ FTBchCode: "005", FTShdDocNo: "D1", FNSdtSeqNo: 1, FTPdtCode: "P1" }],
};

test("POST /sales releases the pool connection before waiting on the CRM mirror call", async () => {
  const db = makeDb();
  let releasedBeforeMirrorStarted = false;
  const crmMirrorClient = {
    enabled: true,
    async mirrorSales() {
      // If the connection is still checked out while this in-flight mirror
      // call is pending, a burst of concurrent /sales requests can exhaust
      // the pool (max 10) even though every DB write already committed —
      // see docs/sync-program/INCIDENT_2026-07-24_MORNING_SYNC_HOURGLASS.md.
      releasedBeforeMirrorStarted = db.client.released;
      return { ok: true, body: {} };
    },
    async mirrorRefunds() {
      return { ok: true, body: {} };
    },
  };

  const response = await request(makeApp(db, crmMirrorClient)).post("/api/sync/ada/sales").send(salesPayload);

  assert.equal(response.status, 200);
  assert.equal(releasedBeforeMirrorStarted, true, "expected client.release() to run before the mirror call");
  assert.equal(db.client.released, true);
});

test("POST /sales still responds successfully and releases the connection when the CRM mirror throws", async () => {
  const db = makeDb();
  const crmMirrorClient = {
    enabled: true,
    async mirrorSales() {
      throw Object.assign(new Error("Payload too large"), { status: 413 });
    },
    async mirrorRefunds() {
      return { ok: true, body: {} };
    },
  };

  const response = await request(makeApp(db, crmMirrorClient)).post("/api/sync/ada/sales").send(salesPayload);

  assert.equal(response.status, 200);
  assert.equal(db.client.released, true);
});

test("POST /sales does not double-release when there is no headers/lines mirror payload", async () => {
  const db = makeDb();
  const crmMirrorClient = { enabled: false };

  const response = await request(makeApp(db, crmMirrorClient))
    .post("/api/sync/ada/sales")
    .send({ headers: [], lines: [] });

  assert.equal(response.status, 200);
  assert.equal(db.client.released, true);
});
