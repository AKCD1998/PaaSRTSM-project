"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookies = require('cookie-parser');
const request = require('supertest');
const { signSessionToken } = require('../apps/admin-api/src/auth/session');
const { createSccrmMemberDirectoryRouter } = require('../apps/admin-api/src/routes/sccrm-member-directory');
const config = { cookieName: 'test-members', authJwtSecret: 'synthetic-member-session-test-secret', sessionTtlHours: 1, crmMirrorBaseUrl: 'https://crm.example', crmMirrorInternalToken: 'synthetic-internal-test-token' };
const id = '11111111-1111-4111-8111-111111111111';
function app(fetchImpl, extra = {}) { const app = express(); app.use(express.json()); app.use(cookies()); app.use('/api/admin/sccrm-members', createSccrmMemberDirectoryRouter({ config, fetchImpl, ...extra })); return app; }
function session(role) { return `${config.cookieName}=${signSessionToken({ sub: 'synthetic', role, csrf:'synthetic-csrf' }, config)}`; }
function get(app, path = '', role = 'admin') { const q = request(app).get('/api/admin/sccrm-members' + path); return role ? q.set('Cookie', session(role)) : q; }
test('only cookie-authenticated admins can reach the CRM reader', async () => {
  let calls = 0; const a = app(async () => { calls++; return Response.json({ members: [] }); });
  assert.equal((await get(a, '', null)).status, 401);
  for (const role of ['staff', 'branch']) assert.equal((await get(a, '', role)).status, 403);
  assert.equal(calls, 0);
  const response = await get(a); assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal(response.headers['cache-control'], 'private, no-store');
});
test('the server supplies its own internal credential and forwards only bounded, encoded queries', async () => {
  const a = app(async (url, options) => {
    assert.equal(url.origin, 'https://crm.example'); assert.equal(url.pathname, '/internal/crm/member-directory');
    assert.equal(url.searchParams.get('search'), 'a&b'); assert.equal(url.searchParams.has('url'), false);
    assert.equal(options.headers['x-internal-token'], config.crmMirrorInternalToken); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, undefined);
    return Response.json({ members: [], total: 0 });
  });
  const response = await get(a, '?search=a%26b&url=https://evil.example');
  assert.equal(response.status, 200); assert.ok(!JSON.stringify(response.body).includes(config.crmMirrorInternalToken));
});
test('history URLs retain the requested member and invalid queries never call upstream', async () => {
  let calls = 0;
  const a = app(async url => { calls++; assert.equal(url.pathname, `/internal/crm/member-directory/${id}/purchase-history`); return Response.json({ memberId: id, purchases: [] }); });
  for (const path of ['/invalid/purchase-history', '?limit=101', '?search[a]=x', '?page=-1']) assert.equal((await get(a, path)).status, 400);
  assert.equal(calls, 0); assert.equal((await get(a, `/${id}/purchase-history`)).body.memberId, id);
});
test('missing members, outages and upstream credential errors never expose internal errors', async () => {
  assert.equal((await get(app(async () => new Response('', { status: 404 })), `/${id}/purchase-history`)).status, 404);
  for (const status of [401, 403, 500]) {
    const response = await get(app(async () => Response.json({ error: config.crmMirrorInternalToken }, { status })));
    assert.equal(response.status, 503); assert.ok(!JSON.stringify(response.body).includes(config.crmMirrorInternalToken));
  }
  const response = await get(app((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))), { timeoutMs: 10 }));
  assert.equal(response.status, 503);
});

test('link writes require both admin cookies and session CSRF before contacting CRM',async()=>{
  let calls=0;const a=app(async()=>{calls++;return Response.json({ok:true});});
  const path='/api/admin/sccrm-members/'+id+'/ada-links';
  for(const role of ['staff','branch'])assert.equal((await request(a).post(path).set('Cookie',session(role)).set('x-csrf-token','synthetic-csrf').send({})).status,403);
  assert.equal((await request(a).post(path).set('Cookie',session('admin')).send({})).status,403);
  assert.equal((await request(a).post(path).send({})).status,401);assert.equal(calls,0);
});
test('link confirmation uses a separate server credential and the authenticated actor, never a client actor',async()=>{
  const write='synthetic-separate-link-write-token';let calls=0;
  const a=app(async(url,options)=>{calls++;assert.equal(url.pathname,'/internal/crm/member-directory/'+id+'/ada-links');assert.equal(options.method,'POST');assert.equal(options.headers['x-ada-link-admin-token'],write);assert.equal(options.headers['x-internal-token'],config.crmMirrorInternalToken);assert.deepEqual(JSON.parse(options.body),{adaCode:'A-1',reviewToken:'signed-options',actor:{id:'synthetic',role:'admin'}});return Response.json({ok:true,memberId:id,adaCode:'A-1'});},{config:{...config,crmAdaLinkAdminToken:write}});
  const post=body=>request(a).post('/api/admin/sccrm-members/'+id+'/ada-links').set('Cookie',session('admin')).set('x-csrf-token','synthetic-csrf').send(body);
  assert.equal((await post({adaCode:'A-1',reviewToken:'signed-options',actor:{id:'forged',role:'admin'}})).status,400);
  const r=await post({adaCode:'A-1',reviewToken:'signed-options'});assert.equal(r.status,200);assert.equal(calls,1);assert.ok(!r.text.includes(write));
});
test('link reads stay admin-only and write conflicts expose only known safe messages',async()=>{
  const a=app(async url=>url.pathname.endsWith('/ada-links')?Response.json({ok:true,members:[],total:0}):Response.json({}));
  assert.equal((await get(a,'/ada-links','staff')).status,403);assert.equal((await get(a,'/ada-links')).status,200);
  const conflict=app(async()=>Response.json({code:'ADA_ALREADY_LINKED',error:'secret upstream detail'},{status:409}),{config:{...config,crmAdaLinkAdminToken:'synthetic-write'}});
  const r=await request(conflict).post('/api/admin/sccrm-members/'+id+'/ada-links').set('Cookie',session('admin')).set('x-csrf-token','synthetic-csrf').send({adaCode:'A-1',reviewToken:'x'});
  assert.equal(r.status,409);assert.equal(r.body.code,'ADA_ALREADY_LINKED');assert.ok(!r.text.includes('secret'));
});
