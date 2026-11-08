"use strict";
// Dedicated branch-001 readers. No web/mobile session privileges, count writer,
// inventory mutation, staff impersonation or schema changes.
const {Router}=require('express');
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const {queryProducts,queryProductDetail,buildFiltersFromQuery}=require('./products');
const CONTRACT='scpda-read-001-v1', CODES=['01001','02001','03001'];
const ISSUER='sc-stockday', DEVICE_AUD='scpda-device-001', SESSION_AUD='scpda-read-001';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class AccessError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new AccessError(status,code,message);};
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
function same(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function fields(body,keys){if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!keys.includes(k)))fail(400,'FIELDS_INVALID','ข้อมูลคำขอไม่ถูกต้อง');}
function string(value,max){if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'FIELD_INVALID','ข้อมูลคำขอไม่ถูกต้อง');return value.trim();}
function parseConfig(config){
 if(typeof config.authJwtSecret!=='string'||config.authJwtSecret.length<16)throw Error('Server signing key unavailable');
 const derive=label=>crypto.createHmac('sha256',config.authJwtSecret).update('scpda:'+label).digest('base64url');
 const sessionKey=derive('reader-session-v1'),deviceKey=derive('device-certificate-v1');
 const list=JSON.parse(config.scpdaOperatorCredentialsJson||'null');
 if(!Array.isArray(list)||list.length!==3)throw Error('Three operator records required');
 const operators=new Map();
 for(const r of list){if(!CODES.includes(r.operatorCode)||operators.has(r.operatorCode)||!/^\$2[aby]\$(12|13|14)\$[./A-Za-z0-9]{53}$/.test(r.hash||'')||!UUID.test(r.version||'')||!Number.isFinite(Date.parse(r.rotationDueAt)))throw Error('Invalid operator configuration');operators.set(r.operatorCode,{...r,fingerprint:crypto.createHmac('sha256',sessionKey).update(r.operatorCode+':'+r.hash+':'+r.version).digest('hex')});}
 const invitations=JSON.parse(config.scpdaDeviceInvitationsJson||'[]');if(!Array.isArray(invitations)||invitations.length>20)throw Error('Invalid invitation list');
 for(const i of invitations)if(!UUID.test(i.id||'')||!/^[a-f0-9]{64}$/.test(i.hash||'')||!Number.isFinite(Date.parse(i.expiresAt))||i.certificateTtlSeconds!==undefined&&(!Number.isInteger(i.certificateTtlSeconds)||i.certificateTtlSeconds<60||i.certificateTtlSeconds>180*86400))throw Error('Invalid invitation');
 const revoked=JSON.parse(config.scpdaRevokedDeviceRefsJson||'[]');if(!Array.isArray(revoked)||revoked.some(r=>!/^[a-f0-9]{64}$/.test(r)))throw Error('Invalid revocations');
 return {sessionKey,deviceKey,operators,invitations,revoked:new Set(revoked)};
}
function publicUser(operator,now){return {id:operator.operatorCode,operatorCode:operator.operatorCode,role:'reader',branchCode:'001',rotationDueAt:operator.rotationDueAt,rotationDue:Date.parse(operator.rotationDueAt)<=now};}
function publicProduct(p){return {sku_id:p.sku_id,company_code:p.company_code,display_name:p.display_name,
 barcodes:(p.barcodes||[]).map(b=>({barcode:b.barcode,is_primary:b.is_primary})),
 unit_prices:(p.unit_prices||[]).map(u=>({unit:u.unit,retail_price:u.retail_price,currency:u.currency,updated_at:u.updated_at,source_updated_at:u.source_updated_at})),
 retail_price:p.retail_price?{price:p.retail_price.price,currency:p.retail_price.currency,updated_at:p.retail_price.updated_at}:null};}
function publicKey(encoded){if(typeof encoded!=='string'||encoded.length>2048||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail(400,'DEVICE_KEY_INVALID','กุญแจเครื่องไม่ถูกต้อง');try{const key=crypto.createPublicKey({key:Buffer.from(encoded,'base64'),format:'der',type:'spki'});if(key.asymmetricKeyType!=='ec'||!['prime256v1','P-256'].includes(key.asymmetricKeyDetails?.namedCurve))throw Error();return key;}catch{fail(400,'DEVICE_KEY_INVALID','กุญแจเครื่องไม่ถูกต้อง');}}
function createScpdaReadRouter({config,db,now=Date.now}){
 const router=Router();let settings=null;
 if(config.featureScpdaRead001)try{settings=parseConfig(config);}catch{/* Only this default-off surface fails closed. */}
 const challenges=new Map(),bursts=new Map();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!config.featureScpdaRead001)return res.status(404).json({error:'SCPDA access is not enabled',code:'SCPDA_DISABLED'});if(!settings)return res.status(503).json({error:'SCPDA configuration is unavailable',code:'SCPDA_UNCONFIGURED'});next();});
 const run=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){const known=e instanceof AccessError;res.status(known?e.status:503).json({error:known?e.message:'ระบบ SCPDA ยังไม่พร้อม กรุณาลองใหม่',code:known?e.code:'SCPDA_UNAVAILABLE'});}};
 const envelope=data=>({contract:CONTRACT,branchCode:'001',...data});
 function burst(req){const t=now();for(const [k,r]of bursts)if(r.until<=t)bursts.delete(k);const key=req.ip||'unknown',row=bursts.get(key)||{n:0,until:t+60000};if(bursts.size>=5000&&!bursts.has(key)||++row.n>30)fail(429,'RETRY_LATER','ลองหลายครั้ง กรุณารอสักครู่');bursts.set(key,row);}
 async function audit(client,req,{actor='device',action,targetType,targetId,success=true,meta={}}){await client.query(`INSERT INTO public.audit_logs(actor_role,actor_id,action,target_type,target_id,success,meta,request_id,ip,user_agent)
 VALUES('system',$1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,['scpda:'+actor,action,targetType,targetId,success,JSON.stringify({branchCode:'001',...meta}),req.requestId||null,req.ip||null,String(req.headers['user-agent']||'').slice(0,1024)]);}
 function certificate(claims){return jwt.sign({device_ref:claims.device_ref,device_id:claims.device_id,public_key:claims.public_key,iat:claims.iat,exp:claims.exp,jti:claims.jti,kind:'scpda-device',branch_code:'001',iss:ISSUER,aud:DEVICE_AUD},settings.deviceKey,{algorithm:'HS256'});}
 function deviceFrom(raw){let d;try{d=jwt.verify(string(raw,8192),settings.deviceKey,{algorithms:['HS256'],issuer:ISSUER,audience:DEVICE_AUD,clockTimestamp:Math.floor(now()/1000)});}catch{fail(401,'DEVICE_CERT_INVALID','ต้องเชื่อมเครื่องกับ SCPDA ก่อน');}
  if(d.kind!=='scpda-device'||d.branch_code!=='001'||!/^[a-f0-9]{64}$/.test(d.device_ref||'')||!UUID.test(d.device_id||'')||settings.revoked.has(d.device_ref)||digest(Buffer.from(d.public_key||'','base64'))!==d.device_ref)fail(401,'DEVICE_CERT_INVALID','เครื่องนี้ไม่ได้รับอนุญาต');publicKey(d.public_key);return d;}
 async function authenticate(req){let token=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_.-]{1,8192})$/)?.[1],p;
  try{p=jwt.verify(token||'',settings.sessionKey,{algorithms:['HS256'],issuer:ISSUER,audience:SESSION_AUD,clockTimestamp:Math.floor(now()/1000)});}catch{fail(401,'LOGIN_REQUIRED','เข้าสู่ระบบ SCPDA อีกครั้ง');}
  const op=settings.operators.get(p.sub);if(!op||p.kind!=='scpda-reader'||p.branch_code!=='001'||p.role!=='reader'||p.cv!==op.fingerprint||!UUID.test(p.jti||'')||settings.revoked.has(p.device_ref))fail(401,'LOGIN_REQUIRED','เข้าสู่ระบบ SCPDA อีกครั้ง');
  const blocked=await db.query("SELECT 1 FROM public.audit_logs WHERE action='scpda.logout' AND target_type='scpda_session' AND target_id=$1 AND success=TRUE LIMIT 1",[p.jti]);if(blocked.rows.length)fail(401,'SESSION_ENDED','ออกจากระบบแล้ว กรุณาใส่ PIN อีกครั้ง');return {claims:p,operator:op};
 }
 router.post('/device/pair',run(async(req,res)=>{burst(req);fields(req.body,['invitationId','code','publicKey','deviceId']);const {invitationId,code,deviceId}=req.body,key=string(req.body.publicKey,2048);if(!UUID.test(deviceId||''))fail(400,'DEVICE_ID_INVALID','รหัสเครื่องไม่ถูกต้อง');publicKey(key);const invitation=settings.invitations.find(i=>i.id===invitationId);if(!invitation||!same(digest(string(code,200)),invitation.hash))fail(401,'INVITATION_INVALID','ไฟล์เชื่อมเครื่องไม่ถูกต้อง');if(Date.parse(invitation.expiresAt)<=now())fail(410,'INVITATION_EXPIRED','ไฟล์เชื่อมเครื่องหมดอายุแล้ว');const ref=digest(Buffer.from(key,'base64'));if(settings.revoked.has(ref))fail(403,'DEVICE_REVOKED','เครื่องนี้ถูกยกเลิกแล้ว');
  const client=await db.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['scpda-invitation:'+invitationId]);const prior=(await client.query("SELECT meta FROM public.audit_logs WHERE action='scpda.device_paired' AND target_type='scpda_invitation' AND target_id=$1 AND success=TRUE ORDER BY audit_id LIMIT 1",[invitationId])).rows[0];let claims;
   if(prior){claims=prior.meta.claims;if(claims?.device_ref!==ref||claims?.device_id!==deviceId)fail(409,'INVITATION_USED','ไฟล์นี้เชื่อมกับเครื่องอื่นแล้ว');}
   else{const issued=Math.floor(now()/1000);claims={device_ref:ref,device_id:deviceId,public_key:key,iat:issued,exp:issued+(invitation.certificateTtlSeconds||180*86400),jti:crypto.randomUUID()};await audit(client,req,{action:'scpda.device_paired',targetType:'scpda_invitation',targetId:invitationId,meta:{claims}});}
   await client.query('COMMIT');res.status(prior?200:201).json(envelope({deviceCertificate:certificate(claims),deviceRef:ref,expiresAt:new Date(claims.exp*1000).toISOString(),replayed:Boolean(prior)}));
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }));
 router.post('/auth/challenge',run(async(req,res)=>{burst(req);fields(req.body,['deviceCertificate']);const d=deviceFrom(req.body.deviceCertificate),t=now();for(const [k,c]of challenges)if(c.until<=t)challenges.delete(k);if(challenges.size>=1000)fail(429,'RETRY_LATER','กรุณาลองใหม่');const id=crypto.randomUUID(),nonce=crypto.randomBytes(32).toString('base64url');challenges.set(id,{nonce,ref:d.device_ref,until:t+60000});res.json(envelope({challengeId:id,nonce,deviceRef:d.device_ref,expiresAt:new Date(t+60000).toISOString()}));}));
 router.post('/auth/login',run(async(req,res)=>{burst(req);fields(req.body,['operatorCode','pin','deviceCertificate','challengeId','signature']);const d=deviceFrom(req.body.deviceCertificate),{operatorCode,pin,challengeId,signature}=req.body,c=challenges.get(challengeId);challenges.delete(challengeId);
  if(!c||c.until<=now()||c.ref!==d.device_ref||!CODES.includes(operatorCode)||typeof pin!=='string'||!/^\d{4}$/.test(pin)||typeof signature!=='string'||signature.length>256)fail(401,'LOGIN_REJECTED','รหัสผู้ใช้งานหรือ PIN ไม่ถูกต้อง');const message='SCPDA-LOGIN-V1\n'+challengeId+'\n'+c.nonce+'\n'+operatorCode+'\n'+d.device_ref;
  if(!crypto.verify('sha256',Buffer.from(message),publicKey(d.public_key),Buffer.from(signature,'base64')))fail(401,'DEVICE_PROOF_INVALID','ยืนยันเครื่องไม่สำเร็จ กรุณาลองใหม่');const op=settings.operators.get(operatorCode),client=await db.connect();let rejected=false,sessionId;
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['scpda-login:'+operatorCode]);const attempts=(await client.query(`SELECT count(*)::integer AS n FROM public.audit_logs WHERE action='scpda.login_failed' AND actor_id=$1 AND event_time>greatest(clock_timestamp()-interval '15 minutes',coalesce((SELECT max(event_time) FROM public.audit_logs WHERE action='scpda.login_success' AND actor_id=$1),'-infinity'::timestamptz))`,['scpda:'+operatorCode])).rows[0];if(attempts.n>=5)fail(429,'PIN_LOCKED','ใส่ PIN ผิดหลายครั้ง กรุณารอ 15 นาที');
   if(!await bcrypt.compare(pin,op.hash)){rejected=true;await audit(client,req,{actor:operatorCode,action:'scpda.login_failed',targetType:'scpda_device',targetId:d.device_ref,success:false});}
   else{sessionId=crypto.randomUUID();await audit(client,req,{actor:operatorCode,action:'scpda.login_success',targetType:'scpda_session',targetId:sessionId,meta:{deviceRef:d.device_ref}});}await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  if(rejected)fail(401,'LOGIN_REJECTED','รหัสผู้ใช้งานหรือ PIN ไม่ถูกต้อง');const issued=Math.floor(now()/1000),expires=Math.min(issued+8*3600,d.exp);
  const token=jwt.sign({sub:operatorCode,role:'reader',kind:'scpda-reader',branch_code:'001',device_ref:d.device_ref,cv:op.fingerprint,iat:issued,exp:expires,iss:ISSUER,aud:SESSION_AUD,jti:sessionId},settings.sessionKey,{algorithm:'HS256'});res.json(envelope({token,expiresAt:new Date(expires*1000).toISOString(),user:publicUser(op,now())}));
 }));
 router.get('/session',run(async(req,res)=>{const who=await authenticate(req);res.json(envelope({user:publicUser(who.operator,now()),officialStockWrites:false,countSubmissionAvailable:false}));}));
 router.post('/auth/logout',run(async(req,res)=>{const who=await authenticate(req);await audit(db,req,{actor:who.operator.operatorCode,action:'scpda.logout',targetType:'scpda_session',targetId:who.claims.jti,meta:{deviceRef:who.claims.device_ref}});res.json(envelope({ok:true}));}));
 router.get('/products',run(async(req,res)=>{await authenticate(req);if(Object.keys(req.query).some(k=>!['keyword','limit','offset'].includes(k)))fail(400,'QUERY_INVALID','ข้อมูลค้นหาไม่ถูกต้อง');if(req.query.limit!==undefined&&req.query.limit!=='200'||req.query.offset!==undefined&&req.query.offset!=='0')fail(400,'QUERY_INVALID','ขนาดหน้าข้อมูลไม่ถูกต้อง');const filters=buildFiltersFromQuery({keyword:string(req.query.keyword,200),limit:200,offset:0}),r=await queryProducts(db,filters);res.json(envelope({ok:true,total:r.total,limit:r.limit,offset:r.offset,rows:r.rows.map(p=>({sku_id:p.sku_id,company_code:p.company_code,display_name:p.display_name}))}));}));
 router.get('/products/:skuId',run(async(req,res)=>{await authenticate(req);if(!/^[1-9][0-9]{0,14}$/.test(req.params.skuId)||Object.keys(req.query).length)fail(400,'SKU_INVALID','รหัส SKU ไม่ถูกต้อง');const p=await queryProductDetail(db,Number(req.params.skuId),false);if(!p)fail(404,'PRODUCT_NOT_FOUND','ไม่พบสินค้า');res.json(envelope({ok:true,product:publicProduct(p)}));}));
 router.get('/stock',run(async(req,res)=>{await authenticate(req);if(Object.keys(req.query).some(k=>!['search','limit','offset'].includes(k)))fail(400,'QUERY_INVALID','ข้อมูลค้นหาไม่ถูกต้อง');const search=typeof req.query.search==='string'?req.query.search.trim():'';if(!search||search.length>200)fail(400,'SEARCH_REQUIRED','กรอกบาร์โค้ดหรือรหัส IC');const filter=`(product_code ILIKE '%'||$1||'%' OR COALESCE(product_name_thai,'') ILIKE '%'||$1||'%' OR COALESCE(product_name_eng,'') ILIKE '%'||$1||'%' OR COALESCE(barcode,'') ILIKE '%'||$1||'%')`;
  const total=(await db.query('SELECT count(*)::integer AS n FROM ada.branch_stock_snapshots WHERE '+filter,[search])).rows[0].n,rows=(await db.query('SELECT product_code,product_name_thai,product_name_eng,barcode,unit,qty_branch_001,synced_at FROM ada.branch_stock_snapshots WHERE '+filter+' ORDER BY product_code LIMIT 200',[search])).rows;
  res.json(envelope({records:rows.map(r=>({productCode:r.product_code,productNameThai:r.product_name_thai||'',productNameEng:r.product_name_eng||'',barcode:r.barcode||'',unit:r.unit||'',qtyBranch001:r.qty_branch_001==null?null:Number(r.qty_branch_001),syncedAt:r.synced_at,stockNullsPreserved:true})),pagination:{limit:200,offset:0,total},stockSource:'full-sync',stockObservedAt:null}));
 }));
 router.use((_req,res)=>res.status(405).json({error:'SCPDA supports product and stock reads only',code:'READ_ONLY'}));
 return router;
}
module.exports={createScpdaReadRouter,CONTRACT,parseConfig};
