'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {createShopee004StockExceptionsRouter,READ_BASE,WRITE_BASE}=require('../apps/admin-api/src/routes/shopee004-stock-exceptions');
const id='11111111-1111-4111-8111-111111111111',rule='22222222-2222-4222-8222-222222222222',op='33333333-3333-4333-8333-333333333333';
const item=()=>({exceptionId:id,revision:'12:3:2026-10-23T10:00:00Z',listingId:'SYNTH_LIST',variationId:'SYNTH_VAR',productName:'Synthetic box',variantName:'one box',reasonCode:'sale_unit_pos_mismatch',issueClass:'unit',observedUnit:'box',
 proposedMatches:[{productCode:'SYNTH-P1',productName:'Synthetic POS box',unit:'box',quantityPerSale:1,evidenceRefs:['proof-1']}],evidence:[{kind:'owner_unit',reference:'proof-1',label:'Synthetic unit proof',verifiedAt:'2026-10-23T10:00:00Z'}],
 affectedOrders:1,canApproveMapping:true,requiresLifecycleReview:false,ruleVersion:null,privateCustomer:'MUST_NOT_ESCAPE',orderNumber:'PRIVATE_REFERENCE'});
function fixture({enabled=true,token=true,fetchImpl,role='admin',auth=true}={}){
 const calls=[],config={featureShopee004StockExceptionAdmin:enabled,shopee004StockProjectionToken:'synthetic-read-credential-not-real-123',shopee004StockReviewToken:token?'synthetic-write-credential-not-real-123':''};
 const app=express();app.use(express.json());
 app.use(createShopee004StockExceptionsRouter({config,
  requireAuthMiddleware:(req,res,next)=>{if(!auth)return res.sendStatus(401);req.auth={userId:'synthetic-admin',role};next();},
  requireRoleMiddleware:expected=>(req,res,next)=>role===expected?next():res.sendStatus(403),requireCsrfMiddleware:(req,res,next)=>req.get('x-csrf-token')==='synthetic-csrf'?next():res.sendStatus(403),
  fetchImpl:async(...args)=>{calls.push(args);return fetchImpl?fetchImpl(...args):new Response(JSON.stringify({schemaVersion:'shopee004-exceptions-v1',branchCode:'004',asOf:'2026-10-23T10:00:00Z',status:'available',records:[item()],pagination:{hasMore:false,nextCursor:null}}));}}));
 return {app,calls,config};
}
const base='/admin/shopee004';
const body=()=>({operationId:op,expectedRevision:'12:3:2026-10-23T10:00:00Z',listingId:'SYNTH_LIST',variationId:'SYNTH_VAR',components:[{productCode:'SYNTH-P1',quantityPerSale:1,unit:'box'}],evidenceRefs:['proof-1'],acknowledgeUnitEvidence:true});
test('admin queue is read only, validates pagination and removes private provider/customer/order fields',async()=>{
 const f=fixture(),r=await request(f.app).get(base+'/stock-exceptions');assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');
 assert.equal(r.body.records[0].revision,item().revision);assert.equal(f.calls[0][0],READ_BASE+'/exceptions');assert.ok(!JSON.stringify(r.body).includes('PRIVATE_REFERENCE'));assert.ok(!JSON.stringify(r.body).includes('MUST_NOT_ESCAPE'));
});
test('anonymous, non-admin and disabled flag cannot reach upstream',async()=>{
 for(const options of [{auth:false},{role:'user'},{enabled:false}]){const f=fixture(options),r=await request(f.app).get(base+'/stock-exceptions');assert.ok([401,403,503].includes(r.status));assert.equal(f.calls.length,0);}
});
test('one malformed exception is isolated and counted while valid records remain readable',async()=>{
 const f=fixture({fetchImpl:async()=>new Response(JSON.stringify({schemaVersion:'shopee004-exceptions-v1',branchCode:'004',asOf:'2026-10-23T10:00:00Z',status:'available',records:[item(),{...item(),exceptionId:'private-invalid-reference',productName:{unsafe:'data'}}],pagination:{hasMore:false,nextCursor:null}}))});
 const r=await request(f.app).get(base+'/stock-exceptions');assert.equal(r.status,200);assert.equal(r.body.records.length,1);assert.equal(r.body.unreadableRecords,1);assert.ok(!JSON.stringify(r.body).includes('private-invalid-reference'));
});
test('unidentified product still appears with null identity and disabled mapping instead of breaking its page',async()=>{
 const f=fixture({fetchImpl:async()=>new Response(JSON.stringify({schemaVersion:'shopee004-exceptions-v1',branchCode:'004',asOf:'2026-10-23T10:00:00Z',status:'available',records:[{...item(),listingId:'',variationId:'',canApproveMapping:false,evidence:[],proposedMatches:[]}],pagination:{hasMore:false,nextCursor:null}}))});
 const r=await request(f.app).get(base+'/stock-exceptions');assert.equal(r.status,200);assert.equal(r.body.records[0].listingId,null);assert.equal(r.body.records[0].canApproveMapping,false);
});
test('invalid cursor and provider contract do not become success',async()=>{
 const f=fixture();assert.equal((await request(f.app).get(base+'/stock-exceptions?cursor=private-value')).status,400);assert.equal(f.calls.length,0);
 const broken=fixture({fetchImpl:async()=>new Response(JSON.stringify({private:'must-not-escape'}))});const r=await request(broken.app).get(base+'/stock-exceptions');assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('must-not-escape'));
});
test('mapping approval requires CSRF, trusted bridge and explicit unit proof',async()=>{
 const f=fixture();assert.equal((await request(f.app).post(base+'/stock-exceptions/'+id+'/mapping').send(body())).status,403);assert.equal(f.calls.length,0);
 const b=body();b.acknowledgeUnitEvidence=false;assert.equal((await request(f.app).post(base+'/stock-exceptions/'+id+'/mapping').set('x-csrf-token','synthetic-csrf').send(b)).status,400);
 const off=fixture({token:false}),r=await request(off.app).post(base+'/stock-exceptions/'+id+'/mapping').set('x-csrf-token','synthetic-csrf').send(body());assert.equal(r.status,503);assert.equal(r.body.error.code,'BRIDGE_UNAVAILABLE');assert.equal(r.body.definitiveNoWrite,true);assert.equal(off.calls.length,0);
});
test('mapping call forwards stable idempotency/revision but discards lifecycle and actor spoofing',async()=>{
 const f=fixture({fetchImpl:async()=>new Response(JSON.stringify({recorded:true,duplicate:false,ruleId:rule,ruleVersion:1,requeuedOrders:1,private:'must-not-escape'}))});
 const r=await request(f.app).post(base+'/stock-exceptions/'+id+'/mapping').set('x-csrf-token','synthetic-csrf').send({...body(),actor:'forged',kind:'cancel-before-dispatch',physicalEvidenceVerified:true});
 assert.equal(r.status,200);const sent=JSON.parse(f.calls[0][1].body);assert.equal(f.calls[0][0],WRITE_BASE+'/mapping');assert.equal(sent.actor,'synthetic-admin');assert.equal(sent.operationId,op);assert.equal(sent.expectedRevision,item().revision);
 assert.equal(sent.kind,undefined);assert.equal(sent.physicalEvidenceVerified,undefined);assert.ok(!JSON.stringify(r.body).includes('must-not-escape'));
});
test('uncertain mutation makes exactly one request and reports unknown outcome without inventing success',async()=>{
 const f=fixture({fetchImpl:async()=>{throw new TypeError('PRIVATE_CONNECTION');}}),r=await request(f.app).post(base+'/stock-exceptions/'+id+'/mapping').set('x-csrf-token','synthetic-csrf').send(body());
 assert.equal(r.status,504);assert.equal(r.body.error.code,'MUTATION_OUTCOME_UNKNOWN');assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(r.body).includes('PRIVATE_CONNECTION'));
});
test('upstream revision conflict remains conflict and never mutates a second time',async()=>{
 const f=fixture({fetchImpl:async()=>new Response(JSON.stringify({error:{code:'EXCEPTION_REVISION_CONFLICT',private:'private'}}),{status:409})});
 const r=await request(f.app).post(base+'/stock-exceptions/'+id+'/mapping').set('x-csrf-token','synthetic-csrf').send(body());assert.equal(r.status,409);assert.equal(f.calls.length,1);assert.equal(r.body.error.code,'EXCEPTION_REVISION_CONFLICT');
});
test('revoke is separate versioned mapping operation; no cancellation/return approval is forwarded',async()=>{
 const f=fixture({fetchImpl:async()=>new Response(JSON.stringify({recorded:true,duplicate:false,ruleId:rule,ruleVersion:2,requeuedOrders:2}))});
 const r=await request(f.app).post(base+'/stock-rules/'+rule+'/revoke').set('x-csrf-token','synthetic-csrf').send({operationId:op,expectedVersion:1,reason:'unit_evidence_changed',kind:'returned-sellable'});
 assert.equal(r.status,200);assert.equal(f.calls[0][0],WRITE_BASE+'/revoke');assert.equal(JSON.parse(f.calls[0][1].body).kind,undefined);
});
test('reconciliation is a readonly boundary report, not an endpoint to rebaseline or post in POS',async()=>{
 const f=fixture({fetchImpl:async()=>new Response(JSON.stringify({openingBoundaryPreserved:true,cutoverAt:'2026-10-23T06:26:56Z',openingBasisQuality:'owner-accepted-estimate',physicalStockVerified:false,reservedOrders:3,shippedUnpostedOrders:2,reviewOrders:1,requiresCountReconciliation:true,private:'must-not-escape'}))});
 const r=await request(f.app).get(base+'/stock-reconciliation');assert.equal(r.status,200);assert.equal(r.body.physicalStockVerified,false);assert.equal(r.body.requiresCountReconciliation,true);assert.equal(f.calls[0][0],READ_BASE+'/reconciliation');assert.ok(!JSON.stringify(r.body).includes('must-not-escape'));
});
