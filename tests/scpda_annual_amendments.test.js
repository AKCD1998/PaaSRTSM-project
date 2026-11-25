'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
const express = require('express'), request = require('supertest'), bcrypt = require('bcryptjs'), { Pool } = require('pg');
const annual = require('../apps/admin-api/src/services/scpdaAnnualCount');
const amendments = require('../apps/admin-api/src/services/scpdaAnnualAmendments');
const { versionPolicy } = require('../apps/admin-api/src/services/scpdaDailyVersions');
const { mountAnnualRoutes } = require('../apps/admin-api/src/services/scpdaAnnualRoutes');

test('resubmission diff includes zero additions, location renaming and equal-total location changes', () => {
  const items = [{ row:3,ordinal:1,code:'0001',name:'ยาทดสอบ',unit:'เม็ด' }];
  const before = { 3:[{quantityMilli:1000},{quantityMilli:2000},null,{quantityMilli:0,place:'เดิม'}] };
  const after = { 3:[{quantityMilli:2000},{quantityMilli:1000},{quantityMilli:0},{quantityMilli:0,place:'ใหม่'}] };
  const diff = amendments.changesFor(items,before,after);
  assert.deepEqual(diff.summary,{rows:1,added:1,changed:3,removed:0});
  assert.equal(diff.changes[0].beforeTotal,3000); assert.equal(diff.changes[0].afterTotal,3000);
  assert.ok(diff.changes[0].fields.some(f => f.before === null && f.after === 0));
  assert.ok(diff.changes[0].fields.some(f => f.before === 'เดิม' && f.after === 'ใหม่'));
  assert.deepEqual(amendments.changesFor(items,after,after).changes,[]);
});

test('R25 rollout keeps explicitly published R21–R25 clients within a bounded policy', () => {
  assert.deepEqual(versionPolicy({scpdaDailyVersionPolicyJson:JSON.stringify({'004':{accepted:[21,22,23,24,25],qr:[21,22,23,24,25]}})},'004').accepted,[21,22,23,24,25]);
  assert.throws(()=>versionPolicy({scpdaDailyVersionPolicyJson:JSON.stringify({'004':{accepted:[1,2,3,4,5,6,7,8,9],qr:[9]}})},'004'));
});

const uri = process.env.SCPDA_ANNUAL_AMEND_TEST_DATABASE_URL;
test('review-bound amendments preserve only three full versions and replay pruned receipts safely', { skip:!uri }, async () => {
  const url = new URL(uri); assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.ok(url.pathname.startsWith('/scpda_annual_amend_'));
  const db = new Pool({connectionString:uri,ssl:false}); let eventId;
  try {
    await db.query('CREATE SCHEMA IF NOT EXISTS ordering');
    for (const file of ['093_add_scpda_annual_count.sql','094_queue_scpda_annual_pages.sql','095_scpda_annual_submission_history.sql']) await db.query(await fs.readFile(path.join(__dirname,'../migrations',file),'utf8'));
    eventId = randomUUID();
    await db.query("INSERT INTO ordering.scpda_annual_events(id,branch_code,warehouse_code,label,source_files) VALUES($1,'005','001','Fixture amendment','{}')",[eventId]);
    const items = [{row:3,ordinal:1,code:'0001',name:'ยาทดสอบ A',unit:'เม็ด'},{row:4,ordinal:2,code:'0002',name:'ยาทดสอบ B',unit:'กล่อง'}];
    for (const n of [1,2]) await db.query("INSERT INTO ordering.scpda_annual_pages(event_id,category,page_no,items,assignee) VALUES($1,'normal',$2,$3::jsonb,'03005')",[eventId,n,JSON.stringify(items)]);
    const key = {eventId,branchCode:'005',category:'normal',pageNo:1,operator:'03005'};
    let counts = {3:[{quantityMilli:1000},{quantityMilli:2000},null],4:[{quantityMilli:0},null,null]};
    const first = await annual.savePage(db,{...key,revision:0,mutationId:randomUUID(),counts,submit:true});
    const password = 'fixture-submit-confirmation';
    const app = express(); app.use(express.json({limit:'1mb'}));
    mountAnnualRoutes({router:app,config:{featureScpdaAnnual005:true,featureScpdaDaily005:true,featureScpdaBranch005:true,scpdaAnnualSubmitConfirmationHash:await bcrypt.hash(password,12)},db,
      settings:{sessionKey:'fixture-only-annual-review-signing-key',operators:new Map()},burst:()=>{},
      authenticate:async req=>({operator:{operatorCode:req.get('fixture-user')||'03005',branchCode:req.get('fixture-branch')||'005'},claims:{app_version:Number(req.get('fixture-version')||25),device_ref:req.get('fixture-device')||'a'.repeat(64),cv:'c'.repeat(64)}}),
      envelope:(data,branchCode)=>({contract:'scpda-read-005-v1',branchCode,...data}),run:fn=>(req,res,next)=>fn(req,res).catch(next)});
    app.use((e,_req,res,_next)=>res.status(e.status||500).json({code:e.code||'UNEXPECTED'}));
    const post = (route,body,user='03005') => request(app).post('/annual/'+route).set('fixture-user',user).send({...key,...body});
    const same = await post('amend-preview',{counts}).expect(200); assert.equal(same.body.unchanged,true);
    await post('history',{},'04005').expect(404);
    await request(app).post('/annual/history').set('fixture-user','02004').set('fixture-branch','004').send(key).expect(403);
    const old = await request(app).get('/annual?category=normal&pageNo=1').set('fixture-version','24').expect(200);
    assert.equal(old.body.assigned.pageNo,2);
    const current = await request(app).get('/annual?category=normal&pageNo=1').expect(200); assert.equal(current.body.assigned.receiptId,first.receiptId);
    let firstAmendment;
    for (let n=2;n<=5;n++) {
      counts = {...counts,3:[{quantityMilli:n*1000},{quantityMilli:2000},null,{quantityMilli:0,place:'คลัง'}]};
      const reviewed = (await post('amend-preview',{counts}).expect(200)).body;
      const pending = {...key,counts,baseReceiptId:reviewed.baseReceiptId,baseRevision:reviewed.baseRevision,previewToken:reviewed.previewToken,mutationId:randomUUID()};
      const before = (await post('history',{}).expect(200)).body;
      assert.equal(before.versions[0].submissionNo,n-1); // Preview/cancel changes nothing.
      if (n===2) {
        await post('amend',{...pending,confirmationPassword:'wrong'}).expect(403,{code:'ANNUAL_CONFIRM_PASSWORD_INVALID'});
        await post('amend',pending).expect(403,{code:'ANNUAL_CONFIRM_REQUIRED'});
        await post('amend',{...pending,counts:{...counts,4:[{quantityMilli:999},null,null]},confirmationPassword:password}).expect(409,{code:'ANNUAL_REVIEW_CHANGED'});
        await request(app).post('/annual/amend').set('fixture-device','b'.repeat(64)).send({...pending,confirmationPassword:password}).expect(409,{code:'ANNUAL_REVIEW_CHANGED'});
        const foreign = await post('amend-preview',{counts},'04005').expect(404); assert.equal(foreign.body.code,'ANNUAL_PAGE_MISSING');
      }
      const saved = (await post('amend',{...pending,confirmationPassword:password}).expect(200)).body;
      assert.equal(saved.submissionNo,n); assert.notEqual(saved.receiptId,reviewed.baseReceiptId);
      assert.equal((await post('amend',pending).expect(200)).body.receiptId,saved.receiptId);
      await post('amend',{...pending,mutationId:randomUUID(),confirmationPassword:password}).expect(409,{code:'ANNUAL_AMEND_CHANGED'});
      if(n===2) firstAmendment={pending,saved};
    }
    const h = (await post('history',{}).expect(200)).body;
    assert.deepEqual(h.versions.map(v=>v.submissionNo),[5,4,3]);
    const rows = (await db.query('SELECT submission_no,counts FROM ordering.scpda_annual_submissions WHERE event_id=$1 ORDER BY submission_no',[eventId])).rows;
    assert.equal(rows.length,5); assert.equal(rows.filter(r=>r.counts!==null).length,3);
    assert.equal(rows[0].counts,null); assert.equal(rows[1].counts,null);
    assert.equal((await post('amend',firstAmendment.pending).expect(200)).body.receiptId,firstAmendment.saved.receiptId);
    assert.deepEqual((await post('history',{}).expect(200)).body.versions[0].counts,counts);
    await db.query(await fs.readFile(path.join(__dirname,'../migrations/095_scpda_annual_submission_history.sql'),'utf8'));
    assert.deepEqual((await post('history',{}).expect(200)).body.versions.map(v=>v.submissionNo),[5,4,3]);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM ordering.scpda_annual_count_audit WHERE event_id=$1',[eventId])).rows).includes(password),false);
  } finally {
    if(eventId) {
      for(const table of ['scpda_annual_submissions','scpda_annual_count_audit','scpda_annual_requests','scpda_annual_participants','scpda_annual_pages','scpda_annual_events']) await db.query(`DELETE FROM ordering.${table} WHERE ${table==='scpda_annual_events'?'id':'event_id'}=$1`,[eventId]).catch(()=>{});
    }
    await db.end();
  }
});
