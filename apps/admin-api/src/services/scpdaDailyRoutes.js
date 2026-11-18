'use strict';
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const {createDriveArchive}=require('./scpdaSelfieArchive');
const {businessDay,midnight,networkHash,selfie,hash,checkDaily,reject}=require('./scpdaDailyPolicy');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CERT_SECONDS=180*86400;
function keyFor(encoded){
 try{if(typeof encoded!=='string'||encoded.length>1024)throw Error();const key=crypto.createPublicKey({key:Buffer.from(encoded,'base64'),format:'der',type:'spki'});if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw Error();return key;}
 catch{reject(400,'DEVICE_KEY_INVALID','กุญแจเครื่องไม่ถูกต้อง');}
}
function verify(key,message,signature){let ok=false;try{if(typeof signature==='string'&&signature.length<256)ok=crypto.verify('sha256',Buffer.from(message),key,Buffer.from(signature,'base64'));}catch{}if(!ok)reject(401,'DEVICE_PROOF_INVALID','ยืนยันเครื่องไม่สำเร็จ');}
function mountDailyRoutes({router,config,db,settings,now,run,authenticate,deviceFrom,publicUser,envelope,burst,audit}){
 const challenges=new Map();
 function enabled(){if(!config.featureScpdaDaily005)reject(404,'DAILY_DISABLED','ยังไม่เปิดเครื่องย่อย');if(!config.scpdaDriveClientId||!config.scpdaDriveClientSecret||!config.scpdaDriveRefreshToken)reject(503,'DRIVE_NOT_CONNECTED','ยังไม่เชื่อมการเก็บรูปใน Drive');if(!settings.operators.has('02005'))reject(503,'DAILY_UNCONFIGURED','บัญชีเครื่องย่อยยังไม่พร้อม');}
 async function latest(){const r=(await db.query("SELECT version_code FROM app_center.releases WHERE app_id='scpda' AND status='published' ORDER BY version_code DESC LIMIT 1")).rows[0];if(!r||r.version_code!==config.scpdaPwaVersionCode)reject(409,'APP_UPDATE_REQUIRED','ต้องอัปเดต SCPDA ให้เป็นรุ่นเดียวกันก่อน');return r.version_code;}
 function freshChallenge(purpose,identity){for(const [k,v]of challenges)if(v.until<=now())challenges.delete(k);if(challenges.size>=1000)reject(429,'RETRY_LATER','กรุณารอสักครู่');const id=crypto.randomUUID(),nonce=crypto.randomBytes(32).toString('base64url');challenges.set(id,{purpose,identity,nonce,until:now()+60000});return {challengeId:id,nonce};}
 function consume(body,purpose,identity){const c=challenges.get(body.challengeId);challenges.delete(body.challengeId);if(!c||c.until<=now()||c.purpose!==purpose||c.identity!==identity)reject(401,'CHALLENGE_EXPIRED','กรุณาลองใหม่');return c;}
 function sessionReply(row,op){const iat=Math.floor(now()/1000),exp=Math.floor(+new Date(row.expires_at)/1000);return envelope({token:jwt.sign({sub:op.operatorCode,role:'reader',kind:'scpda-reader',branch_code:'005',device_ref:row.device_ref,app_version:row.app_version,cv:op.fingerprint,iat,exp,iss:'sc-stockday',aud:'scpda-read-005',jti:row.session_id},settings.sessionKey,{algorithm:'HS256'}),dailySessionId:row.session_id,expiresAt:new Date(exp*1000).toISOString(),user:publicUser(op,now())},'005');}
 function certReply(row){const iat=Math.floor(now()/1000);return jwt.sign({device_ref:row.device_ref,device_id:row.device_id,public_key:row.public_key,iat,exp:iat+CERT_SECONDS,jti:crypto.randomUUID(),kind:'scpda-device',branch_code:'005',iss:'sc-stockday',aud:'scpda-device-005'},settings.deviceKey,{algorithm:'HS256'});}
 async function insertDaily(client,req,{op,device,primaryId=null,version,image}){
  const date=businessDay(now()),id=crypto.randomUUID(),created=new Date(now()),expiry=new Date(midnight(now()));
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['scpda-daily:'+op.operatorCode+':'+device.device_ref]);
  const prior=(await client.query('SELECT * FROM ordering.scpda_daily_sessions WHERE operator_code=$1 AND device_ref=$2 AND business_date=$3 AND revoked_at IS NULL FOR UPDATE',[op.operatorCode,device.device_ref,date])).rows[0];
  if(prior){
   // A retry keeps the first image and session for this device/day.
   if(prior.revoked_at||prior.credential_version!==op.fingerprint)reject(409,'DAILY_SESSION_REVOKED','เซสชันวันนี้ถูกยกเลิกแล้ว ติดต่อผู้ดูแล');
   if(prior.app_version!==version||primaryId&&prior.primary_session_id!==primaryId){await client.query('UPDATE ordering.scpda_daily_sessions SET app_version=$2,primary_session_id=$3 WHERE session_id=$1',[prior.session_id,version,primaryId]);prior.app_version=version;prior.primary_session_id=primaryId;}return prior;
  }
  const queued=Number((await client.query("SELECT coalesce(sum(octet_length(image_bytes)),0) AS n FROM ordering.scpda_selfie_archives WHERE state='pending'")).rows[0].n);if(queued+image.bytes.length>16*1024*1024)reject(503,'SELFIE_ARCHIVE_FULL','ระบบเก็บรูปรอส่งเต็ม ติดต่อผู้ดูแล');
  const row=(await client.query(`INSERT INTO ordering.scpda_daily_sessions(session_id,operator_code,branch_code,device_ref,device_id,public_key,business_date,primary_session_id,network_hash,app_version,credential_version,created_at,expires_at)
   VALUES($1,$2,'005',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[id,op.operatorCode,device.device_ref,device.device_id,device.public_key,date,primaryId,networkHash(req,config.authJwtSecret),version,op.fingerprint,created,expiry])).rows[0];
  const local=new Date(now()+7*3600000).toISOString().replace(/[-:]/g,'').slice(0,15);
  await client.query(`INSERT INTO ordering.scpda_selfie_archives(session_id,image_bytes,image_sha256,file_name,created_at,delete_after)
   VALUES($1,$2,$3,$4,$5,$6)`,[id,image.bytes,image.sha256,local+'_005_'+op.operatorCode+'_'+id+'_selfie.jpg',created,new Date(now()+90*86400000)]);
  await audit(client,req,{actor:op.operatorCode,action:'scpda.daily_login',targetType:'scpda_session',targetId:id,meta:{deviceRef:device.device_ref,primarySessionId:primaryId,expiresAt:expiry.toISOString(),selfieRetentionDays:90}});
  return row;
 }
 async function transaction(fn){const client=await db.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 router.get('/daily/policy',run(async(req,res)=>{
  res.json(envelope({enabled:config.featureScpdaDaily005===true,operatorCode:'02005',primaryOperatorCode:'01005',versionCode:config.scpdaPwaVersionCode,networkPolicy:'same-public-ip-with-primary-qr',timezone:'Asia/Bangkok',resetAt:'00:00',selfieRetentionDays:90},'005'));
 }));
 router.post('/daily/primary/challenge',run(async(req,res)=>{enabled();burst(req);const who=await authenticate(req,{bootstrap:true});if(who.operator.operatorCode!=='01005')reject(403,'PRIMARY_REQUIRED','ใช้เครื่องหลักของสาขา 005');res.json(envelope(freshChallenge('primary',who.claims.jti),'005'));}));
 router.post('/daily/primary/start',run(async(req,res)=>{
  enabled();burst(req);const who=await authenticate(req,{bootstrap:true}),body=req.body;
  if(who.operator.operatorCode!=='01005')reject(403,'PRIMARY_REQUIRED','ใช้เครื่องหลักของสาขา 005');
  const d=deviceFrom(body.deviceCertificate);if(d.device_ref!==who.claims.device_ref||d.branch_code!=='005')reject(401,'DEVICE_PROOF_INVALID','เครื่องไม่ตรงกัน');
  const image=selfie(body.selfie),c=consume(body,'primary',who.claims.jti);
  if(body.versionCode!==await latest())reject(409,'APP_UPDATE_REQUIRED','อัปเดตเครื่องหลักก่อน');
  verify(keyFor(d.public_key),['SCPDA-DAILY-PRIMARY-V1',body.challengeId,c.nonce,who.claims.jti,image.sha256,body.versionCode].join('\n'),body.signature);
  req.scpdaBranchCode='005';const row=await transaction(client=>insertDaily(client,req,{op:who.operator,device:d,version:body.versionCode,image}));res.json(sessionReply(row,who.operator));
 }));
 router.post('/daily/qr/challenge',run(async(req,res)=>{enabled();burst(req);const who=await authenticate(req);if(who.operator.operatorCode!=='01005')reject(403,'PRIMARY_REQUIRED','ใช้เครื่องหลักของสาขา 005');res.json(envelope(freshChallenge('qr',who.claims.jti),'005'));}));
 router.post('/daily/qr',run(async(req,res)=>{
  enabled();burst(req);const who=await authenticate(req),body=req.body;if(who.operator.operatorCode!=='01005')reject(403,'PRIMARY_REQUIRED','ใช้เครื่องหลักของสาขา 005');const d=deviceFrom(body.deviceCertificate);if(d.device_ref!==who.claims.device_ref)reject(401,'DEVICE_PROOF_INVALID','เครื่องไม่ตรงกัน');
  const c=consume(body,'qr',who.claims.jti),version=await latest();if(body.versionCode!==version)reject(409,'APP_UPDATE_REQUIRED','อัปเดตเครื่องหลักก่อนสร้าง QR');
  verify(keyFor(d.public_key),['SCPDA-COMPANION-QR-V1',body.challengeId,c.nonce,who.claims.jti,version].join('\n'),body.signature);
  const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url'),until=new Date(Math.min(now()+120000,midnight(now())));
  await transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['scpda-qr:'+who.claims.jti]);
   await client.query('UPDATE ordering.scpda_companion_grants SET expires_at=$2 WHERE primary_session_id=$1 AND consumed_session_id IS NULL AND expires_at>$2',[who.claims.jti,new Date(now())]);
   await client.query('INSERT INTO ordering.scpda_companion_grants(grant_id,secret_hash,primary_session_id,operator_code,app_version,created_at,expires_at) VALUES($1,$2,$3,\'02005\',$4,$5,$6)',[id,hash(secret),who.claims.jti,version,new Date(now()),until]);
   await audit(client,req,{actor:'01005',action:'scpda.companion_qr_created',targetType:'scpda_grant',targetId:id,meta:{expiresAt:until.toISOString()}});
  });
  // Fragment stays out of HTTP request/access logs; GET never consumes a grant.
  res.status(201).json(envelope({grantId:id,secret,expiresAt:until.toISOString(),versionCode:version,url:config.scpdaPwaOrigin+'/scpda/#enroll='+id+'.'+secret},'005'));
 }));
 router.post('/daily/companion/enroll',run(async(req,res)=>{
  enabled();burst(req);const body=req.body,op=settings.operators.get('02005');keyFor(body.publicKey);if(!UUID.test(body.deviceId||'')||!UUID.test(body.grantId||'')||typeof body.secret!=='string'||body.secret.length>100||typeof body.pin!=='string'||body.pin.length>64)reject(400,'ENROLLMENT_INVALID','ข้อมูลลงทะเบียนไม่ถูกต้อง');
  const ref=hash(Buffer.from(body.publicKey,'base64')),image=selfie(body.selfie);if(settings.revoked.has(ref))reject(403,'DEVICE_REVOKED','เครื่องนี้ถูกยกเลิกแล้ว');
  const version=await latest();if(body.versionCode!==version)reject(409,'APP_UPDATE_REQUIRED','เปิดเว็บแอปรุ่นล่าสุดก่อน');
  // The QR secret is a challenge to the installation key, not a bearer login.
  verify(keyFor(body.publicKey),['SCPDA-COMPANION-ENROLL-V1',body.grantId,body.secret,body.deviceId,image.sha256,version].join('\n'),body.signature);
  req.scpdaBranchCode='005';const row=await transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['scpda-login:02005']);
   const attempts=(await client.query("SELECT count(*)::integer n FROM public.audit_logs WHERE actor_id='scpda:02005' AND action='scpda.login_failed' AND event_time>clock_timestamp()-interval '15 minutes'")).rows[0];if(attempts.n>=5)reject(429,'PIN_LOCKED','กรอกรหัสผิดหลายครั้ง กรุณารอ 15 นาที');
   const grant=(await client.query('SELECT * FROM ordering.scpda_companion_grants WHERE grant_id=$1 FOR UPDATE',[body.grantId])).rows[0];
   if(!grant||hash(body.secret)!==grant.secret_hash)reject(401,'QR_INVALID','QR ไม่ถูกต้อง');
   if(+new Date(grant.expires_at)<=now())reject(410,'QR_EXPIRED','QR หมดอายุ สร้างใหม่จากเครื่องหลัก');
   if(grant.app_version!==version)reject(409,'APP_UPDATE_REQUIRED','สร้าง QR ด้วยแอปรุ่นล่าสุด');
   if(!await bcrypt.compare(body.pin,op.hash)){
    // Commit failure evidence without consuming QR or claiming the binding.
    await audit(client,req,{actor:'02005',action:'scpda.login_failed',targetType:'scpda_grant',targetId:body.grantId,success:false});return null;
   }
   const primary=(await client.query('SELECT * FROM ordering.scpda_daily_sessions WHERE session_id=$1 FOR SHARE',[grant.primary_session_id])).rows[0];
   if(!primary||primary.operator_code!=='01005'||primary.revoked_at||+new Date(primary.expires_at)<=now()||primary.network_hash!==networkHash(req,config.authJwtSecret))reject(403,'STORE_NETWORK_REQUIRED','เชื่อม Wi-Fi ร้านเดียวกับเครื่องหลัก');
   if(grant.consumed_session_id){if(grant.consumed_device_ref!==ref)reject(409,'QR_USED','QR นี้ใช้ไปแล้ว');const old=(await client.query('SELECT * FROM ordering.scpda_daily_sessions WHERE session_id=$1',[grant.consumed_session_id])).rows[0];if(!old||old.revoked_at||old.credential_version!==op.fingerprint||old.device_id!==body.deviceId)reject(409,'QR_USED','QR นี้ใช้ไปแล้ว');return old;}
   const binding=(await client.query("SELECT * FROM ordering.scpda_operator_devices WHERE operator_code='02005' FOR UPDATE")).rows[0];
   if(binding&&(binding.revoked_at||binding.device_ref!==ref||binding.device_id!==body.deviceId))reject(409,'OPERATOR_ALREADY_BOUND','02005 ผูกกับเครื่องอื่นแล้ว ติดต่อผู้ดูแล');
   if(!binding)await client.query("INSERT INTO ordering.scpda_operator_devices(operator_code,branch_code,device_ref,device_id,public_key) VALUES('02005','005',$1,$2,$3)",[ref,body.deviceId,body.publicKey]);
   const fresh=await insertDaily(client,req,{op,device:{device_ref:ref,device_id:body.deviceId,public_key:body.publicKey},primaryId:primary.session_id,version,image});
   await client.query('UPDATE ordering.scpda_companion_grants SET consumed_session_id=$2,consumed_device_ref=$3 WHERE grant_id=$1',[body.grantId,fresh.session_id,ref]);return fresh;
  });
  if(!row)reject(401,'LOGIN_REJECTED','รหัสผ่านไม่ถูกต้อง');res.status(201).json({...sessionReply(row,op),deviceCertificate:certReply(row)});
 }));
 router.get('/daily/selfie',run(async(req,res)=>{
  enabled();const who=await authenticate(req);const row=(await db.query('SELECT * FROM ordering.scpda_selfie_archives WHERE session_id=$1',[who.claims.jti])).rows[0];
  if(!row||row.state==='deleted')reject(404,'SELFIE_NOT_FOUND','ไม่พบรูปของเซสชันนี้');
  const bytes=row.image_bytes||await createDriveArchive(config).get(row);if(hash(bytes)!==row.image_sha256)reject(503,'SELFIE_UNAVAILABLE','ยังอ่านรูปไม่ได้');
  res.json(envelope({image:'data:image/jpeg;base64,'+bytes.toString('base64')},'005'));
 }));
 router.post('/daily/resume/challenge',run(async(req,res)=>{enabled();burst(req);if(!UUID.test(req.body.sessionId||''))reject(401,'DAILY_LOGIN_REQUIRED','เข้าสู่ระบบสำหรับวันนี้');res.json(envelope(freshChallenge('resume',req.body.sessionId),'005'));}));
 router.post('/daily/resume',run(async(req,res)=>{
  enabled();burst(req);const body=req.body,c=consume(body,'resume',body.sessionId);
  if(!UUID.test(body.sessionId||''))reject(401,'DAILY_LOGIN_REQUIRED','เข้าสู่ระบบสำหรับวันนี้');
  const row=(await db.query('SELECT * FROM ordering.scpda_daily_sessions WHERE session_id=$1',[body.sessionId])).rows[0];
  if(!row)reject(401,'DAILY_LOGIN_REQUIRED','เข้าสู่ระบบสำหรับวันนี้');const op=settings.operators.get(row.operator_code);if(!op||settings.revoked.has(row.device_ref))reject(401,'DEVICE_REVOKED','เครื่องนี้ถูกยกเลิกแล้ว');
  verify(keyFor(row.public_key),['SCPDA-DAILY-RESUME-V1',body.challengeId,c.nonce,body.sessionId].join('\n'),body.signature);
  const claims={jti:row.session_id,sub:row.operator_code,device_ref:row.device_ref,app_version:row.app_version,cv:op.fingerprint};
  await checkDaily({config,db,req,claims,now:now()});
  if((await db.query("SELECT 1 FROM public.audit_logs WHERE action='scpda.logout' AND target_type='scpda_session' AND target_id=$1 AND success=TRUE LIMIT 1",[row.session_id])).rows.length)reject(401,'SESSION_ENDED','ออกจากระบบแล้ว');
  // Refreshes only this day's capability; never extends the midnight expiry.
  res.json({...sessionReply(row,op),...(row.operator_code==='02005'?{deviceCertificate:certReply(row)}:{})});
 }));
}
module.exports={mountDailyRoutes};
