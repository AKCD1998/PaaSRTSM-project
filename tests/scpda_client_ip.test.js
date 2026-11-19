'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {scpdaClientIp}=require('../apps/admin-api/src/services/scpdaClientIp');
const {networkHash}=require('../apps/admin-api/src/services/scpdaDailyPolicy');
function app(trust=1){const a=express();a.set('trust proxy',trust);a.get('/',(q,s)=>{try{s.json({address:scpdaClientIp(q),hash:networkHash(q,'synthetic-network-test-key')});}catch(e){s.status(e.status||500).json({code:e.code});}});return a;}
const read=(a,xff)=>request(a).get('/').set('X-Forwarded-For',xff);
test('same customer IP through rotating Cloudflare hops produces one network identity',async()=>{const a=app(),first=await read(a,'203.0.113.5, 172.64.1.10'),second=await read(a,'203.0.113.5, 104.16.1.10');assert.equal(first.status,200);assert.equal(first.body.address,'203.0.113.5');assert.equal(first.body.hash,second.body.hash);const other=await read(a,'198.51.100.2, 172.64.1.10');assert.notEqual(first.body.hash,other.body.hash);});
test('forged left prefix is ignored after the real customer and trusted edge',async()=>{const r=await read(app(),'203.0.113.5, 198.51.100.2, 172.64.1.10');assert.equal(r.body.address,'198.51.100.2');});
test('only one additional Cloudflare hop is trusted, even when the customer uses a Cloudflare exit',async()=>{const r=await read(app(),'203.0.113.5, 104.28.0.1, 172.64.1.10');assert.equal(r.body.address,'104.28.0.1');});
test('a non-Cloudflare extra hop cannot nominate an earlier client address',async()=>{const r=await read(app(),'203.0.113.5, 198.51.100.2');assert.equal(r.body.address,'198.51.100.2');});
test('a normal single-hop Render request keeps the actual customer address',async()=>{const r=await read(app(),'203.0.113.5');assert.equal(r.body.address,'203.0.113.5');});
test('an untrusted direct socket ignores even a Cloudflare-shaped forwarded header',async()=>{const r=await read(app(false),'203.0.113.5, 172.64.1.10');assert.equal(r.body.address,'127.0.0.1');});
test('equivalent IPv6 addresses and IPv4-mapped addresses normalize before hashing',async()=>{const a=app(),v6a=await read(a,'2001:db8:abcd::1234, 2606:4700::1111'),v6b=await read(a,'2001:DB8:ABCD:0:0:0:0:1234, 172.64.1.10');assert.equal(v6a.body.hash,v6b.body.hash);const v4a=await read(a,'::ffff:203.0.113.5, 172.64.1.10'),v4b=await read(a,'203.0.113.5, 172.64.1.10');assert.equal(v4a.body.hash,v4b.body.hash);});
test('invalid client addresses fail closed',async()=>{const r=await read(app(),'not-an-ip, 172.64.1.10');assert.equal(r.status,403);assert.equal(r.body.code,'NETWORK_UNAVAILABLE');});
