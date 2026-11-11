"use strict";
// Private data stays outside Git. Emits a bounded, reviewable psql transaction.
const fs = require("node:fs"), crypto = require("node:crypto");
const { fold } = require("../apps/admin-api/src/services/ky9ReceivingArchive");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
const lit = value => "'" + String(value).replace(/'/g, "''") + "'";
const uuid = hex => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
function prepare(input, actor) {
  if (!actor || actor.length > 300) throw Error("An accountable operator is required");
  if (!Array.isArray(input.batches) || !input.batches.length || input.batches.length > 24) throw Error("Invalid batches");
  const periods = new Set(), events = new Set(), result = [];
  for (const batch of input.batches) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(batch.period) || periods.has(batch.period)) throw Error("Duplicate/invalid period");
    periods.add(batch.period);
    if (typeof batch.label !== "string" || batch.label.length > 300 || !batch.label.trim()) throw Error("Invalid batch label");
    if (!batch.manifest || !Array.isArray(batch.manifest.sources) || !batch.manifest.sources.length) throw Error("Source manifest required");
    for (const s of batch.manifest.sources) if (!/^[a-f0-9]{64}$/.test(s.sha256 || "")) throw Error("Source SHA required");
    if (!Array.isArray(batch.rows) || batch.rows.length > 20000) throw Error("Too many rows");
    const rows = batch.rows.map(row => {
      if (!row || typeof row.id !== "string" || !row.id || events.has(row.id)) throw Error("Duplicate/missing receiving event: " + row?.id);
      events.add(row.id);
      if (!["000", "001", "003", "004", "005"].includes(row.branch) || !row.productCode || !row.productName || !row.documentNo) throw Error("Missing receiving identity");
      if (typeof row.date !== "string" || row.date.slice(0, 7) !== batch.period || Number.isNaN(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date) throw Error("Receiving date must belong to period");
      if (!Number.isFinite(row.qty) || row.qty <= 0 || !Number.isFinite(row.baseQty) || row.baseQty <= 0) throw Error("Unresolved quantities cannot be imported as receiving rows");
      const movementType = row.type === "transfer" ? "transfer_receipt" : row.type;
      if (!["supplier_receipt", "transfer_receipt"].includes(movementType)) throw Error("Invalid receiving type: " + row.type);
      return {
        row_key: hash(row.id), event_id: row.id, branch_code: row.branch, received_date: row.date,
        product_code: row.productCode, product_name: row.productName, lot: row.lot == null || row.lot === "" ? null : String(row.lot),
        document_no: row.documentNo, invoice_no: row.invoiceNo || "", supplier: row.supplier || "", movement_type: movementType,
        search_key: fold([row.productCode, row.productName, row.lot, row.documentNo, row.invoiceNo, row.receiptDocument,
          row.supplier, row.sourceFile, row.sourceId, JSON.stringify(row.pairedEventIds || []), JSON.stringify(row.inclusionEvidence?.native_event?.fromBranch || "")].join(" ")),
        data: row,
      };
    });
    const content = { period: batch.period, label: batch.label, manifest: batch.manifest, rows: batch.rows };
    const sha = hash(canonical(content)), id = uuid(sha);
    if (batch.previousBatchId != null && !/^[a-f0-9-]{36}$/.test(batch.previousBatchId)) throw Error("Invalid previous head");
    result.push({ id, period: batch.period, label: batch.label, content_sha256: sha,
      manifest: batch.manifest, row_count: rows.length, recorded_by: actor, previous_batch_id: batch.previousBatchId || null,
      rows: rows.map(r => ({ ...r, batch_id: id })),
    });
  }
  return result;
}
function emitSql(batches, expectedDatabase, rollback = false) {
  if (expectedDatabase !== "sc_drug_db" && !/^sc_ky9_archive_test_[a-z0-9_]+$/.test(expectedDatabase)) throw Error("Unexpected database target");
  const header = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL standard_conforming_strings=on;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN IF current_database()<>${lit(expectedDatabase)} THEN RAISE EXCEPTION 'Wrong database'; END IF; END $$;
SELECT pg_advisory_xact_lock(hashtext('ky9-receiving-archive-import'));
CREATE TEMP TABLE _ky9_archive_stage(data JSONB) ON COMMIT DROP;
COPY _ky9_archive_stage(data) FROM STDIN WITH (FORMAT csv);
`;
  const csv = batches.map(b => '"' + JSON.stringify(b).replace(/"/g, '""') + '"').join("\n");
  return header + csv + `
\\.
DO $$ DECLARE item JSONB; current_head UUID; BEGIN
 FOR item IN SELECT data FROM _ky9_archive_stage LOOP
  SELECT batch_id INTO current_head FROM ky9_documents.receiving_heads WHERE period=item->>'period';
  IF current_head IS DISTINCT FROM (item->>'previous_batch_id')::uuid AND current_head IS DISTINCT FROM (item->>'id')::uuid THEN
   RAISE EXCEPTION 'Archive head changed for %, inspect before replacing',item->>'period';
  END IF;
 END LOOP;
END $$;
INSERT INTO ky9_documents.receiving_batches(id,period,label,content_sha256,manifest,row_count,recorded_by)
 SELECT (data->>'id')::uuid,data->>'period',data->>'label',data->>'content_sha256',data->'manifest',(data->>'row_count')::int,data->>'recorded_by'
 FROM _ky9_archive_stage ON CONFLICT(period,content_sha256) DO NOTHING;
INSERT INTO ky9_documents.receiving_rows(batch_id,row_key,event_id,branch_code,received_date,product_code,product_name,lot,document_no,invoice_no,supplier,movement_type,search_key,data)
 SELECT (r->>'batch_id')::uuid,r->>'row_key',r->>'event_id',r->>'branch_code',(r->>'received_date')::date,r->>'product_code',r->>'product_name',r->>'lot',r->>'document_no',r->>'invoice_no',r->>'supplier',r->>'movement_type',r->>'search_key',r->'data'
 FROM _ky9_archive_stage s CROSS JOIN LATERAL jsonb_array_elements(s.data->'rows') r
 ON CONFLICT(batch_id,row_key) DO NOTHING;
DO $$ DECLARE item JSONB; actual BIGINT; BEGIN
 FOR item IN SELECT data FROM _ky9_archive_stage LOOP
  SELECT count(*) INTO actual FROM ky9_documents.receiving_rows WHERE batch_id=(item->>'id')::uuid;
  IF actual<>(item->>'row_count')::int THEN RAISE EXCEPTION 'Archive row count mismatch'; END IF;
 END LOOP;
END $$;
INSERT INTO ky9_documents.receiving_heads(period,batch_id)
 SELECT data->>'period',(data->>'id')::uuid FROM _ky9_archive_stage
 ON CONFLICT(period) DO UPDATE SET batch_id=EXCLUDED.batch_id WHERE receiving_heads.batch_id<>EXCLUDED.batch_id;
SELECT b.period,b.label,b.row_count,b.content_sha256 FROM ky9_documents.receiving_batches b JOIN ky9_documents.receiving_heads h ON h.batch_id=b.id ORDER BY b.period;
${rollback ? "ROLLBACK" : "COMMIT"};
`;
}
if (require.main === module) {
  const args = process.argv.slice(2), arg = key => args[args.indexOf(key) + 1];
  if (!args.includes("--input") || !args.includes("--sql-out") || !args.includes("--actor")) throw Error("Required: --input PRIVATE.json --sql-out PRIVATE.sql --actor OPERATOR [--database NAME] [--rollback]");
  const batches = prepare(JSON.parse(fs.readFileSync(arg("--input"), "utf8").replace(/^\uFEFF/, "")), arg("--actor"));
  const sql = emitSql(batches, args.includes("--database") ? arg("--database") : "sc_drug_db", args.includes("--rollback"));
  fs.writeFileSync(arg("--sql-out"), sql, { flag: "wx" });
  console.log(JSON.stringify({ batches: batches.map(({ rows, ...b }) => ({ ...b, manifest: undefined })), rows: batches.reduce((n, b) => n + b.row_count, 0), sql_sha256: hash(sql), rollback: args.includes("--rollback"), stock_effect: "none" }));
}
module.exports = { prepare, emitSql, canonical, hash };
