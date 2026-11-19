'use strict';
const crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const {pairFor,isCompanion,dailyEnabled,reject}=require('./scpdaDailyPolicy');
function record(row,settings){
 const pair=pairFor(row.operator_code);if(!pair||row.primary_operator_code!==pair.primaryOperatorCode||row.branch_code!==pair.branchCode)return null;
 return {operatorCode:row.operator_code,branchCode:row.branch_code,hash:row.password_hash,version:row.credential_version,rotationDueAt:new Date(row.rotation_due_at).toISOString(),delegatedFrom:pair.primaryOperatorCode,fingerprint:crypto.createHmac('sha256',settings.sessionKey).update(row.operator_code+':'+row.password_hash+':'+row.credential_version+':'+row.branch_code).digest('hex')};
}
async function resolveOperator(config,settings,db,code){
 const existing=settings.operators.get(code);if(existing)return existing;
 const pair=pairFor(code);if(!isCompanion(code)||!pair||!dailyEnabled(config,pair.branchCode))return null;
 const row=(await db.query('SELECT * FROM ordering.scpda_companion_accounts WHERE operator_code=$1 AND revoked_at IS NULL',[code])).rows[0];return row?record(row,settings):null;
}
async function listCompanions(config,settings,db,primary){
 const rows=(await db.query(`SELECT a.operator_code,a.created_at,d.device_ref IS NOT NULL AND d.revoked_at IS NULL AS paired
 FROM ordering.scpda_companion_accounts a LEFT JOIN ordering.scpda_operator_devices d USING(operator_code)
 WHERE a.primary_operator_code=$1 AND a.revoked_at IS NULL ORDER BY a.ordinal`,[primary])).rows;
 for(const op of settings.operators.values())if(isCompanion(op.operatorCode)&&pairFor(op.operatorCode)?.primaryOperatorCode===primary&&!rows.some(r=>r.operator_code===op.operatorCode)){
  const binding=(await db.query('SELECT revoked_at FROM ordering.scpda_operator_devices WHERE operator_code=$1',[op.operatorCode])).rows[0];if(!binding?.revoked_at)rows.unshift({operator_code:op.operatorCode,paired:!!binding});
 }
 return rows.map(r=>({operatorCode:r.operator_code,paired:r.paired,createdAt:r.created_at||null}));
}
async function newCompanion(config,settings,client,pair,now){
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['scpda-companions:'+pair.primaryOperatorCode]);
 // Reuse an unused slot after a lost QR response. Permanent device slots and
 // revoked accounts are never reassigned to another installation.
 const unused=(await client.query(`SELECT a.* FROM ordering.scpda_companion_accounts a LEFT JOIN ordering.scpda_operator_devices d USING(operator_code)
 WHERE a.primary_operator_code=$1 AND a.revoked_at IS NULL AND d.operator_code IS NULL ORDER BY a.ordinal LIMIT 1 FOR UPDATE OF a`,[pair.primaryOperatorCode])).rows[0];
 if(unused)return {op:record(unused,settings),created:false,...(await bcrypt.compare('sc'+unused.operator_code,unused.password_hash)?{initialPassword:'sc'+unused.operator_code}:{})};
 let ordinal=Number((await client.query('SELECT coalesce(max(ordinal),1)+1 n FROM ordering.scpda_companion_accounts WHERE primary_operator_code=$1',[pair.primaryOperatorCode])).rows[0].n);
 const code=n=>String(n).padStart(2,'0')+pair.branchCode+(pair.primaryOperatorCode.endsWith('SHPEE')?'SHPEE':'');
 while(settings.operators.has(code(ordinal)))ordinal++;
 if(ordinal>9999)reject(409,'COMPANION_LIMIT','ติดต่อผู้ดูแลเพื่อเพิ่มขอบเขตเครื่องย่อย');
 const operatorCode=code(ordinal),initialPassword='sc'+operatorCode,passwordHash=await bcrypt.hash(initialPassword,12);
 const row=(await client.query(`INSERT INTO ordering.scpda_companion_accounts(operator_code,branch_code,primary_operator_code,ordinal,password_hash,credential_version,rotation_due_at,created_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[operatorCode,pair.branchCode,pair.primaryOperatorCode,ordinal,passwordHash,crypto.randomUUID(),new Date(now+180*86400000),new Date(now)])).rows[0];
 return {op:record(row,settings),created:true,initialPassword};
}
module.exports={resolveOperator,listCompanions,newCompanion};
