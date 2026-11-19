'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),bcrypt=require('bcryptjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function settings(){const hash=await bcrypt.hash('fixturePassword',12),invitations={};for(const [name,branch,operatorCode]of [['front','004'],['shopee','004','01004SHPEE'],['001','001'],['005','005']])invitations[name]={id:crypto.randomUUID(),code:crypto.randomBytes(24).toString('base64url'),branchCode:branch,...(operatorCode?{operatorCode}:{})};
 return {invitations,config:{featureScpdaRead001:true,featureScpdaCounts001:true,featureScpdaBranch004:true,featureScpdaBranch005:true,featureScpda004Areas:true,authJwtSecret:'synthetic-only-004-area-signing-key',scpdaCountOperators001:'01001,01004,01004SHPEE,01005',scpdaOperatorCredentialsJson:JSON.stringify(['01001','02001','03001','01004','01004SHPEE','01005'].map(operatorCode=>({operatorCode,hash,version:crypto.randomUUID(),rotationDueAt:'2027-05-19T00:00:00Z'}))),scpdaDeviceInvitationsJson:JSON.stringify(Object.values(invitations).map(({code,...i})=>({...i,hash:sha(code),expiresAt:new Date(Date.now()+86400000).toISOString()})))}};
}
async function schema(db){await db.query(`CREATE SCHEMA ordering;CREATE SCHEMA ada;
 CREATE TABLE public.audit_logs(audit_id bigserial PRIMARY KEY,actor_role text,actor_id text,action text,target_type text,target_id text,success boolean,meta jsonb,request_id text,ip text,user_agent text,event_time timestamptz DEFAULT clock_timestamp());
 CREATE TABLE public.skus(sku_id bigint PRIMARY KEY,company_code text,display_name text);INSERT INTO public.skus VALUES(1,'QA-001','เภสัช ยาทดสอบ');
 CREATE TABLE public.barcodes(sku_id bigint,barcode text,is_primary boolean);INSERT INTO public.barcodes VALUES(1,'0001234567890',true);
 CREATE TABLE ada.branch_stock_snapshots(product_code text,product_name_thai text,product_name_eng text,barcode text,unit text,qty_branch_001 numeric,qty_branch_004 numeric,qty_branch_005 numeric,synced_at timestamptz);
 INSERT INTO ada.branch_stock_snapshots VALUES('QA-001','เภสัช ยาทดสอบ','','0001234567890','กล่อง',6,40,11,now());`);
 for(const file of ['083_add_scpda_lot_observations.sql','084_enable_scpda_branch005.sql','087_enable_scpda_branch004.sql','090_add_scpda004_count_areas.sql'])await db.query(fs.readFileSync('migrations/'+file,'utf8'));
}
module.exports={settings,schema};
