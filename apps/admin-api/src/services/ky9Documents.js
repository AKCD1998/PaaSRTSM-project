"use strict";

const { randomUUID } = require("node:crypto");
const BRANCHES = ["000", "001", "003", "004", "005"];
const COVERAGE = ["in_progress", "collected", "reconciled"];
const REVIEW = ["not_sent", "sent", "signed"];
const STATUS = ["investigating", "waiting", "closed"];

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function text(value, label, { required = false, max = 12000 } = {}) {
  if (value == null) value = "";
  if (typeof value !== "string" || value.length > max) fail(400, `${label} ไม่ถูกต้องหรือยาวเกินกำหนด`);
  value = value.trim();
  if (required && !value) fail(400, `กรุณาระบุ${label}`);
  return value;
}
function oneOf(value, choices, label) {
  if (!choices.includes(value)) fail(400, `${label}ไม่ถูกต้อง`);
  return value;
}
function periodKey(value) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) fail(400, "งวดเอกสารไม่ถูกต้อง");
  return value;
}
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    fail(400, "รหัสรายการไม่ถูกต้อง");
  }
  return value;
}
function version(value, actual) {
  if (!Number.isInteger(value) || value < 1) fail(400, "ต้องระบุรุ่นข้อมูลที่กำลังแก้ไข");
  if (value !== actual) fail(409, "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก");
}
function reason(body) { return text(body.reason, "เหตุผลการบันทึก", { required: true, max: 4000 }); }
function defaultBranches() {
  return Object.fromEntries(BRANCHES.map(code => [code, {
    coverage: "in_progress", review: "not_sent", reviewReference: "", pendingReason: "",
  }]));
}
function parseBranches(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== BRANCHES.join()) {
    fail(400, "ต้องระบุสถานะทั้ง 5 สาขา");
  }
  return Object.fromEntries(BRANCHES.map(code => {
    const branch = value[code] || {};
    const review = oneOf(branch.review, REVIEW, "สถานะตรวจลงนาม");
    return [code, {
      coverage: oneOf(branch.coverage, COVERAGE, "ขอบเขตความครบ"),
      review,
      reviewReference: text(branch.reviewReference, "หลักฐานการตรวจลงนาม", { required: review === "signed", max: 4000 }),
      pendingReason: text(branch.pendingReason, "สิ่งที่รอ", { max: 4000 }),
    }];
  }));
}
function parseIncident(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "ข้อมูลเคสไม่ถูกต้อง");
  if (!Array.isArray(value.branchCodes) || !value.branchCodes.length || value.branchCodes.length > 5
    || value.branchCodes.some(code => !BRANCHES.includes(code))) fail(400, "เลือกสาขาที่เกี่ยวข้อง");
  const status = oneOf(value.status, STATUS, "สถานะเคส");
  const closed = status === "closed";
  const resolutionType = closed ? oneOf(value.resolutionType, ["corrected", "documented_unresolved"], "ข้อยุติ") : "";
  const data = {
    title: text(value.title, "หัวข้อเคส", { required: true, max: 300 }),
    branchCodes: [...new Set(value.branchCodes)].sort(),
    supplier: text(value.supplier, "บริษัท", { max: 500 }),
    products: text(value.products, "สินค้า / SKU", { max: 4000 }),
    invoiceRefs: text(value.invoiceRefs, "ใบกำกับ", { max: 2000 }),
    stockRefs: text(value.stockRefs, "ใบรับ / ใบโอน", { max: 4000 }),
    facts: text(value.facts, "ข้อเท็จจริง", { required: true }),
    hypotheses: text(value.hypotheses, "ข้อสันนิษฐาน"),
    checks: text(value.checks, "ตรวจอะไรไปแล้ว"),
    evidence: text(value.evidence, "หลักฐาน / คำยืนยัน", { required: closed }),
    owner: text(value.owner, "ผู้รับผิดชอบ", { max: 300 }),
    nextAction: text(value.nextAction, "สิ่งที่รอ / งานถัดไป", { max: 4000 }),
    impact: text(value.impact, "ผลต่องวด / รุ่นเอกสาร", { required: closed, max: 4000 }),
    status,
    blocksPeriod: value.blocksPeriod === true,
    resolutionType,
    conclusion: closed ? text(value.conclusion, "ข้อสรุปและวิธีจัดการ", { required: true }) : "",
  };
  if (typeof value.blocksPeriod !== "boolean") fail(400, "ระบุว่าเคสนี้ขวางการปิดงวดหรือไม่");
  if (closed && data.blocksPeriod) fail(400, "เคสที่ยังขวางการปิดงวดต้องคงสถานะติดตามหรือรอข้อมูล");
  return data;
}
function parseDraft(value) {
  const url = text(value.url, "ลิงก์เอกสาร", { max: 2000 });
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { fail(400, "ลิงก์เอกสารไม่ถูกต้อง"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(400, "ใช้ลิงก์ HTTPS ที่ไม่มีรหัสผ่านเท่านั้น");
  }
  return {
    branchCode: oneOf(value.branchCode, BRANCHES, "สาขา"),
    label: text(value.label, "รุ่นเอกสาร", { required: true, max: 300 }),
    reference: text(value.reference, "ชื่อไฟล์ / แหล่งเก็บ", { required: true, max: 4000 }),
    url,
  };
}
function requireAdmin(auth) {
  if (auth?.role !== "admin" || !auth.userId) fail(403, "เฉพาะ admin");
}

function createKy9DocumentService(db) {
  async function transaction(period, auth, action) {
    requireAdmin(auth);
    periodKey(period);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Serialize mutations within one month, including cross-entity links and versions.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ky9-documents:${period}`]);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async function periodRow(client, period) {
    const row = (await client.query("SELECT * FROM ky9_documents.periods WHERE period=$1 FOR UPDATE", [period])).rows[0];
    if (!row) fail(404, "ยังไม่มีงวดนี้ กรุณาเปิดงวดก่อน");
    return row;
  }
  async function event(client, period, auth, type, id, action, why, before, after) {
    await client.query(
      `INSERT INTO ky9_documents.events(period,entity_type,entity_id,action,reason,actor,before_data,after_data)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
      [period, type, id, action, why, String(auth.userId), before == null ? null : JSON.stringify(before), JSON.stringify(after)],
    );
  }
  async function create(period, auth, body) {
    const why = reason(body);
    return transaction(period, auth, async client => {
      const result = await client.query(
        "INSERT INTO ky9_documents.periods(period,branches) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING *",
        [period, JSON.stringify(defaultBranches())],
      );
      if (!result.rows[0]) fail(409, "งวดนี้ถูกเปิดแล้ว กรุณาโหลดใหม่");
      await event(client, period, auth, "period", period, "created", why, null, result.rows[0]);
      return result.rows[0];
    });
  }
  async function updatePeriod(period, auth, body) {
    const branches = parseBranches(body.branches);
    const why = reason(body);
    return transaction(period, auth, async client => {
      const before = await periodRow(client, period);
      version(body.expectedVersion, before.version);
      const drafts = (await client.query(
        `SELECT d.branch_code FROM ky9_documents.drafts d WHERE d.period=$1
         AND NOT EXISTS (SELECT 1 FROM ky9_documents.drafts n WHERE n.supersedes=d.id)`, [period],
      )).rows;
      for (const code of BRANCHES) {
        if (branches[code].review !== "not_sent" && !drafts.some(d => d.branch_code === code)) {
          fail(400, `ลงทะเบียนรุ่นเอกสารสาขา ${code} ก่อนบันทึกการส่งตรวจ`);
        }
      }
      const after = (await client.query(
        "UPDATE ky9_documents.periods SET branches=$2::jsonb,version=version+1,updated_at=now() WHERE period=$1 RETURNING *",
        [period, JSON.stringify(branches)],
      )).rows[0];
      await event(client, period, auth, "period", period, "progress_updated", why, before, after);
      return after;
    });
  }
  async function saveIncident(period, auth, id, body) {
    const data = parseIncident(body.data);
    const why = reason(body);
    const sourceKey = body.sourceKey == null ? null : text(body.sourceKey, "รหัสบันทึกเดิม", { required: true, max: 100 });
    if (id) uuid(id);
    return transaction(period, auth, async client => {
      await periodRow(client, period);
      if (sourceKey && !(await client.query(
        "SELECT source_key FROM ky9_documents.prepared_cases WHERE period=$1 AND source_key=$2", [period, sourceKey],
      )).rows[0]) fail(400, "ไม่พบบันทึกที่เตรียมไว้ในงวดนี้");
      if (!id && sourceKey && (await client.query("SELECT id FROM ky9_documents.incidents WHERE period=$1 AND source_key=$2", [period, sourceKey])).rows[0]) {
        fail(409, "บันทึกนี้ถูกสร้างเป็นเคสแล้ว กรุณาโหลดใหม่");
      }
      let before = null;
      if (id) {
        before = (await client.query("SELECT * FROM ky9_documents.incidents WHERE period=$1 AND id=$2", [period, id])).rows[0];
        if (!before) fail(404, "ไม่พบเคสในงวดนี้");
        version(body.expectedVersion, before.version);
        // Keep the original closure actor/time when amending an already-closed case.
      }
      const wasClosed = before?.data.status === "closed";
      const closed = data.status === "closed";
      const after = id ? (await client.query(
        `UPDATE ky9_documents.incidents SET data=$3::jsonb,version=version+1,updated_at=now(),
         closed_at=CASE WHEN $4 THEN COALESCE(closed_at,now()) ELSE NULL END,
         closed_by=CASE WHEN $4 THEN COALESCE(closed_by,$5) ELSE NULL END
         WHERE period=$1 AND id=$2 RETURNING *`,
        [period, id, JSON.stringify(data), closed, String(auth.userId)],
      )).rows[0] : (await client.query(
        `INSERT INTO ky9_documents.incidents(id,period,data,closed_at,closed_by,source_key)
         VALUES($1,$2,$3::jsonb,CASE WHEN $4 THEN now() END,CASE WHEN $4 THEN $5 END,$6) RETURNING *`,
        [randomUUID(), period, JSON.stringify(data), closed, String(auth.userId), sourceKey],
      )).rows[0];
      const action = closed && !wasClosed ? "closed" : wasClosed && !closed ? "reopened" : id ? "updated" : "created";
      await event(client, period, auth, "incident", after.id, action, why, before, after);
      return after;
    });
  }
  async function addNote(period, auth, body) {
    const note = text(body.body, "หมายเหตุ", { required: true });
    const incidentId = body.incidentId ? uuid(body.incidentId) : null;
    return transaction(period, auth, async client => {
      await periodRow(client, period);
      if (incidentId && !(await client.query("SELECT id FROM ky9_documents.incidents WHERE period=$1 AND id=$2", [period, incidentId])).rows[0]) {
        fail(400, "เชื่อมหมายเหตุได้เฉพาะเคสในงวดเดียวกัน");
      }
      const after = (await client.query(
        "INSERT INTO ky9_documents.notes(id,period,incident_id,body,recorded_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [randomUUID(), period, incidentId, note, String(auth.userId)],
      )).rows[0];
      await event(client, period, auth, "note", after.id, "added", "เพิ่มหมายเหตุ / บันทึกติดตาม", null, after);
      return after;
    });
  }
  async function addDraft(period, auth, body) {
    const draft = parseDraft(body);
    const why = reason(body);
    const previous = body.supersedes ? uuid(body.supersedes) : null;
    return transaction(period, auth, async client => {
      const before = await periodRow(client, period);
      version(body.expectedVersion, before.version);
      const current = (await client.query(
        `SELECT d.* FROM ky9_documents.drafts d WHERE d.period=$1 AND d.branch_code=$2
         AND NOT EXISTS (SELECT 1 FROM ky9_documents.drafts n WHERE n.supersedes=d.id)`,
        [period, draft.branchCode],
      )).rows[0];
      if ((current?.id || null) !== previous) fail(409, "รุ่นเอกสารเปลี่ยนแล้ว กรุณาโหลดใหม่");
      const after = (await client.query(
        `INSERT INTO ky9_documents.drafts(id,period,branch_code,label,reference,url,supersedes,recorded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [randomUUID(), period, draft.branchCode, draft.label, draft.reference, draft.url, previous, String(auth.userId)],
      )).rows[0];
      const branches = { ...before.branches,
        [draft.branchCode]: { ...before.branches[draft.branchCode], review: "not_sent", reviewReference: "" },
      };
      const updated = (await client.query(
        "UPDATE ky9_documents.periods SET branches=$2::jsonb,version=version+1,updated_at=now() WHERE period=$1 RETURNING *",
        [period, JSON.stringify(branches)],
      )).rows[0];
      await event(client, period, auth, "draft", after.id, "registered", why, current || null, after);
      await event(client, period, auth, "period", period, "draft_review_reset", "เอกสารรุ่นใหม่ต้องส่งตรวจและลงนามใหม่", before, updated);
      return after;
    });
  }
  async function history(period, auth, before) {
    requireAdmin(auth); periodKey(period);
    if (before != null && (!/^[1-9]\d{0,18}$/.test(String(before)) || BigInt(before) > 9223372036854775807n)) {
      fail(400, "หน้าประวัติไม่ถูกต้อง");
    }
    const rows = (await db.query(
      "SELECT * FROM ky9_documents.events WHERE period=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 101",
      [period, before || null],
    )).rows;
    return { events: rows.slice(0, 100), nextBefore: rows.length > 100 ? rows[99].id : null };
  }
  async function read(period, auth) {
    requireAdmin(auth); periodKey(period);
    const client = await db.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const row = (await client.query("SELECT * FROM ky9_documents.periods WHERE period=$1", [period])).rows[0] || null;
      const incidents = (await client.query("SELECT * FROM ky9_documents.incidents WHERE period=$1 ORDER BY created_at,id", [period])).rows;
      const notes = (await client.query("SELECT * FROM ky9_documents.notes WHERE period=$1 ORDER BY created_at DESC,id DESC", [period])).rows;
      const drafts = (await client.query(
        `SELECT d.*,NOT EXISTS(SELECT 1 FROM ky9_documents.drafts n WHERE n.supersedes=d.id) AS is_current
         FROM ky9_documents.drafts d WHERE period=$1 ORDER BY d.created_at DESC,d.id DESC`, [period],
      )).rows;
      const events = (await client.query("SELECT * FROM ky9_documents.events WHERE period=$1 ORDER BY id DESC LIMIT 101", [period])).rows;
      const preparedRows = (await client.query(
        `SELECT p.source_key,p.evidence_as_of::text,p.data FROM ky9_documents.prepared_cases p
         WHERE p.period=$1 AND NOT EXISTS(SELECT 1 FROM ky9_documents.incidents i
           WHERE i.period=p.period AND i.source_key=p.source_key)
         ORDER BY p.source_key`, [period],
      )).rows;
      await client.query("COMMIT");
      const preparedIncidents = preparedRows.map(item => ({
        sourceKey: item.source_key, evidenceAsOf: item.evidence_as_of, data: parseIncident(item.data),
      }));
      return { period: row, incidents, notes, drafts, preparedIncidents,
        events: events.slice(0, 100), nextBefore: events.length > 100 ? events[99].id : null };
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  return { create, read, updatePeriod, saveIncident, addNote, addDraft, history };
}
module.exports = { createKy9DocumentService, parseIncident, parseBranches, parseDraft, defaultBranches };
