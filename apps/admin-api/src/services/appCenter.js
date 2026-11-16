"use strict";
const crypto=require('node:crypto');
const {inspectApk}=require('./appCenterApk');
const {createAppCenterStorage}=require('./appCenterStorage');
const error=(status,message)=>Object.assign(Error(message),{status});
const columns='release_id,version_code,version_name,min_sdk,size_bytes,sha256,signer_sha256,release_notes,status,revision,created_at,published_at';
const dto=r=>r?{id:r.release_id,versionCode:r.version_code,versionName:r.version_name,minSdk:r.min_sdk,sizeBytes:r.size_bytes,sha256:r.sha256,signerSha256:r.signer_sha256,notes:r.release_notes,status:r.status,revision:r.revision,createdAt:r.created_at,publishedAt:r.published_at}:null;
function createAppCenter({config,db,storage=createAppCenterStorage(config),inspect=inspectApk}) {
  const app={id:'scpda',name:'SCPDA',platform:'Android',description:'นับสินค้าและเช็คราคาของ SC Group 1989',minAndroid:'8.0'};
  const audit=async(client,actor,action,id,meta={})=>client.query("INSERT INTO public.audit_logs(actor_role,actor_id,action,target_type,target_id,success,meta) VALUES($1,$2,$3,'app_center_release',$4,TRUE,$5::jsonb)",[actor==='system:scpda-build'?'system':'admin',actor,action,id,JSON.stringify(meta)]);
  async function latest(){return (await db.query('SELECT '+columns+" FROM app_center.releases WHERE app_id='scpda' AND status='published' ORDER BY version_code DESC LIMIT 1")).rows[0]||null;}
  return {app,latest,
    async catalog(admin){const rows=(await db.query('SELECT '+columns+" FROM app_center.releases WHERE app_id='scpda' "+(admin?'':"AND status='published' ")+"ORDER BY version_code DESC LIMIT 100")).rows;return {app,releases:rows.map(dto),latest:dto(rows.find(r=>r.status==='published'))};},
    async upload(actor,bytes,notes){
      if(typeof notes!=='string'||!notes.trim()||notes.trim().length>8000)throw error(400,'ระบุรายละเอียดอัปเดตไม่เกิน 8,000 ตัวอักษร');
      let info;try{info=await inspect(bytes);}catch{throw error(400,'ไฟล์ APK ไม่ถูกต้อง หรือไม่ได้ลงนามด้วยคีย์ SCPDA เดิม');}
      const id=crypto.randomUUID(),environment=config.nodeEnv==='production'?'production':config.nodeEnv==='test'?'test':'development',key='sc-app-center/'+environment+'/scpda/'+id+'.apk';
      const client=await db.connect();let stored=false,committed=false;
      try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('sc-app-center:scpda',0))");const existing=(await client.query('SELECT '+columns+" FROM app_center.releases WHERE app_id='scpda' AND version_code=$1",[info.versionCode])).rows[0];
        if(existing){if(existing.sha256!==info.sha256)throw error(409,'เลขรุ่นนี้มีไฟล์อื่นแล้ว ต้องเพิ่ม versionCode ก่อนสร้างใหม่');await client.query('COMMIT');committed=true;return {release:dto(existing),replayed:true};}
        const total=Number((await client.query("SELECT COALESCE(sum(size_bytes),0) AS n FROM app_center.releases")).rows[0].n);if(total+bytes.length>256*1024*1024)throw error(409,'พื้นที่เก็บรุ่นทดสอบเต็ม กรุณาติดต่อผู้ดูแลระบบ');
        stored=true;await storage.put(key,bytes,info.sha256);
        const row=(await client.query('INSERT INTO app_center.releases(release_id,app_id,package_name,version_code,version_name,min_sdk,size_bytes,sha256,signer_sha256,object_key,release_notes,created_by) VALUES($1,\'scpda\',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING '+columns,[id,info.packageName,info.versionCode,info.versionName,info.minSdk,bytes.length,info.sha256,info.signerSha256,key,notes.trim(),actor])).rows[0];
        await audit(client,actor,'appcenter.upload',id,{versionCode:info.versionCode,sha256:info.sha256});await client.query('COMMIT');committed=true;return {release:dto(row),replayed:false};
      }catch(e){if(!committed)await client.query('ROLLBACK').catch(()=>{});if(stored&&!committed)await storage.remove(key).catch(()=>{});throw e;}finally{client.release();}
    },
    async transition(actor,id,body,publish){
      if(!Number.isSafeInteger(body.revision)||body.revision<1)throw error(400,'กรุณาโหลดรายการใหม่');
      if(!publish&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000))throw error(400,'ระบุเหตุผลหยุดเผยแพร่');
      const client=await db.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('sc-app-center:scpda',0))");const row=(await client.query('SELECT '+columns+',object_key FROM app_center.releases WHERE release_id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw error(404,'ไม่พบรุ่นแอป');if(row.revision!==body.revision)throw error(409,'รายการเปลี่ยนแล้ว กรุณาโหลดใหม่');
        if(publish){if(row.status!=='draft')throw error(409,'เผยแพร่ได้เฉพาะฉบับร่าง');const newer=await client.query("SELECT 1 FROM app_center.releases WHERE app_id='scpda' AND status='published' AND version_code >= $1 LIMIT 1",[row.version_code]);if(newer.rows.length)throw error(409,'ต้องเผยแพร่รุ่นที่มี versionCode สูงกว่ารุ่นปัจจุบัน');}
        else if(row.status==='withdrawn')throw error(409,'หยุดเผยแพร่แล้ว');
        if(publish){const object=await storage.get(row.object_key),digest=crypto.createHash('sha256');let size=0;for await(const chunk of object.Body){size+=chunk.length;if(size>row.size_bytes){object.Body.destroy?.();throw error(409,'ไฟล์ที่เก็บไว้ขนาดไม่ตรงกัน');}digest.update(chunk);}if(size!==row.size_bytes||digest.digest('hex')!==row.sha256)throw error(409,'ไฟล์ที่เก็บไว้ยังไม่ครบ กรุณาอัปโหลดใหม่');}
        const updated=(await client.query('UPDATE app_center.releases SET status=$2,revision=revision+1,published_at=CASE WHEN $2=\'published\' THEN now() ELSE published_at END,published_by=CASE WHEN $2=\'published\' THEN $3 ELSE published_by END WHERE release_id=$1 RETURNING '+columns,[id,publish?'published':'withdrawn',actor])).rows[0];await audit(client,actor,publish?'appcenter.publish':'appcenter.withdraw',id,{versionCode:row.version_code,reason:publish?undefined:body.reason.trim()});await client.query('COMMIT');return dto(updated);
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
    },
    async artifact(id,hash){const r=(await db.query('SELECT object_key,sha256,size_bytes,version_name FROM app_center.releases WHERE release_id=$1 AND status=\'published\'',[id])).rows[0];if(!r||hash&&r.sha256!==hash)throw error(404,'รุ่นนี้ยังไม่เผยแพร่หรือถูกหยุดเผยแพร่แล้ว');return {...r,object:await storage.get(r.object_key)};},
    async published(id){const r=(await db.query('SELECT '+columns+' FROM app_center.releases WHERE release_id=$1 AND status=\'published\'',[id])).rows[0];if(!r)throw error(404,'รุ่นนี้ยังไม่เผยแพร่');return r;}
  };
}
module.exports={createAppCenter,dto};
