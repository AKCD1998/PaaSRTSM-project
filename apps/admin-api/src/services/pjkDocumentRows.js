"use strict";
const crypto = require('node:crypto');
function createPjkDocumentRows(db, options={}) {
 const render = options.render || (async input => (await import('./pjk-v1/pdfStampService.mjs')).renderSignedPjkPdf(input));
 const checkDb = () => { if (!db) {const e=Error('ทะเบียนเอกสารยังไม่พร้อม');e.status=503;throw e;} };
 return {
  async list() { checkDb(); const r=await db.query('SELECT id, month, branch, metadata FROM pjk_documents.records ORDER BY month DESC, branch ASC, id ASC'); return r.rows.map(d=>({...d.metadata,id:d.id,month:d.month,branch:d.branch})); },
  async pdf({id,month}) {
   checkDb();
   const r=await db.query(`SELECT id,payload,template_version,signature_asset_id FROM pjk_documents.records WHERE ${id?'id':'month'}=$1 ORDER BY branch ASC,id ASC`,[id||month]);
   if(!r.rows.length){const e=Error('ไม่พบเอกสาร');e.status=404;throw e;}
   if(r.rows.some(d=>d.template_version!=='form_gor_gor_1-v1'||d.signature_asset_id!==r.rows[0].signature_asset_id))throw Error('Unsupported archive rendering version');
   const a=await db.query('SELECT content,content_sha256 FROM pjk_documents.assets WHERE id=$1',[r.rows[0].signature_asset_id]);
   if(!a.rows.length){const e=Error('ลายเซ็นเอกสารยังไม่พร้อม');e.status=503;throw e;}
   const signature=Buffer.from(a.rows[0].content);
   if(crypto.createHash('sha256').update(signature).digest('hex')!==a.rows[0].content_sha256)throw Error('Signature integrity mismatch');
   return render({payloads:r.rows.map(d=>d.payload),signatureBytes:signature});
  }
 };
}
module.exports={createPjkDocumentRows};
