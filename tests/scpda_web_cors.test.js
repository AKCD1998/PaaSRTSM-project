'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {createCorsMiddleware}=require('../apps/admin-api/src/server');
const origin='https://sc-stockday-pda-lab.scgroup1989-it.chatgpt.site';
function app(enabled){const a=express();a.use(createCorsMiddleware({featureScpdaWeb001:enabled,corsAllowAllOrigins:false,corsAllowedOrigins:new Set()}));a.use((_r,s)=>s.sendStatus(401));return a;}
const preflight=(a,path,o=origin)=>request(a).options(path).set('Origin',o).set('Access-Control-Request-Method','POST').set('Access-Control-Request-Headers','content-type,authorization');
test('SCPDA browser admission remains default-off',async()=>assert.equal((await preflight(app(false),'/api/scpda/auth/login')).status,403));
test('enabled capability allows only the exact Site and SCPDA prefix without cookies',async()=>{const a=app(true);for(const path of ['/api/scpda/auth/login','/api/scpda/counts','/api/scpda/counts/access/challenge']){const r=await preflight(a,path);assert.equal(r.status,204);assert.equal(r.headers['access-control-allow-origin'],origin);assert.equal(r.headers['access-control-allow-credentials'],undefined);assert.equal(r.headers['access-control-allow-headers'],'Content-Type, Authorization');}assert.equal((await preflight(a,'/api/scpda/session',origin+'.example.com')).status,403);});
test('Site gets no admin, legacy enrollment, sync or lookalike-prefix access',async()=>{for(const path of ['/admin/products','/api/mobile/enroll/start','/api/sync','/api/scpda-extra/session'])assert.equal((await preflight(app(true),path)).status,403);});
test('CORS admission never replaces authenticated route checks',async()=>{const r=await request(app(true)).get('/api/scpda/session').set('Origin',origin);assert.equal(r.status,401);});
