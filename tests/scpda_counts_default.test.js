'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest');
const {createScpdaCountsRouter,createScpdaAdminLotsRouter}=require('../apps/admin-api/src/routes/scpda-counts');
const db={query(){throw Error('Disabled routes must never touch database');}};
test('count collection is default off, including access negotiation',async()=>{
 const app=express();app.use(express.json());app.use('/api/scpda/counts',createScpdaCountsRouter({config:{featureScpdaRead001:true},db}));
 for(const path of ['/admission','/capabilities','/history','/events/10000000-0000-4000-8000-000000000001'])assert.equal((await request(app).get('/api/scpda/counts'+path)).status,404);
 assert.equal((await request(app).post('/api/scpda/counts').send({})).status,404);
});
test('admin pilot is default off and cannot accidentally expose fixture rows',async()=>{
 const app=express();app.use('/api/stock-lots',createScpdaAdminLotsRouter({config:{},db,requireAuthMiddleware:()=>{throw Error('Disabled route');},requireCsrfMiddleware:()=>{throw Error('Disabled route');}}));
 assert.equal((await request(app).get('/api/stock-lots/review-queue')).status,404);
});
