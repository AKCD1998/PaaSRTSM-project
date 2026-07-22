"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const request = require("supertest");
const { createApp } = require("../apps/admin-api/src/server"); const { signSessionToken } = require("../apps/admin-api/src/auth/session");
const { validateImages } = require("../apps/admin-api/src/services/preorderAttachments");
const { createCustomerPreorderService } = require("../apps/admin-api/src/services/customerPreorders");
const { createR2PreorderStorageProvider } = require("../apps/admin-api/src/services/storage/r2PreorderStorageProvider");
const { cleanupPreorderAttachments } = require("../apps/admin-api/src/services/preorderAttachmentCleanup");

function cfg(){return {nodeEnv:"test",featureCustomerPreorders:true,featureVideoStudio:false,featureStockRequests:false,featureStockRecommendationCron:false,trustProxy:false,corsAllowedOrigins:new Set(),corsAllowAllOrigins:false,cookieName:"session",authJwtSecret:"secret",sessionTtlHours:1,cookieSameSite:"lax",cookieSecure:false,loginRateLimitWindowMs:1000,loginRateLimitMax:10,adminUsers:new Set(),staffUsers:new Set(),branchUsers:new Set(),branchUserBranches:new Map(),branchUserPasswordHashes:new Map(),r2BucketName:"bucket",r2SignedUrlTtlSeconds:300,preorderPendingUploadMaxAgeMinutes:60};}
function cookie(config=cfg()){return `session=${signSessionToken({sub:"staff003",role:"staff",branch_code:"003",csrf:"csrf"},config)}`;}
const inertDb={query:async()=>({rows:[]}),connect:async()=>({query:async()=>({rows:[]}),release(){}}),end:async()=>{}};

test("multipart rejects a fourth image and a file over 5 MB with HTTP 400",async()=>{
  const config=cfg();const {app}=createApp({config,db:inertDb,preorderStorageProvider:{},videoStorageProvider:{providerName:"local"},videoJobRunner:{}});
  let call=request(app).post("/api/customer-preorders/cases").set("Cookie",cookie(config)).set("X-CSRF-Token","csrf");
  for(let i=0;i<4;i+=1)call=call.attach("images",Buffer.from([0xff,0xd8,0xff]),{filename:`${i}.jpg`,contentType:"image/jpeg"});
  assert.equal((await call).status,400);
  const oversized=Buffer.alloc(5*1024*1024+1);oversized[0]=0xff;oversized[1]=0xd8;oversized[2]=0xff;
  const response=await request(app).post("/api/customer-preorders/cases").set("Cookie",cookie(config)).set("X-CSRF-Token","csrf").attach("images",oversized,{filename:"large.jpg",contentType:"image/jpeg"});
  assert.equal(response.status,400);assert.match(response.body.error,/5 MB/);
});

test("magic bytes reject SVG and MIME spoofing",()=>{
  assert.throws(()=>validateImages([{buffer:Buffer.from("<svg></svg>"),size:11,mimetype:"image/svg+xml"}]),/JPEG|PNG|WebP/);
  assert.throws(()=>validateImages([{buffer:Buffer.from([0xff,0xd8,0xff]),size:3,mimetype:"image/png"}]),/JPEG|PNG|WebP/);
});

test("R2 provider uses private S3 operations and a 300-second signed GET",async()=>{
  const sent=[];let signed;
  const provider=createR2PreorderStorageProvider({r2AccessKeyId:"id",r2SecretAccessKey:"secret",r2Endpoint:"https://x.r2.cloudflarestorage.com",r2BucketName:"bucket",r2Region:"auto",r2SignedUrlTtlSeconds:300},{client:{send:async(command)=>{sent.push(command.constructor.name);return {}; }},signer:async(_client,command,options)=>{signed={command:command.constructor.name,options};return "https://signed.invalid";}});
  await provider.putObject({key:"opaque.webp",body:Buffer.from("x"),contentType:"image/webp"});await provider.headObject("opaque.webp");await provider.deleteObject("opaque.webp");const url=await provider.createSignedGetUrl("opaque.webp");
  assert.deepEqual(sent,["PutObjectCommand","HeadObjectCommand","DeleteObjectCommand"]);assert.equal(url,"https://signed.invalid");assert.deepEqual(signed,{command:"GetObjectCommand",options:{expiresIn:300}});
});

test("partial R2 failure deletes attempted objects and leaves cleanup records",async()=>{
  const sql=[];let attachment=0;
  const query=async(statement)=>{sql.push(statement);if(/SELECT case_id,public_id/.test(statement))return {rows:[]};if(/INSERT INTO customer_relations\.preorder_cases/.test(statement))return {rows:[{case_id:11,public_id:"PRE-X",branch_code:"003",status:"SUBMITTED"}]};if(/INSERT INTO customer_relations\.preorder_attachments/.test(statement)){attachment+=1;return {rows:[]};}return {rows:[]};};
  const db={query,connect:async()=>({query,release(){}})};const deleted=[];let puts=0;const storage={putObject:async()=>{puts+=1;if(puts===2)throw new Error("synthetic R2 failure");},deleteObject:async(key)=>deleted.push(key)};
  const service=createCustomerPreorderService({db,config:cfg(),storageProvider:storage});const jpeg=()=>({buffer:Buffer.from([0xff,0xd8,0xff]),size:3,mimetype:"image/jpeg",originalname:"customer.jpg"});
  await assert.rejects(()=>service.create({role:"staff",userId:"staff003",effectiveBranchCode:"003"},{idempotencyKey:"partial",customerName:"Test",customerPhone:"0812345678",items:[{itemKind:"FREEFORM",description:"item",quantity:1}]},[jpeg(),jpeg()]),/synthetic R2 failure/);
  assert.equal(attachment,2);assert.equal(deleted.length,2);assert.ok(sql.some(statement=>/upload_state='cleanup_pending'/.test(statement)));
});

test("pending idempotency replay requires the same checksum and resumes the same R2 key",async()=>{
  const jpeg={buffer:Buffer.from([0xff,0xd8,0xff,1]),size:4,mimetype:"image/jpeg",originalname:"ignored-name.jpg"};
  const sha=require("node:crypto").createHash("sha256").update(jpeg.buffer).digest("hex");const statements=[];
  const query=async(sql)=>{statements.push(sql);if(/SELECT case_id,public_id,branch_code,status/.test(sql))return {rows:[{case_id:12,public_id:"PRE-X",branch_code:"003",status:"SUBMITTED"}]};if(/SELECT object_key,sha256,mime_type,upload_state FROM/.test(sql))return {rows:[{object_key:"customer-preorders/test/003/PRE-X/opaque.jpeg",sha256:sha,mime_type:"image/jpeg",upload_state:"cleanup_pending"}]};if(/SELECT c\.\*/.test(sql))return {rows:[{case_id:12,public_id:"PRE-X",branch_code:"003",status:"SUBMITTED"}]};return {rows:[]};};
  const db={query,connect:async()=>({query,release(){}})};const puts=[];const service=createCustomerPreorderService({db,config:cfg(),storageProvider:{putObject:async(input)=>{puts.push(input.key);return {ETag:"etag"};},headObject:async()=>({ContentLength:4})}});
  await service.create({role:"staff",userId:"staff003",effectiveBranchCode:"003"},{idempotencyKey:"replay",customerName:"Test",customerPhone:"0812345678",items:[{itemKind:"FREEFORM",description:"x",quantity:1}]},[jpeg]);
  assert.deepEqual(puts,["customer-preorders/test/003/PRE-X/opaque.jpeg"]);assert.ok(!statements.some(sql=>/INSERT INTO customer_relations\.preorder_cases/.test(sql)));
  const different={...jpeg,buffer:Buffer.from([0xff,0xd8,0xff,2])};
  await assert.rejects(()=>service.create({role:"staff",userId:"staff003",effectiveBranchCode:"003"},{idempotencyKey:"replay",customerName:"Test",customerPhone:"0812345678",items:[{itemKind:"FREEFORM",description:"x",quantity:1}]},[different]),error=>error.statusCode===409);
});

test("messages enforce case-wide image count, internal visibility, and never update status",async()=>{
  const statements=[];const query=async(sql)=>{statements.push(sql);if(/SELECT c\.\*/.test(sql))return {rows:[{case_id:5,public_id:"PRE-X",branch_code:"003",status:"SUBMITTED"}]};if(/WHERE idempotency_key/.test(sql))return {rows:[]};if(/COUNT\(\*\)::int AS count/.test(sql))return {rows:[{count:0}]};if(/GREATEST\(COALESCE/.test(sql))return {rows:[{seq:2}]};if(/INSERT INTO customer_relations\.preorder_messages/.test(sql))return {rows:[{message_id:8,case_id:5,is_ready:true}]};return {rows:[]};};
  const db={query,connect:async()=>({query,release(){}})};const service=createCustomerPreorderService({db,config:cfg(),storageProvider:{}});await service.createMessage({role:"staff",userId:"staff003",effectiveBranchCode:"003"},"PRE-X",{idempotencyKey:"msg-1",text:"ขอแจ้งข้อมูลเพิ่ม"},[]);
  assert.ok(statements.some(sql=>/INSERT INTO customer_relations\.preorder_messages/.test(sql)));assert.ok(!statements.some(sql=>/SET\s+status/i.test(sql)));
  await assert.rejects(()=>service.createMessage({role:"staff",userId:"staff003",effectiveBranchCode:"003"},"PRE-X",{idempotencyKey:"msg-2",text:"secret",visibility:"ADMIN_INTERNAL"},[]),error=>error.statusCode===403);
  const fullQuery=async(sql)=>{if(/SELECT c\.\*/.test(sql))return {rows:[{case_id:5,public_id:"PRE-X",branch_code:"003",status:"SUBMITTED"}]};if(/WHERE idempotency_key/.test(sql))return {rows:[]};if(/COUNT\(\*\)::int AS count/.test(sql))return {rows:[{count:3}]};return {rows:[]};};
  const fullService=createCustomerPreorderService({db:{query:fullQuery,connect:async()=>({query:fullQuery,release(){}})},config:cfg(),storageProvider:{}});
  const jpeg={buffer:Buffer.from([0xff,0xd8,0xff]),size:3,mimetype:"image/jpeg",originalname:"fourth.jpg"};
  await assert.rejects(()=>fullService.createMessage({role:"staff",userId:"staff003",effectiveBranchCode:"003"},"PRE-X",{idempotencyKey:"msg-3",text:"fourth"},[jpeg]),error=>error.statusCode===400&&/3 รูป/.test(error.message));
});

test("orphan cleanup deletes due objects, marks success, and reschedules failures",async()=>{
  const updates=[];const db={query:async(sql,params)=>{if(/SELECT attachment_id/.test(sql))return {rows:[{attachment_id:1,object_key:"a"},{attachment_id:2,object_key:"b"}]};updates.push({sql,params});return {rows:[]};}};
  const result=await cleanupPreorderAttachments({db,storageProvider:{deleteObject:async(key)=>{if(key==="b")throw new Error("down");}},config:cfg(),logger:{log(){},error(){}}});
  assert.deepEqual(result,{candidateCount:2,deletedCount:1,failedCount:1});assert.ok(updates.some(x=>/upload_state='deleted'/.test(x.sql)));assert.ok(updates.some(x=>/cleanup_pending/.test(x.sql)));
});
