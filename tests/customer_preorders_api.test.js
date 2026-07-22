"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const request=require("supertest");const {createApp}=require("../apps/admin-api/src/server");
const {signSessionToken}=require("../apps/admin-api/src/auth/session");
const {createCustomerPreorderService,normalizeSuggestionQuery,maskPhone,maskName}=require("../apps/admin-api/src/services/customerPreorders");
function config(enabled=false){return {nodeEnv:"test",featureCustomerPreorders:enabled,featureVideoStudio:false,featureStockRequests:false,featureStockRecommendationCron:false,trustProxy:false,corsAllowedOrigins:new Set(),corsAllowAllOrigins:false,cookieName:"session",authJwtSecret:"test-secret",sessionTtlHours:1,cookieSameSite:"lax",cookieSecure:false,loginRateLimitWindowMs:1000,loginRateLimitMax:10,adminUsers:new Set(),staffUsers:new Set(),branchUsers:new Set(),branchUserBranches:new Map(),branchUserPasswordHashes:new Map(),r2BucketName:"bucket",r2SignedUrlTtlSeconds:300};}
const db={query:async()=>({rows:[]}),connect:async()=>({query:async()=>({rows:[]}),release(){}}),end:async()=>{}};
test("feature defaults safely unavailable",async()=>{const {app}=createApp({config:config(false),db,videoStorageProvider:{providerName:"local"},videoJobRunner:{}});const r=await request(app).get("/api/customer-preorders");assert.equal(r.status,404);});
test("enabled route requires authentication",async()=>{const {app}=createApp({config:config(true),db,preorderStorageProvider:{},videoStorageProvider:{providerName:"local"},videoJobRunner:{}});const r=await request(app).get("/api/customer-preorders");assert.equal(r.status,401);});

function authCookie(identity,cfg=config(true)){const token=signSessionToken({sub:identity.userId,role:identity.role,branch_code:identity.branchCode||null,csrf:"csrf-test"},cfg);return `session=${token}`;}

test("suggestion query strips @, bounds input, and list PII is masked",()=>{assert.equal(normalizeSuggestionQuery("  @@63001 "),"63001");assert.equal(maskPhone("081-234-5678"),"081••••5678");assert.equal(maskName("สมชาย"),"ส••••");});

test("staff list is always scoped to effective branch and ignores supplied branch",async()=>{
  const calls=[];const fakeDb={query:async(sql,params)=>{calls.push({sql,params});return /count\(\*\)/i.test(sql)?{rows:[{total:0}]}:{rows:[]};}};
  const service=createCustomerPreorderService({db:fakeDb,config:config(true),storageProvider:{}});
  await service.list({role:"staff",userId:"staff003",effectiveBranchCode:"003"},{branch:"001",search:"081"});
  assert.equal(calls[0].params[0],"003");assert.doesNotMatch(JSON.stringify(calls[0].params),/001/);
});

test("admin list may filter branch and product suggestions use deterministic bounded ranking",async()=>{
  const calls=[];const fakeDb={query:async(sql,params)=>{calls.push({sql,params});if(/count\(\*\)/i.test(sql))return {rows:[{total:0}]};return {rows:[]};}};
  const service=createCustomerPreorderService({db:fakeDb,config:config(true),storageProvider:{}});
  await service.list({role:"admin",userId:"admin"},{branch:"001"});await service.productSuggestions({role:"admin",userId:"admin"},{q:"@IC-1",limit:99});
  assert.equal(calls[0].params[0],"001");assert.deepEqual(calls.at(-1).params,["IC-1",10]);assert.match(calls.at(-1).sql,/CASE[\s\S]*lower\(s\.company_code\)=lower\(\$1\)[\s\S]*LIMIT \$2/);
});

test("admin stuck queue uses server time while staff cannot request the global stuck filter",async()=>{const calls=[];const fakeDb={query:async(sql,params)=>{calls.push({sql,params});return /count\(\*\)/i.test(sql)?{rows:[{total:0}]}:{rows:[]};}};const service=createCustomerPreorderService({db:fakeDb,config:config(true),storageProvider:{}});await service.list({role:"admin",userId:"admin"},{actionable:"stuck"});assert.match(calls[0].sql,/last_activity_at<now\(\)-interval '48 hours'/);calls.length=0;await service.list({role:"staff",userId:"staff003",effectiveBranchCode:"003"},{actionable:"stuck"});assert.doesNotMatch(calls[0].sql,/48 hours/);});

test("detail and attachment queries include staff branch predicate",async()=>{
  const calls=[];const fakeDb={query:async(sql,params)=>{calls.push({sql,params});return {rows:[]};}};
  const service=createCustomerPreorderService({db:fakeDb,config:config(true),storageProvider:{createSignedGetUrl:async()=>"x"}});
  await assert.rejects(()=>service.get({role:"staff",userId:"staff003",effectiveBranchCode:"003"},"PRE-OTHER"),error=>error.statusCode===404);
  await assert.rejects(()=>service.signedUrl({role:"staff",userId:"staff003",effectiveBranchCode:"003"},"att-other"),error=>error.statusCode===404);
  assert.deepEqual(calls[0].params,["PRE-OTHER","003"]);assert.match(calls[0].sql,/c\.branch_code=\$2/);assert.deepEqual(calls[1].params,["att-other","003"]);
});

test("read endpoint requires CSRF before touching database",async()=>{const cfg=config(true);const {app}=createApp({config:cfg,db,preorderStorageProvider:{},videoStorageProvider:{providerName:"local"},videoJobRunner:{}});const r=await request(app).post("/api/customer-preorders/cases/PRE-X/read").set("Cookie",authCookie({userId:"staff003",role:"staff",branchCode:"003"},cfg));assert.equal(r.status,403);});

test("first admin read is transactional, append-only, and advances the read cursor",async()=>{
  const calls=[];const client={query:async(sql,params)=>{calls.push({sql,params});if(/SELECT c\.\*/.test(sql))return {rows:[{case_id:7,public_id:"PRE-X",first_admin_viewed_at:null}]};if(/GREATEST\(COALESCE/.test(sql))return {rows:[{seq:3}]};if(/UPDATE customer_relations\.preorder_cases/.test(sql))return {rows:[{first_admin_viewed_at:"2026-07-22T00:00:00Z"}]};return {rows:[]};},release(){calls.push({sql:"RELEASE"});}};
  const service=createCustomerPreorderService({db:{connect:async()=>client},config:config(true),storageProvider:{}});
  const result=await service.markRead({role:"admin",userId:"admin"},"PRE-X");
  assert.equal(result.lastReadActivitySeq,4);assert.ok(calls.some(x=>/FIRST_ADMIN_VIEWED/.test(x.sql)));assert.ok(calls.some(x=>/preorder_read_cursors/.test(x.sql)));assert.ok(calls.some(x=>x.sql==="COMMIT"));
});

test("case list excludes unfinished attachment reservations",async()=>{
  const calls=[];const fakeDb={query:async(sql,params)=>{calls.push({sql,params});return /count\(\*\)/i.test(sql)?{rows:[{total:0}]}:{rows:[]};}};
  const service=createCustomerPreorderService({db:fakeDb,config:config(true),storageProvider:{}});await service.list({role:"admin",userId:"admin"},{});
  assert.match(calls[0].sql,/pending_attachment\.upload_state<>'ready'/);
});

test("duplicate create idempotency returns the same case and inserts once",async()=>{
  let stored=null,caseInsertCount=0;
  const empty={rows:[]};
  async function query(sql,params=[]){
    if(/SELECT case_id,public_id,branch_code,status.+idempotency_key/.test(sql))return {rows:stored?[{case_id:stored.case_id,public_id:stored.public_id,branch_code:stored.branch_code,status:stored.status}]:[]};
    if(/INSERT INTO customer_relations\.preorder_cases/.test(sql)){caseInsertCount+=1;stored={case_id:9,public_id:"PRE-20260722-003-0001",branch_code:"003",status:"SUBMITTED",customer_name:"สมชาย",customer_phone:"0812345678",customer_phone_normalized:"0812345678"};return {rows:[stored]};}
    if(/SELECT c\.\*/.test(sql))return {rows:stored?[stored]:[]};
    if(/UPDATE customer_relations\.preorder_attachments/.test(sql))return empty;
    if(/SELECT \* FROM customer_relations\.preorder_items/.test(sql))return {rows:[{item_id:1,item_kind:"FREEFORM"}]};
    return empty;
  }
  const dbWithTx={query,connect:async()=>({query,release(){}})};
  const service=createCustomerPreorderService({db:dbWithTx,config:{...config(true),nodeEnv:"test",r2BucketName:"bucket"},storageProvider:{}});
  const auth={role:"staff",userId:"staff003",effectiveBranchCode:"003"};const body={idempotencyKey:"same-key",customerName:"สมชาย",customerPhone:"0812345678",intent:"PRICE_INQUIRY",items:[{itemKind:"FREEFORM",description:"สินค้าทดสอบ",quantity:1}]};
  const first=await service.create(auth,body,[]);const replay=await service.create(auth,body,[]);
  assert.equal(first.public_id,replay.public_id);assert.equal(caseInsertCount,1);
});
