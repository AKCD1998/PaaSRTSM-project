'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest'),crypto=require('crypto'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs');
const {createScpdaStockCheckRouter,canReadStockCheck}=require('../apps/admin-api/src/routes/scpda-stock-check');
const {queryOptions}=require('../apps/admin-api/src/services/scpdaStockCheck');
const {createCountAccess}=require('../apps/admin-api/src/services/scpdaCountAccess');
const {parseConfig}=require('../apps/admin-api/src/routes/scpda-read');
test('only admin and the original/effective branch001 identities may read',()=>{
 assert.equal(canReadStockCheck({role:'admin'}),true);
 assert.equal(canReadStockCheck({role:'branch',actorBranchCode:'001',effectiveBranchCode:'001'}),true);
 for(const a of [null,{role:'staff',effectiveBranchCode:'001'},{role:'branch',actorBranchCode:'004',effectiveBranchCode:'001'},{role:'branch',actorBranchCode:'001',effectiveBranchCode:'004'}])assert.equal(Boolean(canReadStockCheck(a)),false);
});
test('disabled and denied stock-check routes never query data',async()=>{
 const db={query(){throw Error('Must not read');}},auth=actor=>(req,_res,next)=>{req.auth=actor;next();};
 const app=express();app.use('/off',createScpdaStockCheckRouter({config:{},db,requireAuthMiddleware:auth({role:'admin'})}));app.use('/denied',createScpdaStockCheckRouter({config:{featureScpdaCounts001:true},db,requireAuthMiddleware:auth({role:'branch',actorBranchCode:'004',effectiveBranchCode:'004'})}));
 assert.equal((await request(app).get('/off')).status,404);assert.equal((await request(app).get('/denied')).status,403);
});
test('catalog category and paging inputs cannot introduce another branch or unbounded pages',()=>{
 assert.deepEqual(queryOptions({}),{category:'all',search:'',limit:50,offset:0,branchCode:'001'});
 assert.equal(queryOptions({branchCode:'005'}).branchCode,'005');
 assert.equal(queryOptions({branchCode:'004'}).branchCode,'004');
 for(const q of [{category:'other'},{branchCode:'003'},{limit:101},{limit:0},{offset:-1}])assert.throws(()=>queryOptions(q));
});
test('count admission defaults to no operators and rejects non-admitted existing reader/counter tokens',async()=>{
 const records=['01001','02001','03001'].map(operatorCode=>({operatorCode,hash:bcrypt.hashSync('1111',12),version:crypto.randomUUID(),rotationDueAt:'2027-05-15T00:00:00Z'})),config={featureScpdaRead001:true,featureScpdaCounts001:true,authJwtSecret:'synthetic-count-admission-key',scpdaOperatorCredentialsJson:JSON.stringify(records)},settings=parseConfig(config),db={query:async()=>({rows:[]})};
 const token=(code,kind)=>{const parent=crypto.randomUUID(),key=kind==='reader'?settings.sessionKey:crypto.createHmac('sha256',config.authJwtSecret).update('scpda:count-session-v1').digest('base64url');return jwt.sign({sub:code,kind:kind==='reader'?'scpda-reader':'scpda-counter',role:kind==='reader'?'reader':'counter',branch_code:'001',cv:settings.operators.get(code).fingerprint,jti:crypto.randomUUID(),parent_jti:parent,device_ref:'a'.repeat(64)},key,{algorithm:'HS256',issuer:'sc-stockday',audience:kind==='reader'?'scpda-read-001':'scpda-count-001',expiresIn:'1h'});};
 const closed=createCountAccess({config,db}),onlyOne=createCountAccess({config:{...config,scpdaCountOperators001:'01001'},db});
 await assert.rejects(closed.verify({headers:{authorization:'Bearer '+token('01001','reader')}},'reader'),e=>e.code==='COUNT_OPERATOR_NOT_ADMITTED');
 for(const code of ['02001','03001'])for(const kind of ['reader','counter'])await assert.rejects(onlyOne.verify({headers:{authorization:'Bearer '+token(code,kind)}},kind),e=>e.code==='COUNT_OPERATOR_NOT_ADMITTED');
 assert.equal((await onlyOne.verify({headers:{authorization:'Bearer '+token('01001','reader')}},'reader')).operatorCode,'01001');
});
test('005 requires its own feature, allowlist and branch-bound audience before querying data',async()=>{
 const records=['01001','02001','03001','01005'].map(operatorCode=>({operatorCode,hash:bcrypt.hashSync('fixture-only-password',12),version:crypto.randomUUID(),rotationDueAt:'2027-05-16T00:00:00Z'}));
 const config={authJwtSecret:'synthetic-005-only-secret',featureScpdaRead001:true,featureScpdaCounts001:true,scpdaCountOperators001:'01001,01005',scpdaOperatorCredentialsJson:JSON.stringify(records)};
 const settings=parseConfig(config),db={query:async()=>({rows:[]})};
 const token=(branch,aud)=>jwt.sign({sub:'01005',role:'reader',kind:'scpda-reader',branch_code:branch,cv:settings.operators.get('01005').fingerprint,jti:crypto.randomUUID(),device_ref:'b'.repeat(64)},settings.sessionKey,{algorithm:'HS256',issuer:'sc-stockday',audience:aud,expiresIn:'1h'});
 const req=(branch='005',aud='scpda-read-005')=>({headers:{authorization:'Bearer '+token(branch,aud)}});
 await assert.rejects(createCountAccess({config,db}).verify(req(),'reader'),e=>e.code==='COUNT_ACCESS_REQUIRED');
 const open=createCountAccess({config:{...config,featureScpdaBranch005:true},db});
 assert.equal((await open.verify(req(),'reader')).branchCode,'005');
 await assert.rejects(open.verify(req('001','scpda-read-001'),'reader'),e=>e.code==='COUNT_ACCESS_REQUIRED');
 await assert.rejects(open.verify(req('005','scpda-read-001'),'reader'),e=>e.code==='COUNT_ACCESS_REQUIRED');
 await assert.rejects(createCountAccess({config:{...config,featureScpdaBranch005:true,scpdaCountOperators001:'01001'},db}).verify(req(),'reader'),e=>e.code==='COUNT_OPERATOR_NOT_ADMITTED');
});

test('004 requires its own feature, allowlist and branch-bound audience before querying data',async()=>{
 const records=['01001','02001','03001','01004'].map(operatorCode=>({operatorCode,hash:bcrypt.hashSync('fixture-only-password',12),version:crypto.randomUUID(),rotationDueAt:'2027-05-16T00:00:00Z'}));
 const config={authJwtSecret:'synthetic-004-only-secret',featureScpdaRead001:true,featureScpdaCounts001:true,scpdaCountOperators001:'01001,01004',scpdaOperatorCredentialsJson:JSON.stringify(records)};
 const settings=parseConfig(config),db={query:async()=>({rows:[]})};
 const token=(branch,aud)=>jwt.sign({sub:'01004',role:'reader',kind:'scpda-reader',branch_code:branch,cv:settings.operators.get('01004').fingerprint,jti:crypto.randomUUID(),device_ref:'b'.repeat(64)},settings.sessionKey,{algorithm:'HS256',issuer:'sc-stockday',audience:aud,expiresIn:'1h'});
 const req=(branch='004',aud='scpda-read-004')=>({headers:{authorization:'Bearer '+token(branch,aud)}});
 await assert.rejects(createCountAccess({config,db}).verify(req(),'reader'),e=>e.code==='COUNT_ACCESS_REQUIRED');
 await assert.rejects(createCountAccess({config:{...config,featureScpdaBranch005:true},db}).verify(req(),'reader'),e=>e.code==='COUNT_ACCESS_REQUIRED');
 const open=createCountAccess({config:{...config,featureScpdaBranch004:true},db});
 assert.equal((await open.verify(req(),'reader')).branchCode,'004');
 await assert.rejects(open.verify(req('001','scpda-read-001'),'reader'),e=>e.code==='COUNT_ACCESS_REQUIRED');
 await assert.rejects(open.verify(req('004','scpda-read-001'),'reader'),e=>e.code==='COUNT_ACCESS_REQUIRED');
 await assert.rejects(createCountAccess({config:{...config,featureScpdaBranch004:true,scpdaCountOperators001:'01001'},db}).verify(req(),'reader'),e=>e.code==='COUNT_OPERATOR_NOT_ADMITTED');
});
