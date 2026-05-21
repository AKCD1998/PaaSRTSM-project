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
    reconciliation: {
      reconciliation_id: 7,
      case_key: "OUT-001",
      receiving_branch_code: "001",
      resolution_status: "draft",
      confirmed_by: null,
      approved_by: null,
      resolved_at: null,
      note: null,
    },
    lines: [],
    events: [],
  };

  return {
    state,
    async query(sql, params = []) {
      const normalizedSql = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

      if (normalizedSql.startsWith("insert into public.audit_logs")) {
        state.auditActions.push(params[2]);
        return {
          rowCount: 1,
          rows: [{ audit_id: state.auditActions.length, event_time: new Date().toISOString() }],
        };
      }

      if (
        normalizedSql.startsWith("select case_key, receiving_branch_code") &&
        normalizedSql.includes("from reconciliation.transfer_cases")
      ) {
        if (params[0] !== "OUT-001") {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [{ case_key: "OUT-001", receiving_branch_code: "001" }],
        };
      }

      if (normalizedSql.startsWith("insert into reconciliation.transfer_reconciliations")) {
        state.reconciliation = {
          reconciliation_id: state.reconciliation.reconciliation_id,
          case_key: params[0],
          receiving_branch_code: params[1],
          resolution_status: params[2],
          confirmed_by: params[3],
          approved_by: params[4],
          resolved_at: params[5],
          note: params[6],
        };
        return {
          rowCount: 1,
          rows: [state.reconciliation],
        };
      }

      if (
        normalizedSql.startsWith("select reconciliation_id, case_key, receiving_branch_code") &&
        normalizedSql.includes("from reconciliation.transfer_reconciliations")
      ) {
        if (params[0] !== "OUT-001") {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [state.reconciliation],
        };
      }

      if (normalizedSql.startsWith("update reconciliation.transfer_reconciliation_lines")) {
        const match = state.lines.find((line) =>
          line.reconciliation_id === params[0]
          && line.product_code === params[1]
          && (line.source_barcode || "") === (params[2] || "")
          && (line.source_unit_code || "") === (params[3] || "")
          && (line.lot_no || "") === (params[4] || "")
          && (line.expiry_date || "") === (params[5] || ""),
        );
        if (!match) {
          return { rowCount: 0, rows: [] };
        }
        match.expected_qty_base = params[6];
        match.actual_received_qty_base = params[7];
        match.note = params[8];
        return { rowCount: 1, rows: [{ reconciliation_line_id: match.reconciliation_line_id }] };
      }

      if (normalizedSql.startsWith("insert into reconciliation.transfer_reconciliation_lines")) {
        const line = {
          reconciliation_line_id: state.lines.length + 1,
          reconciliation_id: params[0],
          product_code: params[1],
          source_barcode: params[2],
          source_unit_code: params[3],
          lot_no: params[4],
          expiry_date: params[5],
          expected_qty_base: params[6],
          actual_received_qty_base: params[7],
          note: params[8],
        };
        state.lines.push(line);
        return { rowCount: 1, rows: [{ reconciliation_line_id: line.reconciliation_line_id }] };
      }

      if (normalizedSql.startsWith("insert into reconciliation.transfer_reconciliation_events")) {
        const event = {
          reconciliation_event_id: state.events.length + 1,
          reconciliation_id: params[0],
          event_type: params[1],
          actor_user_id: params[2],
          actor_role: params[3],
          note: params[4],
          payload: params[5] ? JSON.parse(params[5]) : null,
        };
        state.events.push(event);
        return {
          rowCount: 1,
          rows: [{ reconciliation_event_id: event.reconciliation_event_id, created_at: new Date().toISOString() }],
        };
      }

      throw new Error(`Unhandled SQL in reconciliation_actions.test.js: ${normalizedSql}`);
    },
  };
}

function createTestApp() {
  const config = buildConfig();
  const db = createMockDb();
  const { app } = createApp({ config, db });
  return { app, db };
}

async function loginAs(agent) {
  const response = await agent.post("/admin/auth/login").send({
    username: "admin@example.com",
    password: "admin-pass-123",
  });
  assert.equal(response.status, 200);
  return response.body.csrf_token;
}

test("confirm actual received quantity creates or updates reconciliation lines and event history", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAs(agent);

  const response = await agent
    .post("/api/admin/reconciliation/cases/OUT-001/confirm-receipt")
    .set("x-csrf-token", csrfToken)
    .send({
      productCode: "SKU-1",
      sourceBarcode: "885000000001",
      sourceUnitCode: "BOX",
      actualReceivedQtyBase: 9,
      expectedQtyBase: 10,
      note: "Counted at branch",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.resolutionStatus, "confirmed");
  assert.equal(db.state.reconciliation.confirmed_by, "admin@example.com");
  assert.equal(db.state.lines.length, 1);
  assert.equal(db.state.lines[0].actual_received_qty_base, 9);
  assert.equal(db.state.events.at(-1).event_type, "confirm_receipt");
  assert.ok(db.state.auditActions.includes("reconciliation.confirm_receipt"));
});

test("record discrepancy note/reason preserves app-owned discrepancy state and event history", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAs(agent);

  const response = await agent
    .post("/api/admin/reconciliation/cases/OUT-001/discrepancy")
    .set("x-csrf-token", csrfToken)
    .send({
      note: "Two units missing on arrival",
      reason: "damaged_in_transit",
      payload: { damagedQty: 2 },
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.resolutionStatus, "discrepancy_recorded");
  assert.equal(db.state.reconciliation.note, "Two units missing on arrival");
  assert.equal(db.state.events.at(-1).event_type, "record_discrepancy");
  assert.equal(db.state.events.at(-1).payload.reason, "damaged_in_transit");
  assert.ok(db.state.auditActions.includes("reconciliation.record_discrepancy"));
});

test("approve reconciliation case records approver identity and event history", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAs(agent);

  const response = await agent
    .post("/api/admin/reconciliation/cases/OUT-001/approve")
    .set("x-csrf-token", csrfToken)
    .send({ note: "Approved by supervisor" });

  assert.equal(response.status, 200);
  assert.equal(response.body.resolutionStatus, "approved");
  assert.equal(db.state.reconciliation.approved_by, "admin@example.com");
  assert.equal(db.state.events.at(-1).event_type, "approve");
  assert.ok(db.state.auditActions.includes("reconciliation.approve"));
});

test("cancel and reopen endpoints change app-owned status without touching source data", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAs(agent);

  const cancelResponse = await agent
    .post("/api/admin/reconciliation/cases/OUT-001/status")
    .set("x-csrf-token", csrfToken)
    .send({ action: "cancel", note: "Case cancelled for review" });

  assert.equal(cancelResponse.status, 200);
  assert.equal(cancelResponse.body.resolutionStatus, "cancelled");
  assert.equal(db.state.events.at(-1).event_type, "cancel");

  const reopenResponse = await agent
    .post("/api/admin/reconciliation/cases/OUT-001/status")
    .set("x-csrf-token", csrfToken)
    .send({ action: "reopen", note: "Reopened after branch callback" });

  assert.equal(reopenResponse.status, 200);
  assert.equal(reopenResponse.body.resolutionStatus, "draft");
  assert.equal(db.state.events.at(-1).event_type, "reopen");
  assert.ok(db.state.auditActions.includes("reconciliation.cancel"));
  assert.ok(db.state.auditActions.includes("reconciliation.reopen"));
});

test("append audit event adds reconciliation event entries and requires csrf", async () => {
  const { app, db } = createTestApp();
  const agent = request.agent(app);
  const csrfToken = await loginAs(agent);

  const forbidden = await agent
    .post("/api/admin/reconciliation/cases/OUT-001/events")
    .send({ eventType: "note_added", note: "Missing csrf" });
  assert.equal(forbidden.status, 403);

  const response = await agent
    .post("/api/admin/reconciliation/cases/OUT-001/events")
    .set("x-csrf-token", csrfToken)
    .send({
      eventType: "note_added",
      note: "Branch called back with clarification",
      payload: { contact: "branch-001" },
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.eventType, "note_added");
  assert.equal(db.state.events.at(-1).event_type, "note_added");
  assert.equal(db.state.events.at(-1).payload.contact, "branch-001");
  assert.ok(db.state.auditActions.includes("reconciliation.append_event"));
});
