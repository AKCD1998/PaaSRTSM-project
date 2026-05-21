"use strict";

const express = require("express");
const { auditLog } = require("../audit");
const { auditBase } = require("../utils/audit-payload");

const SOURCE_MATCH_STATUSES = new Set([
  "outbound_only",
  "inbound_present_unprocessed",
  "inbound_processed",
  "ambiguous_match",
  "inbound_only_unmatched",
  "other",
]);

const RESOLUTION_STATUSES = new Set([
  "draft",
  "confirmed",
  "discrepancy_recorded",
  "approved",
  "cancelled",
]);

function parseOptionalText(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function parseOptionalDate(value) {
  const text = parseOptionalText(value);
  if (!text) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  return text;
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return n;
}

function parseNonNegativeInt(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    return null;
  }
  return n;
}

function normalizeStatusFilter(value) {
  const text = parseOptionalText(value);
  if (!text) {
    return null;
  }
  if (SOURCE_MATCH_STATUSES.has(text)) {
    return { type: "source", value: text };
  }
  if (RESOLUTION_STATUSES.has(text)) {
    return { type: "resolution", value: text };
  }
  return { type: "invalid", value: text };
}

function parseRequiredText(value, fieldName) {
  const text = parseOptionalText(value);
  if (!text) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function parseOptionalNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

function parseOptionalPayload(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}

function buildCaseFilterClause(filters, params) {
  const clauses = [];

  if (filters.branch) {
    params.push(filters.branch);
    const paramRef = `$${params.length}`;
    clauses.push(`(tc.receiving_branch_code = ${paramRef} OR tc.dispatch_branch_code = ${paramRef})`);
  }

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    clauses.push(`tc.case_doc_date >= $${params.length}`);
  }

  if (filters.dateTo) {
    params.push(filters.dateTo);
    clauses.push(`tc.case_doc_date <= $${params.length}`);
  }

  if (filters.status?.type === "source") {
    params.push(filters.status.value);
    clauses.push(`tc.source_match_status = $${params.length}`);
  }

  if (filters.status?.type === "resolution") {
    params.push(filters.status.value);
    clauses.push(`COALESCE(tr.resolution_status, 'draft') = $${params.length}`);
  }

  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function mapCaseRow(row) {
  return {
    caseKey: row.case_key,
    caseDate: row.case_doc_date,
    dispatchBranchCode: row.dispatch_branch_code,
    receivingBranchCode: row.receiving_branch_code,
    outboundDocNo: row.outbound_doc_no,
    outboundDocType: row.outbound_doc_type,
    outboundBranchCode: row.outbound_branch_code,
    inboundDocNo: row.inbound_doc_no,
    inboundDocType: row.inbound_doc_type,
    inboundBranchCode: row.inbound_branch_code,
    sourceMatchStatus: row.source_match_status,
    sourceMatchMethod: row.source_match_method,
    matchCandidateCount: Number(row.match_candidate_count || 0),
    inboundProcessState: row.inbound_process_state,
    expectedTotalQtyBase: Number(row.expected_total_qty_base || 0),
    sourceReceivedTotalQtyBase: Number(row.source_received_total_qty_base || 0),
    qtyDeltaSource: Number(row.qty_delta_source || 0),
    latestSourceSyncedAt: row.latest_source_synced_at,
    resolutionStatus: row.resolution_status || "draft",
    confirmedBy: row.confirmed_by,
    approvedBy: row.approved_by,
    resolvedAt: row.resolved_at,
    note: row.note || "",
  };
}

async function getCaseRecord(db, caseKey) {
  const result = await db.query(
    `
      SELECT case_key, receiving_branch_code
      FROM reconciliation.transfer_cases
      WHERE case_key = $1
    `,
    [caseKey],
  );
  return result.rows[0] || null;
}

async function getExistingReconciliation(db, caseKey) {
  const result = await db.query(
    `
      SELECT
        reconciliation_id,
        case_key,
        receiving_branch_code,
        resolution_status,
        confirmed_by,
        approved_by,
        resolved_at,
        note
      FROM reconciliation.transfer_reconciliations
      WHERE case_key = $1
    `,
    [caseKey],
  );
  return result.rows[0] || null;
}

async function upsertReconciliation(db, options) {
  const {
    caseKey,
    receivingBranchCode,
    resolutionStatus,
    confirmedBy,
    approvedBy,
    resolvedAt,
    note,
  } = options;

  const result = await db.query(
    `
      INSERT INTO reconciliation.transfer_reconciliations
        (
          case_key,
          receiving_branch_code,
          resolution_status,
          confirmed_by,
          approved_by,
          resolved_at,
          note,
          updated_at
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (case_key) DO UPDATE SET
        receiving_branch_code = EXCLUDED.receiving_branch_code,
        resolution_status = EXCLUDED.resolution_status,
        confirmed_by = EXCLUDED.confirmed_by,
        approved_by = EXCLUDED.approved_by,
        resolved_at = EXCLUDED.resolved_at,
        note = EXCLUDED.note,
        updated_at = now()
      RETURNING reconciliation_id, case_key, resolution_status, confirmed_by, approved_by, resolved_at, note
    `,
    [caseKey, receivingBranchCode, resolutionStatus, confirmedBy, approvedBy, resolvedAt, note || null],
  );
  return result.rows[0];
}

async function appendReconciliationEvent(db, reconciliationId, eventType, actor, note, payload) {
  const result = await db.query(
    `
      INSERT INTO reconciliation.transfer_reconciliation_events
        (
          reconciliation_id,
          event_type,
          actor_user_id,
          actor_role,
          note,
          payload,
          created_at
        )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
      RETURNING reconciliation_event_id, created_at
    `,
    [
      reconciliationId,
      eventType,
      actor.userId,
      actor.role,
      note || null,
      payload ? JSON.stringify(payload) : null,
    ],
  );
  return result.rows[0];
}

function createReconciliationRouter(deps) {
  const { db, requireAuthMiddleware, requireCsrfMiddleware } = deps;
  const router = express.Router();

  router.get("/summary", requireAuthMiddleware, async (req, res, next) => {
    try {
      const branch = parseOptionalText(req.query.branch);
      const dateFrom = parseOptionalDate(req.query.dateFrom);
      const dateTo = parseOptionalDate(req.query.dateTo);
      const status = normalizeStatusFilter(req.query.status);

      if ((req.query.dateFrom && !dateFrom) || (req.query.dateTo && !dateTo)) {
        return res.status(400).json({
          error: "dateFrom/dateTo must use YYYY-MM-DD format",
          request_id: req.requestId,
        });
      }

      if (status?.type === "invalid") {
        return res.status(400).json({
          error: "Unsupported status filter",
          request_id: req.requestId,
        });
      }

      const params = [];
      const whereClause = buildCaseFilterClause({ branch, dateFrom, dateTo, status }, params);
      const result = await db.query(
        `
          SELECT
            COUNT(*)::integer AS total_cases,
            COUNT(*) FILTER (WHERE tc.source_match_status = 'outbound_only')::integer AS outbound_only_count,
            COUNT(*) FILTER (WHERE tc.source_match_status = 'inbound_present_unprocessed')::integer AS inbound_present_unprocessed_count,
            COUNT(*) FILTER (WHERE tc.source_match_status = 'inbound_processed')::integer AS inbound_processed_count,
            COUNT(*) FILTER (WHERE tc.source_match_status = 'ambiguous_match')::integer AS ambiguous_match_count,
            COUNT(*) FILTER (WHERE tc.source_match_status = 'inbound_only_unmatched')::integer AS inbound_only_unmatched_count,
            COUNT(*) FILTER (WHERE tc.source_match_status = 'other')::integer AS other_count,
            COUNT(*) FILTER (WHERE COALESCE(tr.resolution_status, 'draft') = 'draft')::integer AS draft_count,
            COUNT(*) FILTER (WHERE COALESCE(tr.resolution_status, 'draft') = 'confirmed')::integer AS confirmed_count,
            COUNT(*) FILTER (WHERE COALESCE(tr.resolution_status, 'draft') = 'discrepancy_recorded')::integer AS discrepancy_recorded_count,
            COUNT(*) FILTER (WHERE COALESCE(tr.resolution_status, 'draft') = 'approved')::integer AS approved_count,
            COUNT(*) FILTER (WHERE COALESCE(tr.resolution_status, 'draft') = 'cancelled')::integer AS cancelled_count
          FROM reconciliation.transfer_cases tc
          LEFT JOIN reconciliation.transfer_reconciliations tr
            ON tr.case_key = tc.case_key
          ${whereClause}
        `,
        params,
      );

      const row = result.rows[0] || {};
      return res.json({
        filters: {
          branch,
          dateFrom,
          dateTo,
          status: status?.value || null,
        },
        totalCases: Number(row.total_cases || 0),
        bySourceMatchStatus: {
          outbound_only: Number(row.outbound_only_count || 0),
          inbound_present_unprocessed: Number(row.inbound_present_unprocessed_count || 0),
          inbound_processed: Number(row.inbound_processed_count || 0),
          ambiguous_match: Number(row.ambiguous_match_count || 0),
          inbound_only_unmatched: Number(row.inbound_only_unmatched_count || 0),
          other: Number(row.other_count || 0),
        },
        byResolutionStatus: {
          draft: Number(row.draft_count || 0),
          confirmed: Number(row.confirmed_count || 0),
          discrepancy_recorded: Number(row.discrepancy_recorded_count || 0),
          approved: Number(row.approved_count || 0),
          cancelled: Number(row.cancelled_count || 0),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/cases", requireAuthMiddleware, async (req, res, next) => {
    try {
      const branch = parseOptionalText(req.query.branch);
      const dateFrom = parseOptionalDate(req.query.dateFrom);
      const dateTo = parseOptionalDate(req.query.dateTo);
      const status = normalizeStatusFilter(req.query.status);
      const limit = parsePositiveInt(req.query.limit, 50);
      const offset = parseNonNegativeInt(req.query.offset, 0);

      if ((req.query.dateFrom && !dateFrom) || (req.query.dateTo && !dateTo)) {
        return res.status(400).json({
          error: "dateFrom/dateTo must use YYYY-MM-DD format",
          request_id: req.requestId,
        });
      }

      if (status?.type === "invalid") {
        return res.status(400).json({
          error: "Unsupported status filter",
          request_id: req.requestId,
        });
      }

      if (limit == null || offset == null) {
        return res.status(400).json({
          error: "limit and offset must be non-negative integers",
          request_id: req.requestId,
        });
      }

      const filters = { branch, dateFrom, dateTo, status };
      const countParams = [];
      const whereClause = buildCaseFilterClause(filters, countParams);
      const countResult = await db.query(
        `
          SELECT COUNT(*)::integer AS total
          FROM reconciliation.transfer_cases tc
          LEFT JOIN reconciliation.transfer_reconciliations tr
            ON tr.case_key = tc.case_key
          ${whereClause}
        `,
        countParams,
      );

      const listParams = [];
      const listWhereClause = buildCaseFilterClause(filters, listParams);
      listParams.push(limit);
      listParams.push(offset);
      const listResult = await db.query(
        `
          SELECT
            tc.case_key,
            tc.case_doc_date,
            tc.dispatch_branch_code,
            tc.receiving_branch_code,
            tc.outbound_doc_no,
            tc.outbound_doc_type,
            tc.outbound_branch_code,
            tc.inbound_doc_no,
            tc.inbound_doc_type,
            tc.inbound_branch_code,
            tc.source_match_status,
            tc.source_match_method,
            tc.match_candidate_count,
            tc.inbound_process_state,
            tc.expected_total_qty_base,
            tc.source_received_total_qty_base,
            tc.qty_delta_source,
            tc.latest_source_synced_at,
            COALESCE(tr.resolution_status, 'draft') AS resolution_status,
            tr.confirmed_by,
            tr.approved_by,
            tr.resolved_at,
            tr.note,
            COUNT(tcl.transfer_case_line_id)::integer AS line_count
          FROM reconciliation.transfer_cases tc
          LEFT JOIN reconciliation.transfer_reconciliations tr
            ON tr.case_key = tc.case_key
          LEFT JOIN reconciliation.transfer_case_lines tcl
            ON tcl.case_key = tc.case_key
          ${listWhereClause}
          GROUP BY
            tc.case_key,
            tc.case_doc_date,
            tc.dispatch_branch_code,
            tc.receiving_branch_code,
            tc.outbound_doc_no,
            tc.outbound_doc_type,
            tc.outbound_branch_code,
            tc.inbound_doc_no,
            tc.inbound_doc_type,
            tc.inbound_branch_code,
            tc.source_match_status,
            tc.source_match_method,
            tc.match_candidate_count,
            tc.inbound_process_state,
            tc.expected_total_qty_base,
            tc.source_received_total_qty_base,
            tc.qty_delta_source,
            tc.latest_source_synced_at,
            tr.resolution_status,
            tr.confirmed_by,
            tr.approved_by,
            tr.resolved_at,
            tr.note
          ORDER BY tc.case_doc_date DESC NULLS LAST, tc.case_key ASC
          LIMIT $${listParams.length - 1}
          OFFSET $${listParams.length}
        `,
        listParams,
      );

      return res.json({
        total: Number(countResult.rows[0]?.total || 0),
        limit,
        offset,
        rows: listResult.rows.map((row) => ({
          ...mapCaseRow(row),
          lineCount: Number(row.line_count || 0),
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/cases/:caseKey", requireAuthMiddleware, async (req, res, next) => {
    try {
      const caseKey = parseOptionalText(req.params.caseKey);
      if (!caseKey) {
        return res.status(400).json({
          error: "caseKey is required",
          request_id: req.requestId,
        });
      }

      const caseResult = await db.query(
        `
          SELECT
            tc.case_key,
            tc.case_doc_date,
            tc.dispatch_branch_code,
            tc.receiving_branch_code,
            tc.outbound_doc_no,
            tc.outbound_doc_type,
            tc.outbound_branch_code,
            tc.inbound_doc_no,
            tc.inbound_doc_type,
            tc.inbound_branch_code,
            tc.source_match_status,
            tc.source_match_method,
            tc.match_candidate_count,
            tc.inbound_process_state,
            tc.expected_total_qty_base,
            tc.source_received_total_qty_base,
            tc.qty_delta_source,
            tc.latest_source_synced_at,
            COALESCE(tr.resolution_status, 'draft') AS resolution_status,
            tr.confirmed_by,
            tr.approved_by,
            tr.resolved_at,
            tr.note
          FROM reconciliation.transfer_cases tc
          LEFT JOIN reconciliation.transfer_reconciliations tr
            ON tr.case_key = tc.case_key
          WHERE tc.case_key = $1
        `,
        [caseKey],
      );

      if (!caseResult.rowCount) {
        return res.status(404).json({
          error: "Reconciliation case not found",
          request_id: req.requestId,
        });
      }

      const linesResult = await db.query(
        `
          SELECT
            line_key,
            case_key,
            product_code,
            barcode,
            unit_code,
            lot_no,
            expiry_date,
            outbound_qty_base,
            inbound_qty_base,
            qty_delta_source,
            line_status
          FROM reconciliation.transfer_case_lines
          WHERE case_key = $1
          ORDER BY line_key ASC
        `,
        [caseKey],
      );

      const appLinesResult = await db.query(
        `
          SELECT
            trl.reconciliation_line_id,
            trl.reconciliation_id,
            trl.product_code,
            trl.source_barcode,
            trl.source_unit_code,
            trl.lot_no,
            trl.expiry_date,
            trl.expected_qty_base,
            trl.actual_received_qty_base,
            trl.note
          FROM reconciliation.transfer_reconciliations tr
          JOIN reconciliation.transfer_reconciliation_lines trl
            ON trl.reconciliation_id = tr.reconciliation_id
          WHERE tr.case_key = $1
          ORDER BY trl.reconciliation_line_id ASC
        `,
        [caseKey],
      );

      const eventsResult = await db.query(
        `
          SELECT
            tre.reconciliation_event_id,
            tre.reconciliation_id,
            tre.event_type,
            tre.actor_user_id,
            tre.actor_role,
            tre.note,
            tre.payload,
            tre.created_at
          FROM reconciliation.transfer_reconciliations tr
          JOIN reconciliation.transfer_reconciliation_events tre
            ON tre.reconciliation_id = tr.reconciliation_id
          WHERE tr.case_key = $1
          ORDER BY tre.created_at DESC, tre.reconciliation_event_id DESC
        `,
        [caseKey],
      );

      return res.json({
        case: mapCaseRow(caseResult.rows[0]),
        sourceLines: linesResult.rows.map((row) => ({
          lineKey: row.line_key,
          caseKey: row.case_key,
          productCode: row.product_code,
          barcode: row.barcode,
          unitCode: row.unit_code,
          lotNo: row.lot_no,
          expiryDate: row.expiry_date,
          outboundQtyBase: Number(row.outbound_qty_base || 0),
          inboundQtyBase: Number(row.inbound_qty_base || 0),
          qtyDeltaSource: Number(row.qty_delta_source || 0),
          lineStatus: row.line_status,
        })),
        reconciliationLines: appLinesResult.rows.map((row) => ({
          reconciliationLineId: Number(row.reconciliation_line_id),
          reconciliationId: Number(row.reconciliation_id),
          productCode: row.product_code,
          sourceBarcode: row.source_barcode,
          sourceUnitCode: row.source_unit_code,
          lotNo: row.lot_no,
          expiryDate: row.expiry_date,
          expectedQtyBase: Number(row.expected_qty_base || 0),
          actualReceivedQtyBase: Number(row.actual_received_qty_base || 0),
          note: row.note || "",
        })),
        events: eventsResult.rows.map((row) => ({
          reconciliationEventId: Number(row.reconciliation_event_id),
          reconciliationId: Number(row.reconciliation_id),
          eventType: row.event_type,
          actorUserId: row.actor_user_id,
          actorRole: row.actor_role,
          note: row.note || "",
          payload: row.payload || null,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/cases/:caseKey/confirm-receipt", requireAuthMiddleware, requireCsrfMiddleware, async (req, res, next) => {
    try {
      const caseKey = parseRequiredText(req.params.caseKey, "caseKey");
      const productCode = parseRequiredText(req.body?.productCode, "productCode");
      const actualReceivedQtyBase = parseOptionalNumber(req.body?.actualReceivedQtyBase);
      if (actualReceivedQtyBase == null) {
        return res.status(400).json({
          error: "actualReceivedQtyBase must be a number",
          request_id: req.requestId,
        });
      }

      const caseRecord = await getCaseRecord(db, caseKey);
      if (!caseRecord) {
        return res.status(404).json({
          error: "Reconciliation case not found",
          request_id: req.requestId,
        });
      }

      const note = parseOptionalText(req.body?.note);
      const expectedQtyBase = parseOptionalNumber(req.body?.expectedQtyBase);
      const sourceBarcode = parseOptionalText(req.body?.sourceBarcode);
      const sourceUnitCode = parseOptionalText(req.body?.sourceUnitCode);
      const lotNo = parseOptionalText(req.body?.lotNo);
      const expiryDate = parseOptionalDate(req.body?.expiryDate);

      const reconciliation = await upsertReconciliation(db, {
        caseKey,
        receivingBranchCode: caseRecord.receiving_branch_code,
        resolutionStatus: "confirmed",
        confirmedBy: req.auth.userId,
        approvedBy: null,
        resolvedAt: null,
        note,
      });

      let lineResult = await db.query(
        `
          UPDATE reconciliation.transfer_reconciliation_lines
          SET
            expected_qty_base = $7,
            actual_received_qty_base = $8,
            note = $9,
            updated_at = now()
          WHERE reconciliation_id = $1
            AND product_code = $2
            AND COALESCE(source_barcode, '') = COALESCE($3, '')
            AND COALESCE(source_unit_code, '') = COALESCE($4, '')
            AND COALESCE(lot_no, '') = COALESCE($5, '')
            AND COALESCE(expiry_date::text, '') = COALESCE($6, '')
          RETURNING reconciliation_line_id
        `,
        [
          reconciliation.reconciliation_id,
          productCode,
          sourceBarcode,
          sourceUnitCode,
          lotNo,
          expiryDate,
          expectedQtyBase || 0,
          actualReceivedQtyBase,
          note,
        ],
      );

      if (!lineResult.rowCount) {
        lineResult = await db.query(
          `
            INSERT INTO reconciliation.transfer_reconciliation_lines
              (
                reconciliation_id,
                product_code,
                source_barcode,
                source_unit_code,
                lot_no,
                expiry_date,
                expected_qty_base,
                actual_received_qty_base,
                note,
                created_at,
                updated_at
              )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
            RETURNING reconciliation_line_id
          `,
          [
            reconciliation.reconciliation_id,
            productCode,
            sourceBarcode,
            sourceUnitCode,
            lotNo,
            expiryDate,
            expectedQtyBase || 0,
            actualReceivedQtyBase,
            note,
          ],
        );
      }

      const event = await appendReconciliationEvent(
        db,
        reconciliation.reconciliation_id,
        "confirm_receipt",
        req.auth,
        note,
        {
          productCode,
          actualReceivedQtyBase,
          expectedQtyBase,
          sourceBarcode,
          sourceUnitCode,
          lotNo,
          expiryDate,
        },
      );

      await auditLog(
        db,
        auditBase(req, {
          action: "reconciliation.confirm_receipt",
          target_type: "reconciliation_case",
          target_id: caseKey,
          success: true,
          message: note || "Confirmed actual received quantity",
          meta: {
            productCode,
            actualReceivedQtyBase,
            expectedQtyBase,
            reconciliationId: reconciliation.reconciliation_id,
            reconciliationLineId: lineResult.rows[0]?.reconciliation_line_id || null,
            reconciliationEventId: event.reconciliation_event_id,
          },
        }),
      );

      return res.json({
        ok: true,
        caseKey,
        reconciliationId: Number(reconciliation.reconciliation_id),
        resolutionStatus: reconciliation.resolution_status,
        reconciliationLineId: Number(lineResult.rows[0]?.reconciliation_line_id || 0),
        reconciliationEventId: Number(event.reconciliation_event_id),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/cases/:caseKey/discrepancy", requireAuthMiddleware, requireCsrfMiddleware, async (req, res, next) => {
    try {
      const caseKey = parseRequiredText(req.params.caseKey, "caseKey");
      const note = parseRequiredText(req.body?.note, "note");
      const reason = parseOptionalText(req.body?.reason);

      const caseRecord = await getCaseRecord(db, caseKey);
      if (!caseRecord) {
        return res.status(404).json({
          error: "Reconciliation case not found",
          request_id: req.requestId,
        });
      }

      const reconciliation = await upsertReconciliation(db, {
        caseKey,
        receivingBranchCode: caseRecord.receiving_branch_code,
        resolutionStatus: "discrepancy_recorded",
        confirmedBy: req.auth.userId,
        approvedBy: null,
        resolvedAt: null,
        note,
      });

      const event = await appendReconciliationEvent(
        db,
        reconciliation.reconciliation_id,
        "record_discrepancy",
        req.auth,
        note,
        {
          reason,
          payload: parseOptionalPayload(req.body?.payload),
        },
      );

      await auditLog(
        db,
        auditBase(req, {
          action: "reconciliation.record_discrepancy",
          target_type: "reconciliation_case",
          target_id: caseKey,
          success: true,
          message: note,
          meta: {
            reason,
            reconciliationId: reconciliation.reconciliation_id,
            reconciliationEventId: event.reconciliation_event_id,
          },
        }),
      );

      return res.json({
        ok: true,
        caseKey,
        reconciliationId: Number(reconciliation.reconciliation_id),
        resolutionStatus: reconciliation.resolution_status,
        reconciliationEventId: Number(event.reconciliation_event_id),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/cases/:caseKey/approve", requireAuthMiddleware, requireCsrfMiddleware, async (req, res, next) => {
    try {
      const caseKey = parseRequiredText(req.params.caseKey, "caseKey");
      const note = parseOptionalText(req.body?.note);

      const caseRecord = await getCaseRecord(db, caseKey);
      if (!caseRecord) {
        return res.status(404).json({
          error: "Reconciliation case not found",
          request_id: req.requestId,
        });
      }

      const reconciliation = await upsertReconciliation(db, {
        caseKey,
        receivingBranchCode: caseRecord.receiving_branch_code,
        resolutionStatus: "approved",
        confirmedBy: req.auth.userId,
        approvedBy: req.auth.userId,
        resolvedAt: new Date().toISOString(),
        note,
      });

      const event = await appendReconciliationEvent(
        db,
        reconciliation.reconciliation_id,
        "approve",
        req.auth,
        note,
        null,
      );

      await auditLog(
        db,
        auditBase(req, {
          action: "reconciliation.approve",
          target_type: "reconciliation_case",
          target_id: caseKey,
          success: true,
          message: note || "Approved reconciliation case",
          meta: {
            reconciliationId: reconciliation.reconciliation_id,
            reconciliationEventId: event.reconciliation_event_id,
          },
        }),
      );

      return res.json({
        ok: true,
        caseKey,
        reconciliationId: Number(reconciliation.reconciliation_id),
        resolutionStatus: reconciliation.resolution_status,
        reconciliationEventId: Number(event.reconciliation_event_id),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/cases/:caseKey/status", requireAuthMiddleware, requireCsrfMiddleware, async (req, res, next) => {
    try {
      const caseKey = parseRequiredText(req.params.caseKey, "caseKey");
      const action = parseRequiredText(req.body?.action, "action");
      if (!["cancel", "reopen"].includes(action)) {
        return res.status(400).json({
          error: "action must be cancel or reopen",
          request_id: req.requestId,
        });
      }

      const note = parseOptionalText(req.body?.note);
      const caseRecord = await getCaseRecord(db, caseKey);
      if (!caseRecord) {
        return res.status(404).json({
          error: "Reconciliation case not found",
          request_id: req.requestId,
        });
      }

      const reconciliation = await upsertReconciliation(db, {
        caseKey,
        receivingBranchCode: caseRecord.receiving_branch_code,
        resolutionStatus: action === "cancel" ? "cancelled" : "draft",
        confirmedBy: action === "reopen" ? null : req.auth.userId,
        approvedBy: null,
        resolvedAt: action === "cancel" ? new Date().toISOString() : null,
        note,
      });

      const event = await appendReconciliationEvent(
        db,
        reconciliation.reconciliation_id,
        action,
        req.auth,
        note,
        null,
      );

      await auditLog(
        db,
        auditBase(req, {
          action: `reconciliation.${action}`,
          target_type: "reconciliation_case",
          target_id: caseKey,
          success: true,
          message: note || `${action} reconciliation case`,
          meta: {
            reconciliationId: reconciliation.reconciliation_id,
            reconciliationEventId: event.reconciliation_event_id,
          },
        }),
      );

      return res.json({
        ok: true,
        caseKey,
        reconciliationId: Number(reconciliation.reconciliation_id),
        resolutionStatus: reconciliation.resolution_status,
        reconciliationEventId: Number(event.reconciliation_event_id),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/cases/:caseKey/events", requireAuthMiddleware, requireCsrfMiddleware, async (req, res, next) => {
    try {
      const caseKey = parseRequiredText(req.params.caseKey, "caseKey");
      const eventType = parseRequiredText(req.body?.eventType, "eventType");
      const note = parseOptionalText(req.body?.note);
      const payload = parseOptionalPayload(req.body?.payload);

      const caseRecord = await getCaseRecord(db, caseKey);
      if (!caseRecord) {
        return res.status(404).json({
          error: "Reconciliation case not found",
          request_id: req.requestId,
        });
      }

      const existingReconciliation = await getExistingReconciliation(db, caseKey);
      const reconciliation = existingReconciliation || await upsertReconciliation(db, {
        caseKey,
        receivingBranchCode: caseRecord.receiving_branch_code,
        resolutionStatus: "draft",
        confirmedBy: null,
        approvedBy: null,
        resolvedAt: null,
        note: null,
      });

      const event = await appendReconciliationEvent(
        db,
        reconciliation.reconciliation_id,
        eventType,
        req.auth,
        note,
        payload,
      );

      await auditLog(
        db,
        auditBase(req, {
          action: "reconciliation.append_event",
          target_type: "reconciliation_case",
          target_id: caseKey,
          success: true,
          message: note || `Appended reconciliation event: ${eventType}`,
          meta: {
            eventType,
            reconciliationId: reconciliation.reconciliation_id,
            reconciliationEventId: event.reconciliation_event_id,
          },
        }),
      );

      return res.json({
        ok: true,
        caseKey,
        reconciliationId: Number(reconciliation.reconciliation_id),
        reconciliationEventId: Number(event.reconciliation_event_id),
        eventType,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createReconciliationRouter,
};
