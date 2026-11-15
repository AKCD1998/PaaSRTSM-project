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
 assert.deepEqual(queryOptions({}),{category:'all',search:'',limit:50,offset:0});
 for(const q of [{category:'other'},{branchCode:'004'},{limit:101},{limit:0},{offset:-1}])assert.throws(()=>queryOptions(q));
});
test('count admission defaults to no operators and rejects non-admitted existing reader/counter tokens',async()=>{
 const records=['01001','02001','03001'].map(operatorCode=>({operatorCode,hash:bcrypt.hashSync('1111',12),version:crypto.randomUUID(),rotationDueAt:'2027-05-15T00:00:00Z'})),config={featureScpdaRead001:true,featureScpdaCounts001:true,authJwtSecret:'synthetic-count-admission-key',scpdaOperatorCredentialsJson:JSON.stringify(records)},settings=parseConfig(config),db={query:async()=>({rows:[]})};
 const token=(code,kind)=>{const parent=crypto.randomUUID(),key=kind==='reader'?settings.sessionKey:crypto.createHmac('sha256',config.authJwtSecret).update('scpda:count-session-v1').digest('base64url');return jwt.sign({sub:code,kind:kind==='reader'?'scpda-reader':'scpda-counter',role:kind==='reader'?'reader':'counter',branch_code:'001',cv:settings.operators.get(code).fingerprint,jti:crypto.randomUUID(),parent_jti:parent,device_ref:'a'.repeat(64)},key,{algorithm:'HS256',issuer:'sc-stockday',audience:kind==='reader'?'scpda-read-001':'scpda-count-001',expiresIn:'1h'});};
 const closed=createCountAccess({config,db}),onlyOne=createCountAccess({config:{...config,scpdaCountOperators001:'01001'},db});
 await assert.rejects(closed.verify({headers:{authorization:'Bearer '+token('01001','reader')}},'reader'),e=>e.code==='COUNT_OPERATOR_NOT_ADMITTED');
 for(const code of ['02001','03001'])for(const kind of ['reader','counter'])await assert.rejects(onlyOne.verify({headers:{authorization:'Bearer '+token(code,kind)}},kind),e=>e.code==='COUNT_OPERATOR_NOT_ADMITTED');
 assert.equal((await onlyOne.verify({headers:{authorization:'Bearer '+token('01001','reader')}},'reader')).operatorCode,'01001');
});
