'use strict';
// Creates only disposable synthetic fixture inputs. No real credentials read.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const directory=process.argv[2];
if(process.argv[3]!=='--synthetic-only'||!directory||!path.isAbsolute(directory))throw Error('Use an absolute empty directory and --synthetic-only');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
if(fs.readdirSync(directory).length)throw Error('Refusing to overwrite nonempty fixture directory');
const invitations=[],files=[];
for(const name of ['invitation.json','java-invitation.json']){
 const id=crypto.randomUUID(),code=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+86400000).toISOString();
 invitations.push({id,hash:crypto.createHash('sha256').update(code).digest('hex'),expiresAt});
 files.push([name,{contract:'scpda-device-invitation-v1',branchCode:'001',apiOrigin:'https://paasrtsm-project.onrender.com',invitationId:id,activationCode:code,expiresAt}]);
}
const operators=['01001','02001','03001'].map((operatorCode,i)=>({operatorCode,hash:bcrypt.hashSync(['1111','2222','3333'][i],12),version:crypto.randomUUID(),rotationDueAt:new Date(Date.now()+180*86400000).toISOString()}));
files.push(['backend-config.json',{featureScpdaRead001:true,featureScpdaCounts001:true,scpdaOperatorCredentialsJson:JSON.stringify(operators),scpdaDeviceInvitationsJson:JSON.stringify(invitations)}]);
for(const[name,data]of files)fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({syntheticOnly:true,directory,files:files.map(x=>x[0]),productionAccess:false,installationPerformed:false}));
