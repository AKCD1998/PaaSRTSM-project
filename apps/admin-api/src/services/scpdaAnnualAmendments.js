'use strict';
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const annual = require('./scpdaAnnualCount');

function changesFor(items, before, after) {
  const changes = [], summary = { added: 0, changed: 0, removed: 0, rows: 0 };
  for (const item of items) {
    const a = before[String(item.row)] || [null, null, null], b = after[String(item.row)] || [null, null, null];
    const fields = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const old = a[i] || null, next = b[i] || null;
      if (old?.quantityMilli === next?.quantityMilli && (old?.place || '') === (next?.place || '')) continue;
      const kind = !old ? 'added' : !next ? 'removed' : 'changed'; summary[kind]++;
      if (old?.quantityMilli !== next?.quantityMilli) fields.push({ label: `นับ ${i+1} · จำนวน`, kind, type: 'quantity', before: old?.quantityMilli ?? null, after: next?.quantityMilli ?? null });
      if (i >= 3 && (old?.place || '') !== (next?.place || '')) fields.push({ label: `นับ ${i+1} · ตำแหน่ง`, kind, type: 'text', before: old?.place || null, after: next?.place || null });
    }
    if (fields.length) changes.push({ row: item.row, ordinal: item.ordinal, code: item.code, name: item.name, unit: item.unit, fields,
      beforeTotal: a.reduce((n,p) => n + (p?.quantityMilli || 0),0), afterTotal: b.reduce((n,p) => n + (p?.quantityMilli || 0),0) });
  }
  summary.rows = changes.length;
  return { changes, summary };
}
async function digest(client, counts) {
  return (await client.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS hash",[JSON.stringify(counts)])).rows[0].hash;
}
function binding(who) { return `${who.deviceRef || ''}:${who.credentialVersion || ''}`; }
async function owned(client, input) {
  const page = await annual.currentPage(client,input.eventId,input.category,input.pageNo);
  if (page.assignee !== input.operator) annual.reject(404,'ANNUAL_PAGE_MISSING','ไม่พบใบนับที่มอบหมายให้คุณ');
  return page;
}
function result(row, page) {
  return { category: row.category, pageNo: row.page_no, state: 'submitted', revision: row.revision,
    mutationId: row.mutation_id, receiptId: row.receipt_id, receivedAt: row.submitted_at, savedAt: row.submitted_at,
    submissionNo: row.submission_no, totalRows: page.items.length, countedRows: page.items.length };
}
async function preview(db, input, key) {
  annual.validatePageKey(input.category,input.pageNo);
  return annual.inEvent(db,input.branchCode,input.eventId,async client => {
    const page = await owned(client,input);
    if (!page.submitted_at) annual.reject(409,'ANNUAL_NOT_SUBMITTED','หน้านี้ยังไม่เคยส่งจบ');
    const counts = annual.normalizeCounts(page.items,input.counts,true);
    const { rows: [previous] } = await client.query('SELECT submission_no FROM ordering.scpda_annual_submissions WHERE receipt_id=$1',[page.receipt_id]);
    const diff = changesFor(page.items,page.counts,counts);
    if (!diff.changes.length) return { ...diff, unchanged: true, baseReceiptId: page.receipt_id, baseRevision: page.revision, submissionNo: previous.submission_no };
    const countsHash = await digest(client,counts);
    const token = jwt.sign({ kind: 'annual-amend-review', binding: binding(input), branch: input.branchCode,
      eventId: input.eventId, category: input.category, pageNo: input.pageNo, baseReceiptId: page.receipt_id,
      baseRevision: page.revision, countsHash },key,{ algorithm:'HS256',issuer:'sc-stockday',audience:'scpda-annual-amend',subject:input.operator,expiresIn:900 });
    return { ...diff, unchanged:false, previewToken:token, baseReceiptId:page.receipt_id, baseRevision:page.revision,
      submissionNo:previous.submission_no, previousSentAt:page.submitted_at, expiresAt:new Date(Date.now()+900000).toISOString() };
  });
}
async function amend(db, input, key, authorizeSubmit) {
  annual.validatePageKey(input.category,input.pageNo);
  if (!annual.uuid.test(input.mutationId || '') || !annual.uuid.test(input.baseReceiptId || '') || !Number.isInteger(input.baseRevision)) annual.reject(400,'ANNUAL_VERSION_INVALID','ข้อมูลรุ่นผลนับไม่ถูกต้อง');
  return annual.inEvent(db,input.branchCode,input.eventId,async client => {
    const page = await owned(client,input), counts = annual.normalizeCounts(page.items,input.counts,true), hash = await digest(client,counts);
    const { rows:[replay] } = await client.query('SELECT * FROM ordering.scpda_annual_submissions WHERE event_id=$1 AND category=$2 AND page_no=$3 AND mutation_id=$4',[input.eventId,input.category,input.pageNo,input.mutationId]);
    if (replay) {
      if (replay.counts_sha256 !== hash || replay.previous_receipt_id !== input.baseReceiptId || replay.revision !== input.baseRevision+1) annual.reject(409,'ANNUAL_AMEND_CHANGED','คำขอส่งซ้ำไม่ตรงกับครั้งก่อน กรุณาตรวจใหม่');
      return result(replay,page);
    }
    if (!page.submitted_at || page.receipt_id !== input.baseReceiptId || page.revision !== input.baseRevision) annual.reject(409,'ANNUAL_AMEND_CHANGED','ผลนับเปลี่ยนระหว่างตรวจ กรุณาดูความต่างล่าสุดก่อนยืนยัน');
    let review;
    try { review = jwt.verify(input.previewToken || '',key,{algorithms:['HS256'],issuer:'sc-stockday',audience:'scpda-annual-amend',subject:input.operator}); }
    catch { annual.reject(409,'ANNUAL_REVIEW_EXPIRED','การตรวจหมดอายุ กรุณาดูความต่างใหม่'); }
    if (review.kind !== 'annual-amend-review' || review.binding !== binding(input) || review.branch !== input.branchCode ||
      review.eventId !== input.eventId || review.category !== input.category || review.pageNo !== input.pageNo ||
      review.baseReceiptId !== input.baseReceiptId || review.baseRevision !== input.baseRevision || review.countsHash !== hash) annual.reject(409,'ANNUAL_REVIEW_CHANGED','ข้อมูลไม่ตรงกับรายการที่ตรวจ กรุณาดูความต่างใหม่');
    const diff = changesFor(page.items,page.counts,counts);
    if (!diff.changes.length) annual.reject(409,'ANNUAL_AMEND_UNCHANGED','ข้อมูลตรงกับฉบับล่าสุด ไม่มีรายการให้ส่งใหม่');
    await authorizeSubmit();
    const receiptId = randomUUID();
    await client.query(`UPDATE ordering.scpda_annual_pages SET counts=$4::jsonb,revision=revision+1,mutation_id=$5,receipt_id=$6,submitted_at=clock_timestamp(),last_saved_at=clock_timestamp()
      WHERE event_id=$1 AND category=$2 AND page_no=$3`,[input.eventId,input.category,input.pageNo,JSON.stringify(counts),input.mutationId,receiptId]);
    const { rows:[saved] } = await client.query('SELECT * FROM ordering.scpda_annual_submissions WHERE receipt_id=$1',[receiptId]);
    const rowChanges = diff.changes.map(change => ({ row:change.row,before:page.counts[String(change.row)] ?? null,after:counts[String(change.row)] ?? null }));
    await client.query(`INSERT INTO ordering.scpda_annual_count_audit(event_id,category,page_no,revision,operator_code,changes,actor_name)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,(SELECT display_name FROM ordering.scpda_annual_participants WHERE event_id=$1 AND operator_code=$5))`,[input.eventId,input.category,input.pageNo,saved.revision,input.operator,JSON.stringify(rowChanges)]);
    return result(saved,page);
  });
}
async function history(db,input) {
  annual.validatePageKey(input.category,input.pageNo);
  return annual.inEvent(db,input.branchCode,input.eventId,async client => {
    const page = await owned(client,input);
    const { rows } = await client.query('SELECT * FROM ordering.scpda_annual_submissions WHERE event_id=$1 AND category=$2 AND page_no=$3 AND counts IS NOT NULL ORDER BY submission_no DESC LIMIT 3',[input.eventId,input.category,input.pageNo]);
    return { versions:rows.map(row => ({...result(row,page),counts:row.counts,actorName:row.actor_name})), items:page.items, retainedVersions:3 };
  });
}
module.exports = { changesFor, preview, amend, history };
