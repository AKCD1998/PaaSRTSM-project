'use strict';

// Operator CLI only. The private delivery ZIP is never served by an HTTP route.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const XLSX = require('xlsx');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { createDbPool } = require('../apps/admin-api/src/db');
const { sha256 } = require('../apps/admin-api/src/services/scpdaAnnualWorkbook');
const { prepareEvent, insertEvent } = require('./import_scpda_annual_event');

async function prepareBundle(bytes, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || bytes.length > 2 * 1024 * 1024 || sha256(bytes) !== expectedHash) {
    throw Error('Private handoff ZIP hash or size mismatch');
  }
  const zip = XLSX.CFB.read(bytes, { type: 'buffer' });
  const entries = new Map(zip.FullPaths.map((raw, index) => [
    Buffer.from(raw, 'latin1').toString('utf8').replace(/^Root Entry\//, ''), zip.FileIndex[index],
  ]));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scpda-annual-005-'));
  try {
    const files = {};
    for (const [key, category] of Object.entries({ common: 'สามัญ', normal: 'ปกติ', pharma: 'เภสัช' })) {
      const filename = `005-001_ธันวาคม-2569_${category}.xlsx`;
      const entry = entries.get('event-inputs/' + filename);
      if (!entry || entry.size > 2 * 1024 * 1024) throw Error('Approved blank count form is missing');
      files[key] = path.join(tmp, filename);
      await fs.writeFile(files[key], Buffer.from(entry.content), { mode: 0o600 });
    }
    const mapping = entries.get('event-inputs/page-data.json');
    if (!mapping || mapping.size > 4 * 1024 * 1024) throw Error('Approved A4 page mapping is missing');
    const pageMap = JSON.parse(Buffer.from(mapping.content).toString('utf8').replace(/^\uFEFF/, ''));
    return await prepareEvent({ label: 'นับสต๊อก ธ.ค. 2569 · สาขา 005 · คลัง 001', branch: '005', warehouse: '001', pageMap, files });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    file: { type: 'string' }, 'object-key': { type: 'string' }, sha256: { type: 'string' },
    apply: { type: 'boolean' }, 'use-service-db': { type: 'boolean' },
  } });
  if (Boolean(values.file) === Boolean(values['object-key'])) throw Error('Choose exactly one private ZIP input');
  let bytes;
  if (values.file) bytes = await fs.readFile(values.file);
  else {
    if (!/^scpda-annual-import\/005\/[a-f0-9-]{36}\.zip$/.test(values['object-key'])) throw Error('Invalid private import object');
    const client = new S3Client({ endpoint: process.env.R2_ENDPOINT, region: process.env.R2_REGION || 'auto',
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: values['object-key'] }));
      if (object.ContentLength > 2 * 1024 * 1024) throw Error('Private import exceeds limit');
      bytes = Buffer.from(await object.Body.transformToByteArray());
    } finally { client.destroy(); }
  }
  const event = await prepareBundle(bytes, values.sha256);
  const report = { branch: event.branch, warehouse: event.warehouse, label: event.label, pages: event.pages.length,
    items: event.pages.reduce((n, page) => n + page.items.length, 0), blankFormsValidated: true, applied: false };
  if (values.apply) {
    const db = createDbPool({ databaseUrl: values['use-service-db'] ? process.env.DATABASE_URL : process.env.SCPDA_ANNUAL_IMPORT_DATABASE_URL });
    try { report.eventId = await insertEvent(db, event); report.applied = true; } finally { await db.end(); }
  }
  process.stdout.write(JSON.stringify(report) + '\n');
}

if (require.main === module) main().catch(error => {
  // Provider/network errors may contain credentials or a signed request URL.
  console.error(JSON.stringify({ imported: false, code: error.code || error.name || 'IMPORT_FAILED' }));
  process.exitCode = 1;
});

module.exports = { prepareBundle };
