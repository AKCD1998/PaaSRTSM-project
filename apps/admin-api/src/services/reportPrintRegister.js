"use strict";
const { randomUUID,createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const KINDS = ['KY9','KY10','KY11'], BRANCHES = ['000','001','003','004','005'];
function fail(status,message){throw Object.assign(new Error(message),{status});}
function text(v,label,max=4000,required=true){if(v==null)v='';if(typeof v!=='string'||v.length>max)fail(400,`${label}ไม่ถูกต้อง`);v=v.trim();if(required&&!v)fail(400,`กรุณาระบุ${label}`);return v;}
function choice(v,options,label){if(!options.includes(v))fail(400,`${label}ไม่ถูกต้อง`);return v;}
function date(v,nullable=false){if(nullable&&(v==null||v===''))return null;const parsed=new Date(v+'T00:00:00Z');if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==v)fail(400,'วันที่ไม่ถูกต้อง');return v;}
function uuid(v){if(typeof v!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v))fail(400,'รหัสรายการไม่ถูกต้อง');return v;}
function integer(v,min,max,label,nullable=false){if(nullable&&(v==null||v===''))return null;if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,`${label}ไม่ถูกต้อง`);return v;}
function requireAdmin(auth){if(auth?.role!=='admin'||!auth.userId)fail(403,'เฉพาะ admin');}
function mergeRanges(ranges){const out=[];for(const [a,b] of [...ranges].sort((x,y)=>x[0]-y[0])){const last=out.at(-1);if(last&&a<=last[1]+1)last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;}
function parseRanges(value,total){
 if(value==null||value==='')return null;
 if(!Number.isSafeInteger(total))fail(400,'ต้องยืนยันจำนวนหน้าของไฟล์ก่อนระบุหน้าที่พิมพ์');
 if(typeof value!=='string'||value.length>5000)fail(400,'ระบุเลขหน้า เช่น 1-5,8,10');
 const entries=value.split(',');if(entries.length>1000)fail(400,'ช่วงหน้ามากเกินกำหนด');
 return mergeRanges(entries.map(v=>{const m=v.trim().match(/^([1-9]\d*)(?:\s*-\s*([1-9]\d*))?$/);if(!m)fail(400,'รูปแบบเลขหน้าไม่ถูกต้อง');const a=Number(m[1]),b=Number(m[2]||m[1]);if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a>b||b>total)fail(400,'เลขหน้าเกินจำนวนหน้าหรือช่วงหน้าสลับกัน');return[a,b];}));
}
function rangeText(ranges){return ranges.map(([a,b])=>a===b?String(a):`${a}-${b}`).join(', ');}
function parseDocument(body){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'ข้อมูลเอกสารไม่ถูกต้อง');
 const start=date(body.periodStart),end=date(body.periodEnd);if(end<start)fail(400,'วันที่สิ้นสุดต้องไม่ก่อนวันเริ่ม');
 const pages=integer(body.pageCount,1,20000,'จำนวนหน้า',true),sha=text(body.sha256,'SHA',64,false).toLowerCase();if(sha&&!/^[a-f0-9]{64}$/.test(sha))fail(400,'SHA ต้องเป็นเลขฐานสิบหก 64 หลัก');
 const sections=body.sections??[];if(!Array.isArray(sections)||sections.length>120)fail(400,'ข้อมูลแบ่งเดือนไม่ถูกต้อง');const months=new Set(),pageRanges=[];
 for(const s of sections){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(s.month)||months.has(s.month)||s.month<start.slice(0,7)||s.month>end.slice(0,7))fail(400,'เดือนย่อยไม่ถูกต้องหรือซ้ำ');months.add(s.month);integer(s.pageFrom,1,pages||0,'หน้าเริ่ม');integer(s.pageTo,s.pageFrom,pages||0,'หน้าสุดท้าย');pageRanges.push([s.pageFrom,s.pageTo]);}
 for(let i=0;i<pageRanges.length;i++)for(let j=0;j<i;j++)if(pageRanges[i][0]<=pageRanges[j][1]&&pageRanges[j][0]<=pageRanges[i][1])fail(400,'หน้าเดือนย่อยทับซ้อนกัน');
 const provenance=body.provenance??{};if(!provenance||typeof provenance!=='object'||Array.isArray(provenance)||JSON.stringify(provenance).length>20000)fail(400,'ที่มาเอกสารไม่ถูกต้อง');
 return {sourceKey:text(body.sourceKey||randomUUID(),'รหัสแหล่งข้อมูล',240),kind:choice(body.reportKind,KINDS,'ประเภทรายงาน'),branch:choice(body.branchCode,BRANCHES,'สาขา'),start,end,version:text(body.version,'รุ่นเอกสาร',300),filename:text(body.filename,'ชื่อไฟล์',500),pages,sha:sha||null,reference:text(body.sourceReference,'แหล่งเก็บไฟล์',4000),sections,provenance,supersedes:body.supersedes?uuid(body.supersedes):null,reason:text(body.reason,'เหตุผลการลงทะเบียน')};
}
function parseConfirmation(body,doc){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'ข้อมูลการพิมพ์ไม่ถูกต้อง');
 if(body.physicalPrinted!==true)fail(400,'ต้องยืนยันว่าพิมพ์เป็นกระดาษแล้ว การสร้าง PDF หรือดาวน์โหลดไม่นับเป็นการพิมพ์');
 const ranges=parseRanges(body.pages,doc.page_count),printedOn=date(body.printedOn,true);if(printedOn&&printedOn>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))fail(400,'วันที่พิมพ์ต้องไม่เป็นอนาคต');
 if(ranges==null&&body.unknownPages!==true)fail(400,'ระบุหน้าที่พิมพ์ หรือเลือกยืนยันว่ายังไม่ทราบเลขหน้า');
 return {ranges,printedOn,copies:integer(body.copies,1,1000,'จำนวนชุด',true),printer:text(body.printerName,'เครื่องพิมพ์',300,false)||null,evidenceType:choice(body.evidenceType,['user_confirmation','printer_receipt','photo'],'ประเภทหลักฐาน'),evidence:text(body.evidenceReference,'หลักฐานการพิมพ์',8000),reason:text(body.reason,'เหตุผลการบันทึก')};
}
function summarizeDocument(doc,events,month=''){
 const voided=new Set(events.filter(e=>e.action==='voided').map(e=>e.voids_event_id)),active=events.filter(e=>e.action==='confirmed'&&!voided.has(e.id));
 const all=mergeRanges(active.flatMap(e=>e.page_ranges||[]));if(all.some(([a,b])=>!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<1||a>b||!doc.page_count||b>doc.page_count))fail(500,'ประวัติเลขหน้าไม่ตรงกับไฟล์เอกสาร');
 const known=all.reduce((n,[a,b])=>n+b-a+1,0),scopeUnknown=active.some(e=>e.page_ranges==null);
 const section=month?(doc.sections||[]).find(s=>s.month===month):null,multi=doc.period_start.slice(0,7)!==doc.period_end.slice(0,7),mapped=!(month&&multi&&!section);
 const bounds=section?[section.pageFrom,section.pageTo]:[1,doc.page_count];const selected=mapped&&doc.page_count?all.map(([a,b])=>[Math.max(a,bounds[0]),Math.min(b,bounds[1])]).filter(([a,b])=>a<=b):[];
 const count=mapped?selected.reduce((n,[a,b])=>n+b-a+1,0):null,total=mapped&&doc.page_count?bounds[1]-bounds[0]+1:null;
 const globalStatus=doc.page_count&&known===doc.page_count?'confirmed_printed':known?'partially_confirmed':scopeUnknown?'confirmed_scope_unknown':'waiting_confirmation';
 const status=mapped&&total?count===total?'confirmed_printed':count?'partially_confirmed':scopeUnknown?'confirmed_scope_unknown':'waiting_confirmation':globalStatus;
 return {...doc,status,globalStatus,confirmedPages:count,scopeTotalPages:total,pendingPages:total==null?null:total-count,confirmedRanges:rangeText(selected),allConfirmedRanges:rangeText(all),scopeUnknown,monthPagesMapped:mapped,selectedSection:section,confirmationCount:active.length};
}
function createReportPrintRegister(db){
 async function transaction(auth,fn){requireAdmin(auth);const c=await db.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function document(c,id,lock=false){uuid(id);const d=(await c.query(`SELECT *,period_start::text,period_end::text FROM report_print_register.documents WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];if(!d)fail(404,'ไม่พบไฟล์เอกสาร');return d;}
 async function list(auth,filters={}){
  requireAdmin(auth);const args=[],where=[],bind=v=>{args.push(v);return'$'+args.length;};
  if(filters.kind)where.push('report_kind='+bind(choice(filters.kind,KINDS,'ประเภทรายงาน')));
  if(filters.branch)where.push('branch_code='+bind(choice(filters.branch,BRANCHES,'สาขา')));
  if(filters.month){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(filters.month))fail(400,'เดือนเอกสารไม่ถูกต้อง');const m=bind(filters.month);where.push(`period_start < (${m}||'-01')::date+interval '1 month' AND period_end >= (${m}||'-01')::date`);}
  if(filters.version)where.push('version_label ILIKE '+bind('%'+text(filters.version,'รุ่น',150)+'%'));
  const docs=(await db.query(`SELECT d.*,d.period_start::text,d.period_end::text FROM report_print_register.documents d ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY d.report_kind,d.branch_code,d.period_start DESC,d.created_at DESC LIMIT 1001`,args)).rows;
  if(docs.length>1000)fail(400,'พบเอกสารมากเกินไป กรุณาเลือกสาขา เดือน หรือรุ่น');
  const events=docs.length?(await db.query('SELECT *,printed_on::text FROM report_print_register.events WHERE document_id=ANY($1::uuid[]) ORDER BY recorded_at,id',[docs.map(d=>d.id)])).rows:[];
  let rows=docs.map(d=>summarizeDocument(d,events.filter(e=>e.document_id===d.id),filters.month));
  if(filters.status){choice(filters.status,['waiting_confirmation','confirmed_printed','partially_confirmed','confirmed_scope_unknown'],'สถานะ');rows=rows.filter(d=>d.status===filters.status);}
  const unbound=(await db.query('SELECT * FROM report_print_register.unmapped_evidence ORDER BY recorded_at DESC LIMIT 100')).rows.filter(e=>(!filters.kind||e.report_kind===filters.kind)&&(!filters.branch||e.branch_code===filters.branch)&&(!filters.month||e.month===filters.month));
  return {documents:rows,unmappedEvidence:unbound,meaning:'Physical paper-print confirmations only. File creation, PDF rendering and downloads never confirm printing.'};
 }
 async function detail(auth,id){requireAdmin(auth);const d=await document(db,id);const events=(await db.query('SELECT *,printed_on::text FROM report_print_register.events WHERE document_id=$1 ORDER BY recorded_at DESC,id',[id])).rows;return{document:summarizeDocument(d,events),events};}
 async function register(auth,body){const d=parseDocument(body);return transaction(auth,async c=>{
  if(d.supersedes){const prev=await document(c,d.supersedes);if(prev.report_kind!==d.kind||prev.branch_code!==d.branch)fail(400,'ฉบับก่อนหน้าต้องเป็นรายงานประเภทเดียวกันและสาขาเดียวกัน');}
  const id=randomUUID();try{await c.query(`INSERT INTO report_print_register.documents(id,source_key,report_kind,branch_code,period_start,period_end,version_label,filename,page_count,sha256,source_reference,sections,provenance,supersedes,registered_by,registration_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)`,[id,d.sourceKey,d.kind,d.branch,d.start,d.end,d.version,d.filename,d.pages,d.sha,d.reference,JSON.stringify(d.sections),JSON.stringify(d.provenance),d.supersedes,String(auth.userId),d.reason]);}catch(e){if(e.code==='23505')fail(409,'แหล่งข้อมูลนี้ลงทะเบียนแล้ว');throw e;}return{id};
 });}
 async function confirm(auth,id,body){return transaction(auth,async c=>{
  const doc=await document(c,id,true),e=parseConfirmation(body,doc),eventId=randomUUID();
  const requestKey=uuid(body.requestKey),prior=(await c.query('SELECT *,printed_on::text FROM report_print_register.events WHERE source_key=$1',[requestKey])).rows[0];
  if(prior){if(prior.document_id!==id||prior.action!=='confirmed'||JSON.stringify(prior.page_ranges)!==JSON.stringify(e.ranges)||prior.printed_on!==e.printedOn||prior.copies!==e.copies||prior.printer_name!==e.printer||prior.evidence_type!==e.evidenceType||prior.evidence_reference!==e.evidence||prior.reason!==e.reason)fail(409,'คำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาโหลดใหม่');return{id:prior.id,reused:true};}
  await c.query(`INSERT INTO report_print_register.events(id,document_id,source_key,action,page_ranges,printed_on,copies,printer_name,evidence_type,evidence_reference,reason,recorded_by) VALUES($1,$2,$3,'confirmed',$4::jsonb,$5,$6,$7,$8,$9,$10,$11)`,[eventId,id,requestKey,e.ranges==null?null:JSON.stringify(e.ranges),e.printedOn,e.copies,e.printer,e.evidenceType,e.evidence,e.reason,String(auth.userId)]);return{id:eventId};
 });}
 async function voidEvent(auth,id,eventId,body){uuid(eventId);const why=text(body.reason,'เหตุผลแก้ไขประวัติ');return transaction(auth,async c=>{
  await document(c,id,true);const target=(await c.query("SELECT * FROM report_print_register.events WHERE id=$1 AND document_id=$2 AND action='confirmed'",[eventId,id])).rows[0];if(!target)fail(404,'ไม่พบการยืนยันของไฟล์นี้');
  if((await c.query('SELECT id FROM report_print_register.events WHERE voids_event_id=$1',[eventId])).rows.length)fail(409,'รายการนี้ถูกยกเลิกแล้ว');
  const key=randomUUID();await c.query("INSERT INTO report_print_register.events(id,document_id,action,voids_event_id,evidence_reference,reason,recorded_by) VALUES($1,$2,'voided',$3,$4,$5,$6)",[key,id,eventId,'ยกเลิกการยืนยันเดิมโดยคงประวัติ',why,String(auth.userId)]);return{id:key};
 });}
 function inspectImport(seed){
  if(seed?.schema!=='sc.report-print-register.private-seed.v1'||!Array.isArray(seed.documents)||seed.documents.length>200||!Array.isArray(seed.confirmations)||seed.confirmations.length>500||!Array.isArray(seed.unmappedEvidence)||seed.unmappedEvidence.length>100)fail(400,'รูปแบบไฟล์ทะเบียนไม่ถูกต้องหรือมีรายการมากเกินกำหนด');
  const seen=new Set();
  for(const raw of seed.documents){const d=parseDocument(raw);if(seen.has(d.sourceKey))fail(400,'รหัสไฟล์ซ้ำในชุดนำเข้า');seen.add(d.sourceKey);if(raw.supersedesSourceKey)text(raw.supersedesSourceKey,'รหัสรุ่นก่อน',240);}
  for(const raw of seed.confirmations){text(raw.sourceKey,'รหัสหลักฐาน',240);text(raw.documentSourceKey,'รหัสไฟล์ของหลักฐาน',240);const d=seed.documents.find(d=>d.sourceKey===raw.documentSourceKey);if(!d)fail(400,'หลักฐานต้องอ้างถึงไฟล์ในชุดนำเข้านี้');parseConfirmation(raw,{page_count:d.pageCount});}
  for(const e of seed.unmappedEvidence){text(e.sourceKey,'รหัสภาพหลักฐาน',240);choice(e.reportKind,KINDS,'ประเภทหลักฐาน');choice(e.branchCode,BRANCHES,'สาขาของหลักฐาน');if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.month))fail(400,'เดือนหลักฐานไม่ถูกต้อง');text(e.summary,'สรุปภาพหลักฐาน',8000);text(e.evidenceReference,'แหล่งหลักฐาน',8000);}
  return{digest:createHash('sha256').update(JSON.stringify(seed)).digest('hex'),documents:seed.documents.length,paperConfirmations:seed.confirmations.length,unmappedEvidence:seed.unmappedEvidence.length};
 }
 async function previewImport(auth,body){requireAdmin(auth);return inspectImport(body.seed);}
 async function importHistory(auth,body){
  const preview=inspectImport(body.seed);if(body.confirmImport!==true)fail(400,'กรุณาทบทวนและยืนยันการนำเข้าทะเบียน');if(body.previewDigest!==preview.digest)fail(409,'ไฟล์นำเข้าเปลี่ยนแล้ว กรุณาตรวจตัวอย่างอีกครั้ง');
  return transaction(auth,async c=>{
   await c.query("SELECT pg_advisory_xact_lock(hashtext('report-print-register:history-import'))");const ids=new Map(),seed=body.seed;let documentsAdded=0,confirmationsAdded=0,evidenceAdded=0;
   for(const raw of seed.documents){
    let prior=null;if(raw.supersedesSourceKey){prior=(await c.query('SELECT id FROM report_print_register.documents WHERE source_key=$1',[raw.supersedesSourceKey])).rows[0]?.id;if(!prior)fail(400,'นำเข้ารุ่นก่อนหน้าก่อนรุ่นใหม่ที่อ้างถึง');}
    const d=parseDocument({...raw,supersedes:prior||raw.supersedes}),id=randomUUID();
    if(d.supersedes){const prev=await document(c,d.supersedes);if(prev.report_kind!==d.kind||prev.branch_code!==d.branch)fail(400,'รุ่นก่อนหน้าต้องเป็นประเภทและสาขาเดียวกัน');}
    const inserted=await c.query(`INSERT INTO report_print_register.documents(id,source_key,report_kind,branch_code,period_start,period_end,version_label,filename,page_count,sha256,source_reference,sections,provenance,supersedes,registered_by,registration_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16) ON CONFLICT(source_key) DO NOTHING RETURNING id`,[id,d.sourceKey,d.kind,d.branch,d.start,d.end,d.version,d.filename,d.pages,d.sha,d.reference,JSON.stringify(d.sections),JSON.stringify(d.provenance),d.supersedes,String(auth.userId),d.reason]);documentsAdded+=inserted.rowCount;
    const v=(await c.query('SELECT *,period_start::text,period_end::text FROM report_print_register.documents WHERE source_key=$1',[d.sourceKey])).rows[0];
    if(v.report_kind!==d.kind||v.branch_code!==d.branch||v.period_start!==d.start||v.period_end!==d.end||v.filename!==d.filename||v.page_count!==d.pages||v.sha256!==d.sha||v.version_label!==d.version||v.source_reference!==d.reference||v.supersedes!==d.supersedes||!isDeepStrictEqual(v.sections,d.sections)||!isDeepStrictEqual(v.provenance,d.provenance))fail(409,'รหัสแหล่งข้อมูลเดิมมีเนื้อหาต่างกัน ต้องลงทะเบียนเป็นรุ่นใหม่');ids.set(d.sourceKey,v.id);
   }
   for(const raw of seed.confirmations){
    const rawDoc=seed.documents.find(d=>d.sourceKey===raw.documentSourceKey),e=parseConfirmation(raw,{page_count:rawDoc.pageCount}),id=randomUUID(),docId=ids.get(raw.documentSourceKey);
    const result=await c.query(`INSERT INTO report_print_register.events(id,document_id,source_key,action,page_ranges,printed_on,copies,printer_name,evidence_type,evidence_reference,reason,recorded_by) VALUES($1,$2,$3,'confirmed',$4::jsonb,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(source_key) DO NOTHING RETURNING id`,[id,docId,raw.sourceKey,e.ranges==null?null:JSON.stringify(e.ranges),e.printedOn,e.copies,e.printer,e.evidenceType,e.evidence,e.reason,String(auth.userId)]);confirmationsAdded+=result.rowCount;
    const v=(await c.query('SELECT *,printed_on::text FROM report_print_register.events WHERE source_key=$1',[raw.sourceKey])).rows[0];if(v.document_id!==docId||v.action!=='confirmed'||!isDeepStrictEqual(v.page_ranges,e.ranges)||v.printed_on!==e.printedOn||v.copies!==e.copies||v.printer_name!==e.printer||v.evidence_type!==e.evidenceType||v.evidence_reference!==e.evidence||v.reason!==e.reason)fail(409,'หลักฐานเดิมมีเนื้อหาต่างกัน กรุณาบันทึกเป็นรายการใหม่');
   }
   for(const e of seed.unmappedEvidence){
    const inserted=await c.query('INSERT INTO report_print_register.unmapped_evidence(id,source_key,report_kind,branch_code,month,summary,evidence_reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_key) DO NOTHING RETURNING id',[randomUUID(),e.sourceKey,e.reportKind,e.branchCode,e.month,e.summary,e.evidenceReference,String(auth.userId)]);evidenceAdded+=inserted.rowCount;
    const v=(await c.query('SELECT * FROM report_print_register.unmapped_evidence WHERE source_key=$1',[e.sourceKey])).rows[0];if(v.report_kind!==e.reportKind||v.branch_code!==e.branchCode||v.month!==e.month||v.summary!==e.summary||v.evidence_reference!==e.evidenceReference)fail(409,'ภาพหลักฐานเดิมมีข้อมูลต่างกัน');
   }
   return{...preview,documentsAdded,confirmationsAdded,evidenceAdded};
  });
 }
 return{list,detail,register,confirm,voidEvent,previewImport,importHistory};
}
module.exports={createReportPrintRegister,parseDocument,parseConfirmation,parseRanges,mergeRanges,rangeText,summarizeDocument};
