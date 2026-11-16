'use strict';
const {branchEnabled}=require('../services/scpdaBranches');
const {Router}=require('express');
const {listProducts,queryOptions}=require('../services/scpdaStockCheck');
function canReadStockCheck(actor){return actor?.role==='admin'||actor?.role==='branch'&&actor.actorBranchCode==='001'&&actor.effectiveBranchCode==='001';}
function createScpdaStockCheckRouter({config,db,requireAuthMiddleware}){
 const r=Router();r.use((_req,res,next)=>{res.set('Cache-Control','no-store');if(!config.featureScpdaCounts001)return res.status(404).json({code:'COUNTS_DISABLED',error:'ยังไม่เปิดเช็คสินค้า'});next();});
 r.use(requireAuthMiddleware);r.use((req,res,next)=>{if(!canReadStockCheck(req.auth))return res.status(403).json({code:'BRANCH_NOT_ADMITTED',error:'เปิดให้สาขา 001 และผู้ดูแลระบบเท่านั้น'});next();});
 r.get('/',async(req,res)=>{try{const options=queryOptions(req.query);if(!branchEnabled(config,options.branchCode)||options.branchCode!=='001'&&req.auth.role!=='admin')return res.status(403).json({code:'BRANCH_NOT_ADMITTED',error:'ยังไม่เปิดสาขานี้สำหรับบัญชีนี้'});res.json(await listProducts(db,options));}catch(e){res.status(e.status||503).json({code:e.status===400?'INVALID_QUERY':'STOCK_CHECK_UNAVAILABLE',error:e.status===400?e.message:'อ่านผลนับไม่สำเร็จ กรุณาลองใหม่'});}});
 return r;
}
module.exports={createScpdaStockCheckRouter,canReadStockCheck};
