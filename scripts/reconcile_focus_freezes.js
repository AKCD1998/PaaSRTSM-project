"use strict";

// Default is a READ ONLY plan. --apply requires the exact reviewed plan hash.
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { createDbPool } = require("../apps/admin-api/src/db");
const { focusCloseReadiness } = require("../apps/admin-api/src/services/focusClose");
const {
  fetchSoldQtyBatch, sumSoldAcrossCodes, soldByBranchByProductForRow, computeStatus, toIsoDateOnly,
} = require("../apps/admin-api/src/services/focusProducts");

async function reconcile(db, { through, apply = false, expectedPlanHash = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through || "")) throw new Error("--through=YYYY-MM-DD is required");
  const client = await db.connect();
  try {
    await client.query(apply ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '90s'");
    const identity = (await client.query("SELECT current_database() db")).rows[0];
    if (identity.db !== "sc_drug_db") throw new Error("Unexpected database; refusing reconciliation");
    if (apply) await client.query("SELECT pg_advisory_xact_lock(7720261103)");
    const rows = (await client.query(
      `SELECT fp.*, fp.date_from::text AS date_from, fp.date_to::text AS date_to,
         fp.frozen_at::text AS frozen_at
       FROM focus.focus_products fp WHERE fp.frozen_at IS NOT NULL AND fp.date_to <= $1::date
       ORDER BY fp.date_from, fp.id ${apply ? "FOR UPDATE" : ""}`, [through],
    )).rows;
    const branches = (await client.query(
      "SELECT branch_code FROM core.branches WHERE is_active = TRUE ORDER BY branch_code",
    )).rows.map((r) => r.branch_code);
    const batches = new Map();
    const completions = new Map();
    const changes = [];
    const periods = {};
    for (const row of rows) {
      const from = toIsoDateOnly(row.date_from), to = toIsoDateOnly(row.date_to);
      const range = from + "|" + to;
      periods[range] ||= { checked: 0, changedRows: 0, changedCells: 0 };
      periods[range].checked++;
      if (!batches.has(range)) {
        const codes = [...new Set(rows.filter((r) => toIsoDateOnly(r.date_from) === from && toIsoDateOnly(r.date_to) === to)
          .flatMap((r) => r.product_codes?.length ? r.product_codes : [r.product_code]))];
        batches.set(range, await fetchSoldQtyBatch(client, codes, from, to));
      }
      const codes = row.product_codes?.length ? row.product_codes : [row.product_code];
      const relevant = row.branch_codes?.length ? row.branch_codes : branches;
      const sold = sumSoldAcrossCodes(batches.get(range), codes);
      const cells = relevant.filter((b) => Number(row.frozen_sold_by_branch?.[b] || 0) !== Number(sold[b] || 0));
      if (!cells.length) continue;
      if (cells.some((b) => Number(sold[b] || 0) < Number(row.frozen_sold_by_branch?.[b] || 0))) {
        throw new Error("A decrease requires separate review; focus id=" + row.id);
      }
      const closeKey = JSON.stringify([to, [...relevant].sort()]);
      if (!completions.has(closeKey)) completions.set(closeKey, await focusCloseReadiness(client, to, relevant));
      const close = completions.get(closeKey);
      if (!close.ready) throw new Error("Incomplete sales sync for focus " + row.id + ": " + close.pendingBranches.join(","));
      const total = Object.values(sold).reduce((sum, v) => sum + v, 0);
      const byProduct = soldByBranchByProductForRow(batches.get(range), codes);
      const beforeStatus = computeStatus(row.focus_type, Number(row.target_qty), row.frozen_sold_by_branch || {}, relevant, row.branch_targets);
      const afterStatus = computeStatus(row.focus_type, Number(row.target_qty), sold, relevant, row.branch_targets);
      changes.push({
        id: Number(row.id), dateFrom: from, dateTo: to, focusType: row.focus_type, productCodes: codes,
        targetQty: row.target_qty, branchTargets: row.branch_targets,
        assignedStaffId: row.assigned_staff_id,
        before: { soldByBranch: row.frozen_sold_by_branch, totalSold: row.frozen_total_sold,
          soldByBranchByProduct: row.frozen_sold_by_branch_by_product, frozenAt: row.frozen_at,
          completionRuns: row.freeze_completion_runs || null },
        after: { soldByBranch: sold, totalSold: total, soldByBranchByProduct: byProduct,
          completionRuns: close.completionRuns },
        cells: cells.map((b) => ({ branch: b, before: Number(row.frozen_sold_by_branch?.[b] || 0), after: Number(sold[b] || 0),
          achievedBefore: beforeStatus.branchAchieved?.[b] ?? beforeStatus.achieved,
          achievedAfter: afterStatus.branchAchieved?.[b] ?? afterStatus.achieved })),
        achievedBefore: beforeStatus.achieved, achievedAfter: afterStatus.achieved,
      });
      periods[range].changedRows++;
      periods[range].changedCells += cells.length;
    }
    const planHash = crypto.createHash("sha256").update(JSON.stringify(changes)).digest("hex");
    if (apply && planHash !== expectedPlanHash) throw new Error("Plan changed; obtain and review a new dry-run report");
    if (apply && changes.length) {
      await client.query("SELECT set_config('app.focus_freeze_reason', 'late_sales_reconciliation_20261103', true)");
      for (const row of changes) {
        const result = await client.query(
          `UPDATE focus.focus_products SET frozen_sold_by_branch=$2::jsonb, frozen_total_sold=$3,
           frozen_sold_by_branch_by_product=$4::jsonb, freeze_completion_runs=$5::jsonb,
           frozen_at=now(), updated_at=now() WHERE id=$1 AND frozen_at=$6::timestamptz`,
          [row.id, JSON.stringify(row.after.soldByBranch), row.after.totalSold,
            JSON.stringify(row.after.soldByBranchByProduct), JSON.stringify(row.after.completionRuns), row.before.frozenAt],
        );
        if (result.rowCount !== 1) throw new Error("Concurrent focus change; rolling back");
      }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { applied: apply, through, checked: rows.length, changedRows: changes.length,
      changedCells: changes.reduce((sum, r) => sum + r.cells.length, 0), planHash, periods, changes };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (key) => args.find((s) => s.startsWith(key + "="))?.slice(key.length + 1);
  const expected = value("--expected-plan");
  const expectedPlanHash = expected ? JSON.parse(await fs.readFile(expected, "utf8")).planHash : null;
  const db = createDbPool({ databaseUrl: process.env.DATABASE_URL });
  try {
    const report = await reconcile(db, { through: value("--through"), apply: args.includes("--apply"), expectedPlanHash });
    if (value("--report")) await fs.writeFile(value("--report"), JSON.stringify(report, null, 2), { flag: "wx" });
    const { changes, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
  } finally { await db.end(); }
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { reconcile };
