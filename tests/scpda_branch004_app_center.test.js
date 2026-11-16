'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),jwt=require('jsonwebtoken'),express=require('express'),request=require('supertest');
const {createAppCenterRouter}=require('../apps/admin-api/src/routes/app-center');

test('004 updates require004 admission and App Center purpose proof, without a count or product grant',async()=>{
 const secret='synthetic-004-app-center-test-only',pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64'),ref=crypto.createHash('sha256').update(Buffer.from(publicKey,'base64')).digest('hex');
 const key=crypto.createHmac('sha256',secret).update('scpda:device-certificate-v1').digest('base64url');
 const cert=jwt.sign({kind:'scpda-device',branch_code:'004',device_ref:ref,device_id:crypto.randomUUID(),public_key:publicKey},key,{algorithm:'HS256',issuer:'sc-stockday',audience:'scpda-device-004',expiresIn:'1h'});
 const service={app:{id:'scpda'},latest:async()=>null},config={authJwtSecret:secret,featureScpdaRead001:true,scpdaRevokedDeviceRefsJson:'[]'};
 const app=express();app.use(express.json());
 for(const[route,extra]of [['off',{}],['other',{featureScpdaBranch005:true}],['on',{featureScpdaBranch004:true}]])app.use('/'+route,createAppCenterRouter({config:{...config,...extra},db:{},service}));
 for(const route of ['off','other'])assert.equal((await request(app).post('/'+route+'/device/challenge').send({deviceCertificate:cert})).status,401);
 const challenge=async()=>(await request(app).post('/on/device/challenge').send({deviceCertificate:cert}).expect(200)).body;
 const proof=(c,prefix)=>crypto.sign('sha256',Buffer.from([prefix,c.challengeId,c.nonce,ref,'16'].join('\n')),pair.privateKey).toString('base64');
 let c=await challenge();await request(app).post('/on/device/check').send({deviceCertificate:cert,challengeId:c.challengeId,installedVersionCode:16,signature:proof(c,'SCPDA-LOGIN-V1')}).expect(401);
 c=await challenge();const body={deviceCertificate:cert,challengeId:c.challengeId,installedVersionCode:16,signature:proof(c,'SC-APP-CENTER-V1')};
 const result=(await request(app).post('/on/device/check').send(body).expect(200)).body;assert.equal(result.updateAvailable,false);assert.equal(result.release,null);assert.equal('countToken' in result,false);assert.equal('token' in result,false);
 await request(app).post('/on/device/check').send(body).expect(401);
});
