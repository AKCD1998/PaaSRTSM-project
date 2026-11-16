"use strict";
const crypto = require('node:crypto');
const ApkReader = require('@devicefarmer/adbkit-apkreader');
const yauzl = require('yauzl');
const PACKAGE = 'th.co.scgroup1989.scpda.preview';
const SIGNER = '3d11b6af0d2f472632e313d6b94fab745cc4af8c360dfe356be7bf627847c20a';
const MAX_APK = 16 * 1024 * 1024;
const sha = data => crypto.createHash('sha256').update(data).digest();
function lp(buffer, at = 0) {
  if (at + 4 > buffer.length) throw Error('Invalid APK block');
  const end = at + 4 + buffer.readUInt32LE(at);
  if (end > buffer.length) throw Error('Invalid APK block');
  return [buffer.subarray(at + 4, end), end];
}
function records(buffer) { const rows=[];for(let at=0;at<buffer.length;){const [row,end]=lp(buffer,at);rows.push(row);at=end;if(rows.length>100)throw Error('Too many APK records');}return rows; }
// APK v2 verification follows the AOSP chunk-digest format. This publisher
// intentionally accepts the existing single RSA/SHA256 SC key, no key rotation.
function verifyApkSignature(bytes) {
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){eocd=i;break;}
  if(eocd<0)throw Error('Missing APK directory');
  const cd=bytes.readUInt32LE(eocd+16),cdSize=bytes.readUInt32LE(eocd+12);
  if(cd<32||cd+cdSize!==eocd||bytes.readUInt16LE(eocd+4)!==0||bytes.readUInt16LE(eocd+6)!==0||!bytes.subarray(cd-16,cd).equals(Buffer.from('APK Sig Block 42')))throw Error('Invalid APK directory');
  const blockSize=Number(bytes.readBigUInt64LE(cd-24)),start=cd-blockSize-8;
  if(!Number.isSafeInteger(blockSize)||start<0||start>=cd-24||Number(bytes.readBigUInt64LE(start))!==blockSize)throw Error('Invalid signing block');
  let v2=null;
  for(let at=start+8;at<cd-24;){if(at+12>cd-24)throw Error('Invalid signing entry');const n=Number(bytes.readBigUInt64LE(at)),end=at+8+n;if(!Number.isSafeInteger(n)||n<4||end>cd-24)throw Error('Invalid signing entry');if(bytes.readUInt32LE(at+8)===0x7109871a){if(v2)throw Error('Duplicate signing block');v2=bytes.subarray(at+12,end);}at=end;}
  if(!v2)throw Error('APK v2 signature required');
  const signers=records(lp(v2)[0]);if(signers.length!==1)throw Error('One SC signer required');
  const signer=signers[0], [signedData,afterData]=lp(signer),[signatures,afterSignatures]=lp(signer,afterData),[publicKey]=lp(signer,afterSignatures);
  const [digests,afterDigests]=lp(signedData),[certificates]=lp(signedData,afterDigests),certs=records(certificates);
  if(certs.length!==1)throw Error('Unexpected certificate chain');
  const cert=new crypto.X509Certificate(certs[0]);
  if(sha(certs[0]).toString('hex')!==SIGNER||!cert.publicKey.export({type:'spki',format:'der'}).equals(publicKey))throw Error('APK is not signed by SC');
  const signature=records(signatures).find(row=>row.length>=4&&row.readUInt32LE(0)===0x0103),digest=records(digests).find(row=>row.length>=4&&row.readUInt32LE(0)===0x0103);
  if(!signature||!digest||!crypto.verify('RSA-SHA256',signedData,cert.publicKey,lp(signature,4)[0]))throw Error('APK signature invalid');
  const adjusted=Buffer.from(bytes.subarray(eocd));adjusted.writeUInt32LE(start,16);const chunks=[];
  for(const section of [bytes.subarray(0,start),bytes.subarray(cd,eocd),adjusted])for(let at=0;at<section.length;at+=1048576){const part=section.subarray(at,at+1048576),prefix=Buffer.alloc(5);prefix[0]=0xa5;prefix.writeUInt32LE(part.length,1);chunks.push(sha(Buffer.concat([prefix,part])));}
  const prefix=Buffer.alloc(5);prefix[0]=0x5a;prefix.writeUInt32LE(chunks.length,1);
  if(!sha(Buffer.concat([prefix,...chunks])).equals(lp(digest,4)[0]))throw Error('APK contents changed after signing');
  return SIGNER;
}
function preflightZip(bytes) { return new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
  if(error)return reject(error);let entries=0,total=0,manifests=0;const fail=e=>{zip.close();reject(e);};zip.on('error',fail);zip.on('entry',entry=>{total+=entry.uncompressedSize;if(++entries>2048||total>128*1024*1024||entry.fileName==='AndroidManifest.xml'&&(++manifests>1||entry.uncompressedSize>512*1024))return fail(Error('APK archive limits exceeded'));zip.readEntry();});zip.on('end',()=>manifests===1?resolve():reject(Error('Missing APK manifest')));zip.readEntry();
})); }
async function inspectApk(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<1024||bytes.length>MAX_APK)throw Error('APK size invalid');
  const signerSha256=verifyApkSignature(bytes);await preflightZip(bytes);
  const reader=await ApkReader.open(bytes),m=await reader.readManifest();
  if(m.package!==PACKAGE||!Number.isSafeInteger(m.versionCode)||m.versionCode<1||typeof m.versionName!=='string'||m.versionName.length>100||!m.versionName||m.application?.debuggable===true||!Number.isInteger(m.usesSdk?.minSdkVersion)||m.usesSdk.minSdkVersion<26)throw Error('APK manifest not supported');
  return {packageName:PACKAGE,versionCode:m.versionCode,versionName:m.versionName,minSdk:m.usesSdk.minSdkVersion,sizeBytes:bytes.length,sha256:sha(bytes).toString('hex'),signerSha256};
}
module.exports={inspectApk,verifyApkSignature,MAX_APK,PACKAGE,SIGNER};
