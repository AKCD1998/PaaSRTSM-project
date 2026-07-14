"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeStatus,
  listFocusProducts,
  normalizePublication,
} = require("./focusProducts");

test("publication defaults to published for backward-compatible API callers", () => {
  const result = normalizePublication({});
  assert.equal(result.status, "published");
  assert.equal(result.scheduledPublishAt, null);
  assert.ok(result.publishedAt instanceof Date);
});

test("scheduled publication requires a future timestamp", () => {
  assert.throws(
    () => normalizePublication({ publicationStatus: "scheduled", scheduledPublishAt: "2020-01-01T00:00:00Z" }),
    (error) => error.statusCode === 400 && /future/.test(error.message),
  );

  const future = new Date(Date.now() + 60_000).toISOString();
  const result = normalizePublication({ publicationStatus: "scheduled", scheduledPublishAt: future });
  assert.equal(result.status, "scheduled");
  assert.equal(result.scheduledPublishAt, future);
});

test("editing an already-due scheduled row preserves its schedule", () => {
  const past = new Date(Date.now() - 60_000);
  const result = normalizePublication({}, {
    publication_status: "scheduled",
    scheduled_publish_at: past,
  });
  assert.equal(result.status, "scheduled");
  assert.equal(result.scheduledPublishAt, past);
});

test("non-admin listing filters drafts and exposes due schedules", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (/SELECT branch_code FROM core\.branches/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };

  const rows = await listFocusProducts(db);
  assert.deepEqual(rows, []);
  assert.match(queries[0], /publication_status = 'published'/);
  assert.match(queries[0], /scheduled_publish_at <= now\(\)/);
});

test("focus success rules remain unchanged", () => {
  const sold = { "001": 10, "003": 4 };
  assert.equal(computeStatus("salesperson", 14, sold, ["001", "003"], null).achieved, true);

  const pharmacist = computeStatus("pharmacist", 5, sold, ["001", "003"], { "003": 4 });
  assert.equal(pharmacist.achieved, null);
  assert.deepEqual(pharmacist.branchAchieved, { "001": true, "003": true });

  const manager = computeStatus("group_manager", 5, sold, ["001", "003"], null);
  assert.equal(manager.achieved, false);
});
