const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { signSessionToken } = require('../apps/admin-api/src/auth/session');
const { createPjkDocumentsRouter } = require('../apps/admin-api/src/routes/pjk-documents');
const config = { authJwtSecret: 'local-test-only', cookieName: 'session', sessionTtlHours: 1 };
const app = express(); app.use(cookieParser()); app.use('/api/admin/pjk-documents', createPjkDocumentsRouter({ config,
  readPdf: async () => Buffer.from('%PDF-1.4\n%transport-test\n%%EOF') }));
const cookie = role => 'session=' + signSessionToken({ sub: 'test', role }, config);
test('archive and nested PDFs require an admin session', async () => {
  for (const route of ['/', '/october-001/pdf']) {
    assert.equal((await request(app).get('/api/admin/pjk-documents' + route)).status, 401);
    assert.equal((await request(app).get('/api/admin/pjk-documents' + route).set('Cookie', cookie('branch'))).status, 403);
  }
});
test('filters, provenance and excluded shifts survive readback', async () => {
  const r = await request(app).get('/api/admin/pjk-documents/?month=2026-12&branch=005&q=25418').set('Cookie', cookie('admin'));
  assert.equal(r.status, 200); assert.ok(r.body.documents.length); assert.equal(r.body.archiveTotal, 149);
  for (const d of r.body.documents) { assert.equal(d.branch, '005'); assert.equal(d.month, '2026-12'); assert.equal(d.file, undefined); assert.equal(d.objectKey, undefined); assert.equal(d.signatureApplied, true); }
  assert.equal(r.body.exclusions.length, 2); assert.match(r.headers['cache-control'], /no-store/);
});
test('PDF download uses allowlisted identifiers and transports storage bytes', async () => {
  const a = await request(app).get('/api/admin/pjk-documents/?month=2026-11').set('Cookie', cookie('admin'));
  const r = await request(app).get('/api/admin/pjk-documents/' + a.body.documents[0].id + '/pdf').set('Cookie', cookie('admin'));
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /application\/pdf/); assert.equal(r.body.subarray(0,4).toString(), '%PDF');
  assert.equal((await request(app).get('/api/admin/pjk-documents/nonexistent/pdf').set('Cookie', cookie('admin'))).status, 404);
});

test('monthly bundles keep storage private and require admin download', async () => {
  const base='/api/admin/pjk-documents';
  assert.equal((await request(app).get(base+'/monthly/2026-11/pdf')).status,401);
  assert.equal((await request(app).get(base+'/monthly/2026-11/pdf').set('Cookie',cookie('branch'))).status,403);
  const a=await request(app).get(base+'/').set('Cookie',cookie('admin'));
  const b=a.body.monthlyBundles.find(d=>d.month==='2026-11');
  assert.equal(b.pageCount,22); assert.equal(b.objectKey,undefined); assert.equal(b.file,undefined);
  const r=await request(app).get(base+'/monthly/2026-11/pdf').set('Cookie',cookie('admin'));
  assert.equal(r.status,200); assert.match(r.headers['content-disposition'],/attachment;.*2026-11/);
  assert.equal((await request(app).get(base+'/monthly/2099-01/pdf').set('Cookie',cookie('admin'))).status,404);
});


test('corrected archive excludes test and wrapper records and retains complete recovered slots', async () => {
 const fs=require('node:fs');const archive=JSON.parse(fs.readFileSync('apps/admin-api/data/pjk-documents/manifest.json','utf8'));
 assert.equal(archive.documents.length,149);
 assert.equal(archive.documents.filter(d=>d.provenance==='legacy-recovered').length,64);
 for(const d of archive.documents){assert.ok(d.month);assert.ok(d.slots.length);assert.ok(!d.id.startsWith('legacy-'));
  for(const s of d.slots)for(const key of ['pharmacistName','pharmacistLicense','dateStart','dateEnd','timeStart','timeEnd'])assert.ok(s[key],d.id+' '+key);
 }
 const may=archive.documents.find(d=>d.id==='recovered-2026-05-005-02');assert.equal(may.slots[0].pharmacistLicense,'37877');
 assert.equal(archive.monthlyBundles.reduce((n,b)=>n+b.pageCount,0),149);
});
