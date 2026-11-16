"use strict";
const {Router}=require('express');
const multer=require('multer');
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
const {pipeline}=require('node:stream/promises');
const {requireAuth,requireRole,requireCsrf}=require('../auth/middleware');
const {branchEnabled}=require('../services/scpdaBranches');
const {createAppCenter,dto}=require('../services/appCenter');
const {MAX_APK}=require('../services/appCenterApk');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function createAppCenterRouter({config,db,service=createAppCenter({config,db}),now=Date.now}) {
  const router=Router(),challenges=new Map(),bursts=new Map();
  const key=label=>crypto.createHmac('sha256',config.authJwtSecret).update(label).digest('base64url');
  const ticketKey=()=>key('sc-app-center:download-v1');
  const deny=(status,message)=>{throw Object.assign(Error(message),{status});};
  const run=fn=>async(req,res,next)=>{try{res.set('Cache-Control','private, no-store');await fn(req,res);}catch(e){if(res.headersSent)return res.destroy();if(e instanceof multer.MulterError)return res.status(400).json({error:'ไฟล์ APK ต้องมีขนาดไม่เกิน 16 MB'});res.status(e.status||503).json({error:e.status?e.message:'SC App Center ยังไม่พร้อม กรุณาลองใหม่'});}};
  function limit(req){const t=now();for(const [k,r] of bursts)if(r.until<t)bursts.delete(k);const ip=req.ip||'unknown',r=bursts.get(ip)||{n:0,until:t+60000};if(++r.n>60||bursts.size>=5000&&!bursts.has(ip))deny(429,'ลองหลายครั้ง กรุณารอสักครู่');bursts.set(ip,r);}
  function device(raw){if(!config.featureScpdaRead001||typeof raw!=='string'||raw.length>8192)deny(401,'เชื่อมเครื่อง SCPDA ก่อนตรวจอัปเดต');let d;try{d=jwt.verify(raw,key('scpda:device-certificate-v1'),{algorithms:['HS256'],issuer:'sc-stockday',audience:['scpda-device-001','scpda-device-005'],clockTimestamp:Math.floor(now()/1000)});}catch{deny(401,'ใบเชื่อมเครื่องหมดอายุหรือไม่ถูกต้อง');}
    const revoked=JSON.parse(config.scpdaRevokedDeviceRefsJson||'[]');if(d.kind!=='scpda-device'||!branchEnabled(config,d.branch_code)||d.aud!=='scpda-device-'+d.branch_code||!UUID.test(d.device_id||'')||revoked.includes(d.device_ref)||typeof d.public_key!=='string'||d.public_key.length>2048||crypto.createHash('sha256').update(Buffer.from(d.public_key,'base64')).digest('hex')!==d.device_ref)deny(401,'เครื่องนี้ไม่ได้รับอนุญาต');return d;}
  const downloadPath=row=>'/api/app-center/releases/'+row.release_id+'/apk?ticket='+jwt.sign({kind:'appcenter-download',rid:row.release_id,sha:row.sha256},ticketKey(),{algorithm:'HS256',issuer:'sc-stockday',audience:'appcenter-apk',expiresIn:600});
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_APK,files:1,fields:1,fieldSize:32000}}).single('apk');
  const readUpload=(req,res,next)=>upload(req,res,e=>e?run(async()=>{throw e;})(req,res,next):next());
  const saveUpload=run(async(req,res)=>{if(!req.file)deny(400,'เลือกไฟล์ APK');res.status(201).json(await service.upload(req.auth.userId,req.file.buffer,req.body.notes));});
  const publisher=(req,res,next)=>{const token=config.appCenterPublisherToken,provided=String(req.headers.authorization||'').replace(/^Bearer /,'');if(typeof token!=='string'||token.length<32)return res.sendStatus(404);if(Buffer.byteLength(provided)!==Buffer.byteLength(token)||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(provided)))return res.sendStatus(401);req.auth={userId:'system:scpda-build',role:'publisher'};next();};
  router.post('/publisher/releases',publisher,readUpload,saveUpload);
  router.post('/publisher/releases/:id/publish',publisher,run(async(req,res)=>{if(!UUID.test(req.params.id))deny(400,'เลขรุ่นไม่ถูกต้อง');res.json({release:await service.transition(req.auth.userId,req.params.id,req.body,true)});}));
  router.post('/device/challenge',run(async(req,res)=>{limit(req);const d=device(req.body.deviceCertificate),t=now();for(const [id,c]of challenges)if(c.expires<t)challenges.delete(id);if(challenges.size>=1000)deny(429,'กรุณารอสักครู่');const id=crypto.randomUUID(),nonce=crypto.randomBytes(32).toString('base64url');challenges.set(id,{ref:d.device_ref,id:d.device_id,nonce,expires:t+60000});res.json({contract:'sc-app-center-v1',challengeId:id,nonce,deviceRef:d.device_ref});}));
  router.post('/device/check',run(async(req,res)=>{limit(req);const d=device(req.body.deviceCertificate),c=challenges.get(req.body.challengeId);challenges.delete(req.body.challengeId);const code=req.body.installedVersionCode;if(!Number.isSafeInteger(code)||code<1||code>2147483647)deny(400,'เลขรุ่นไม่ถูกต้อง');if(!c||c.expires<now()||c.ref!==d.device_ref||c.id!==d.device_id||typeof req.body.signature!=='string'||req.body.signature.length>1024)deny(401,'คำขอตรวจอัปเดตหมดอายุ');
    let ok=false;try{const publicKey=crypto.createPublicKey({key:Buffer.from(d.public_key,'base64'),format:'der',type:'spki'});if(publicKey.asymmetricKeyType!=='ec'||!['prime256v1','P-256'].includes(publicKey.asymmetricKeyDetails?.namedCurve))throw Error();ok=crypto.verify('sha256',Buffer.from('SC-APP-CENTER-V1\n'+req.body.challengeId+'\n'+c.nonce+'\n'+d.device_ref+'\n'+code),publicKey,Buffer.from(req.body.signature,'base64'));}catch{}if(!ok)deny(401,'ยืนยันเครื่องไม่สำเร็จ');const row=await service.latest();res.json({contract:'sc-app-center-v1',app:service.app,release:dto(row),updateAvailable:!!row&&row.version_code>code,downloadPath:row&&row.version_code>code?downloadPath(row):null});}));
  router.get('/releases/:id/apk',run(async(req,res)=>{limit(req);if(!UUID.test(req.params.id)||typeof req.query.ticket!=='string'||req.query.ticket.length>2048)deny(401,'ลิงก์ดาวน์โหลดไม่ถูกต้อง');let t;try{t=jwt.verify(req.query.ticket,ticketKey(),{algorithms:['HS256'],issuer:'sc-stockday',audience:'appcenter-apk',clockTimestamp:Math.floor(now()/1000)});}catch{deny(401,'ลิงก์ดาวน์โหลดหมดอายุ กรุณาลองใหม่');}if(t.kind!=='appcenter-download'||t.rid!==req.params.id)deny(401,'ลิงก์ดาวน์โหลดไม่ตรงกัน');const r=await service.artifact(t.rid,t.sha);if(Number(r.object.ContentLength)!==r.size_bytes)deny(503,'ไฟล์แอปยังไม่พร้อม');res.set({'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="SCPDA-'+r.version_name.replace(/[^a-zA-Z0-9._-]/g,'_')+'.apk"','Content-Length':String(r.size_bytes),'X-Content-Type-Options':'nosniff'});await pipeline(r.object.Body,res);}));
  router.use(requireAuth(config));
  router.get('/',run(async(req,res)=>res.json(await service.catalog(req.auth.role==='admin'))));
  router.post('/releases/:id/download',requireCsrf,run(async(req,res)=>{if(!UUID.test(req.params.id))deny(400,'เลขรุ่นไม่ถูกต้อง');const row=await service.published(req.params.id);res.json({downloadPath:downloadPath(row)});}));
  router.use(requireRole('admin'),requireCsrf);
  router.post('/releases',readUpload,saveUpload);
  for(const action of ['publish','withdraw'])router.post('/releases/:id/'+action,run(async(req,res)=>{if(!UUID.test(req.params.id))deny(400,'เลขรุ่นไม่ถูกต้อง');res.json({release:await service.transition(req.auth.userId,req.params.id,req.body,action==='publish')});}));
  return router;
}
module.exports={createAppCenterRouter};
