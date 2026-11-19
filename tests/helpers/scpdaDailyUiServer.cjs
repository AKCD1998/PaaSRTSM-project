'use strict';
// Explicit, loopback-only fixture. Never reads DATABASE_URL or real credentials.
const fs=require('node:fs'),crypto=require('node:crypto'),express=require('express'),bcrypt=require('bcryptjs'),{Pool}=require('pg');
const {createScpdaReadRouter}=require('../../apps/admin-api/src/routes/scpda-read');
const {createScpdaCountsRouter}=require('../../apps/admin-api/src/routes/scpda-counts');
(async()=>{
 const port=Number(process.env.SCPDA_DAILY_FIXTURE_PG_PORT),out=process.env.SCPDA_DAILY_FIXTURE_OUTPUT;
 if(!port||!out)return;if(!out.startsWith('/workspace/artifacts/'))throw Error('Explicit synthetic fixture required');
 const db=new Pool({host:'127.0.0.1',port,database:'scpda_daily_ui_fixture',user:'scpda_fixture',password:'scpda-fixture-only',ssl:false});
 if((await db.query('select current_database() n')).rows[0].n!=='scpda_daily_ui_fixture')throw Error('Fixture database mismatch');
 await db.query("CREATE SCHEMA IF NOT EXISTS app_center;CREATE TABLE IF NOT EXISTS app_center.releases(app_id text,status text,version_code integer);INSERT INTO app_center.releases VALUES('scpda','published',17)");
 const invitationId=crypto.randomUUID(),activationCode='synthetic-only-daily-ui-'+crypto.randomBytes(12).toString('hex'),hash=await bcrypt.hash('fixturePassword',12);
 const config={featureScpdaRead001:true,featureScpdaCounts001:true,featureScpdaBranch004:true,featureScpdaBranch005:true,featureScpdaDaily005:true,scpdaPwaVersionCode:17,scpdaPwaOrigin:'https://sc-stockday-ordering.onrender.com',scpdaDriveClientId:'synthetic-only',scpdaDriveClientSecret:'synthetic-only',scpdaDriveRefreshToken:'synthetic-only',scpdaCountOperators001:'01001,01004,01005,02005',authJwtSecret:'synthetic-only-daily-ui-secret',scpdaOperatorCredentialsJson:JSON.stringify(['01001','02001','03001','01004','01005','02005'].map(operatorCode=>({operatorCode,hash,version:crypto.randomUUID(),rotationDueAt:'2027-05-18T00:00:00Z'}))),scpdaDeviceInvitationsJson:JSON.stringify([{id:invitationId,hash:crypto.createHash('sha256').update(activationCode).digest('hex'),branchCode:'005',expiresAt:new Date(Date.now()+86400000).toISOString()}])};
 const app=express();app.set('trust proxy',1);app.use((req,res,next)=>{res.set('Access-Control-Allow-Origin','http://127.0.0.1:5207');res.set('Access-Control-Allow-Headers','Content-Type, Authorization');if(req.method==='OPTIONS')return res.status(204).end();next();});app.use(express.json({limit:'1mb'}));app.use('/api/scpda/counts',createScpdaCountsRouter({config,db}));app.use('/api/scpda',createScpdaReadRouter({config,db}));const server=app.listen(39817,'127.0.0.1');
 await new Promise(ok=>server.once('listening',ok));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/invitation.json',JSON.stringify({contract:'scpda-device-invitation-v1',branchCode:'005',apiOrigin:'https://paasrtsm-project.onrender.com',invitationId,activationCode}));console.log('SCPDA daily synthetic HTTP fixture ready on loopback 39817');
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(async()=>{await db.end();process.exit(0);}));
})().catch(e=>{console.error(e.code||'FIXTURE_SETUP_FAILED');process.exit(1);});
