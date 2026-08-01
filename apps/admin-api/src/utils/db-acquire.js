"use strict";

// 2026-07-31 incident (docs/sync-program/INCIDENT_2026-07-31_MORNING_SYNC.md,
// SC-StockDay-Ordering repo): every ingestion route below called
// `await db.connect()` outside its own try/catch. When the pool could not
// hand out a connection within connectionTimeoutMillis, that rejection
// escaped the Express 4 async handler as an uncaught exception and took the
// whole process down. This helper puts acquisition under explicit error
// handling so a saturated pool produces one 503 response instead of a
// restart. It does nothing else: does not affect connections that succeed
// or queries that fail after a connection was acquired.

// CLAIM-X-070 (_ledger/codex.md): a code-less acquisition rejection's raw
// `error.message` can itself be credential/connection-string-shaped (pg
// sometimes embeds the connection target in its own error text). Only an
// allowlisted-shape `error.code` (pg SQLSTATE, or a Node error code like
// ETIMEDOUT/ECONNREFUSED — short, alphanumeric/underscore) is safe to log
// verbatim; anything else collapses to a fixed constant. `error.message` is
// never logged, on any path.
function safeErrorClassification(error) {
  const code = error && typeof error.code === "string" ? error.code : null;
  if (code && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
    return code;
  }
  return "NO_SAFE_ERROR_CODE";
}

async function acquireIngestionDbClient(db, res, routeLabel) {
  try {
    return await db.connect();
  } catch (error) {
    // Deliberately no error.message/stack here or in the response — pg
    // error text can itself embed connection details. Allowlisted
    // classification only, server-side.
    console.error(
      `[db-acquire] DB_UNAVAILABLE acquiring pool connection for ${routeLabel || "unknown route"}: ${safeErrorClassification(error)}`,
    );
    res.status(503).json({
      error: "DB_UNAVAILABLE",
      message: "Database temporarily unavailable. Please retry.",
      request_id: (res.req && res.req.requestId) || null,
    });
    return null;
  }
}

module.exports = { acquireIngestionDbClient, safeErrorClassification };
