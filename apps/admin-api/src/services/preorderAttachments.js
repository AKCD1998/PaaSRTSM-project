"use strict";
const crypto = require("crypto");
const MAX_FILES=3, MAX_FILE_BYTES=5*1024*1024, MAX_TOTAL_BYTES=15*1024*1024;
const TYPES={ jpeg:{ mime:"image/jpeg", signatures:[[0xff,0xd8,0xff]] }, png:{ mime:"image/png",signatures:[[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]] }, webp:{mime:"image/webp",signatures:[]} };
function detectedType(buffer){
  if(!Buffer.isBuffer(buffer)) return null;
  for(const [ext,t] of Object.entries(TYPES)) for(const sig of t.signatures) if(sig.every((b,i)=>buffer[i]===b)) return {ext,mime:t.mime};
  if(buffer.length>=12 && buffer.subarray(0,4).toString()==="RIFF" && buffer.subarray(8,12).toString()==="WEBP") return {ext:"webp",mime:"image/webp"};
  return null;
}
function validateImages(files=[]){
  if(files.length>MAX_FILES) throw Object.assign(new Error("แนบรูปได้ไม่เกิน 3 รูป"),{statusCode:400});
  let total=0; return files.map((file)=>{ total+=file.size; const type=detectedType(file.buffer); if(!type || type.mime!==file.mimetype) throw Object.assign(new Error("รองรับเฉพาะรูป JPEG, PNG หรือ WebP ที่ถูกต้อง"),{statusCode:400}); if(file.size>MAX_FILE_BYTES) throw Object.assign(new Error("แต่ละรูปต้องมีขนาดไม่เกิน 5 MB"),{statusCode:400}); return {...file,detected:type,sha256:crypto.createHash("sha256").update(file.buffer).digest("hex")}; }).map((file)=>{if(total>MAX_TOTAL_BYTES) throw Object.assign(new Error("ขนาดรูปรวมต้องไม่เกิน 15 MB"),{statusCode:400}); return file;});
}
function createObjectKey({environment,branchCode,casePublicId,attachmentPublicId,ext}) { return `customer-preorders/${environment}/${branchCode}/${casePublicId}/${attachmentPublicId}.${ext}`; }
module.exports={MAX_FILES,MAX_FILE_BYTES,MAX_TOTAL_BYTES,detectedType,validateImages,createObjectKey};
