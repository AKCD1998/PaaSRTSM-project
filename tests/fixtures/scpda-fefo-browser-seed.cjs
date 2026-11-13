'use strict';
// Trusted synthetic projection for browser acceptance, never a production job.
const {Pool}=require('pg'),{randomUUID}=require('node:crypto');
const ledger=require('../../apps/admin-api/src/services/scpdaObservationLedger');
const {projectFefo}=require('../../apps/admin-api/src/services/scpdaFefo');
async function main(){
 const port=Number(process.argv[2]);if(!port)throw Error('Explicit fixture port required');
 const db=new Pool({host:'127.0.0.1',port,user:'scpda_fixture',password:'scpda-fixture-only',database:'scpda_read_fixture',ssl:false});
 try{
  if((await db.query('SELECT marker FROM public.scpda_fixture_marker')).rows[0]?.marker!=='scpda-counts-synthetic-only')throw Error('Fixture marker required');
  const baseline=(await db.query("SELECT e.* FROM ordering.scpda_observations e WHERE e.product_code='QA-001' AND e.complete_product AND NOT EXISTS(SELECT 1 FROM ordering.scpda_observations c WHERE c.correction_of=e.event_id) ORDER BY e.observed_at DESC,e.received_at DESC LIMIT 1")).rows[0];
  if(!baseline)throw Error('Fixture baseline required');
  const last=(await db.query('SELECT revision FROM ordering.scpda_review_events WHERE event_id=$1 ORDER BY revision DESC LIMIT 1',[baseline.event_id])).rows[0];
  await ledger.review(db,{userId:'synthetic-browser-seed'},baseline.event_id,{action:'accepted-observation',reason:'Synthetic baseline only; not Ada movement coverage',expectedRevision:last.revision});
  const asOf=new Date(Date.now()).toISOString(),start=baseline.observed_at.toISOString(),e=baseline.evidence;
  const result=projectFefo({baseline:{eventId:baseline.event_id,accepted:true,completeProduct:true,unitLabel:e.unitLabel,observedAt:start,lots:e.lots},unitProof:{verified:true,ruleVersion:'synthetic-only',unitCode:'TAB',unitLabel:e.unitLabel},coverage:{complete:true,deduplicated:true,sourceRevision:'synthetic-browser-only',from:start,through:asOf},movements:[{id:randomUUID(),kind:'sale',direction:'out',quantity:e.quantity,unitCode:'TAB',identityVerified:true,at:asOf}],asOf});
  if(result.status!=='estimated'||result.lots.some(l=>l.estimatedRemaining!=='0'))throw Error('Expected synthetic depletion');
  const id=randomUUID();await db.query("INSERT INTO ordering.scpda_fefo_projections(projection_id,baseline_event_id,branch_code,product_code,unit_label,valid_through,policy_version,source_revision,evidence,result) VALUES($1,$2,'001','QA-001',$3,$4,$5,'synthetic-browser-only',$6::jsonb,$7::jsonb)",[id,baseline.event_id,e.unitLabel,asOf,result.policy,JSON.stringify({synthetic:true,notAdaCoverage:true}),JSON.stringify(result)]);
  console.log(JSON.stringify({fixtureOnly:true,projectionId:id,baselineEventId:baseline.event_id,asOf}));
 }finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
