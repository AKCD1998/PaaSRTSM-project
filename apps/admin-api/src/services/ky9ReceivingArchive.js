"use strict";
const BRANCHES = ["000", "001", "003", "004", "005"];
function bad(message) { throw Object.assign(new Error(message), { status: 400 }); }
function admin(auth) { if (auth?.role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 }); }
function fold(value) { return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").replace(/[\s\p{P}\p{S}]+/gu, ""); }
function filters(input = {}) {
  const params = [], where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
  if (input.q) {
    if (typeof input.q !== "string" || input.q.length > 300) bad("คำค้นยาวเกินกำหนด");
    if (!fold(input.q)) bad("กรุณาระบุชื่อสินค้า รหัส ล็อต หรือเลขเอกสาร");
    add("strpos(r.search_key, ?) > 0", fold(input.q));
  }
  if (input.branch) { if (!BRANCHES.includes(input.branch)) bad("สาขาไม่ถูกต้อง"); add("r.branch_code=?", input.branch); }
  for (const [key, operator] of [["dateFrom", ">="], ["dateTo", "<="]]) {
    if (!input[key]) continue;
    const value = input[key];
    if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) bad("วันที่ไม่ถูกต้อง");
    add(`r.received_date ${operator} ?::date`, value);
  }
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) bad("วันเริ่มต้องไม่เกินวันสิ้นสุด");
  if (input.lot) {
    if (typeof input.lot !== "string" || input.lot.length > 200) bad("ล็อตไม่ถูกต้อง");
    add("r.lot=?", input.lot.trim());
  }
  const limit = input.limit == null ? 50 : Number(input.limit), offset = input.offset == null ? 0 : Number(input.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) bad("หน้าข้อมูลไม่ถูกต้อง");
  return { params, where: where.length ? "WHERE " + where.join(" AND ") : "", limit, offset };
}
const active = "FROM ky9_documents.receiving_rows r JOIN ky9_documents.receiving_heads h ON h.batch_id=r.batch_id JOIN ky9_documents.receiving_batches b ON b.id=r.batch_id";
const columns = `r.row_key,r.batch_id,r.event_id,r.branch_code,r.received_date::text,r.product_code,r.product_name,
 r.lot,r.document_no,r.invoice_no,r.supplier,r.movement_type,b.period,b.label AS batch_label,
 r.data->>'reportQuantityDisplay' AS quantity_display,r.data->'qty' AS quantity,r.data->>'unit' AS unit,
 r.data->'baseQty' AS base_quantity,r.data->>'quantityUnit' AS base_unit,r.data->>'expiry' AS expiry,
 r.data->>'manufacturedDate' AS manufactured_date,r.data->'freeGoods' AS free_goods,
 r.data->>'manufacturedPrecision' AS manufactured_precision,r.data->>'expiryPrecision' AS expiry_precision,
 r.data->>'status' AS source_status,r.data->>'sourceFile' AS source_file,r.data->>'sourceSha256' AS source_sha256,
 r.data->>'sourceId' AS source_id,r.data->'physical_lot_confirmed' AS physical_lot_confirmed,
 r.data->>'batchExceptionLabel' AS batch_exception_label`;
function createKy9ReceivingArchive(db) {
  async function batches(auth) {
    admin(auth);
    return { batches: (await db.query(`SELECT b.id,b.period,b.label,b.content_sha256,b.row_count,b.manifest,b.created_at,
      (h.batch_id=b.id) AS is_current FROM ky9_documents.receiving_batches b
      LEFT JOIN ky9_documents.receiving_heads h ON h.period=b.period ORDER BY b.period DESC,b.created_at DESC,b.id`)).rows };
  }
  async function search(auth, input) {
    admin(auth); const f = filters(input);
    // One read snapshot keeps the count and the page on the same revision.
    const c = await db.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const total = Number((await c.query(`SELECT count(*) AS total ${active} ${f.where}`, f.params)).rows[0].total);
      const rows = (await c.query(`SELECT ${columns} ${active} ${f.where}
        ORDER BY r.received_date,r.branch_code,r.document_no,r.row_key LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
      [...f.params, f.limit, f.offset])).rows;
      await c.query("COMMIT");
      return { rows, total, limit: f.limit, offset: f.offset, draft: true, stockEffect: "none" };
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
  async function detail(auth, key, batch) {
    admin(auth);
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(batch || "")) bad("รหัสรายการไม่ถูกต้อง");
    const row = (await db.query(`SELECT ${columns},r.data,b.manifest,b.content_sha256 ${active.replace(" JOIN ky9_documents.receiving_heads h ON h.batch_id=r.batch_id", "")}
      WHERE r.row_key=$1 AND r.batch_id=$2::uuid`, [key, batch])).rows[0];
    if (!row) throw Object.assign(new Error("ไม่พบรายการ"), { status: 404 });
    return { ...row, draft: true, stockEffect: "none" };
  }
  async function handoff(auth, input) {
    admin(auth); const f = filters(input);
    // An export is one statement/snapshot, independent of the current UI page.
    const rows = (await db.query(`SELECT ${columns},r.data->'pairedEventIds' AS paired_event_ids,
      r.data->'batchAssignmentBasis' AS lot_assignment_basis,r.data->'batch_exception' AS batch_exception,
      r.data->'issues' AS source_issues,r.data->'sourcePage' AS source_page,
      b.content_sha256 AS archive_sha256 ${active} ${f.where}
      ORDER BY r.received_date,r.branch_code,r.document_no,r.row_key LIMIT 20001`, f.params)).rows;
    if (rows.length > 20000) throw Object.assign(new Error("กรุณาลดช่วงวันหรือเลือกสาขาก่อนส่งออก"), { status: 413 });
    return {
      schema: "sc.ky9.receiving-lot-evidence.v1", exportedAt: new Date().toISOString(),
      filters: Object.fromEntries(["q", "branch", "dateFrom", "dateTo", "lot"].filter(k => input[k]).map(k => [k, input[k]])),
      rowCount: rows.length, draft: true, ready: false, human_verified: false, stockEffect: "none",
      purpose: "Receiving/lot evidence for KY10/KY11 reconciliation; not sales, opening balances or buyer allocations.",
      quantityRule: "qty/unit and reportQuantityDisplay are retained from the draft; baseQty is already converted. Do not multiply the pack factor again.",
      evidenceRule: "Read the immutable original row using archive.lookupPath when a decision, exception or lot proposal needs full context.",
      rows: rows.map(r => ({
        id: r.event_id, branch: r.branch_code, date: r.received_date, productCode: r.product_code, productName: r.product_name,
        lot: r.lot, manufacturedDate: r.manufactured_date, expiry: r.expiry,
        manufacturedPrecision: r.manufactured_precision, expiryPrecision: r.expiry_precision, qty: r.quantity, unit: r.unit,
        baseQty: r.base_quantity, quantityUnit: r.base_unit, reportQuantityDisplay: r.quantity_display,
        documentNo: r.document_no, invoiceNo: r.invoice_no, supplier: r.supplier, type: r.movement_type,
        freeGoods: r.free_goods, pairedEventIds: r.paired_event_ids, status: r.source_status,
        sourceFile: r.source_file, sourceSha256: r.source_sha256, sourceId: r.source_id, sourcePage: r.source_page,
        lotAssignmentBasis: r.lot_assignment_basis, batchException: r.batch_exception,
        batchExceptionLabel: r.batch_exception_label, sourceIssues: r.source_issues,
        physical_lot_confirmed: r.physical_lot_confirmed === true, ready: false, human_verified: false,
        archive: { batchId: r.batch_id, rowKey: r.row_key, period: r.period, label: r.batch_label, sha256: r.archive_sha256,
          lookupPath: `/api/admin/ky9-documents/archive/rows/${r.row_key}?batch=${r.batch_id}` },
      })),
    };
  }
  return { batches, search, detail, handoff };
}
module.exports = { createKy9ReceivingArchive, filters, fold };
