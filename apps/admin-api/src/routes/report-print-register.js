"use strict";
const express=require('express');
const {requireAuth,requireRole,requireCsrf}=require('../auth/middleware');
const {createReportPrintRegister}=require('../services/reportPrintRegister');
function createReportPrintRegisterRouter({config,db}){
 const router=express.Router(),service=createReportPrintRegister(db);
 router.use(requireAuth(config),requireRole('admin'));
 router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 const run=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});if(e.code==='23505')return res.status(409).json({error:'มีรายการนี้แล้ว กรุณาโหลดประวัติใหม่'});if(['42P01','3F000'].includes(e.code))return res.status(503).json({error:'ทะเบียนพิมพ์ยังไม่พร้อม กรุณาติดต่อผู้ดูแล'});next(e);}};
 router.get('/',run(req=>service.list(req.auth,req.query)));
 router.get('/:id',run(req=>service.detail(req.auth,req.params.id)));
 router.use(requireCsrf);
 router.post('/imports/preview',run(req=>service.previewImport(req.auth,req.body)));
 router.post('/imports',run(req=>service.importHistory(req.auth,req.body)));
 router.post('/',run(req=>service.register(req.auth,req.body)));
 router.post('/:id/confirmations',run(req=>service.confirm(req.auth,req.params.id,req.body)));
 router.post('/:id/confirmations/:eventId/void',run(req=>service.voidEvent(req.auth,req.params.id,req.params.eventId,req.body)));
 return router;
}
module.exports={createReportPrintRegisterRouter};
