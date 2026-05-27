"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");

function buildConfig() {
  return {
    nodeEnv: "test",
    port: 0,
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    authJwtSecret: "test-jwt-secret",
    cookieName: "admin_session",
    cookieSecure: false,
    cookieSameSite: "lax",
    sessionTtlHours: 12,
    trustProxy: false,
    loginRateLimitMax: 20,
    loginRateLimitWindowMs: 60_000,
    maxUploadBytes: 5 * 1024 * 1024,
    defaultPeriodDays: 30,
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    posApiKeys: new Set(["test-pos-key"]),
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createBranchStockMockDb() {
  const state = {
    snapshots: new Map(),
    products: new Map(),
    productBarcodes: new Map(),
    uploads: new Map(),
    txLog: [],
  };

  const db = {
    state,
    connect() {
      return {
        query: db.query.bind(db),
        async release() {},
      };
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        state.txLog.push(normalized);
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into public.audit_logs")) {
        return {
          rowCount: 1,
          rows: [{ audit_id: 1, event_time: new Date().toISOString() }],
        };
      }

      if (normalized.startsWith("insert into ada.branch_stock_snapshots")) {
        state.snapshots.set(params[0], {
          product_code: params[0],
          product_name_thai: params[1],
          product_name_eng: params[2],
          barcode: params[3],
          unit: params[4],
          qty_branch_000: params[5],
          qty_branch_001: params[6],
          qty_branch_002: params[7],
          qty_branch_003: params[8],
          qty_branch_004: params[9],
          qty_branch_005: params[10],
          qty_total_all_branches: params[11],
          synced_at: params[12],
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("select product_code, product_name_thai, product_name_eng, barcode, unit, qty_branch_000")) {
        const row = state.snapshots.get(params[0]) || null;
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      if (normalized.startsWith("select branch_stock_upload_id, accepted_rows, rejected_rows, warnings from ada.branch_stock_uploads")) {
        const upload = state.uploads.get(params[0]) || null;
        return { rowCount: upload ? 1 : 0, rows: upload ? [upload] : [] };
      }

      if (normalized.startsWith("insert into ada.branch_stock_uploads")) {
        const uploadId = state.uploads.size + 1;
        const upload = {
          branch_stock_upload_id: uploadId,
          branch_code: params[0],
          source_mode: params[1],
          source_date: params[2],
          generated_at: params[3],
          source_reference: params[4],
          idempotency_key: params[5],
          payload_hash: params[6],
          raw_payload: JSON.parse(params[7]),
          diagnostics: JSON.parse(params[8]),
          normalized_records: JSON.parse(params[9]),
          status: "pending",
          accepted_rows: 0,
          rejected_rows: 0,
          warnings: [],
        };
        state.uploads.set(upload.idempotency_key, upload);
        return { rowCount: 1, rows: [{ branch_stock_upload_id: uploadId }] };
      }

      if (normalized.startsWith("update ada.branch_stock_uploads set status =")) {
        const upload = [...state.uploads.values()].find((item) => item.branch_stock_upload_id === params[0]);
        if (upload) {
          upload.status = params[1];
          upload.accepted_rows = params[2];
          upload.rejected_rows = params[3];
          upload.warnings = JSON.parse(params[4]);
        }
        return { rowCount: upload ? 1 : 0, rows: [] };
      }

      if (normalized.startsWith("select count(*)::int as total from ada.branch_stock_snapshots bs")) {
        const search = String(params[0] || "").toLowerCase();
        const matches = [...state.snapshots.values()].filter((row) => {
          const product = state.products.get(row.product_code) || null;
          const barcode = row.barcode || state.productBarcodes.get(row.product_code) || null;
          if (!search) return true;
          return [
            row.product_code,
            row.product_name_thai || product?.product_name_th,
            row.product_name_eng || product?.product_name,
            barcode,
          ]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(search));
        });
        return { rowCount: 1, rows: [{ total: matches.length }] };
      }

      if (normalized.startsWith("select bs.product_code,")) {
        const search = String(params[0] || "").toLowerCase();
        const limit = Number(params[1]);
        const offset = Number(params[2]);
        const rows = [...state.snapshots.values()]
          .filter((row) => {
            const product = state.products.get(row.product_code) || null;
            const barcode = row.barcode || state.productBarcodes.get(row.product_code) || null;
            if (!search) return true;
            return [
              row.product_code,
              row.product_name_thai || product?.product_name_th,
              row.product_name_eng || product?.product_name,
              barcode,
            ]
              .filter(Boolean)
              .some((field) => String(field).toLowerCase().includes(search));
          })
          .sort((left, right) => left.product_code.localeCompare(right.product_code))
          .map((row) => {
            const product = state.products.get(row.product_code) || null;
            return {
              ...row,
              product_name_thai: row.product_name_thai || product?.product_name_th || null,
              product_name_eng: row.product_name_eng || product?.product_name || null,
              barcode: row.barcode || state.productBarcodes.get(row.product_code) || null,
              unit: row.unit || product?.unit_small || product?.unit_medium || product?.unit_large || null,
            };
          })
          .slice(offset, offset + limit);
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp() {
  const db = createBranchStockMockDb();
  const { app } = createApp({
    config: buildConfig(),
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db };
}

async function loginAsAdmin(agent) {
  const response = await agent.post("/admin/auth/login").send({
    username: "admin@example.com",
    password: "admin-pass-123",
  });
  assert.equal(response.status, 200);
}

test("branch stock sync and listing routes work on the shared backend", async () => {
  const { app, db } = createTestApp();

  const syncResponse = await request(app)
    .post("/api/branch-stock/sync")
    .set("x-api-key", "test-pos-key")
    .send({
      records: [
        {
          product_code: "630010001",
          product_name_thai: "เซทิริซีน",
          product_name_eng: "Cetirizine",
          barcode: "885000000001",
          unit: "BOX",
          qty_branch_000: 10,
          qty_branch_001: 5,
          qty_branch_002: 3,
          qty_branch_003: 4,
          qty_branch_004: 2,
          qty_branch_005: 8,
          qty_total_all_branches: 32,
          synced_at: "2026-05-25T08:00:00.000Z",
        },
      ],
    });

  assert.equal(syncResponse.status, 200);
  assert.equal(syncResponse.body.accepted, 1);
  assert.equal(syncResponse.body.insertedOrUpdated, 1);
  assert.equal(db.state.snapshots.size, 1);

  const legacySyncResponse = await request(app)
    .post("/api/sync/ada/branch-stock")
    .set("x-api-key", "test-pos-key")
    .send({
      records: [
        {
          product_code: "630010002",
          product_name_thai: "ลอราทาดีน",
          product_name_eng: "Loratadine",
          barcode: "885000000002",
          unit: "BOX",
          qty_branch_000: 1,
          qty_branch_001: 2,
          qty_branch_002: 0,
          qty_branch_003: 3,
          qty_branch_004: 4,
          qty_branch_005: 5,
          qty_total_all_branches: 15,
          synced_at: "2026-05-25T08:05:00.000Z",
        },
      ],
    });

  assert.equal(legacySyncResponse.status, 200);
  assert.equal(legacySyncResponse.body.accepted, 1);
  assert.equal(db.state.snapshots.size, 2);

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const listResponse = await agent.get("/api/branch-stock?search=loratadine&limit=25&offset=0");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.records.length, 1);
  assert.equal(listResponse.body.records[0].productCode, "630010002");
  assert.equal(listResponse.body.records[0].qtyBranch002, 0);
  assert.equal(listResponse.body.pagination.total, 1);

  assert.deepEqual(db.state.txLog, ["begin", "commit", "begin", "commit"]);
});

test("branch stock listing falls back to synced product metadata when snapshot fields are blank", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630010099", {
    product_code: "630010099",
    product_name_thai: null,
    product_name_eng: null,
    barcode: null,
    unit: null,
    qty_branch_000: 7,
    qty_branch_001: 0,
    qty_branch_002: 0,
    qty_branch_003: 1,
    qty_branch_004: 0,
    qty_branch_005: 2,
    qty_total_all_branches: 10,
    synced_at: "2026-05-25T08:10:00.000Z",
  });
  db.state.products.set("630010099", {
    product_name: "Cetirizine",
    product_name_th: "เซทิริซีน",
    unit_small: "BOX",
    unit_medium: null,
    unit_large: null,
  });
  db.state.productBarcodes.set("630010099", "885000009999");

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const listResponse = await agent.get("/api/branch-stock?search=เซทิริซีน&limit=25&offset=0");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.records.length, 1);
  assert.equal(listResponse.body.records[0].productCode, "630010099");
  assert.equal(listResponse.body.records[0].productNameThai, "เซทิริซีน");
  assert.equal(listResponse.body.records[0].productNameEng, "Cetirizine");
  assert.equal(listResponse.body.records[0].barcode, "885000009999");
  assert.equal(listResponse.body.records[0].unit, "BOX");
  assert.equal(listResponse.body.records[0].qtyBranch000, 7);
});

test("branch stock upload stores raw payload and merges one branch quantity into the shared snapshot", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630010001", {
    product_code: "630010001",
    product_name_thai: "เซทิริซีน",
    product_name_eng: "Cetirizine",
    barcode: "885000000001",
    unit: "BOX",
    qty_branch_000: 10,
    qty_branch_001: 0,
    qty_branch_002: 0,
    qty_branch_003: 0,
    qty_branch_004: 0,
    qty_branch_005: 0,
    qty_total_all_branches: 10,
    synced_at: "2026-05-25T08:00:00.000Z",
    raw_payload: {},
  });

  const uploadResponse = await request(app)
    .post("/api/branch-stock/upload")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "001",
      sourceMode: "excel",
      sourceDate: "2025-12-15",
      generatedAt: "2026-05-26T02:00:00.000Z",
      idempotencyKey: "branch-stock:001:2025-12-15:test",
      payloadHash: "abc123",
      sourceReference: "C:\\SC-StockDay-Exports\\001.xlsx",
      diagnostics: [],
      raw: {
        metadata: {
          fileName: "001.xlsx",
        },
        records: [
          {
            รหัส: "630010001",
            ชื่อสินค้า: "เซทิริซีน",
            BARCODE: "885000000001",
            หน่วย: "BOX",
            จำนวน: 3,
          },
        ],
      },
      records: [
        {
          productCode: "630010001",
          productNameThai: "เซทิริซีน",
          productNameEng: "Cetirizine",
          barcode: "885000000001",
          unit: "BOX",
          qty: 3,
          sourceRowNumber: 3,
          rawRecord: {
            รหัส: "630010001",
            จำนวน: 3,
          },
        },
      ],
    });

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadResponse.body.duplicate, false);
  assert.equal(uploadResponse.body.acceptedRows, 1);
  assert.equal(uploadResponse.body.rejectedRows, 0);
  assert.equal(db.state.uploads.size, 1);

  const snapshot = db.state.snapshots.get("630010001");
  assert.equal(snapshot.qty_branch_000, 10);
  assert.equal(snapshot.qty_branch_001, 3);
  assert.equal(snapshot.qty_total_all_branches, 13);

  const duplicateResponse = await request(app)
    .post("/api/branch-stock/upload")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "001",
      sourceMode: "excel",
      sourceDate: "2025-12-15",
      generatedAt: "2026-05-26T02:00:00.000Z",
      idempotencyKey: "branch-stock:001:2025-12-15:test",
      payloadHash: "abc123",
      raw: { metadata: {}, records: [] },
      records: [],
    });

  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicateResponse.body.duplicate, true);
});
