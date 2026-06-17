"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const XLSX = require("xlsx");

const { createApp } = require("../apps/admin-api/src/server");

function binaryParser(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

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

const DISPLAY_BRANCH_CODES = ["000", "001", "003", "004", "005"];

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function buildInventoryBranchStats(row, branchCodes = DISPLAY_BRANCH_CODES) {
  const branches = {};
  let qtyTotal = 0;
  let totalInventoryValue = 0;
  let hasAnyStock = false;
  let hasMissingCost = false;

  for (const branchCode of branchCodes) {
    const qty = Number(row[`qty_branch_${branchCode}`] || 0);
    const rawCost = row[`cost_avg_branch_${branchCode}`];
    const unitCostAvg = rawCost == null ? null : Number(rawCost);
    const inventoryValue = Number((qty * Number(rawCost || 0)).toFixed(2));

    branches[branchCode] = {
      qty,
      unitCostAvg,
      inventoryValue,
    };

    qtyTotal += qty;
    totalInventoryValue += inventoryValue;
    if (qty > 0) {
      hasAnyStock = true;
      if (unitCostAvg == null) {
        hasMissingCost = true;
      }
    }
  }

  return {
    branches,
    qtyTotal,
    totalInventoryValue: Number(totalInventoryValue.toFixed(2)),
    hasAnyStock,
    hasMissingCost,
  };
}

function createBranchStockMockDb() {
  const state = {
    snapshots: new Map(),
    products: new Map(),
    skuCategories: new Map(),
    categoryStates: new Map(),
    productBarcodes: new Map(),
    uploads: new Map(),
    txLog: [],
    auditActions: [],
  };

  function buildSnapshotViewRow(row) {
    const product = state.products.get(row.product_code) || null;
    const stateRow = state.categoryStates.get(row.product_code) || null;
    const skuCategory = state.skuCategories.get(row.product_code) || null;
    return {
      ...row,
      product_name_thai: row.product_name_thai || product?.product_name_th || null,
      product_name_eng: row.product_name_eng || product?.product_name || null,
      barcode: row.barcode || state.productBarcodes.get(row.product_code) || null,
      unit: row.unit || product?.unit_small || product?.unit_medium || product?.unit_large || null,
      category_name: stateRow?.category_name || skuCategory || product?.category_name || null,
      category_status: stateRow?.review_status || "needs_review",
      category_rationale: stateRow?.rationale || null,
    };
  }

  function matchesBranchStockSearch(row, search) {
    if (!search) return true;
    return [
      row.product_code,
      row.product_name_thai,
      row.product_name_eng,
      row.barcode,
      row.category_name,
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(search));
  }

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
        state.auditActions.push(params[2]);
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
          cost_avg_branch_000: params[12],
          cost_avg_branch_001: params[13],
          cost_avg_branch_002: params[14],
          cost_avg_branch_003: params[15],
          cost_avg_branch_004: params[16],
          cost_avg_branch_005: params[17],
          synced_at: params[18],
          raw_payload: JSON.parse(params[19]),
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

      if (
        normalized.startsWith("select count(*)::int as product_count,") &&
        normalized.includes("from ada.branch_stock_snapshots bs")
      ) {
        const rows = [...state.snapshots.values()];
        const isAllBranchesSummary = DISPLAY_BRANCH_CODES.every((branchCode) =>
          normalized.includes(`products_with_stock_${branchCode}`),
        );

        if (isAllBranchesSummary) {
          const aggregate = rows.map((row) => ({
            row,
            stats: buildInventoryBranchStats(row),
          }));
          const summaryRow = {
            product_count: rows.length,
            products_with_stock: aggregate.filter(({ stats }) => stats.hasAnyStock).length,
            products_with_cost: aggregate.filter(({ stats }) => stats.hasAnyStock && !stats.hasMissingCost).length,
            total_inventory_value: aggregate.reduce((sum, { stats }) => sum + stats.totalInventoryValue, 0).toFixed(2),
          };

          for (const branchCode of DISPLAY_BRANCH_CODES) {
            const branchRows = aggregate.filter(({ stats }) => stats.branches[branchCode].qty > 0);
            summaryRow[`products_with_stock_${branchCode}`] = branchRows.length;
            summaryRow[`products_with_cost_${branchCode}`] = branchRows.filter(
              ({ stats }) => stats.branches[branchCode].unitCostAvg != null,
            ).length;
            summaryRow[`total_inventory_value_${branchCode}`] = branchRows
              .reduce((sum, { stats }) => sum + stats.branches[branchCode].inventoryValue, 0)
              .toFixed(2);
          }

          return {
            rowCount: 1,
            rows: [summaryRow],
          };
        }

        const branchCodeMatch = normalized.match(/qty_branch_(\d{3})/);
        const branchCode = branchCodeMatch?.[1] || "005";
        const qtyKey = `qty_branch_${branchCode}`;
        const costKey = `cost_avg_branch_${branchCode}`;
        const productsWithStock = rows.filter((row) => Number(row[qtyKey] || 0) > 0);
        const productsWithCost = productsWithStock.filter((row) => row[costKey] != null);
        const totalInventoryValue = productsWithStock.reduce(
          (sum, row) => sum + (Number(row[qtyKey] || 0) * Number(row[costKey] || 0)),
          0,
        );
        return {
          rowCount: 1,
          rows: [{
            product_count: rows.length,
            products_with_stock: productsWithStock.length,
            products_with_cost: productsWithCost.length,
            total_inventory_value: totalInventoryValue.toFixed(2),
          }],
        };
      }

      if (normalized.startsWith("select count(*)::int as total from ada.branch_stock_snapshots bs")) {
        const search = String(params[0] || "").toLowerCase();
        const isAllBranchesCount = DISPLAY_BRANCH_CODES.every((branchCode) =>
          normalized.includes(`qty_branch_${branchCode}`),
        );
        const matches = [...state.snapshots.values()]
          .map(buildSnapshotViewRow)
          .filter((row) => {
            if (isAllBranchesCount) {
              return buildInventoryBranchStats(row).hasAnyStock;
            }
            const branchCodeMatch = normalized.match(/qty_branch_(\d{3})\s*>\s*0/);
            const branchCode = branchCodeMatch?.[1] || null;
            const qtyKey = branchCode ? `qty_branch_${branchCode}` : null;
            return !qtyKey || Number(row[qtyKey] || 0) > 0;
          })
          .filter((row) => matchesBranchStockSearch(row, search));
        return { rowCount: 1, rows: [{ total: matches.length }] };
      }

      if (normalized.includes("from unnest($1::text[]) as codes(product_code)")) {
        const productCodes = Array.isArray(params[0]) ? params[0] : [];
        const rows = productCodes.map((productCode) => {
          const stateRow = state.categoryStates.get(productCode) || null;
          const skuCategory = state.skuCategories.get(productCode) || null;
          const sourceProduct = state.products.get(productCode) || null;
          const effectiveCategory =
            stateRow?.category_name || skuCategory || sourceProduct?.category_name || null;
          return {
            product_code: productCode,
            effective_category_name: effectiveCategory,
            review_status: stateRow?.review_status || "needs_review",
            rationale: stateRow?.rationale || null,
            source_kind: stateRow?.source_kind || null,
            source_reference: stateRow?.source_reference || null,
            source_report_file: stateRow?.source_report_file || null,
            imported_at: stateRow?.imported_at || null,
            imported_by: stateRow?.imported_by || null,
            sku_category_name: skuCategory,
            source_category_name: sourceProduct?.category_name || null,
          };
        });
        return { rowCount: rows.length, rows };
      }

      if (normalized.startsWith("insert into ada.product_category_states")) {
        state.categoryStates.set(params[0], {
          product_code: params[0],
          category_name: params[1],
          review_status: params[2],
          rationale: params[3],
          source_kind: params[4],
          source_reference: params[5],
          source_report_file: params[6],
          source_workbook_file: params[7],
          source_workbook_sheet: params[8],
          source_workbook_row: params[9],
          source_match_level: params[10],
          source_barcode: params[11],
          previous_category_name: params[12],
          previous_review_status: params[13],
          imported_by: params[14],
          imported_at: new Date().toISOString(),
        });
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith("select bs.product_code,")) {
        const search = String(params[0] || "").toLowerCase();
        const hasPaging = Number.isFinite(Number(params[1])) && Number.isFinite(Number(params[2]));
        const limit = hasPaging ? Number(params[1]) : null;
        const offset = hasPaging ? Number(params[2]) : 0;
        const isAllBranchesDetail = normalized.includes("as unit_cost_avg_branch_000");
        const branchCodeMatch = normalized.match(/qty_branch_(\d{3})\s*>\s*0/);
        const branchCode = branchCodeMatch?.[1] || null;
        const qtyKey = branchCode ? `qty_branch_${branchCode}` : null;
        const costKey = branchCode ? `cost_avg_branch_${branchCode}` : null;
        const rows = [...state.snapshots.values()]
          .map(buildSnapshotViewRow)
          .map((row) => ({
            row,
            stats: isAllBranchesDetail ? buildInventoryBranchStats(row) : null,
          }))
          .filter(({ row, stats }) => {
            if (isAllBranchesDetail) {
              return stats.hasAnyStock;
            }
            return !qtyKey || Number(row[qtyKey] || 0) > 0;
          })
          .map(({ row, stats }) => ({
            row,
            stats,
          }))
          .filter(({ row }) => matchesBranchStockSearch(row, search))
          .sort((left, right) => {
            if (isAllBranchesDetail) {
              if (left.stats.totalInventoryValue !== right.stats.totalInventoryValue) {
                return right.stats.totalInventoryValue - left.stats.totalInventoryValue;
              }
              return left.row.product_code.localeCompare(right.row.product_code);
            }
            if (qtyKey && costKey) {
              const leftValue = Number(left.row[qtyKey] || 0) * Number(left.row[costKey] || 0);
              const rightValue = Number(right.row[qtyKey] || 0) * Number(right.row[costKey] || 0);
              if (leftValue !== rightValue) {
                return rightValue - leftValue;
              }
            }
            return left.row.product_code.localeCompare(right.row.product_code);
          })
          .map(({ row, stats }) => {
            if (isAllBranchesDetail) {
              const detailRow = {
                product_code: row.product_code,
                product_name_thai: row.product_name_thai,
                product_name_eng: row.product_name_eng,
                barcode: row.barcode,
                unit: row.unit,
                category_name: row.category_name,
                qty_total_all_branches: stats.qtyTotal,
                total_inventory_value: stats.totalInventoryValue,
                synced_at: row.synced_at,
              };
              for (const displayBranchCode of DISPLAY_BRANCH_CODES) {
                detailRow[`qty_branch_${displayBranchCode}`] = stats.branches[displayBranchCode].qty;
                detailRow[`unit_cost_avg_branch_${displayBranchCode}`] = stats.branches[displayBranchCode].unitCostAvg;
                detailRow[`inventory_value_branch_${displayBranchCode}`] = stats.branches[displayBranchCode].inventoryValue;
              }
              return detailRow;
            }

            if (!qtyKey || !costKey || !normalized.includes("as unit_cost_avg")) {
              return row;
            }

            return {
              product_code: row.product_code,
              product_name_thai: row.product_name_thai,
              product_name_eng: row.product_name_eng,
              barcode: row.barcode,
              unit: row.unit,
              category_name: row.category_name,
              qty: Number(row[qtyKey] || 0),
              unit_cost_avg: row[costKey] == null ? null : Number(row[costKey]),
              inventory_value: Number((Number(row[qtyKey] || 0) * Number(row[costKey] || 0)).toFixed(2)),
              synced_at: row.synced_at,
            };
          });
        const pagedRows = hasPaging ? rows.slice(offset, offset + limit) : rows;
        return { rowCount: pagedRows.length, rows: pagedRows };
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
  return response.body.csrf_token;
}

async function loginAsStaff(agent) {
  const response = await agent.post("/admin/auth/login").send({
    username: "staff@example.com",
    password: "staff-pass-123",
  });
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

test("branch stock sync and listing routes work on the shared backend", async () => {
  const { app, db } = createTestApp();

  const syncResponse = await request(app)
    .post("/api/branch-stock/sync")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "001",
      records: [
        {
          product_code: "630010001",
          product_name_thai: "เซทิริซีน",
          product_name_eng: "Cetirizine",
          barcode: "885000000001",
          unit: "BOX",
          qty: 5,
          costAvg: 12.5,
          synced_at: "2026-05-25T08:00:00.000Z",
        },
      ],
    });

  assert.equal(syncResponse.status, 200);
  assert.equal(syncResponse.body.accepted, 1);
  assert.equal(syncResponse.body.insertedOrUpdated, 1);
  assert.equal(syncResponse.body.branchCode, "001");
  assert.equal(db.state.snapshots.size, 1);
  assert.equal(db.state.snapshots.get("630010001").qty_branch_001, 5);
  assert.equal(db.state.snapshots.get("630010001").cost_avg_branch_001, 12.5);

  const legacySyncResponse = await request(app)
    .post("/api/sync/ada/branch-stock")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "001",
      records: [
        {
          product_code: "630010002",
          product_name_thai: "ลอราทาดีน",
          product_name_eng: "Loratadine",
          barcode: "885000000002",
          unit: "BOX",
          qty_branch_001: 2,
          synced_at: "2026-05-25T08:05:00.000Z",
        },
      ],
    });

  assert.equal(legacySyncResponse.status, 200);
  assert.equal(legacySyncResponse.body.accepted, 1);
  assert.equal(legacySyncResponse.body.branchCode, "001");
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

test("branch stock sync merges a single branch payload without wiping other branches", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630010777", {
    product_code: "630010777",
    product_name_thai: "ตัวอย่าง",
    product_name_eng: "Example",
    barcode: "885000007777",
    unit: "BOX",
    qty_branch_000: 0,
    qty_branch_001: 1,
    qty_branch_002: 0,
    qty_branch_003: 7,
    qty_branch_004: 8,
    qty_branch_005: 9,
    qty_total_all_branches: 25,
    cost_avg_branch_001: 10,
    cost_avg_branch_003: 30,
    cost_avg_branch_004: 40,
    cost_avg_branch_005: 50,
    synced_at: "2026-05-25T08:00:00.000Z",
    raw_payload: {},
  });

  const response = await request(app)
    .post("/api/branch-stock/sync")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "001",
      records: [
        {
          productCode: "630010777",
          qty: 4,
          costAvg: 14.25,
          syncedAt: "2026-05-26T01:00:00.000Z",
        },
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.accepted, 1);
  assert.equal(response.body.insertedOrUpdated, 1);
  assert.equal(response.body.branchCode, "001");

  const snapshot = db.state.snapshots.get("630010777");
  assert.equal(snapshot.qty_branch_001, 4);
  assert.equal(snapshot.qty_branch_003, 7);
  assert.equal(snapshot.qty_branch_004, 8);
  assert.equal(snapshot.qty_branch_005, 9);
  assert.equal(snapshot.cost_avg_branch_001, 14.25);
  assert.equal(snapshot.cost_avg_branch_003, 30);
  assert.equal(snapshot.cost_avg_branch_004, 40);
  assert.equal(snapshot.cost_avg_branch_005, 50);
  assert.equal(snapshot.qty_total_all_branches, 28);
});

test("branch stock sync accepts empty records and echoes branchCode", async () => {
  const { app, db } = createTestApp();

  const response = await request(app)
    .post("/api/branch-stock/sync")
    .set("x-api-key", "test-pos-key")
    .send({
      branchCode: "001",
      records: [],
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    accepted: 0,
    insertedOrUpdated: 0,
    branchCode: "001",
  });
  assert.equal(db.state.snapshots.size, 0);
  assert.deepEqual(db.state.txLog, ["begin", "commit"]);
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

test("branch stock inventory value detail returns per-product average cost and inventory value for admins only", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630010501", {
    product_code: "630010501",
    product_name_thai: "แคลเซียม",
    product_name_eng: "Calcium",
    barcode: "885000005501",
    unit: "BOX",
    qty_branch_000: 0,
    qty_branch_001: 0,
    qty_branch_002: 0,
    qty_branch_003: 0,
    qty_branch_004: 0,
    qty_branch_005: 10,
    qty_total_all_branches: 10,
    cost_avg_branch_005: 12.5,
    synced_at: "2026-06-17T08:15:00.000Z",
  });
  db.state.snapshots.set("630010502", {
    product_code: "630010502",
    product_name_thai: "วิตามินดี",
    product_name_eng: "Vitamin D",
    barcode: "885000005502",
    unit: "TAB",
    qty_branch_000: 0,
    qty_branch_001: 0,
    qty_branch_002: 0,
    qty_branch_003: 0,
    qty_branch_004: 0,
    qty_branch_005: 3,
    qty_total_all_branches: 3,
    cost_avg_branch_005: null,
    synced_at: "2026-06-17T19:20:00.000Z",
  });

  const staffAgent = request.agent(app);
  await loginAsStaff(staffAgent);
  const forbidden = await staffAgent.get("/api/branch-stock/inventory-value?branchCode=005&detail=true");
  assert.equal(forbidden.status, 403);

  const adminAgent = request.agent(app);
  await loginAsAdmin(adminAgent);

  const response = await adminAgent.get("/api/branch-stock/inventory-value?branchCode=005&detail=true&limit=25&offset=0");
  assert.equal(response.status, 200);
  assert.equal(response.body.branchCode, "005");
  assert.equal(response.body.productCount, 2);
  assert.equal(response.body.productsWithStock, 2);
  assert.equal(response.body.productsWithCost, 1);
  assert.equal(response.body.totalInventoryValue, 125);
  assert.equal(response.body.pagination.total, 2);
  assert.equal(response.body.products.length, 2);
  assert.equal(response.body.products[0].productCode, "630010501");
  assert.equal(response.body.products[0].qty, 10);
  assert.equal(response.body.products[0].unitCostAvg, 12.5);
  assert.equal(response.body.products[0].inventoryValue, 125);
  assert.equal(response.body.products[0].syncedAt, "2026-06-17T08:15:00.000Z");
  assert.equal(response.body.products[1].productCode, "630010502");
  assert.equal(response.body.products[1].unitCostAvg, null);
  assert.equal(response.body.products[1].inventoryValue, 0);
});

test("branch stock inventory value all returns combined summary and compare rows for admins only", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630019001", {
    product_code: "630019001",
    product_name_thai: "สินค้ารวม 1",
    product_name_eng: "Combined 1",
    barcode: "885000019001",
    unit: "BOX",
    qty_branch_000: 2,
    qty_branch_001: 0,
    qty_branch_002: 0,
    qty_branch_003: 0,
    qty_branch_004: 0,
    qty_branch_005: 4,
    qty_total_all_branches: 6,
    cost_avg_branch_000: 10,
    cost_avg_branch_005: 12.5,
    synced_at: "2026-06-17T08:15:00.000Z",
  });
  db.state.snapshots.set("630019002", {
    product_code: "630019002",
    product_name_thai: "สินค้ารวม 2",
    product_name_eng: "Combined 2",
    barcode: "885000019002",
    unit: "TAB",
    qty_branch_000: 0,
    qty_branch_001: 3,
    qty_branch_002: 0,
    qty_branch_003: 0,
    qty_branch_004: 1,
    qty_branch_005: 0,
    qty_total_all_branches: 4,
    cost_avg_branch_001: null,
    cost_avg_branch_004: 8,
    synced_at: "2026-06-17T19:20:00.000Z",
  });
  db.state.snapshots.set("630019003", {
    product_code: "630019003",
    product_name_thai: "ไม่มีสต๊อก",
    product_name_eng: "No Stock",
    barcode: "885000019003",
    unit: "BOT",
    qty_branch_000: 0,
    qty_branch_001: 0,
    qty_branch_002: 0,
    qty_branch_003: 0,
    qty_branch_004: 0,
    qty_branch_005: 0,
    qty_total_all_branches: 0,
    synced_at: "2026-06-17T19:30:00.000Z",
  });

  const adminAgent = request.agent(app);
  await loginAsAdmin(adminAgent);

  const response = await adminAgent.get("/api/branch-stock/inventory-value?branchCode=all&detail=true&limit=25&offset=0");
  assert.equal(response.status, 200);
  assert.equal(response.body.branchCode, "all");
  assert.equal(response.body.productCount, 3);
  assert.equal(response.body.productsWithStock, 2);
  assert.equal(response.body.productsWithCost, 1);
  assert.equal(response.body.totalInventoryValue, 78);
  assert.equal(response.body.pagination.total, 2);
  assert.equal(response.body.branchSummaries.length, 5);
  assert.deepEqual(
    response.body.branchSummaries.map((branch) => branch.branchCode),
    DISPLAY_BRANCH_CODES,
  );
  assert.equal(
    response.body.branchSummaries.find((branch) => branch.branchCode === "000")?.totalInventoryValue,
    20,
  );
  assert.equal(
    response.body.branchSummaries.find((branch) => branch.branchCode === "001")?.productsWithCost,
    0,
  );
  assert.equal(response.body.products.length, 2);
  assert.equal(response.body.products[0].productCode, "630019001");
  assert.equal(response.body.products[0].qtyTotalAllBranches, 6);
  assert.equal(response.body.products[0].totalInventoryValue, 70);
  assert.equal(response.body.products[0].branches["000"].qty, 2);
  assert.equal(response.body.products[0].branches["000"].unitCostAvg, 10);
  assert.equal(response.body.products[0].branches["005"].inventoryValue, 50);
  assert.equal(response.body.products[1].productCode, "630019002");
  assert.equal(response.body.products[1].branches["001"].qty, 3);
  assert.equal(response.body.products[1].branches["001"].unitCostAvg, null);
  assert.equal(response.body.products[1].branches["004"].inventoryValue, 8);
});

test("branch stock export returns branch-specific xlsx rows for authenticated admins", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630010002", {
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
  });

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const response = await agent
    .get("/api/branch-stock/export.xlsx?branchCode=001&search=loratadine")
    .buffer(true)
    .parse(binaryParser);
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"] || ""), /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/i);
  assert.match(String(response.headers["content-disposition"] || ""), /branch-stock-001-/i);

  const workbook = XLSX.read(response.body, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.equal(sheet.A1.v, "บริษัท เอสซีกรุ๊ป (1989) จำกัด สาขา 001");
  assert.equal(sheet.A2.v, "ลำดับ");
  assert.equal(sheet.B2.v, "รหัส");
  assert.equal(sheet.C2.v, "ชื่อสินค้า");
  assert.equal(sheet.F2.v, "จำนวน");
  assert.equal(sheet.B3.v, "630010002");
  assert.equal(sheet.C3.v, "ลอราทาดีน");
  assert.equal(sheet.F3.v, 2);
  assert.equal(sheet.G3.v, "");
});

test("branch stock export all returns 6-sheet workbook with comparison sheet and branch sheets", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630010010", {
    product_code: "630010010",
    product_name_thai: "วิตามินซี",
    product_name_eng: "Vitamin C",
    barcode: "885000000010",
    unit: "BOX",
    qty_branch_000: 10,
    qty_branch_001: 20,
    qty_branch_002: 0,
    qty_branch_003: 30,
    qty_branch_004: 40,
    qty_branch_005: 50,
    qty_total_all_branches: 150,
    synced_at: "2026-06-17T08:00:00.000Z",
  });
  db.state.snapshots.set("630010011", {
    product_code: "630010011",
    product_name_thai: "พาราเซตามอล",
    product_name_eng: "Paracetamol",
    barcode: "885000000011",
    unit: "TAB",
    qty_branch_000: 5,
    qty_branch_001: 0,
    qty_branch_002: 0,
    qty_branch_003: 15,
    qty_branch_004: 0,
    qty_branch_005: 25,
    qty_total_all_branches: 45,
    synced_at: "2026-06-17T08:05:00.000Z",
  });
  db.state.categoryStates.set("630010010", {
    product_code: "630010010",
    category_name: "วิตามิน",
    review_status: "confirmed",
    rationale: "manual",
  });

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const response = await agent
    .get("/api/branch-stock/export.xlsx?branchCode=all")
    .buffer(true)
    .parse(binaryParser);

  assert.equal(response.status, 200);
  assert.match(
    String(response.headers["content-type"] || ""),
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/i,
  );
  assert.match(
    String(response.headers["content-disposition"] || ""),
    /branch-stock-all-/i,
  );

  const workbook = XLSX.read(response.body, { type: "buffer" });
  assert.equal(workbook.SheetNames.length, 6, "workbook must have 6 sheets");
  assert.equal(workbook.SheetNames[0], "ทุกสาขา");
  assert.deepEqual(workbook.SheetNames.slice(1), ["000", "001", "003", "004", "005"]);

  // ── Comparison sheet headers ──────────────────────────────────────────────
  const comp = workbook.Sheets["ทุกสาขา"];
  assert.equal(comp.A1.v, "รหัสสินค้า",     "A1 = รหัสสินค้า");
  assert.equal(comp.B1.v, "ชื่อสินค้าไทย",  "B1 = ชื่อสินค้าไทย");
  assert.equal(comp.C1.v, "ชื่ออังกฤษ",     "C1 = ชื่ออังกฤษ");
  assert.equal(comp.D1.v, "Barcode",         "D1 = Barcode");
  assert.equal(comp.E1.v, "หน่วย",           "E1 = หน่วย");
  assert.equal(comp.F1.v, "หมวดหมู่",        "F1 = หมวดหมู่");
  assert.equal(comp.G1.v, "สถานะหมวดหมู่",  "G1 = สถานะหมวดหมู่");
  assert.equal(comp.H1.v, "สาขา 000",        "H1 = สาขา 000");
  assert.equal(comp.I1.v, "สาขา 001",        "I1 = สาขา 001");
  assert.equal(comp.J1.v, "สาขา 003",        "J1 = สาขา 003");
  assert.equal(comp.K1.v, "สาขา 004",        "K1 = สาขา 004");
  assert.equal(comp.L1.v, "สาขา 005",        "L1 = สาขา 005");
  assert.equal(comp.M1.v, "รวมทุกสาขา",     "M1 = รวมทุกสาขา");
  assert.equal(comp.N1.v, "synced_at",        "N1 = synced_at");

  // ── Comparison sheet data row 1 (product 630010010, sorted first) ─────────
  assert.equal(comp.A2.v, "630010010");
  assert.equal(comp.B2.v, "วิตามินซี");
  assert.equal(comp.H2.v, 10,   "qty sาขา 000");
  assert.equal(comp.I2.v, 20,   "qty สาขา 001");
  assert.equal(comp.J2.v, 30,   "qty สาขา 003");
  assert.equal(comp.K2.v, 40,   "qty สาขา 004");
  assert.equal(comp.L2.v, 50,   "qty สาขา 005");
  assert.equal(comp.M2.v, 150,  "total qty");
  assert.ok(comp.N2.v,          "synced_at is present");

  // ── Branch sheet 000 uses qty_branch_000 ─────────────────────────────────
  const sheet000 = workbook.Sheets["000"];
  assert.equal(sheet000.A1.v, "บริษัท เอสซีกรุ๊ป (1989) จำกัด สาขา 000");
  assert.equal(sheet000.F3.v, 10, "branch 000 qty for product 1");

  // ── Branch sheet 001 uses qty_branch_001 ─────────────────────────────────
  const sheet001 = workbook.Sheets["001"];
  assert.equal(sheet001.F3.v, 20, "branch 001 qty for product 1");

  // ── Branch sheet 005 uses qty_branch_005 ─────────────────────────────────
  const sheet005 = workbook.Sheets["005"];
  assert.equal(sheet005.F3.v, 50, "branch 005 qty for product 1");
});

test("taxonomy match report route returns latest committed report artifact for authenticated admins", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const response = await agent.get("/api/admin/taxonomy-match-report");

  assert.equal(response.status, 200);
  assert.equal(typeof response.body.fileName, "string");
  assert.match(response.body.fileName, /^taxonomy-match-report-.*\.json$/);
  assert.equal(typeof response.body.summary, "object");
  assert.equal(Array.isArray(response.body.samples.exactCodeMatches), true);
});

test("taxonomy match preview marks exact-code rows safe only when current state is clear", async () => {
  const { app, db } = createTestApp();
  db.state.skuCategories.set("630010003", null);
  db.state.skuCategories.set("630010004", "ผิวหนัง");
  db.state.categoryStates.set("630010005", {
    product_code: "630010005",
    category_name: "สมุนไพร",
    review_status: "confirmed",
    rationale: "manual confirm",
  });

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const safeResponse = await agent.get("/api/admin/taxonomy-match-preview?search=630010003&limit=10&offset=0");
  assert.equal(safeResponse.status, 200);
  assert.equal(safeResponse.body.records.length, 1);
  assert.equal(safeResponse.body.records[0].productCode, "630010003");
  assert.equal(safeResponse.body.records[0].proposedCategory, "ลบรอย");
  assert.equal(safeResponse.body.records[0].safeToApply, true);
  assert.equal(safeResponse.body.records[0].reason, "exact_code_match");

  const conflictResponse = await agent.get("/api/admin/taxonomy-match-preview?search=630010004&limit=10&offset=0");
  assert.equal(conflictResponse.status, 200);
  assert.equal(conflictResponse.body.records[0].safeToApply, false);
  assert.equal(conflictResponse.body.records[0].reason, "category_conflict");

  const confirmedResponse = await agent.get("/api/admin/taxonomy-match-preview?search=630010005&limit=10&offset=0");
  assert.equal(confirmedResponse.status, 200);
  assert.equal(confirmedResponse.body.records[0].safeToApply, false);
  assert.equal(confirmedResponse.body.records[0].reason, "already_confirmed");
});

test("taxonomy match apply writes only safe exact-code rows into category state overlay", async () => {
  const { app, db } = createTestApp();
  db.state.skuCategories.set("630010004", "ผิวหนัง");

  const agent = request.agent(app);
  const csrfToken = await loginAsAdmin(agent);

  const response = await agent
    .post("/api/admin/taxonomy-match-apply")
    .set("X-CSRF-Token", csrfToken)
    .send({
      productCodes: ["630010003", "630010004"],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.appliedCount, 1);
  assert.equal(response.body.skippedCount, 1);
  assert.equal(db.state.categoryStates.get("630010003")?.category_name, "ลบรอย");
  assert.equal(db.state.categoryStates.get("630010003")?.review_status, "imported_exact_match");
  assert.equal(db.state.categoryStates.has("630010004"), false);
  assert.ok(db.state.auditActions.includes("taxonomy_match.apply_exact_code"));
});

test("branch stock listing returns overlay category state when taxonomy apply has populated it", async () => {
  const { app, db } = createTestApp();
  db.state.snapshots.set("630010003", {
    product_code: "630010003",
    product_name_thai: "สามัญ ฮีรูสการ์โพสแอคเน่ 5 กรัม",
    product_name_eng: "Hiruscar Postacne 5 G",
    barcode: "8851743001241",
    unit: "หลอด",
    qty_branch_000: 2,
    qty_branch_001: 1,
    qty_branch_002: 0,
    qty_branch_003: 0,
    qty_branch_004: 0,
    qty_branch_005: 0,
    qty_total_all_branches: 3,
    synced_at: "2026-05-25T08:10:00.000Z",
  });
  db.state.categoryStates.set("630010003", {
    product_code: "630010003",
    category_name: "ลบรอย",
    review_status: "imported_exact_match",
    rationale: "taxonomy exact-code preview/apply",
  });

  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const listResponse = await agent.get("/api/branch-stock?search=630010003&limit=25&offset=0");
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.records[0].category, "ลบรอย");
  assert.equal(listResponse.body.records[0].categoryStatus, "imported_exact_match");
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
