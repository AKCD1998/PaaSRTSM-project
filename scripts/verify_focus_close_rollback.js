"use strict";

// Exercises real PostgreSQL predicates, migration and audit trigger using
// temporary fixtures inside ONE transaction that is ALWAYS rolled back.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createDbPool } = require("../apps/admin-api/src/db");
const { attachProgress } = require("../apps/admin-api/src/services/focusProducts");
const { focusCloseReadiness } = require("../apps/admin-api/src/services/focusClose");

async function main() {
  const db = createDbPool({ databaseUrl: process.env.DATABASE_URL });
  const client = await db.connect();
  let checks = 0;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='3s'");
    const migration = await fs.readFile(path.join(__dirname, "../migrations/077_add_focus_freeze_audit.sql"), "utf8");
    await client.query(migration.replace(/^\s*BEGIN;/, "").replace(/COMMIT;\s*$/, ""));
    await client.query(`
      CREATE TEMP TABLE focus_fixture (LIKE focus.focus_products INCLUDING DEFAULTS);
      CREATE TEMP TABLE runs_fixture (sync_run_id bigint, sync_type text, branch_code text,
        status text, ingestion_mode text, apply_status text, started_at timestamptz,
        finished_at timestamptz, message text);
      CREATE TEMP TABLE headers_fixture (branch_code text,doc_no text,doc_date date,raw_payload jsonb,paid_status text);
      CREATE TEMP TABLE lines_fixture (branch_code text,doc_no text,product_code text,qty numeric,qty_base numeric,stock_factor numeric);
      CREATE TRIGGER audit_fixture AFTER UPDATE ON focus_fixture
        FOR EACH ROW EXECUTE FUNCTION focus.record_freeze_audit();
      INSERT INTO focus_fixture(id,product_code,product_codes,focus_type,target_qty,date_from,date_to,branch_codes,is_active)
        VALUES (900000001,'FIXTURE',ARRAY['FIXTURE'],'store_manager',3,'2026-10-01','2026-10-31',ARRAY['001','003','004','005'],true);
      INSERT INTO headers_fixture SELECT b,'DOC-'||b,'2026-10-31','{"FTShdDocType":"1","FTShdStaPaid":"3"}','3'
        FROM unnest(ARRAY['001','003','004','005']) b;
      INSERT INTO lines_fixture SELECT b,'DOC-'||b,'FIXTURE',3,3,1 FROM unnest(ARRAY['001','003','004','005']) b;
      INSERT INTO runs_fixture
        SELECT row_number() OVER (), 'adapos_branch_'||b,b,'success','hybrid_v2','applied',
          '2026-11-01T01:20:13Z','2026-11-01T01:22:00Z','datasets=sales,sales_detail,branch_stock posted for branch '||b||'.'
        FROM unnest(ARRAY['001','003','004']) b;
    `);
    const adapter = { query(sql, params) {
      if (sql.includes("SELECT\n       pt.product_code")) return Promise.resolve({ rows: [] });
      return client.query(sql.replaceAll("focus.focus_products", "pg_temp.focus_fixture")
        .replaceAll("ingest.sync_runs", "pg_temp.runs_fixture")
        .replaceAll("ada.sales_headers", "pg_temp.headers_fixture")
        .replaceAll("ada.sales_lines", "pg_temp.lines_fixture"), params);
    } };
    const row = (await client.query("SELECT *,date_from::text AS date_from,date_to::text AS date_to FROM focus_fixture")).rows[0];
    const branches = row.branch_codes;
    const ready = (now) => focusCloseReadiness(adapter, row.date_to, branches, new Date(now));
    assert.equal((await ready("2026-11-01T01:29:59Z")).ready, false); checks++;
    assert.deepEqual((await ready("2026-11-01T01:30:00Z")).pendingBranches, ["005"]); checks++;
    for (const [status, mode, apply, message, start] of [
      ["failed", "v1", null, "datasets=sales_detail posted for branch 005.", "2026-11-01T01:20:13Z"],
      ["success", "hybrid_v2", "pending", "datasets=sales_detail posted for branch 005.", "2026-11-01T01:20:13Z"],
      ["success", "v1", null, "datasets=branch_stock posted for branch 005.", "2026-11-01T01:20:13Z"],
      ["success", "v1", null, "datasets=sales_detail posted for branch 005.", "2026-11-01T00:58:00Z"],
    ]) {
      await client.query("INSERT INTO runs_fixture VALUES(50,'adapos_branch_005','005',$1,$2,$3,$4,'2026-11-01T01:23:00Z',$5)",
        [status, mode, apply, start, message]);
      assert.equal((await ready("2026-11-01T01:30:00Z")).ready, false); checks++;
      await client.query("DELETE FROM runs_fixture WHERE branch_code='005'");
    }
    await client.query(`INSERT INTO runs_fixture VALUES(52,'adapos_branch_005','005','success','v1',NULL,
      '2026-11-02T01:20:13Z','2026-11-02T01:22:00Z','datasets=sales_detail posted for branch 005.')`);
    assert.equal((await ready("2026-11-03T01:30:00Z")).ready, false); checks++;
    await client.query("DELETE FROM runs_fixture WHERE branch_code='005'");
    const [pending] = await attachProgress(adapter, [row], branches, null, { now: new Date("2026-11-01T01:30:00Z") });
    assert.equal(pending.isFrozen, false); checks++;
    await client.query(`INSERT INTO runs_fixture VALUES(51,'adapos_branch_005','005','success','v1',NULL,
      '2026-11-01T01:20:13Z','2026-11-01T01:32:00Z','datasets=sales,sales_detail posted for branch 005.')`);
    assert.equal((await ready("2026-11-01T01:31:00Z")).ready, false); checks++;
    const [closed] = await attachProgress(adapter, [row], branches, null, { now: new Date("2026-11-01T01:33:00Z") });
    assert.equal(closed.isFrozen, true);
    assert.equal(closed.branchAchieved["005"], true); checks += 2;
    const audit = (await client.query("SELECT * FROM focus.freeze_audit WHERE focus_id=900000001")).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].before_snapshot.frozenAt, null);
    assert.equal(audit[0].after_snapshot.soldByBranch["005"], 3);
    assert.equal(audit[0].after_snapshot.completionRuns["005"].syncRunId, "51"); checks += 4;
    const persisted = (await client.query("SELECT *,date_from::text AS date_from,date_to::text AS date_to FROM focus_fixture")).rows[0];
    await client.query("UPDATE lines_fixture SET qty_base=99 WHERE branch_code='005'");
    const [again] = await attachProgress(adapter, [persisted], branches);
    assert.equal(again.soldByBranch["005"], 3);
    assert.equal((await client.query("SELECT count(*)::int n FROM focus.freeze_audit WHERE focus_id=900000001")).rows[0].n, 1); checks += 2;
    console.log(JSON.stringify({ ok: true, checks, rollbackOnly: true }));
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await db.end();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
