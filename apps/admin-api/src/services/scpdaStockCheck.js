'use strict';
const CONTRACT='scpda-stock-check-001-v1';
const categories=new Set(['all','pharma','normal','common']);
function queryOptions(query){
 const category=query.category||'all',search=String(query.search||'').trim();
 if(!categories.has(category)||search.length>200||query.branchCode&&!['001','004','005'].includes(query.branchCode))throw Object.assign(Error('ตรวจหมวด สาขา หรือคำค้นหา'),{status:400});
 const integer=(v,fallback,max)=>v===undefined?fallback:/^\d+$/.test(String(v))&&Number(v)<=max?Number(v):NaN;
 const limit=integer(query.limit,50,100),offset=integer(query.offset,0,1000000);
 if(!Number.isInteger(limit)||limit<1||!Number.isInteger(offset))throw Object.assign(Error('ตรวจจำนวนรายการต่อหน้า'),{status:400});
 return {category,search,limit,offset,branchCode:query.branchCode||'001'};
}
const catalog=`WITH canonical AS (
 SELECT DISTINCT ON (company_code) company_code AS product_code,display_name AS name,sku_id
 FROM public.skus WHERE company_code IS NOT NULL AND company_code<>'' ORDER BY company_code,sku_id
), catalog AS (
 SELECT c.product_code,c.name,c.sku_id,COALESCE((SELECT b.barcode FROM public.barcodes b WHERE b.sku_id=c.sku_id ORDER BY b.is_primary DESC NULLS LAST,b.barcode LIMIT 1),'') AS barcode FROM canonical c
 UNION ALL
 SELECT s.product_code,s.product_name_thai AS name,NULL::bigint AS sku_id,s.barcode FROM ada.branch_stock_snapshots s WHERE NOT EXISTS(SELECT 1 FROM canonical c WHERE c.product_code=s.product_code)
), filtered AS (
 SELECT c.*,COALESCE(e.category,CASE WHEN c.name ~ '^เภสัช([[:space:]]|$)' THEN 'pharma' WHEN c.name ~ '^ปกติ([[:space:]]|$)' THEN 'normal' WHEN c.name ~ '^สามัญ([[:space:]]|$)' THEN 'common' END) AS category,
 e.event_id,e.receipt_id,e.evidence,e.unit_label,e.operator_code,e.round_no,e.complete_product,e.observed_at,e.received_at,r.action AS review_status
 FROM catalog c LEFT JOIN LATERAL(SELECT * FROM ordering.scpda_observations e WHERE e.branch_code=$4 AND e.product_code=c.product_code ORDER BY e.received_at DESC,e.event_id DESC LIMIT 1)e ON TRUE
 LEFT JOIN LATERAL(SELECT action FROM ordering.scpda_review_events r WHERE r.event_id=e.event_id ORDER BY r.revision DESC LIMIT 1)r ON TRUE
 WHERE ($1::text='' OR c.product_code ILIKE $2 OR c.name ILIKE $2 OR c.barcode ILIKE $2 OR EXISTS(SELECT 1 FROM public.barcodes b WHERE b.sku_id=c.sku_id AND b.barcode ILIKE $2))
)`;
function publicCount(r){
 if(!r.event_id)return null;
 const e=r.evidence;
 return {eventId:r.event_id,receiptId:r.receipt_id,quantity:Number(e.quantity),unit:r.unit_label,operatorCode:r.operator_code,round:r.round_no,completeProduct:r.complete_product,observedAt:r.observed_at,receivedAt:r.received_at,reviewStatus:r.review_status,
  lots:(e.lots||[]).map(l=>({code:l.code,quantity:Number(l.quantity),manufacturedOn:l.manufacturedOn,expiresOn:l.expiresOn}))};
}
async function listProducts(db,options){
 const {category,search,limit,offset,branchCode='001'}=options,params=[search,'%'+search+'%',category,branchCode];
 const filter="WHERE ($3::text='all' OR category=$3)";
 const [page,total]=await Promise.all([
  db.query(catalog+` SELECT * FROM filtered ${filter} ORDER BY received_at DESC NULLS LAST,name ASC NULLS LAST,product_code ASC LIMIT $5 OFFSET $6`,[...params,limit,offset]),
  db.query(catalog+` SELECT count(*)::integer AS total FROM filtered ${filter}`,params)
 ]);
 return {contract:CONTRACT,branchCode,order:'pda-received-desc-unsubmitted-last',officialStockWrites:false,records:page.rows.map(r=>({productCode:r.product_code,skuId:r.sku_id==null?null:String(r.sku_id),name:r.name||r.product_code,barcode:r.barcode||null,category:r.category||null,latestCount:publicCount(r)})),pagination:{total:total.rows[0].total,limit,offset}};
}
module.exports={CONTRACT,queryOptions,listProducts};
