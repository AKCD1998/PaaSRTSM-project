'use strict';
// Operator probe: read-only unless --roundtrip is explicitly requested.
// OAuth values come from protected runtime configuration, never CLI arguments.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadConfig}=require('../apps/admin-api/src/config');
const {createDriveArchive,FOLDER,OWNER}=require('../apps/admin-api/src/services/scpdaSelfieArchive');
async function verifyDriveConnection({config,roundtrip=false,drive=createDriveArchive(config)}){
 const result={verified:false,owner:OWNER,folderId:FOLDER,private:true,roundtrip,writesPerformed:false,uploaded:false,readBack:false,deleted:false,employeeImagesUsed:false};
 await drive.verify();result.verified=true;if(!roundtrip)return result;
 const bytes=fs.readFileSync(path.join(__dirname,'../tests/fixtures/scpda-selfie-synthetic.jpg')),session=crypto.randomUUID();
 const row={session_id:session,drive_file_id:await drive.reserveId(),image_bytes:bytes,image_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),file_name:'SCPDA-CONNECTION-TEST-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+session+'.jpg'};
 Object.assign(result,{fileId:row.drive_file_id,fileName:row.file_name,bytes:bytes.length,sha256:row.image_sha256});
 try{result.writesPerformed=true;await drive.put(row);result.uploaded=true;const saved=await drive.get(row);if(!saved.equals(bytes))throw Error('SCPDA_TEST_BYTES_DIFFER');result.readBack=true;}
 catch(error){result.failure=/^SCPDA_[A-Z_]+$/.test(error.message)?error.message:'SCPDA_DRIVE_TEST_FAILED';}
 finally{try{await drive.remove(row);result.deleted=true;}catch{result.failure='SCPDA_TEST_CLEANUP_REQUIRED';}}
 if(result.failure){const e=Error(result.failure);e.probe=result;throw e;}return result;
}
if(require.main===module){const args=process.argv.slice(2);if(args.length>1||args.length===1&&args[0]!=='--roundtrip'){console.error('Use node scripts/verify_scpda_drive_connection.js [--roundtrip]');process.exitCode=2;}else verifyDriveConnection({config:loadConfig(process.env),roundtrip:args[0]==='--roundtrip'}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({error:'SCPDA_DRIVE_CONNECTION_NOT_VERIFIED',...(e.probe?{probe:e.probe}:{})}));process.exitCode=2;});}
module.exports={verifyDriveConnection};
