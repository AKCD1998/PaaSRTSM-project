'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookies = require('cookie-parser');
const request = require('supertest');
const { requireAuth } = require('../auth/middleware');
const { signSessionToken } = require('../auth/session');
const { createMemberRegistrationTargetsRouter } = require('./member-registration-targets');
const { buildRegistrationProgress } = require('../services/memberRegistrationTargets');

const fixture = () => ({ ok: true, month: '2026-11', timeZone: 'Asia/Bangkok', generatedAt: '2026-11-03T02:00:00Z',
  trackingStartedAt: '2026-11-01T02:00:00Z', counts: [
    { date: '2026-11-01', branchCode: '001', count: 20 },
    { date: '2026-11-03', branchCode: '001', count: 3 },
    { date: '2026-11-02', branchCode: '003', count: 501 },
    { date: '2026-11-03', branchCode: null, count: 2 },
  ] });
function app({ body = fixture(), status = 200, timeoutMs = 500, fetchImpl } = {}) {
  const config = { authJwtSecret: 'test-member-targets-key', cookieName: 'session', sessionTtlHours: 1,
    crmMirrorBaseUrl: 'https://crm.example.invalid', crmMirrorInternalToken: 'server-only-test-token' };
  const calls = [];
  const server = express(); server.use(cookies());
  server.use('/api', createMemberRegistrationTargetsRouter({ config, requireAuthMiddleware: requireAuth(config), timeoutMs,
    fetchImpl: fetchImpl || (async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(body), { status }); }) }));
  const cookie = (role, branch) => `session=${signSessionToken({ sub: 'fixture', role, branch_code: branch }, config)}`;
  return { server, calls, cookie };
}
test('authenticated admin sees exact recurring targets and Thai daily/zero/future semantics', async () => {
  const { server, calls, cookie } = app();
  const result = await request(server).get('/api/member-registration-targets?month=2026-11').set('Cookie', cookie('admin'));
  assert.equal(result.status, 200); assert.match(result.headers['cache-control'], /no-store/);
  assert.deepEqual(result.body.branches.map(b => b.target), [500, 500, 250, 250]);
  assert.equal(result.body.branches[0].total, 23); assert.equal(result.body.branches[0].today, 3);
  assert.equal(result.body.branches[0].remaining, 477); assert.equal(result.body.branches[1].remaining, 0);
  assert.equal(result.body.daily[1].byBranch['001'], 0); assert.equal(result.body.daily[3].byBranch['001'], null);
  assert.equal(result.body.unassignedTotal, 2); assert.equal(result.body.partialMonth, true);
  assert.equal(calls[0].url.pathname, '/internal/crm/member-registrations');
  assert.equal(calls[0].options.headers['x-internal-token'], 'server-only-test-token');
  assert.ok(!JSON.stringify(result.body).includes('server-only-test-token'));
});
test('branch account sees only its branch; identity does not come from query parameters', async () => {
  const { server, cookie } = app();
  const result = await request(server).get('/api/member-registration-targets?month=2026-11').set('Cookie', cookie('branch', '004'));
  assert.equal(result.status, 200); assert.deepEqual(result.body.branches.map(b => b.branchCode), ['004']);
  assert.equal(result.body.unassignedTotal, undefined);
  assert.deepEqual(Object.keys(result.body.daily[0].byBranch), ['004']);
  const forged = await request(server).get('/api/member-registration-targets?month=2026-11&branchCode=001').set('Cookie', cookie('branch', '004'));
  assert.equal(forged.status, 400);
});
test('anonymous, unassigned accounts, malformed and pre-campaign queries never call CRM', async () => {
  const { server, calls, cookie } = app();
  assert.equal((await request(server).get('/api/member-registration-targets?month=2026-11')).status, 401);
  assert.equal((await request(server).get('/api/member-registration-targets?month=2026-11').set('Cookie', cookie('staff'))).status, 403);
  for (const month of ['2026-10', '2026-13', '2026-11&month=2026-12', 'garbage']) {
    assert.equal((await request(server).get('/api/member-registration-targets?month=' + month).set('Cookie', cookie('admin'))).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('unavailable/malformed CRM reports fail visibly instead of returning fabricated zero', async () => {
  for (const options of [{ status: 503, body: { error: 'private connection details' } }, { body: { ...fixture(), counts: [{ date: '2026-11-31', branchCode: '001', count: 1 }] } },
    { body: { ...fixture(), counts: [{ date: '2026-11-01', branchCode: '001', count: -1 }] } }]) {
    const { server, cookie } = app(options);
    const result = await request(server).get('/api/member-registration-targets?month=2026-11').set('Cookie', cookie('admin'));
    assert.equal(result.status, 503); assert.ok(!JSON.stringify(result.body).includes('private connection'));
  }
});
test('CRM timeout is bounded', async () => {
  const { server, cookie } = app({ timeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))) });
  assert.equal((await request(server).get('/api/member-registration-targets?month=2026-11').set('Cookie', cookie('admin'))).status, 503);
});
test('Bangkok midnight, closed month, untracked days and next-month targets', () => {
  const body = { ...fixture(), generatedAt: '2026-12-01T17:00:00Z', trackingStartedAt: '2026-11-02T17:00:00Z', counts: [] };
  const nov = buildRegistrationProgress(body, '2026-11', ['005']);
  assert.equal(nov.asOfDate, '2026-12-02'); assert.equal(nov.daily[1].status, 'untracked'); assert.equal(nov.daily[2].status, 'recorded');
  const dec = buildRegistrationProgress({ ...body, month: '2026-12' }, '2026-12', ['001']);
  assert.equal(dec.branches[0].target, 500); assert.equal(dec.partialMonth, false); assert.equal(dec.daily.length, 31);
});
