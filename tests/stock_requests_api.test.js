"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");
const {
  formatBatchPublicId,
} = require("../apps/admin-api/src/services/stockRequests");

test("batch public IDs format PostgreSQL Date values as UTC YYYYMMDD", () => {
  assert.equal(
    formatBatchPublicId(new Date("2026-06-18T15:27:29.000Z"), "001", 1),
    "SRQ-20260618-001-000001",
  );
});

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
    featureStockRequests: true,
    adminUsers: new Set(["admin@example.com"]),
    staffUsers: new Set(["staff@example.com"]),
    branchUsers: new Set(["branch001@example.com", "branch003@example.com"]),
    adminPasswordHash: bcrypt.hashSync("admin-pass-123", 10),
    staffPasswordHash: bcrypt.hashSync("staff-pass-123", 10),
    branchUserBranches: new Map([
      ["branch001@example.com", "001"],
      ["branch003@example.com", "003"],
    ]),
    branchUserPasswordHashes: new Map([
      ["branch001@example.com", bcrypt.hashSync("branch-pass-001", 10)],
      ["branch003@example.com", bcrypt.hashSync("branch-pass-003", 10)],
    ]),
    posApiKeys: new Set(["test-pos-key"]),
  };
}

function createInitialState() {
  return {
    auditActions: [],
    branches: new Map([
      ["000", { branch_code: "000", branch_name: "HQ", is_active: true, is_hq: true }],
      ["001", { branch_code: "001", branch_name: "Branch 001", is_active: true, is_hq: false }],
      ["003", { branch_code: "003", branch_name: "Branch 003", is_active: true, is_hq: false }],
      ["005", { branch_code: "005", branch_name: "Branch 005", is_active: false, is_hq: false }],
    ]),
    products: new Map([
      [
        "630010001",
        {
          product_code: "630010001",
          product_name_thai: "เซทิริซีน",
          product_name_eng: "Cetirizine",
          barcode: "885000000001",
          default_unit: "BOX",
        },
      ],
      [
        "630010002",
        {
          product_code: "630010002",
          product_name_thai: "ลอราทาดีน",
          product_name_eng: "Loratadine",
          barcode: "885000000002",
          default_unit: "TAB",
        },
      ],
      [
        "630010003",
        {
          product_code: "630010003",
          product_name_thai: "วิตามินซี",
          product_name_eng: "Vitamin C",
          barcode: "885000000003",
          default_unit: "BOX",
        },
      ],
    ]),
    batches: [],
    requests: [],
    lines: [],
    responses: [],
    notifications: [],
    documents: [],
    shipments: [],
    shipmentLines: [],
    receipts: [],
    receiptLines: [],
    events: [],
    txLog: [],
    // key: `${branchCode}|${productCode}` -> current qty, simulating
    // ada.branch_stock_snapshots for the packing-document live-stock lookup.
    currentStock: new Map(),
    nextBatchId: 1,
    nextRequestId: 1,
    nextLineId: 1,
    nextResponseId: 1,
    nextNotificationId: 1,
    nextDocumentId: 1,
    nextShipmentId: 1,
    nextShipmentLineId: 1,
    nextReceiptId: 1,
    nextReceiptLineId: 1,
    nextEventId: 1,
    failOnLineProductCode: null,
  };
}

function cloneState(state) {
  return {
    auditActions: [...state.auditActions],
    branches: new Map([...state.branches.entries()].map(([key, value]) => [key, { ...value }])),
    products: new Map([...state.products.entries()].map(([key, value]) => [key, { ...value }])),
    batches: state.batches.map((row) => ({ ...row })),
    requests: state.requests.map((row) => ({ ...row })),
    lines: state.lines.map((row) => ({ ...row })),
    responses: state.responses.map((row) => ({ ...row })),
    notifications: state.notifications.map((row) => ({ ...row })),
    documents: state.documents.map((row) => ({ ...row })),
    shipments: state.shipments.map((row) => ({ ...row })),
    shipmentLines: state.shipmentLines.map((row) => ({ ...row })),
    receipts: state.receipts.map((row) => ({ ...row })),
    receiptLines: state.receiptLines.map((row) => ({ ...row })),
    events: state.events.map((row) => ({ ...row })),
    txLog: [...state.txLog],
    currentStock: new Map(state.currentStock),
    nextBatchId: state.nextBatchId,
    nextRequestId: state.nextRequestId,
    nextLineId: state.nextLineId,
    nextResponseId: state.nextResponseId,
    nextNotificationId: state.nextNotificationId,
    nextDocumentId: state.nextDocumentId,
    nextShipmentId: state.nextShipmentId,
    nextShipmentLineId: state.nextShipmentLineId,
    nextReceiptId: state.nextReceiptId,
    nextReceiptLineId: state.nextReceiptLineId,
    nextEventId: state.nextEventId,
    failOnLineProductCode: state.failOnLineProductCode,
  };
}

function createStockRequestMockDb() {
  const container = {
    state: createInitialState(),
    txState: null,
  };

  function activeState() {
    return container.txState || container.state;
  }

  function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function includesSearch(value, searchTerm) {
    if (!searchTerm) {
      return true;
    }
    return String(value || "").toLowerCase().includes(String(searchTerm).toLowerCase());
  }

  async function query(sql, params = []) {
    const normalized = normalizeSql(sql);

    if (normalized === "begin") {
      container.state.txLog.push("BEGIN");
      container.txState = cloneState(container.state);
      return { rowCount: 0, rows: [] };
    }
    if (normalized === "commit") {
      if (container.txState) {
        container.txState.txLog.push("COMMIT");
        container.state = container.txState;
        container.txState = null;
      } else {
        container.state.txLog.push("COMMIT");
      }
      return { rowCount: 0, rows: [] };
    }
    if (normalized === "rollback") {
      if (container.txState) {
        container.state.txLog.push("ROLLBACK");
        container.txState = null;
      } else {
        container.state.txLog.push("ROLLBACK");
      }
      return { rowCount: 0, rows: [] };
    }

    const state = activeState();

    if (normalized.startsWith("insert into public.audit_logs")) {
      state.auditActions.push(params[2]);
      return {
        rowCount: 1,
        rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
      };
    }

    if (
      normalized.includes("select branch_code, branch_name, is_active, is_hq") &&
      normalized.includes("from core.branches") &&
      normalized.includes("where branch_code = $1")
    ) {
      const branch = state.branches.get(String(params[0] || "")) || null;
      return { rowCount: branch ? 1 : 0, rows: branch ? [branch] : [] };
    }

    if (
      normalized.includes("select batch_id, public_id, requesting_branch_code, created_by") &&
      normalized.includes("from ordering.stock_request_batches") &&
      normalized.includes("where idempotency_key = $1")
    ) {
      const batch = state.batches.find((row) => row.idempotency_key === params[0]) || null;
      return { rowCount: batch ? 1 : 0, rows: batch ? [batch] : [] };
    }

    if (
      normalized.includes("select batch_id, public_id, requesting_branch_code, status, created_by, note, version, submitted_at, created_at, updated_at") &&
      normalized.includes("from ordering.stock_request_batches") &&
      normalized.includes("where public_id = $1")
    ) {
      const batch = state.batches.find((row) => row.public_id === params[0]) || null;
      return { rowCount: batch ? 1 : 0, rows: batch ? [batch] : [] };
    }

    if (
      normalized.includes("select batch_id, public_id, requesting_branch_code, status, created_by, note, version, submitted_at, created_at, updated_at") &&
      normalized.includes("from ordering.stock_request_batches") &&
      normalized.includes("where batch_id = $1")
    ) {
      const batch = state.batches.find((row) => row.batch_id === Number(params[0])) || null;
      return { rowCount: batch ? 1 : 0, rows: batch ? [batch] : [] };
    }

    if (
      normalized.includes("select public_id, source_branch_code, request_mode") &&
      normalized.includes("from ordering.stock_requests") &&
      normalized.includes("where batch_id = $1")
    ) {
      const rows = state.requests
        .filter((row) => row.batch_id === Number(params[0]))
        .sort((left, right) => left.source_branch_code.localeCompare(right.source_branch_code))
        .map((row) => ({
          public_id: row.public_id,
          source_branch_code: row.source_branch_code,
          request_mode: row.request_mode || "STANDARD",
        }));
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select request_id, public_id, batch_id, requesting_branch_code, source_branch_code") &&
      normalized.includes("from ordering.stock_requests") &&
      normalized.includes("where public_id = $1")
    ) {
      const row = state.requests.find((item) => item.public_id === params[0]) || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    if (
      normalized.includes("select request_id, public_id, batch_id, requesting_branch_code, source_branch_code") &&
      normalized.includes("from ordering.stock_requests") &&
      normalized.includes("where batch_id = $1")
    ) {
      const rows = state.requests
        .filter((row) => row.batch_id === Number(params[0]))
        .sort(
          (left, right) =>
            left.source_branch_code.localeCompare(right.source_branch_code) || left.request_id - right.request_id,
        );
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("from ordering.stock_requests") &&
      normalized.includes("where requesting_branch_code = $1")
    ) {
      const requestingBranchCode = params[0];
      const searchTerm = params[1];
      const rows = state.requests
        .filter((row) => row.requesting_branch_code === requestingBranchCode)
        .filter(
          (row) =>
            includesSearch(row.public_id, searchTerm) || includesSearch(row.source_branch_code, searchTerm),
        )
        .sort(
          (left, right) =>
            String(right.created_at || "").localeCompare(String(left.created_at || "")) || right.request_id - left.request_id,
        );
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("from ordering.stock_requests") &&
      normalized.includes("source_branch_code = $1") &&
      !normalized.includes("where batch_id")
    ) {
      const sourceBranchCode = params[0];
      const searchTerm = params[1];
      const rows = state.requests
        .filter((row) => sourceBranchCode === null || row.source_branch_code === sourceBranchCode)
        .filter(
          (row) =>
            includesSearch(row.public_id, searchTerm) ||
            includesSearch(row.requesting_branch_code, searchTerm) ||
            includesSearch(row.source_branch_code, searchTerm),
        )
        .sort(
          (left, right) =>
            String(right.created_at || "").localeCompare(String(left.created_at || "")) || right.request_id - left.request_id,
        );
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select batch_id, request_mode") &&
      normalized.includes("from ordering.stock_requests") &&
      normalized.includes("batch_id = any(")
    ) {
      const batchIds = (params[0] || []).map(Number);
      const rows = state.requests
        .filter((row) => batchIds.includes(Number(row.batch_id)))
        .map((row) => ({ batch_id: row.batch_id, request_mode: row.request_mode || "STANDARD" }));
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select branch_code, branch_name, is_active, is_hq") &&
      normalized.includes("from core.branches") &&
      normalized.includes("where branch_code = any($1::text[])")
    ) {
      const codes = Array.isArray(params[0]) ? params[0] : [];
      const rows = codes.map((code) => state.branches.get(code)).filter(Boolean);
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select batch_id, public_id, requesting_branch_code, status, created_by, note, version, submitted_at, created_at, updated_at") &&
      normalized.includes("from ordering.stock_request_batches") &&
      normalized.includes("where batch_id = any($1::bigint[])")
    ) {
      const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
      const rows = state.batches.filter((row) => ids.includes(Number(row.batch_id)));
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select line_id, request_id, product_code, product_name_thai, product_name_eng, barcode, unit, requested_qty, snapshot_qty, snapshot_synced_at, status, created_at") &&
      normalized.includes("from ordering.stock_request_lines") &&
      normalized.includes("where request_id = any($1::bigint[])")
    ) {
      const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
      const rows = state.lines
        .filter((row) => ids.includes(Number(row.request_id)))
        .sort((left, right) => left.request_id - right.request_id || left.line_id - right.line_id);
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select distinct on (line_id)") &&
      normalized.includes("from ordering.stock_request_line_responses") &&
      normalized.includes("where line_id = any($1::bigint[])")
    ) {
      const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
      const rows = state.responses
        .filter((row) => ids.includes(Number(row.line_id)) && row.is_submitted === true)
        .sort((left, right) => left.line_id - right.line_id || String(right.created_at).localeCompare(String(left.created_at)));
      const distinct = [];
      const seen = new Set();
      for (const row of rows) {
        if (seen.has(row.line_id)) continue;
        seen.add(row.line_id);
        distinct.push(row);
      }
      return { rowCount: distinct.length, rows: distinct };
    }

    if (
      normalized.includes("select event_id, batch_id, request_id, line_id, event_type, actor_user, actor_branch, metadata, note, request_correlation_id, created_at") &&
      normalized.includes("from ordering.stock_request_events") &&
      normalized.includes("where batch_id = $1")
    ) {
      const rows = state.events
        .filter((row) => Number(row.batch_id) === Number(params[0]))
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || left.event_id - right.event_id);
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("from unnest($1::text[]) with ordinality as codes(product_code, ord)") &&
      normalized.includes("where s.company_code is not null")
    ) {
      const codes = Array.isArray(params[0]) ? params[0] : [];
      const rows = [];
      for (const code of codes) {
        const product = state.products.get(code);
        if (!product) continue;
        rows.push({
          product_code: product.product_code,
          product_name_thai: product.product_name_thai,
          product_name_eng: product.product_name_eng,
          barcode: product.barcode,
          default_unit: product.default_unit,
        });
      }
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith("insert into ordering.stock_request_batches")) {
      const row = {
        batch_id: state.nextBatchId++,
        public_id: params[0],
        requesting_branch_code: params[1],
        status: "SUBMITTED",
        created_by: params[2],
        note: params[3],
        idempotency_key: params[4],
        version: 1,
        submitted_at: "2026-06-18T12:00:00.000Z",
        created_at: "2026-06-18T12:00:00.000Z",
        updated_at: "2026-06-18T12:00:00.000Z",
      };
      state.batches.push(row);
      return {
        rowCount: 1,
        rows: [{ batch_id: row.batch_id, submitted_at: row.submitted_at }],
      };
    }

    if (normalized.startsWith("update ordering.stock_request_batches set public_id = $2")) {
      const batch = state.batches.find((row) => row.batch_id === Number(params[0]));
      if (batch) {
        batch.public_id = params[1];
      }
      return { rowCount: batch ? 1 : 0, rows: [] };
    }

    if (normalized.startsWith("insert into ordering.stock_requests")) {
      const row = {
        request_id: state.nextRequestId++,
        public_id: params[0],
        batch_id: Number(params[1]),
        requesting_branch_code: params[2],
        source_branch_code: params[3],
        request_mode: params[4] || "STANDARD",
        status: "SUBMITTED",
        response_result: null,
        response_note: null,
        responded_by: null,
        responded_at: null,
        acknowledged_by: null,
        acknowledged_at: null,
        version: 1,
        created_at: "2026-06-18T12:00:00.000Z",
        updated_at: "2026-06-18T12:00:00.000Z",
      };
      state.requests.push(row);
      return { rowCount: 1, rows: [{ request_id: row.request_id }] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_lines")) {
      if (state.failOnLineProductCode && params[1] === state.failOnLineProductCode) {
        throw new Error(`Synthetic insert failure for ${params[1]}`);
      }
      const row = {
        line_id: state.nextLineId++,
        request_id: Number(params[0]),
        product_code: params[1],
        product_name_thai: params[2],
        product_name_eng: params[3],
        barcode: params[4],
        unit: params[5],
        requested_qty: Number(params[6]),
        snapshot_qty: params[7] == null ? null : Number(params[7]),
        snapshot_synced_at: params[8],
        status: "PENDING",
        created_at: "2026-06-18T12:00:00.000Z",
      };
      state.lines.push(row);
      return { rowCount: 1, rows: [{ line_id: row.line_id }] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_events")) {
      state.events.push({
        event_id: state.nextEventId++,
        batch_id: params[0],
        request_id: params[1],
        line_id: params[2],
        event_type: params[3],
        actor_user: params[4],
        actor_branch: params[5],
        metadata: params[6] ? JSON.parse(params[6]) : null,
        note: params[7],
        request_correlation_id: params[8],
        created_at: "2026-06-18T12:00:00.000Z",
      });
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_line_responses")) {
      const row = {
        response_id: state.nextResponseId++,
        line_id: Number(params[0]),
        response_status: params[1],
        approved_qty: Number(params[2]),
        reason_code: params[3],
        note: params[4],
        revalidated_snapshot_qty: params[5] == null ? null : Number(params[5]),
        is_submitted: Boolean(params[6]),
        responded_by: params[7],
        superseded_by: null,
        created_at: "2026-06-18T12:05:00.000Z",
      };
      state.responses.push(row);
      return { rowCount: 1, rows: [{ response_id: row.response_id }] };
    }

    if (normalized.startsWith("update ordering.stock_request_lines set status = $2")) {
      const line = state.lines.find((row) => row.line_id === Number(params[0]));
      if (line) {
        line.status = params[1];
      }
      return { rowCount: line ? 1 : 0, rows: [] };
    }

    if (normalized.startsWith("update ordering.stock_requests set status = 'responded'")) {
      const requestRow = state.requests.find(
        (row) =>
          row.request_id === Number(params[0]) &&
          row.status === "SUBMITTED" &&
          (params[2] == null || Number(row.version) === Number(params[2])),
      );
      if (!requestRow) {
        return { rowCount: 0, rows: [] };
      }
      requestRow.status = "RESPONDED";
      requestRow.responded_by = params[1];
      requestRow.responded_at = "2026-06-18T12:05:00.000Z";
      requestRow.version = Number(requestRow.version) + 1;
      requestRow.updated_at = "2026-06-18T12:05:00.000Z";
      return { rowCount: 1, rows: [{ request_id: requestRow.request_id, version: requestRow.version }] };
    }

    if (normalized.startsWith("update ordering.stock_requests set response_result = $2, response_note = $3, updated_at = now() where request_id = $1")) {
      const requestRow = state.requests.find((row) => row.request_id === Number(params[0]));
      if (!requestRow) {
        return { rowCount: 0, rows: [] };
      }
      requestRow.response_result = params[1];
      requestRow.response_note = params[2];
      requestRow.updated_at = "2026-06-18T12:05:00.000Z";
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("update ordering.stock_requests set status = 'acknowledged'")) {
      const requestRow = state.requests.find(
        (row) =>
          row.request_id === Number(params[0]) &&
          row.status === "RESPONDED" &&
          (params[2] == null || Number(row.version) === Number(params[2])),
      );
      if (!requestRow) {
        return { rowCount: 0, rows: [] };
      }
      requestRow.status = "ACKNOWLEDGED";
      requestRow.acknowledged_by = params[1];
      requestRow.acknowledged_at = "2026-06-18T12:15:00.000Z";
      requestRow.version = Number(requestRow.version) + 1;
      requestRow.updated_at = "2026-06-18T12:15:00.000Z";
      return { rowCount: 1, rows: [{ request_id: requestRow.request_id, version: requestRow.version }] };
    }

    if (normalized.startsWith("update ordering.stock_requests set status = $2, version = version + 1")) {
      const requestRow = state.requests.find(
        (row) =>
          row.request_id === Number(params[0]) &&
          row.status === params[2] &&
          (params[3] == null || Number(row.version) === Number(params[3])),
      );
      if (!requestRow) {
        return { rowCount: 0, rows: [] };
      }
      requestRow.status = params[1];
      requestRow.version = Number(requestRow.version) + 1;
      requestRow.updated_at = "2026-06-18T12:30:00.000Z";
      return { rowCount: 1, rows: [{ request_id: requestRow.request_id, version: requestRow.version }] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_shipments")) {
      const row = {
        shipment_id: state.nextShipmentId++,
        request_id: Number(params[0]),
        dispatched_by: params[1],
        note: params[2],
        dispatched_at: "2026-06-18T12:30:00.000Z",
      };
      state.shipments.push(row);
      return { rowCount: 1, rows: [{ shipment_id: row.shipment_id, dispatched_at: row.dispatched_at }] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_shipment_lines")) {
      state.shipmentLines.push({
        shipment_line_id: state.nextShipmentLineId++,
        shipment_id: Number(params[0]),
        line_id: Number(params[1]),
        dispatched_qty: Number(params[2]),
      });
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_receipts")) {
      const row = {
        receipt_id: state.nextReceiptId++,
        request_id: Number(params[0]),
        received_by: params[1],
        note: params[2],
        received_at: "2026-06-18T12:35:00.000Z",
      };
      state.receipts.push(row);
      return { rowCount: 1, rows: [{ receipt_id: row.receipt_id, received_at: row.received_at }] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_receipt_lines")) {
      state.receiptLines.push({
        receipt_line_id: state.nextReceiptLineId++,
        receipt_id: Number(params[0]),
        line_id: Number(params[1]),
        received_qty: Number(params[2]),
      });
      return { rowCount: 1, rows: [] };
    }

    if (
      normalized.includes("select shipment_id, dispatched_by, note, dispatched_at") &&
      normalized.includes("from ordering.stock_request_shipments")
    ) {
      const rows = state.shipments
        .filter((row) => row.request_id === Number(params[0]))
        .sort((left, right) => right.shipment_id - left.shipment_id);
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select receipt_id, received_by, note, received_at") &&
      normalized.includes("from ordering.stock_request_receipts")
    ) {
      const rows = state.receipts
        .filter((row) => row.request_id === Number(params[0]))
        .sort((left, right) => right.receipt_id - left.receipt_id);
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select shipment_id, line_id, dispatched_qty") &&
      normalized.includes("from ordering.stock_request_shipment_lines")
    ) {
      const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
      const rows = state.shipmentLines.filter((row) => ids.includes(Number(row.shipment_id)));
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select receipt_id, line_id, received_qty") &&
      normalized.includes("from ordering.stock_request_receipt_lines")
    ) {
      const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
      const rows = state.receiptLines.filter((row) => ids.includes(Number(row.receipt_id)));
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith("update ordering.stock_request_batches set status = $2")) {
      const batch = state.batches.find((row) => row.batch_id === Number(params[0]));
      if (batch) {
        batch.status = params[1];
      }
      return { rowCount: batch ? 1 : 0, rows: [] };
    }

    if (
      normalized.includes("select document_id, request_id, document_type, version, document_payload") &&
      normalized.includes("from ordering.stock_request_documents")
    ) {
      const docType = params[1] || null;
      const rows = state.documents
        .filter((row) => row.request_id === Number(params[0]) && (docType === null || row.document_type === docType))
        .sort((left, right) => right.version - left.version)
        .slice(0, 1);
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.includes("select document_id, version") &&
      normalized.includes("from ordering.stock_request_documents")
    ) {
      const docType = params[1] || null;
      const rows = state.documents
        .filter((row) => row.request_id === Number(params[0]) && (docType === null || row.document_type === docType))
        .sort((left, right) => right.version - left.version)
        .slice(0, 1)
        .map((row) => ({ document_id: row.document_id, version: row.version }));
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith("insert into ordering.stock_request_documents")) {
      const row = {
        document_id: state.nextDocumentId++,
        request_id: Number(params[0]),
        document_type: params[1],
        version: Number(params[2]),
        document_payload: typeof params[3] === "string" ? JSON.parse(params[3]) : params[3],
        generated_by: params[4],
        reprint_of: params[5] == null ? null : Number(params[5]),
        generated_at: "2026-06-18T12:20:00.000Z",
      };
      state.documents.push(row);
      return { rowCount: 1, rows: [{ document_id: row.document_id, generated_at: row.generated_at }] };
    }

    if (
      normalized.includes("select count(*)::int as unread_count") &&
      normalized.includes("from ordering.stock_request_notifications")
    ) {
      const unread = state.notifications.filter(
        (row) => row.recipient_branch_code === params[0] && row.read_at == null,
      ).length;
      return { rowCount: 1, rows: [{ unread_count: unread }] };
    }

    if (
      normalized.includes("from ordering.stock_request_notifications") &&
      normalized.includes("where recipient_branch_code = $1") &&
      normalized.includes("limit $2")
    ) {
      const rows = state.notifications
        .filter((row) => row.recipient_branch_code === params[0])
        .sort(
          (left, right) =>
            String(right.created_at || "").localeCompare(String(left.created_at || "")) ||
            right.notification_id - left.notification_id,
        )
        .slice(0, Number(params[1]));
      return { rowCount: rows.length, rows };
    }

    if (
      normalized.startsWith("update ordering.stock_request_notifications set read_at") &&
      normalized.includes("where request_id = $1") &&
      normalized.includes("and recipient_branch_code = $2") &&
      normalized.includes("and type = 'request_submitted'")
    ) {
      let rowCount = 0;
      for (const row of state.notifications) {
        if (
          row.request_id === Number(params[0]) &&
          row.recipient_branch_code === params[1] &&
          row.type === "REQUEST_SUBMITTED" &&
          row.read_at == null
        ) {
          row.read_at = "2026-06-18T12:10:00.000Z";
          rowCount += 1;
        }
      }
      return { rowCount, rows: [] };
    }

    if (normalized.startsWith("update ordering.stock_request_notifications set read_at")) {
      const row = state.notifications.find(
        (item) => item.notification_id === Number(params[0]) && item.recipient_branch_code === params[1],
      );
      if (!row) {
        return { rowCount: 0, rows: [] };
      }
      row.read_at = row.read_at || "2026-06-18T12:10:00.000Z";
      return { rowCount: 1, rows: [{ notification_id: row.notification_id, read_at: row.read_at }] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_notifications")) {
      const dedupKey = params[7] || null;
      if (dedupKey && state.notifications.some((row) => row.dedup_key === dedupKey)) {
        return { rowCount: 0, rows: [] };
      }
      state.notifications.push({
        notification_id: state.nextNotificationId++,
        recipient_branch_code: params[0],
        recipient_user: params[1],
        type: params[2],
        batch_id: params[3],
        request_id: params[4],
        message: params[5],
        link_target: params[6],
        dedup_key: dedupKey,
        read_at: null,
        created_at: "2026-06-18T12:05:00.000Z",
      });
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("select product_code,") && normalized.includes("from ada.branch_stock_snapshots")) {
      const columnMatch = normalized.match(/select product_code, (qty_branch_\d{3}) as qty/);
      const branchCode = columnMatch ? columnMatch[1].replace("qty_branch_", "") : null;
      const productCodes = params[0] || [];
      const rows = productCodes
        .map((productCode) => {
          const qty = state.currentStock.get(`${branchCode}|${productCode}`);
          return qty == null ? null : { product_code: productCode, qty };
        })
        .filter(Boolean);
      return { rowCount: rows.length, rows };
    }

    throw new Error(`Unhandled mock query: ${normalized}`);
  }

  return {
    get state() {
      return container.state;
    },
    setFailOnLineProductCode(productCode) {
      container.state.failOnLineProductCode = productCode;
    },
    connect() {
      return {
        query,
        async release() {},
      };
    },
    query,
    async end() {},
  };
}

function createTestApp() {
  const db = createStockRequestMockDb();
  const { app } = createApp({
    config: buildConfig(),
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db };
}

async function login(agent, credentials) {
  const response = await agent.post("/admin/auth/login").send(credentials);
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

async function applyBranchOverride(agent, csrfToken, branchCode) {
  const response = await agent
    .post("/admin/auth/branch-override")
    .set("x-csrf-token", csrfToken)
    .send({ branchCode });
  assert.equal(response.status, 200);
  return response.body;
}

async function submitSampleBatch(agent, csrfToken, overrides = {}) {
  const payload = {
    idempotencyKey: overrides.idempotencyKey || "stock-request:001:sample",
    note: overrides.note || "Need urgent restock",
    groups: overrides.groups || [
      {
        sourceBranchCode: "000",
        lines: [
          {
            productCode: "630010001",
            requestedQty: 5,
            unit: "BOX",
            snapshotQty: 12,
            snapshotSyncedAt: "2026-06-18T08:00:00.000Z",
          },
        ],
      },
      {
        sourceBranchCode: "003",
        lines: [
          {
            productCode: "630010002",
            requestedQty: 3,
            unit: "TAB",
            snapshotQty: 6,
            snapshotSyncedAt: "2026-06-18T08:01:00.000Z",
          },
          {
            productCode: "630010003",
            requestedQty: 1,
            unit: "BOX",
            snapshotQty: 2,
            snapshotSyncedAt: "2026-06-18T08:02:00.000Z",
          },
        ],
      },
    ],
  };

  const response = await agent.post("/api/stock-requests").set("x-csrf-token", csrfToken).send(payload);
  assert.equal(response.status, 201);
  return response;
}

test("branch user submits one batch that fans out into child requests and line events in one transaction", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const response = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "stock-request:001:alpha",
      note: "Need urgent restock",
      requestingBranchCode: "000",
      groups: [
        {
          sourceBranchCode: "000",
          lines: [
            {
              productCode: "630010001",
              requestedQty: 5,
              unit: "BOX",
              snapshotQty: 12,
              snapshotSyncedAt: "2026-06-18T08:00:00.000Z",
            },
          ],
        },
        {
          sourceBranchCode: "003",
          lines: [
            {
              productCode: "630010002",
              requestedQty: 3,
              unit: "TAB",
              snapshotQty: 6,
              snapshotSyncedAt: "2026-06-18T08:01:00.000Z",
            },
            {
              productCode: "630010003",
              requestedQty: 1,
              unit: "BOX",
              snapshotQty: 2,
              snapshotSyncedAt: "2026-06-18T08:02:00.000Z",
            },
          ],
        },
      ],
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.duplicate, false);
  assert.match(response.body.batchPublicId, /^SRQ-20260618-001-\d{6}$/);
  assert.deepEqual(
    response.body.requests.map((item) => item.sourceBranchCode),
    ["000", "003"],
  );

  assert.equal(db.state.batches.length, 1);
  assert.equal(db.state.batches[0].requesting_branch_code, "001");
  assert.equal(db.state.batches[0].created_by, "branch001@example.com");
  assert.equal(db.state.requests.length, 2);
  assert.equal(db.state.lines.length, 3);
  assert.equal(db.state.events.length, 6);
  assert.deepEqual(
    db.state.notifications.map((item) => [item.recipient_branch_code, item.type]),
    [
      ["000", "REQUEST_SUBMITTED"],
      ["003", "REQUEST_SUBMITTED"],
    ],
  );
  assert.deepEqual(db.state.txLog, ["BEGIN", "COMMIT"]);
});

test("submit is idempotent on idempotencyKey for the same actor and branch", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const payload = {
    idempotencyKey: "stock-request:001:duplicate",
    groups: [
      {
        sourceBranchCode: "000",
        lines: [{ productCode: "630010001", requestedQty: 2, unit: "BOX" }],
      },
    ],
  };

  const firstResponse = await agent.post("/api/stock-requests").set("x-csrf-token", csrfToken).send(payload);
  const secondResponse = await agent.post("/api/stock-requests").set("x-csrf-token", csrfToken).send(payload);

  assert.equal(firstResponse.status, 201);
  assert.equal(secondResponse.status, 200);
  assert.equal(secondResponse.body.duplicate, true);
  assert.equal(secondResponse.body.batchPublicId, firstResponse.body.batchPublicId);
  assert.deepEqual(secondResponse.body.requests, firstResponse.body.requests);
  assert.equal(db.state.batches.length, 1);
  assert.equal(db.state.requests.length, 1);
  assert.equal(db.state.lines.length, 1);
});

test("admin must set an explicit branch override before submitting", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });

  const withoutOverride = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "stock-request:admin:no-override",
      groups: [{ sourceBranchCode: "000", lines: [{ productCode: "630010001", requestedQty: 1, unit: "BOX" }] }],
    });
  assert.equal(withoutOverride.status, 403);
  assert.equal(withoutOverride.body.error, "Branch identity required");

  const overrideResponse = await agent
    .post("/admin/auth/branch-override")
    .set("x-csrf-token", csrfToken)
    .send({ branchCode: "000" });
  assert.equal(overrideResponse.status, 200);

  const submitResponse = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "stock-request:admin:with-override",
      groups: [{ sourceBranchCode: "001", lines: [{ productCode: "630010001", requestedQty: 1, unit: "BOX" }] }],
    });

  assert.equal(submitResponse.status, 201);
  assert.match(submitResponse.body.batchPublicId, /^SRQ-20260618-000-\d{6}$/);
});

test("staff without branch context gets empty outgoing and incoming lists", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await login(agent, {
    username: "staff@example.com",
    password: "staff-pass-123",
  });

  const mineResponse = await agent.get("/api/stock-requests/mine");
  assert.equal(mineResponse.status, 200);
  assert.deepEqual(mineResponse.body.records, []);

  const incomingResponse = await agent.get("/api/stock-requests/incoming");
  assert.equal(incomingResponse.status, 200);
  assert.deepEqual(incomingResponse.body.records, []);
});

test("staff with branch override can submit, list mine, and read incoming requests", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, {
    username: "staff@example.com",
    password: "staff-pass-123",
  });

  await applyBranchOverride(agent, csrfToken, "001");
  const submitResponse = await submitSampleBatch(agent, csrfToken, {
    idempotencyKey: "stock-request:staff:001:sample",
  });
  const source003Request = submitResponse.body.requests.find((item) => item.sourceBranchCode === "003");

  const mineResponse = await agent.get("/api/stock-requests/mine");
  assert.equal(mineResponse.status, 200);
  assert.equal(mineResponse.body.records.length, 1);
  assert.equal(mineResponse.body.records[0].batchPublicId, submitResponse.body.batchPublicId);

  await applyBranchOverride(agent, csrfToken, "003");
  const incomingResponse = await agent.get("/api/stock-requests/incoming");
  assert.equal(incomingResponse.status, 200);
  assert.equal(incomingResponse.body.records.length, 1);
  assert.equal(incomingResponse.body.records[0].requestPublicId, source003Request.publicId);

  const detailResponse = await agent.get(`/api/stock-requests/incoming/${source003Request.publicId}`);
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.body.request.publicId, source003Request.publicId);
  assert.equal(detailResponse.body.request.sourceBranchCode, "003");
});

test("admin alert requests to HQ are flagged in admin incoming cards", async () => {
  const { app, db } = createTestApp();
  const requesterAgent = request.agent(app);
  const requesterCsrf = await login(requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const submitResponse = await requesterAgent
    .post("/api/stock-requests")
    .set("x-csrf-token", requesterCsrf)
    .send({
      idempotencyKey: "stock-request:001:admin-alert",
      groups: [
        {
          sourceBranchCode: "000",
          requestMode: "ADMIN_ALERT",
          lines: [
            {
              productCode: "630010001",
              requestedQty: 1,
              unit: "BOX",
              snapshotQty: 0,
            },
          ],
        },
      ],
    });

  assert.equal(submitResponse.status, 201);
  assert.equal(submitResponse.body.requests[0].sourceBranchCode, "000");

  const adminAgent = request.agent(app);
  const adminCsrf = await login(adminAgent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });
  await applyBranchOverride(adminAgent, adminCsrf, "000");

  const incomingResponse = await adminAgent.get("/api/stock-requests/incoming");
  assert.equal(incomingResponse.status, 200);
  assert.equal(incomingResponse.body.records.length, 1);
  assert.equal(incomingResponse.body.records[0].requestMode, "ADMIN_ALERT");
  assert.equal(incomingResponse.body.records[0].isAdminAlert, true);

  const requestId = db.state.requests[0].request_id;
  assert.equal(db.state.requests[0].request_mode, "ADMIN_ALERT");
  assert.ok(
    db.state.notifications.some(
      (item) =>
        item.recipient_branch_code === "000" &&
        item.request_id === requestId &&
        item.type === "REQUEST_SUBMITTED",
    ),
  );
});

test("invalid branch and product validation rejects bad input before persistence", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await login(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const sameBranch = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "stock-request:001:same-branch",
      groups: [{ sourceBranchCode: "001", lines: [{ productCode: "630010001", requestedQty: 1, unit: "BOX" }] }],
    });
  assert.equal(sameBranch.status, 400);

  const inactiveBranch = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "stock-request:001:inactive-branch",
      groups: [{ sourceBranchCode: "005", lines: [{ productCode: "630010001", requestedQty: 1, unit: "BOX" }] }],
    });
  assert.equal(inactiveBranch.status, 403);

  const unknownProduct = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "stock-request:001:unknown-product",
      groups: [{ sourceBranchCode: "000", lines: [{ productCode: "999999999", requestedQty: 1, unit: "BOX" }] }],
    });
  assert.equal(unknownProduct.status, 400);

  assert.equal(db.state.batches.length, 0);
  assert.equal(db.state.requests.length, 0);
  assert.equal(db.state.lines.length, 0);
});

test("csrf is enforced on submit", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await login(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const response = await agent.post("/api/stock-requests").send({
    idempotencyKey: "stock-request:001:csrf",
    groups: [{ sourceBranchCode: "000", lines: [{ productCode: "630010001", requestedQty: 1, unit: "BOX" }] }],
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "CSRF token invalid");
});

test("submit rolls back atomically when a later line insert fails", async () => {
  const { app, db } = createTestApp();
  db.setFailOnLineProductCode("630010003");

  const agent = request.agent(app);
  const csrfToken = await login(agent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const response = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "stock-request:001:rollback",
      groups: [
        {
          sourceBranchCode: "000",
          lines: [
            { productCode: "630010001", requestedQty: 1, unit: "BOX" },
            { productCode: "630010003", requestedQty: 1, unit: "BOX" },
          ],
        },
      ],
    });

  assert.equal(response.status, 500);
  assert.equal(db.state.batches.length, 0);
  assert.equal(db.state.requests.length, 0);
  assert.equal(db.state.lines.length, 0);
  assert.equal(db.state.events.length, 0);
  assert.deepEqual(db.state.txLog, ["BEGIN", "ROLLBACK"]);
});

test("requesting branch can list mine, read batch detail, and read batch events", async () => {
  const { app, db } = createTestApp();
  const requesterAgent = request.agent(app);
  const csrfToken = await login(requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const submitResponse = await submitSampleBatch(requesterAgent, csrfToken, {
    idempotencyKey: "stock-request:001:read-mine",
  });
  const batchPublicId = submitResponse.body.batchPublicId;

  // Live current-stock lookup for two different source branches within the
  // same batch — the requester should see each source branch's own live
  // number, not the frozen ask-time snapshot.
  db.state.currentStock.set("000|630010001", 9);
  db.state.currentStock.set("003|630010002", 40);

  const mineResponse = await requesterAgent.get("/api/stock-requests/mine");
  assert.equal(mineResponse.status, 200);
  assert.equal(mineResponse.body.records.length, 1);
  assert.equal(mineResponse.body.records[0].batchPublicId, batchPublicId);
  assert.equal(mineResponse.body.records[0].requestCount, 2);
  assert.equal(mineResponse.body.records[0].lineCount, 3);
  assert.deepEqual(mineResponse.body.records[0].sourceBranchCodes, ["000", "003"]);

  const detailResponse = await requesterAgent.get(`/api/stock-requests/${batchPublicId}`);
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.body.batch.publicId, batchPublicId);
  assert.equal(detailResponse.body.batch.requestingBranchCode, "001");
  assert.equal(detailResponse.body.batch.requests.length, 2);
  assert.equal(detailResponse.body.batch.requests[1].lines.length, 2);
  assert.equal(detailResponse.body.batch.requests[1].lines[0].response, null);
  assert.equal(detailResponse.body.batch.requests[0].sourceBranchCode, "000");
  assert.equal(detailResponse.body.batch.requests[0].lines[0].currentQty, 9);
  assert.equal(detailResponse.body.batch.requests[1].sourceBranchCode, "003");
  assert.equal(detailResponse.body.batch.requests[1].lines[0].currentQty, 40);
  assert.equal(
    detailResponse.body.batch.requests[1].lines[1].currentQty,
    null,
    "product with no branch_stock_snapshots row reports null, not the frozen snapshot",
  );

  const eventsResponse = await requesterAgent.get(`/api/stock-requests/${batchPublicId}/events`);
  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsResponse.body.batchPublicId, batchPublicId);
  assert.equal(eventsResponse.body.events.length, 6);
  assert.equal(eventsResponse.body.events[0].eventType, "REQUEST_BATCH_CREATED");
});

test("incoming branch can list and read only its own child requests", async () => {
  const { app } = createTestApp();
  const requesterAgent = request.agent(app);
  const requesterCsrf = await login(requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const submitResponse = await submitSampleBatch(requesterAgent, requesterCsrf, {
    idempotencyKey: "stock-request:001:incoming",
  });

  const source003Request = submitResponse.body.requests.find((item) => item.sourceBranchCode === "003");
  assert.ok(source003Request);

  const sourceAgent = request.agent(app);
  await login(sourceAgent, {
    username: "branch003@example.com",
    password: "branch-pass-003",
  });

  const incomingResponse = await sourceAgent.get("/api/stock-requests/incoming");
  assert.equal(incomingResponse.status, 200);
  assert.equal(incomingResponse.body.records.length, 1);
  assert.equal(incomingResponse.body.records[0].requestPublicId, source003Request.publicId);
  assert.equal(incomingResponse.body.records[0].requestingBranchCode, "001");
  assert.equal(incomingResponse.body.records[0].lineCount, 2);

  const detailResponse = await sourceAgent.get(`/api/stock-requests/incoming/${source003Request.publicId}`);
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.body.request.publicId, source003Request.publicId);
  assert.equal(detailResponse.body.request.batchPublicId, submitResponse.body.batchPublicId);
  assert.equal(detailResponse.body.request.lines.length, 2);
});

test("cross-branch detail access is forbidden while admin can still read", async () => {
  const { app } = createTestApp();
  const requesterAgent = request.agent(app);
  const requesterCsrf = await login(requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const submitResponse = await submitSampleBatch(requesterAgent, requesterCsrf, {
    idempotencyKey: "stock-request:001:forbidden",
  });
  const batchPublicId = submitResponse.body.batchPublicId;
  const source003Request = submitResponse.body.requests.find((item) => item.sourceBranchCode === "003");

  const sourceAgent = request.agent(app);
  await login(sourceAgent, {
    username: "branch003@example.com",
    password: "branch-pass-003",
  });

  const forbiddenBatch = await sourceAgent.get(`/api/stock-requests/${batchPublicId}`);
  assert.equal(forbiddenBatch.status, 403);

  const forbiddenIncoming = await requesterAgent.get(`/api/stock-requests/incoming/${source003Request.publicId}`);
  assert.equal(forbiddenIncoming.status, 403);

  const forbiddenEvents = await sourceAgent.get(`/api/stock-requests/${batchPublicId}/events`);
  assert.equal(forbiddenEvents.status, 403);

  const adminAgent = request.agent(app);
  await login(adminAgent, {
    username: "admin@example.com",
    password: "admin-pass-123",
  });

  const adminBatch = await adminAgent.get(`/api/stock-requests/${batchPublicId}`);
  assert.equal(adminBatch.status, 200);
  assert.equal(adminBatch.body.batch.publicId, batchPublicId);

  const adminIncoming = await adminAgent.get(`/api/stock-requests/incoming/${source003Request.publicId}`);
  assert.equal(adminIncoming.status, 200);
  assert.equal(adminIncoming.body.request.publicId, source003Request.publicId);
});

test("incoming request detail shows live current stock alongside the frozen ask-time snapshot", async () => {
  const { app, db } = createTestApp();
  const requesterAgent = request.agent(app);
  const requesterCsrf = await login(requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const submitResponse = await submitSampleBatch(requesterAgent, requesterCsrf, {
    idempotencyKey: "stock-request:001:live-stock",
  });
  const source003Request = submitResponse.body.requests.find((item) => item.sourceBranchCode === "003");

  // Stock at branch 003 moved on since the request was created (snapshotQty
  // was 6 for 630010002 at creation time) — simulate it now sitting at 40,
  // e.g. after a delivery, matching the "requested yesterday, picking today"
  // scenario that motivated this fix.
  db.state.currentStock.set("003|630010002", 40);

  const sourceAgent = request.agent(app);
  await login(sourceAgent, {
    username: "branch003@example.com",
    password: "branch-pass-003",
  });
  const detail = await sourceAgent.get(`/api/stock-requests/incoming/${source003Request.publicId}`);
  assert.equal(detail.status, 200);

  const line = detail.body.request.lines.find((item) => item.productCode === "630010002");
  assert.equal(line.snapshotQty, 6, "frozen ask-time value must be preserved for admin audit");
  assert.equal(line.currentQty, 40, "packing document should reflect live stock, not the stale snapshot");

  // A product with no branch_stock_snapshots row yet (not synced) reports null,
  // not zero or the stale snapshot — the frontend shows "-" for that.
  const unsyncedLine = detail.body.request.lines.find((item) => item.productCode === "630010003");
  assert.equal(unsyncedLine.currentQty, null);
});

async function setupIncomingForBranch003() {
  const { app, db } = createTestApp();
  const requesterAgent = request.agent(app);
  const requesterCsrf = await login(requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const submitResponse = await submitSampleBatch(requesterAgent, requesterCsrf, {
    idempotencyKey: "stock-request:001:response-flow",
  });
  const source003Request = submitResponse.body.requests.find((item) => item.sourceBranchCode === "003");

  const sourceAgent = request.agent(app);
  const sourceCsrf = await login(sourceAgent, {
    username: "branch003@example.com",
    password: "branch-pass-003",
  });

  const detail = await sourceAgent.get(`/api/stock-requests/incoming/${source003Request.publicId}`);
  assert.equal(detail.status, 200);

  return {
    app,
    db,
    sourceAgent,
    sourceCsrf,
    requesterAgent,
    requestPublicId: source003Request.publicId,
    batchPublicId: submitResponse.body.batchPublicId,
    lines: detail.body.request.lines,
    version: detail.body.request.version,
  };
}

test("source branch submits mixed line responses transactionally, sets statuses, events, and notifies requester", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      version: ctx.version,
      responses: [
        { lineId: lineA.lineId, responseStatus: "CUSTOM", approvedQty: 2, reasonCode: "LOW_STOCK" },
        { lineId: lineB.lineId, responseStatus: "REJECTED", note: "ไม่มีสินค้า" },
      ],
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, "RESPONDED");
  assert.equal(response.body.batchStatus, "PARTIALLY_RESPONDED");

  // line + request + batch state
  const updatedRequest = ctx.db.state.requests.find((row) => row.public_id === ctx.requestPublicId);
  assert.equal(updatedRequest.status, "RESPONDED");
  assert.equal(updatedRequest.responded_by, "branch003@example.com");
  assert.equal(Number(updatedRequest.version), ctx.version + 1);

  const submittedResponses = ctx.db.state.responses.filter((row) => row.is_submitted === true);
  assert.equal(submittedResponses.length, 2);
  assert.equal(ctx.db.state.lines.find((row) => row.line_id === lineA.lineId).status, "CUSTOM");
  assert.equal(ctx.db.state.lines.find((row) => row.line_id === lineB.lineId).status, "REJECTED");

  const batch = ctx.db.state.batches.find((row) => row.public_id === ctx.batchPublicId);
  assert.equal(batch.status, "PARTIALLY_RESPONDED");

  // notification to requesting branch 001
  const responseNotification = ctx.db.state.notifications.find(
    (item) => item.type === "RESPONSE_SUBMITTED",
  );
  assert.ok(responseNotification);
  assert.equal(responseNotification.recipient_branch_code, "001");
  const sourceNotification = ctx.db.state.notifications.find(
    (item) => item.type === "REQUEST_SUBMITTED" && item.recipient_branch_code === "003" && item.request_id === updatedRequest.request_id,
  );
  assert.ok(sourceNotification?.read_at);

  // events: LINE_CUSTOM, LINE_REJECTED, RESPONSE_SUBMITTED
  const eventTypes = ctx.db.state.events.map((row) => row.event_type);
  assert.ok(eventTypes.includes("LINE_CUSTOM"));
  assert.ok(eventTypes.includes("LINE_REJECTED"));
  assert.ok(eventTypes.includes("RESPONSE_SUBMITTED"));
});

test("rejected and zero-qty custom responses require a reason, and custom qty must be non-negative", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  const noReason = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      responses: [
        { lineId: lineA.lineId, responseStatus: "CUSTOM", approvedQty: 0 },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });
  assert.equal(noReason.status, 422);

  const badQty = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      responses: [
        { lineId: lineA.lineId, responseStatus: "CUSTOM", approvedQty: -1, reasonCode: "X" },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });
  assert.equal(badQty.status, 422);

  // nothing persisted
  assert.equal(ctx.db.state.responses.length, 0);
  assert.equal(ctx.db.state.requests.find((row) => row.public_id === ctx.requestPublicId).status, "SUBMITTED");
  assert.deepEqual(ctx.db.state.txLog.filter((entry) => entry === "ROLLBACK").length >= 1, true);
});

test("every line must be answered before submitting", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA] = ctx.lines;

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      responses: [{ lineId: lineA.lineId, responseStatus: "APPROVED_FULL" }],
    });

  assert.equal(response.status, 422);
  assert.equal(ctx.db.state.responses.length, 0);
});

test("a branch cannot respond to a request not addressed to it", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  // requester branch 001 is not the source branch for this child request
  const requesterCsrf = await login(ctx.requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", requesterCsrf)
    .send({
      responses: [
        { lineId: lineA.lineId, responseStatus: "APPROVED_FULL" },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });

  assert.equal(response.status, 403);
});

test("a request can only be responded to once (idempotent guard / 409)", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;
  const payload = {
    responses: [
      { lineId: lineA.lineId, responseStatus: "APPROVED_FULL" },
      { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
    ],
  };

  const first = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send(payload);
  const second = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send(payload);

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(ctx.db.state.responses.filter((row) => row.is_submitted === true).length, 2);
});

test("stale version is rejected with 409", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      version: ctx.version + 5,
      responses: [
        { lineId: lineA.lineId, responseStatus: "APPROVED_FULL" },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });

  assert.equal(response.status, 409);
});

test("csrf is enforced on submit-response", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .send({
      responses: [
        { lineId: lineA.lineId, responseStatus: "APPROVED_FULL" },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "CSRF token invalid");
});

test("a draft line response can be saved without finalizing the request", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA] = ctx.lines;

  const response = await ctx.sourceAgent
    .put(`/api/stock-requests/incoming/${ctx.requestPublicId}/lines/${lineA.lineId}/response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({ responseStatus: "APPROVED_FULL" });

  assert.equal(response.status, 200);
  assert.equal(response.body.response.isSubmitted, false);
  assert.equal(ctx.db.state.responses.length, 1);
  assert.equal(ctx.db.state.responses[0].is_submitted, false);
  // request stays open
  assert.equal(ctx.db.state.requests.find((row) => row.public_id === ctx.requestPublicId).status, "SUBMITTED");
});

test("requester sees an unread notification after a response, and can list and mark it read", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  // before any response: requester has no notifications
  const requesterCsrf = await login(ctx.requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const emptyCount = await ctx.requesterAgent.get("/api/notifications/unread-count");
  assert.equal(emptyCount.status, 200);
  assert.equal(emptyCount.body.unreadCount, 0);

  // source branch responds -> notification created for branch 001
  const submit = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      responses: [
        { lineId: lineA.lineId, responseStatus: "APPROVED_FULL" },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });
  assert.equal(submit.status, 200);

  const unread = await ctx.requesterAgent.get("/api/notifications/unread-count");
  assert.equal(unread.body.unreadCount, 1);

  const list = await ctx.requesterAgent.get("/api/notifications");
  assert.equal(list.status, 200);
  assert.equal(list.body.records.length, 1);
  const notification = list.body.records[0];
  assert.equal(notification.type, "RESPONSE_SUBMITTED");
  assert.equal(notification.readAt, null);

  const markRead = await ctx.requesterAgent
    .post(`/api/notifications/${notification.notificationId}/read`)
    .set("x-csrf-token", requesterCsrf);
  assert.equal(markRead.status, 200);
  assert.ok(markRead.body.notification.readAt);

  const afterRead = await ctx.requesterAgent.get("/api/notifications/unread-count");
  assert.equal(afterRead.body.unreadCount, 0);
});

test("a branch cannot see or mark another branch's notifications", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  const submit = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      responses: [
        { lineId: lineA.lineId, responseStatus: "APPROVED_FULL" },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });
  assert.equal(submit.status, 200);

  // Branch 003 keeps its original incoming-request notification as history, but
  // after submitting a response it is auto-marked read and no longer counts
  // toward the red badge. It must not see the response notification addressed
  // to requesting branch 001.
  const sourceList = await ctx.sourceAgent.get("/api/notifications");
  assert.equal(sourceList.status, 200);
  assert.equal(sourceList.body.records.length, 1);
  assert.equal(sourceList.body.records[0].type, "REQUEST_SUBMITTED");
  assert.ok(sourceList.body.records[0].readAt);

  const sourceCount = await ctx.sourceAgent.get("/api/notifications/unread-count");
  assert.equal(sourceCount.body.unreadCount, 0);

  // branch 003 trying to mark branch 001's notification -> 404
  const notificationId = ctx.db.state.notifications.find(
    (item) => item.type === "RESPONSE_SUBMITTED",
  ).notification_id;
  const forbidden = await ctx.sourceAgent
    .post(`/api/notifications/${notificationId}/read`)
    .set("x-csrf-token", ctx.sourceCsrf);
  assert.equal(forbidden.status, 404);
});

// Submit a single-source (003) batch and have branch 003 respond to it, leaving
// the child request in RESPONDED state ready for the requester to acknowledge.
async function setupRespondedSingleSource() {
  const { app, db } = createTestApp();
  const requesterAgent = request.agent(app);
  const requesterCsrf = await login(requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const submitResponse = await submitSampleBatch(requesterAgent, requesterCsrf, {
    idempotencyKey: "stock-request:001:ack-flow",
    groups: [
      {
        sourceBranchCode: "003",
        lines: [
          { productCode: "630010002", requestedQty: 3, unit: "TAB", snapshotQty: 6 },
          { productCode: "630010003", requestedQty: 1, unit: "BOX", snapshotQty: 2 },
        ],
      },
    ],
  });
  const childRequest = submitResponse.body.requests[0];

  const sourceAgent = request.agent(app);
  const sourceCsrf = await login(sourceAgent, {
    username: "branch003@example.com",
    password: "branch-pass-003",
  });
  const detail = await sourceAgent.get(`/api/stock-requests/incoming/${childRequest.publicId}`);
  const submitRes = await sourceAgent
    .post(`/api/stock-requests/incoming/${childRequest.publicId}/submit-response`)
    .set("x-csrf-token", sourceCsrf)
    .send({
      version: detail.body.request.version,
      responses: detail.body.request.lines.map((line) => ({
        lineId: line.lineId,
        responseStatus: "APPROVED_FULL",
      })),
    });
  assert.equal(submitRes.status, 200);

  // requester reads the current child version for optimistic acknowledge
  const batchDetail = await requesterAgent.get(`/api/stock-requests/${submitResponse.body.batchPublicId}`);
  const childVersion = batchDetail.body.batch.requests[0].version;

  return {
    app,
    db,
    requesterAgent,
    requesterCsrf,
    sourceAgent,
    sourceCsrf,
    requestPublicId: childRequest.publicId,
    batchPublicId: submitResponse.body.batchPublicId,
    childVersion,
  };
}

test("requester acknowledges a responded request, completing the batch and notifying the source", async () => {
  const ctx = await setupRespondedSingleSource();

  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/acknowledge`)
    .set("x-csrf-token", ctx.requesterCsrf)
    .send({ version: ctx.childVersion });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ACKNOWLEDGED");
  assert.equal(response.body.batchStatus, "ACKNOWLEDGED");

  const childRow = ctx.db.state.requests.find((row) => row.public_id === ctx.requestPublicId);
  assert.equal(childRow.status, "ACKNOWLEDGED");
  assert.equal(childRow.acknowledged_by, "branch001@example.com");

  const batchRow = ctx.db.state.batches.find((row) => row.public_id === ctx.batchPublicId);
  assert.equal(batchRow.status, "ACKNOWLEDGED");

  assert.ok(ctx.db.state.events.some((row) => row.event_type === "RESPONSE_ACKNOWLEDGED"));

  // source branch 003 is notified of the acknowledgment
  const ackNotification = ctx.db.state.notifications.find((row) => row.type === "RESPONSE_ACKNOWLEDGED");
  assert.ok(ackNotification);
  assert.equal(ackNotification.recipient_branch_code, "003");
});

test("only a responded request can be acknowledged", async () => {
  const ctx = await setupIncomingForBranch003();
  const requesterCsrf = await login(ctx.requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });

  // the child request is still SUBMITTED (no response yet)
  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/acknowledge`)
    .set("x-csrf-token", requesterCsrf);

  assert.equal(response.status, 409);
});

test("only the requesting branch may acknowledge, not the source branch", async () => {
  const ctx = await setupRespondedSingleSource();

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/acknowledge`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({ version: ctx.childVersion });

  assert.equal(response.status, 403);
});

test("acknowledge rejects a stale version with 409", async () => {
  const ctx = await setupRespondedSingleSource();

  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/acknowledge`)
    .set("x-csrf-token", ctx.requesterCsrf)
    .send({ version: ctx.childVersion + 5 });

  assert.equal(response.status, 409);
});

test("csrf is enforced on acknowledge", async () => {
  const ctx = await setupRespondedSingleSource();

  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/acknowledge`)
    .send({ version: ctx.childVersion });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "CSRF token invalid");
});

test("source branch generates a packing document and the requester can read it", async () => {
  const ctx = await setupRespondedSingleSource();

  const generate = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/document`)
    .set("x-csrf-token", ctx.sourceCsrf);

  assert.equal(generate.status, 200);
  assert.equal(generate.body.version, 1);
  assert.equal(generate.body.reprint, false);
  assert.equal(generate.body.document.sourceBranchCode, "003");
  assert.equal(generate.body.document.requestingBranchCode, "001");
  assert.equal(generate.body.document.lines.length, 2);
  assert.equal(generate.body.document.lines[0].responseStatus, "APPROVED_FULL");
  assert.equal(ctx.db.state.documents.length, 1);
  assert.ok(ctx.db.state.events.some((row) => row.event_type === "DOCUMENT_GENERATED"));

  // requesting branch can read the immutable document
  const read = await ctx.requesterAgent.get(`/api/stock-requests/${ctx.requestPublicId}/document`);
  assert.equal(read.status, 200);
  assert.equal(read.body.version, 1);
  assert.equal(read.body.document.requestPublicId, ctx.requestPublicId);
});

test("regenerating a document creates a new version (reprint) without mutating the first", async () => {
  const ctx = await setupRespondedSingleSource();

  const first = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/document`)
    .set("x-csrf-token", ctx.sourceCsrf);
  const second = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/document`)
    .set("x-csrf-token", ctx.sourceCsrf);

  assert.equal(first.body.version, 1);
  assert.equal(second.body.version, 2);
  assert.equal(second.body.reprint, true);
  assert.equal(ctx.db.state.documents.length, 2);
  assert.equal(ctx.db.state.documents[1].reprint_of, ctx.db.state.documents[0].document_id);
  assert.ok(ctx.db.state.events.some((row) => row.event_type === "DOCUMENT_REPRINTED"));

  // GET returns the latest version
  const read = await ctx.sourceAgent.get(`/api/stock-requests/${ctx.requestPublicId}/document`);
  assert.equal(read.body.version, 2);
});

test("a document cannot be generated before the request is responded to", async () => {
  const ctx = await setupIncomingForBranch003();

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/document`)
    .set("x-csrf-token", ctx.sourceCsrf);

  assert.equal(response.status, 409);
  assert.equal(ctx.db.state.documents.length, 0);
});

test("only the source branch may generate the document", async () => {
  const ctx = await setupRespondedSingleSource();

  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/document`)
    .set("x-csrf-token", ctx.requesterCsrf);

  assert.equal(response.status, 403);
});

test("reading a document returns 404 before one is generated", async () => {
  const ctx = await setupRespondedSingleSource();

  const response = await ctx.requesterAgent.get(`/api/stock-requests/${ctx.requestPublicId}/document`);
  assert.equal(response.status, 404);
});

test("csrf is enforced on document generation", async () => {
  const ctx = await setupRespondedSingleSource();

  const response = await ctx.sourceAgent.post(
    `/api/stock-requests/incoming/${ctx.requestPublicId}/document`,
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "CSRF token invalid");
});

test("csrf is enforced on marking a notification read", async () => {
  const ctx = await setupIncomingForBranch003();
  const [lineA, lineB] = ctx.lines;

  await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/submit-response`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      responses: [
        { lineId: lineA.lineId, responseStatus: "APPROVED_FULL" },
        { lineId: lineB.lineId, responseStatus: "APPROVED_FULL" },
      ],
    });

  await login(ctx.requesterAgent, {
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  const notificationId = ctx.db.state.notifications[0].notification_id;
  const response = await ctx.requesterAgent.post(`/api/notifications/${notificationId}/read`);
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "CSRF token invalid");
});

// Bring a single-source (003) request all the way to ACKNOWLEDGED for WP-13 tests.
async function setupAcknowledgedSingleSource() {
  const ctx = await setupRespondedSingleSource();
  const ack = await ctx.requesterAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/acknowledge`)
    .set("x-csrf-token", ctx.requesterCsrf)
    .send({ version: ctx.childVersion });
  assert.equal(ack.status, 200);

  const batchDetail = await ctx.requesterAgent.get(`/api/stock-requests/${ctx.batchPublicId}`);
  const child = batchDetail.body.batch.requests[0];
  return { ...ctx, childVersion: child.version, lines: child.lines };
}

test("source dispatches, requester receives, and fulfillment reports the differences", async () => {
  const ctx = await setupAcknowledgedSingleSource();
  const [lineA, lineB] = ctx.lines; // approved == requested (3 and 1)

  // ship short on line A to create a difference
  const dispatch = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/dispatch`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      version: ctx.childVersion,
      lines: [
        { lineId: lineA.lineId, dispatchedQty: 2 },
        { lineId: lineB.lineId, dispatchedQty: 1 },
      ],
    });
  assert.equal(dispatch.status, 200);
  assert.equal(dispatch.body.status, "DISPATCHED");
  assert.equal(ctx.db.state.shipments.length, 1);
  assert.equal(ctx.db.state.shipmentLines.length, 2);
  assert.ok(ctx.db.state.notifications.some((row) => row.type === "REQUEST_DISPATCHED" && row.recipient_branch_code === "001"));

  // fulfillment shows the short-ship difference on line A
  const midFulfillment = await ctx.requesterAgent.get(`/api/stock-requests/${ctx.requestPublicId}/fulfillment`);
  assert.equal(midFulfillment.status, 200);
  const lineAReport = midFulfillment.body.fulfillment.lines.find((row) => row.lineId === lineA.lineId);
  assert.equal(lineAReport.approvedQty, 3);
  assert.equal(lineAReport.dispatchedQty, 2);
  assert.equal(lineAReport.dispatchVariance, -1);
  assert.equal(lineAReport.hasDifference, true);

  // requester receives what arrived
  const receive = await ctx.requesterAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/receive`)
    .set("x-csrf-token", ctx.requesterCsrf)
    .send({
      version: dispatch.body.version,
      lines: [
        { lineId: lineA.lineId, receivedQty: 2 },
        { lineId: lineB.lineId, receivedQty: 1 },
      ],
    });
  assert.equal(receive.status, 200);
  assert.equal(receive.body.status, "RECEIVED");
  assert.equal(receive.body.batchStatus, "COMPLETED");
  assert.equal(ctx.db.state.receipts.length, 1);
  assert.ok(ctx.db.state.notifications.some((row) => row.type === "REQUEST_RECEIVED" && row.recipient_branch_code === "003"));

  const finalFulfillment = await ctx.sourceAgent.get(`/api/stock-requests/${ctx.requestPublicId}/fulfillment`);
  const finalLineA = finalFulfillment.body.fulfillment.lines.find((row) => row.lineId === lineA.lineId);
  assert.equal(finalLineA.receivedQty, 2);
  assert.equal(finalLineA.receiveVariance, 0);

  assert.ok(ctx.db.state.events.some((row) => row.event_type === "REQUEST_DISPATCHED"));
  assert.ok(ctx.db.state.events.some((row) => row.event_type === "REQUEST_RECEIVED"));
});

test("a request cannot be dispatched before it is acknowledged", async () => {
  const ctx = await setupRespondedSingleSource();
  const batchDetail = await ctx.requesterAgent.get(`/api/stock-requests/${ctx.batchPublicId}`);
  const lines = batchDetail.body.batch.requests[0].lines;

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/dispatch`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({ lines: lines.map((line) => ({ lineId: line.lineId, dispatchedQty: 1 })) });

  assert.equal(response.status, 409);
  assert.equal(ctx.db.state.shipments.length, 0);
});

test("only the source branch may dispatch", async () => {
  const ctx = await setupAcknowledgedSingleSource();
  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/dispatch`)
    .set("x-csrf-token", ctx.requesterCsrf)
    .send({ lines: ctx.lines.map((line) => ({ lineId: line.lineId, dispatchedQty: 1 })) });
  assert.equal(response.status, 403);
});

test("a request cannot be received before it is dispatched", async () => {
  const ctx = await setupAcknowledgedSingleSource();
  const response = await ctx.requesterAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/receive`)
    .set("x-csrf-token", ctx.requesterCsrf)
    .send({ lines: ctx.lines.map((line) => ({ lineId: line.lineId, receivedQty: 1 })) });
  assert.equal(response.status, 409);
});

test("only the requesting branch may receive", async () => {
  const ctx = await setupAcknowledgedSingleSource();
  const dispatch = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/dispatch`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      version: ctx.childVersion,
      lines: ctx.lines.map((line) => ({ lineId: line.lineId, dispatchedQty: 1 })),
    });
  assert.equal(dispatch.status, 200);

  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/${ctx.requestPublicId}/receive`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({ lines: ctx.lines.map((line) => ({ lineId: line.lineId, receivedQty: 1 })) });
  assert.equal(response.status, 403);
});

test("dispatch rejects a stale version with 409", async () => {
  const ctx = await setupAcknowledgedSingleSource();
  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/dispatch`)
    .set("x-csrf-token", ctx.sourceCsrf)
    .send({
      version: ctx.childVersion + 9,
      lines: ctx.lines.map((line) => ({ lineId: line.lineId, dispatchedQty: 1 })),
    });
  assert.equal(response.status, 409);
});

test("csrf is enforced on dispatch", async () => {
  const ctx = await setupAcknowledgedSingleSource();
  const response = await ctx.sourceAgent
    .post(`/api/stock-requests/incoming/${ctx.requestPublicId}/dispatch`)
    .send({ lines: ctx.lines.map((line) => ({ lineId: line.lineId, dispatchedQty: 1 })) });
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "CSRF token invalid");
});
