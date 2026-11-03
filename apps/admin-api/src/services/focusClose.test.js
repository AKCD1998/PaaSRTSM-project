"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { closeWindow, focusCloseReadiness } = require("./focusClose");
const { attachProgress } = require("./focusProducts");

const branches = ["001", "003", "004", "005"];
test("close windows use Bangkok next day, including month/year/leap boundaries", () => {
  for (const [end, next] of [["2026-10-31", "2026-11-01"], ["2026-12-31", "2027-01-01"], ["2028-02-29", "2028-03-01"]]) {
    const w = closeWindow(end);
    assert.equal(w.syncNotBefore.toISOString(), next + "T01:20:00.000Z");
    assert.equal(w.freezeNotBefore.toISOString(), next + "T01:30:00.000Z");
  }
});

test("07:58 and 08:29 do not freeze even if all sales syncs succeeded", async () => {
  const db = { query() { throw new Error("must not check before cutoff"); } };
  for (const time of ["00:58:38", "01:29:59"]) {
    const result = await focusCloseReadiness(db, "2026-10-31", branches, new Date("2026-11-01T" + time + "Z"));
    assert.equal(result.ready, false);
  }
});

test("08:30 still waits for an offline or failed branch", async () => {
  const db = { async query() { return { rows: branches.slice(0, 3).map((branch_code) => ({ branch_code, sync_run_id: 1 })) }; } };
  const result = await focusCloseReadiness(db, "2026-10-31", branches, new Date("2026-11-01T01:30:00Z"));
  assert.equal(result.ready, false);
  assert.deepEqual(result.pendingBranches, ["005"]);
});

function fixture({ completed = branches, concurrentWinner = null } = {}) {
  const row = { id: 1, product_code: "P1", product_codes: ["P1"], focus_type: "store_manager",
    date_from: "2026-10-01", date_to: "2026-10-31", target_qty: 3, branch_codes: branches,
    frozen_at: null };
  const state = { order: [], writes: 0, persisted: null };
  const db = { async query(sql, params) {
    if (sql.includes("JOIN ingest.sync_runs run")) {
      state.order.push("completion");
      return { rows: completed.map((branch_code) => ({ branch_code, sync_run_id: 99, finished_at: "2026-11-01T01:22:00Z" })) };
    }
    if (sql.includes("FROM ada.sales_lines sl")) {
      state.order.push("sales");
      return { rows: [{ product_code: "P1", branch_code: "005", sold_qty: 3 }] };
    }
    if (sql.includes("UPDATE focus.focus_products")) {
      state.writes++;
      if (concurrentWinner) return { rows: [] };
      state.persisted = { frozen_at: "2026-11-01T01:30:00Z", frozen_sold_by_branch: JSON.parse(params[1]) };
      return { rows: [state.persisted] };
    }
    if (sql.includes("SELECT * FROM focus.focus_products WHERE id")) return { rows: [concurrentWinner] };
    return { rows: [] };
  } };
  return { row, db, state };
}

test("late Oct 31 sales are counted only after completion evidence, once per shared window", async () => {
  const { row, db, state } = fixture();
  const result = await attachProgress(db, [row], branches, null, { now: new Date("2026-11-01T01:30:00Z") });
  assert.equal(result[0].isFrozen, true);
  assert.equal(result[0].branchAchieved["005"], true);
  assert.deepEqual(state.order, ["completion", "sales"]);
  assert.equal(state.writes, 1);
  const again = await attachProgress(db, [{ ...row, ...state.persisted }], branches);
  assert.equal(again[0].soldByBranch["005"], 3);
  assert.equal(state.writes, 1);
});

test("one missing branch leaves live progress unfrozen for every row", async () => {
  const { row, db, state } = fixture({ completed: ["001", "003", "004"] });
  const result = await attachProgress(db, [row, { ...row, id: 2 }], branches, null, { now: new Date("2026-11-01T01:35:00Z") });
  assert.ok(result.every((r) => !r.isFrozen));
  assert.deepEqual(result[0].freezePendingBranches, ["005"]);
  assert.equal(state.writes, 0);
  assert.equal(state.order.filter((s) => s === "completion").length, 1);
});

test("a concurrent freeze returns the winning persisted quantity", async () => {
  const winner = { frozen_at: "2026-11-01T01:30:01Z", frozen_sold_by_branch: { "005": 4 } };
  const { row, db } = fixture({ concurrentWinner: winner });
  const [result] = await attachProgress(db, [row], branches, null, { now: new Date("2026-11-01T01:31:00Z") });
  assert.equal(result.isFrozen, true);
  assert.equal(result.soldByBranch["005"], 4);
});
