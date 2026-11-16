"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const express=require('express'),cookieParser=require('cookie-parser'),request=require('supertest'),{Pool}=require('pg');
const {signSessionToken}=require('../apps/admin-api/src/auth/session');
const {createReportPrintRegisterRouter}=require('../apps/admin-api/src/routes/report-print-register');
const config={authJwtSecret:'synthetic-print-test-only',cookieName:'test_print_session',sessionTtlHours:1},csrf='test-csrf',base='/api/admin/report-print-register';
const cookie=(role='admin')=>`test_print_session=${signSessionToken({sub:'synthetic-user',role,csrf},config)}`;
function appWith(db){const app=express();app.use(express.json());app.use(cookieParser());app.use(base,createReportPrintRegisterRouter({config,db}));app.use((e,_req,res,_next)=>res.status(e.status||500).json({error:e.message}));return app;}
test('print registry requires admin on reads and CSRF on every write before touching DB',async()=>{
 const app=appWith({query(){assert.fail('unauthorized query');},connect(){assert.fail('unauthorized connection');}}),id=randomUUID();
 for(const [verb,suffix] of [['get',''],['get','/'+id],['post',''],['post',`/${id}/confirmations`],['post',`/${id}/confirmations/${randomUUID()}/void`]]){
  await request(app)[verb](base+suffix).expect(401);
  for(const role of ['branch','staff','superadmin'])await request(app)[verb](base+suffix).set('Cookie',cookie(role)).set('X-CSRF-Token',csrf).send({}).expect(403);
  if(verb==='post')await request(app)[verb](base+suffix).set('Cookie',cookie()).send({}).expect(403);
 }
});
const dbUrl=process.env.KY9_DOCUMENTS_TEST_DATABASE_URL;
(dbUrl?test:test.skip)('REAL POSTGRES: paper evidence, idempotency, immutable corrections and monthly coverage',async t=>{
 const url=new URL(dbUrl);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/^\/sc_ky9_documents_test_[a-z0-9_]+$/);
 const db=new Pool({connectionString:dbUrl,max:3});t.after(()=>db.end());await db.query('DROP SCHEMA IF EXISTS report_print_register CASCADE');
 const migration=fs.readFileSync(path.join(__dirname,'../migrations/085_add_report_print_register.sql'),'utf8');await db.query(migration);await db.query(migration);
 const app=appWith(db),send=(verb,suffix,body)=>request(app)[verb](base+suffix).set('Cookie',cookie()).set('X-CSRF-Token',csrf).send(body);
 const d={sourceKey:'synthetic-document',reportKind:'KY11',branchCode:'001',periodStart:'2026-07-01',periodEnd:'2026-09-30',version:'SYNTHETIC',filename:'test.pdf',pageCount:10,sourceReference:'isolated test',reason:'test register',sections:[{month:'2026-07',pageFrom:1,pageTo:4},{month:'2026-08',pageFrom:5,pageTo:7},{month:'2026-09',pageFrom:8,pageTo:10}],provenance:{pdfCreated:true,printedQuantity:1000}};
 const created=await send('post','',d).expect(200),id=created.body.id;
 await send('post','',d).expect(409);
 let result=await send('get','').expect(200);assert.equal(result.body.documents[0].status,'waiting_confirmation');assert.equal((await db.query('SELECT count(*)::int n FROM report_print_register.events')).rows[0].n,0);
 const confirm={physicalPrinted:true,requestKey:randomUUID(),pages:'1-3',printedOn:null,copies:null,evidenceType:'user_confirmation',evidenceReference:'synthetic explicit paper confirmation',reason:'test evidence'};
 await send('post',`/${id}/confirmations`,{...confirm,physicalPrinted:false}).expect(400);
 await send('post',`/${id}/confirmations`,{...confirm,pages:'1-11'}).expect(400);
 const a=await send('post',`/${id}/confirmations`,confirm).expect(200);
 const replay=await send('post',`/${id}/confirmations`,confirm).expect(200);assert.equal(replay.body.id,a.body.id);assert.equal(replay.body.reused,true);
 await send('post',`/${id}/confirmations`,{...confirm,pages:'1-2'}).expect(409);
 const second={...confirm,requestKey:randomUUID(),pages:'3-5'};await Promise.all([send('post',`/${id}/confirmations`,second).expect(200),send('post',`/${id}/confirmations`,second).expect(200)]);
 result=await send('get','?month=2026-08&kind=KY11&branch=001').expect(200);assert.equal(result.body.documents[0].confirmedPages,1);assert.equal(result.body.documents[0].scopeTotalPages,3);
 let detail=(await send('get','/'+id).expect(200)).body;assert.equal(detail.document.confirmedPages,5);assert.equal(detail.events.length,2);assert.equal(detail.events[0].printed_on,null);assert.equal(detail.events[0].copies,null);assert.ok(detail.events[0].recorded_at);
 const full=await send('post',`/${id}/confirmations`,{...confirm,requestKey:randomUUID(),pages:'1-10'}).expect(200);
 result=await send('get','?status=confirmed_printed').expect(200);assert.equal(result.body.documents.length,1);
 await send('post',`/${id}/confirmations/${full.body.id}/void`,{reason:'synthetic correction'}).expect(200);
 await send('post',`/${id}/confirmations/${full.body.id}/void`,{reason:'repeat'}).expect(409);
 detail=(await send('get','/'+id).expect(200)).body;assert.equal(detail.document.confirmedPages,5);assert.equal(detail.events.length,4);
 for(const sql of ['UPDATE report_print_register.events SET reason=reason','DELETE FROM report_print_register.events','UPDATE report_print_register.documents SET version_label=version_label'])await assert.rejects(db.query(sql),/append-only/);
 await db.query('INSERT INTO report_print_register.unmapped_evidence(id,source_key,report_kind,branch_code,month,summary,evidence_reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),'synthetic-photo','KY9','005','2026-09','paper photo, version unknown','synthetic image','test']);
 result=await send('get','?kind=KY9&month=2026-09').expect(200);assert.equal(result.body.documents.length,0);assert.equal(result.body.unmappedEvidence.length,1);
 await send('get','?month=2569-09').expect(400);
});
