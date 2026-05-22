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

function createReceiptMockDb() {
  const state = {
    pendingHeaders: new Map(),
    pendingLines: new Map(),
    approvedHeaders: new Map(),
    approvedLines: new Map(),
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

      if (normalized.startsWith("delete from ada.pending_receipt_headers where branch_code = $1")) {
        for (const [docNo, row] of state.pendingHeaders.entries()) {
          if (row.branch_code === params[0]) {
            state.pendingHeaders.delete(docNo);
            state.pendingLines.delete(docNo);
          }
        }
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into ada.pending_receipt_headers")) {
        state.pendingHeaders.set(params[0], {
          doc_no: params[0],
          branch_code: params[1],
          doc_type: params[2],
          doc_date: params[3],
          doc_time: params[4],
          supplier_code: params[5],
          supplier_name: params[6],
          ref_ext: params[7],
          ref_ext_date: params[8],
          warehouse_code: params[9],
          total: params[10],
          vat: params[11],
          grand: params[12],
          usr_code: params[13],
          created_by: params[14],
          created_at_ada: params[15],
          sta_doc: params[16],
          synced_at: params[19],
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.pending_receipt_lines")) {
        const list = state.pendingLines.get(params[0]) || [];
        list.push({
          doc_no: params[0],
          seq_no: params[1],
          product_code: params[2],
          product_name: params[3],
          barcode: params[4],
          unit_code: params[5],
          unit_name: params[6],
          factor: params[7],
          qty: params[8],
          qty_base: params[9],
          stock_factor: params[10],
          set_price: params[11],
          net: params[12],
          line_vat: params[13],
          cost_in: params[14],
          lot_no: params[15],
          expired_date: params[16],
          line_warehouse_code: params[17],
        });
        state.pendingLines.set(params[0], list);
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.approved_receipt_headers")) {
        state.approvedHeaders.set(params[0], {
          doc_no: params[0],
          branch_code: params[1],
          doc_type: params[2],
          doc_date: params[3],
          doc_time: params[4],
          supplier_code: params[5],
          supplier_name: params[6],
          ref_ext: params[7],
          ref_ext_date: params[8],
          warehouse_code: params[9],
          total: params[10],
          vat: params[11],
          grand: params[12],
          usr_code: params[13],
          created_by: params[14],
          created_at_ada: params[15],
          sta_doc: params[16],
          sta_prc_doc: params[17],
          synced_at: params[20],
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("delete from ada.approved_receipt_lines where doc_no = $1")) {
        state.approvedLines.delete(params[0]);
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into ada.approved_receipt_lines")) {
        const list = state.approvedLines.get(params[0]) || [];
        list.push({
          doc_no: params[0],
          seq_no: params[1],
          product_code: params[2],
          product_name: params[3],
          barcode: params[4],
          unit_code: params[5],
          unit_name: params[6],
          factor: params[7],
          qty: params[8],
          qty_base: params[9],
          stock_factor: params[10],
          set_price: params[11],
          net: params[12],
          line_vat: params[13],
          cost_in: params[14],
          lot_no: params[15],
          expired_date: params[16],
          line_warehouse_code: params[17],
        });
        state.approvedLines.set(params[0], list);
        return { rowCount: 1, rows: [] };
      }

      if (normalized.includes("from ada.pending_receipt_headers h")) {
        const branchCode = params[0];
        const rows = [];
        for (const header of state.pendingHeaders.values()) {
          if (branchCode && header.branch_code !== branchCode) continue;
          const lines = state.pendingLines.get(header.doc_no) || [];
          if (!lines.length) {
            rows.push({ ...header, seq_no: null });
            continue;
          }
          for (const line of lines) {
            rows.push({ ...header, ...line });
          }
        }
        return { rowCount: rows.length, rows };
      }

      if (normalized.includes("from ada.approved_receipt_headers h")) {
        const branchCode = params[0];
        const date = params[1];
        const rows = [];
        for (const header of state.approvedHeaders.values()) {
          if (header.branch_code !== branchCode) continue;
          if (date && String(header.doc_date) !== String(date)) continue;
          const lines = state.approvedLines.get(header.doc_no) || [];
          if (!lines.length) {
            rows.push({ ...header, seq_no: null });
            continue;
          }
          for (const line of lines) {
            rows.push({ ...header, ...line });
          }
        }
        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp() {
  const db = createReceiptMockDb();
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

test("receipt sync and admin routes work on the shared backend contract", async () => {
  const { app, db } = createTestApp();

  const pendingResponse = await request(app)
    .post("/api/sync/ada/pending-receipts")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSyncedAt: "2026-05-22T01:00:00.000Z",
      headers: [
        {
          FTBchCode: "005",
          FTXihDocNo: "PR-001",
          FTXihDocType: "5",
          FDXihDocDate: "2026-05-22",
          FTSplCode: "SUP-01",
          FTXihCstName: "Supplier One",
          FCXihGrand: 100,
        },
      ],
      lines: [
        {
          FTBchCode: "005",
          FTXihDocNo: "PR-001",
          FNXidSeqNo: 1,
          FTPdtCode: "630010001",
          FTPdtName: "Cetirizine",
          FCXidQty: 2,
          FCXidQtyAll: 2,
        },
      ],
    });

  assert.equal(pendingResponse.status, 200);
  assert.equal(pendingResponse.body.headersAccepted, 1);
  assert.equal(pendingResponse.body.linesAccepted, 1);
  assert.equal(db.state.pendingHeaders.size, 1);

  const approvedResponse = await request(app)
    .post("/api/sync/ada/approved-receipts")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "005",
      sourceSyncedAt: "2026-05-22T02:00:00.000Z",
      records: [
        {
          docNo: "AR-001",
          docType: "5",
          docDate: "2026-05-22",
          supplierCode: "SUP-02",
          supplierName: "Supplier Two",
          grand: 200,
          staPrcDoc: "1",
          lines: [
            {
              seqNo: 1,
              productCode: "630010002",
              productName: "Loratadine",
              qty: 3,
              qtyBase: 3,
            },
          ],
        },
      ],
    });

  assert.equal(approvedResponse.status, 200);
  assert.equal(approvedResponse.body.ok, true);
  assert.equal(approvedResponse.body.upserted, 1);
  assert.equal(db.state.approvedHeaders.size, 1);

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const pendingAdmin = await agent.get("/api/admin/pending-receipts?branchCode=005");
  assert.equal(pendingAdmin.status, 200);
  assert.equal(pendingAdmin.body.records.length, 1);
  assert.equal(pendingAdmin.body.records[0].docNo, "PR-001");
  assert.equal(pendingAdmin.body.records[0].lines[0].productCode, "630010001");

  const approvedAdmin = await agent.get("/api/admin/approved-receipts?branchCode=005&date=2026-05-22");
  assert.equal(approvedAdmin.status, 200);
  assert.equal(approvedAdmin.body.ok, true);
  assert.equal(approvedAdmin.body.records.length, 1);
  assert.equal(approvedAdmin.body.records[0].docNo, "AR-001");
  assert.equal(approvedAdmin.body.records[0].staPrcDoc, "1");
  assert.equal(approvedAdmin.body.records[0].lines[0].productCode, "630010002");

  assert.deepEqual(db.state.txLog, ["begin", "commit", "begin", "commit"]);
});
