"use strict";
// Track B Slice B1 evidence remediation (Codex verdict on Claude CLAIM-X-221): OLD vs NEW
// analytics.product_sales_summary_periods UPSERT, exact production SQL both
// ways, EXPLAIN (ANALYZE, BUFFERS, WAL), representative conflict rows
// (identical resync -- the case the guard targets), same data/cardinality,
// multiple reps, medians + variance reported (not single-run numbers).
const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres@localhost:55436/trackb_summary_bench" });

const SEED_ROWS = 200_000; // each row gets a globally unique product_code ('P'+g), so no key-space collision
const BATCH_SIZE = 200; // representative sales-summary batch size
const REPS = 7;

const OLD_SQL = `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)
  INSERT INTO analytics.product_sales_summary_periods
    (product_code, branch_code, period_start, period_end, period_days, sold_qty_base, avg_daily_usage, source_name)
  SELECT u.product_code, u.branch_code, u.period_start, u.period_end, u.period_days, u.sold_qty_base, u.avg_daily_usage, 'adapos_sync'
  FROM UNNEST($1::text[], $2::text[], $3::date[], $4::date[], $5::integer[], $6::numeric[], $7::numeric[])
    AS u(product_code, branch_code, period_start, period_end, period_days, sold_qty_base, avg_daily_usage)
  ON CONFLICT (product_code, branch_code, period_start, period_end, source_name)
  DO UPDATE SET
    period_days = EXCLUDED.period_days,
    sold_qty_base = EXCLUDED.sold_qty_base,
    avg_daily_usage = EXCLUDED.avg_daily_usage`;

const NEW_SQL = `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)
  INSERT INTO analytics.product_sales_summary_periods
    (product_code, branch_code, period_start, period_end, period_days, sold_qty_base, avg_daily_usage, source_name)
  SELECT u.product_code, u.branch_code, u.period_start, u.period_end, u.period_days, u.sold_qty_base, u.avg_daily_usage, 'adapos_sync'
  FROM UNNEST($1::text[], $2::text[], $3::date[], $4::date[], $5::integer[], $6::numeric[], $7::numeric[])
    AS u(product_code, branch_code, period_start, period_end, period_days, sold_qty_base, avg_daily_usage)
  ON CONFLICT (product_code, branch_code, period_start, period_end, source_name)
  DO UPDATE SET
    period_days = EXCLUDED.period_days,
    sold_qty_base = EXCLUDED.sold_qty_base,
    avg_daily_usage = EXCLUDED.avg_daily_usage
  WHERE
    analytics.product_sales_summary_periods.period_days IS DISTINCT FROM EXCLUDED.period_days OR
    analytics.product_sales_summary_periods.sold_qty_base IS DISTINCT FROM EXCLUDED.sold_qty_base OR
    analytics.product_sales_summary_periods.avg_daily_usage IS DISTINCT FROM EXCLUDED.avg_daily_usage`;

async function setup() {
  await pool.query("DROP TABLE IF EXISTS analytics.product_sales_summary_periods CASCADE");
  await pool.query(`
    CREATE TABLE analytics.product_sales_summary_periods (
      sales_summary_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_code text NOT NULL,
      branch_code text,
      period_start date NOT NULL,
      period_end date NOT NULL,
      period_days integer NOT NULL,
      sold_qty_base numeric NOT NULL,
      avg_daily_usage numeric NOT NULL,
      source_name text NOT NULL
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX ON analytics.product_sales_summary_periods (product_code, branch_code, period_start, period_end, source_name)`);

  console.log(`Seeding ${SEED_ROWS} rows...`);
  const batch = 20_000;
  for (let offset = 0; offset < SEED_ROWS; offset += batch) {
    const n = Math.min(batch, SEED_ROWS - offset);
    await pool.query(`
      INSERT INTO analytics.product_sales_summary_periods (product_code, branch_code, period_start, period_end, period_days, sold_qty_base, avg_daily_usage, source_name)
      SELECT 'P' || g, '00' || (1 + g % 5), '2026-07-01', '2026-07-30', 30, (g % 500), (g % 500) / 30.0, 'adapos_sync'
      FROM generate_series(${offset}, ${offset + n - 1}) AS g
    `);
  }
  await pool.query("ANALYZE analytics.product_sales_summary_periods");
  const cnt = await pool.query("SELECT count(*) FROM analytics.product_sales_summary_periods");
  console.log("Seeded rows:", cnt.rows[0].count);
}

// A representative 200-row batch that exactly replays EXISTING rows
// (identical resync -- the exact case the guard targets), reusing real
// seeded product_code/branch_code combinations so ON CONFLICT genuinely
// fires for every row, not a synthetic guess.
async function buildIdenticalReplayBatch() {
  const res = await pool.query(`
    SELECT product_code, branch_code, period_start, period_end, period_days, sold_qty_base, avg_daily_usage
    FROM analytics.product_sales_summary_periods
    ORDER BY sales_summary_id
    LIMIT $1
  `, [BATCH_SIZE]);
  const rows = res.rows;
  return [
    rows.map((r) => r.product_code),
    rows.map((r) => r.branch_code),
    rows.map((r) => r.period_start),
    rows.map((r) => r.period_end),
    rows.map((r) => r.period_days),
    rows.map((r) => r.sold_qty_base),
    rows.map((r) => r.avg_daily_usage),
  ];
}

async function timedRun(sql, params) {
  const client = await pool.connect();
  await client.query("BEGIN");
  const res = await client.query(sql, params);
  await client.query("ROLLBACK"); // never mutate the seeded state between reps
  client.release();
  const plan = res.rows[0]["QUERY PLAN"][0];
  return {
    execMs: plan["Execution Time"],
    planMs: plan["Planning Time"],
    sharedHit: plan.Plan["Shared Hit Blocks"],
    sharedRead: plan.Plan["Shared Read Blocks"],
    sharedDirtied: plan.Plan["Shared Dirtied Blocks"] || 0,
    walRecords: plan.Plan["WAL Records"] || 0,
    walBytes: plan.Plan["WAL Bytes"] || 0,
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function variance(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
}

async function main() {
  await setup();
  const params = await buildIdenticalReplayBatch();

  console.log(`\n=== OLD SQL (no WHERE guard) -- ${REPS} reps, identical-replay ${BATCH_SIZE}-row batch ===`);
  const oldRuns = [];
  for (let i = 0; i < REPS; i++) oldRuns.push(await timedRun(OLD_SQL, params));
  oldRuns.forEach((r, i) => console.log(`rep${i + 1}: exec=${r.execMs.toFixed(3)}ms hit=${r.sharedHit} read=${r.sharedRead} dirtied=${r.sharedDirtied} walRecords=${r.walRecords} walBytes=${r.walBytes}`));

  console.log(`\n=== NEW SQL (WHERE IS DISTINCT FROM guard) -- ${REPS} reps, identical-replay ${BATCH_SIZE}-row batch ===`);
  const newRuns = [];
  for (let i = 0; i < REPS; i++) newRuns.push(await timedRun(NEW_SQL, params));
  newRuns.forEach((r, i) => console.log(`rep${i + 1}: exec=${r.execMs.toFixed(3)}ms hit=${r.sharedHit} read=${r.sharedRead} dirtied=${r.sharedDirtied} walRecords=${r.walRecords} walBytes=${r.walBytes}`));

  const oldExec = oldRuns.map((r) => r.execMs);
  const newExec = newRuns.map((r) => r.execMs);
  const oldWal = oldRuns.map((r) => r.walBytes);
  const newWal = newRuns.map((r) => r.walBytes);
  const oldDirtied = oldRuns.map((r) => r.sharedDirtied);
  const newDirtied = newRuns.map((r) => r.sharedDirtied);

  console.log("\n=== SUMMARY (median, variance across", REPS, "reps) ===");
  console.log(`OLD exec: median=${median(oldExec).toFixed(3)}ms variance=${variance(oldExec).toFixed(4)}`);
  console.log(`NEW exec: median=${median(newExec).toFixed(3)}ms variance=${variance(newExec).toFixed(4)}`);
  console.log(`OLD WAL bytes: median=${median(oldWal)} variance=${variance(oldWal).toFixed(0)}`);
  console.log(`NEW WAL bytes: median=${median(newWal)} variance=${variance(newWal).toFixed(0)}`);
  console.log(`OLD dirtied buffers: median=${median(oldDirtied)} variance=${variance(oldDirtied).toFixed(2)}`);
  console.log(`NEW dirtied buffers: median=${median(newDirtied)} variance=${variance(newDirtied).toFixed(2)}`);

  await pool.end();
}
main().catch((e) => { console.error("FAILED:", e.message, e.stack); process.exit(1); });
