"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const { createBranchStaffRouter } = require("../apps/admin-api/src/routes/mobile-enroll");

// Focused coverage for the hire_date field added by migration 065 — the rest
// of this router (branch scoping, role/note updates) predates this change and
// has no prior test file, so this deliberately stays narrow to what's new.
function createTestApp() {
  const state = {
    rows: new Map([
      [1, { staff_id: 1, branch_code: "001", display_name: "Som Sales", role: "sales", is_active: true, is_probationary: false, note: null, hire_date: "2024-01-15" }],
      [2, { staff_id: 2, branch_code: "001", display_name: "Mana Manager", role: "manager", is_active: true, is_probationary: false, note: null, hire_date: null }],
    ]),
    nextId: 3,
  };

  async function query(sql, params = []) {
    const n = String(sql).replace(/\s+/g, " ").trim().toLowerCase();

    if (n.startsWith("select staff_id, branch_code, display_name, role, is_active, is_probationary, note, hire_date from core.branch_staff")) {
      let rows = [...state.rows.values()];
      if (n.includes("where branch_code = $1")) rows = rows.filter((r) => r.branch_code === params[0]);
      rows = rows.slice().sort((a, b) => a.branch_code.localeCompare(b.branch_code) || a.display_name.localeCompare(b.display_name));
      return { rowCount: rows.length, rows };
    }

    if (n.startsWith("insert into core.branch_staff")) {
      const row = {
        staff_id: state.nextId,
        branch_code: params[0],
        display_name: params[1],
        role: params[2],
        is_active: true,
        is_probationary: params[3],
        note: params[4],
        hire_date: params[5],
      };
      state.rows.set(state.nextId, row);
      state.nextId += 1;
      return { rowCount: 1, rows: [row] };
    }

    if (n.startsWith("update core.branch_staff")) {
      // Test only exercises single-field PATCHes, so params[0] is that
      // field's new value and the last param is always staff_id.
      const staffId = Number(params[params.length - 1]);
      const row = state.rows.get(staffId);
      if (!row) return { rowCount: 0, rows: [] };
      if (n.includes("hire_date = $")) row.hire_date = params[0];
      if (n.includes("display_name = $")) row.display_name = params[0];
      return { rowCount: 1, rows: [row] };
    }

    if (n.startsWith("insert into public.audit_logs")) {
      return { rowCount: 1, rows: [{ audit_id: 1, event_time: new Date().toISOString() }] };
    }

    throw new Error(`Unhandled mock query: ${sql}`);
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = "test-request";
    next();
  });
  const passthrough = (_req, _res, next) => next();
  app.use(
    "/api/admin/branch-staff",
    createBranchStaffRouter({
      db: { query },
      requireAuthMiddleware: passthrough,
      requireRoleMiddleware: () => passthrough,
      requireCsrfMiddleware: passthrough,
    }),
  );
  return { app, state };
}

test("GET branch-staff includes hireDate, null when unset", async () => {
  const { app } = createTestApp();
  const res = await request(app).get("/api/admin/branch-staff");
  assert.equal(res.status, 200);
  const som = res.body.staff.find((s) => s.staffId === "1");
  const mana = res.body.staff.find((s) => s.staffId === "2");
  assert.equal(som.hireDate, "2024-01-15");
  assert.equal(mana.hireDate, null);
});

test("POST branch-staff accepts and round-trips hireDate", async () => {
  const { app } = createTestApp();
  const res = await request(app)
    .post("/api/admin/branch-staff")
    .send({ branchCode: "001", displayName: "New Hire", hireDate: "2026-07-01" });
  assert.equal(res.status, 201);
  assert.equal(res.body.staff.hireDate, "2026-07-01");
});

test("POST branch-staff rejects a malformed hireDate", async () => {
  const { app } = createTestApp();
  const res = await request(app)
    .post("/api/admin/branch-staff")
    .send({ branchCode: "001", displayName: "New Hire", hireDate: "01/07/2026" });
  assert.equal(res.status, 400);
});

test("PATCH branch-staff updates hireDate", async () => {
  const { app } = createTestApp();
  const res = await request(app)
    .patch("/api/admin/branch-staff/2")
    .send({ hireDate: "2023-05-10" });
  assert.equal(res.status, 200);
  assert.equal(res.body.staff.hireDate, "2023-05-10");
});
