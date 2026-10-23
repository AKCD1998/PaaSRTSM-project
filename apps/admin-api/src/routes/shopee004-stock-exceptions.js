'use strict';
const express=require('express');
const READ_BASE='https://sc-official-website.onrender.com/api/internal/shopee004-stock';
const WRITE_BASE='https://sc-official-website.onrender.com/api/internal/shopee004-stock-admin';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const text=(x,max=500)=>typeof x==='string'&&x.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
const identity=x=>text(x,100)&&/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(x);
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=20000;
const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const reason=x=>text(x,100)&&/^[A-Za-z0-9_-]+$/.test(x);
const ref=x=>text(x,200)&&/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(x);
function evidence(e){
 if(!e||!['seller_catalog','seller_description','pos_unit','owner_unit','reviewed_stock_rule','source_item','retained_contract'].includes(e.kind)||!ref(e.reference)||!text(e.label)||!(e.verifiedAt==null||time(e.verifiedAt)))throw Error();
 return {kind:e.kind,reference:e.reference,label:e.label,verifiedAt:e.verifiedAt||null};
}
function exceptionRecord(r){
 if(!r||!uuid(r.exceptionId)||!text(r.revision,200)||!r.revision||!['identity','unit','lifecycle','temporary'].includes(r.issueClass)||!reason(r.reasonCode)
  ||![r.productName,r.variantName].every(x=>text(x))||![r.listingId,r.variationId].every(x=>x==null||x===''||identity(x))||!(r.observedUnit==null||text(r.observedUnit,80))
  ||!count(r.affectedOrders)||typeof r.canApproveMapping!=='boolean'||typeof r.requiresLifecycleReview!=='boolean'
  ||!Array.isArray(r.evidence)||r.evidence.length>50||!Array.isArray(r.proposedMatches)||r.proposedMatches.length>50)throw Error();
 const proposedMatches=r.proposedMatches.map(p=>{
  if(!identity(p.productCode)||!text(p.productName)||!text(p.unit,40)||!p.unit.trim()||!Number.isSafeInteger(p.quantityPerSale)||p.quantityPerSale<1||p.quantityPerSale>10000
   ||!Array.isArray(p.evidenceRefs)||p.evidenceRefs.length>50||!p.evidenceRefs.every(ref))throw Error();
  return {productCode:p.productCode,productName:p.productName,unit:p.unit,quantityPerSale:p.quantityPerSale,evidenceRefs:p.evidenceRefs};
 });
 const result={exceptionId:r.exceptionId,revision:r.revision,listingId:r.listingId||null,variationId:r.variationId||null,productName:r.productName,variantName:r.variantName,
  reasonCode:r.reasonCode,issueClass:r.issueClass,observedUnit:r.observedUnit||null,proposedMatches,evidence:r.evidence.map(evidence),affectedOrders:r.affectedOrders,
  canApproveMapping:r.canApproveMapping,requiresLifecycleReview:r.requiresLifecycleReview,ruleVersion:Number.isSafeInteger(r.ruleVersion)&&r.ruleVersion>0?r.ruleVersion:null,
  ruleId:uuid(r.ruleId)?r.ruleId:null};
 if(r.itemContext!=null){if(!['current-issue','original-issue','reference-only'].includes(r.itemContext)||typeof r.itemIssueConfirmed!=='boolean'||!count(r.unresolvedItemCount)||!Array.isArray(r.itemReasonCodes)||r.itemReasonCodes.length>50||!r.itemReasonCodes.every(reason))throw Error();
  result.itemContext=r.itemContext;result.itemIssueConfirmed=r.itemIssueConfirmed;result.unresolvedItemCount=r.unresolvedItemCount;result.itemReasonCodes=r.itemReasonCodes;
  if(r.itemContext==='reference-only'||r.itemIssueConfirmed!==true)result.canApproveMapping=false;
 }
 if(r.auditHistory!=null){if(!Array.isArray(r.auditHistory)||r.auditHistory.length>50)throw Error();result.auditHistory=r.auditHistory.map(a=>{if(!reason(a.action)||!time(a.at)||!(a.ruleVersion==null||Number.isSafeInteger(a.ruleVersion)&&a.ruleVersion>0)||!text(a.reason||'',200))throw Error();return {action:a.action,at:a.at,ruleVersion:a.ruleVersion||null,reason:a.reason||''};});}
 if(r.recovery){const x=r.recovery;if(![null,'ready','retry_wait','blocked'].includes(x.state)||!count(x.attempts)||!['nextRetryAt','firstFailedAt','lastFailedAt'].every(k=>x[k]==null||time(x[k])))throw Error();result.recovery={state:x.state,attempts:x.attempts,nextRetryAt:x.nextRetryAt||null,firstFailedAt:x.firstFailedAt||null,lastFailedAt:x.lastFailedAt||null};}
 return result;
}
function mappingRequest(b){
 if(!b||!uuid(b.operationId)||!text(b.expectedRevision,200)||!b.expectedRevision||!identity(b.listingId)||!identity(b.variationId)||b.acknowledgeUnitEvidence!==true
  ||!Array.isArray(b.components)||b.components.length<1||b.components.length>20||!Array.isArray(b.evidenceRefs)||b.evidenceRefs.length<1||b.evidenceRefs.length>50||!b.evidenceRefs.every(ref))throw Error();
 const components=b.components.map(x=>{if(!x||!identity(x.productCode)||!text(x.unit,40)||!x.unit.trim()||!Number.isSafeInteger(x.quantityPerSale)||x.quantityPerSale<1||x.quantityPerSale>10000)throw Error();return {productCode:x.productCode,quantityPerSale:x.quantityPerSale,unit:x.unit};});
 if(new Set(components.map(x=>x.productCode)).size!==components.length)throw Error();
 // Unknown fields (including lifecycle attestations and actors) are discarded.
 return {operationId:b.operationId,expectedRevision:b.expectedRevision,listingId:b.listingId,variationId:b.variationId,components,evidenceRefs:[...new Set(b.evidenceRefs)],acknowledgeUnitEvidence:true};
}
function createShopee004StockExceptionsRouter({config,fetchImpl=globalThis.fetch,requireAuthMiddleware,requireRoleMiddleware,requireCsrfMiddleware}){
 const router=express.Router(),prefix='/admin/shopee004';
 const error=(res,status,code)=>{const noWrite=['BRIDGE_UNAVAILABLE','STOCK_EXCEPTION_ADMIN_DISABLED'].includes(code);return res.status(status).json({error:{code,detailsWithheld:true,...(noWrite?{definitiveNoWrite:true}:{})},...(noWrite?{definitiveNoWrite:true}:{})});};
 router.use(prefix,requireAuthMiddleware,requireRoleMiddleware('admin'),(req,res,next)=>{
  res.set('Cache-Control','no-store');if(config.featureShopee004StockExceptionAdmin!==true)return error(res,503,'STOCK_EXCEPTION_ADMIN_DISABLED');next();
 });
 async function upstream(path,body,write,actor){
  const token=write?config.shopee004StockReviewToken:config.shopee004StockProjectionToken;
  if(typeof token!=='string'||token.length<32)throw Object.assign(Error(),{safeCode:'BRIDGE_UNAVAILABLE'});
  if(write&&token===config.shopee004StockProjectionToken)throw Object.assign(Error(),{safeCode:'BRIDGE_UNAVAILABLE'});
  let r;
  try{r=await fetchImpl((write?WRITE_BASE:READ_BASE)+path,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,...(write?{actor}: {})})});}
  catch{throw Object.assign(Error(),{safeCode:write?'MUTATION_OUTCOME_UNKNOWN':'STOCK_EXCEPTION_SOURCE_UNAVAILABLE',httpStatus:write?504:503});}
  let raw='',bytes=0;const decoder=new TextDecoder();
  if(Number(r.headers?.get('content-length')||0)>1000000)throw Error();
  for await(const chunk of r.body){bytes+=chunk.byteLength;if(bytes>1000000)throw Error();raw+=decoder.decode(chunk,{stream:true});}raw+=decoder.decode();
  let value;try{value=JSON.parse(raw);}catch{throw Object.assign(Error(),{safeCode:write?'MUTATION_OUTCOME_UNKNOWN':'STOCK_EXCEPTION_SOURCE_UNAVAILABLE',httpStatus:write?504:503});}
  if(!r.ok){const safe=reason(value?.error?.code)&&/^[A-Z0-9_]+$/.test(value.error.code)?value.error.code:'STOCK_EXCEPTION_SOURCE_UNAVAILABLE';throw Object.assign(Error(),{safeCode:safe,httpStatus:[400,401,403,409].includes(r.status)?r.status:503});}
  return value;
 }
 const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){error(res,e.httpStatus||503,e.safeCode||'STOCK_EXCEPTION_CONTRACT_INVALID');}};
 router.get(prefix+'/stock-exceptions',safe(async(req,res)=>{
  const limit=req.query.limit==null?25:Number(req.query.limit),cursor=req.query.cursor||null;
  if(!Number.isInteger(limit)||limit<1||limit>100||cursor!==null&&!uuid(cursor))return error(res,400,'STOCK_EXCEPTION_PAGE_INVALID');
  const v=await upstream('/exceptions',{limit,cursor},false);
  if(v.schemaVersion!=='shopee004-exceptions-v1'||v.branchCode!=='004'||v.status!=='available'||!time(v.asOf)||!Array.isArray(v.records)||v.records.length>limit
   ||typeof v.pagination?.hasMore!=='boolean'||!(v.pagination.nextCursor==null||uuid(v.pagination.nextCursor)))throw Error();
  const records=[];let unreadableRecords=0;
  for(const record of v.records){try{records.push(exceptionRecord(record));}catch{unreadableRecords++;}}
  res.json({schemaVersion:v.schemaVersion,branchCode:'004',asOf:v.asOf,status:v.status,records,unreadableRecords,pagination:{hasMore:v.pagination.hasMore,nextCursor:v.pagination.nextCursor||null}});
 }));
 router.get(prefix+'/stock-reconciliation',safe(async(req,res)=>{
  const v=await upstream('/reconciliation',{},false);
  if(v.openingBoundaryPreserved!==true||!time(v.cutoverAt)||typeof v.physicalStockVerified!=='boolean'||!text(v.openingBasisQuality,100)||!['reservedOrders','shippedUnpostedOrders','reviewOrders'].every(k=>count(v[k]))||typeof v.requiresCountReconciliation!=='boolean')throw Error();
  res.json({schemaVersion:'shopee004-reconciliation-v1',branchCode:'004',asOf:time(v.asOf)?v.asOf:new Date().toISOString(),openingBoundaryPreserved:true,cutoverAt:v.cutoverAt,openingBasisQuality:v.openingBasisQuality,physicalStockVerified:v.physicalStockVerified,
   reservedOrders:v.reservedOrders,shippedUnpostedOrders:v.shippedUnpostedOrders,reviewOrders:v.reviewOrders,requiresCountReconciliation:v.requiresCountReconciliation});
 }));
 async function mutation(req,res,path,body){
  const actor=String(req.auth?.userId||req.auth?.id||'');if(!actor||actor.length>200)return error(res,403,'HUMAN_ADMIN_REQUIRED');
  const v=await upstream(path,body,true,actor);
  if(v.recorded!==true||typeof v.duplicate!=='boolean'||!uuid(v.ruleId)||!Number.isSafeInteger(v.ruleVersion)||v.ruleVersion<1||!count(v.requeuedOrders))throw Object.assign(Error(),{safeCode:'MUTATION_OUTCOME_UNKNOWN',httpStatus:504});
  res.json({recorded:true,duplicate:v.duplicate,ruleId:v.ruleId,ruleVersion:v.ruleVersion,requeuedOrders:v.requeuedOrders,...(typeof v.requeuePending==='boolean'?{requeuePending:v.requeuePending}:{})});
 }
 router.post(prefix+'/stock-exceptions/:exceptionId/mapping',requireCsrfMiddleware,safe(async(req,res)=>{
  let body;try{if(!uuid(req.params.exceptionId))throw Error();body=mappingRequest(req.body);}catch{return error(res,400,'MAPPING_APPROVAL_CONTRACT_INVALID');}
  await mutation(req,res,'/mapping',{...body,exceptionId:req.params.exceptionId});
 }));
 router.post(prefix+'/stock-rules/:ruleId/revoke',requireCsrfMiddleware,safe(async(req,res)=>{
  const b=req.body;if(!uuid(req.params.ruleId)||!uuid(b?.operationId)||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<1||!text(b.reason,80)||!/^[a-z][a-z0-9_]{2,79}$/.test(b.reason))return error(res,400,'RULE_REVOCATION_CONTRACT_INVALID');
  await mutation(req,res,'/revoke',{ruleId:req.params.ruleId,operationId:b.operationId,expectedVersion:b.expectedVersion,reason:b.reason});
 }));
 return router;
}
module.exports={createShopee004StockExceptionsRouter,mappingRequest,exceptionRecord,READ_BASE,WRITE_BASE};
