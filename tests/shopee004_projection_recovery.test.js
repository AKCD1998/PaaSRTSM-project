'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createProjectionReader,createConfirmedReferenceCache}=require('../apps/admin-api/src/services/shopee004ProjectionRecovery');
const {createShopee004StockDisplay}=require('../apps/admin-api/src/services/shopee004StockDisplay');
const token='synthetic-projection-credential-not-real';
function fixture(){
 let at=Date.parse('2026-10-23T10:00:00Z'),down=false,calls=0;
 const config={featureShopee004StockAvailability:true,shopee004StockProjectionToken:token};
 const payload={schemaVersion:'shopee004-commitments-v1',branchCode:'004',mode:'live',status:'available',asOf:new Date(at).toISOString(),cutoverAt:'2026-10-23T06:26:56Z',
   emailCoverage:'email-orders-only',posPostingPolicy:'not-recorded-in-pos',pendingOrders:0,reviewOrders:0,records:[{productCode:'SYNTH-P1',unit:'กล่อง',reservedQuantity:2,shippedUnpostedQuantity:1}]};
 const input={records:[{productCode:'SYNTH-P1',unit:'กล่อง',qtyBranch004:3,qtyBranch001:11,qtyTotalAllBranches:14,stock004:{basis:'hourly-calculated',capturedAt:new Date(at).toISOString()}}]};
 const now=()=>new Date(at),fetchImpl=async()=>{calls++;if(down)throw new TypeError('PRIVATE_PROVIDER_DETAIL');return new Response(JSON.stringify(payload));};
 const project=createShopee004StockDisplay({config,now,fetchImpl,projectionReader:createProjectionReader({fetchImpl,sleep:async()=>{}})});
 return {config,payload,input,project,down:()=>{down=true;},advance:ms=>{at+=ms;},calls:()=>calls};
}
test('transport failure retains zero-valued successful reference with time but never returns it as current sellable quantity',async()=>{
 const f=fixture(),ok=await f.project(f.input);assert.equal(ok.records[0].qtyBranch004,0);assert.equal(ok.records[0].stock004.viewStatus,'confirmed');
 f.down();f.advance(60000);const r=await f.project(f.input),row=r.records[0];
 assert.equal(row.qtyBranch004,null);assert.equal(row.qtyTotalAllBranches,null);assert.equal(row.posQtyBranch004,3);assert.equal(row.qtyBranch001,11);
 assert.equal(row.stock004.viewStatus,'reference');assert.equal(row.stock004.lastConfirmed.quantity,0);assert.equal(row.stock004.lastConfirmed.stale,true);
 assert.equal(row.stock004.lastConfirmed.reservedQuantity,2);assert.equal(r.shopeeStock004.pageReferenceProducts,1);assert.equal(r.shopeeStock004.issueClass,'temporary');
 assert.ok(!JSON.stringify(r).includes('PRIVATE_PROVIDER_DETAIL'));
});
test('unit semantic conflict removes the previous reference for that product and is never retried',async()=>{
 const f=fixture();await f.project(f.input);f.payload.records[0].unit='ซอง';const r=await f.project(f.input);
 assert.equal(f.calls(),2);assert.equal(r.records[0].qtyBranch004,null);assert.equal(r.records[0].stock004.viewStatus,'unverified');assert.equal(r.records[0].stock004.lastConfirmed,undefined);
 f.down();assert.equal((await f.project(f.input)).records[0].stock004.lastConfirmed,undefined);
});
test('new unallocated demand stays explicitly unverified without creating a new confirmed reference',async()=>{
 const f=fixture();Object.assign(f.payload,{availabilityContract:'per-product-review-v2',scopeValidated:true,status:'partial',unallocatedOrders:1,reviewOrders:1,pageReviewProducts:0});
 f.payload.records[0].availabilityStatus='known-commitments-only';const r=await f.project(f.input);
 assert.equal(r.records[0].stock004.viewStatus,'unverified');assert.equal(r.records[0].qtyBranch004,0);
 f.down();assert.equal((await f.project(f.input)).records[0].stock004.lastConfirmed,undefined);
});
test('cache is empty after process recreation; old data is never invented',async()=>{
 const f=fixture();f.down();const r=await f.project(f.input);assert.equal(r.records[0].stock004.viewStatus,'unverified');assert.equal(r.records[0].stock004.lastConfirmed,undefined);
});
test('token rotation and unit changes cannot leak a reference from the old contract',async()=>{
 const f=fixture();await f.project(f.input);f.down();f.config.shopee004StockProjectionToken+='-rotated';assert.equal((await f.project(f.input)).records[0].stock004.lastConfirmed,undefined);
 const g=fixture();await g.project(g.input);g.down();g.input.records[0].unit='ซอง';assert.equal((await g.project(g.input)).records[0].stock004.lastConfirmed,undefined);
});
test('cutover change clears old-scope references, never alters opening or performs a write',()=>{
 const now=()=>new Date('2026-10-23T10:00:00Z'),cache=createConfirmedReferenceCache({now});
 const row={productCode:'P',unit:'กล่อง',qtyBranch004:4,stock004:{basis:'hourly-and-shopee',shopee:{reservedQuantity:1,shippedUnpostedQuantity:0}}};
 cache.observeCutover('old');cache.remember(row,{asOf:now().toISOString(),cutoverAt:'old'});assert.equal(cache.get(row,'temporary').quantity,4);
 cache.observeCutover('new');assert.equal(cache.get(row,'temporary'),null);
});
test('cache enforces product bound and expiry is reference retention, not a freshness claim',()=>{
 let clock=0;const cache=createConfirmedReferenceCache({now:()=>new Date(clock),maxProducts:1,retentionMs:100});
 const row=p=>({productCode:p,unit:'u',qtyBranch004:1,stock004:{basis:'hourly-and-shopee',shopee:{reservedQuantity:0,shippedUnpostedQuantity:0}}});
 const meta={asOf:new Date(0).toISOString(),cutoverAt:new Date(0).toISOString()};cache.remember(row('A'),meta);cache.remember(row('B'),meta);assert.equal(cache.get(row('A'),'x'),null);
 clock=101;assert.equal(cache.get(row('B'),'x'),null);
});
test('same-scope concurrent readers use one request and return independently readable parsed data',async()=>{
 let calls=0,resolve;const gate=new Promise(r=>resolve=r);
 const read=createProjectionReader({fetchImpl:async()=>{calls++;await gate;return new Response('{"records":[]}');}});
 const a=read('https://fixture.invalid',['B','A'],token),b=read('https://fixture.invalid',['A','B'],token);resolve();const [x,y]=await Promise.all([a,b]);
 assert.equal(calls,1);assert.deepEqual(x.value,y.value);
});
test('fast transient failure gets one bounded retry; malformed data and authorization do not',async()=>{
 let calls=0;const read=createProjectionReader({fetchImpl:async()=>{calls++;return calls===1?new Response('{}',{status:503}):new Response('{"ok":true}');},sleep:async()=>{}});
 assert.equal((await read('https://fixture.invalid',['A'],token)).attempts,2);
 for(const response of [()=>new Response('private-broken-json'),()=>new Response('{}',{status:403})]){
  let n=0;const once=createProjectionReader({fetchImpl:async()=>{n++;return response();},sleep:async()=>{}});
  await assert.rejects(once('https://fixture.invalid',['A'],token));assert.equal(n,1);
 }
});
test('global retry allowance and active-scope bound prevent outage amplification',async()=>{
 let calls=0;const read=createProjectionReader({fetchImpl:async()=>{calls++;throw new TypeError('private');},sleep:async()=>{},retriesPerWindow:1});
 await assert.rejects(read('https://fixture.invalid',['A'],token));await assert.rejects(read('https://fixture.invalid',['B'],token));assert.equal(calls,3);
 let release;const gate=new Promise(r=>release=r),bounded=createProjectionReader({maxConcurrent:1,fetchImpl:async()=>{await gate;return new Response('{}');}});
 const pending=bounded('https://fixture.invalid',['A'],token);await assert.rejects(bounded('https://fixture.invalid',['B'],token),{code:'PROJECTION_READER_BUSY'});release();await pending;
});
test('one overall deadline prevents retry from multiplying the reader wait',async()=>{
 let clock=0,calls=0;const read=createProjectionReader({clock:()=>clock,budgetMs:5000,sleep:async ms=>{clock+=ms;},fetchImpl:async()=>{calls++;clock=4900;throw Object.assign(Error(),{name:'TimeoutError'});}});
 await assert.rejects(read('https://fixture.invalid',['A'],token),{code:'PROJECTION_TIMEOUT'});assert.equal(calls,1);
});
