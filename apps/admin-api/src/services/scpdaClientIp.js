"use strict";
const proxyaddr=require('proxy-addr');
const ipaddr=require('ipaddr.js');
const net=require('node:net');
const {CountError}=require('./scpdaObservationLedger');
// Official public list: https://api.cloudflare.com/client/v4/ips (2026-11-19).
// Render's nearest hop is already trusted by Express. Trust one additional
// hop only when it is Cloudflare, never a caller-supplied leftmost prefix.
const cloudflare=proxyaddr.compile([
 "173.245.48.0/20",
 "103.21.244.0/22",
 "103.22.200.0/22",
 "103.31.4.0/22",
 "141.101.64.0/18",
 "108.162.192.0/18",
 "190.93.240.0/20",
 "188.114.96.0/20",
 "197.234.240.0/22",
 "198.41.128.0/17",
 "162.158.0.0/15",
 "104.16.0.0/13",
 "104.24.0.0/14",
 "172.64.0.0/13",
 "131.0.72.0/22",
 "2400:cb00::/32",
 "2606:4700::/32",
 "2803:f800::/32",
 "2405:b500::/32",
 "2405:8100::/32",
 "2a06:98c0::/29",
 "2c0f:f248::/32"
]);
function scpdaClientIp(req){
 const configuredTrust=req.app?.get('trust proxy fn');
 let address=proxyaddr(req,(ip,hop)=>
  hop===0&&typeof configuredTrust==='function'&&configuredTrust(ip,0)||
  hop===1&&cloudflare(ip));
 if(!net.isIP(address))throw new CountError(403,'NETWORK_UNAVAILABLE','ยืนยันเครือข่ายร้านไม่ได้');
 // Keep IPv4-mapped addresses and equivalent IPv6 spellings identical.
 return ipaddr.process(address).toNormalizedString();
}
module.exports={scpdaClientIp};
