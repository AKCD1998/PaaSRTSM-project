const test=require('node:test'),assert=require('node:assert/strict');
const {createProjectionReader,PROJECTION_REQUEST_BUDGET_MS}=require('../apps/admin-api/src/services/shopee004ProjectionRecovery');
const {createShopee004StockDisplay}=require('../apps/admin-api/src/services/shopee004StockDisplay');
const token='synthetic-projection-test-credential-only';

test('default projection budget is 60 seconds; a six-second successful read completes once',async(t)=>{
 let clock=0,calls=0;const budgets=[];
 t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return new AbortController().signal;});
 const read=createProjectionReader({clock:()=>clock,fetchImpl:async()=>{calls++;clock=6000;return new Response('{"ok":true}');}});
 assert.deepEqual((await read('https://fixture.invalid',['A'],token)).value,{ok:true});
 assert.equal(PROJECTION_REQUEST_BUDGET_MS,60000);assert.deepEqual(budgets,[60000]);assert.equal(calls,1);
});
test('retry only receives the remainder of the same 60-second projection budget',async(t)=>{
 let clock=0,calls=0;const budgets=[];
 t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return new AbortController().signal;});
 const read=createProjectionReader({clock:()=>clock,sleep:async ms=>{clock+=ms;},fetchImpl:async()=>{
  calls++;if(calls===1){clock=10000;return new Response('{}',{status:503});}return new Response('{}');
 }});
 assert.equal((await read('https://fixture.invalid',['A'],token)).attempts,2);assert.deepEqual(budgets,[60000,49875]);
});
test('timeout near the total deadline cannot open another 60-second wait',async()=>{
 let clock=0,calls=0;const read=createProjectionReader({clock:()=>clock,sleep:async ms=>{clock+=ms;},fetchImpl:async()=>{
  calls++;clock=59900;throw new DOMException('synthetic','TimeoutError');
 }});
 await assert.rejects(read('https://fixture.invalid',['A'],token),{code:'PROJECTION_TIMEOUT'});assert.equal(calls,1);
});
function slowProjection({delay=45000,priorAge=0}={}){
 let at=Date.parse('2026-10-27T09:30:00Z');
 const value={schemaVersion:'shopee004-commitments-v1',branchCode:'004',mode:'live',status:'available',
  asOf:new Date(at-priorAge).toISOString(),cutoverAt:'2026-10-23T06:26:56Z',posPostingPolicy:'not-recorded-in-pos',
  emailCoverage:'email-orders-only',pendingOrders:0,reviewOrders:0,
  records:[{productCode:'SYNTH-P1',unit:'box',reservedQuantity:2,shippedUnpostedQuantity:1}]};
 const input={records:[{productCode:'SYNTH-P1',unit:'box',qtyBranch004:10,qtyBranch001:11,qtyTotalAllBranches:21}]};
 const project=createShopee004StockDisplay({config:{featureShopee004StockAvailability:true,shopee004StockProjectionToken:token},
  now:()=>new Date(at),projectionReader:async()=>{at+=delay;return {value,attempts:1};}});
 return ()=>project(input);
}
test('snapshot created for the read remains qualified after 45 seconds of bounded transport',async()=>{
 const result=await slowProjection()();assert.equal(result.records[0].qtyBranch004,7);
 assert.equal(result.records[0].qtyBranch001,11);assert.equal(result.shopeeStock004.status,'available');
 assert.equal(result.shopeeStock004.businessFreshnessQualified,false);
});
test('long transport does not accept data already more than 30 seconds old at request start',async()=>{
 const result=await slowProjection({priorAge:30001})();assert.equal(result.records[0].qtyBranch004,null);
 assert.equal(result.shopeeStock004.status,'projection-not-qualified');assert.equal(result.records[0].qtyBranch001,11);
});
test('injected reader returning after the maximum budget cannot qualify quantities',async()=>{
 const result=await slowProjection({delay:60001})();assert.equal(result.records[0].qtyBranch004,null);
 assert.equal(result.shopeeStock004.status,'projection-not-qualified');
});
