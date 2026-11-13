'use strict';
// Inference, never an assertion of which physical lot was sold.
const POLICY='scpda-fefo-001-v1';
const isoDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function milli(value){const s=String(value);if(!/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/.test(s))throw Error('quantity-invalid');const [w,f='']=s.split('.');return BigInt(w)*1000n+BigInt(f.padEnd(3,'0'));}
const decimal=n=>{const s=n.toString().padStart(4,'0');return (s.slice(0,-3)+'.'+s.slice(-3)).replace(/\.?0+$/,'')||'0';};
const min=(...v)=>v.reduce((a,b)=>a<b?a:b),max=(...v)=>v.reduce((a,b)=>a>b?a:b);
function projectFefo({baseline,unitProof,coverage,movements=[],asOf}){
 const reasons=[],at=Date.parse(asOf),start=Date.parse(baseline?.observedAt);
 if(!baseline?.accepted||!baseline.completeProduct)reasons.push('complete-reviewed-baseline-required');
 if(!unitProof?.verified||!unitProof.ruleVersion||!unitProof.unitCode||unitProof.unitLabel!==baseline?.unitLabel)reasons.push('stock-unit-unverified');
 if(!Number.isFinite(at)||!Number.isFinite(start)||start>at)reasons.push('observation-time-invalid');
 if(!coverage?.complete||!coverage.deduplicated||!coverage.sourceRevision||Date.parse(coverage.from)>start||!Number.isFinite(Date.parse(coverage.from))||Date.parse(coverage.through)<at||!Number.isFinite(Date.parse(coverage.through)))reasons.push('movement-coverage-unverified');
 const unknown=extra=>({policy:POLICY,status:'unknown',asOf,baselineEventId:baseline?.eventId||null,sourceRevision:coverage?.sourceRevision||null,reasons:[...new Set([...reasons,...extra])],lots:(baseline?.lots||[]).map(l=>({key:l.key,code:l.code,expiresOn:l.expiresOn,estimatedRemaining:null,minimum:null,maximum:null})),officialStockWrites:false});
 if(reasons.length)return unknown([]);
 const lots=new Map(),groups=new Map();
 function add(l,amount){if(typeof l.key!=='string'||!l.key||!isoDay(l.expiresOn)||typeof l.code!=='string'||!l.code)throw Error('lot-identity-or-expiry-unknown');const existing=lots.get(l.key);if(existing){if(existing.expiresOn!==l.expiresOn||existing.code!==l.code)throw Error('lot-identity-conflict');existing.low+=amount;existing.high+=amount;groups.get(existing.expiresOn).total+=amount;return;}const row={key:l.key,code:l.code,expiresOn:l.expiresOn,low:amount,high:amount};lots.set(row.key,row);let g=groups.get(row.expiresOn);if(!g){g={total:0n,lots:[]};groups.set(row.expiresOn,g);}g.total+=amount;g.lots.push(row);}
 function tighten(g){for(let loop=0;loop<g.lots.length+1;loop++){let changed=false;for(const l of g.lots){const others=g.lots.filter(x=>x!==l);const lo=max(l.low,g.total-others.reduce((n,x)=>n+x.high,0n),0n),hi=min(l.high,g.total-others.reduce((n,x)=>n+x.low,0n));if(lo>hi)throw Error('movement-baseline-conflict');changed||=lo!==l.low||hi!==l.high;l.low=lo;l.high=hi;}if(!changed)break;}}
 try{
  if(!Array.isArray(baseline.lots)||!baseline.lots.length)throw Error('lot-baseline-required');
  for(const l of baseline.lots){if(lots.has(l.key))throw Error('duplicate-baseline-lot');add(l,milli(l.quantity));}
  const ids=new Set();const ordered=[...movements].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||String(a.id).localeCompare(String(b.id)));
  for(const move of ordered){const t=Date.parse(move.at);if(!move.id||ids.has(move.id))throw Error('duplicate-movement');ids.add(move.id);if(!Number.isFinite(t))throw Error('movement-time-unknown');if(t<=start||t>at)continue;if(move.unitCode!==unitProof.unitCode||move.identityVerified!==true)throw Error('movement-unit-or-identity-unverified');const q=milli(move.quantity);
   if(move.direction==='in'){if(!move.lot)throw Error('incoming-lot-unknown');add(move.lot,q);continue;}
   if(move.direction!=='out')throw Error('movement-direction-unknown');
   if(move.lotKey){const row=lots.get(move.lotKey);if(!row||row.high<q)throw Error('explicit-lot-movement-conflict');const group=groups.get(row.expiresOn);row.low=max(row.low,q);tighten(group);row.low-=q;row.high-=q;group.total-=q;tighten(group);continue;}
   if(move.kind!=='sale')throw Error('unallocated-nonsale-movement');
   let remaining=q;
   for(const [,g]of [...groups.entries()].sort(([a],[b])=>a.localeCompare(b))){if(!remaining)break;const used=min(remaining,g.total);g.total-=used;remaining-=used;for(const l of g.lots){l.low=max(0n,l.low-used);l.high=min(l.high,g.total);}tighten(g);}
   if(remaining>0n)throw Error('sales-exceed-covered-stock');
  }
  const result=[...lots.values()].map(l=>({key:l.key,code:l.code,expiresOn:l.expiresOn,estimatedRemaining:l.low===l.high?decimal(l.low):null,minimum:decimal(l.low),maximum:decimal(l.high),basis:l.low===l.high?'fefo-assumption':'same-expiry-allocation-range'}));
  return {policy:POLICY,status:result.some(x=>x.estimatedRemaining===null)?'range':'estimated',asOf,baselineEventId:baseline.eventId,sourceRevision:coverage.sourceRevision,unitRuleVersion:unitProof.ruleVersion,unitCode:unitProof.unitCode,reasons:[],lots:result,officialStockWrites:false};
 }catch(error){return unknown([error.message]);}
}
function depletedLotWarnings(projection,observation){
 if(!projection||!['estimated','range'].includes(projection.status)||!Number.isFinite(Date.parse(observation.observedAt))||Date.parse(observation.observedAt)<Date.parse(projection.asOf))return [];
 return observation.lots.filter(l=>Number(l.quantity)>0&&l.key).flatMap(l=>{const prior=projection.lots.find(x=>x.key===l.key);return prior&&prior.minimum==='0'&&prior.maximum==='0'?[{code:'PRIOR_FEFO_ESTIMATE_DEPLETED',lotKey:l.key,lotCode:l.code,projectionId:projection.projectionId,estimateAsOf:projection.asOf,reportedQuantity:l.quantity,requiresReason:true,meansStaffIsWrong:false}]:[];});
}
module.exports={POLICY,projectFefo,depletedLotWarnings,milli,decimal};
