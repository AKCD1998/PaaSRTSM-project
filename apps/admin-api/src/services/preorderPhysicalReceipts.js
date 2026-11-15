"use strict";

const crypto = require("crypto");
const { sourceKey: makeSourceKey, sameUnit } = require("./preorderReceiptEvidence");
const { expectedVersion } = require("./preorderWorkflow");
const { validateImages } = require("./preorderAttachments");

function fail(statusCode, message, extra = {}) {
  throw Object.assign(new Error(message), { statusCode, ...extra });
}

function parseCount(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,4})?$/.test(text)) fail(400, "จำนวนตรวจรับต้องเป็นตัวเลขไม่เกิน 4 ตำแหน่งทศนิยม");
  const number = Number(text);
  if (!Number.isFinite(number) || number > 9999999999.9999) fail(400, "จำนวนตรวจรับไม่ถูกต้อง");
  return text;
}

function isoTimestamp(value) {
  const text = String(value || "").trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) || !Number.isFinite(Date.parse(text))) {
    fail(400, "เวลาตรวจรับต้องระบุ timezone ให้ชัดเจน");
  }
  return new Date(text).toISOString();
}

function expectedBatchVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) fail(400, "expectedBatchVersion ไม่ถูกต้อง");
  return version;
}

function optionalDate(value, label) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    fail(400, `${label}ต้องเป็นวันที่ YYYY-MM-DD`);
  }
  return text;
}

function requireFulfillment(auth) {
  const workspace = auth?.preorderWorkspace;
  if (workspace?.role !== "fulfillment" || !workspace.capabilities?.includes("receipts.physical.record")) {
    fail(403, "Forbidden");
  }
}

function validUuid(value) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(value || ""));
}

async function nextActivitySequence(client, caseId) {
  const result = await client.query(
    "SELECT GREATEST(COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_events WHERE case_id=$1),0),COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_messages WHERE case_id=$1),0))+1 AS seq",
    [caseId],
  );
  return Number(result.rows[0]?.seq || 1);
}

function createPreorderPhysicalReceipts({ db, config = {}, storageProvider = null }) {
  async function decorateCandidates(auth, candidates) {
    if (auth?.preorderWorkspace?.role !== "fulfillment" || candidates.length === 0) return candidates;
    const keys = candidates.map((candidate) => candidate.sourceKey);
    const result = await db.query(
      "SELECT batch_id,source_key,verified_quantity,unit_code,version,last_observed_at,lot_no,manufactured_date,expiry_date FROM customer_relations.preorder_hq_receipt_batches WHERE source_key=ANY($1::text[])",
      [keys],
    );
    const batches = new Map(result.rows.map((row) => [row.source_key, row]));
    const batchIds = result.rows.map((row) => row.batch_id);
    const photoResult = batchIds.length ? await db.query(
      "SELECT batch_id,photo_public_id,original_filename,size_bytes,created_at FROM customer_relations.preorder_hq_receipt_photos WHERE batch_id=ANY($1::uuid[]) AND upload_state='ready' ORDER BY created_at",
      [batchIds],
    ) : { rows: [] };
    const photosByBatch = new Map();
    for (const photo of photoResult.rows) {
      const photos = photosByBatch.get(photo.batch_id) || [];
      photos.push({ photoPublicId: photo.photo_public_id, filename: photo.original_filename, sizeBytes: Number(photo.size_bytes), createdAt: photo.created_at });
      photosByBatch.set(photo.batch_id, photos);
    }
    return candidates.map((candidate) => {
      const batch = batches.get(candidate.sourceKey);
      const version = Number(batch?.version || 0);
      const quantity = version > 0 ? Number(batch.verified_quantity) : null;
      const available = Math.max(0, Number(quantity || 0) - Number(candidate.source_allocated_qty || 0));
      return {
        ...candidate,
        physicalQuantity: quantity,
        physicalUnit: batch?.unit_code || null,
        physicalVersion: version,
        physicalObservedAt: batch?.last_observed_at || null,
        batchId: batch?.batch_id || null,
        physicalLotNo: batch?.lot_no || null,
        physicalManufacturedDate: batch?.manufactured_date || null,
        physicalExpiryDate: batch?.expiry_date || null,
        photos: batch ? (photosByBatch.get(batch.batch_id) || []) : [],
        availablePhysicalQuantity: available,
        availableSourceQty: available,
      };
    });
  }

  async function record(auth, publicId, itemId, body = {}) {
    requireFulfillment(auth);
    const caseVersion = expectedVersion(body);
    const batchVersion = expectedBatchVersion(body.expectedBatchVersion);
    const quantity = parseCount(body.quantity);
    const observedAt = isoTimestamp(body.observedAt);
    const lotNo = String(body.lotNo || "").trim().slice(0, 120) || null;
    const manufacturedDate = optionalDate(body.manufacturedDate, "วันที่ผลิต");
    const expiryDate = optionalDate(body.expiryDate, "วันหมดอายุ");
    if (manufacturedDate && expiryDate && expiryDate < manufacturedDate) fail(400, "วันหมดอายุต้องไม่ก่อนวันที่ผลิต");
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) fail(400, "idempotencyKey ไม่ถูกต้อง");
    const sourceBranch = String(body.sourceBranch || "").trim();
    const docNo = String(body.docNo || "").trim();
    const seqNo = Number(body.seqNo);
    if (!/^\d{3}$/.test(sourceBranch) || !docNo || docNo.length > 100 || /[|\u0000-\u001f]/.test(docNo)
        || !Number.isInteger(seqNo) || seqNo <= 0) fail(400, "อ้างอิงใบรับเข้าไม่ถูกต้อง");
    const source = makeSourceKey({ branch_code: sourceBranch, doc_no: docNo, seq_no: seqNo });
    const reason = String(body.reason || "").trim().slice(0, 1000);
    const canonical = { publicId, itemId: Number(itemId), source, quantity, unit: String(body.unit || "").trim(), observedAt, caseVersion, batchVersion, reason, lotNo, manufacturedDate, expiryDate };
    const payloadSha256 = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [idempotencyKey]);
      const foundCase = await client.query(
        "SELECT * FROM customer_relations.preorder_cases WHERE public_id=$1 FOR UPDATE",
        [publicId],
      );
      const caseRow = foundCase.rows[0];
      if (!caseRow) fail(404, "Not found");
      const foundItem = await client.query(
        "SELECT i.item_id,i.unit_snapshot,COALESCE(i.product_code_snapshot,s.company_code) product_code FROM customer_relations.preorder_items i LEFT JOIN public.skus s ON s.sku_id=COALESCE(i.sku_id,i.matched_sku_id) WHERE i.case_id=$1 AND i.item_id=$2",
        [caseRow.case_id, Number(itemId)],
      );
      const item = foundItem.rows[0];
      if (!item || !item.product_code) fail(404, "ไม่พบสินค้าในคำขอ");
      const prior = await client.query(
        `SELECT e.receipt_event_id,e.case_id,e.item_id,e.actor_user_id,e.payload_sha256,e.quantity,e.unit_code,e.observed_at,e.resulting_batch_version,e.resulting_case_version,b.source_key,b.batch_id,b.lot_no,b.manufactured_date,b.expiry_date
         FROM customer_relations.preorder_hq_receipt_events e
         JOIN customer_relations.preorder_hq_receipt_batches b ON b.batch_id=e.batch_id
         WHERE e.idempotency_key=$1 FOR UPDATE OF e`,
        [idempotencyKey],
      );
      if (prior.rows[0]) {
        const event = prior.rows[0];
        if (event.payload_sha256 !== payloadSha256 || Number(event.case_id) !== Number(caseRow.case_id)
            || Number(event.item_id) !== Number(item.item_id) || event.source_key !== source
            || event.actor_user_id !== auth.userId) {
          fail(409, "idempotencyKey ถูกใช้กับข้อมูลอื่นแล้ว");
        }
        await client.query("COMMIT");
        return { receiptEventId: event.receipt_event_id, batchId: event.batch_id, quantity: Number(event.quantity), unit: event.unit_code, observedAt: event.observed_at, batchVersion: Number(event.resulting_batch_version), version: Number(event.resulting_case_version), lotNo: event.lot_no, manufacturedDate: event.manufactured_date, expiryDate: event.expiry_date, replayed: true };
      }
      if (!["ORDERED", "RECEIVED_AT_HQ"].includes(caseRow.status)) fail(409, "บันทึกตรวจรับที่สำนักงานใหญ่ได้หลังสั่งสินค้าแล้ว");
      const unit = String(body.unit || "").trim();
      if (!unit || !item.unit_snapshot || !sameUnit(unit, item.unit_snapshot)) {
        fail(409, "หน่วยตรวจรับต้องตรงกับหน่วยสินค้าที่บันทึกไว้; ยังไม่มีการแปลงหน่วยในระบบนี้");
      }
      const receiptResult = await client.query(
        `SELECT h.branch_code,h.doc_no,l.seq_no,l.product_code,l.unit_code,l.unit_name,l.qty,l.qty_base
         FROM ada.approved_receipt_lines l
         JOIN ada.approved_receipt_headers h ON h.doc_no=l.doc_no
         JOIN core.branches b ON b.branch_code=h.branch_code AND b.is_hq=TRUE
         WHERE h.branch_code=$1 AND h.doc_no=$2 AND l.seq_no=$3 AND lower(l.product_code)=lower($4)`,
        [sourceBranch, docNo, seqNo, item.product_code],
      );
      const sourceRow = receiptResult.rows[0];
      if (!sourceRow) fail(404, "ไม่พบใบรับเข้า HQ ที่ตรงกับสินค้า");
      const sourceUnit = String(sourceRow.unit_code || sourceRow.unit_name || "").trim();
      if (!sourceUnit || !sameUnit(sourceUnit, unit)) fail(409, "หน่วยในใบรับเข้าและหน่วยสินค้าไม่ตรงกัน");
      const documentQuantity = Number(sourceRow.qty) > 0 ? Number(sourceRow.qty) : Number(sourceRow.qty_base);
      if (!Number.isFinite(documentQuantity) || documentQuantity < 0) fail(409, "จำนวนในใบรับเข้าไม่ถูกต้อง");
      if (Number(quantity) > documentQuantity && !reason) fail(400, "จำนวนเกินเอกสาร ต้องระบุเหตุผล");

      if (Number(caseRow.version) !== caseVersion) fail(409, "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่", { code: "VERSION_CONFLICT", current: { publicId, status: caseRow.status, version: Number(caseRow.version) } });

      const batchId = crypto.randomUUID();
      await client.query(
        `INSERT INTO customer_relations.preorder_hq_receipt_batches(batch_id,source_key,source_branch_code,source_doc_no,source_line_seq,product_code,unit_code)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_key) DO NOTHING`,
        [batchId, source, sourceBranch, docNo, seqNo, sourceRow.product_code, sourceUnit],
      );
      const batchResult = await client.query(
        "SELECT * FROM customer_relations.preorder_hq_receipt_batches WHERE source_key=$1 FOR UPDATE",
        [source],
      );
      const batch = batchResult.rows[0];
      if (!batch || String(batch.product_code).toLowerCase() !== String(sourceRow.product_code).toLowerCase()
          || !sameUnit(batch.unit_code, sourceUnit)) fail(409, "รายการใบรับเข้าเปลี่ยนแปลง กรุณาตรวจสอบใหม่");
      const photoCount = await client.query("SELECT COUNT(*)::int count FROM customer_relations.preorder_hq_receipt_photos WHERE batch_id=$1 AND upload_state='ready'", [batch.batch_id]);
      if (Number(photoCount.rows[0]?.count || 0) === 0) fail(409, "กรุณาแนบรูปสินค้าที่รับเข้าก่อนบันทึกจำนวนตรวจรับ");
      if (Number(batch.version) !== batchVersion) fail(409, "จำนวนตรวจรับเปลี่ยนแปลง กรุณาโหลดใหม่", { code: "BATCH_VERSION_CONFLICT", current: { batchVersion: Number(batch.version), quantity: Number(batch.verified_quantity) } });

      const allocated = await client.query(
        "SELECT COALESCE(SUM(COALESCE(source_allocated_qty,allocated_qty)),0)::numeric quantity FROM customer_relations.preorder_evidence_links WHERE evidence_type='HQ_RECEIPT' AND source_key=$1 AND unlinked_at IS NULL",
        [source],
      );
      if (Number(quantity) < Number(allocated.rows[0]?.quantity || 0)) fail(409, "จำนวนตรวจรับจริงต่ำกว่าจำนวนที่จัดสรรแล้ว; ยกเลิกการจัดสรรก่อนแก้ไข");
      const eventType = Number(batch.version) === 0 ? "COUNTED" : "CORRECTED";
      if (eventType === "CORRECTED" && !reason) fail(400, "การแก้ไขจำนวนเดิมต้องระบุเหตุผล");
      const previous = Number(batch.version) > 0
        ? await client.query("SELECT receipt_event_id FROM customer_relations.preorder_hq_receipt_events WHERE batch_id=$1 ORDER BY resulting_batch_version DESC LIMIT 1", [batch.batch_id])
        : { rows: [] };
      const receiptEventId = crypto.randomUUID();
      const resultingBatchVersion = Number(batch.version) + 1;
      const resultingCaseVersion = Number(caseRow.version) + 1;
      await client.query(
        `INSERT INTO customer_relations.preorder_hq_receipt_events(receipt_event_id,batch_id,case_id,item_id,event_type,quantity,unit_code,observed_at,actor_user_id,actor_work_role,expected_case_version,resulting_case_version,expected_batch_version,resulting_batch_version,supersedes_event_id,idempotency_key,payload_sha256,reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'fulfillment',$10,$11,$12,$13,$14,$15,$16,$17)`,
        [receiptEventId,batch.batch_id,caseRow.case_id,item.item_id,eventType,quantity,unit,observedAt,auth.userId,caseVersion,resultingCaseVersion,batchVersion,resultingBatchVersion,previous.rows[0]?.receipt_event_id||null,idempotencyKey,payloadSha256,reason||null],
      );
      await client.query(
        "UPDATE customer_relations.preorder_hq_receipt_batches SET verified_quantity=$2,version=$3,last_observed_at=$4,lot_no=COALESCE($5,lot_no),manufactured_date=COALESCE($6,manufactured_date),expiry_date=COALESCE($7,expiry_date),updated_at=now() WHERE batch_id=$1",
        [batch.batch_id, quantity, resultingBatchVersion, observedAt, lotNo, manufacturedDate, expiryDate],
      );
      await client.query(
        "UPDATE customer_relations.preorder_cases SET version=$2,last_activity_at=now(),updated_at=now() WHERE case_id=$1",
        [caseRow.case_id, resultingCaseVersion],
      );
      const activitySeq = await nextActivitySequence(client, caseRow.case_id);
      await client.query(
        "INSERT INTO customer_relations.preorder_events(case_id,activity_seq,event_type,actor_user_id,actor_role,from_status,to_status,payload_json) VALUES($1,$2,'HQ_PHYSICAL_RECEIPT_COUNTED',$3,'fulfillment',$4,$4,$5::jsonb)",
        [caseRow.case_id, activitySeq, auth.userId, caseRow.status, JSON.stringify({ receiptEventId, itemId: item.item_id, quantity: Number(quantity), unit, observedAt, batchVersion: resultingBatchVersion, lotNo, manufacturedDate, expiryDate })],
      );
      await client.query("COMMIT");
      return { receiptEventId, batchId: batch.batch_id, quantity: Number(quantity), unit, observedAt, batchVersion: resultingBatchVersion, version: resultingCaseVersion, lotNo: lotNo || batch.lot_no || null, manufacturedDate: manufacturedDate || batch.manufactured_date || null, expiryDate: expiryDate || batch.expiry_date || null, replayed: false };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function ensureBatch(auth, body = {}) {
    requireFulfillment(auth);
    const sourceBranch = String(body.sourceBranch || "").trim();
    const docNo = String(body.docNo || "").trim();
    const seqNo = Number(body.seqNo);
    if (!/^\d{3}$/.test(sourceBranch) || !docNo || docNo.length > 100 || /[|\u0000-\u001f]/.test(docNo)
        || !Number.isInteger(seqNo) || seqNo <= 0) fail(400, "อ้างอิงใบรับเข้าไม่ถูกต้อง");
    const result = await db.query(
      `SELECT h.branch_code,h.doc_no,l.seq_no,l.product_code,l.unit_code,l.unit_name
       FROM ada.approved_receipt_lines l
       JOIN ada.approved_receipt_headers h ON h.doc_no=l.doc_no
       JOIN core.branches br ON br.branch_code=h.branch_code AND br.is_hq=TRUE
       WHERE h.branch_code=$1 AND h.doc_no=$2 AND l.seq_no=$3`,
      [sourceBranch, docNo, seqNo],
    );
    const source = result.rows[0];
    const unit = String(source?.unit_code || source?.unit_name || "").trim();
    if (!source || !source.product_code || !unit) fail(404, "ไม่พบใบรับเข้า HQ ที่มีสินค้าและหน่วยครบถ้วน");
    const sourceKey = makeSourceKey(source);
    const batchId = crypto.randomUUID();
    await db.query(
      "INSERT INTO customer_relations.preorder_hq_receipt_batches(batch_id,source_key,source_branch_code,source_doc_no,source_line_seq,product_code,unit_code) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_key) DO NOTHING",
      [batchId, sourceKey, sourceBranch, docNo, seqNo, source.product_code, unit],
    );
    const batch = await db.query("SELECT batch_id,product_code,unit_code,version FROM customer_relations.preorder_hq_receipt_batches WHERE source_key=$1", [sourceKey]);
    if (!batch.rows[0] || String(batch.rows[0].product_code).toLowerCase() !== String(source.product_code).toLowerCase() || !sameUnit(batch.rows[0].unit_code, unit)) {
      fail(409, "รายการใบรับเข้าเปลี่ยนแปลง กรุณาตรวจสอบใหม่");
    }
    return { batchId: batch.rows[0].batch_id, version: Number(batch.rows[0].version) };
  }

  async function addPhotos(auth, batchId, files = []) {
    requireFulfillment(auth);
    if (!storageProvider) fail(503, "พื้นที่เก็บรูป HQ ยังไม่พร้อมใช้งาน");
    const id = String(batchId || "");
    if (!validUuid(id)) fail(400, "batchId ไม่ถูกต้อง");
    const images = validateImages(files);
    if (images.length === 0) fail(400, "กรุณาเลือกรูปสินค้าอย่างน้อย 1 รูป");
    const client = await db.connect();
    const staged = [];
    try {
      await client.query("BEGIN");
      const batch = await client.query(
        "SELECT b.batch_id FROM customer_relations.preorder_hq_receipt_batches b JOIN core.branches br ON br.branch_code=b.source_branch_code AND br.is_hq=TRUE WHERE b.batch_id=$1 FOR UPDATE OF b",
        [id],
      );
      if (!batch.rows[0]) fail(404, "ไม่พบชุดตรวจรับของสำนักงานใหญ่");
      const count = await client.query("SELECT COUNT(*)::int count FROM customer_relations.preorder_hq_receipt_photos WHERE batch_id=$1 AND upload_state<>'deleted'", [id]);
      if (Number(count.rows[0]?.count || 0) + images.length > 3) fail(400, "แนบรูปสินค้าได้ไม่เกิน 3 รูปต่อชุดรับเข้า");
      for (const image of images) {
        const photoId = crypto.randomUUID();
        const photoPublicId = crypto.randomUUID();
        const key = `preorder-hq-receipts/${config.nodeEnv || "production"}/${id}/${photoPublicId}.${image.detected.ext}`;
        await client.query(
          "INSERT INTO customer_relations.preorder_hq_receipt_photos(photo_id,photo_public_id,batch_id,original_filename,mime_type,size_bytes,sha256,bucket_name,object_key,created_by,cleanup_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '1 hour')",
          [photoId, photoPublicId, id, image.originalname || null, image.mimetype, image.size, image.sha256, config.r2BucketName, key, auth.userId],
        );
        staged.push({ photoId, photoPublicId, key, image });
      }
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }

    try {
      for (const object of staged) {
        const put = await storageProvider.putObject({ key: object.key, body: object.image.buffer, contentType: object.image.mimetype, checksumSha256: Buffer.from(object.image.sha256, "hex").toString("base64") });
        const head = typeof storageProvider.headObject === "function" ? await storageProvider.headObject(object.key) : null;
        if (head?.ContentLength != null && Number(head.ContentLength) !== Number(object.image.size)) throw new Error("การตรวจสอบขนาดรูปไม่ผ่าน");
        await db.query("UPDATE customer_relations.preorder_hq_receipt_photos SET etag=$2,object_version=$3,upload_state='ready',ready_at=now(),cleanup_after=NULL WHERE photo_id=$1", [object.photoId, put?.ETag || head?.ETag || null, put?.VersionId || head?.VersionId || null]);
      }
      return { items: staged.map(({ photoPublicId, image }) => ({ photoPublicId, filename: image.originalname || null, sizeBytes: image.size })) };
    } catch (error) {
      for (const object of staged) {
        try { await storageProvider.deleteObject(object.key); } catch {}
        await db.query("UPDATE customer_relations.preorder_hq_receipt_photos SET upload_state='cleanup_pending',cleanup_after=now() WHERE photo_id=$1 AND upload_state IN ('pending','ready')", [object.photoId]).catch(() => {});
      }
      throw Object.assign(new Error("บันทึกจำนวนแล้ว แต่แนบรูปไม่สำเร็จ กรุณาลองอัปโหลดรูปอีกครั้ง"), { statusCode: 503, cause: error });
    }
  }

  async function signedPhotoUrl(auth, batchId, photoPublicId) {
    requireFulfillment(auth);
    if (!storageProvider) fail(503, "พื้นที่เก็บรูป HQ ยังไม่พร้อมใช้งาน");
    const found = await db.query(
      "SELECT p.object_key FROM customer_relations.preorder_hq_receipt_photos p JOIN customer_relations.preorder_hq_receipt_batches b ON b.batch_id=p.batch_id JOIN core.branches br ON br.branch_code=b.source_branch_code AND br.is_hq=TRUE WHERE p.batch_id=$1 AND p.photo_public_id=$2 AND p.upload_state='ready'",
      [String(batchId || ""), String(photoPublicId || "")],
    );
    if (!found.rows[0]) fail(404, "ไม่พบรูปตรวจรับ");
    return { url: await storageProvider.createSignedGetUrl(found.rows[0].object_key), expiresIn: config.r2SignedUrlTtlSeconds || 300 };
  }

  return { record, ensureBatch, decorateCandidates, addPhotos, signedPhotoUrl };
}

module.exports = { createPreorderPhysicalReceipts, parseCount, isoTimestamp, optionalDate, validUuid };
