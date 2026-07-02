"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");

function buildConfig(overrides = {}) {
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
    ...overrides,
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createAdaMockDb() {
  const state = {
    branches: new Map(),
    knownBranches: new Set(["001", "005"]),
    products: new Map(),
    productBarcodes: new Map(),
    productPriceDefaults: new Map(),
    productBranchPriceOverrides: new Map(),
    productEffectiveBranchPrices: new Map(),
    salesHeaders: new Map(),
    salesLines: new Map(),
    transferHeaders: new Map(),
    transferLines: new Map(),
    syncRuns: [],
    syncErrors: [],
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

      if (normalized === "select * from ada.refresh_foundations()") {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into public.audit_logs")) {
        return {
          rowCount: 1,
          rows: [{ audit_id: 1, event_time: new Date().toISOString() }],
        };
      }

      if (normalized.startsWith("insert into ada.branches")) {
        state.branches.set(params[0], {
          branch_code: params[0],
          branch_name: params[1],
          branch_name_th: params[2],
          branch_status: params[3],
          source_system: params[4],
          source_table: params[5],
          source_synced_at: params[6],
          raw_payload: JSON.parse(params[7]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.products")) {
        state.products.set(params[0], {
          product_code: params[0],
          product_name: params[1],
          product_name_th: params[2],
          supplier_code: params[3],
          category_code: params[4],
          category_name: params[5],
          unit_small: params[6],
          factor_small: params[7],
          unit_medium: params[8],
          factor_medium: params[9],
          unit_large: params[10],
          factor_large: params[11],
          stock_current: params[12],
          stock_retail: params[13],
          stock_warehouse: params[14],
          min_stock: params[15],
          max_stock: params[16],
          lead_time_days: params[17],
          is_active: params[18],
          source_system: params[19],
          source_table: params[20],
          source_synced_at: params[21],
          raw_payload: JSON.parse(params[22]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.product_barcodes")) {
        state.productBarcodes.set(`${params[0]}|${params[1]}`, {
          product_code: params[0],
          barcode: params[1],
          barcode_role: params[2],
          source_system: params[3],
          source_table: params[4],
          source_synced_at: params[5],
          raw_payload: JSON.parse(params[6]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("with payload as (") && normalized.includes("insert into ada.product_price_defaults")) {
        const snapshotId = params[1] || null;
        const sourceSystem = params[2];
        const records = JSON.parse(params[0]);
        const rows = [];
        for (const record of records) {
          const key = `${record.product_code}|${record.channel}|${record.unit_size}|${record.price_level}`;
          state.productPriceDefaults.set(key, {
            ...record,
            snapshot_id: snapshotId,
            source_system: sourceSystem,
          });
          rows.push({ product_code: record.product_code });
        }
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("delete from ada.product_price_defaults")) {
        const snapshotId = params[0];
        const rows = [];
        for (const [key, record] of [...state.productPriceDefaults.entries()]) {
          if ((record.snapshot_id || "") !== snapshotId) {
            state.productPriceDefaults.delete(key);
            rows.push({ product_code: record.product_code });
          }
        }
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.startsWith("with payload as (") &&
        normalized.includes("insert into ada.product_branch_price_overrides")
      ) {
        const snapshotId = params[1] || null;
        const sourceSystem = params[2];
        const records = JSON.parse(params[0]);
        const rows = [];
        for (const record of records) {
          const key =
            `${record.branch_code}|${record.product_code}|${record.channel}|${record.unit_size}|${record.price_level}`;
          state.productBranchPriceOverrides.set(key, {
            ...record,
            snapshot_id: snapshotId,
            source_system: sourceSystem,
          });
          rows.push({ product_code: record.product_code });
        }
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("delete from ada.product_branch_price_overrides")) {
        const branchCode = params[0];
        const snapshotId = params[1];
        const rows = [];
        for (const [key, record] of [...state.productBranchPriceOverrides.entries()]) {
          if (record.branch_code === branchCode && (record.snapshot_id || "") !== snapshotId) {
            state.productBranchPriceOverrides.delete(key);
            rows.push({ product_code: record.product_code });
          }
        }
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("select distinct branch_code from (")) {
        const branchCodes = new Set(state.knownBranches);
        for (const branchCode of state.branches.keys()) {
          branchCodes.add(branchCode);
        }
        for (const record of state.productBranchPriceOverrides.values()) {
          branchCodes.add(record.branch_code);
        }
        return {
          rowCount: branchCodes.size,
          rows: [...branchCodes].sort().map((branch_code) => ({ branch_code })),
        };
      }

      if (normalized.startsWith("delete from ada.product_effective_branch_prices")) {
        const branchCode = params[0];
        const productCodes = new Set(params[1] || []);
        for (const key of [...state.productEffectiveBranchPrices.keys()]) {
          const record = state.productEffectiveBranchPrices.get(key);
          if (record.branch_code === branchCode && productCodes.has(record.product_code)) {
            state.productEffectiveBranchPrices.delete(key);
          }
        }
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("with price_keys as (") && normalized.includes("insert into ada.product_effective_branch_prices")) {
        const branchCode = params[0];
        const productCodes = new Set(params[1] || []);
        for (const productCode of productCodes) {
          const keys = new Set();
          for (const record of state.productPriceDefaults.values()) {
            if (record.product_code === productCode) {
              keys.add(`${record.product_code}|${record.channel}|${record.unit_size}|${record.price_level}`);
            }
          }
          for (const record of state.productBranchPriceOverrides.values()) {
            if (record.branch_code === branchCode && record.product_code === productCode) {
              keys.add(`${record.product_code}|${record.channel}|${record.unit_size}|${record.price_level}`);
            }
          }

          for (const compositeKey of keys) {
            const [resolvedProductCode, channel, unitSize, priceLevel] = compositeKey.split("|");
            const defaultRow = state.productPriceDefaults.get(compositeKey) || null;
            const overrideKey = `${branchCode}|${compositeKey}`;
            const overrideRow = state.productBranchPriceOverrides.get(overrideKey) || null;
            const priceAmount = overrideRow?.price_amount ?? defaultRow?.price_amount ?? null;
            if (priceAmount == null) {
              continue;
            }
            state.productEffectiveBranchPrices.set(overrideKey, {
              branch_code: branchCode,
              product_code: resolvedProductCode,
              channel,
              unit_size: unitSize,
              price_level: Number(priceLevel),
              price_amount: priceAmount,
              price_source: overrideRow ? "override" : "master",
              unit_name: overrideRow?.unit_name ?? defaultRow?.unit_name ?? null,
              factor: overrideRow?.factor ?? defaultRow?.factor ?? null,
              allow_branch_override: overrideRow?.allow_branch_override ?? defaultRow?.allow_branch_override ?? false,
            });
          }
        }
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith("insert into ada.transfer_headers")) {
        state.transferHeaders.set(`${params[0]}|${params[1]}|${params[4]}`, {
          doc_no: params[0],
          doc_type: params[1],
          branch_code: params[4],
          branch_code_to: params[5],
          warehouse_code: params[6],
          warehouse_code_to: params[7],
          doc_date: params[8],
          created_by: params[12],
          approved_by: params[13],
          source_synced_at: params[19],
          raw_payload: JSON.parse(params[20]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.sales_headers")) {
        state.salesHeaders.set(`${params[0]}|${params[1]}`, {
          branch_code: params[0],
          doc_no: params[1],
          doc_date: params[2],
          doc_time: params[3],
          customer_code: params[4],
          paid_status: params[5],
          grand_amount: params[6],
          net_amount: params[7],
          vat_amount: params[8],
          cashier_code: params[9],
          terminal_code: params[10],
          reference_doc_no: params[11],
          source_synced_at: params[14],
          raw_payload: JSON.parse(params[15]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.sales_lines")) {
        state.salesLines.set(`${params[0]}|${params[1]}|${params[2]}|${params[3]}`, {
          branch_code: params[0],
          doc_no: params[1],
          line_no: params[2],
          product_code: params[3],
          barcode: params[4],
          qty: params[5],
          qty_base: params[10],
          stock_factor: params[9],
          net_amount: params[8],
          source_synced_at: params[15],
          raw_payload: JSON.parse(params[16]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.transfer_lines")) {
        state.transferLines.set(`${params[0]}|${params[1]}|${params[2]}|${params[3]}|${params[4]}`, {
          doc_no: params[0],
          doc_type: params[1],
          branch_code: params[2],
          line_no: params[3],
          product_code: params[4],
          unit_code: params[6],
          unit_name: params[7],
          qty: params[8],
          qty_base: params[9],
          stock_factor: params[10],
          warehouse_code: params[13],
          source_synced_at: params[18],
          raw_payload: JSON.parse(params[19]),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("insert into ada.sync_runs")) {
        const syncRunId = state.syncRuns.length + 1;
        const row = {
          sync_run_id: syncRunId,
          source_system: params[0],
          source_location: params[1],
          agent_name: params[2],
          agent_version: params[3],
          sync_type: params[4],
          started_at: params[5],
          finished_at: params[6],
          status: params[7],
          records_read: params[8],
          records_sent: params[9],
          watermark_from: params[10],
          watermark_to: params[11],
          message: params[12],
          meta: JSON.parse(params[13]),
        };
        state.syncRuns.push(row);
        return { rowCount: 1, rows: [{ sync_run_id: syncRunId }] };
      }

      if (normalized.startsWith("insert into ada.sync_errors")) {
        state.syncErrors.push({
          sync_run_id: params[0],
          source_system: params[1],
          source_table: params[2],
          error_code: params[3],
          error_message: params[4],
          error_details: JSON.parse(params[5]),
        });
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unhandled mock query: ${normalized}`);
    },
    async end() {},
  };

  return db;
}

function createTestApp(configOverrides = {}) {
  const db = createAdaMockDb();
  const crmMirrorClient = {
    enabled: true,
    sales: [],
    refunds: [],
    async mirrorSales(records) {
      this.sales.push(...records);
      return { ok: true };
    },
    async mirrorRefunds(records) {
      this.refunds.push(...records);
      return { ok: true };
    },
  };
  const { app } = createApp({
    config: buildConfig(configOverrides),
    db,
    crmMirrorClient,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db, crmMirrorClient };
}

test("ADA sync routes enforce API key and allow valid requests", async () => {
  const { app } = createTestApp();
  const payload = {
    records: [{ branchCode: "000", branchName: "Head Office" }],
  };

  const missingKey = await request(app).post("/api/sync/ada/branches").send(payload);
  assert.equal(missingKey.status, 401);
  assert.equal(missingKey.body.message, "Invalid API key.");

  const wrongKey = await request(app)
    .post("/api/sync/ada/branches")
    .set("x-api-key", "wrong-key")
    .send(payload);
  assert.equal(wrongKey.status, 401);
  assert.equal(wrongKey.body.message, "Invalid API key.");

  const accepted = await request(app)
    .post("/api/sync/ada/branches")
    .set("x-api-key", "test-pos-key")
    .send(payload);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.accepted, 1);
});

test("ADA branches route rejects malformed payloads and upserts the latest branch row", async () => {
  const { app, db } = createTestApp();

  const malformed = await request(app)
    .post("/api/sync/ada/branches")
    .set("x-api-key", "test-pos-key")
    .send({ branchCode: "000" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.message, "Payload must include a records array.");

  const firstSync = await request(app)
    .post("/api/sync/ada/branches")
    .set("x-api-key", "test-pos-key")
    .send({
      syncRunId: 42,
      sourceSyncedAt: "2026-05-21T01:00:00.000Z",
      records: [
        {
          FTBchCode: "000",
          FTBchName: "SC Main",
          FTBchNameTH: "สำนักงานใหญ่",
          FTBchStaActive: "1",
        },
      ],
    });
  assert.equal(firstSync.status, 200);
  assert.equal(firstSync.body.syncRunId, 42);
  assert.equal(db.state.branches.size, 1);
  assert.equal(db.state.branches.get("000").branch_name, "SC Main");

  const secondSync = await request(app)
    .post("/api/sync/ada/branches")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSystem: "AdaAccMirror",
      sourceSyncedAt: "2026-05-21T02:00:00.000Z",
      records: [
        {
          branchCode: "000",
          branchName: "SC Main Updated",
          status: "0",
        },
      ],
    });
  assert.equal(secondSync.status, 200);
  assert.equal(db.state.branches.size, 1);
  assert.equal(db.state.branches.get("000").branch_name, "SC Main Updated");
  assert.equal(db.state.branches.get("000").branch_status, "0");
  assert.equal(db.state.branches.get("000").source_system, "AdaAccMirror");
  assert.deepEqual(db.state.txLog, ["begin", "commit", "begin", "commit"]);
});

test("ADA products route upserts product fields and barcode rows from a valid payload", async () => {
  const { app, db } = createTestApp();

  const firstSync = await request(app)
    .post("/api/sync/ada/products")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSyncedAt: "2026-05-21T03:00:00.000Z",
      records: [
        {
          FTPdtCode: "630010001",
          FTPdtName: "Cetirizine 10 mg",
          FTSplCode: "SUP-01",
          FTPdtGrpCode: "MED",
          FTPdtGrpName: "Medicine",
          FTPdtSUnit: "BOX",
          FCPdtMin: 2,
          FCPdtMax: 15,
          FCPdtLeadTime: 5,
          FCPdtQtyNow: 10,
          FTPdtStaActive: "1",
          FTPdtBarCode1: "885000000001",
          FTPdtBarCode2: "885000000002",
        },
      ],
    });
  assert.equal(firstSync.status, 200);
  assert.equal(firstSync.body.accepted, 1);
  assert.equal(db.state.products.size, 1);
  assert.equal(db.state.productBarcodes.size, 2);
  assert.equal(db.state.products.get("630010001").product_name, "Cetirizine 10 mg");

  const secondSync = await request(app)
    .post("/api/sync/ada/products")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSyncedAt: "2026-05-21T04:00:00.000Z",
      records: [
        {
          productCode: "630010001",
          productName: "Cetirizine 10 mg Updated",
          supplierCode: "SUP-02",
          categoryName: "OTC",
          unitSmall: "TAB",
          minStock: 3,
          maxStock: 18,
          leadTimeDays: 7,
          stockCurrent: 12,
          isActive: "1",
          barcode1: "885000000001",
          barcode2: "885000000002",
        },
      ],
    });
  assert.equal(secondSync.status, 200);
  assert.equal(db.state.products.size, 1);
  assert.equal(db.state.productBarcodes.size, 2);
  assert.equal(db.state.products.get("630010001").product_name, "Cetirizine 10 mg Updated");
  assert.equal(db.state.products.get("630010001").supplier_code, "SUP-02");
  assert.equal(
    db.state.productBarcodes.get("630010001|885000000001").source_synced_at,
    "2026-05-21T04:00:00.000Z",
  );
});

test("ADA transfers route validates payload shape and accepts headers plus lines", async () => {
  const { app, db } = createTestApp();

  const malformed = await request(app)
    .post("/api/sync/ada/transfers")
    .set("x-api-key", "test-pos-key")
    .send({ records: [] });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.message, "Payload must include headers and lines arrays.");

  const accepted = await request(app)
    .post("/api/sync/ada/transfers")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSyncedAt: "2026-05-21T05:00:00.000Z",
      headers: [
        {
          FTPthDocNo: "TRF-001",
          FTPthDocType: "4",
          FTBchCode: "000",
          FTBchCodeTo: "101",
          FDPthDocDate: "2026-05-20T00:00:00.000Z",
          FTPthStaDoc: "1",
        },
      ],
      lines: [
        {
          FTPthDocNo: "TRF-001",
          FTPthDocType: "4",
          FTBchCode: "000",
          FNPtdSeqNo: 1,
          FTPtdPdtCode: "630010001",
          FCPtdQtyAll: 4,
        },
      ],
    });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.acceptedHeaders, 1);
  assert.equal(accepted.body.acceptedLines, 1);
  assert.equal(db.state.transferHeaders.size, 1);
  assert.equal(db.state.transferLines.size, 1);
});

test("ADA transfers route accepts the real mother-PC camelCase payload shape", async () => {
  const { app, db } = createTestApp();

  const accepted = await request(app)
    .post("/api/sync/ada/transfers")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSystem: "AdaAcc",
      sourceSyncedAt: "2026-05-21T05:10:00.000Z",
      headers: [
        {
          docNo: "TRF-002",
          docType: "7",
          docDate: "2026-05-21",
          tnfDate: "2026-05-21",
          branchFrm: "001",
          branchTo: "000",
          whFrm: "WH-A",
          whTo: "WH-B",
          type: "transfer",
          total: 10,
          vat: 0.7,
          grand: 10.7,
          deptCode: "D001",
          usrCode: "dao1",
        },
      ],
      lines: [
        {
          docNo: "TRF-002",
          seqNo: 1,
          productCode: "630010001",
          unitCode: "BOX",
          unitName: "Box",
          factor: 1,
          qty: 2,
          qtyBase: 2,
          branchFrm: "001",
          branchTo: "000",
          whFrm: "WH-A",
          whTo: "WH-B",
          docDate: "2026-05-21",
        },
      ],
    });

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.acceptedHeaders, 1);
  assert.equal(accepted.body.acceptedLines, 1);
  assert.equal(db.state.transferHeaders.get("TRF-002|7|001").branch_code, "001");
  assert.equal(db.state.transferHeaders.get("TRF-002|7|001").branch_code_to, "000");
  assert.equal(db.state.transferHeaders.get("TRF-002|7|001").warehouse_code, "WH-A");
  assert.equal(db.state.transferHeaders.get("TRF-002|7|001").warehouse_code_to, "WH-B");
  assert.equal(db.state.transferHeaders.get("TRF-002|7|001").created_by, "dao1");
  assert.equal(db.state.transferLines.get("TRF-002|7|001|1|630010001").branch_code, "001");
  assert.equal(db.state.transferLines.get("TRF-002|7|001|1|630010001").unit_code, "BOX");
  assert.equal(db.state.transferLines.get("TRF-002|7|001|1|630010001").qty_base, 2);
  assert.equal(db.state.transferLines.get("TRF-002|7|001|1|630010001").stock_factor, 1);
  assert.equal(db.state.transferLines.get("TRF-002|7|001|1|630010001").warehouse_code, "WH-A");
});

test("ADA sales route mirrors committed sale and refund documents to the CRM backend", async () => {
  const { app, crmMirrorClient } = createTestApp();

  const response = await request(app)
    .post("/api/sync/ada/sales")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSystem: "AdaAcc",
      sourceSyncedAt: "2026-06-02T13:30:00.000Z",
      headers: [
        {
          FTBchCode: "005",
          FTShdDocNo: "S2606005002-0001688",
          FTShdDocType: "1",
          FDShdDocDate: "2026-06-02",
          FTShdDocTime: "13:24:32",
          FTUsrCode: "dao1",
          FTPosCode: "002",
          FCShdTotal: 775,
          FCShdGrand: 775,
          FCShdPaid: 775,
          FTCstCode: "0",
        },
        {
          FTBchCode: "005",
          FTShdDocNo: "R2606005002-0000009",
          FTShdDocType: "9",
          FDShdDocDate: "2026-06-02",
          FTShdDocTime: "13:40:00",
          FTUsrCode: "dao1",
          FTPosCode: "002",
          FCShdGrand: 550,
          FTShdPosCN: "S2606005002-0001588",
          FTCstCode: "0",
        },
      ],
      lines: [
        {
          FTBchCode: "005",
          FTShdDocNo: "S2606005002-0001688",
          FNSdtSeqNo: 1,
          FTPdtCode: "IC-001572",
          FCSdtQty: 1,
          FCSdtNet: 775,
        },
        {
          FTBchCode: "005",
          FTShdDocNo: "R2606005002-0000009",
          FNSdtSeqNo: 1,
          FTPdtCode: "IC-001572",
          FCSdtQty: 1,
          FCSdtNet: 550,
        },
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(crmMirrorClient.sales.length, 1);
  assert.equal(crmMirrorClient.refunds.length, 1);
  assert.equal(crmMirrorClient.sales[0].doc_no, "S2606005002-0001688");
  assert.equal(crmMirrorClient.refunds[0].refund_doc_no, "R2606005002-0000009");
  assert.equal(crmMirrorClient.refunds[0].original_doc_no, "S2606005002-0001588");
});

test("ADA sales route still commits and returns success when the CRM mirror fails", async () => {
  const { app, db, crmMirrorClient } = createTestApp();
  crmMirrorClient.mirrorSales = async () => {
    const error = new Error("CRM mirror request failed: 413");
    error.status = 413;
    throw error;
  };

  const response = await request(app)
    .post("/api/sync/ada/sales")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSystem: "AdaAcc",
      sourceSyncedAt: "2026-06-02T13:30:00.000Z",
      headers: [
        {
          FTBchCode: "005",
          FTShdDocNo: "S2606005002-0002000",
          FTShdDocType: "1",
          FDShdDocDate: "2026-06-02",
          FTShdDocTime: "13:24:32",
          FTUsrCode: "dao1",
          FTPosCode: "002",
          FCShdGrand: 100,
          FTCstCode: "0",
        },
      ],
      lines: [
        {
          FTBchCode: "005",
          FTShdDocNo: "S2606005002-0002000",
          FNSdtSeqNo: 1,
          FTPdtCode: "IC-001572",
          FCSdtQty: 1,
          FCSdtNet: 100,
        },
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.acceptedHeaders, 1);
  assert.equal(response.body.acceptedLines, 1);
  // The primary write must be committed, not rolled back, despite the mirror throwing.
  assert.ok(db.state.salesHeaders.has("005|S2606005002-0002000"));
  assert.deepEqual(db.state.txLog.slice(-2), ["begin", "commit"]);
});

test("ADA run-log route records sync runs and writes sync_errors for failed runs", async () => {
  const { app, db } = createTestApp();

  const success = await request(app)
    .post("/api/sync/ada/run-log")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSystem: "AdaAcc",
      sourceLocation: "mother-pc",
      agentName: "adapos-sync",
      agentVersion: "1.2.3",
      syncType: "scheduled-sync",
      status: "success",
      recordsRead: 12,
      recordsSent: 12,
      message: "Sync completed.",
      meta: { durationMs: 2500 },
    });
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, { accepted: 1, id: "1" });
  assert.equal(db.state.syncRuns.length, 1);
  assert.equal(db.state.syncErrors.length, 0);

  const failed = await request(app)
    .post("/api/sync/ada/run-log")
    .set("x-api-key", "test-pos-key")
    .send({
      sourceSystem: "AdaAcc",
      sourceTable: "TPSTSalHD",
      syncType: "scheduled-sync",
      status: "failed",
      recordsRead: 5,
      recordsSent: 3,
      message: "Sales sync failed.",
      errorCode: "SQL_TIMEOUT",
      errorDetails: { retryable: true },
    });
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.body, { accepted: 1, id: "2" });
  assert.equal(db.state.syncRuns.length, 2);
  assert.equal(db.state.syncErrors.length, 1);
  assert.equal(db.state.syncErrors[0].sync_run_id, 2);
  assert.equal(db.state.syncErrors[0].error_code, "SQL_TIMEOUT");
  assert.deepEqual(db.state.syncErrors[0].error_details, { retryable: true });
});

test("ADA price defaults route upserts snapshot rows and refreshes effective prices for known branches", async () => {
  const { app, db } = createTestApp();

  const response = await request(app)
    .post("/api/sync/ada/prices/defaults")
    .set("x-api-key", "test-pos-key")
    .send({
      snapshotId: "defaults-2026-06-23T12:00",
      isFinal: true,
      records: [
        {
          productCode: "IC-005089",
          channel: "retail",
          unitSize: "S",
          priceLevel: 1,
          priceAmount: 25,
          unitName: "แผง",
          factor: 1,
          allowBranchOverride: true,
          sourceUpdatedAt: "2026-06-23T10:00:00",
          syncedAt: "2026-06-23T12:00:00.000Z",
        },
        {
          productCode: "IC-005089",
          channel: "retail",
          unitSize: "M",
          priceLevel: 1,
          priceAmount: 300,
          unitName: "โหล",
          factor: 12,
          allowBranchOverride: true,
          syncedAt: "2026-06-23T12:00:00.000Z",
        },
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.accepted, 2);
  assert.equal(db.state.productPriceDefaults.size, 2);
  assert.equal(db.state.productEffectiveBranchPrices.get("001|IC-005089|retail|S|1").price_amount, 25);
  assert.equal(db.state.productEffectiveBranchPrices.get("005|IC-005089|retail|M|1").price_amount, 300);
});

test("ADA branch price overrides route refreshes override price and falls back to master after final purge", async () => {
  const { app, db } = createTestApp();

  await request(app)
    .post("/api/sync/ada/prices/defaults")
    .set("x-api-key", "test-pos-key")
    .send({
      snapshotId: "defaults-2026-06-23T13:00",
      isFinal: true,
      records: [
        {
          productCode: "IC-005089",
          channel: "retail",
          unitSize: "S",
          priceLevel: 1,
          priceAmount: 25,
          unitName: "แผง",
          factor: 1,
          allowBranchOverride: true,
          syncedAt: "2026-06-23T13:00:00.000Z",
        },
      ],
    });

  const overrideResponse = await request(app)
    .post("/api/sync/ada/prices/branch-overrides")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "005",
      snapshotId: "override-005-2026-06-23T13:05",
      isFinal: true,
      records: [
        {
          productCode: "IC-005089",
          channel: "retail",
          unitSize: "S",
          priceLevel: 1,
          priceAmount: 20,
          unitName: "แผง",
          factor: 1,
          sourceUpdatedAt: "2026-04-22T20:36:49",
          syncedAt: "2026-06-23T13:05:00.000Z",
        },
      ],
    });

  assert.equal(overrideResponse.status, 200);
  assert.equal(db.state.productEffectiveBranchPrices.get("005|IC-005089|retail|S|1").price_amount, 20);
  assert.equal(db.state.productEffectiveBranchPrices.get("005|IC-005089|retail|S|1").price_source, "override");

  const purgeResponse = await request(app)
    .post("/api/sync/ada/prices/branch-overrides")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "005",
      snapshotId: "override-005-2026-06-23T13:10",
      isFinal: true,
      records: [],
    });

  assert.equal(purgeResponse.status, 200);
  assert.equal(db.state.productBranchPriceOverrides.size, 0);
  assert.equal(db.state.productEffectiveBranchPrices.get("005|IC-005089|retail|S|1").price_amount, 25);
  assert.equal(db.state.productEffectiveBranchPrices.get("005|IC-005089|retail|S|1").price_source, "master");
});
