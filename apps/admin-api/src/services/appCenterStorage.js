"use strict";
const {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
function createAppCenterStorage(config) {
  let client;
  const getClient=()=>{if(!config.r2AccessKeyId||!config.r2SecretAccessKey||!config.r2Endpoint||!config.r2BucketName)throw Object.assign(Error('พื้นที่เก็บไฟล์แอปยังไม่พร้อม'),{status:503});return client||(client=new S3Client({region:config.r2Region||'auto',endpoint:config.r2Endpoint,credentials:{accessKeyId:config.r2AccessKeyId,secretAccessKey:config.r2SecretAccessKey}}));};
  const check=key=>{if(!/^sc-app-center\/(production|development|test)\/scpda\/[a-f0-9-]{36}\.apk$/.test(key))throw Error('Invalid app object');return {Bucket:config.r2BucketName,Key:key};};
  return {
    put:async(key,bytes,hash)=>getClient().send(new PutObjectCommand({...check(key),Body:bytes,ContentType:'application/vnd.android.package-archive',CacheControl:'private, no-store',Metadata:{sha256:hash}})),
    get:async key=>getClient().send(new GetObjectCommand(check(key))),
    remove:async key=>getClient().send(new DeleteObjectCommand(check(key)))
  };
}
module.exports={createAppCenterStorage};
