"use strict";

const { CONTRACT_VERSION } = require("./transferDelta");

const DATASET = "transfers";
const MIGRATION_KEYS = [
  "migrations/073_add_transfer_delta_delivery.sql",
  "migrations\\073_add_transfer_delta_delivery.sql",
];

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyEvidence(branchCode, schema) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    branchCode,
    dataset: DATASET,
    contractVersion: CONTRACT_VERSION,
    migration073Recorded: schema.migration073Recorded,
    tables: schema.tables,
    checkpoint: {
      rowCount: null,
      sequence: null,
      hasToken: null,
      hasStateHash: null,
      updatedAt: null,
    },
    requests: {
      rowCount: null,
      latest: null,
    },
    tombstoneAuditRows: null,
  };
}

async function readTransferDeltaSchemaEvidence(db) {
  const result = await db.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM public.schema_migrations
         WHERE filename = ANY($1::text[])
       ) AS migration_073_recorded,
       to_regclass('ada.transfer_delta_checkpoints') IS NOT NULL AS checkpoints_table_exists,
       to_regclass('ada.transfer_delta_requests') IS NOT NULL AS requests_table_exists,
       to_regclass('ada.transfer_delta_tombstone_audit') IS NOT NULL AS tombstone_audit_table_exists`,
    [MIGRATION_KEYS],
  );
  const row = result.rows[0] || {};
  return {
    migration073Recorded: row.migration_073_recorded === true,
    tables: {
      checkpoints: row.checkpoints_table_exists === true,
      requests: row.requests_table_exists === true,
      tombstoneAudit: row.tombstone_audit_table_exists === true,
    },
  };
}

async function readTransferDeltaEvidence(db, branchCode) {
  const schema = await readTransferDeltaSchemaEvidence(db);
  const evidence = emptyEvidence(branchCode, schema);
  if (!schema.tables.checkpoints || !schema.tables.requests || !schema.tables.tombstoneAudit) {
    return evidence;
  }

  const result = await db.query(
    `WITH checkpoint AS (
       SELECT checkpoint_sequence, checkpoint_token, state_hash, updated_at
       FROM ada.transfer_delta_checkpoints
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3
     ), request_total AS (
       SELECT count(*)::int AS row_count
       FROM ada.transfer_delta_requests
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3
     ), latest_request AS (
       SELECT operation, status, checkpoint_sequence, header_count, line_count,
              tombstone_count, applied_at
       FROM ada.transfer_delta_requests
       WHERE branch_code=$1 AND dataset=$2 AND contract_version=$3
       ORDER BY checkpoint_sequence DESC, transfer_delta_request_id DESC
       LIMIT 1
     )
     SELECT
       (SELECT count(*)::int FROM checkpoint) AS checkpoint_row_count,
       (SELECT checkpoint_sequence FROM checkpoint LIMIT 1) AS checkpoint_sequence,
       (SELECT checkpoint_token IS NOT NULL AND checkpoint_token <> '' FROM checkpoint LIMIT 1)
         AS checkpoint_has_token,
       (SELECT state_hash IS NOT NULL AND state_hash <> '' FROM checkpoint LIMIT 1)
         AS checkpoint_has_state_hash,
       (SELECT updated_at FROM checkpoint LIMIT 1) AS checkpoint_updated_at,
       (SELECT row_count FROM request_total) AS request_row_count,
       (SELECT operation FROM latest_request) AS latest_operation,
       (SELECT status FROM latest_request) AS latest_status,
       (SELECT checkpoint_sequence FROM latest_request) AS latest_checkpoint_sequence,
       (SELECT header_count FROM latest_request) AS latest_header_count,
       (SELECT line_count FROM latest_request) AS latest_line_count,
       (SELECT tombstone_count FROM latest_request) AS latest_tombstone_count,
       (SELECT applied_at FROM latest_request) AS latest_applied_at,
       (SELECT count(*)::int FROM ada.transfer_delta_tombstone_audit WHERE branch_code=$1)
         AS tombstone_audit_rows`,
    [branchCode, DATASET, CONTRACT_VERSION],
  );
  const row = result.rows[0] || {};
  const latest = row.latest_operation == null
    ? null
    : {
        operation: String(row.latest_operation),
        status: String(row.latest_status || ""),
        sequence: row.latest_checkpoint_sequence == null ? null : Number(row.latest_checkpoint_sequence),
        headerCount: Number(row.latest_header_count || 0),
        lineCount: Number(row.latest_line_count || 0),
        tombstoneCount: Number(row.latest_tombstone_count || 0),
        appliedAt: toIsoString(row.latest_applied_at),
      };

  return {
    ...evidence,
    checkpoint: {
      rowCount: Number(row.checkpoint_row_count || 0),
      sequence: row.checkpoint_sequence == null ? null : Number(row.checkpoint_sequence),
      hasToken: row.checkpoint_has_token === true,
      hasStateHash: row.checkpoint_has_state_hash === true,
      updatedAt: toIsoString(row.checkpoint_updated_at),
    },
    requests: {
      rowCount: Number(row.request_row_count || 0),
      latest,
    },
    tombstoneAuditRows: Number(row.tombstone_audit_rows || 0),
  };
}

module.exports = {
  DATASET,
  MIGRATION_KEYS,
  readTransferDeltaEvidence,
  readTransferDeltaSchemaEvidence,
};
