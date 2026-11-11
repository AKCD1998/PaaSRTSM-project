"use strict";
const fs=require('fs'),crypto=require('crypto');
async function importPjkRows(db,records,signature){
 if(!Array.isArray(records)||!records.length||records.length>10000||new Set(records.map(r=>r.id)).size!==records.length)throw Error('Invalid reviewed record import');
 const sha=crypto.createHash('sha256').update(signature).digest('hex');
 if(signature.length>1048576||signature.subarray(1,4).toString()!=='PNG')throw Error('Invalid signature PNG');
 await db.query('BEGIN');
 try{
  await db.query('INSERT INTO pjk_documents.assets(id,mime_type,content_sha256,content) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',['songpol-v1','image/png',sha,signature]);
  const asset=await db.query('SELECT content_sha256 FROM pjk_documents.assets WHERE id=$1',['songpol-v1']);if(asset.rows[0].content_sha256!==sha)throw Error('Existing signature differs');
  for(const r of records){
   if(!r.payload.subPharmacistSlots?.length||r.payload.subPharmacistSlots.some(s=>['pharmacistName','pharmacistLicense','dateStart','dateEnd','timeStart','timeEnd'].some(k=>!s[k])))throw Error('Incomplete record '+r.id);
   await db.query('INSERT INTO pjk_documents.records(id,month,branch,signature_asset_id,metadata,payload,source_pdf_sha256) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) ON CONFLICT(id) DO NOTHING',[r.id,r.month,r.branch,'songpol-v1',JSON.stringify(r.metadata),JSON.stringify(r.payload),r.sourcePdfSha256]);
  }
  const actual=await db.query('SELECT id,month,branch,metadata,payload,source_pdf_sha256 FROM pjk_documents.records');
  const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
  for(const r of records){const a=actual.rows.find(x=>x.id===r.id);if(!a||a.month!==r.month||a.branch!==r.branch||a.source_pdf_sha256!==r.sourcePdfSha256||stable(a.payload)!==stable(r.payload)||stable(a.metadata)!==stable(r.metadata))throw Error('Import readback mismatch '+r.id);}
  await db.query('COMMIT');return {records:records.length,signatureBytes:signature.length,signatureSha256:sha};
 }catch(e){await db.query('ROLLBACK');throw e;}
}
module.exports={importPjkRows};

