'use strict';
const crypto=require('node:crypto');
const FOLDER='1_JrtrlOJOIgmWA9PMOtknT1qgI_wGxZP';
const OWNER='admin@scgroup1989.com';
// This is server OAuth, independent of ChatGPT's Drive connector. Never fall
// back to public links or accept a file ID supplied by a phone.
function createDriveArchive(config,fetcher=global.fetch){
 let access=null,until=0;
 if(!config.scpdaDriveClientId||!config.scpdaDriveClientSecret||!config.scpdaDriveRefreshToken)throw Error('SCPDA_DRIVE_NOT_CONNECTED');
 async function request(url,options={}){
  const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(r.status===404)return null;
  if(!r.ok)throw Error('SCPDA_DRIVE_REQUEST_FAILED');return r.status===204?{}:r.json();
 }
 async function token(){if(access&&Date.now()<until)return access;
  const r=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.scpdaDriveClientId,client_secret:config.scpdaDriveClientSecret,refresh_token:config.scpdaDriveRefreshToken,grant_type:'refresh_token'})});
  if(!r?.access_token)throw Error('SCPDA_DRIVE_AUTH_FAILED');access=r.access_token;until=Date.now()+Math.min(Number(r.expires_in)||300,3500)*1000;return access;
 }
 async function api(path,options={},upload=false){return request('https://www.googleapis.com/'+(upload?'upload/drive/v3/':'drive/v3/')+path,{...options,headers:{...options.headers,Authorization:'Bearer '+await token()}});}
 function matches(file,row){return file&&!file.trashed&&file.parents?.includes(FOLDER)&&file.appProperties?.scpdaSession===row.session_id&&file.appProperties?.sha256===row.image_sha256;}
 return {
  async verify(){const about=await api('about?fields=user(emailAddress)');if(about?.user?.emailAddress!==OWNER)throw Error('SCPDA_DRIVE_OWNER_MISMATCH');const folder=await api('files/'+FOLDER+'?fields=id,mimeType,trashed,permissions(type,role,emailAddress)');if(!folder||folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||!Array.isArray(folder.permissions)||folder.permissions.some(p=>p.type!=='user'||p.emailAddress!==OWNER))throw Error('SCPDA_DRIVE_FOLDER_NOT_PRIVATE');},
  async get(row){const file=await api('files/'+encodeURIComponent(row.drive_file_id)+'?fields=id,parents,appProperties,trashed,size');if(!matches(file,row)||Number(file.size)>204800)throw Error('SCPDA_DRIVE_FILE_MISMATCH');const r=await fetcher('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(row.drive_file_id)+'?alt=media',{headers:{Authorization:'Bearer '+await token()},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('SCPDA_DRIVE_REQUEST_FAILED');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>204800||crypto.createHash('sha256').update(bytes).digest('hex')!==row.image_sha256)throw Error('SCPDA_DRIVE_FILE_MISMATCH');return bytes;},
  async reserveId(){const r=await api('files/generateIds?count=1&space=drive');if(!r?.ids?.[0])throw Error('SCPDA_DRIVE_ID_FAILED');return r.ids[0];},
  async put(row){
   const path='files/'+encodeURIComponent(row.drive_file_id)+'?fields=id,parents,appProperties,trashed,size';const prior=await api(path);if(prior){if(!matches(prior,row)||Number(prior.size)!==row.image_bytes.length)throw Error('SCPDA_DRIVE_FILE_MISMATCH');return;}
   const boundary='scpda_'+crypto.randomBytes(16).toString('hex');const metadata={id:row.drive_file_id,name:row.file_name,mimeType:'image/jpeg',parents:[FOLDER],appProperties:{scpdaSession:row.session_id,sha256:row.image_sha256}};
   const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: image/jpeg\r\n\r\n'),row.image_bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
   const result=await api('files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body},true);if(result?.id!==row.drive_file_id)throw Error('SCPDA_DRIVE_UPLOAD_NOT_CONFIRMED');
   const saved=await api(path);if(!matches(saved,row)||Number(saved.size)!==row.image_bytes.length)throw Error('SCPDA_DRIVE_UPLOAD_NOT_CONFIRMED');
  },
  async remove(row){const id=encodeURIComponent(row.drive_file_id),saved=await api('files/'+id+'?fields=id,parents,appProperties,trashed');if(saved){if(!matches({...saved,trashed:false},row))throw Error('SCPDA_DRIVE_FILE_MISMATCH');await api('files/'+id,{method:'DELETE'});if(await api('files/'+id+'?fields=id'))throw Error('SCPDA_DRIVE_DELETE_NOT_CONFIRMED');}}
 };
}
async function archiveBatch({db,drive,now=Date.now,limit=10}){
 const client=await db.connect();let locked=false,processed=0;
 try{
  locked=(await client.query("SELECT pg_try_advisory_lock(hashtextextended('scpda-selfie-archive-v1',0)) AS acquired")).rows[0].acquired;if(!locked)return {processed:0};
  await drive.verify();
  const rows=(await client.query("SELECT * FROM ordering.scpda_selfie_archives WHERE state<>'deleted' AND (state='pending' OR delete_after <= $1) ORDER BY delete_after,created_at LIMIT $2",[new Date(now()),limit])).rows;
  for(const row of rows){
   if(+new Date(row.delete_after)<=now()){
    if(row.drive_file_id)await drive.remove(row);
    await client.query("UPDATE ordering.scpda_selfie_archives SET image_bytes=NULL,state='deleted',deleted_at=$2 WHERE session_id=$1",[row.session_id,new Date(now())]);
   }else{
    if(!row.image_bytes)throw Error('SCPDA_SELFIE_PENDING_BYTES_MISSING');
    if(!row.drive_file_id){row.drive_file_id=await drive.reserveId();await client.query('UPDATE ordering.scpda_selfie_archives SET drive_file_id=$2 WHERE session_id=$1',[row.session_id,row.drive_file_id]);}
    // Persist the reserved ID before uploading. A timeout retries the same file.
    await drive.put(row);
    await client.query("UPDATE ordering.scpda_selfie_archives SET image_bytes=NULL,state='uploaded',uploaded_at=$2 WHERE session_id=$1",[row.session_id,new Date(now())]);
   }
   processed++;
  }
  return {processed};
 }finally{if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended('scpda-selfie-archive-v1',0))").catch(()=>{});client.release();}
}
function startArchiveWorker({config,db,logger=console}){
 if(!config.scpdaDriveClientId||!config.scpdaDriveClientSecret||!config.scpdaDriveRefreshToken)return ()=>{};
 const drive=createDriveArchive(config);let active=false;
 const tick=async()=>{if(active)return;active=true;try{await archiveBatch({db,drive});}catch{logger.error('SCPDA_SELFIE_ARCHIVE_RETRY_REQUIRED');}finally{active=false;}};
 const timer=setInterval(tick,60000);timer.unref();void tick();return ()=>clearInterval(timer);
}
module.exports={createDriveArchive,archiveBatch,startArchiveWorker,FOLDER,OWNER};
