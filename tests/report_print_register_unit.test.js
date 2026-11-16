"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {parseDocument,parseConfirmation,parseRanges,summarizeDocument}=require('../apps/admin-api/src/services/reportPrintRegister');
const doc={id:'d',page_count:10,period_start:'2026-07-01',period_end:'2026-09-30',sections:[{month:'2026-07',pageFrom:1,pageTo:4},{month:'2026-08',pageFrom:5,pageTo:7},{month:'2026-09',pageFrom:8,pageTo:10}],provenance:{generatedPdf:true,printedQuantity:9999}};
const event=(id,ranges)=>({id,action:'confirmed',page_ranges:ranges});
test('generated PDF/download metadata never confirms paper printing',()=>{
 const s=summarizeDocument(doc,[]);assert.equal(s.status,'waiting_confirmation');assert.equal(s.confirmedPages,0);assert.equal(s.pendingPages,10);
 for(const body of [{},{printed:true},{physicalPrinted:'true'},{downloaded:true}])assert.throws(()=>parseConfirmation(body,doc),{status:400});
});
test('page ranges are bounded, canonical and unioned without double counting',()=>{
 assert.deepEqual(parseRanges('3-5, 1-3, 5,10',10),[[1,5],[10,10]]);
 for(const bad of ['0','2-1','1-11','1,','1.2','-1','ALL','1;DELETE','999999999999999999'])assert.throws(()=>parseRanges(bad,10),{status:400});
 assert.throws(()=>parseRanges('1',null),{status:400});
 const s=summarizeDocument(doc,[event('a',[[1,3]]),event('b',[[3,5]])]);assert.equal(s.confirmedPages,5);assert.equal(s.status,'partially_confirmed');
});
test('unknown page scope requires an explicit choice and never means all pages',()=>{
 const body={physicalPrinted:true,evidenceType:'user_confirmation',evidenceReference:'ผู้ใช้ยืนยันพิมพ์แล้ว',reason:'ย้อนหลัง'};
 assert.throws(()=>parseConfirmation(body,doc),{status:400});
 const p=parseConfirmation({...body,unknownPages:true},doc);assert.equal(p.ranges,null);assert.equal(p.printedOn,null);assert.equal(p.copies,null);
 const s=summarizeDocument(doc,[event('a',null)]);assert.equal(s.status,'confirmed_scope_unknown');assert.equal(s.confirmedPages,0);
});
test('voiding a confirmation preserves history while removing only its coverage',()=>{
 const e=[event('a',[[1,10]]),event('b',[[3,4]]),{id:'c',action:'voided',voids_event_id:'a'}];
 const s=summarizeDocument(doc,e);assert.equal(e.length,3);assert.equal(s.confirmedPages,2);assert.equal(s.confirmedRanges,'3-4');
});
test('monthly views map parent PDF pages and never count a whole quarter as one month',()=>{
 let s=summarizeDocument(doc,[event('a',[[1,5]])],'2026-08');assert.equal(s.scopeTotalPages,3);assert.equal(s.confirmedPages,1);assert.equal(s.confirmedRanges,'5');
 s=summarizeDocument({...doc,sections:[]},[event('a',[[1,10]])],'2026-08');assert.equal(s.monthPagesMapped,false);assert.equal(s.confirmedPages,null);assert.equal(s.scopeTotalPages,null);assert.equal(s.globalStatus,'confirmed_printed');
});
test('document intake rejects invalid dates, ranges and sections; ignores claimed printed flags',()=>{
 const d={sourceKey:'synthetic',reportKind:'KY9',branchCode:'001',periodStart:'2026-07-01',periodEnd:'2026-09-30',version:'TEST',filename:'synthetic.pdf',pageCount:10,sourceReference:'test fixture',reason:'test',printed:true,physicalPrinted:true};
 assert.equal(parseDocument(d).printed,undefined);
 for(const periodStart of ['2026-02-30','2026-99-01','bad'])assert.throws(()=>parseDocument({...d,periodStart}),{status:400});
 assert.throws(()=>parseDocument({...d,sections:[{month:'2026-07',pageFrom:1,pageTo:6},{month:'2026-08',pageFrom:6,pageTo:10}]}),{status:400});
 assert.throws(()=>parseDocument({...d,periodEnd:'2026-06-30'}),{status:400});
});
