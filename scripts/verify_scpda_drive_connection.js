'use strict';
// Read-only remote verification. Obtain credentials only from Render secrets.
const {loadConfig}=require('../apps/admin-api/src/config');
const {createDriveArchive,FOLDER,OWNER}=require('../apps/admin-api/src/services/scpdaSelfieArchive');
(async()=>{await createDriveArchive(loadConfig(process.env)).verify();console.log(JSON.stringify({verified:true,owner:OWNER,folderId:FOLDER,private:true,writesPerformed:false}));})().catch(()=>{console.error('SCPDA_DRIVE_CONNECTION_NOT_VERIFIED');process.exitCode=2;});
