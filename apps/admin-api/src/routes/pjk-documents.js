"use strict";
const express=require('express'),fs=require('node:fs'),path=require('node:path');
const {requireAuth,requireRole}=require('../auth/middleware');
const {createPjkDocumentRows}=require('../services/pjkDocumentRows');
function createPjkDocumentsRouter({config,db,archiveRoot=path.resolve(__dirname,'../../data/pjk-documents'),service=createPjkDocumentRows(db)}) {
 const router=express.Router();
 router.use(requireAuth(config),requireRole('admin'));
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 const run=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.code==='42P01'||e.code==='3F000')return res.status(503).json({error:'ทะเบียนเอกสารยังไม่พร้อม'});if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
 router.get('/',run(async(req,res)=>{
  const archive=JSON.parse(fs.readFileSync(path.join(archiveRoot,'manifest.json'),'utf8'));
  const documents=await service.list();
  const q=String(req.query.q||'').trim().toLowerCase().slice(0,200),branch=String(req.query.branch||''),month=String(req.query.month||'');
  const rows=documents.filter(d=>(!branch||d.branch===branch)&&(!month||(month==='unknown'?!d.month:d.month===month))&&(!q||JSON.stringify([d.branch,d.sourceSheet,d.slots,d.note]).toLowerCase().includes(q)));
  const offset=Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10)||0));
  const months=[...new Set(documents.map(d=>d.month).filter(Boolean))].sort().reverse();
  res.json({asOf:archive.asOf,total:rows.length,archiveTotal:documents.length,storageMode:'database-rows',months,
   monthlyBundles:months.map(month=>({month,pageCount:documents.filter(d=>d.month===month).length,signatureApplied:true,pdfGeneratedOnDemand:true})),
   exclusions:archive.exclusions||[],documents:rows.slice(offset,offset+50)});
 }));
 const send=(res,bytes,name)=>{if(!Buffer.isBuffer(bytes)||bytes.subarray(0,4).toString()!=='%PDF')throw Error('Invalid generated PDF');res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${name}"`,'X-Content-Type-Options':'nosniff'});res.send(bytes);};
 router.get('/monthly/:month/pdf',run(async(req,res)=>{
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(req.params.month))return res.status(404).json({error:'ไม่พบเอกสารรวมเดือนนี้'});
  send(res,await service.pdf({month:req.params.month}),`PJK-${req.params.month}-All-Branches-Signed.pdf`);
 }));
 router.get('/:id/pdf',run(async(req,res)=>{
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id))return res.status(404).json({error:'ไม่พบเอกสาร'});
  send(res,await service.pdf({id:req.params.id}),`PJK-${req.params.id}.pdf`);
 }));
 return router;
}
module.exports={createPjkDocumentsRouter};
