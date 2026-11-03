"use strict";

// Both instants are on the Bangkok day AFTER the inclusive sales date_to.
function closeWindow(dateTo) {
  const day = dateTo instanceof Date ? dateTo.toISOString().slice(0, 10) : String(dateTo).slice(0, 10);
  const next = new Date(day + "T00:00:00+07:00");
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    syncNotBefore: new Date(next.getTime() + (8 * 60 + 20) * 60000),
    syncBefore: new Date(next.getTime() + 24 * 60 * 60000),
    freezeNotBefore: new Date(next.getTime() + (8 * 60 + 30) * 60000),
  };
}

async function focusCloseReadiness(db, dateTo, branchCodes, now = new Date()) {
  const window = closeWindow(dateTo);
  const branches = [...new Set(branchCodes)];
  const result = { ...window, ready: false, pendingBranches: branches, completionRuns: {} };
  if (!branches.length || now < window.freezeNotBefore) return result;

  // Agents post this completion message only after ALL v1 sales chunks
  // committed and v2 reached APPLIED. Heartbeats/stock-only runs do not qualify.
  const completed = await db.query(
    `SELECT DISTINCT ON (wanted.branch_code)
       wanted.branch_code, run.sync_run_id, run.finished_at
     FROM unnest($1::text[]) wanted(branch_code)
     JOIN ingest.sync_runs run
       ON run.sync_type = 'adapos_branch_' || wanted.branch_code
      AND COALESCE(run.branch_code, wanted.branch_code) = wanted.branch_code
     WHERE run.status = 'success'
       AND (run.ingestion_mode = 'v1'
         OR (run.ingestion_mode = 'hybrid_v2' AND run.apply_status = 'applied'))
       AND run.started_at >= $2::timestamptz
       AND run.started_at < $4::timestamptz
       AND run.finished_at <= $3::timestamptz
       AND run.message ~ '^datasets=([^ ]*,)?sales_detail(,| )'
     ORDER BY wanted.branch_code, run.finished_at ASC, run.sync_run_id ASC`,
    [branches, window.syncNotBefore, now, window.syncBefore],
  );
  for (const row of completed.rows) {
    result.completionRuns[row.branch_code] = {
      syncRunId: String(row.sync_run_id), finishedAt: row.finished_at,
    };
  }
  result.pendingBranches = branches.filter((code) => !result.completionRuns[code]);
  result.ready = result.pendingBranches.length === 0;
  return result;
}

module.exports = { closeWindow, focusCloseReadiness };
