'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');
const { createDbPool } = require('../apps/admin-api/src/db');
const { sha256, validateTemplate } = require('../apps/admin-api/src/services/scpdaAnnualWorkbook');

const groups = { common: 'สามัญ', normal: 'ปกติ', pharma: 'เภสัช' };

async function prepareEvent({ label, branch, warehouse, pageMap, files }) {
  if (typeof label !== 'string' || !label.trim() || label.length > 120 ||
      !/^\d{3}$/.test(branch) || !/^\d{3}$/.test(warehouse)) {
    throw Error('ระบุชื่ออีเวนท์ รหัสสาขา และรหัสคลัง');
  }
  const seen = new Set();
  const result = { label: label.trim(), branch, warehouse, sourceFiles: {}, pages: [] };
  for (const [category, group] of Object.entries(groups)) {
    const sourcePath = files[category];
    const mapping = pageMap[group];
    if (!sourcePath || path.extname(sourcePath).toLowerCase() !== '.xlsx' ||
        !Array.isArray(mapping) || !mapping.length || mapping.length > 999) {
      throw Error(`ต้องมีไฟล์ใบนับและผังหน้า A4 ของหมวด ${group}`);
    }
    const bytes = await fs.readFile(sourcePath);
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw Error(`ไฟล์ใบนับ ${group} มีขนาดไม่รองรับ`);
    const items = [];
    for (const [index, page] of mapping.entries()) {
      if (!Array.isArray(page) || !page.length || page.length > 120) throw Error(`ผัง ${group} หน้า ${index + 1} ไม่ถูกต้อง`);
      const pageItems = [];
      for (const [ordinal, code, name, barcode, unit, type] of page) {
        if (ordinal !== items.length + 1 || [code, name, barcode, unit].some(value => typeof value !== 'string' || !value.trim()) ||
            seen.has(code)) throw Error(`ผังรายการ ${group} ลำดับ ${ordinal} ไม่ถูกต้องหรือซ้ำ`);
        seen.add(code);
        const item = { row: ordinal + 2, ordinal, code, name, barcode, unit, type: type || '' };
        items.push(item);
        pageItems.push(item);
      }
      result.pages.push({ category, pageNo: index + 1, items: pageItems });
    }
    validateTemplate(bytes, items, { branch, warehouse });
    result.sourceFiles[category] = {
      filename: path.basename(sourcePath).replace(/\.xlsx$/i, '_ผลนับ.xlsx'),
      base64: bytes.toString('base64'),
      sha256: sha256(bytes),
    };
  }
  return result;
}

async function insertEvent(db, event) {
  const client = await db.connect();
  const id = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO ordering.scpda_annual_events (id,branch_code,warehouse_code,label,source_files) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [id, event.branch, event.warehouse, event.label, JSON.stringify(event.sourceFiles)],
    );
    for (const page of event.pages) {
      await client.query(
        'INSERT INTO ordering.scpda_annual_pages (event_id,category,page_no,items) VALUES ($1,$2,$3,$4::jsonb)',
        [id, page.category, page.pageNo, JSON.stringify(page.items)],
      );
    }
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.constraint === 'scpda_annual_open_event_per_branch') throw Error('สาขานี้มีอีเวนท์เปิดอยู่แล้ว');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    label: { type: 'string' }, branch: { type: 'string' }, warehouse: { type: 'string' },
    'page-map': { type: 'string' }, common: { type: 'string' }, normal: { type: 'string' }, pharma: { type: 'string' },
    apply: { type: 'boolean' },
  } });
  if (!values['page-map']) throw Error('ระบุ --page-map จากพรีวิว PDF ของไฟล์ชุดเดียวกัน');
  const pageMap = JSON.parse((await fs.readFile(values['page-map'], 'utf8')).replace(/^\uFEFF/, ''));
  const event = await prepareEvent({ ...values, pageMap, files: values });
  const report = { branch: event.branch, warehouse: event.warehouse, label: event.label, categories: {} };
  for (const key of Object.keys(groups)) {
    const pages = event.pages.filter(page => page.category === key);
    report.categories[key] = { pages: pages.length, items: pages.reduce((sum, page) => sum + page.items.length, 0), sha256: event.sourceFiles[key].sha256 };
  }
  if (values.apply) {
    const db = createDbPool({ databaseUrl: process.env.SCPDA_ANNUAL_IMPORT_DATABASE_URL });
    try { report.eventId = await insertEvent(db, event); } finally { await db.end(); }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { insertEvent, prepareEvent };
