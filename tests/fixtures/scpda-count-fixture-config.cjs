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
const branch005=process.argv.includes('--branch005');
if(branch005){
 operators.push({operatorCode:'01005',branchCode:'005',hash:bcrypt.hashSync('fixture005password',12),version:crypto.randomUUID(),rotationDueAt:new Date(Date.now()+180*86400000).toISOString()});
 for(const name of ['invitation-005.json','java-invitation-005.json']){
  const id=crypto.randomUUID(),code=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+86400000).toISOString();
  invitations.push({id,branchCode:'005',hash:crypto.createHash('sha256').update(code).digest('hex'),expiresAt});
  files.push([name,{contract:'scpda-device-invitation-v1',branchCode:'005',apiOrigin:'https://paasrtsm-project.onrender.com',invitationId:id,activationCode:code,expiresAt}]);
 }
}
const branch004=process.argv.includes('--branch004');
if(branch004){
 operators.push({operatorCode:'01004',branchCode:'004',hash:bcrypt.hashSync('fixture004password',12),version:crypto.randomUUID(),rotationDueAt:new Date(Date.now()+180*86400000).toISOString()});
 for(const name of ['invitation-004.json','java-invitation-004.json']){
  const id=crypto.randomUUID(),code=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+86400000).toISOString();
  invitations.push({id,branchCode:'004',hash:crypto.createHash('sha256').update(code).digest('hex'),expiresAt});
  files.push([name,{contract:'scpda-device-invitation-v1',branchCode:'004',apiOrigin:'https://paasrtsm-project.onrender.com',invitationId:id,activationCode:code,expiresAt}]);
 }
}
files.push(['backend-config.json',{featureScpdaRead001:true,featureScpdaCounts001:true,scpdaCountOperators001:'01001',scpdaOperatorCredentialsJson:JSON.stringify(operators),scpdaDeviceInvitationsJson:JSON.stringify(invitations)}]);
if(branch005)Object.assign(files.at(-1)[1],{featureScpdaBranch005:true,scpdaCountOperators001:'01001,01005'});
if(branch004)Object.assign(files.at(-1)[1],{featureScpdaBranch004:true,scpdaCountOperators001:files.at(-1)[1].scpdaCountOperators001+',01004'});
for(const[name,data]of files)fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({syntheticOnly:true,directory,files:files.map(x=>x[0]),productionAccess:false,installationPerformed:false}));
