'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),express=require('express'),bcrypt=require('bcryptjs'),{Pool}=require('pg');
const {createScpdaReadRouter}=require('../apps/admin-api/src/routes/scpda-read');
const {createScpdaCountsRouter}=require('../apps/admin-api/src/routes/scpda-counts');
const {midnight,businessDay,selfie}=require('../apps/admin-api/src/services/scpdaDailyPolicy');
const {archiveBatch}=require('../apps/admin-api/src/services/scpdaSelfieArchive');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function identity(){const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});return {deviceId:crypto.randomUUID(),publicKey:keys.publicKey.export({type:'spki',format:'der'}).toString('base64'),sign:m=>crypto.sign('sha256',Buffer.from(m),keys.privateKey).toString('base64')};}
test('Bangkok reset is next midnight, including a login at 23:59:59',()=>{assert.equal(businessDay(Date.parse('2026-11-18T17:00:00Z')),'2026-11-19');assert.equal(new Date(midnight(Date.parse('2026-11-18T16:59:59Z'))).toISOString(),'2026-11-18T17:00:00.000Z');assert.equal(new Date(midnight(Date.parse('2026-11-18T17:00:00Z'))).toISOString(),'2026-11-19T17:00:00.000Z');});
test('selfies reject oversized, non-JPEG and absent input',()=>{for(const v of [null,'data:image/png;base64,AAAA','data:image/jpeg;base64,'+'A'.repeat(280000)])assert.throws(()=>selfie(v));});
const port=Number(process.env.SCPDA_DAILY_FIXTURE_PG_PORT),uri=process.env.SCPDA_DAILY_TEST_DATABASE_URL;
if(uri){const u=new URL(uri);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/scpda_daily_fixture')throw Error('Dedicated loopback daily database required');}
if(!port&&!uri)test('daily companion HTTP/Postgres fixture requires its explicit local port',{skip:true},()=>{});
else test('real HTTP, signatures, transactions, midnight, network and archive retry',{timeout:60000},async t=>{
 const db=new Pool(uri?{connectionString:uri,ssl:false}:{host:'127.0.0.1',port,user:'scpda_fixture',password:'scpda-fixture-only',database:'scpda_daily_fixture',ssl:false});
 assert.equal((await db.query('select current_database() n')).rows[0].n,'scpda_daily_fixture');
 let clock=Date.parse('2026-11-18T09:00:00+07:00');const now=()=>clock;
 await db.query(`DROP SCHEMA IF EXISTS ordering CASCADE;DROP SCHEMA IF EXISTS ada CASCADE;DROP SCHEMA IF EXISTS app_center CASCADE;DROP TABLE IF EXISTS public.audit_logs,public.skus,public.barcodes;CREATE SCHEMA ordering;CREATE SCHEMA ada;CREATE SCHEMA app_center;
 CREATE TABLE public.audit_logs(audit_id bigserial primary key,actor_role text,actor_id text,action text,target_type text,target_id text,success bool,meta jsonb,request_id text,ip text,user_agent text,event_time timestamptz default clock_timestamp());
 CREATE TABLE app_center.releases(app_id text,status text,version_code int);INSERT INTO app_center.releases VALUES('scpda','published',17);
 CREATE TABLE public.skus(sku_id bigint primary key,company_code text,display_name text);INSERT INTO public.skus VALUES(1,'QA-001','ยาทดสอบ');
 CREATE TABLE public.barcodes(sku_id bigint,barcode text);INSERT INTO public.barcodes VALUES(1,'0001234567890');
 CREATE TABLE ada.branch_stock_snapshots(product_code text,product_name_thai text,product_name_eng text,barcode text,unit text,qty_branch_001 numeric,qty_branch_004 numeric,qty_branch_005 numeric,synced_at timestamptz);
 INSERT INTO ada.branch_stock_snapshots VALUES('QA-001','ยาทดสอบ','','0001234567890','เม็ด',7,8,11,now());`);
 for(const file of ['083_add_scpda_lot_observations.sql','084_enable_scpda_branch005.sql','087_enable_scpda_branch004.sql','090_add_scpda004_count_areas.sql','091_add_scpda_daily_companion.sql','091_add_scpda_daily_companion.sql','092_enable_scpda004_daily_companions.sql','092_enable_scpda004_daily_companions.sql'])await db.query(fs.readFileSync('migrations/'+file,'utf8'));
 const dailyShopeeInvitationId=crypto.randomUUID(),dailyShopeeCode=crypto.randomBytes(24).toString('base64url');
 const frontInvitationId=crypto.randomUUID(),frontCode=crypto.randomBytes(24).toString('base64url');
 const areaInvitationId=crypto.randomUUID(),areaCode=crypto.randomBytes(24).toString('base64url'),code=crypto.randomBytes(24).toString('base64url'),invitationId=crypto.randomUUID(),h=await bcrypt.hash('fixturePassword',12),ops=['01001','02001','03001','01004','01004SHPEE','02004','02004SHPEE','01005','02005'].map(operatorCode=>({operatorCode,branchCode:operatorCode.endsWith('005')?'005':['01004','01004SHPEE','02004','02004SHPEE'].includes(operatorCode)?'004':'001',hash:h,version:crypto.randomUUID(),rotationDueAt:'2027-05-18T00:00:00Z'}));
 const config={featureScpda004Areas:true,featureScpdaRead001:true,featureScpdaCounts001:true,featureScpdaBranch004:true,featureScpdaBranch005:true,featureScpdaDaily005:true,scpdaPwaVersionCode:17,scpdaPwaOrigin:'https://sc-stockday-ordering.onrender.com',scpdaDriveClientId:'synthetic-only',scpdaDriveClientSecret:'synthetic-only',scpdaDriveRefreshToken:'synthetic-only',scpdaCountOperators001:'01001,01004,01004SHPEE,02004,02004SHPEE,01005,02005',authJwtSecret:'synthetic-only-sc-test-signing-key',scpdaOperatorCredentialsJson:JSON.stringify(ops),scpdaDeviceInvitationsJson:JSON.stringify([{id:dailyShopeeInvitationId,operatorCode:'01004SHPEE',branchCode:'004',hash:sha(dailyShopeeCode),expiresAt:'2026-12-01T00:00:00Z'},{id:frontInvitationId,operatorCode:'01004',branchCode:'004',hash:sha(frontCode),expiresAt:'2026-12-01T00:00:00Z'},{id:invitationId,hash:sha(code),expiresAt:'2026-12-01T00:00:00Z',branchCode:'005'},{id:areaInvitationId,operatorCode:'01004SHPEE',branchCode:'004',hash:sha(areaCode),expiresAt:'2026-12-01T00:00:00Z'}])};
 const app=express();app.set('trust proxy',1);app.use(express.json({limit:'1mb'}));app.use('/api/scpda/counts',createScpdaCountsRouter({config,db,now}));app.use('/api/scpda',createScpdaReadRouter({config,db,now}));
 const server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));const origin='http://127.0.0.1:'+server.address().port;
 let proxySerial=0;
 async function req(path,{body,token,ip='203.0.113.5',expected}={}){const r=await fetch(origin+'/api/scpda'+path,{method:body===undefined?'GET':'POST',headers:{'X-Forwarded-For':ip+', 172.64.0.'+(1+(proxySerial++%5)),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const data=await r.json();if(expected!==undefined)assert.equal(r.status,expected,JSON.stringify(data));return {status:r.status,data};}
 const primary=identity(),child=identity(),other=identity();let parentToken,grant,childToken,childSession,countToken,receiptId;
 const image='data:image/jpeg;base64,'+fs.readFileSync('tests/fixtures/scpda-selfie-synthetic.jpg').toString('base64'),imageHash=sha(fs.readFileSync('tests/fixtures/scpda-selfie-synthetic.jpg'));
 async function loginPrimary(){primary.certificate=(await req('/device/pair',{body:{invitationId,code,publicKey:primary.publicKey,deviceId:primary.deviceId},expected:primary.certificate?200:201})).data.deviceCertificate;const c=(await req('/auth/challenge',{body:{deviceCertificate:primary.certificate},expected:200})).data;return (await req('/auth/login',{body:{operatorCode:'01005',pin:'fixturePassword',deviceCertificate:primary.certificate,challengeId:c.challengeId,signature:primary.sign(['SCPDA-LOGIN-V1',c.challengeId,c.nonce,'01005',c.deviceRef].join('\n'))},expected:200})).data.token;}
 async function qr(version=17){const c=(await req('/daily/qr/challenge',{token:parentToken,body:{},expected:200})).data;return req('/daily/qr',{token:parentToken,body:{deviceCertificate:primary.certificate,versionCode:version,challengeId:c.challengeId,signature:primary.sign(['SCPDA-COMPANION-QR-V1',c.challengeId,c.nonce,JSON.parse(Buffer.from(parentToken.split('.')[1],'base64url')).jti,version].join('\n'))}});}
 async function enroll(device,ip='203.0.113.5',pin='fixturePassword'){const body={grantId:grant.grantId,secret:grant.secret,publicKey:device.publicKey,deviceId:device.deviceId,versionCode:17,selfie:image,pin};body.signature=device.sign(['SCPDA-COMPANION-ENROLL-V1',body.grantId,body.secret,body.deviceId,imageHash,17].join('\n'));return req('/daily/companion/enroll',{body,ip});}
 try{
 await t.test('seven-account policy retains004 Shopee device/area/count capabilities while005 daily admission is on',async()=>{
  const d=identity(),cert=(await req('/device/pair',{body:{invitationId:areaInvitationId,code:areaCode,publicKey:d.publicKey,deviceId:d.deviceId},expected:201})).data.deviceCertificate;
  const c=(await req('/auth/challenge',{body:{deviceCertificate:cert},expected:200})).data;
  const r=(await req('/auth/login',{body:{deviceCertificate:cert,operatorCode:'01004SHPEE',pin:'fixturePassword',challengeId:c.challengeId,signature:d.sign(['SCPDA-LOGIN-V1',c.challengeId,c.nonce,'01004SHPEE',c.deviceRef].join('\n'))},expected:200})).data;
  assert.equal(r.user.countScope.id,'004-shopee');const me=(await req('/session',{token:r.token,expected:200})).data;assert.equal(me.user.countScope.id,'004-shopee');assert.equal(me.dailySession,false);
  const a=(await req('/counts/access/challenge',{token:r.token,body:{deviceCertificate:cert},expected:200})).data;
  const grant=(await req('/counts/access/authorize',{token:r.token,body:{deviceCertificate:cert,challengeId:a.challengeId,signature:d.sign(['SCPDA-COUNT-ACCESS-V1',a.challengeId,a.nonce,'01004SHPEE',a.deviceRef,a.parentSessionId].join('\n'))},expected:200})).data;
  const cap=(await req('/counts/capabilities',{token:grant.countToken,expected:200})).data;assert.equal(cap.countScope.id,'004-shopee');assert.equal(cap.canRecordInternalPick,true);
  const stock=(await req('/stock?search=QA-001',{token:r.token,expected:200})).data;assert.equal(stock.branchCode,'004');assert.equal(stock.records[0].quantity,8);

 });
 await t.test('primary needs daily selfie; old version cannot create the QR',async()=>{const bootstrap=await loginPrimary();await req('/session',{token:bootstrap,expected:401});const c=(await req('/daily/primary/challenge',{token:bootstrap,body:{},expected:200})).data;const id=JSON.parse(Buffer.from(bootstrap.split('.')[1],'base64url')).jti;const r=await req('/daily/primary/start',{token:bootstrap,body:{deviceCertificate:primary.certificate,challengeId:c.challengeId,versionCode:17,selfie:image,signature:primary.sign(['SCPDA-DAILY-PRIMARY-V1',c.challengeId,c.nonce,id,imageHash,17].join('\n'))},expected:200});parentToken=r.data.token;assert.equal(r.data.expiresAt,'2026-11-18T17:00:00.000Z');await req('/session',{token:parentToken,expected:200});assert.equal((await qr(16)).status,409);grant=(await qr()).data;assert.ok(grant.url.includes('#enroll='));});
 await t.test('network denial and bad password do not consume grant or bind an installation',async()=>{assert.equal((await enroll(child,'198.51.100.2')).status,403);assert.equal((await enroll(child,undefined,'badPassword')).status,401);assert.equal((await db.query('select count(*) n from ordering.scpda_operator_devices')).rows[0].n,'0');});
 await t.test('two phones racing on the same QR get exactly one permanent binding',async()=>{const results=await Promise.all([enroll(child),enroll(other)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const winner=results.findIndex(r=>r.status===201);if(winner===1){const copy={...child};Object.assign(child,other);Object.assign(other,copy);}const r=results[winner].data;childToken=r.token;childSession=r.dailySessionId;child.certificate=r.deviceCertificate;assert.equal(r.user.operatorCode,'02005');assert.equal((await db.query('select count(*) n from ordering.scpda_operator_devices')).rows[0].n,'1');assert.equal((await enroll(child)).status,201);assert.equal((await enroll(other)).status,409);});
 await t.test('a companion certificate cannot become primary01005 even with the primary password',async()=>{const c=(await req('/auth/challenge',{body:{deviceCertificate:child.certificate},expected:200})).data;await req('/auth/login',{body:{operatorCode:'01005',pin:'fixturePassword',deviceCertificate:child.certificate,challengeId:c.challengeId,signature:child.sign(['SCPDA-LOGIN-V1',c.challengeId,c.nonce,'01005',c.deviceRef].join('\n'))},expected:401});});
 await t.test('each request checks network; forged forwarded prefix is ignored',async()=>{await req('/session',{token:childToken,expected:200});await req('/session',{token:childToken,ip:'198.51.100.2',expected:403});await req('/session',{token:childToken,ip:'203.0.113.5, 198.51.100.2',expected:403});});
 await t.test('closing/reopening resumes using a fresh device proof, never a stored password',async()=>{const c=(await req('/daily/resume/challenge',{body:{sessionId:childSession},expected:200})).data;const body={sessionId:childSession,challengeId:c.challengeId,signature:child.sign(['SCPDA-DAILY-RESUME-V1',c.challengeId,c.nonce,childSession].join('\n'))};const r=await req('/daily/resume',{body,expected:200});assert.equal(r.data.dailySessionId,childSession);assert.equal(r.data.expiresAt,'2026-11-18T17:00:00.000Z');await req('/daily/resume',{body,expected:401});});
 await t.test('separate count proof preserves exact quantity, dates and receipt idempotency',async()=>{const c=(await req('/counts/access/challenge',{token:childToken,body:{deviceCertificate:child.certificate},expected:200})).data;const r=await req('/counts/access/authorize',{token:childToken,body:{deviceCertificate:child.certificate,challengeId:c.challengeId,signature:child.sign(['SCPDA-COUNT-ACCESS-V1',c.challengeId,c.nonce,'02005',c.deviceRef,c.parentSessionId].join('\n'))},expected:200});countToken=r.data.countToken;assert.equal(r.data.expiresAt,'2026-11-18T17:00:00.000Z');const body={id:crypto.randomUUID(),capturedByOperator:'02005',skuId:'1',productCode:'QA-001',barcode:'0001234567890',unitLabel:'เม็ด',category:'pharma',round:1,completeProduct:false,observedAt:new Date(clock).toISOString(),lots:[{code:'TEST-LOT',quantity:'2',manufacturedOn:'2026-01-01',expiresOn:'2028-01-31'}]};const receipt=await req('/counts',{token:countToken,body,expected:201});receiptId=receipt.data.receiptId;assert.equal(receipt.data.event.serverAcceptedAsCurrentStock,false);assert.equal((await req('/counts',{token:countToken,body,expected:200})).data.receiptId,receiptId);await req('/counts/history',{token:countToken,ip:'198.51.100.2',expected:403});assert.equal((await db.query("select qty_branch_005 from ada.branch_stock_snapshots where product_code='QA-001'")).rows[0].qty_branch_005,'11');});
 await t.test('new QR cannot move the bound account to a second installation',async()=>{grant=(await qr()).data;assert.equal((await enroll(other)).status,409);});
 await t.test('midnight expires read, count and resume; evidence survives',async()=>{clock=Date.parse('2026-11-18T17:00:00Z');await req('/session',{token:childToken,expected:401});await req('/counts/history',{token:countToken,expected:401});const c=(await req('/daily/resume/challenge',{body:{sessionId:childSession},expected:200})).data;await req('/daily/resume',{body:{sessionId:childSession,challengeId:c.challengeId,signature:child.sign(['SCPDA-DAILY-RESUME-V1',c.challengeId,c.nonce,childSession].join('\n'))},expected:401});assert.equal((await db.query('select count(*) n from ordering.scpda_observations where receipt_id=$1',[receiptId])).rows[0].n,'1');});
 await t.test('Drive timeout retries reserved file IDs; images disappear after 90 days while work evidence remains',async()=>{const files=new Map();let fail=true;const drive={verify:async()=>{},reserveId:async()=>crypto.randomUUID(),put:async row=>{files.set(row.drive_file_id,row.image_sha256);if(fail){fail=false;throw Error('synthetic lost response');}},remove:async row=>files.delete(row.drive_file_id)};await assert.rejects(archiveBatch({db,drive,now}));await archiveBatch({db,drive,now});assert.equal(files.size,2);const rows=(await db.query('select state,image_bytes,drive_file_id from ordering.scpda_selfie_archives')).rows;assert.ok(rows.every(r=>r.state==='uploaded'&&r.image_bytes===null&&files.has(r.drive_file_id)));clock+=90*86400000;await archiveBatch({db,drive,now});assert.equal(files.size,0);assert.equal((await db.query("select count(*) n from ordering.scpda_selfie_archives where state='deleted' and image_bytes is null")).rows[0].n,'2');assert.equal((await db.query('select count(*) n from ordering.scpda_observations')).rows[0].n,'1');});
 await t.test('audit evidence contains no photo, PIN, QR secret or session bearer',async()=>{const logs=JSON.stringify((await db.query('select meta from public.audit_logs')).rows);for(const value of [grant.secret,image,'fixturePassword',childToken])assert.equal(logs.includes(value),false);});

 await t.test('004 flag is independent, with front and Shopee policies',async()=>{
  assert.equal((await req('/daily/policy?branchCode=004',{expected:200})).data.enabled,false);
  assert.equal((await req('/daily/policy',{expected:200})).data.enabled,true);
  config.featureScpdaDaily004=true;clock=Date.parse('2026-11-19T09:00:00+07:00');
  const policy=(await req('/daily/policy?operatorCode=01004SHPEE',{expected:200})).data;
  assert.equal(policy.branchCode,'004');assert.equal(policy.primaryOperatorCode,'01004SHPEE');assert.equal(policy.operatorCode,'02004SHPEE');
  await req('/daily/policy?branchCode=005&operatorCode=01004',{expected:400});
 });
 const teams=[];
 for(const [primaryCode,childCode,scope,invitationId,code]of [['01004','02004','004-front',frontInvitationId,frontCode],['01004SHPEE','02004SHPEE','004-shopee',dailyShopeeInvitationId,dailyShopeeCode]]){
  await t.test(primaryCode+' QR binds only '+childCode+' and retains '+scope,async()=>{
   const d=identity();const cert=(await req('/device/pair',{body:{invitationId,code,publicKey:d.publicKey,deviceId:d.deviceId},expected:201})).data.deviceCertificate;
   const auth=(await req('/auth/challenge',{body:{deviceCertificate:cert},expected:200})).data;
   const login=(await req('/auth/login',{body:{operatorCode:primaryCode,pin:'fixturePassword',deviceCertificate:cert,challengeId:auth.challengeId,signature:d.sign(['SCPDA-LOGIN-V1',auth.challengeId,auth.nonce,primaryCode,auth.deviceRef].join('\n'))},expected:200})).data;
   await req('/session',{token:login.token,expected:401});
   const c=(await req('/daily/primary/challenge',{token:login.token,body:{},expected:200})).data,jti=JSON.parse(Buffer.from(login.token.split('.')[1],'base64url')).jti;
   const started=(await req('/daily/primary/start',{token:login.token,body:{deviceCertificate:cert,selfie:image,versionCode:17,challengeId:c.challengeId,signature:d.sign(['SCPDA-DAILY-PRIMARY-V1',c.challengeId,c.nonce,jti,imageHash,17].join('\n'))},expected:200})).data;
   const me=(await req('/session',{token:started.token,expected:200})).data;assert.equal(me.user.countScope.id,scope);assert.equal(me.dailySession,true);
   const q=(await req('/daily/qr/challenge',{token:started.token,body:{},expected:200})).data;
   const grant=(await req('/daily/qr',{token:started.token,body:{operatorCode:childCode==='02004'?'02004SHPEE':'02004',deviceCertificate:cert,versionCode:17,challengeId:q.challengeId,signature:d.sign(['SCPDA-COMPANION-QR-V1',q.challengeId,q.nonce,started.dailySessionId,17].join('\n'))},expected:201})).data;
   assert.equal(grant.operatorCode,childCode);assert.ok(grant.url.endsWith('&operator='+childCode));
   const child=identity(),other=identity();
   const payload=device=>{const body={grantId:grant.grantId,secret:grant.secret,publicKey:device.publicKey,deviceId:device.deviceId,versionCode:17,selfie:image,pin:'fixturePassword',operatorCode:childCode};body.signature=device.sign(['SCPDA-COMPANION-ENROLL-V1',body.grantId,body.secret,body.deviceId,imageHash,17].join('\n'));return body;};
   await req('/daily/companion/enroll',{body:{...payload(child),operatorCode:childCode==='02004'?'02004SHPEE':'02004'},expected:403});
   await req('/daily/companion/enroll',{body:payload(child),ip:'198.51.100.22',expected:403});
   const results=await Promise.all([req('/daily/companion/enroll',{body:payload(child)}),req('/daily/companion/enroll',{body:payload(other)})]);
   assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const i=results.findIndex(r=>r.status===201),winner=i===0?child:other;
   const admitted=results[i].data;assert.equal(admitted.user.operatorCode,childCode);assert.equal(admitted.branchCode,'004');assert.equal(admitted.user.countScope.id,scope);assert.equal(admitted.user.canRecordInternalPick,false);
   const access=(await req('/counts/access/challenge',{token:admitted.token,body:{deviceCertificate:admitted.deviceCertificate},expected:200})).data;
   const counter=(await req('/counts/access/authorize',{token:admitted.token,body:{deviceCertificate:admitted.deviceCertificate,challengeId:access.challengeId,signature:winner.sign(['SCPDA-COUNT-ACCESS-V1',access.challengeId,access.nonce,childCode,access.deviceRef,access.parentSessionId].join('\n'))},expected:200})).data;
   assert.equal(counter.countScope.id,scope);assert.equal(counter.canRecordInternalPick,false);
   const input={id:crypto.randomUUID(),capturedByOperator:childCode,skuId:'1',productCode:'QA-001',barcode:'0001234567890',unitLabel:'เม็ด',category:'pharma',round:1,completeProduct:false,observedAt:new Date(clock).toISOString(),countScopeId:scope,lots:[{code:'004-LOT',quantity:'3',manufacturedOn:'2026-01-01',expiresOn:'2028-01-31'}]};
   await req('/counts',{token:counter.countToken,body:{...input,countScopeId:scope==='004-front'?'004-shopee':'004-front'},expected:403});
   const missing={...input};delete missing.countScopeId;await req('/counts',{token:counter.countToken,body:missing,expected:400});
   const count=(await req('/counts',{token:counter.countToken,body:input,expected:201})).data;
   assert.equal(count.event.countScopeId,scope);assert.equal(count.event.serverAcceptedAsCurrentStock,false);
   assert.equal((await req('/counts',{token:counter.countToken,body:input,expected:200})).data.receiptId,count.receiptId);
   await req('/counts/internal-picks/history',{token:counter.countToken,expected:403});
   await req('/daily/qr/challenge',{token:admitted.token,body:{},expected:403});
   await req('/counts/history',{token:counter.countToken,ip:'198.51.100.22',expected:403});
   const resume=(await req('/daily/resume/challenge',{body:{sessionId:admitted.dailySessionId},expected:200})).data;
   const resumed=(await req('/daily/resume',{body:{sessionId:admitted.dailySessionId,challengeId:resume.challengeId,signature:winner.sign(['SCPDA-DAILY-RESUME-V1',resume.challengeId,resume.nonce,admitted.dailySessionId].join('\n'))},expected:200})).data;
   assert.equal(resumed.user.operatorCode,childCode);assert.equal(resumed.user.countScope.id,scope);
   const photo=(await db.query('SELECT file_name FROM ordering.scpda_selfie_archives WHERE session_id=$1',[admitted.dailySessionId])).rows[0];assert.ok(photo.file_name.includes('_004_'+childCode+'_'));
   teams.push({primaryCode,primaryDevice:d,primaryCert:cert,primaryToken:started.token,primarySession:started.dailySessionId,childCode,scope,token:admitted.token,counter:counter.countToken,session:admitted.dailySessionId});
  });
 }

 await t.test('each primary can add several permanent device slots; database accounts get only its own count scope',async()=>{
  clock+=61000;const bootstrap=await loginPrimary(),c=(await req('/daily/primary/challenge',{token:bootstrap,body:{},expected:200})).data,jti=JSON.parse(Buffer.from(bootstrap.split('.')[1],'base64url')).jti;
  const parent=(await req('/daily/primary/start',{token:bootstrap,body:{deviceCertificate:primary.certificate,selfie:image,versionCode:17,challengeId:c.challengeId,signature:primary.sign(['SCPDA-DAILY-PRIMARY-V1',c.challengeId,c.nonce,jti,imageHash,17].join('\n'))},expected:200})).data;
  parentToken=parent.token;
  for(const team of [...teams,{primaryCode:'01005',primaryDevice:primary,primaryCert:primary.certificate,primaryToken:parent.token,primarySession:parent.dailySessionId,scope:null}]){
   clock+=61000;const issued=[];
   const getQr=async target=>{const challenge=(await req('/daily/qr/challenge',{token:team.primaryToken,body:{},expected:200})).data;return req('/daily/qr',{token:team.primaryToken,body:{target,deviceCertificate:team.primaryCert,versionCode:17,challengeId:challenge.challengeId,signature:team.primaryDevice.sign(['SCPDA-COMPANION-QR-V2',challenge.challengeId,challenge.nonce,team.primarySession,17,target].join('\n'))}});};
   for(let n=0;n<3;n++){
    const qr=(await getQr('new'));assert.equal(qr.status,201,JSON.stringify(qr.data));const g=qr.data;assert.ok(!issued.includes(g.operatorCode));issued.push(g.operatorCode);assert.equal(g.initialPassword,'sc'+g.operatorCode);
    const d=identity(),body={operatorCode:g.operatorCode,grantId:g.grantId,secret:g.secret,publicKey:d.publicKey,deviceId:d.deviceId,versionCode:17,selfie:image,pin:g.initialPassword};body.signature=d.sign(['SCPDA-COMPANION-ENROLL-V1',body.grantId,body.secret,body.deviceId,imageHash,17].join('\n'));
    const admitted=(await req('/daily/companion/enroll',{body,expected:201})).data;assert.equal(admitted.user.operatorCode,g.operatorCode);assert.equal(admitted.user.countScope?.id||null,team.scope);assert.notEqual(admitted.user.canRecordInternalPick,true);
    const a=(await req('/counts/access/challenge',{token:admitted.token,body:{deviceCertificate:admitted.deviceCertificate},expected:200})).data;
    const count=(await req('/counts/access/authorize',{token:admitted.token,body:{deviceCertificate:admitted.deviceCertificate,challengeId:a.challengeId,signature:d.sign(['SCPDA-COUNT-ACCESS-V1',a.challengeId,a.nonce,g.operatorCode,a.deviceRef,a.parentSessionId].join('\n'))},expected:200})).data;
    const input={id:crypto.randomUUID(),capturedByOperator:g.operatorCode,skuId:'1',productCode:'QA-001',barcode:'0001234567890',unitLabel:'เม็ด',category:'pharma',round:1,completeProduct:false,observedAt:new Date(clock).toISOString(),...(team.scope?{countScopeId:team.scope}:{}),lots:[{code:'MULTI',quantity:'1',manufacturedOn:null,expiresOn:null}]};
    const receipt=(await req('/counts',{token:count.countToken,body:input,expected:201})).data;assert.equal(receipt.event.operatorCode,g.operatorCode);assert.equal(receipt.event.countScopeId||null,team.scope);
   }
   const list=(await req('/daily/companions',{token:team.primaryToken,expected:200})).data.records;assert.ok(issued.every(code=>list.some(row=>row.operatorCode===code&&row.paired)));assert.ok(list.length>=4);
   assert.equal((await getQr(team.primaryCode==='01004'?'03004SHPEE':'03004')).status,403);
   const original=(await getQr(issued[0]));assert.equal(original.status,201);assert.equal(original.data.operatorCode,issued[0]);assert.equal(original.data.initialPassword,undefined);
  }
  const serialized=JSON.stringify((await db.query('SELECT meta FROM public.audit_logs')).rows);assert.equal(serialized.includes('sc03004'),false);
 });

 await t.test('branch rollout keeps004 old-client QR/counts and admits new PWA while005 annual requires22',async()=>{
  config.scpdaPwaVersionCode=22;
  config.scpdaDailyVersionPolicyJson=JSON.stringify({'004':{accepted:[17,22],qr:[17,22]},'005':{accepted:[17,22],qr:[22]}});
  await db.query("INSERT INTO app_center.releases VALUES('scpda','published',22)");
  await req('/session',{token:parentToken,expected:200});
  assert.equal((await qr(17)).status,409);
  for(const team of teams){
   clock+=61000;
   await req('/session',{token:team.primaryToken,expected:200});
   await req('/counts/history',{token:team.counter,expected:200});
   const c=(await req('/daily/qr/challenge',{token:team.primaryToken,body:{},expected:200})).data;
   const body={target:'new',deviceCertificate:team.primaryCert,versionCode:17,challengeId:c.challengeId};
   body.signature=team.primaryDevice.sign(['SCPDA-COMPANION-QR-V2',c.challengeId,c.nonce,team.primarySession,17,'new'].join('\n'));
   const g=(await req('/daily/qr',{token:team.primaryToken,body,expected:201})).data;
   const d=identity(),enroll={operatorCode:g.operatorCode,grantId:g.grantId,secret:g.secret,publicKey:d.publicKey,deviceId:d.deviceId,versionCode:22,selfie:image,pin:g.initialPassword};
   const signed=version=>({...enroll,versionCode:version,signature:d.sign(['SCPDA-COMPANION-ENROLL-V1',g.grantId,g.secret,d.deviceId,imageHash,version].join('\n'))});
   await req('/daily/companion/enroll',{body:signed(23),expected:409});
   const admitted=(await req('/daily/companion/enroll',{body:signed(22),expected:201})).data;
   assert.equal(admitted.user.countScope.id,team.scope);
   await req('/session',{token:admitted.token,expected:200});
   assert.equal(admitted.user.annualCountAvailable,undefined);
  }
  clock+=61000;
  const sessionId=JSON.parse(Buffer.from(parentToken.split('.')[1],'base64url')).jti;
  const before=(await db.query('SELECT count(*) n FROM ordering.scpda_selfie_archives')).rows[0].n;
  const c=(await req('/daily/resume/challenge',{body:{sessionId},expected:200})).data;
  config.featureScpdaAnnual005=true;
  const upgraded=(await req('/daily/resume',{body:{sessionId,versionCode:22,challengeId:c.challengeId,signature:primary.sign(['SCPDA-DAILY-RESUME-V2',c.challengeId,c.nonce,sessionId,22].join('\n'))},expected:200})).data;
  assert.equal((await db.query('SELECT count(*) n FROM ordering.scpda_selfie_archives')).rows[0].n,before);
  assert.equal(upgraded.expiresAt,'2026-11-19T17:00:00.000Z');
  assert.equal(upgraded.user.annualCountAvailable,true);
  parentToken=upgraded.token;
  assert.equal((await qr(22)).status,201);
  // An allowlisted build must still be published, not merely claimed by the client.
  const {requirePublishedVersion}=require('../apps/admin-api/src/services/scpdaDailyVersions');
  const candidate={...config,scpdaDailyVersionPolicyJson:JSON.stringify({'005':{accepted:[22,23],qr:[22]}})};
  await assert.rejects(requirePublishedVersion(db,candidate,'005',23),{code:'APP_UPDATE_REQUIRED'});
 });

 await t.test('79-of80 annual draft survives midnight; same005 actor resumes next day without a submitted receipt',async()=>{
  for(const file of ['093_add_scpda_annual_count.sql','094_queue_scpda_annual_pages.sql','095_scpda_annual_submission_history.sql'])await db.query(fs.readFileSync('migrations/'+file,'utf8'));
  const eventId=crypto.randomUUID(),items=Array.from({length:80},(_,i)=>({row:i+3,ordinal:i+1,code:'QA-'+i,name:'ยาฝึก'+i,barcode:'QA-'+i,unit:'เม็ด'}));
  await db.query("INSERT INTO ordering.scpda_annual_events(id,branch_code,warehouse_code,label,source_files) VALUES($1,'005','001','Synthetic overnight draft','{}')",[eventId]);
  await db.query("INSERT INTO ordering.scpda_annual_pages(event_id,category,page_no,items,assignee) VALUES($1,'common',1,$2,'01005')",[eventId,JSON.stringify(items)]);
  const counts=Object.fromEntries(items.slice(0,79).map(item=>[item.row,[{quantityMilli:1000},null,null]]));
  const input={eventId,category:'common',pageNo:1,revision:0,mutationId:crypto.randomUUID(),counts,submit:false};
  const saved=(await req('/annual/save',{token:parentToken,body:input,expected:200})).data;
  assert.ok(Number.isFinite(Date.parse(saved.savedAt)));assert.equal(saved.receiptId,null);
  const originalClock=clock;clock+=86400000;
  await req('/annual?view=mine',{token:parentToken,expected:401});
  assert.equal(Object.keys((await db.query('SELECT counts FROM ordering.scpda_annual_pages WHERE event_id=$1',[eventId])).rows[0].counts).length,79);
  const boot=await loginPrimary(),c=(await req('/daily/primary/challenge',{token:boot,body:{},expected:200})).data,jti=JSON.parse(Buffer.from(boot.split('.')[1],'base64url')).jti;
  const nextDay=(await req('/daily/primary/start',{token:boot,body:{deviceCertificate:primary.certificate,selfie:image,versionCode:22,challengeId:c.challengeId,signature:primary.sign(['SCPDA-DAILY-PRIMARY-V1',c.challengeId,c.nonce,jti,imageHash,22].join('\n'))},expected:200})).data;
  const work=(await req('/annual?view=mine',{token:nextDay.token,expected:200})).data;
  assert.equal(work.assigned.countedRows,79);assert.equal(work.assigned.totalRows,80);assert.deepEqual(work.assigned.counts,counts);assert.equal(work.assigned.receiptId,null);
  clock=originalClock;
 });
 await t.test('one installation can hold005 and004 temporary branch accounts without merging their sessions or rights',async()=>{
  clock+=61000;
  grant=(await qr(22)).data;
  const body005={operatorCode:'02005',grantId:grant.grantId,secret:grant.secret,publicKey:child.publicKey,deviceId:child.deviceId,versionCode:22,selfie:image,pin:'fixturePassword'};
  body005.signature=child.sign(['SCPDA-COMPANION-ENROLL-V1',grant.grantId,grant.secret,child.deviceId,imageHash,22].join('\n'));
  const five=(await req('/daily/companion/enroll',{body:body005,expected:201})).data;
  const team=teams[0],q=(await req('/daily/qr/challenge',{token:team.primaryToken,body:{},expected:200})).data;
  const g=(await req('/daily/qr',{token:team.primaryToken,body:{target:'new',deviceCertificate:team.primaryCert,versionCode:17,challengeId:q.challengeId,signature:team.primaryDevice.sign(['SCPDA-COMPANION-QR-V2',q.challengeId,q.nonce,team.primarySession,17,'new'].join('\n'))},expected:201})).data;
  const body004={...body005,operatorCode:g.operatorCode,grantId:g.grantId,secret:g.secret,pin:g.initialPassword};body004.signature=child.sign(['SCPDA-COMPANION-ENROLL-V1',g.grantId,g.secret,child.deviceId,imageHash,22].join('\n'));
  const four=(await req('/daily/companion/enroll',{body:body004,expected:201})).data;
  assert.equal((await req('/session',{token:five.token,expected:200})).data.branchCode,'005');
  assert.equal((await req('/session',{token:four.token,expected:200})).data.branchCode,'004');
  await req('/annual',{token:four.token,expected:403});
  assert.equal((await req('/session',{token:five.token,expected:200})).data.user.countScope,undefined);
  assert.equal((await req('/session',{token:four.token,expected:200})).data.user.countScope.id,'004-front');
 });
 await t.test('004 histories stay team/account scoped; repeated migration preserves evidence and005; midnight denies both teams',async()=>{
  for(const team of teams){const h=(await req('/counts/history',{token:team.counter,expected:200})).data;assert.equal(h.records.length,1);assert.ok(h.records.every(r=>r.event.operatorCode===team.childCode&&r.event.countScopeId===team.scope));}
  const before=(await db.query('SELECT count(*) n FROM ordering.scpda_observations')).rows[0].n;
  await db.query(fs.readFileSync('migrations/092_enable_scpda004_daily_companions.sql','utf8'));
  assert.equal((await db.query('SELECT count(*) n FROM ordering.scpda_observations')).rows[0].n,before);
  assert.equal((await db.query("SELECT count(*) n FROM ordering.scpda_operator_devices WHERE operator_code='02005'")).rows[0].n,'1');
  assert.deepEqual((await db.query('SELECT qty_branch_001,qty_branch_004,qty_branch_005 FROM ada.branch_stock_snapshots')).rows[0],{qty_branch_001:'7',qty_branch_004:'8',qty_branch_005:'11'});
  clock=Date.parse('2026-11-19T17:00:00Z');for(const team of teams){await req('/session',{token:team.token,expected:401});await req('/counts/history',{token:team.counter,expected:401});}
 });
 }finally{await new Promise(ok=>server.close(ok));await db.end();}
});
