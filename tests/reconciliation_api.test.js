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

function createMockDb() {
  const state = {
    auditActions: [],
    queryLog: [],
  };

  return {
    state,
    async query(sql, params = []) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
      state.queryLog.push({ sql: normalizedSql, params });

      if (normalizedSql.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return {
          rowCount: 1,
          rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
        };
      }

      if (
        normalizedSql.includes("select count(*)::integer as total_cases") &&
        normalizedSql.includes("from reconciliation.transfer_cases tc")
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              total_cases: 3,
              outbound_only_count: 1,
              inbound_present_unprocessed_count: 1,
              inbound_processed_count: 1,
              ambiguous_match_count: 0,
              inbound_only_unmatched_count: 0,
              other_count: 0,
              draft_count: 1,
              confirmed_count: 1,
              discrepancy_recorded_count: 0,
              approved_count: 1,
              cancelled_count: 0,
            },
          ],
        };
      }

      if (
        normalizedSql.startsWith("select count(*)::integer as total") &&
        normalizedSql.includes("from reconciliation.transfer_cases tc")
      ) {
        return {
          rowCount: 1,
          rows: [{ total: 1 }],
        };
      }

      if (normalizedSql.includes("count(tcl.transfer_case_line_id)::integer as line_count")) {
        return {
          rowCount: 1,
          rows: [
            {
              case_key: "OUT-001",
              case_doc_date: "2026-05-20",
              dispatch_branch_code: "000",
              receiving_branch_code: "001",
              outbound_doc_no: "OUT-001",
              outbound_doc_type: "4",
              outbound_branch_code: "000",
              inbound_doc_no: "IN-001",
              inbound_doc_type: "7",
              inbound_branch_code: "001",
              source_match_status: "inbound_processed",
              source_match_method: "inbound_reference_doc",
              match_candidate_count: 1,
              inbound_process_state: "processed",
              expected_total_qty_base: "12.0000",
              source_received_total_qty_base: "12.0000",
              qty_delta_source: "0.0000",
              latest_source_synced_at: "2026-05-21T08:00:00.000Z",
              resolution_status: "approved",
              confirmed_by: "user-1",
              approved_by: "manager-1",
              resolved_at: "2026-05-21T09:00:00.000Z",
              note: "Checked",
              line_count: 2,
            },
          ],
        };
      }

      if (
        normalizedSql.includes("from reconciliation.transfer_cases tc") &&
        normalizedSql.includes("where tc.case_key = $1")
      ) {
        if (params[0] === "missing-case") {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [
            {
              case_key: params[0],
              case_doc_date: "2026-05-20",
              dispatch_branch_code: "000",
              receiving_branch_code: "001",
              outbound_doc_no: "OUT-001",
              outbound_doc_type: "4",
              outbound_branch_code: "000",
              inbound_doc_no: "IN-001",
              inbound_doc_type: "7",
              inbound_branch_code: "001",
              source_match_status: "inbound_processed",
              source_match_method: "inbound_reference_doc",
              match_candidate_count: 1,
              inbound_process_state: "processed",
              expected_total_qty_base: "12.0000",
              source_received_total_qty_base: "12.0000",
              qty_delta_source: "0.0000",
              latest_source_synced_at: "2026-05-21T08:00:00.000Z",
              resolution_status: "approved",
              confirmed_by: "user-1",
              approved_by: "manager-1",
              resolved_at: "2026-05-21T09:00:00.000Z",
              note: "Checked",
            },
          ],
        };
      }

      if (
        normalizedSql.includes("from reconciliation.transfer_case_lines") &&
        normalizedSql.includes("where case_key = $1")
      ) {
        return {
          rowCount: 2,
          rows: [
            {
              line_key: "OUT-001|SKU-1",
              case_key: params[0],
              product_code: "SKU-1",
              barcode: "885000000001",
              unit_code: "BOX",
              lot_no: "LOT-A",
              expiry_date: "2026-12-31",
              outbound_qty_base: "10.0000",
              inbound_qty_base: "10.0000",
              qty_delta_source: "0.0000",
              line_status: "matched",
            },
            {
              line_key: "OUT-001|SKU-2",
              case_key: params[0],
              product_code: "SKU-2",
              barcode: "885000000002",
              unit_code: "BOX",
              lot_no: null,
              expiry_date: null,
              outbound_qty_base: "2.0000",
              inbound_qty_base: "2.0000",
              qty_delta_source: "0.0000",
              line_status: "matched",
            },
          ],
        };
      }

      if (normalizedSql.includes("join reconciliation.transfer_reconciliation_lines trl")) {
        return {
          rowCount: 1,
          rows: [
            {
              reconciliation_line_id: 11,
              reconciliation_id: 7,
              product_code: "SKU-1",
              source_barcode: "885000000001",
              source_unit_code: "BOX",
              lot_no: "LOT-A",
              expiry_date: "2026-12-31",
              expected_qty_base: "10.0000",
              actual_received_qty_base: "10.0000",
              note: "Matched physically",
            },
          ],
        };
      }

      if (normalizedSql.includes("join reconciliation.transfer_reconciliation_events tre")) {
        return {
          rowCount: 1,
          rows: [
            {
              reconciliation_event_id: 3,
              reconciliation_id: 7,
              event_type: "approved",
              actor_user_id: "manager-1",
              actor_role: "admin",
              note: "Approved after check",
              payload: { source: "test" },
              created_at: "2026-05-21T09:00:00.000Z",
            },
          ],
        };
      }

      throw new Error(`Unhandled SQL in reconciliation_api.test.js: ${normalizedSql}`);
    },
  };
}

function createTestApp() {
  const config = buildConfig();
  const db = createMockDb();
  const { app } = createApp({ config, db });
  return { app, db };
}

async function loginAs(agent, username, password) {
  const response = await agent.post("/admin/auth/login").send({ username, password });
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

function findLoggedQuery(db, fragment) {
  return db.state.queryLog.find((entry) => entry.sql.includes(fragment));
}

test("reconciliation summary returns counts and applies source-status filters", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent, "admin@example.com", "admin-pass-123");

  const response = await agent
    .get("/api/admin/reconciliation/summary?branch=001&dateFrom=2026-05-01&dateTo=2026-05-31&status=inbound_processed");

  assert.equal(response.status, 200);
  assert.equal(response.body.totalCases, 3);
  assert.equal(response.body.bySourceMatchStatus.inbound_processed, 1);
  assert.equal(response.body.byResolutionStatus.approved, 1);

  const query = findLoggedQuery(db, "select count(*)::integer as total_cases");
  assert.deepEqual(query.params, ["001", "2026-05-01", "2026-05-31", "inbound_processed"]);
});

test("reconciliation case list returns rows and supports resolution-status filters", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent, "admin@example.com", "admin-pass-123");

  const response = await agent
    .get("/api/admin/reconciliation/cases?branch=001&status=approved&limit=10&offset=0");

  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.rows[0].caseKey, "OUT-001");
  assert.equal(response.body.rows[0].resolutionStatus, "approved");
  assert.equal(response.body.rows[0].lineCount, 2);

  const countQuery = findLoggedQuery(db, "select count(*)::integer as total");
  assert.deepEqual(countQuery.params, ["001", "approved"]);

  const listQuery = findLoggedQuery(db, "count(tcl.transfer_case_line_id)::integer as line_count");
  assert.deepEqual(listQuery.params, ["001", "approved", 10, 0]);
});

test("reconciliation case detail returns source lines, app lines, and events", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent, "admin@example.com", "admin-pass-123");

  const response = await agent.get("/api/admin/reconciliation/cases/OUT-001");

  assert.equal(response.status, 200);
  assert.equal(response.body.case.caseKey, "OUT-001");
  assert.equal(response.body.case.sourceMatchStatus, "inbound_processed");
  assert.equal(response.body.sourceLines.length, 2);
  assert.equal(response.body.reconciliationLines.length, 1);
  assert.equal(response.body.events.length, 1);
  assert.equal(response.body.events[0].eventType, "approved");
});

test("reconciliation routes require auth and validate filters", async () => {
  const { app } = createTestApp();

  const unauthorized = await request(app).get("/api/admin/reconciliation/summary");
  assert.equal(unauthorized.status, 401);

  const agent = request.agent(app);
  await loginAs(agent, "admin@example.com", "admin-pass-123");

  const invalidDate = await agent.get("/api/admin/reconciliation/cases?dateFrom=2026/05/01");
  assert.equal(invalidDate.status, 400);

  const invalidStatus = await agent.get("/api/admin/reconciliation/summary?status=not-a-real-status");
  assert.equal(invalidStatus.status, 400);
});

test("reconciliation case detail returns 404 for missing case", async () => {
  const { app } = createTestApp();
  const agent = request.agent(app);
  await loginAs(agent, "admin@example.com", "admin-pass-123");

  const response = await agent.get("/api/admin/reconciliation/cases/missing-case");
  assert.equal(response.status, 404);
});
