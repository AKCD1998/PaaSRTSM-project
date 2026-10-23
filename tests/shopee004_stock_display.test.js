const test = require('node:test'), assert = require('node:assert/strict');
const express = require('express'), request = require('supertest'), XLSX = require('xlsx');
const {createShopee004StockDisplay,PROJECTION_URL}=require('../apps/admin-api/src/services/shopee004StockDisplay');
const {createBranchStockRouter}=require('../apps/admin-api/src/routes/branch-stock');
const stamp='2026-10-22T12:00:00.000Z';
function fixture() {
  const state={calls:[],payload:{schemaVersion:'shopee004-commitments-v1',branchCode:'004',mode:'live',status:'available',
    asOf:stamp,lastEmailIngestedAt:stamp,cutoverAt:'2026-10-22T11:00:00Z',emailCoverage:'email-orders-only',posPostingPolicy:'not-recorded-in-pos',pendingOrders:0,reviewOrders:0,sourceLabelReviewOrders:1,
    records:[{productCode:'P1',unit:'ซอง',reservedQuantity:3,shippedUnpostedQuantity:2}]}};
  const config={featureShopee004StockAvailability:true,shopee004StockProjectionToken:'synthetic-'.repeat(5)};
  const fetchImpl=async(url,options)=>{state.calls.push({url,options});return new Response(JSON.stringify(state.payload),{status:200});};
  const display={records:[{productCode:'P1',unit:'ซอง',qtyBranch004:4,qtyBranch001:7,qtyTotalAllBranches:11,stock004:{basis:'hourly-calculated'}}]};
  const now=()=>new Date(stamp);
  return {state,config,fetchImpl,display,now,project:createShopee004StockDisplay({config,fetchImpl,now})};
}
test('subtracts reserved plus shipped-unposted exactly once from the POS basis; negative availability is preserved',async()=>{
  const f=fixture(),original=structuredClone(f.display);const r=await f.project(f.display);
  assert.equal(r.records[0].qtyBranch004,-1);assert.equal(r.records[0].qtyTotalAllBranches,6);assert.equal(r.records[0].qtyBranch001,7);
  assert.equal(r.records[0].posQtyBranch004,4);assert.equal(r.records[0].stock004.basis,'hourly-and-shopee');
  assert.deepEqual(f.display,original);assert.equal(f.state.calls[0].url,PROJECTION_URL);
  assert.equal(r.shopeeStock004.sourceLabelReviewOrders,1);
  assert.equal(f.state.calls[0].options.redirect,'error');assert.equal(r.shopeeStock004.businessFreshnessQualified,false);
});
test('flag off does not make a bridge request and keeps existing Hourly response quantities',async()=>{
  const f=fixture();f.config.featureShopee004StockAvailability=false;
  const r=await f.project(f.display);assert.deepEqual(r.records,f.display.records);assert.equal(f.state.calls.length,0);
});
test('complete 6,835-product display preserves coverage and other branches without treating unmapped catalogue products as extra demand',async()=>{
  const f=fixture();
  f.display.records=Array.from({length:6835},(_,i)=>({productCode:'SYNTHETIC-'+i,unit:'ซอง',qtyBranch004:i%7,
    qtyBranch001:9,qtyTotalAllBranches:9+i%7,stock004:{basis:'hourly-calculated'}}));
  f.state.payload.records=f.display.records.map((r,i)=>({productCode:r.productCode,unit:i<208?'ซอง':null,
    reservedQuantity:i<208?1:0,shippedUnpostedQuantity:0}));
  const result=await f.project(f.display);
  assert.equal(result.records.length,6835);assert.equal(result.shopeeStock004.status,'available');
  assert.equal(result.records[0].qtyBranch004,-1);assert.equal(result.records[208].qtyBranch004,208%7);
  assert.ok(result.records.every(r=>r.qtyBranch001===9));
});
test('unavailable bridge never returns unadjusted POS as available stock or zero; no stale cache',async()=>{
  const f=fixture();await f.project(f.display);f.state.payload.status='review-or-processing-required';
  const r=await f.project(f.display);assert.equal(r.records[0].qtyBranch004,null);assert.equal(r.records[0].qtyTotalAllBranches,null);
  assert.equal(r.records[0].qtyBranch001,7);assert.equal(r.records[0].stock004.basis,'shopee-availability-unknown');
});
for(const [name,fault] of [
  ['wrong branch',v=>v.branchCode='001'],['paused',v=>v.mode='paused'],['pending work',v=>v.pendingOrders=1],
  ['review queue',v=>v.reviewOrders=1],['duplicate SKU',v=>v.records.push(v.records[0])],['missing SKU',v=>v.records=[]],
  ['different SKU',v=>v.records[0].productCode='P2'],['negative reservation',v=>v.records[0].reservedQuantity=-1],
  ['fractional reservation',v=>v.records[0].reservedQuantity=.5],['overflow',v=>v.records[0].reservedQuantity=Number.MAX_SAFE_INTEGER],
  ['unit mismatch',v=>v.records[0].unit='กล่อง'],['future reply',v=>v.asOf='2026-10-23T00:00:00Z'],
  ['stale reply',v=>v.asOf='2026-10-21T00:00:00Z'],['invalid timestamp',v=>v.asOf=null],
  ['changed POS workflow',v=>v.posPostingPolicy='posted-in-pos'],
  ['missing cutover',v=>v.cutoverAt=null],['wrong source coverage',v=>v.emailCoverage='guessed'],
]) test(name+' is blocked without affecting other branches',async()=>{
  const f=fixture();fault(f.state.payload);const r=await f.project(f.display);
  assert.equal(r.records[0].qtyBranch004,null);assert.equal(r.records[0].qtyBranch001,7);
});
test('transport, invalid JSON, missing secret and oversize responses are safe failures',async()=>{
  for(const fetchImpl of [async()=>{throw new Error('private value');},async()=>new Response('private invalid JSON'),
    async()=>new Response('{}',{headers:{'Content-Length':'9999999'}})]) {
    const f=fixture();const r=await createShopee004StockDisplay({...f,fetchImpl})(f.display);
    assert.equal(r.records[0].qtyBranch004,null);assert.ok(!JSON.stringify(r).includes('private'));
  }
  const f=fixture();f.config.shopee004StockProjectionToken='';assert.equal((await f.project(f.display)).records[0].qtyBranch004,null);
});
test('review, processing and timeout diagnostics are distinct while every unqualified quantity stays unknown',async()=>{
  for(const [key,count,status] of [['reviewOrders',2,'shopee-orders-need-review'],['pendingOrders',1,'shopee-orders-processing']]){
    const f=fixture();f.state.payload[key]=count;f.state.payload.status='review-or-processing-required';
    f.state.payload.privateError='must-not-escape';const result=await f.project(f.display);
    assert.equal(result.shopeeStock004.status,status);assert.equal(result.shopeeStock004[key],count);
    assert.equal(result.shopeeStock004.asOf,stamp);assert.equal(result.records[0].posQtyBranch004,4);
    assert.equal(result.records[0].qtyBranch004,null);assert.equal(result.records[0].qtyBranch001,7);
    assert.ok(!JSON.stringify(result).includes('must-not-escape'));
  }
  const f=fixture();const r=await createShopee004StockDisplay({...f,fetchImpl:async()=>{throw Object.assign(Error('private'),{name:'TimeoutError'});}})(f.display);
  assert.equal(r.shopeeStock004.status,'projection-timeout');assert.equal(r.records[0].qtyBranch004,null);
});
test('untrusted diagnostics cannot expose other branches, invalid counts or arbitrary upstream text',async()=>{
  const f=fixture();f.state.payload.branchCode='001';f.state.payload.reviewOrders=3;
  let result=await f.project(f.display);assert.equal(result.shopeeStock004.reviewOrders,null);
  f.state.payload.branchCode='004';f.state.payload.reviewOrders=-1;
  result=await f.project(f.display);assert.equal(result.shopeeStock004.reviewOrders,null);assert.equal(result.records[0].qtyBranch004,null);
});
test('verified per-product contract keeps unaffected products available while retaining reviewed POS reference',async()=>{
  const f=fixture();f.display.records.push({...f.display.records[0],productCode:'P2'});
  Object.assign(f.state.payload,{availabilityContract:'per-product-review-v1',scopeValidated:true,status:'partial',reviewOrders:1,pageReviewProducts:1});
  f.state.payload.records[0].availabilityStatus='review_required';
  f.state.payload.records.push({...f.state.payload.records[0],productCode:'P2',availabilityStatus:'available'});
  const r=await f.project(f.display);
  assert.equal(r.shopeeStock004.status,'partial');assert.equal(r.shopeeStock004.pageUnknownProducts,1);
  assert.equal(r.records[0].qtyBranch004,null);assert.equal(r.records[0].posQtyBranch004,4);
  assert.equal(r.records[0].stock004.reason,'shopee-product-needs-review');assert.equal(r.records[1].qtyBranch004,-1);
  assert.ok(r.records.every(row=>row.qtyBranch001===7));
});
for(const [name,change] of [
  ['unvalidated scope',v=>v.scopeValidated=false],['wrong count',v=>v.pageReviewProducts=0],
  ['unknown version',v=>v.availabilityContract='guessed'],['missing qualification',v=>delete v.records[0].availabilityStatus],
  ['incorrect available status',v=>v.status='available'],['negative queue',v=>v.pendingOrders=-1],
]) test('per-product '+name+' cannot qualify any stock',async()=>{
  const f=fixture();Object.assign(f.state.payload,{availabilityContract:'per-product-review-v1',scopeValidated:true,status:'partial',reviewOrders:1,pageReviewProducts:1});
  f.state.payload.records[0].availabilityStatus='review_required';change(f.state.payload);
  assert.equal((await f.project(f.display)).records[0].qtyBranch004,null);
});
function appFor(f) {
  const db={query:async sql=>{
    assert.match(sql,/^\s*SELECT/);
    if(sql.includes('COUNT(*)'))return {rows:[{total:1}]};
    return {rows:[{product_code:'P1',unit:'ซอง',qty_branch_004:4,qty_branch_001:7,qty_total_all_branches:11}]};
  }};
  const app=express();app.use(createBranchStockRouter({db,config:f.config,now:f.now,shopeeStockFetch:f.fetchImpl,
    requireAuthMiddleware:(req,res,next)=>next(),requireRoleMiddleware:()=> (req,res,next)=>next(),requireCsrfMiddleware:(req,res,next)=>next()}));
  return app;
}
test('legacy and POS-only requests make zero bridge calls; new route chains read-only views',async()=>{
  const f=fixture(),app=appFor(f);
  for(const query of ['','?stockView=hourly004']) {const r=await request(app).get('/branch-stock'+query).expect(200);assert.equal(r.body.records[0].qtyBranch004,4);}
  assert.equal(f.state.calls.length,0);
  const r=await request(app).get('/branch-stock?stockView=hourly004-shopee').expect(200);
  assert.equal(r.headers['cache-control'],'no-store');
  assert.equal(r.body.records[0].qtyBranch004,-1);assert.equal(f.state.calls.length,1);
});
test('Excel export uses the same availability and preserves unknown as text instead of zero; other branches unchanged',async()=>{
  const f=fixture();f.state.payload.status='review-or-processing-required';const app=appFor(f);
  const r=await request(app).get('/branch-stock/export.xlsx?branchCode=004&stockView=hourly004-shopee')
    .buffer(true).parse((res,done)=>{const c=[];res.on('data',d=>c.push(d));res.on('end',()=>done(null,Buffer.concat(c)));}).expect(200);
  const book=XLSX.read(r.body,{type:'buffer'});const rows=XLSX.utils.sheet_to_json(book.Sheets['Stock 004'],{header:1});
  assert.equal(rows[2][5],'ไม่ทราบ');assert.ok(book.SheetNames.includes('ที่มาสต็อก004'));
  f.state.calls=[];await request(app).get('/branch-stock/export.xlsx?branchCode=001&stockView=hourly004-shopee').expect(200);assert.equal(f.state.calls.length,0);
});
