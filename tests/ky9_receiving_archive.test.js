"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const express = require("express"), cookieParser = require("cookie-parser"), request = require("supertest"), { Pool } = require("pg");
const { signSessionToken } = require("../apps/admin-api/src/auth/session");
const { createKy9DocumentsRouter } = require("../apps/admin-api/src/routes/ky9-documents");
const { fold, filters, createKy9ReceivingArchive } = require("../apps/admin-api/src/services/ky9ReceivingArchive");
const { prepare, emitSql } = require("../scripts/prepare_ky9_receiving_archive_import");
const config = { authJwtSecret: "archive-test-only", cookieName: "test_session", sessionTtlHours: 1 };
const base = "/api/admin/ky9-documents/archive";
function app(db) { const a = express(); a.use(cookieParser()); a.use("/api/admin/ky9-documents", createKy9DocumentsRouter({ config, db })); a.use((e, _q, r, _n) => r.status(e.status || 500).json({ error: e.message })); return a; }
function cookie(role = "admin") { return "test_session=" + signSessionToken({ sub: "archive-test", role, csrf: "csrf" }, config); }
function row(id, date, patch = {}) { return { id, branch: "000", date, productCode: "IC-TEST001", productName: "ยาตัวอย่าง A – 5 mg", lot: "001A", qty: 2, unit: "แพ็ก", baseQty: 24, quantityUnit: "ขวด", reportQuantityDisplay: "24 ขวด", documentNo: "TEST-PR001", invoiceNo: "TEST-INVOICE01", supplier: "ตัวอย่าง", type: "supplier_receipt", ready: false, human_verified: false, physical_lot_confirmed: false, ...patch }; }
function packet() { return { batches: ["2026-07", "2026-08"].map((period, i) => ({ period, label: "synthetic-v1", manifest: { sources: [{ filename: "synthetic.json", sha256: "a".repeat(64) }] }, rows: [row("TEST-EVENT" + i, period + "-02")] })) }; }
test("identity, dates, units and stable import keys; reject duplicate or unbound rows", () => {
 assert.equal(fold(" IC - TEST001 "), fold("IC-TEST001")); assert.equal(fold("ยา A　5 mg"), fold("ยา A 5mg"));
 assert.throws(() => filters({ dateFrom: "2026-02-31" }), { status: 400 });
 assert.throws(() => filters({ q: ["injection"] }), { status: 400 });
 assert.throws(() => filters({ q: "--" }), { status: 400 });
 assert.throws(() => filters({ branch: "002" }), { status: 400 });
 assert.throws(() => filters({ limit: 200 }), { status: 400 });
  const p = packet(), first = prepare(p, "test-operator");
 assert.deepEqual(prepare(p, "test-operator"), first);
 assert.equal(first[0].rows[0].data.baseQty, 24); assert.equal(first[0].rows[0].data.qty, 2);
 const duplicate = packet(); duplicate.batches[1].rows[0].id = duplicate.batches[0].rows[0].id;
 assert.throws(() => prepare(duplicate, "x"), /Duplicate/);
 const wrongDate = packet(); wrongDate.batches[0].rows[0].date = "2026-06-30";
 assert.throws(() => prepare(wrongDate, "x"), /date/);
 const missing = packet(); missing.batches[0].rows[0].qty = null; assert.throws(() => prepare(missing, "x"), /quantities/);
 assert.throws(() => emitSql(first, "some_other_production"), /database/);
});
test("all archive routes require admin and GET has no DB writes", async () => {
 const a = app({ query() { assert.fail("unauthorized query"); }, connect() { assert.fail("unauthorized connect"); } });
 for (const suffix of ["/batches", "/rows", "/handoff", "/rows/" + "a".repeat(64) + "?batch=00000000-0000-0000-0000-000000000000"]) {
  await request(a).get(base + suffix).expect(401);
  for (const role of ["branch", "staff", "online_marketing", "superadmin"]) await request(a).get(base + suffix).set("Cookie", cookie(role)).expect(403);
 }
 await request(a).post(base + "/import").set("Cookie", cookie()).expect(403);
});
const url = process.env.KY9_ARCHIVE_TEST_DATABASE_URL;
(url ? test : test.skip)("real PostgreSQL: migration, idempotent import, cross-month search, filtered exports, history and stock isolation", async t => {
 const u = new URL(url); assert.ok(["127.0.0.1", "localhost"].includes(u.hostname)); assert.match(u.pathname, /^\/sc_ky9_archive_test_/);
 const db = new Pool({ connectionString: url, max: 3 }); t.after(() => db.end());
 // Dedicated disposable cluster/database; no production connection accepted.
 await db.query("DROP SCHEMA IF EXISTS ky9_documents CASCADE");
 await db.query("CREATE TABLE IF NOT EXISTS public.stock_sentinel(sku text PRIMARY KEY,qty int); INSERT INTO public.stock_sentinel VALUES('TEST',123) ON CONFLICT DO NOTHING");
 for (const name of ["076_add_ky9_document_register.sql", "078_add_ky9_receiving_archive.sql"]) {
  const sql = fs.readFileSync(path.join(__dirname, "../migrations", name), "utf8"); await db.query(sql); await db.query(sql);
 }
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ky9-archive-test-"));
 const psql = process.env.KY9_TEST_PSQL || "psql";
 function apply(prepared, name, okay = true, rollback = false) {
  const f = path.join(dir, name + ".sql"); fs.writeFileSync(f, emitSql(prepared, u.pathname.slice(1), rollback));
  const r = spawnSync(psql, [url, "-X", "-f", f], { encoding: "utf8", timeout: 30000, maxBuffer: 2 ** 20 });
  assert.equal(r.status === 0, okay, r.stderr || r.error?.message); return r;
 }
 const input = packet(); input.batches[1].rows[0].expiry = "2030-06-30"; input.batches[1].rows[0].expiryPrecision = "month";
 const initial = prepare(input, "test-operator"); apply(initial, "initial"); apply(initial, "again");
 assert.equal(Number((await db.query("SELECT count(*) FROM ky9_documents.receiving_rows")).rows[0].count), 2);
 const api = createKy9ReceivingArchive(db), auth = { role: "admin" };
 let r = await api.search(auth, { q: " IC TEST001 " }); assert.equal(r.total, 2); assert.equal(r.rows[0].base_quantity, 24);
 assert.equal((await api.search(auth, { q: "001A", dateFrom: "2026-08-01", branch: "000" })).total, 1);
 assert.equal((await api.search(auth, { q: "%' OR 1=1" })).total, 0);
 const data = await api.handoff(auth, { dateFrom: "2026-08-01", limit: 1, offset: 99 }); assert.equal(data.rowCount, 1);
 assert.equal(data.rows[0].qty, 2); assert.equal(data.rows[0].baseQty, 24); assert.equal(data.rows[0].ready, false);
 assert.equal(data.rows[0].expiry, "2030-06-30"); assert.equal(data.rows[0].expiryPrecision, "month");
 assert.equal(data.rows[0].physical_lot_confirmed, false); assert.equal(data.stockEffect, "none");
 const previous = initial[0], p = packet(); p.batches = [p.batches[0]]; p.batches[0].previousBatchId = previous.id;
 p.batches[0].label = "synthetic-v2"; p.batches[0].rows[0].lot = "002B";
 const next = prepare(p, "test-operator"); apply(next, "revision");
 r = await api.search(auth, { lot: "002B" }); assert.equal(r.total, 1);
 const old = await api.detail(auth, previous.rows[0].row_key, previous.id); assert.equal(old.data.lot, "001A");
 assert.equal((await api.batches(auth)).batches.length, 3);
 await assert.rejects(db.query("UPDATE ky9_documents.receiving_rows SET lot='tampered'"), /append-only/);
 apply(initial, "stale-head", false); // Cannot activate an old revision accidentally.
 assert.equal((await db.query("SELECT qty FROM public.stock_sentinel")).rows[0].qty, 123);
 const http = app(db); await request(http).get(base + "/rows?q=002B").set("Cookie", cookie()).expect(200).then(x => assert.equal(x.body.total, 1));
 await request(http).get(base + "/handoff?branch=005").set("Cookie", cookie()).expect(200).then(x => assert.equal(x.body.rowCount, 0));
 assert.equal((await db.query("SELECT count(*) FROM ky9_documents.periods")).rows[0].count, "0", "archive import does not open or certify a document period");
});
