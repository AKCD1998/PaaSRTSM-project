"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const { Pool } = require("pg");
const { signSessionToken } = require("../apps/admin-api/src/auth/session");
const { createKy9DocumentsRouter } = require("../apps/admin-api/src/routes/ky9-documents");
const { parseIncident, parseBranches, parseDraft, defaultBranches } = require("../apps/admin-api/src/services/ky9Documents");

const config = { authJwtSecret: "ky9-test-only-secret", cookieName: "test_session", sessionTtlHours: 1 };
const csrf = "test-csrf";
const base = "/api/admin/ky9-documents";
function cookie(role = "admin", user = "admin-test") {
  return `test_session=${signSessionToken({ sub: user, role, csrf }, config)}`;
}
function appWith(db) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(base, createKy9DocumentsRouter({ config, db }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}
function incident(patch = {}) {
  return {
    title: "ใบรับตรงยอด แต่สินค้าต่างจากบิล", branchCodes: ["000", "004"],
    facts: "ยอดรวมเท่ากัน แต่มีสินค้าต่างกัน 5 รายการ", status: "investigating", blocksPeriod: true,
    ...patch,
  };
}
test("validation preserves facts separately and requires evidence, impact and conclusion for closure", () => {
  const parsed = parseIncident(incident({ hypotheses: "อาจคีย์ผิดใบ", closed_by: "forged", human_verified: true }));
  assert.equal(parsed.facts, "ยอดรวมเท่ากัน แต่มีสินค้าต่างกัน 5 รายการ");
  assert.equal(parsed.hypotheses, "อาจคีย์ผิดใบ");
  assert.equal(parsed.human_verified, undefined);
  assert.equal(parsed.closed_by, undefined);
  for (const missing of ["evidence", "impact", "conclusion"]) {
    assert.throws(() => parseIncident(incident({
      status: "closed", blocksPeriod: false, resolutionType: "documented_unresolved",
      evidence: "ใบสแกน", impact: "เก็บข้อแตกต่างในร่าง R6", conclusion: "ยุติการสืบค้น", [missing]: "",
    })), { status: 400 });
  }
  assert.throws(() => parseIncident(incident({ branchCodes: ["002"] })), { status: 400 });
  assert.throws(() => parseIncident(incident({ blocksPeriod: "false" })), { status: 400 });
  const branches = defaultBranches();
  branches["004"].review = "signed";
  assert.throws(() => parseBranches(branches), { status: 400 });
  branches["004"].reviewReference = "เภสัชกรเซ็นและเก็บฉบับ R6 ที่สาขา";
  assert.equal(parseBranches(branches)["004"].review, "signed");
});
test("draft references reject script/local links and embedded credentials", () => {
  const draft = { branchCode: "000", label: "R6", reference: "รายงาน.pdf" };
  for (const url of ["javascript:alert(1)", "file:///C:/private/report.pdf", "https://user:pass@example.com/x", "http://example.com/x"]) {
    assert.throws(() => parseDraft({ ...draft, url }), { status: 400 });
  }
  assert.equal(parseDraft({ ...draft, url: "https://example.com/report.pdf" }).label, "R6");
});
test("all document routes require admin; mutations require session CSRF before any DB call", async () => {
  const app = appWith({ connect() { assert.fail("unauthorized DB connection"); }, query() { assert.fail("unauthorized DB query"); } });
  const endpoints = [
    ["get", "/2026-09"], ["get", "/2026-09/events"], ["post", "/2026-09"], ["put", "/2026-09"],
    ["post", "/2026-09/incidents"], ["put", "/2026-09/incidents/11111111-1111-4111-8111-111111111111"],
    ["post", "/2026-09/notes"], ["post", "/2026-09/drafts"],
  ];
  for (const [verb, suffix] of endpoints) {
    await request(app)[verb](base + suffix).expect(401);
    for (const role of ["staff", "branch", "online_marketing", "superadmin"]) {
      await request(app)[verb](base + suffix).set("Cookie", cookie(role)).set("X-CSRF-Token", csrf).send({}).expect(403);
    }
    if (verb !== "get") await request(app)[verb](base + suffix).set("Cookie", cookie()).send({}).expect(403);
  }
  await request(app).get(base + "/2569-09").set("Cookie", cookie()).expect(400);
  await request(app).get(base + "/2026-09/events?before=9999999999999999999").set("Cookie", cookie()).expect(400);
});

const dbUrl = process.env.KY9_DOCUMENTS_TEST_DATABASE_URL;
(dbUrl ? test : test.skip)("REAL POSTGRES: isolated register, concurrency, closures, immutable audit and draft supersession", async t => {
  const url = new URL(dbUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "tests require local disposable Postgres");
  assert.match(url.pathname, /^\/sc_ky9_documents_test_[a-z0-9_]+$/);
  const db = new Pool({ connectionString: dbUrl, max: 4 });
  t.after(() => db.end());
  assert.match((await db.query("SELECT current_database() AS name")).rows[0].name, /^sc_ky9_documents_test_/);
  await db.query("DROP SCHEMA IF EXISTS ky9_documents CASCADE");
  const migration = fs.readFileSync(path.join(__dirname, "../migrations/076_add_ky9_document_register.sql"), "utf8");
  await db.query(migration);
  await db.query(migration);
  // Synthetic evidence only; real business incidents are never source fixtures.
  for (let i = 0; i < 6; i++) {
    await db.query(
      "INSERT INTO ky9_documents.prepared_cases(period,source_key,evidence_as_of,data) VALUES($1,$2,$3,$4::jsonb)",
      ["2026-09", `synthetic-case-${i}`, "2026-10-23", JSON.stringify(incident({ title: `เคสตัวอย่าง ${i}` }))],
    );
  }
  const app = appWith(db);
  const send = (verb, suffix, body, user = "admin-test") => request(app)[verb](base + suffix)
    .set("Cookie", cookie("admin", user)).set("X-CSRF-Token", csrf).send(body);
  const read = () => send("get", "/2026-09").then(r => { assert.equal(r.status, 200); return r.body; });
  assert.equal((await read()).period, null, "GET never creates data");
  assert.equal((await read()).preparedIncidents.length, 6, "prepared evidence never silently creates cases");
  await send("post", "/2026-09", { reason: "เปิดงวดทดสอบ" }).expect(200);
  await send("post", "/2026-09", { reason: "เปิดซ้ำ" }).expect(409);
  await send("post", "/2026-10", { reason: "อีกงวด" }).expect(200);
  const created = await send("post", "/2026-09/incidents", { data: incident(), reason: "พบข้อแตกต่าง" }).expect(200);
  const id = created.body.id;
  const concurrent = await Promise.all(["A", "B"].map(owner => send("put", `/2026-09/incidents/${id}`,
    { data: incident({ owner }), expectedVersion: 1, reason: "มอบหมาย" })));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  let bundle = await read();
  assert.equal(bundle.incidents[0].version, 2);
  const beforeFailures = bundle.events.length;
  await send("put", `/2026-09/incidents/${id}`, {
    data: incident({ status: "closed", resolutionType: "documented_unresolved", blocksPeriod: false }),
    expectedVersion: 2, reason: "ไม่มีหลักฐาน",
  }).expect(400);
  await send("post", "/2026-10/notes", { body: "ผิดงวด", incidentId: id }).expect(400);
  await send("put", `/2026-10/incidents/${id}`, { data: incident(), expectedVersion: 2, reason: "ผิดงวด" }).expect(404);
  bundle = await read();
  assert.equal(bundle.events.length, beforeFailures, "failed changes roll back audit and rows");
  const closedData = incident({
    status: "closed", resolutionType: "documented_unresolved", blocksPeriod: false,
    evidence: "sourceID SCAN-TEST-P1 · รายงานทดสอบ · คำยืนยันผู้ดูแล",
    impact: "ร่าง R6 คงข้อแตกต่างที่ยังแก้ต้นทางไม่ได้", conclusion: "ตรวจหลายทางแล้ว ยุติการสืบค้น",
  });
  const closed = await send("put", `/2026-09/incidents/${id}`, {
    data: closedData, expectedVersion: 2, reason: "ยุติการสืบค้นตามหลักฐาน", closed_by: "forged", closed_at: "2000-01-01",
  }).expect(200);
  assert.equal(closed.body.closed_by, "admin-test");
  assert.notEqual(closed.body.closed_at.slice(0, 4), "2000");
  bundle = await read();
  assert.equal(bundle.period.branches["004"].review, "not_sent");
  assert.equal(bundle.period.branches["004"].coverage, "in_progress", "closure cannot silently complete a period");
  await send("put", `/2026-09/incidents/${id}`, {
    data: { ...closedData, conclusion: "เพิ่มเติมข้อสรุป" }, expectedVersion: 3, reason: "เพิ่มรายละเอียด",
  }, "second-admin").expect(200);
  bundle = await read();
  assert.equal(bundle.incidents[0].closed_by, "admin-test", "amendment retains original closure attribution");
  await send("put", `/2026-09/incidents/${id}`, {
    data: incident(), expectedVersion: 4, reason: "มีหลักฐานใหม่",
  }).expect(200);
  bundle = await read();
  assert.equal(bundle.incidents[0].closed_at, null);
  assert.ok(bundle.events.some(e => e.action === "reopened" && e.before_data.closed_by === "admin-test"));
  const branches = defaultBranches();
  branches["004"].review = "signed"; branches["004"].reviewReference = "เซ็นฉบับแรก";
  await send("put", "/2026-09", { branches, expectedVersion: bundle.period.version, reason: "ยังไม่มีร่าง" }).expect(400);
  const draft1 = await send("post", "/2026-09/drafts", {
    branchCode: "004", label: "R6", reference: "สาขา004_R6.pdf", reason: "ร่างแรก", expectedVersion: bundle.period.version,
  }).expect(200);
  bundle = await read();
  await send("put", "/2026-09", { branches, expectedVersion: bundle.period.version, reason: "ได้รับคำยืนยันตรวจและเซ็น R6" }).expect(200);
  bundle = await read();
  const draftBody = { branchCode: "004", label: "R7", reference: "สาขา004_R7.pdf", reason: "แก้ไขเพิ่มเติม",
    supersedes: draft1.body.id, expectedVersion: bundle.period.version };
  const revisions = await Promise.all([send("post", "/2026-09/drafts", draftBody), send("post", "/2026-09/drafts", draftBody)]);
  assert.deepEqual(revisions.map(r => r.status).sort(), [200, 409]);
  bundle = await read();
  assert.equal(bundle.drafts.length, 2);
  assert.equal(bundle.drafts.filter(d => d.is_current).length, 1);
  assert.equal(bundle.period.branches["004"].review, "not_sent");
  assert.equal(bundle.period.branches["004"].reviewReference, "");
  assert.ok(bundle.events.some(e => e.action === "draft_review_reset" && e.before_data.branches["004"].review === "signed"));
  for (const table of ["events", "notes", "drafts", "prepared_cases"]) {
    if (table === "notes") await send("post", "/2026-09/notes", { body: "คำยืนยันของผู้ใช้", incidentId: id }).expect(200);
    await assert.rejects(db.query(`DELETE FROM ky9_documents.${table}`), /append-only/);
  }
  await assert.rejects(db.query("UPDATE ky9_documents.events SET reason='rewrite'"), /append-only/);
  for (let i = 0; i < 102; i++) await send("post", "/2026-09/notes", { body: `บันทึกติดตาม ${i}` }).expect(200);
  bundle = await read();
  assert.equal(bundle.events.length, 100);
  assert.ok(bundle.nextBefore);
  const older = await send("get", `/2026-09/events?before=${bundle.nextBefore}`).expect(200);
  assert.ok(older.body.events.length > 0);
  assert.ok(!older.body.events.some(old => bundle.events.some(recent => recent.id === old.id)));
  assert.ok(older.body.events.every(e => e.actor === "admin-test" || e.actor === "second-admin"));
  assert.equal((await send("get", "/2026-10")).body.incidents.length, 0);
  const preparedCase = (await read()).preparedIncidents[0];
  await send("post", "/2026-09/incidents", {
    sourceKey: preparedCase.sourceKey, data: preparedCase.data, reason: "ผู้ดูแลทบทวนบันทึกแล้ว",
  }).expect(200);
  await send("post", "/2026-09/incidents", {
    sourceKey: preparedCase.sourceKey, data: preparedCase.data, reason: "ห้ามสร้างซ้ำ",
  }).expect(409);
  assert.equal((await read()).preparedIncidents.length, 5);
  await send("post", "/2026-10/incidents", {
    sourceKey: preparedCase.sourceKey, data: preparedCase.data, reason: "ผิดงวด",
  }).expect(400);
});
