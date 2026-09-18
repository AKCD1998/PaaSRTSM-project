"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { acquireIngestionDbClient } = require("../utils/db-acquire");
const {
  ACTIVE_BRANCHES,
  computeNextMorningMetrics,
  parseCapturePayload,
} = require("../services/hourlyStockEvidence");

function timingSafeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authenticateBranch(config, req, branchCode) {
  const tokens = config.hourlyStockEvidenceBranchTokens;
  if (!(tokens instanceof Map) || tokens.size === 0) return { status: 503, message: "Hourly evidence ingestion is not configured." };
  const expected = tokens.get(branchCode);
  const headerBranch = String(req.get("x-branch-code") || "").trim();
  const token = String(req.get("x-hourly-evidence-token") || "");
  if (!expected || headerBranch !== branchCode || !timingSafeEqualStrings(token, expected)) {
    return { status: 401, message: "Invalid hourly evidence branch identity." };
  }
  return null;
}

async function persistCapture(client, capture) {
  await client.query("BEGIN");
  try {
    const inserted = await client.query(
      `INSERT INTO evidence.hourly_stock_capture_runs (
         idempotency_key, contract_version, branch_code, observation_kind,
         planned_slot, planned_for, captured_at, source_event_at, record_count,
         payload_sha256, client_meta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING capture_id, received_at`,
      [
        capture.idempotencyKey,
        capture.contractVersion,
        capture.branchCode,
        capture.observationKind,
        capture.plannedSlot,
        capture.plannedFor,
        capture.capturedAt,
        capture.sourceEventAt,
        capture.records.length,
        capture.payloadSha256,
        JSON.stringify(capture.clientMeta),
      ],
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query(
        `SELECT capture_id, branch_code, payload_sha256, record_count, received_at
           FROM evidence.hourly_stock_capture_runs
          WHERE idempotency_key = $1`,
        [capture.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row || row.branch_code !== capture.branchCode
          || row.payload_sha256 !== capture.payloadSha256
          || Number(row.record_count) !== capture.records.length) {
        const conflict = new Error("Idempotency key already exists with different content.");
        conflict.status = 409;
        throw conflict;
      }
      await client.query("COMMIT");
      return { duplicate: true, captureId: String(row.capture_id), receivedAt: row.received_at };
    }

    const captureId = inserted.rows[0].capture_id;
    await client.query(
      `INSERT INTO evidence.hourly_stock_capture_rows (
         capture_id, product_code, retail_on_hand, latest_estimated_on_hand
       )
       SELECT $1::bigint, product_code, retail_on_hand, latest_estimated_on_hand
         FROM UNNEST($2::text[], $3::numeric[], $4::numeric[])
              AS source(product_code, retail_on_hand, latest_estimated_on_hand)`,
      [
        captureId,
        capture.records.map((record) => record.productCode),
        capture.records.map((record) => record.retailOnHand),
        capture.records.map((record) => record.latestEstimatedOnHand),
      ],
    );
    await client.query("COMMIT");
    return {
      duplicate: false,
      captureId: String(captureId),
      receivedAt: inserted.rows[0].received_at,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  }
}

function parseDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) return null;
  return date;
}

function createHourlyStockEvidenceRouter({ config, db, requireAuthMiddleware, requireRoleMiddleware }) {
  const router = express.Router();

  router.post("/captures", async (req, res, next) => {
    let capture;
    try {
      capture = parseCapturePayload(req.body);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const authError = authenticateBranch(config, req, capture.branchCode);
    if (authError) return res.status(authError.status).json({ message: authError.message });

    const client = await acquireIngestionDbClient(db, res, "hourly-stock-evidence:/captures");
    if (!client) return undefined;
    try {
      const stored = await persistCapture(client, capture);
      return res.status(stored.duplicate ? 200 : 201).json({
        accepted: capture.records.length,
        duplicate: stored.duplicate,
        captureId: stored.captureId,
        plannedFor: capture.plannedFor,
        capturedAt: capture.capturedAt,
        receivedAt: stored.receivedAt,
        slotDelaySeconds: capture.slotDelaySeconds,
        ingestionDelaySeconds: (new Date(stored.receivedAt).getTime() - new Date(capture.capturedAt).getTime()) / 1000,
      });
    } catch (error) {
      return next(error);
    } finally {
      client.release?.();
    }
  });

  router.get(
    "/summary",
    requireAuthMiddleware,
    requireRoleMiddleware("admin"),
    async (req, res, next) => {
      const branchCode = String(req.query.branchCode || "").trim();
      const date = parseDate(req.query.date);
      if (!ACTIVE_BRANCHES.has(branchCode) || !date) {
        return res.status(400).json({ message: "Valid active branchCode and date are required." });
      }
      try {
        const result = await db.query(
          `WITH selected AS (
             SELECT 'morning' AS capture_role, capture_id, planned_slot,
                    captured_at, planned_for, received_at, 1::bigint AS capture_count
               FROM evidence.hourly_stock_capture_runs
              WHERE branch_code = $1 AND observation_kind = 'morning_anchor'
                AND (captured_at AT TIME ZONE 'Asia/Bangkok')::date = $2::date
              ORDER BY captured_at DESC LIMIT 1
           ), intraday_ranked AS (
             SELECT 'intraday' AS capture_role, capture_id, planned_slot,
                    captured_at, planned_for, received_at,
                    COUNT(*) OVER (PARTITION BY planned_slot) AS capture_count,
                    ROW_NUMBER() OVER (PARTITION BY planned_slot ORDER BY captured_at DESC) AS slot_rank
               FROM evidence.hourly_stock_capture_runs
              WHERE branch_code = $1 AND observation_kind = 'intraday'
                AND (captured_at AT TIME ZONE 'Asia/Bangkok')::date = $2::date
           ), intraday_slots AS (
             SELECT capture_role, capture_id, planned_slot, captured_at, planned_for, received_at, capture_count
               FROM intraday_ranked WHERE slot_rank = 1
           ), next_morning AS (
             SELECT 'next_morning' AS capture_role, capture_id, planned_slot,
                    captured_at, planned_for, received_at, 1::bigint AS capture_count
               FROM evidence.hourly_stock_capture_runs
              WHERE branch_code = $1 AND observation_kind = 'morning_anchor'
                AND (captured_at AT TIME ZONE 'Asia/Bangkok')::date = ($2::date + 1)
              ORDER BY captured_at DESC LIMIT 1
           ), captures AS (
             SELECT * FROM selected UNION ALL SELECT * FROM intraday_slots UNION ALL SELECT * FROM next_morning
           )
           SELECT captures.capture_role, captures.captured_at, captures.planned_for, captures.received_at,
                  captures.planned_slot, captures.capture_count, rows.product_code,
                  rows.retail_on_hand::double precision AS retail_on_hand,
                  rows.latest_estimated_on_hand::double precision AS latest_estimated_on_hand
             FROM captures
             JOIN evidence.hourly_stock_capture_rows rows USING (capture_id)
            ORDER BY captures.capture_role, rows.product_code`,
          [branchCode, date],
        );
        const grouped = { morning: [], closing: [], next_morning: [] };
        const slotEvidence = { morning: null, intraday: [], nextMorning: null };
        const seenCaptures = new Set();
        for (const row of result.rows) {
          const captureKey = `${row.capture_role}:${row.planned_slot}`;
          if (!seenCaptures.has(captureKey)) {
            seenCaptures.add(captureKey);
            const evidence = {
              plannedSlot: row.planned_slot,
              plannedFor: row.planned_for,
              capturedAt: row.captured_at,
              receivedAt: row.received_at,
              slotDelaySeconds: (new Date(row.captured_at).getTime() - new Date(row.planned_for).getTime()) / 1000,
              ingestionDelaySeconds: (new Date(row.received_at).getTime() - new Date(row.captured_at).getTime()) / 1000,
              captureCount: Number(row.capture_count),
              duplicateCaptureCount: Math.max(0, Number(row.capture_count) - 1),
            };
            if (row.capture_role === "intraday") slotEvidence.intraday.push(evidence);
            else if (row.capture_role === "morning") slotEvidence.morning = evidence;
            else slotEvidence.nextMorning = evidence;
          }
          const metricRole = row.capture_role === "intraday" && row.planned_slot === "19:00"
            ? "closing"
            : row.capture_role;
          if (!(metricRole in grouped)) continue;
          grouped[metricRole].push({
            productCode: row.product_code,
            retailOnHand: Number(row.retail_on_hand),
            latestEstimatedOnHand: row.latest_estimated_on_hand == null ? null : Number(row.latest_estimated_on_hand),
          });
        }
        const missingSlots = Object.entries(grouped).filter(([, rows]) => rows.length === 0).map(([role]) => role);
        const expectedPlannedSlots = Array.from({ length: 11 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`);
        const capturedPlannedSlots = slotEvidence.intraday.map((slot) => slot.plannedSlot).sort();
        const capturedSlotSet = new Set(capturedPlannedSlots);
        const missingPlannedSlots = expectedPlannedSlots.filter((slot) => !capturedSlotSet.has(slot));
        const comparisonStatus = missingSlots.length === 0 ? "compared" : "incomplete";
        return res.json({
          branchCode,
          date,
          comparisonStatus,
          dailyCompletenessStatus: missingPlannedSlots.length === 0 ? "complete" : "incomplete",
          missingSlots,
          expectedPlannedSlots,
          capturedPlannedSlots,
          missingPlannedSlots,
          slotEvidence,
          metrics: comparisonStatus === "compared" ? computeNextMorningMetrics({
            morningAnchorRows: grouped.morning,
            closingRows: grouped.closing,
            nextMorningRows: grouped.next_morning,
          }) : null,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

module.exports = {
  authenticateBranch,
  createHourlyStockEvidenceRouter,
  persistCapture,
  timingSafeEqualStrings,
};
