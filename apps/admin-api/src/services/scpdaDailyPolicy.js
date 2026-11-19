'use strict';
const crypto = require('node:crypto');
const net = require('node:net');
const {CountError}=require('./scpdaObservationLedger');
const DAY = 86400000;
const reject = (status, code, message) => { throw new CountError(status,code,message); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const PAIRS=Object.freeze([
 Object.freeze({branchCode:'004',primaryOperatorCode:'01004',operatorCode:'02004'}),
 Object.freeze({branchCode:'004',primaryOperatorCode:'01004SHPEE',operatorCode:'02004SHPEE'}),
 Object.freeze({branchCode:'005',primaryOperatorCode:'01005',operatorCode:'02005'})
]);
const {operatorBranch}=require('./scpdaBranches');
const isCompanion=operator=>!!operatorBranch(operator)&&operatorBranch(operator)!=='001'&&!['01004','01004SHPEE','01005'].includes(operator);
const pairFor=operator=>{const fixed=PAIRS.find(p=>p.primaryOperatorCode===operator);if(fixed)return fixed;if(!isCompanion(operator))return null;const branchCode=operatorBranch(operator);return {branchCode,primaryOperatorCode:'01'+branchCode+(operator.endsWith('SHPEE')?'SHPEE':''),operatorCode:operator};};
const dailyEnabled=(config,branch)=>branch==='004'?config.featureScpdaDaily004===true&&config.featureScpdaBranch004===true&&config.featureScpda004Areas===true:branch==='005'&&config.featureScpdaDaily005===true&&config.featureScpdaBranch005===true;
const dailyRequired=(config,operator)=>!!pairFor(operator)&&dailyEnabled(config,pairFor(operator).branchCode);
function businessDay(ms) { return new Date(ms + 7*3600000).toISOString().slice(0,10); }
function midnight(ms) { return Date.parse(businessDay(ms)+'T00:00:00+07:00')+DAY; }
function networkHash(req, secret) {
 // req.ip comes from Express's configured single trusted Render proxy. Never
 // take the first value supplied by the browser in X-Forwarded-For.
 let ip=req.ip||'';if(ip.startsWith('::ffff:'))ip=ip.slice(7);
 if(!net.isIP(ip))reject(403,'NETWORK_UNAVAILABLE','ยืนยันเครือข่ายร้านไม่ได้');
 return crypto.createHmac('sha256',secret).update('scpda-network-v1:'+ip).digest('hex');
}
function selfie(value) {
 if(typeof value!=='string'||value.length>273072||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))reject(400,'SELFIE_REQUIRED','ถ่ายเซลฟี่ก่อนเริ่มงาน');
 const bytes=Buffer.from(value.slice(23),'base64');
 if(bytes.length<100||bytes.length>204800||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)reject(400,'SELFIE_INVALID','รูปเซลฟี่ไม่ถูกต้อง กรุณาถ่ายใหม่');
 return {bytes,sha256:hash(bytes)};
}
async function checkDaily({config,db,req,claims,parentId,now=Date.now()}) {
 if(!dailyRequired(config,claims.sub))return null;
 const id=parentId||claims.jti;
 const row=(await db.query(`SELECT d.*,p.network_hash AS primary_network_hash,p.expires_at AS primary_expires_at,p.revoked_at AS primary_revoked_at,p.operator_code AS primary_operator_code,p.branch_code AS primary_branch_code
 FROM ordering.scpda_daily_sessions d LEFT JOIN ordering.scpda_daily_sessions p ON p.session_id=d.primary_session_id
 WHERE d.session_id=$1`,[id])).rows[0];
 if(!row||row.branch_code!==pairFor(claims.sub)?.branchCode||row.operator_code!==claims.sub||row.device_ref!==claims.device_ref||row.credential_version!==claims.cv||row.revoked_at||+new Date(row.expires_at)<=now)
  reject(401,'DAILY_LOGIN_REQUIRED','เข้าสู่ระบบและถ่ายเซลฟี่สำหรับวันนี้');
 if(row.app_version!==config.scpdaPwaVersionCode||claims.app_version!==row.app_version)reject(409,'APP_UPDATE_REQUIRED','อัปเดต SCPDA เป็นรุ่นล่าสุดก่อน');
 const current=networkHash(req,config.authJwtSecret);
 if(isCompanion(row.operator_code)){
  if(!row.primary_session_id||row.primary_operator_code!==pairFor(claims.sub).primaryOperatorCode||row.primary_branch_code!==row.branch_code||row.primary_revoked_at||+new Date(row.primary_expires_at)<=now||row.primary_network_hash!==current)
   reject(403,'STORE_NETWORK_REQUIRED','เชื่อม Wi-Fi ร้านเดียวกับเครื่องหลัก แล้วลองใหม่');
  const binding=(await db.query('SELECT device_ref,revoked_at FROM ordering.scpda_operator_devices WHERE operator_code=$1',[claims.sub])).rows[0];
  if(!binding||binding.revoked_at||binding.device_ref!==claims.device_ref)reject(401,'DEVICE_BINDING_INVALID','เครื่องนี้ไม่ได้รับอนุญาต');
 } else if(current!==row.network_hash){
  await db.query('UPDATE ordering.scpda_daily_sessions SET network_hash=$2 WHERE session_id=$1',[row.session_id,current]);
 }
 return row;
}
module.exports={PAIRS,pairFor,isCompanion,dailyEnabled,businessDay,midnight,networkHash,selfie,hash,dailyRequired,checkDaily,reject};
