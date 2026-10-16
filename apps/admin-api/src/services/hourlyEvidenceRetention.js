"use strict";

// Candidate policy only: nothing runs unless retention is explicitly enabled.
// Bounded cleanup includes incomplete windows after their retention deadline.
async function pruneHourlyEvidence(client, { enabled = false, retentionDays = 30, batchSize = 100, now = new Date(), execute = false } = {}) {
  if (!enabled) return { status: "disabled", deletedRuns: 0, deletedRows: 0 };
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 3 || retentionDays > 365
      || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000
      || !Number.isFinite(new Date(now).getTime())) throw new Error("Invalid hourly retention policy.");
  const cutoff = new Date(new Date(now).getTime() - retentionDays * 86400_000).toISOString();
  if (!execute) {
    const result = await client.query(
      "SELECT COUNT(*)::int AS count FROM evidence.hourly_stock_capture_runs WHERE captured_at < $1::timestamptz", [cutoff],
    );
    return { status: "dry-run", cutoff, eligibleRuns: result.rows[0].count, batchSize };
  }
  await client.query("BEGIN");
  try {
    const selected = await client.query(
      "SELECT capture_id FROM evidence.hourly_stock_capture_runs WHERE captured_at < $1::timestamptz ORDER BY captured_at, capture_id LIMIT $2 FOR UPDATE SKIP LOCKED",
      [cutoff, batchSize],
    );
    const ids = selected.rows.map((row) => row.capture_id);
    const rows = await client.query("DELETE FROM evidence.hourly_stock_capture_rows WHERE capture_id = ANY($1::bigint[])", [ids]);
    const runs = await client.query("DELETE FROM evidence.hourly_stock_capture_runs WHERE capture_id = ANY($1::bigint[])", [ids]);
    await client.query("COMMIT");
    return { status: "pruned", cutoff, deletedRuns: runs.rowCount, deletedRows: rows.rowCount };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

module.exports = { pruneHourlyEvidence };
