"use strict";
const { createHash } = require('node:crypto');

const transientStatuses = new Set([408,429,500,502,503,504]);
function failure(code, temporary = false) {
  return Object.assign(new Error(code), { code, temporary });
}

// One bounded budget for the whole call, plus a process-wide retry allowance.
// Concurrent reads of the same scope share parsed data, never a consumed stream.
function createProjectionReader({fetchImpl=globalThis.fetch,clock=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  budgetMs=5000,maxConcurrent=4,retriesPerWindow=4,retryWindowMs=30000}={}) {
  const inflight=new Map();let retryWindowStart=clock(),retries=0;
  async function fetchValue(url,codes,token){
    const start=clock();let attempts=0;
    for(;;){
      const remaining=Math.floor(budgetMs-(clock()-start));
      if(remaining<1)throw failure('PROJECTION_TIMEOUT',true);
      attempts++;
      try {
        const r=await fetchImpl(url,{method:'POST',redirect:'error',cache:'no-store',
          headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({productCodes:codes}),signal:AbortSignal.timeout(remaining)});
        if(!r.ok){
          if(r.body)await r.body.cancel().catch(()=>{});
          throw failure(transientStatuses.has(r.status)?'PROJECTION_TEMPORARILY_UNAVAILABLE':'PROJECTION_REQUEST_REJECTED',transientStatuses.has(r.status));
        }
        if(Number(r.headers?.get('content-length')||0)>4000000)throw failure('PROJECTION_CONTRACT_INVALID');
        let raw='',size=0;const decoder=new TextDecoder();
        for await(const chunk of r.body){size+=chunk.byteLength;if(size>4000000)throw failure('PROJECTION_CONTRACT_INVALID');raw+=decoder.decode(chunk,{stream:true});}
        raw+=decoder.decode();
        let value;try{value=JSON.parse(raw);}catch{throw failure('PROJECTION_CONTRACT_INVALID');}
        return {value,attempts};
      } catch(e) {
        const error=typeof e?.code==='string'&&e.code.startsWith('PROJECTION_')?e:failure(['TimeoutError','AbortError'].includes(e?.name)?'PROJECTION_TIMEOUT':'PROJECTION_TEMPORARILY_UNAVAILABLE',true);
        if(!error.temporary||attempts>=2)throw error;
        if(clock()-retryWindowStart>=retryWindowMs){retryWindowStart=clock();retries=0;}
        if(retries>=retriesPerWindow||budgetMs-(clock()-start)<250)throw error;
        retries++;await sleep(125);
      }
    }
  }
  return async function read(url,codes,token){
    const key=createHash('sha256').update(url).update('\0').update(token).update('\0').update(JSON.stringify([...codes].sort())).digest('hex');
    if(inflight.has(key))return inflight.get(key);
    if(inflight.size>=maxConcurrent)throw failure('PROJECTION_READER_BUSY',true);
    const work=fetchValue(url,codes,token);inflight.set(key,work);
    try{return await work;}finally{if(inflight.get(key)===work)inflight.delete(key);}
  };
}

// This is a reference cache, not a second reservation ledger. Expiry is a memory
// retention bound, not a claim about business freshness or physical stock.
function createConfirmedReferenceCache({now=()=>new Date(),maxProducts=10000,retentionMs=86400000}={}){
  const entries=new Map();let cutover=null;
  const unit=x=>String(x||'').normalize('NFKC').trim().toLowerCase();
  return {
    observeCutover(value){if(cutover&&cutover!==value)entries.clear();cutover=value;},
    clear(){entries.clear();cutover=null;},
    remove(productCode){entries.delete(productCode);},
    remember(record,projection){
      if(!Number.isFinite(record.qtyBranch004)||record.stock004?.basis!=='hourly-and-shopee')return;
      entries.delete(record.productCode);
      entries.set(record.productCode,{quantity:record.qtyBranch004,unit:unit(record.unit),observedAt:projection.asOf,fetchedAt:now().toISOString(),
        posObservedAt:record.stock004.capturedAt||record.stock004.fullSyncAt||null,cutoverAt:projection.cutoverAt,
        reservedQuantity:record.stock004.shopee.reservedQuantity,shippedUnpostedQuantity:record.stock004.shopee.shippedUnpostedQuantity});
      while(entries.size>maxProducts)entries.delete(entries.keys().next().value);
    },
    get(record,reasonCode){
      const item=entries.get(record.productCode);if(!item)return null;
      const age=now().getTime()-Date.parse(item.fetchedAt);
      if(age<0||age>retentionMs||item.unit!==unit(record.unit)){entries.delete(record.productCode);return null;}
      return {...item,stale:true,reasonCode};
    }
  };
}
module.exports={createProjectionReader,createConfirmedReferenceCache};
