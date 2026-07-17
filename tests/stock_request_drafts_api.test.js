"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const { createApp } = require("../apps/admin-api/src/server");
const {
  formatDraftPublicId,
  getOwnerUsername,
} = require("../apps/admin-api/src/services/stockRequestDrafts");

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

test("formatDraftPublicId formats date and IDs correctly", () => {
  assert.equal(
    formatDraftPublicId(new Date("2026-06-24T10:00:00.000Z"), "001", 1),
    "SRQD-20260624-001-000001",
  );
});

test("formatDraftPublicId handles invalid date", () => {
  assert.equal(
    formatDraftPublicId(new Date("invalid"), "003", 42),
    "SRQD-00000000-003-000042",
  );
});

test("OnlineMarketingstaff shares the staff000 cart owner", () => {
  assert.equal(getOwnerUsername({ userId: "OnlineMarketingstaff" }), "staff000");
  assert.equal(getOwnerUsername({ userId: "staff000" }), "staff000");
  assert.equal(getOwnerUsername({ userId: "staff001" }), "staff001");
});

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

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
    ]),
    products: new Map([
      ["630010001", { product_code: "630010001", product_name_thai: "เซทิริซีน", product_name_eng: "Cetirizine", barcode: "885000000001", default_unit: "BOX" }],
    ]),
    // stock requests (pass-through for existing submit path)
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
    // draft tables
    drafts: [],
    draftLines: [],
    draftLineRecommendations: [],
    lineRecommendations: [],
    nextDraftId: 1,
    nextDraftLineId: 1,
    nextDraftLineRecommendationId: 1,
    nextLineRecommendationId: 1,
    failOnLineProductCode: null,
  };
}

function cloneState(state) {
  return {
    auditActions: [...state.auditActions],
    branches: new Map([...state.branches.entries()].map(([k, v]) => [k, { ...v }])),
    products: new Map([...state.products.entries()].map(([k, v]) => [k, { ...v }])),
    batches: state.batches.map((r) => ({ ...r })),
    requests: state.requests.map((r) => ({ ...r })),
    lines: state.lines.map((r) => ({ ...r })),
    responses: state.responses.map((r) => ({ ...r })),
    notifications: state.notifications.map((r) => ({ ...r })),
    documents: state.documents.map((r) => ({ ...r })),
    shipments: state.shipments.map((r) => ({ ...r })),
    shipmentLines: state.shipmentLines.map((r) => ({ ...r })),
    receipts: state.receipts.map((r) => ({ ...r })),
    receiptLines: state.receiptLines.map((r) => ({ ...r })),
    events: state.events.map((r) => ({ ...r })),
    txLog: [...state.txLog],
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
    drafts: state.drafts.map((r) => ({ ...r })),
    draftLines: state.draftLines.map((r) => ({ ...r })),
    draftLineRecommendations: state.draftLineRecommendations.map((r) => ({ ...r })),
    lineRecommendations: state.lineRecommendations.map((r) => ({ ...r })),
    nextDraftId: state.nextDraftId,
    nextDraftLineId: state.nextDraftLineId,
    nextDraftLineRecommendationId: state.nextDraftLineRecommendationId,
    nextLineRecommendationId: state.nextLineRecommendationId,
    failOnLineProductCode: state.failOnLineProductCode,
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function createDraftMockDb() {
  const container = { state: createInitialState(), txState: null };

  function activeState() {
    return container.txState || container.state;
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
      }
      return { rowCount: 0, rows: [] };
    }
    if (normalized === "rollback") {
      if (container.txState) {
        container.state.txLog.push("ROLLBACK");
        container.txState = null;
      }
      return { rowCount: 0, rows: [] };
    }

    const state = activeState();

    // --- audit ---
    if (normalized.startsWith("insert into public.audit_logs")) {
      state.auditActions.push(params[2]);
      return { rowCount: 1, rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }] };
    }

    // --- branches ---
    if (normalized.includes("select branch_code, branch_name, is_active, is_hq") && normalized.includes("from core.branches") && normalized.includes("where branch_code = $1")) {
      const b = state.branches.get(String(params[0] || "")) || null;
      return { rowCount: b ? 1 : 0, rows: b ? [b] : [] };
    }
    if (normalized.includes("select branch_code, branch_name, is_active, is_hq") && normalized.includes("from core.branches") && normalized.includes("where branch_code = any($1::text[])")) {
      const codes = Array.isArray(params[0]) ? params[0] : [];
      const rows = codes.map((c) => state.branches.get(c)).filter(Boolean);
      return { rowCount: rows.length, rows };
    }

    // --- products ---
    if (normalized.includes("from unnest($1::text[]) with ordinality as codes(product_code, ord)") && normalized.includes("where s.company_code is not null")) {
      const codes = Array.isArray(params[0]) ? params[0] : [];
      const rows = codes.map((c) => state.products.get(c)).filter(Boolean);
      return { rowCount: rows.length, rows };
    }

    // ----------------------------------------------------------------
    // Draft queries
    // ----------------------------------------------------------------

    // SELECT active draft (no FOR UPDATE)
    if (
      normalized.includes("from ordering.stock_request_drafts") &&
      normalized.includes("where owner_username = $1 and branch_code = $2 and status = 'active'") &&
      !normalized.includes("for update")
    ) {
      const row = state.drafts.find((d) => d.owner_username === params[0] && d.branch_code === params[1] && d.status === "ACTIVE") || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    // SELECT active draft FOR UPDATE
    if (
      normalized.includes("from ordering.stock_request_drafts") &&
      normalized.includes("where owner_username = $1 and branch_code = $2 and status = 'active'") &&
      normalized.includes("for update")
    ) {
      const row = state.drafts.find((d) => d.owner_username === params[0] && d.branch_code === params[1] && d.status === "ACTIVE") || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    // SELECT draft by public_id FOR UPDATE
    if (
      normalized.includes("from ordering.stock_request_drafts") &&
      normalized.includes("where draft_public_id = $1") &&
      normalized.includes("for update")
    ) {
      const row = state.drafts.find((d) => d.draft_public_id === params[0]) || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    // SELECT draft by id
    if (
      normalized.includes("from ordering.stock_request_drafts") &&
      normalized.includes("where draft_id = $1")
    ) {
      const row = state.drafts.find((d) => d.draft_id === Number(params[0])) || null;
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }

    // INSERT draft: params[$1=tempPublicId, $2=owner_user_id, $3=owner_username, $4=branch_code, $5=note]
    if (normalized.startsWith("insert into ordering.stock_request_drafts")) {
      const draftId = state.nextDraftId++;
      const now = new Date().toISOString();
      const row = {
        draft_id: draftId,
        draft_public_id: params[0], // temp ID initially; overwritten by UPDATE below
        owner_user_id: params[1] || null,
        owner_username: params[2],
        branch_code: params[3],
        note: params[4],
        status: "ACTIVE",
        version: 1,
        submitted_batch_public_id: null,
        created_at: now,
        updated_at: now,
        submitted_at: null,
      };
      state.drafts.push(row);
      return { rowCount: 1, rows: [{ draft_id: draftId, created_at: now }] };
    }

    // UPDATE draft_public_id (replaces the temp ID with the real formatted ID)
    if (normalized.startsWith("update ordering.stock_request_drafts set draft_public_id = $2 where draft_id = $1")) {
      const d = state.drafts.find((r) => r.draft_id === Number(params[0]));
      if (d) d.draft_public_id = params[1];
      return { rowCount: d ? 1 : 0, rows: [] };
    }

    // UPDATE draft note + version
    if (normalized.startsWith("update ordering.stock_request_drafts set note = $2, version = $3, updated_at = now() where draft_id = $1")) {
      const d = state.drafts.find((r) => r.draft_id === Number(params[0]));
      if (d) {
        d.note = params[1];
        d.version = Number(params[2]);
        d.updated_at = new Date().toISOString();
      }
      return { rowCount: d ? 1 : 0, rows: [] };
    }

    // UPDATE draft status = DISCARDED
    if (normalized.startsWith("update ordering.stock_request_drafts set status = 'discarded'")) {
      let rowCount = 0;
      for (const d of state.drafts) {
        if (d.owner_username === params[0] && d.branch_code === params[1] && d.status === "ACTIVE") {
          d.status = "DISCARDED";
          d.updated_at = new Date().toISOString();
          rowCount++;
        }
      }
      return { rowCount, rows: [] };
    }

    // UPDATE draft status = SUBMITTED
    if (normalized.startsWith("update ordering.stock_request_drafts set status = 'submitted'")) {
      const d = state.drafts.find((r) => r.draft_id === Number(params[0]));
      if (d) {
        d.status = "SUBMITTED";
        d.submitted_batch_public_id = params[1];
        d.submitted_at = new Date().toISOString();
        d.updated_at = new Date().toISOString();
      }
      return { rowCount: d ? 1 : 0, rows: [] };
    }

    // SELECT draft lines
    if (normalized.includes("from ordering.stock_request_draft_lines") && normalized.includes("draft_id = $1")) {
      const rows = state.draftLines
        .filter((r) => r.draft_id === Number(params[0]))
        .sort((a, b) => a.draft_line_id - b.draft_line_id);
      return {
        rowCount: rows.length,
        rows: rows.map((row) => {
          const rec = state.draftLineRecommendations.find((item) => item.draft_line_id === row.draft_line_id) || {};
          return {
            ...row,
            recommendation_target_days: rec.target_days ?? null,
            recommendation_incoming_allocation_mode: rec.incoming_allocation_mode ?? null,
            recommendation_incoming_source_mode: rec.incoming_source_mode ?? null,
            recommendation_generated_at: rec.recommendation_generated_at ?? null,
            recommendation_basis_date_from: rec.recommendation_basis_date_from ?? null,
            recommendation_basis_date_to: rec.recommendation_basis_date_to ?? null,
            recommendation_current_stock: rec.current_stock ?? null,
            recommendation_unit_cost_avg: rec.unit_cost_avg ?? null,
            recommendation_inventory_value: rec.inventory_value ?? null,
            recommendation_sold_qty_30d: rec.sold_qty_30d ?? null,
            recommendation_sold_qty_90d: rec.sold_qty_90d ?? null,
            recommendation_adu_30: rec.adu_30 ?? null,
            recommendation_adu_90: rec.adu_90 ?? null,
            recommendation_adjusted_adu: rec.adjusted_adu ?? null,
            recommendation_incoming_po_qty_total: rec.incoming_po_qty_total ?? null,
            recommendation_incoming_po_allocation_qty: rec.incoming_po_allocation_qty ?? null,
            recommendation_effective_stock: rec.effective_stock ?? null,
            recommendation_current_days_cover: rec.current_days_cover ?? null,
            recommendation_effective_days_cover: rec.effective_days_cover ?? null,
            recommendation_target_qty: rec.target_qty ?? null,
            recommendation_surplus_qty: rec.surplus_qty ?? null,
            recommendation_shortage_qty: rec.shortage_qty ?? null,
            recommended_action: rec.recommended_action ?? null,
            recommended_transfer_qty: rec.recommended_transfer_qty ?? null,
            recommended_purchase_qty: rec.recommended_purchase_qty ?? null,
            primary_suggested_donor_branch_code: rec.primary_suggested_donor_branch_code ?? null,
            recommendation_reason: rec.recommendation_reason ?? null,
            recommendation_flags: rec.recommendation_flags ?? null,
            donor_snapshot: rec.donor_snapshot ?? null,
            recommendation_snapshot: rec.recommendation_snapshot ?? null,
          };
        }),
      };
    }

    // INSERT draft line
    if (normalized.startsWith("insert into ordering.stock_request_draft_lines")) {
      const row = {
        draft_line_id: state.nextDraftLineId++,
        draft_id: Number(params[0]),
        line_key: params[1],
        source_branch_code: params[2],
        request_mode: params[3],
        product_code: params[4],
        unit: params[5],
        requested_qty: Number(params[6]),
        snapshot_qty: params[7] != null ? Number(params[7]) : null,
        snapshot_synced_at: params[8] || null,
        line_note: params[9] || "",
        product_name_th: params[10] || "",
        product_name_en: params[11] || "",
        barcode: params[12] || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.draftLines.push(row);
      return { rowCount: 1, rows: [{ draft_line_id: row.draft_line_id }] };
    }

    if (normalized.startsWith("insert into ordering.stock_request_draft_line_recommendations")) {
      state.draftLineRecommendations.push({
        draft_line_recommendation_id: state.nextDraftLineRecommendationId++,
        draft_line_id: Number(params[0]),
        target_days: Number(params[1]),
        incoming_allocation_mode: params[2],
        incoming_source_mode: params[3],
        recommendation_generated_at: params[4],
        recommendation_basis_date_from: params[5],
        recommendation_basis_date_to: params[6],
        product_code: params[7],
        current_stock: params[8] == null ? null : Number(params[8]),
        unit_cost_avg: params[9] == null ? null : Number(params[9]),
        inventory_value: params[10] == null ? null : Number(params[10]),
        sold_qty_30d: params[11] == null ? null : Number(params[11]),
        sold_qty_90d: params[12] == null ? null : Number(params[12]),
        adu_30: params[13] == null ? null : Number(params[13]),
        adu_90: params[14] == null ? null : Number(params[14]),
        adjusted_adu: params[15] == null ? null : Number(params[15]),
        incoming_po_qty_total: params[16] == null ? null : Number(params[16]),
        incoming_po_allocation_qty: params[17] == null ? null : Number(params[17]),
        effective_stock: params[18] == null ? null : Number(params[18]),
        current_days_cover: params[19] == null ? null : Number(params[19]),
        effective_days_cover: params[20] == null ? null : Number(params[20]),
        target_qty: params[21] == null ? null : Number(params[21]),
        surplus_qty: Number(params[22] || 0),
        shortage_qty: Number(params[23] || 0),
        recommended_action: params[24],
        recommended_transfer_qty: Number(params[25] || 0),
        recommended_purchase_qty: Number(params[26] || 0),
        primary_suggested_donor_branch_code: params[27] || null,
        recommendation_reason: params[28] || null,
        recommendation_flags: params[29] ? JSON.parse(params[29]) : [],
        donor_snapshot: params[30] ? JSON.parse(params[30]) : [],
        recommendation_snapshot: params[31] ? JSON.parse(params[31]) : {},
      });
      return { rowCount: 1, rows: [] };
    }

    // DELETE draft lines
    if (normalized.startsWith("delete from ordering.stock_request_draft_lines where draft_id = $1")) {
      const before = state.draftLines.length;
      const removedLineIds = state.draftLines.filter((r) => r.draft_id === Number(params[0])).map((r) => r.draft_line_id);
      state.draftLines = state.draftLines.filter((r) => r.draft_id !== Number(params[0]));
      state.draftLineRecommendations = state.draftLineRecommendations.filter((r) => !removedLineIds.includes(r.draft_line_id));
      return { rowCount: before - state.draftLines.length, rows: [] };
    }

    // ----------------------------------------------------------------
    // Stock request batch queries (needed for submit-with-draft path)
    // ----------------------------------------------------------------
    if (normalized.includes("select batch_id, public_id, requesting_branch_code, created_by") && normalized.includes("from ordering.stock_request_batches") && normalized.includes("where idempotency_key = $1")) {
      const b = state.batches.find((r) => r.idempotency_key === params[0]) || null;
      return { rowCount: b ? 1 : 0, rows: b ? [b] : [] };
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
        submitted_at: "2026-06-24T12:00:00.000Z",
        created_at: "2026-06-24T12:00:00.000Z",
        updated_at: "2026-06-24T12:00:00.000Z",
      };
      state.batches.push(row);
      return { rowCount: 1, rows: [{ batch_id: row.batch_id, submitted_at: row.submitted_at }] };
    }
    if (normalized.startsWith("update ordering.stock_request_batches set public_id = $2")) {
      const b = state.batches.find((r) => r.batch_id === Number(params[0]));
      if (b) b.public_id = params[1];
      return { rowCount: b ? 1 : 0, rows: [] };
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
        version: 1,
        created_at: "2026-06-24T12:00:00.000Z",
        updated_at: "2026-06-24T12:00:00.000Z",
      };
      state.requests.push(row);
      return { rowCount: 1, rows: [{ request_id: row.request_id }] };
    }
    if (normalized.startsWith("insert into ordering.stock_request_lines")) {
      const row = { line_id: state.nextLineId++, request_id: Number(params[0]), product_code: params[1] };
      state.lines.push(row);
      return { rowCount: 1, rows: [{ line_id: row.line_id }] };
    }
    if (normalized.startsWith("insert into ordering.stock_request_line_recommendations")) {
      state.lineRecommendations.push({
        request_line_recommendation_id: state.nextLineRecommendationId++,
        line_id: Number(params[0]),
        product_code: params[7],
        request_matches_recommendation: Boolean(params[27]),
      });
      return { rowCount: 1, rows: [] };
    }
    if (normalized.startsWith("insert into ordering.stock_request_events")) {
      state.events.push({ event_id: state.nextEventId++ });
      return { rowCount: 1, rows: [] };
    }
    if (normalized.startsWith("insert into ordering.stock_request_notifications")) {
      state.notifications.push({ notification_id: state.nextNotificationId++ });
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unhandled mock query: ${normalized}`);
  }

  return {
    get state() { return container.state; },
    connect() {
      return { query, async release() {} };
    },
    query,
    async end() {},
  };
}

function createTestApp() {
  const db = createDraftMockDb();
  const { app } = createApp({
    config: buildConfig(),
    db,
    runImporter: async () => ({}),
    runExcelPriceImporter: async () => ({}),
    runRuleApplication: async () => ({}),
  });
  return { app, db };
}

async function loginAsBranch001(agent) {
  const res = await agent.post("/admin/auth/login").send({
    username: "branch001@example.com",
    password: "branch-pass-001",
  });
  assert.equal(res.status, 200);
  return res.body.csrf_token;
}

async function loginAsBranch003(agent) {
  const res = await agent.post("/admin/auth/login").send({
    username: "branch003@example.com",
    password: "branch-pass-003",
  });
  assert.equal(res.status, 200);
  return res.body.csrf_token;
}

function sampleLine(overrides = {}) {
  return {
    lineKey: "630010001::000::BOX::STANDARD",
    sourceBranchCode: "000",
    requestMode: "STANDARD",
    productCode: "630010001",
    productNameThai: "เซทิริซีน",
    productNameEng: "Cetirizine",
    barcode: "885000000001",
    unit: "BOX",
    requestedQty: 5,
    snapshotQty: 12,
    snapshotSyncedAt: "2026-06-24T08:00:00.000Z",
    lineNote: "",
    ...overrides,
  };
}

function sampleRecommendation(overrides = {}) {
  return {
    targetDays: 90,
    incomingAllocationMode: "EQUAL_SPLIT",
    incomingSourceMode: "LIVE_RECEIPTS",
    recommendationGeneratedAt: "2026-06-24T08:05:00.000Z",
    recommendationBasisDateFrom: "2026-03-26",
    recommendationBasisDateTo: "2026-06-23",
    currentStock: 12,
    unitCostAvg: 45.5,
    inventoryValue: 546,
    soldQty30d: 9,
    soldQty90d: 24,
    adu30: 0.3,
    adu90: 0.266667,
    adjustedAdu: 0.266667,
    incomingPoQtyTotal: 8,
    incomingPoAllocationQty: 2,
    effectiveStock: 14,
    currentDaysCover: 45,
    effectiveDaysCover: 52.5,
    targetQty: 24,
    surplusQty: 0,
    shortageQty: 10,
    recommendedAction: "TRANSFER",
    recommendedTransferQty: 10,
    recommendedPurchaseQty: 0,
    recommendedRequestQty: 10,
    primarySuggestedDonorBranchCode: "000",
    recommendationReason: "Low cover vs 90-day target",
    recommendationFlags: ["LOW_COVER"],
    donorSnapshot: [{ branchCode: "000", availableQty: 20 }],
    recommendationSnapshot: { urgencyScore: 82 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// API tests
// ---------------------------------------------------------------------------

test("GET /api/stock-request-draft/me returns empty draft when none exists", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  const res = await agent
    .get("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.draft, "draft key present");
  assert.equal(res.body.draft.draftPublicId, null);
  assert.equal(res.body.draft.version, 0);
  assert.deepEqual(res.body.draft.lines, []);
  assert.equal(res.body.draft.branchCode, "001");
});

test("first PUT /api/stock-request-draft/me creates an active draft", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  const res = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "test note", lines: [sampleLine()] });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const draft = res.body.draft;
  assert.ok(draft.draftPublicId, "draftPublicId assigned");
  assert.ok(draft.draftPublicId.startsWith("SRQD-"), "public ID prefix correct");
  assert.equal(draft.version, 1);
  assert.equal(draft.note, "test note");
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].productCode, "630010001");

  // Verify stored in mock DB
  assert.equal(db.state.drafts.length, 1);
  assert.equal(db.state.drafts[0].status, "ACTIVE");
  assert.equal(db.state.draftLines.length, 1);
});

test("second PUT with correct version updates draft and increments version", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  // Create draft
  const createRes = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "v1", lines: [sampleLine()] });
  assert.equal(createRes.status, 200);
  const firstVersion = createRes.body.draft.version;
  assert.ok(firstVersion >= 1, "first version is at least 1");

  // Update draft with the version we just received
  const res = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: firstVersion, note: "v2", lines: [sampleLine(), sampleLine({ lineKey: "630010001::000::TAB::STANDARD", unit: "TAB" })] });

  assert.equal(res.status, 200);
  const draft = res.body.draft;
  assert.equal(draft.version, firstVersion + 1, "version increments by 1");
  assert.equal(draft.note, "v2");
  assert.equal(draft.lines.length, 2);
});

test("draft save/load preserves recommendation sidecar metadata", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  const save = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({
      version: 0,
      note: "with recommendation",
      lines: [sampleLine({ recommendation: sampleRecommendation() })],
    });

  assert.equal(save.status, 200);
  assert.equal(db.state.draftLineRecommendations.length, 1);
  assert.equal(db.state.draftLineRecommendations[0].recommended_action, "TRANSFER");

  const load = await agent
    .get("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken);

  assert.equal(load.status, 200);
  assert.equal(load.body.draft.lines[0].recommendation.recommendedAction, "TRANSFER");
  assert.equal(load.body.draft.lines[0].recommendation.recommendedTransferQty, 10);
  assert.equal(load.body.draft.lines[0].recommendation.primarySuggestedDonorBranchCode, "000");
});

test("stale PUT returns 409 with DRAFT_VERSION_CONFLICT", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "first", lines: [sampleLine()] });

  // Attempt update with stale version (still 0 instead of 1)
  const res = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "stale", lines: [sampleLine()] });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, "DRAFT_VERSION_CONFLICT");
});

test("DELETE /api/stock-request-draft/me discards the active draft", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "", lines: [sampleLine()] });

  const res = await agent
    .delete("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken);

  assert.equal(res.status, 204);
  assert.equal(db.state.drafts[0].status, "DISCARDED");
});

test("GET after DELETE returns empty draft", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "", lines: [sampleLine()] });

  await agent.delete("/api/stock-request-draft/me").set("x-csrf-token", csrfToken);

  const res = await agent.get("/api/stock-request-draft/me");
  assert.equal(res.status, 200);
  assert.equal(res.body.draft.draftPublicId, null);
  assert.equal(res.body.draft.version, 0);
  assert.deepEqual(res.body.draft.lines, []);
});

test("same user on different branches gets separate drafts", async () => {
  // branch003 user has branch_code 003
  const { app, db } = createTestApp();

  const agent001 = request.agent(app);
  const csrf001 = await loginAsBranch001(agent001);

  const agent003 = request.agent(app);
  const csrf003 = await loginAsBranch003(agent003);

  await agent001
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrf001)
    .send({ version: 0, note: "branch 001 draft", lines: [sampleLine()] });

  await agent003
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrf003)
    .send({ version: 0, note: "branch 003 draft", lines: [] });

  assert.equal(db.state.drafts.length, 2);
  const draft001 = db.state.drafts.find((d) => d.branch_code === "001");
  const draft003 = db.state.drafts.find((d) => d.branch_code === "003");
  assert.ok(draft001, "draft for 001 exists");
  assert.ok(draft003, "draft for 003 exists");
  assert.equal(draft001.note, "branch 001 draft");
  assert.equal(draft003.note, "branch 003 draft");
});

test("POST /api/stock-requests with draftPublicId marks draft SUBMITTED in same transaction", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  // Create draft
  const putRes = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "submit test", lines: [sampleLine()] });
  assert.equal(putRes.status, 200);
  const { draftPublicId, version: draftVersion } = putRes.body.draft;

  // Submit with draft binding
  const submitRes = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "srq-draft-submit-test",
      draftPublicId,
      draftVersion,
      note: "submit test",
      groups: [{
        sourceBranchCode: "000",
        lines: [{
          productCode: "630010001",
          requestedQty: 5,
          unit: "BOX",
          snapshotQty: 12,
          snapshotSyncedAt: "2026-06-24T08:00:00.000Z",
        }],
      }],
    });

  assert.equal(submitRes.status, 201);
  assert.ok(submitRes.body.batchPublicId);

  // Draft must be SUBMITTED
  const draft = db.state.drafts[0];
  assert.equal(draft.status, "SUBMITTED");
  assert.ok(draft.submitted_batch_public_id, "submitted_batch_public_id set");
  assert.ok(draft.submitted_at, "submitted_at set");
});

test("GET /api/stock-request-draft/me returns empty after successful submit", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  const putRes = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "", lines: [sampleLine()] });
  const { draftPublicId, version: draftVersion } = putRes.body.draft;

  await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "srq-get-after-submit",
      draftPublicId,
      draftVersion,
      groups: [{ sourceBranchCode: "000", lines: [{ productCode: "630010001", requestedQty: 5, unit: "BOX" }] }],
    });

  const res = await agent.get("/api/stock-request-draft/me");
  assert.equal(res.status, 200);
  assert.equal(res.body.draft.draftPublicId, null);
  assert.deepEqual(res.body.draft.lines, []);
});

test("stale draftVersion on submit returns 409", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  const putRes = await agent
    .put("/api/stock-request-draft/me")
    .set("x-csrf-token", csrfToken)
    .send({ version: 0, note: "", lines: [sampleLine()] });
  const { draftPublicId } = putRes.body.draft;

  // Send wrong version (0 instead of 1)
  const res = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "srq-stale-draft-version",
      draftPublicId,
      draftVersion: 0,
      groups: [{ sourceBranchCode: "000", lines: [{ productCode: "630010001", requestedQty: 5, unit: "BOX" }] }],
    });

  assert.equal(res.status, 409);
});

test("submit without draftPublicId still works (existing flow unchanged)", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAsBranch001(agent);

  const res = await agent
    .post("/api/stock-requests")
    .set("x-csrf-token", csrfToken)
    .send({
      idempotencyKey: "srq-no-draft",
      groups: [{ sourceBranchCode: "000", lines: [{ productCode: "630010001", requestedQty: 3, unit: "BOX" }] }],
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.batchPublicId);
});
