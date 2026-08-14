"use strict";

// Track B Slice B1 (2026-08-14, _ledger/claude.md CLAIM-X-219 through
// CLAIM-X-223) -- after four rounds of Codex adjudication, the only
// remaining runtime change in this candidate is the `WHERE ... IS DISTINCT
// FROM ...` no-op UPDATE suppression guard on
// analytics.product_sales_summary_periods's ON CONFLICT clause
// (apps/admin-api/src/routes/sync.js). apps/admin-api/src/routes/sync-ada.js
// is back to byte-identical with base SHA
// d8d3f83ab6d1860f61a556860e70fa1278a17004 (confirmed via
// `git diff --stat apps/admin-api/src/routes/sync-ada.js` returning
// nothing). This file only needs to cover product_sales_summary_periods.
//
// Codex's verdict on Claude CLAIM-X-222: production change APPROVED, remaining
// blocker is test-harness safety only. This revision addresses exactly
// that -- no runtime/benchmark/migration/config change here.
//
// Safety properties this file now enforces before issuing any SQL:
//   1. The target host MUST be loopback (localhost / 127.0.0.1 / ::1).
//      CP4_TEST_DATABASE_URL pointing anywhere else fails loudly before a
//      single query is sent -- this file creates and DROPs a database, so
//      it must never be able to run against a real/remote server by
//      accident (a typo'd env var, a copy-pasted production URL, etc).
//   2. The disposable database name is unique PER PROCESS/RUN
//      (trackb_sales_summary_noop_guard_<pid>_<random-hex>), not a fixed
//      name -- two concurrent test runs (e.g. two CI jobs, or a dev running
//      this file twice in separate terminals) can never collide, race on
//      DROP/CREATE, or accidentally drop the other's in-progress database.
//      The generated name is validated against ^[a-z0-9_]+$ before being
//      interpolated into any DDL (defense in depth -- pid/random-hex output
//      is not attacker-controlled, but any bug that made it something else
//      must not become an injection route).
//   3. test.after() always: releases the app-level pool, opens a fresh
//      maintenance connection, DROPs exactly the one generated database
//      name WITH (FORCE), and closes the maintenance pool in a `finally` --
//      so a mid-test failure can never leak the disposable database.
//   4. test.before()'s maintenance pool is also closed in a `finally`, so a
//      CREATE DATABASE or migration-bootstrap failure can't leak it either.
//   5. Missing CP4_TEST_DATABASE_URL: in CI (`process.env.CI` truthy) this
//      fails loudly (a CI run without this variable is a real
//      misconfiguration, not something to silently pass). Outside CI (a
//      dev machine with no local Postgres) this registers exactly one
//      explicit SKIPPED test instead -- never "tests 0" (which would look
//      identical to a config problem) and never a hard failure that would
//      make `npm test` red on every contributor's machine that doesn't
//      happen to have a local Postgres running.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { createSyncRouter } = require("./sync");
const express = require("express");
const request = require("supertest");

const baseUrl = process.env.CP4_TEST_DATABASE_URL;
const isCi = Boolean(process.env.CI);

if (!baseUrl) {
  if (isCi) {
    test("CP4_TEST_DATABASE_URL is not set in CI -- cannot run the sales-summary no-op guard verification", () => {
      assert.fail(
        "CP4_TEST_DATABASE_URL is required in CI to verify the analytics.product_sales_summary_periods " +
        "no-op UPDATE guard against a real Postgres. This test intentionally FAILS in CI (not skips) when " +
        "the variable is missing, so a misconfigured CI environment cannot be mistaken for a passing one.",
      );
    });
  } else {
    test("sales-summary no-op guard verification (SKIPPED: CP4_TEST_DATABASE_URL not set, not running in CI)", { skip: true }, () => {});
  }
} else {
  const parsed = new URL(baseUrl);

  // Safety property 1: loopback-only. Fail before any connection is opened.
  const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    test(`CP4_TEST_DATABASE_URL host '${parsed.hostname}' is not loopback -- refusing to run (this file creates/drops a database)`, () => {
      assert.fail(
        `CP4_TEST_DATABASE_URL's hostname must be one of localhost, 127.0.0.1, or ::1. Got '${parsed.hostname}'. ` +
        "This file creates and DROPs a disposable database as part of its own setup/teardown, so it must never " +
        "be pointed at a non-loopback host, even accidentally.",
      );
    });
  } else {
    // Safety property 2: unique-per-run database name, validated before use.
    const randomSuffix = crypto.randomBytes(4).toString("hex"); // lowercase hex -> already [a-z0-9]
    const dbName = `trackb_sales_summary_noop_guard_${process.pid}_${randomSuffix}`;
    if (!/^[a-z0-9_]+$/.test(dbName)) {
      throw new Error(`Generated disposable database name '${dbName}' failed identifier validation -- refusing to proceed.`);
    }

    const maintenanceUrl = new URL(baseUrl);
    maintenanceUrl.pathname = "/postgres";
    const dedicatedUrl = new URL(baseUrl);
    dedicatedUrl.pathname = `/${dbName}`;

    const rootDir = path.join(__dirname, "..", "..", "..", "..");
    const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

    async function bootstrapAnalyticsSchema(pool) {
      const baselineSql = stripBom(fs.readFileSync(path.join(rootDir, "001_inventory_schema.sql"), "utf8"));
      await pool.query(baselineSql);
      const migrationOrder = [
        "002_add_sku_price_tiers.sql",
        "003_add_product_fields.sql",
        "004_add_enrichment_workflow.sql",
        "005_add_sales_daily.sql",
        "010_add_audit_logs.sql",
        "011_add_sku_unit_prices.sql",
        // 012_add_sku_embeddings.sql intentionally skipped -- requires the
        // "vector" extension, not installed on every disposable cluster and
        // unrelated to product_sales_summary_periods.
        "013_add_embedding_sync_jobs.sql",
        "014_add_shared_ordering_and_sync.sql",
      ];
      for (const file of migrationOrder) {
        const sql = stripBom(fs.readFileSync(path.join(rootDir, "migrations", file), "utf8"));
        // eslint-disable-next-line no-await-in-loop -- one-time test bootstrap, not the code under test
        await pool.query(sql);
      }
    }

    function makeSyncApp(db) {
      const app = express();
      app.use(express.json({ limit: "10mb" }));
      app.use("/api/sync", createSyncRouter({ config: { posApiKeys: new Set() }, db }));
      app.use((error, req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
      return app;
    }

    let pool;

    test.before(async () => {
      const maint = new Pool({ connectionString: maintenanceUrl.toString(), max: 2 });
      try {
        await maint.query(`CREATE DATABASE ${dbName}`);
      } finally {
        // Safety property 4: never leak the maintenance pool, even if
        // CREATE DATABASE itself throws (e.g. name collision, permission).
        await maint.end();
      }

      pool = new Pool({ connectionString: dedicatedUrl.toString(), max: 4 });
      await bootstrapAnalyticsSchema(pool);
    });

    test.after(async () => {
      // Safety property 3: release the app pool, then drop the exact
      // generated database via a fresh maintenance connection, closing
      // that maintenance pool in a finally so it can never leak either.
      if (pool) await pool.end();
      const maint = new Pool({ connectionString: maintenanceUrl.toString(), max: 2 });
      try {
        await maint.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      } finally {
        await maint.end();
      }
    });

    async function reset() {
      await pool.query("TRUNCATE analytics.product_sales_summary_periods RESTART IDENTITY CASCADE");
      await pool.query("TRUNCATE public.skus, public.items RESTART IDENTITY CASCADE");
      const item = await pool.query("INSERT INTO public.items (generic_name) VALUES ($1) RETURNING item_id", ["noop-guard-p1"]);
      await pool.query("INSERT INTO public.skus (item_id, qty_in_base, company_code) VALUES ($1, 1, $2)", [item.rows[0].item_id, "P1"]);
      await pool.query("INSERT INTO core.branches (branch_code, branch_name) VALUES ($1, $2) ON CONFLICT DO NOTHING", ["001", "Test Branch"]);
    }

    const record = (soldQtyBase) => ({
      productCode: "P1", branchCode: "001", periodStart: "2026-07-01", periodEnd: "2026-07-30",
      periodDays: 30, soldQtyBase, avgDailyUsage: soldQtyBase / 30,
    });

    test("identical replay does not change xmin (true no-op, no row physically rewritten)", async () => {
      await reset();
      const r1 = await request(makeSyncApp(pool)).post("/api/sync/sales-summary").send({ records: [record(90)] });
      assert.equal(r1.statusCode, 200);
      const before = (await pool.query("SELECT xmin, sold_qty_base FROM analytics.product_sales_summary_periods WHERE product_code='P1'")).rows[0];
      const r2 = await request(makeSyncApp(pool)).post("/api/sync/sales-summary").send({ records: [record(90)] });
      assert.equal(r2.statusCode, 200);
      assert.equal(r2.body.accepted, 1, "API response (accepted = input record count) must be unchanged by the guard");
      const after = (await pool.query("SELECT xmin, sold_qty_base FROM analytics.product_sales_summary_periods WHERE product_code='P1'")).rows[0];
      assert.equal(String(after.xmin), String(before.xmin), "no new row version -- the UPDATE was truly skipped");
      assert.equal(Number(after.sold_qty_base), 90);
    });

    test("a real business-value change still applies and rewrites the row (UPDATE still works)", async () => {
      await reset();
      await request(makeSyncApp(pool)).post("/api/sync/sales-summary").send({ records: [record(90)] });
      const before = (await pool.query("SELECT xmin FROM analytics.product_sales_summary_periods WHERE product_code='P1'")).rows[0];
      const r2 = await request(makeSyncApp(pool)).post("/api/sync/sales-summary").send({ records: [record(120)] });
      assert.equal(r2.statusCode, 200);
      const after = (await pool.query("SELECT sold_qty_base, xmin FROM analytics.product_sales_summary_periods WHERE product_code='P1'")).rows[0];
      assert.equal(Number(after.sold_qty_base), 120, "the correction must still apply");
      assert.notEqual(String(after.xmin), String(before.xmin), "a real correction must still write a new row version");
    });
  }
}
