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
  assert.equal(r.status, 200); assert.ok(r.body.documents.length); assert.equal(r.body.archiveTotal, 177);
  for (const d of r.body.documents) { assert.equal(d.branch, '005'); assert.equal(d.month, '2026-12'); assert.equal(d.file, undefined); assert.equal(d.objectKey, undefined); assert.equal(d.signatureApplied, true); }
  assert.equal(r.body.exclusions.length, 2); assert.match(r.headers['cache-control'], /no-store/);
});
test('PDF download uses allowlisted identifiers and transports storage bytes', async () => {
  const a = await request(app).get('/api/admin/pjk-documents/?month=2026-11').set('Cookie', cookie('admin'));
  const r = await request(app).get('/api/admin/pjk-documents/' + a.body.documents[0].id + '/pdf').set('Cookie', cookie('admin'));
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /application\/pdf/); assert.equal(r.body.subarray(0,4).toString(), '%PDF');
  assert.equal((await request(app).get('/api/admin/pjk-documents/nonexistent/pdf').set('Cookie', cookie('admin'))).status, 404);
});
