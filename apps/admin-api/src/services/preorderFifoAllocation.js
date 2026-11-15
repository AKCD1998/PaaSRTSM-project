"use strict";

const { sameUnit } = require("./preorderReceiptEvidence");
const { estimateBranchEta } = require("./preorderEta");

function fail(statusCode, message, extra = {}) {
  throw Object.assign(new Error(message), { statusCode, ...extra });
}

function requireFulfillment(auth) {
  const workspace = auth?.preorderWorkspace;
  if (workspace?.role !== "fulfillment" || !workspace.capabilities?.includes("receipts.link")) fail(403, "Forbidden");
}

async function nextActivitySequence(client, caseId) {
  const result = await client.query(
    "SELECT GREATEST(COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_events WHERE case_id=$1),0),COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_messages WHERE case_id=$1),0))+1 AS seq",
    [caseId],
  );
  return Number(result.rows[0]?.seq || 1);
}

async function coverage(client, caseId) {
  const result = await client.query(
    `SELECT i.item_id,COALESCE(i.confirmed_qty,i.requested_qty)::numeric required_qty,
            COALESCE(SUM(e.allocated_qty) FILTER(WHERE e.unlinked_at IS NULL AND e.evidence_type='HQ_RECEIPT'),0)::numeric allocated_qty
     FROM customer_relations.preorder_items i
     LEFT JOIN customer_relations.preorder_evidence_links e ON e.item_id=i.item_id
     WHERE i.case_id=$1 GROUP BY i.item_id,i.confirmed_qty,i.requested_qty`,
    [caseId],
  );
  return result.rows.length > 0 && result.rows.every((row) => Number(row.allocated_qty) >= Number(row.required_qty));
}

async function recordEta(client, row, observedAt, actorUserId) {
  if (!observedAt) return null;
  const evidence = await client.query("SELECT $1::timestamptz::date AS evidence_date", [observedAt]);
  const evidenceDate = String(evidence.rows[0]?.evidence_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidenceDate)) return null;
  const schedules = await client.query("SELECT iso_weekday FROM customer_relations.branch_delivery_schedules WHERE branch_code=$1 AND is_active=TRUE ORDER BY iso_weekday", [row.branch_code]);
  const weekdays = schedules.rows.map((entry) => Number(entry.iso_weekday));
  if (!weekdays.length) return null;
  const estimatedDate = estimateBranchEta({ evidenceAt: `${evidenceDate}T12:00:00+07:00`, branchCode: row.branch_code, weekdays });
  if (!estimatedDate) return null;
  const version = await client.query("SELECT COALESCE(MAX(version),0)+1 version FROM customer_relations.preorder_eta_projections WHERE case_id=$1", [row.case_id]);
  await client.query(
    "INSERT INTO customer_relations.preorder_eta_projections(case_id,version,estimated_date,basis,source_evidence_date,calculated_by) VALUES($1,$2,$3,'NEXT_SCHEDULED_DAY_AFTER_HQ_RECEIPT',$4,$5)",
    [row.case_id, Number(version.rows[0].version), estimatedDate, evidenceDate, actorUserId],
  );
  return estimatedDate;
}

function createPreorderFifoAllocation({ db }) {
  async function allocate(auth, batchId, body = {}) {
    requireFulfillment(auth);
    const expectedBatchVersion = Number(body.expectedBatchVersion);
    if (!Number.isInteger(expectedBatchVersion) || expectedBatchVersion < 1) fail(400, "expectedBatchVersion ไม่ถูกต้อง");
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(batchId || ""))) fail(400, "batchId ไม่ถูกต้อง");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const sourceResult = await client.query(
        `SELECT b.*,h.doc_date,h.doc_time,h.source_synced_at,l.seq_no,l.product_code AS receipt_product_code,
                l.product_name,l.unit_code AS receipt_unit_code,l.unit_name AS receipt_unit_name,
                l.qty,l.qty_base,l.lot_no AS source_lot_no,l.expired_date
         FROM customer_relations.preorder_hq_receipt_batches b
         JOIN ada.approved_receipt_headers h ON h.doc_no=b.source_doc_no AND h.branch_code=b.source_branch_code
         JOIN ada.approved_receipt_lines l ON l.doc_no=h.doc_no AND l.seq_no=b.source_line_seq
         JOIN core.branches br ON br.branch_code=h.branch_code AND br.is_hq=TRUE
         WHERE b.batch_id=$1 FOR UPDATE OF b,l`,
        [String(batchId)],
      );
      const source = sourceResult.rows[0];
      if (!source) fail(404, "ไม่พบรายการรับเข้า HQ");
      if (Number(source.version) !== expectedBatchVersion) fail(409, "จำนวนตรวจรับเปลี่ยนแปลง กรุณาโหลดใหม่", { code: "BATCH_VERSION_CONFLICT", current: { batchVersion: Number(source.version), quantity: Number(source.verified_quantity) } });
      if (Number(source.version) <= 0 || source.verified_quantity == null) fail(409, "ต้องบันทึกจำนวนตรวจรับจริงก่อนจัดสรร");
      const photos = await client.query("SELECT 1 FROM customer_relations.preorder_hq_receipt_photos WHERE batch_id=$1 AND upload_state='ready' LIMIT 1", [source.batch_id]);
      if (!photos.rows[0]) fail(409, "ไม่พบรูปสินค้ารับเข้า กรุณาแนบรูปก่อนจัดสรร");
      const receiptUnit = String(source.receipt_unit_code || source.receipt_unit_name || "").trim();
      const verifiedUnit = String(source.unit_code || "").trim();
      if (!receiptUnit || !verifiedUnit || !sameUnit(verifiedUnit, receiptUnit)) fail(409, "หน่วยตรวจรับไม่ตรงกับเอกสารรับเข้า");

      const existingSourceUse = await client.query(
        "SELECT COALESCE(SUM(COALESCE(source_allocated_qty,allocated_qty)),0)::numeric qty FROM customer_relations.preorder_evidence_links WHERE evidence_type='HQ_RECEIPT' AND source_key=$1 AND unlinked_at IS NULL",
        [source.source_key],
      );
      let available = Math.max(0, Number(source.verified_quantity) - Number(existingSourceUse.rows[0]?.qty || 0));
      const queued = await client.query(
        `SELECT c.case_id,c.public_id,c.branch_code,c.intent,c.status,c.version,c.created_at,
                i.item_id,i.position,COALESCE(i.product_code_snapshot,s.company_code) AS product_code,
                i.unit_snapshot,COALESCE(i.confirmed_qty,i.requested_qty)::numeric AS required_qty
         FROM customer_relations.preorder_cases c
         JOIN customer_relations.preorder_items i ON i.case_id=c.case_id
         LEFT JOIN public.skus s ON s.sku_id=COALESCE(i.sku_id,i.matched_sku_id)
         WHERE c.intent='ORDER_REQUEST' AND c.status IN ('ORDERED','RECEIVED_AT_HQ')
           AND lower(COALESCE(i.product_code_snapshot,s.company_code))=lower($1)
           AND NOT EXISTS (SELECT 1 FROM customer_relations.preorder_attachments a WHERE a.case_id=c.case_id AND a.message_id IS NULL AND a.upload_state<>'ready')
         ORDER BY c.created_at ASC,c.case_id ASC,i.position ASC
         FOR UPDATE OF c`,
        [source.product_code, source.source_key],
      );

      const allocations = [];
      const blocked = [];
      for (const queuedItem of queued.rows) {
        if (available <= 0) break;
        const current = await client.query(
          `SELECT i.item_id,i.unit_snapshot,COALESCE(i.confirmed_qty,i.requested_qty)::numeric required_qty,
                  COALESCE(SUM(e.allocated_qty) FILTER(WHERE e.unlinked_at IS NULL AND e.evidence_type='HQ_RECEIPT'),0)::numeric allocated_qty
           FROM customer_relations.preorder_items i LEFT JOIN customer_relations.preorder_evidence_links e ON e.item_id=i.item_id
           WHERE i.case_id=$1 AND i.item_id=$2 GROUP BY i.item_id,i.unit_snapshot,i.confirmed_qty,i.requested_qty`,
          [queuedItem.case_id, queuedItem.item_id],
        );
        const item = current.rows[0];
        if (!item) continue;
        if (!sameUnit(item.unit_snapshot, verifiedUnit)) {
          blocked.push({ publicId: queuedItem.public_id, branchCode: queuedItem.branch_code, itemId: Number(queuedItem.item_id), reason: "UNIT_MISMATCH" });
          break;
        }
        const targetQty = Math.min(available, Math.max(0, Number(item.required_qty) - Number(item.allocated_qty)));
        if (targetQty <= 0) continue;
        const sourceKey = source.source_key;
        const snapshot = {
          docNo: source.source_doc_no, seqNo: Number(source.source_line_seq), ownerBranch: source.source_branch_code,
          docDate: String(source.doc_date).slice(0, 10), docTime: source.doc_time, productCode: source.receipt_product_code,
          productName: source.product_name, sourceQty: Number(source.qty), sourceQtyBase: Number(source.qty_base),
          sourceUnit: verifiedUnit, lotNo: source.lot_no || source.source_lot_no || null,
          expiredDate: source.expiry_date || source.expired_date || null, supplierLabel: null,
        };
        await client.query(
          `INSERT INTO customer_relations.preorder_evidence_links(case_id,item_id,evidence_type,source_key,allocated_qty,unit,snapshot_json,source_synced_at,linked_by,source_allocated_qty,source_unit,target_unit)
           VALUES($1,$2,'HQ_RECEIPT',$3,$4,$5,$6::jsonb,$7,$8,$4,$5,$5)`,
          [queuedItem.case_id, queuedItem.item_id, sourceKey, targetQty, verifiedUnit, JSON.stringify(snapshot), source.source_synced_at, auth.userId],
        );
        available -= targetQty;
        const liveCase = await client.query("SELECT status,branch_code FROM customer_relations.preorder_cases WHERE case_id=$1", [queuedItem.case_id]);
        const fromStatus = liveCase.rows[0]?.status || queuedItem.status;
        const complete = await coverage(client, queuedItem.case_id);
        const nextStatus = complete ? "RECEIVED_AT_HQ" : fromStatus;
        const eta = complete && fromStatus !== "RECEIVED_AT_HQ" ? await recordEta(client, { ...queuedItem, branch_code: liveCase.rows[0]?.branch_code || queuedItem.branch_code }, source.last_observed_at, auth.userId) : null;
        await client.query("UPDATE customer_relations.preorder_cases SET status=$2,version=version+1,last_activity_at=now(),updated_at=now() WHERE case_id=$1", [queuedItem.case_id, nextStatus]);
        const seq = await nextActivitySequence(client, queuedItem.case_id);
        await client.query(
          `INSERT INTO customer_relations.preorder_events(case_id,activity_seq,event_type,actor_user_id,actor_role,from_status,to_status,payload_json)
           VALUES($1,$2,'HQ_RECEIPT_LINKED',$3,'fulfillment',$4,$5,$6::jsonb)`,
          [queuedItem.case_id, seq, auth.userId, fromStatus, nextStatus, JSON.stringify({ itemId: Number(queuedItem.item_id), allocatedQty: targetQty, sourceKey, priority: "OLDEST_FIRST", eta })],
        );
        await client.query(
          "INSERT INTO customer_relations.preorder_notifications(case_id,recipient_role,recipient_branch_code,activity_seq,notification_type) VALUES($1,'staff',$2,$3,'HQ_RECEIPT_LINKED')",
          [queuedItem.case_id, queuedItem.branch_code, seq],
        );
        allocations.push({ publicId: queuedItem.public_id, branchCode: queuedItem.branch_code, itemId: Number(queuedItem.item_id), allocatedQty: targetQty, unit: verifiedUnit, createdAt: queuedItem.created_at, status: nextStatus, eta });
      }

      await client.query("COMMIT");
      return { sourceKey: source.source_key, physicalQuantity: Number(source.verified_quantity), allocatedQty: Number(source.verified_quantity) - available - Number(existingSourceUse.rows[0]?.qty || 0), remainingPhysicalQty: available, allocations, blocked };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }
  }

  return { allocate };
}

module.exports = { createPreorderFifoAllocation };
