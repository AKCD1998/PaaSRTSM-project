'use strict';
const crypto=require('node:crypto');
const {CountError,productIdentity}=require('./scpdaObservationLedger');
const fail=(s,c,m)=>{throw new CountError(s,c,m);};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function text(value,max,label,optional=false){if(optional&&(value===null||value===undefined||value===''))return null;if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,'PICK_FIELD_INVALID','ตรวจ'+label);return value.trim();}
function normalize(body,now){
 const keys=['id','capturedByOperator','skuId','productCode','barcode','quantity','unitLabel','destination','orderReference','lotCode','observedAt'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||!UUID.test(body.id||'')||!/^\d{1,15}$/.test(String(body.skuId||'')))fail(400,'PICK_INVALID','ตรวจข้อมูลการหยิบ');
 if(typeof body.quantity!=='string'||!/^[1-9]\d{0,8}$/.test(body.quantity))fail(400,'PICK_QUANTITY_INVALID','จำนวนที่หยิบต้องเป็นจำนวนเต็มมากกว่า 0');
 const at=Date.parse(body.observedAt);if(typeof body.observedAt!=='string'||!Number.isFinite(at)||at>now+120000||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(body.observedAt))fail(400,'PICK_TIME_INVALID','ตรวจเวลาหยิบ');
 if(!['order-packed','shopee-shelf'].includes(body.destination))fail(400,'PICK_DESTINATION_INVALID','เลือกปลายทางของที่หยิบ');
 const order=text(body.orderReference,128,'เลขออเดอร์',true);if(body.destination==='shopee-shelf'&&order)fail(400,'PICK_ORDER_INVALID','การเติมชั้น Shopee ไม่ผูกออเดอร์');
 return {id:body.id.toLowerCase(),capturedByOperator:text(body.capturedByOperator,16,'ผู้หยิบ'),skuId:String(body.skuId),productCode:text(body.productCode,200,'รหัสสินค้า'),barcode:text(body.barcode,200,'บาร์โค้ด'),quantity:body.quantity,unitLabel:text(body.unitLabel,80,'หน่วย'),destination:body.destination,orderReference:order,lotCode:text(body.lotCode,120,'ล็อต',true),observedAt:new Date(at).toISOString()};
}
function dto(r,replayed=false){return {eventId:r.event_id,receiptId:r.receipt_id,branchCode:'004',operatorCode:r.operator_code,productCode:r.product_code,skuId:String(r.sku_id),barcode:r.barcode,quantity:r.quantity,unitLabel:r.unit_label,fromScope:'004-front',fromLocation:'front-store',toScope:'004-shopee',destination:r.destination,orderReference:r.order_reference,lotCode:r.lot_code,observedAt:r.observed_at,receivedAt:r.received_at,status:'received-pick-observation',replayed,branchNetChange:0,officialStockWrites:false,stockSourceChanged:false,orderDeductionApplied:false,unitConversionVerified:false};}
function authorize(config,who){if(!config.featureScpda004Areas)fail(404,'AREAS_DISABLED','ยังไม่เปิดพื้นที่004');if(who.branchCode!=='004'||!['01004','01004SHPEE'].includes(who.operatorCode)||!who.canRecordInternalPick)fail(403,'PICK_FORBIDDEN','บัญชีนี้ยังไม่เปิดบันทึกการหยิบภายใน004');}
async function submit({db,config,who,body,now=Date.now()}){
 authorize(config,who);const input=normalize(body,now);if(input.capturedByOperator!==who.operatorCode)fail(403,'PICK_ACTOR_MISMATCH','ผู้หยิบไม่ตรงกับบัญชี');
 const encoded=JSON.stringify(input),hash=crypto.createHash('sha256').update(encoded).digest('hex'),c=await db.connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['scpda004-pick:'+input.id]);
  const old=(await c.query('SELECT * FROM ordering.scpda004_internal_picks WHERE event_id=$1',[input.id])).rows[0];
  if(old){if(old.operator_code!==who.operatorCode||old.device_ref!==who.deviceRef||old.payload_hash!==hash)fail(409,'PICK_IDEMPOTENCY_CONFLICT','รหัสรายการนี้มีข้อมูลอื่นแล้ว เก็บต้นฉบับไว้');await c.query('COMMIT');return dto(old,true);}
  await productIdentity(c,input);
  const r=(await c.query(`INSERT INTO ordering.scpda004_internal_picks(event_id,receipt_id,operator_code,device_ref,product_code,sku_id,barcode,quantity,unit_label,from_scope,from_location,to_scope,destination,order_reference,lot_code,observed_at,payload_hash,request_payload)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'004-front','front-store','004-shopee',$10,$11,$12,$13,$14,$15::jsonb) RETURNING *`,[input.id,crypto.randomUUID(),who.operatorCode,who.deviceRef,input.productCode,input.skuId,input.barcode,Number(input.quantity),input.unitLabel,input.destination,input.orderReference,input.lotCode,input.observedAt,hash,encoded])).rows[0];
  await c.query(`INSERT INTO public.audit_logs(actor_role,actor_id,action,target_type,target_id,success,meta) VALUES('system',$1,'scpda004.internal_pick','scpda004_pick',$2,TRUE,$3::jsonb)`,['scpda:'+who.operatorCode,input.id,JSON.stringify({branchCode:'004',productCode:input.productCode,fromScope:'004-front',toScope:'004-shopee',branchNetChange:0,officialStockWrites:false,orderDeductionApplied:false})]);
  await c.query('COMMIT');return dto(r);
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function history({config,db,who}){authorize(config,who);return (await db.query('SELECT * FROM ordering.scpda004_internal_picks ORDER BY received_at DESC,event_id DESC LIMIT 100')).rows.map(r=>dto(r));}
module.exports={normalize,submit,history,authorize,dto};
