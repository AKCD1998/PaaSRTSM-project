"use strict";

const crypto = require("crypto");
const { validateImages, createObjectKey } = require("./preorderAttachments");

const ADMIN_ACTIONABLE = ["SUBMITTED", "IN_REVIEW", "PROCUREMENT_PENDING", "ORDERED"];
const STAFF_ACTIONABLE = ["NEEDS_INFO", "WAITING_CUSTOMER_DECISION", "ARRIVED_AT_BRANCH"];
const VALID_STATUSES = new Set(["SUBMITTED", "IN_REVIEW", "NEEDS_INFO", "WAITING_CUSTOMER_DECISION", "PROCUREMENT_PENDING", "ORDERED", "RECEIVED_AT_HQ", "IN_TRANSIT_TO_BRANCH", "ARRIVED_AT_BRANCH", "CUSTOMER_NOTIFIED", "COMPLETED", "CUSTOMER_DECLINED", "UNAVAILABLE", "CANCELLED"]);
const VALID_INTENTS = new Set(["PRICE_INQUIRY", "ORDER_REQUEST"]);

function httpError(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
function normalizePhone(value) { return String(value || "").replace(/\D/g, ""); }
function maskPhone(value) { const phone = normalizePhone(value); return phone.length <= 4 ? "••••" : `${phone.slice(0, 3)}••••${phone.slice(-4)}`; }
function maskName(value) { const name = String(value || "").trim(); return name ? `${name.slice(0, 1)}${"•".repeat(Math.min(6, Math.max(2, name.length - 1)))}` : "-"; }
function actorScope(auth) {
  if (auth?.role === "admin") return { branchCode: null };
  if (auth?.role !== "staff" || !auth.effectiveBranchCode) throw httpError(403, "Forbidden");
  return { branchCode: auth.effectiveBranchCode };
}
function parseItems(value) {
  let items;
  try { items = typeof value === "string" ? JSON.parse(value) : value; } catch { throw httpError(400, "รายการสินค้าไม่ถูกต้อง"); }
  if (!Array.isArray(items) || !items.length) throw httpError(400, "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
  for (const item of items) {
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) throw httpError(400, "จำนวนสินค้าต้องมากกว่า 0");
    if (item.itemKind === "CATALOG" && !Number.isInteger(Number(item.skuId))) throw httpError(400, "รายการสินค้าในระบบไม่ถูกต้อง");
    if (item.itemKind !== "CATALOG" && !String(item.description || "").trim()) throw httpError(400, "กรุณาระบุรายละเอียดสินค้านอกระบบ");
  }
  return items;
}
function parseCreateBody(body) {
  if (!body?.payload) return body || {};
  try { return { ...body, ...JSON.parse(body.payload) }; } catch { throw httpError(400, "payload ไม่ใช่ JSON ที่ถูกต้อง"); }
}
function makePublicId(branch) { const date = new Date().toISOString().slice(0, 10).replaceAll("-", ""); return `PRE-${date}-${branch}-${crypto.randomInt(0, 10000).toString().padStart(4, "0")}`; }
function mapList(row) {
  const result = { ...row, customer_name_masked: maskName(row.customer_name), customer_phone_masked: maskPhone(row.customer_phone || row.customer_phone_normalized) };
  delete result.customer_name;
  delete result.customer_phone; delete result.customer_phone_normalized; delete result.customer_phone_last4;
  return result;
}
function normalizeSuggestionQuery(value) { return String(value || "").trim().replace(/^@+/, "").trim().slice(0, 120); }
function parsePage(value, fallback, max) { const number = Number(value); return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback; }

function createCustomerPreorderService({ db, config, storageProvider }) {
  async function productSuggestions(auth, query = {}) {
    actorScope(auth);
    const term = normalizeSuggestionQuery(query.q);
    if (!term) return [];
    const limit = parsePage(query.limit, 8, 10);
    const result = await db.query(`
      SELECT s.sku_id, s.company_code AS product_code, s.display_name,
             s.generic_name,
             primary_barcode.barcode,
             unit_price.unit
      FROM public.skus s
      LEFT JOIN LATERAL (
        SELECT b.barcode FROM public.barcodes b WHERE b.sku_id=s.sku_id
        ORDER BY b.is_primary DESC, b.barcode ASC LIMIT 1
      ) primary_barcode ON TRUE
      LEFT JOIN LATERAL (
        SELECT p.unit FROM public.sku_unit_prices p
        WHERE p.sku_id=s.sku_id AND p.is_active=TRUE ORDER BY p.unit ASC LIMIT 1
      ) unit_price ON TRUE
      WHERE s.company_code ILIKE '%' || $1 || '%'
         OR s.display_name ILIKE '%' || $1 || '%'
         OR COALESCE(s.generic_name,'') ILIKE '%' || $1 || '%'
         OR EXISTS (SELECT 1 FROM public.barcodes bx WHERE bx.sku_id=s.sku_id AND bx.barcode ILIKE '%' || $1 || '%')
      ORDER BY CASE
        WHEN lower(s.company_code)=lower($1) OR EXISTS (SELECT 1 FROM public.barcodes b WHERE b.sku_id=s.sku_id AND lower(b.barcode)=lower($1)) THEN 0
        WHEN lower(s.company_code) LIKE lower($1) || '%' OR EXISTS (SELECT 1 FROM public.barcodes b WHERE b.sku_id=s.sku_id AND lower(b.barcode) LIKE lower($1) || '%') THEN 1
        WHEN lower(s.display_name)=lower($1) OR lower(COALESCE(s.generic_name,''))=lower($1) THEN 2
        WHEN lower(s.display_name) LIKE lower($1) || '%' OR lower(COALESCE(s.generic_name,'')) LIKE lower($1) || '%' THEN 3
        ELSE 4 END,
        s.company_code ASC, s.sku_id ASC
      LIMIT $2
    `, [term, limit]);
    return result.rows;
  }

  function buildCaseWhere(auth, filters = {}) {
    const scope = actorScope(auth); const params = []; const clauses = ["TRUE", "NOT EXISTS (SELECT 1 FROM customer_relations.preorder_attachments pending_attachment WHERE pending_attachment.case_id=c.case_id AND pending_attachment.message_id IS NULL AND pending_attachment.upload_state<>'ready')"];
    const add = (sql, value) => { params.push(value); clauses.push(sql.replace("?", `$${params.length}`)); };
    if (scope.branchCode) add("c.branch_code=?", scope.branchCode);
    else if (/^\d{3}$/.test(String(filters.branch || ""))) add("c.branch_code=?", String(filters.branch));
    if (VALID_STATUSES.has(filters.status)) add("c.status=?", filters.status);
    if (VALID_INTENTS.has(filters.intent)) add("c.intent=?", filters.intent);
    if (String(filters.actionable).toLowerCase() === "true") {
      params.push(auth.role === "admin" ? ADMIN_ACTIONABLE : STAFF_ACTIONABLE);
      clauses.push(`c.status=ANY($${params.length}::text[])`);
    }
    if (auth.role === "admin" && String(filters.actionable).toLowerCase() === "stuck") {
      clauses.push("c.status IN ('SUBMITTED','IN_REVIEW','PROCUREMENT_PENDING','ORDERED','RECEIVED_AT_HQ','IN_TRANSIT_TO_BRANCH') AND c.last_activity_at<now()-interval '48 hours'");
    }
    const search = String(filters.search || "").trim().slice(0, 100);
    if (search) {
      params.push(`%${search}%`, `%${normalizePhone(search)}%`);
      clauses.push(`(c.public_id ILIKE $${params.length - 1} OR c.customer_name ILIKE $${params.length - 1} OR c.customer_phone_normalized LIKE $${params.length})`);
    }
    return { where: clauses.join(" AND "), params };
  }

  async function list(auth, filters = {}) {
    const page = parsePage(filters.page, 1, 1000000); const pageSize = parsePage(filters.pageSize || filters.limit, 25, 100);
    const built = buildCaseWhere(auth, filters); const count = await db.query(`SELECT COUNT(*)::int AS total FROM customer_relations.preorder_cases c WHERE ${built.where}`, built.params);
    const params = [...built.params, pageSize, (page - 1) * pageSize];
    const rows = await db.query(`SELECT c.public_id,c.branch_code,c.intent,c.status,c.customer_name,c.customer_phone_normalized,c.first_admin_viewed_at,c.last_activity_at,c.version,c.created_at,
      item_summary.item_count,item_summary.item_summary,last_message.last_reply_at,latest_eta.estimated_date AS eta_date,latest_eta.basis AS eta_basis
      FROM customer_relations.preorder_cases c
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS item_count,string_agg(COALESCE(i.display_name_snapshot,i.original_description,'สินค้า'),' · ' ORDER BY i.position) AS item_summary FROM customer_relations.preorder_items i WHERE i.case_id=c.case_id) item_summary ON TRUE
      LEFT JOIN LATERAL (SELECT m.created_at AS last_reply_at FROM customer_relations.preorder_messages m WHERE m.case_id=c.case_id AND m.visibility='PUBLIC' AND m.is_ready=TRUE ORDER BY m.activity_seq DESC LIMIT 1) last_message ON TRUE
      LEFT JOIN LATERAL (SELECT e.estimated_date,e.basis FROM customer_relations.preorder_eta_projections e WHERE e.case_id=c.case_id ORDER BY e.version DESC LIMIT 1) latest_eta ON TRUE
      WHERE ${built.where} ORDER BY c.last_activity_at DESC,c.case_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.rows.map(mapList), total: count.rows[0]?.total || 0, page, pageSize };
  }

  async function findAuthorizedCase(auth, publicId, queryable = db, options = {}) {
    const scope = actorScope(auth); const params = [publicId]; let where = "c.public_id=$1";
    if (scope.branchCode) { params.push(scope.branchCode); where += " AND c.branch_code=$2"; }
    const lock = options.forUpdate ? " FOR UPDATE" : "";
    if (!options.includePending) where += " AND NOT EXISTS (SELECT 1 FROM customer_relations.preorder_attachments pending_attachment WHERE pending_attachment.case_id=c.case_id AND pending_attachment.message_id IS NULL AND pending_attachment.upload_state<>'ready')";
    const result = await queryable.query(`SELECT c.* FROM customer_relations.preorder_cases c WHERE ${where}${lock}`, params);
    if (!result.rows[0]) throw httpError(404, "Not found");
    return result.rows[0];
  }

  async function get(auth, publicId) {
    const row = await findAuthorizedCase(auth, publicId);
    const [items, attachments, messages, quotes, decisions, procurement, evidence, eta, timeline] = await Promise.all([
      db.query("SELECT * FROM customer_relations.preorder_items WHERE case_id=$1 ORDER BY position", [row.case_id]),
      db.query("SELECT attachment_public_id,mime_type,size_bytes,sha256,upload_state,created_at FROM customer_relations.preorder_attachments WHERE case_id=$1 AND upload_state='ready' ORDER BY attachment_id", [row.case_id]),
      db.query(`SELECT * FROM customer_relations.preorder_messages WHERE case_id=$1 AND is_ready=TRUE ${auth.role === "admin" ? "" : "AND visibility='PUBLIC'"} ORDER BY activity_seq`, [row.case_id]),
      db.query(`SELECT q.quote_id,q.case_id,q.quote_version,q.valid_until,q.public_note,${auth.role === "admin" ? "q.admin_internal_note," : ""}q.published_by,q.published_at,q.supersedes_quote_id,COALESCE(lines.lines,'[]'::jsonb) AS lines FROM customer_relations.preorder_quotes q LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('quoteLineId',l.quote_line_id,'itemId',l.item_id,'offeredQty',l.offered_qty,'unitPrice',l.unit_price,'unit',l.unit) ORDER BY l.quote_line_id) lines FROM customer_relations.preorder_quote_lines l WHERE l.quote_id=q.quote_id) lines ON TRUE WHERE q.case_id=$1 ORDER BY q.quote_version`, [row.case_id]),
      db.query("SELECT d.*,COALESCE(lines.lines,'[]'::jsonb) AS lines FROM customer_relations.preorder_customer_decisions d LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('itemId',l.item_id,'finalQty',l.final_qty) ORDER BY l.decision_line_id) lines FROM customer_relations.preorder_decision_lines l WHERE l.decision_id=d.decision_id) lines ON TRUE WHERE d.case_id=$1 ORDER BY d.created_at", [row.case_id]),
      db.query(`SELECT outcome_id,outcome_type,supplier_reference,public_note,${auth.role === "admin" ? "admin_internal_note," : ""}reason_code,recorded_by,created_at FROM customer_relations.preorder_procurement_outcomes WHERE case_id=$1 ORDER BY created_at`, [row.case_id]),
      db.query(`SELECT evidence_link_id,item_id,evidence_type,allocated_qty,unit,source_synced_at,linked_at,source_allocated_qty,source_unit,target_unit,${auth.role === "admin" ? "allocation_note,source_key,snapshot_json" : "jsonb_build_object('docDate',snapshot_json->>'docDate','productCode',snapshot_json->>'productCode','sourceUnit',snapshot_json->>'sourceUnit','phase',snapshot_json->>'phase','sourceMatchStatus',snapshot_json->>'sourceMatchStatus','inboundProcessState',snapshot_json->>'inboundProcessState') snapshot_json"} FROM customer_relations.preorder_evidence_links WHERE case_id=$1 AND unlinked_at IS NULL ORDER BY linked_at`, [row.case_id]),
      db.query("SELECT * FROM customer_relations.preorder_eta_projections WHERE case_id=$1 ORDER BY version DESC LIMIT 1", [row.case_id]),
      db.query("SELECT * FROM customer_relations.preorder_events WHERE case_id=$1 ORDER BY activity_seq", [row.case_id]),
    ]);
    const activity = [
      ...timeline.rows.map((event) => ({ ...event, activityKind: "EVENT" })),
      ...messages.rows.map((message) => ({ ...message, activityKind: "MESSAGE" })),
    ].sort((a, b) => Number(a.activity_seq) - Number(b.activity_seq));
    return { ...row, items: items.rows, attachments: attachments.rows, messages: messages.rows, quotes: quotes.rows, decisions: decisions.rows, procurementOutcomes: procurement.rows, evidence: evidence.rows, eta: eta.rows[0] || null, timeline: activity };
  }

  async function markRead(auth, publicId) {
    const client = await db.connect();
    try {
      await client.query("BEGIN"); const row = await findAuthorizedCase(auth, publicId, client, { forUpdate: true });
      const seqResult = await client.query("SELECT GREATEST(COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_events WHERE case_id=$1),0),COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_messages WHERE case_id=$1),0))::bigint AS seq", [row.case_id]);
      let seq = Number(seqResult.rows[0]?.seq || 0); let firstAdminViewedAt = row.first_admin_viewed_at;
      if (auth.role === "admin" && !firstAdminViewedAt) {
        seq += 1;
        const updated = await client.query("UPDATE customer_relations.preorder_cases SET first_admin_viewed_at=now(),first_admin_viewed_by=$2 WHERE case_id=$1 AND first_admin_viewed_at IS NULL RETURNING first_admin_viewed_at", [row.case_id, auth.userId]);
        firstAdminViewedAt = updated.rows[0]?.first_admin_viewed_at || firstAdminViewedAt;
        if (updated.rows[0]) await client.query("INSERT INTO customer_relations.preorder_events(case_id,activity_seq,event_type,actor_user_id,actor_role) VALUES($1,$2,'FIRST_ADMIN_VIEWED',$3,'admin')", [row.case_id, seq, auth.userId]);
      }
      await client.query("INSERT INTO customer_relations.preorder_read_cursors(case_id,user_id,last_read_activity_seq,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(case_id,user_id) DO UPDATE SET last_read_activity_seq=GREATEST(preorder_read_cursors.last_read_activity_seq,EXCLUDED.last_read_activity_seq),updated_at=now()", [row.case_id, auth.userId, seq]);
      await client.query("COMMIT"); return { firstAdminViewedAt, lastReadActivitySeq: seq };
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
  }

  async function counts(auth) {
    const scope = actorScope(auth); const params = [auth.userId, auth.role === "admin" ? ADMIN_ACTIONABLE : STAFF_ACTIONABLE]; let scopeSql = "";
    if (scope.branchCode) { params.push(scope.branchCode); scopeSql = `AND c.branch_code=$${params.length}`; }
    const result = await db.query(`SELECT COUNT(*) FILTER (WHERE GREATEST(COALESCE(ev.max_seq,0),COALESCE(msg.max_seq,0))>COALESCE(rc.last_read_activity_seq,0))::int AS unread_count,COUNT(*) FILTER (WHERE c.status=ANY($2::text[]))::int AS actionable_count FROM customer_relations.preorder_cases c LEFT JOIN customer_relations.preorder_read_cursors rc ON rc.case_id=c.case_id AND rc.user_id=$1 LEFT JOIN LATERAL (SELECT MAX(activity_seq) max_seq FROM customer_relations.preorder_events WHERE case_id=c.case_id) ev ON TRUE LEFT JOIN LATERAL (SELECT MAX(activity_seq) max_seq FROM customer_relations.preorder_messages WHERE case_id=c.case_id AND is_ready=TRUE ${auth.role === "admin" ? "" : "AND visibility='PUBLIC'"}) msg ON TRUE WHERE NOT EXISTS (SELECT 1 FROM customer_relations.preorder_attachments pending_attachment WHERE pending_attachment.case_id=c.case_id AND pending_attachment.message_id IS NULL AND pending_attachment.upload_state<>'ready') ${scopeSql}`, params);
    return { unreadCount: result.rows[0]?.unread_count || 0, actionableCount: result.rows[0]?.actionable_count || 0 };
  }

  async function create(auth, rawBody, files = []) {
    const body = parseCreateBody(rawBody); const scope = actorScope(auth); const branch = scope.branchCode;
    if (!branch) throw httpError(400, "Admin must select an effective branch context");
    const idempotency = String(body.idempotencyKey || "").trim().slice(0, 200); if (!idempotency) throw httpError(400, "idempotencyKey is required");
    const phone = normalizePhone(body.customerPhone); if (phone.length < 8 || !String(body.customerName || "").trim()) throw httpError(400, "กรุณากรอกชื่อลูกค้าและเบอร์โทรให้ถูกต้อง");
    const items = parseItems(body.items); const images = validateImages(files); const client = await db.connect(); const uploaded = []; let caseRow;
    try {
      await client.query("BEGIN"); const existing = await client.query("SELECT case_id,public_id,branch_code,status FROM customer_relations.preorder_cases WHERE idempotency_key=$1", [idempotency]);
      if (existing.rows[0]) {
        if (existing.rows[0].branch_code !== branch) throw httpError(409, "idempotencyKey already used");
        const pending = await client.query("SELECT object_key,sha256,mime_type,upload_state FROM customer_relations.preorder_attachments WHERE case_id=$1 ORDER BY attachment_id", [existing.rows[0].case_id]);
        if (pending.rows.some((row) => row.upload_state !== "ready")) await client.query("UPDATE customer_relations.preorder_attachments SET upload_state='pending',cleanup_after=now()+interval '1 hour' WHERE case_id=$1 AND upload_state IN ('cleanup_pending','deleted')", [existing.rows[0].case_id]);
        await client.query("COMMIT");
        if (pending.rows.some((row) => row.upload_state !== "ready")) {
          if (pending.rows.length !== images.length || pending.rows.some((row, index) => row.sha256 !== images[index]?.sha256 || row.mime_type !== images[index]?.mimetype)) throw httpError(409, "ไฟล์ที่ส่งซ้ำไม่ตรงกับคำขอเดิม");
          const replayObjects = pending.rows.map((row, index) => ({ key: row.object_key, image: images[index] }));
          caseRow = existing.rows[0]; uploaded.push(...replayObjects);
          await uploadObjects(replayObjects); await finalizeCase(existing.rows[0], auth, replayObjects);
        }
        return get(auth, existing.rows[0].public_id);
      }
      const publicId = makePublicId(branch); const intent = VALID_INTENTS.has(body.intent) ? body.intent : "PRICE_INQUIRY"; const status = intent === "ORDER_REQUEST" ? "PROCUREMENT_PENDING" : "SUBMITTED";
      const inserted = await client.query("INSERT INTO customer_relations.preorder_cases(public_id,branch_code,intent,status,customer_name,customer_phone,customer_phone_normalized,customer_phone_last4,staff_note,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10) RETURNING *", [publicId, branch, intent, status, String(body.customerName).trim(), phone, phone.slice(-4), body.staffNote || null, auth.userId, idempotency]); caseRow = inserted.rows[0];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]; const kind = item.itemKind === "CATALOG" ? "CATALOG" : "FREEFORM"; let snapshot = {};
        if (kind === "CATALOG") {
          const canonical = await client.query("SELECT s.sku_id,s.company_code,s.display_name,s.generic_name,(SELECT b.barcode FROM public.barcodes b WHERE b.sku_id=s.sku_id ORDER BY b.is_primary DESC,b.barcode LIMIT 1) barcode,(SELECT p.unit FROM public.sku_unit_prices p WHERE p.sku_id=s.sku_id AND p.is_active=TRUE ORDER BY p.unit LIMIT 1) unit FROM public.skus s WHERE s.sku_id=$1", [Number(item.skuId)]);
          if (!canonical.rows[0]) throw httpError(400, "ไม่พบสินค้าในระบบ"); snapshot = canonical.rows[0];
        }
        await client.query("INSERT INTO customer_relations.preorder_items(case_id,position,item_kind,sku_id,product_code_snapshot,display_name_snapshot,generic_name_snapshot,barcode_snapshot,unit_snapshot,original_description,requested_qty) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [caseRow.case_id, index + 1, kind, kind === "CATALOG" ? snapshot.sku_id : null, snapshot.company_code || null, snapshot.display_name || null, snapshot.generic_name || null, snapshot.barcode || null, snapshot.unit || null, kind === "FREEFORM" ? String(item.description).trim() : null, Number(item.quantity)]);
      }
      for (const image of images) { const attachmentPublicId = crypto.randomUUID(); const key = createObjectKey({ environment: config.nodeEnv, branchCode: branch, casePublicId: publicId, attachmentPublicId, ext: image.detected.ext }); await client.query("INSERT INTO customer_relations.preorder_attachments(attachment_public_id,case_id,original_filename,mime_type,size_bytes,sha256,bucket_name,object_key,created_by,cleanup_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '1 hour')", [attachmentPublicId, caseRow.case_id, image.originalname || null, image.mimetype, image.size, image.sha256, config.r2BucketName, key, auth.userId]); uploaded.push({ key, image }); }
      await client.query("COMMIT");
      await uploadObjects(uploaded); await finalizeCase(caseRow, auth, uploaded); return get(auth, caseRow.public_id);
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} for (const object of uploaded) { try { await storageProvider.deleteObject(object.key); } catch {} } if (caseRow?.case_id) await db.query("UPDATE customer_relations.preorder_attachments SET upload_state='cleanup_pending',cleanup_after=now() WHERE case_id=$1 AND upload_state='pending'", [caseRow.case_id]).catch(() => {}); throw error; } finally { client.release(); }
  }

  async function uploadObjects(objects) {
    if (objects.length && !storageProvider) throw httpError(503, "R2 storage is unavailable");
    for (const object of objects) {
      const put = await storageProvider.putObject({ key: object.key, body: object.image.buffer, contentType: object.image.mimetype, checksumSha256: Buffer.from(object.image.sha256, "hex").toString("base64") });
      const head = typeof storageProvider.headObject === "function" ? await storageProvider.headObject(object.key) : null;
      if (head?.ContentLength != null && Number(head.ContentLength) !== Number(object.image.size)) throw new Error("R2 object size verification failed");
      object.etag = put?.ETag || head?.ETag || null; object.versionId = put?.VersionId || head?.VersionId || null;
    }
  }

  async function finalizeCase(row, actor, objects = []) {
    const finalClient = await db.connect();
    try {
      await finalClient.query("BEGIN"); await finalClient.query("SELECT case_id FROM customer_relations.preorder_cases WHERE case_id=$1 FOR UPDATE", [row.case_id]);
      for (const object of objects) await finalClient.query("UPDATE customer_relations.preorder_attachments SET etag=$2,object_version=$3 WHERE case_id=$1 AND object_key=$4", [row.case_id, object.etag, object.versionId, object.key]);
      await finalClient.query("UPDATE customer_relations.preorder_attachments SET upload_state='ready',ready_at=COALESCE(ready_at,now()),cleanup_after=NULL WHERE case_id=$1 AND upload_state IN ('pending','cleanup_pending')", [row.case_id]);
      await finalClient.query("INSERT INTO customer_relations.preorder_events(case_id,activity_seq,event_type,actor_user_id,actor_role,to_status) VALUES($1,1,'CASE_CREATED',$2,$3,$4) ON CONFLICT(case_id,activity_seq) DO NOTHING", [row.case_id, actor.userId, actor.role, row.status]);
      await finalClient.query("COMMIT");
    } catch (error) { try { await finalClient.query("ROLLBACK"); } catch {} throw error; } finally { finalClient.release(); }
  }

  async function createMessage(auth, publicId, rawBody, files = []) {
    const body = parseCreateBody(rawBody); const images = validateImages(files);
    const idempotency = String(body.idempotencyKey || "").trim().slice(0, 200); const text = String(body.text || body.body || "").trim();
    if (!idempotency) throw httpError(400, "idempotencyKey is required");
    if (!text || text.length > 4000) throw httpError(400, "ข้อความต้องมีความยาว 1–4,000 ตัวอักษร");
    const visibility = body.visibility === "ADMIN_INTERNAL" ? "ADMIN_INTERNAL" : "PUBLIC";
    if (visibility === "ADMIN_INTERNAL" && auth.role !== "admin") throw httpError(403, "Forbidden");
    const client = await db.connect(); const objects = []; let caseRow; let messageRow;
    try {
      await client.query("BEGIN"); caseRow = await findAuthorizedCase(auth, publicId, client, { forUpdate: true, includePending: true });
      const existing = await client.query("SELECT message_id,case_id,is_ready FROM customer_relations.preorder_messages WHERE idempotency_key=$1", [idempotency]);
      if (existing.rows[0]) {
        if (Number(existing.rows[0].case_id) !== Number(caseRow.case_id)) throw httpError(409, "idempotencyKey already used");
        const pending = await client.query("SELECT object_key,sha256,mime_type,upload_state FROM customer_relations.preorder_attachments WHERE message_id=$1 ORDER BY attachment_id", [existing.rows[0].message_id]);
        if (!existing.rows[0].is_ready) await client.query("UPDATE customer_relations.preorder_attachments SET upload_state='pending',cleanup_after=now()+interval '1 hour' WHERE message_id=$1 AND upload_state IN ('cleanup_pending','deleted')", [existing.rows[0].message_id]);
        await client.query("COMMIT");
        if (!existing.rows[0].is_ready) {
          if (pending.rows.length !== images.length || pending.rows.some((row, index) => row.sha256 !== images[index]?.sha256 || row.mime_type !== images[index]?.mimetype)) throw httpError(409, "ไฟล์ที่ส่งซ้ำไม่ตรงกับข้อความเดิม");
          objects.push(...pending.rows.map((row, index) => ({ key: row.object_key, image: images[index] })));
          await uploadObjects(objects); await finalizeMessage({ caseId: caseRow.case_id, messageId: existing.rows[0].message_id, objects });
        }
        return get(auth, publicId);
      }
      const count = await client.query("SELECT COUNT(*)::int AS count FROM customer_relations.preorder_attachments WHERE case_id=$1 AND upload_state<>'deleted'", [caseRow.case_id]);
      if (Number(count.rows[0]?.count || 0) + images.length > 3) throw httpError(400, "แนบรูปได้ไม่เกิน 3 รูปต่อเคส");
      const seq = await client.query("SELECT GREATEST(COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_events WHERE case_id=$1),0),COALESCE((SELECT MAX(activity_seq) FROM customer_relations.preorder_messages WHERE case_id=$1),0))+1 AS seq", [caseRow.case_id]);
      const inserted = await client.query("INSERT INTO customer_relations.preorder_messages(case_id,visibility,body,author_user_id,author_role,author_branch_code,activity_seq,idempotency_key,is_ready) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING message_id,case_id,is_ready", [caseRow.case_id, visibility, text, auth.userId, auth.role, auth.effectiveBranchCode || null, Number(seq.rows[0]?.seq || 1), idempotency, images.length === 0]);
      messageRow = inserted.rows[0];
      for (const image of images) {
        const attachmentPublicId = crypto.randomUUID(); const key = createObjectKey({ environment: config.nodeEnv, branchCode: caseRow.branch_code, casePublicId: caseRow.public_id, attachmentPublicId, ext: image.detected.ext });
        await client.query("INSERT INTO customer_relations.preorder_attachments(attachment_public_id,case_id,message_id,original_filename,mime_type,size_bytes,sha256,bucket_name,object_key,created_by,cleanup_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '1 hour')", [attachmentPublicId, caseRow.case_id, messageRow.message_id, image.originalname || null, image.mimetype, image.size, image.sha256, config.r2BucketName, key, auth.userId]);
        objects.push({ key, image });
      }
      if (!images.length) await client.query("UPDATE customer_relations.preorder_cases SET last_activity_at=now() WHERE case_id=$1", [caseRow.case_id]);
      await client.query("COMMIT");
      if (objects.length) { await uploadObjects(objects); await finalizeMessage({ caseId: caseRow.case_id, messageId: messageRow.message_id, objects }); }
      return get(auth, publicId);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      for (const object of objects) { try { await storageProvider.deleteObject(object.key); } catch {} }
      if (messageRow?.message_id) await db.query("UPDATE customer_relations.preorder_attachments SET upload_state='cleanup_pending',cleanup_after=now() WHERE message_id=$1 AND upload_state='pending'", [messageRow.message_id]).catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function finalizeMessage({ caseId, messageId, objects = [] }) {
    const finalClient = await db.connect();
    try {
      await finalClient.query("BEGIN"); await finalClient.query("SELECT case_id FROM customer_relations.preorder_cases WHERE case_id=$1 FOR UPDATE", [caseId]);
      for (const object of objects) await finalClient.query("UPDATE customer_relations.preorder_attachments SET etag=$2,object_version=$3 WHERE message_id=$1 AND object_key=$4", [messageId, object.etag, object.versionId, object.key]);
      await finalClient.query("UPDATE customer_relations.preorder_attachments SET upload_state='ready',ready_at=COALESCE(ready_at,now()),cleanup_after=NULL WHERE message_id=$1 AND upload_state IN ('pending','cleanup_pending')", [messageId]);
      await finalClient.query("UPDATE customer_relations.preorder_messages SET is_ready=TRUE WHERE message_id=$1", [messageId]);
      await finalClient.query("UPDATE customer_relations.preorder_cases SET last_activity_at=now() WHERE case_id=$1", [caseId]); await finalClient.query("COMMIT");
    } catch (error) { try { await finalClient.query("ROLLBACK"); } catch {} throw error; } finally { finalClient.release(); }
  }

  async function signedUrl(auth, attachmentId) {
    const scope = actorScope(auth); const params = [attachmentId]; let branchSql = "";
    if (scope.branchCode) { params.push(scope.branchCode); branchSql = "AND c.branch_code=$2"; }
    const result = await db.query(`SELECT a.object_key FROM customer_relations.preorder_attachments a JOIN customer_relations.preorder_cases c ON c.case_id=a.case_id WHERE a.attachment_public_id=$1 AND a.upload_state='ready' ${branchSql}`, params);
    if (!result.rows[0]) throw httpError(404, "Not found");
    return { url: await storageProvider.createSignedGetUrl(result.rows[0].object_key), expiresIn: config.r2SignedUrlTtlSeconds || 300 };
  }

  return { productSuggestions, list, get, markRead, counts, create, createMessage, signedUrl, buildCaseWhere };
}

module.exports = { ADMIN_ACTIONABLE, STAFF_ACTIONABLE, createCustomerPreorderService, normalizePhone, maskPhone, maskName, actorScope, normalizeSuggestionQuery, parseCreateBody };
